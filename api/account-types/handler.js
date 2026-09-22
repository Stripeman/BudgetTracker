'use strict';
// /api/account-types?workspaceId=   Workspace-scoped account TYPE definitions (BT-019-02): a name,
// an editable colour and an optional icon, each mapped to one of the fixed underlying accounting
// classes in api/_shared/ledger.js (ACCOUNT_TYPES). The type is presentation only; the accounting
// class is what actually drives balance/direction/opening-balance/liability logic everywhere else,
// and the two are kept strictly separate — renaming or recolouring a type never touches a single
// account or transaction (api/_shared/account-types.js has the full design comment).
//
//   GET  ?workspaceId=                        every type (system defaults always included, even
//                                             one not yet actually stored), retired ones too — the
//                                             caller decides what to offer for a NEW record versus
//                                             what to keep showing on a historical one
//   POST { name, accountingClass, color?, icon? }   create a custom type; owners/managers (or a
//                                             member, when the workspace lets members manage
//                                             shared lists) — the same rule categories already use
//   PATCH { typeId, name?, color?, icon?, retired?, accountingClass? }   a system type's own
//                                             accountingClass can never change and it can never be
//                                             retired; a custom type's accountingClass can change
//                                             only while no account uses it yet — refused and
//                                             explained otherwise, never silently applied
const { readBody, query, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const store = require('../_shared/store');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const colors = require('../_shared/colors');
const icons = require('../_shared/icons');
const ledger = require('../_shared/ledger');
const workspaceSettings = require('../_shared/workspace-settings');
const accountTypes = require('../_shared/account-types');
const deletion = require('../_shared/deletion');

const mayManage = (doc, member) => workspaceSettings.managesSharedLists(doc, member);
const catalogFor = async (ctx, body) => (body.icon !== undefined ? (await icons.readCatalog(ctx.storage)).catalog : null);
const colorOrNull = (value) => (value === null ? null : colors.validateColor(value, 'Colour'));

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const nowIso = ctx.nowIso();
  return { body: { types: accountTypes.effectiveTypes(doc, nowIso).map((t) => accountTypes.view(doc, t)), accountingClasses: ledger.ACCOUNT_TYPES, palette: colors.PALETTE } };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'accountingClass', 'color', 'icon']);
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!mayManage(doc, member)) throw forbidden('Only owners and managers can create account types in this workspace.');
    const nowIso = ctx.nowIso();
    accountTypes.ensureSystemTypes(doc, nowIso);
    const name = fields.text(body.name, { field: 'Name', max: 60, required: true });
    const accountingClass = fields.oneOf(body.accountingClass, ledger.ACCOUNT_TYPES, 'Accounting class');
    const id = newId('atype');
    const t = {
      id, name, accountingClass, color: body.color === undefined ? null : colorOrNull(body.color),
      defaultColor: colors.initialDefault(name, id), icon: body.icon === undefined ? null : icons.validateChoice(catalog, body.icon),
      defaultIcon: (icons.DEFAULTS.account && icons.DEFAULTS.account[accountingClass]) || null,
      system: false, retired: false, createdBy: member.subject, createdAt: nowIso,
      history: [{ at: nowIso, by: member.subject, changes: [{ field: 'create' }] }],
    };
    doc.accountTypes.push(t);
    audit.record(doc, { actor: member.subject, action: 'account-type.create', targetType: 'account-type', targetId: t.id, at: nowIso });
    return { type: accountTypes.view(doc, t) };
  });
  return { status: 201, body: result };
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['typeId', 'name', 'color', 'icon', 'retired', 'accountingClass']);
  const id = requireId(body.typeId, 'typeId');
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!mayManage(doc, member)) throw forbidden('Only owners and managers can change account types in this workspace.');
    const nowIso = ctx.nowIso();
    accountTypes.ensureSystemTypes(doc, nowIso);
    const t = (doc.accountTypes || []).find((x) => x.id === id);
    if (!t) throw notFound('Unknown account type.');
    const changes = [];
    const set = (field, value) => {
      const from = t[field] === undefined ? null : t[field];
      if (JSON.stringify(from) === JSON.stringify(value)) return;
      changes.push({ field, from, to: value });
      t[field] = value;
    };
    if (body.name !== undefined) set('name', fields.text(body.name, { field: 'Name', max: 60, required: true }));
    if (body.color !== undefined) set('color', colorOrNull(body.color));
    if (body.icon !== undefined) set('icon', icons.validateChoice(catalog, body.icon, { current: t.icon || null }));
    if (body.retired !== undefined) {
      const retired = fields.bool(body.retired, 'Retired');
      if (t.system && retired) throw badRequest('A built-in account type cannot be retired — a workspace always keeps its basic set available.', 'system_type_locked');
      set('retired', retired);
    }
    if (body.accountingClass !== undefined && body.accountingClass !== t.accountingClass) {
      if (t.system) throw badRequest('A built-in account type\'s own accounting behaviour can never change.', 'system_type_locked');
      const usage = accountTypes.usageCount(doc, t.id);
      if (usage > 0) {
        throw conflict(`This type is already used by ${usage} account${usage === 1 ? '' : 's'}. Changing its underlying accounting behaviour would silently reinterpret their history, so it is refused — create a new type instead.`, 'account_type_in_use');
      }
      set('accountingClass', fields.oneOf(body.accountingClass, ledger.ACCOUNT_TYPES, 'Accounting class'));
    }
    if (changes.length) {
      t.history = [...(t.history || []), { at: nowIso, by: member.subject, changes }];
      audit.record(doc, { actor: member.subject, action: 'account-type.update', targetType: 'account-type', targetId: t.id, at: nowIso, fields: changes.map((c) => c.field) });
    }
    return { type: accountTypes.view(doc, t) };
  });
  return { body: result };
}

// Permanent deletion (BT-023): a built-in type can never be permanently deleted (mirrors "can never
// be retired"); a custom type in use is never blocked — every account carrying it is severed
// (`accountTypeId` reset to null), never removed, since the link is only an optional label.
const permanentRoutes = deletion.makeRoutes({
  type: 'account-type', idField: 'typeId',
  find: (doc, id, ctx) => accountTypes.findEffectiveType(doc, id, ctx.nowIso()),
  authorize: (doc, member) => { if (!mayManage(doc, member)) throw forbidden('Only owners and managers can change account types in this workspace.'); },
});

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'delete-impact') return permanentRoutes.impactRoute(ctx, req);
  if (action === 'delete-permanent') return permanentRoutes.permanentRoute(ctx, req);
  if (action !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: list, POST: post, PATCH: patch };
