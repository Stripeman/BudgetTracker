'use strict';
// /api/workspaces — the tenant boundary.
//   GET              list the caller's workspaces (derived index, re-verified per workspace)
//   GET ?id=         one workspace
//   POST             create (Idempotency-Key supported); the creator becomes its owner
//   PATCH ?id=       rename / shared settings (owner or manager)
//   DELETE ?id=      archive (owner) — shown as "Delete workspace"; recoverable, never a permanent delete.
//                    Nobody reaches an archived workspace until an owner brings it back (store.loadWorkspace).
//   POST ?id=&action=restore   unarchive (owner) — "Bring back" under Deleted workspaces in My settings
const { readBody, query, header, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId, isIdempotencyKey } = require('../_shared/ids');
const { PreconditionFailed } = require('../_shared/storage');
const { readDocument } = require('../_shared/schema');
const { roleAtLeast, activeMember } = require('../_shared/authz');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');
const fields = require('../_shared/fields');
const money = require('../_shared/money');
const audit = require('../_shared/audit');
const groups = require('../_shared/groups');
const workspaceSettings = require('../_shared/workspace-settings');
const siteSettings = require('../_shared/site');

async function list(ctx) {
  const user = await store.ensureUser(ctx);
  const out = [];
  for (const id of user.workspaceIds || []) {
    const { value } = await ctx.storage.getJson(store.paths.workspace(id));
    const doc = readDocument('workspace', value);
    const member = doc && activeMember(doc, ctx.principal);
    if (model.listed(doc, member)) out.push(model.summary(doc, member));
  }
  return { body: { workspaces: out } };
}

// Owners and managers also see the workspace's change history and lifecycle (BT-001-05, B16).
async function get(ctx, req) {
  const id = query(req, 'id');
  if (!id) return list(ctx);
  const { doc, etag, member } = await store.loadWorkspace(ctx, id);
  // Every workspace setting from the one list, with whether this member may change it (Terry,
  // 2026-09-14). Values only; nothing financial.
  const { site } = await siteSettings.readSite(ctx.storage);
  const workspace = { ...model.summary(doc, member), settings: doc.settings, settingsList: workspaceSettings.view(doc, member, site) };
  const names = new Map((doc.members || []).map((m) => [m.subject, m.name || 'Member']));
  // Every member reads the settings history — who, when, from, to and why, settings only; no name or
  // lifecycle changes, nothing financial (UX review of eefd115, decision 6).
  workspace.settingsHistory = (doc.history || [])
    .map((h) => ({ at: h.at, by: names.get(h.by) || 'Former member', changes: (h.changes || []).filter((c) => c && typeof c.field === 'string' && c.field.startsWith('settings.')), reason: h.reason || '' }))
    .filter((h) => h.changes.length);
  if (roleAtLeast(member.role, 'manager')) {
    const named = (list) => (list || []).map((h) => ({ ...h, by: names.get(h.by) || 'Former member' }));
    workspace.history = named(doc.history);
    workspace.lifecycle = named(doc.lifecycle);
  }
  return { body: { workspace, etag }, headers: { ETag: etag } };
}

function addLifecycle(doc, entry) {
  doc.lifecycle = [...(doc.lifecycle || []), entry];
}

async function create(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['name', 'kind', 'reportingCurrency']);
  const name = fields.text(body.name, { field: 'Name', max: 80, required: true });
  const kind = fields.oneOf(body.kind, model.KINDS, 'Kind', 'household');
  const currency = body.reportingCurrency || 'EUR';
  money.precisionOf(currency);
  const key = header(req, 'idempotency-key');
  if (key !== null && !isIdempotencyKey(key)) throw badRequest('The Idempotency-Key header is not valid.', 'invalid_idempotency_key');

  // A retried request replays its first result even at the limit; a new one is bounded (SEC-R5).
  const existing = await store.ensureUser(ctx);
  if (!(key && existing.idempotency && existing.idempotency[`ws|${key}`])) await store.assertCanCreateWorkspace(ctx);
  // Reserve the id in the creator's own document first, so a retried request with the same key
  // converges on one workspace instead of creating two.
  const wsId = await store.mutateUser(ctx, (user) => {
    if (!user.idempotency || typeof user.idempotency !== 'object') user.idempotency = {};
    if (key && user.idempotency[`ws|${key}`]) return user.idempotency[`ws|${key}`].id;
    const id = newId('ws');
    store.recordCreation(ctx, user, id);
    if (key) user.idempotency[`ws|${key}`] = { id, at: ctx.nowIso() };
    return id;
  });
  // The owner's name comes from their profile when the provider sent none (the API never receives it).
  const owner = { subject: ctx.principal.subject, email: ctx.principal.email, name: ctx.principal.name || existing.name || '' };
  const doc = model.newWorkspaceDoc({ id: wsId, name, kind, currency, principal: owner, nowIso: ctx.nowIso() });
  try {
    await ctx.storage.putJson(store.paths.workspace(wsId), doc, { ifNoneMatch: '*' });
  } catch (e) {
    if (!(e instanceof PreconditionFailed)) throw e;
  }
  await store.mutateUser(ctx, (user) => {
    if ((user.workspaceIds || []).includes(wsId)) return undefined;
    user.workspaceIds = [...(user.workspaceIds || []), wsId];
    return true;
  });
  const { doc: saved, member } = await store.loadWorkspace(ctx, wsId);
  return { status: 201, body: { workspace: model.summary(saved, member) } };
}

async function patch(ctx, req) {
  const id = requireId(query(req, 'id'), 'id');
  const body = fields.onlyKeys(readBody(req), ['name', 'settings', 'reason']);
  const { result } = await store.mutateWorkspace(ctx, id, (doc, member) => {
    if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can change workspace settings.');
    const changed = [];
    const changes = [];
    // Records before and after for each real change (audit B16).
    const set = (field, from, to, apply) => { if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) return; apply(); changed.push(field); changes.push({ field, from: from ?? null, to: to ?? null }); };
    if (body.name !== undefined) { const v = fields.text(body.name, { field: 'Name', max: 80, required: true }); set('name', doc.name, v, () => { doc.name = v; }); }
    if (body.settings !== undefined) {
      if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) throw badRequest('Send the settings to change.', 'invalid_field');
      const { reportingCurrency, ...policy } = body.settings;
      const s = { reportingCurrency };
      // Every other key is a workspace setting from the one list (api/_shared/workspace-settings.js):
      // unknown keys and values that are not allowed are refused, a key the member may not change is
      // refused naming who may, and each real change is kept below with before and after values.
      const parsed = Object.keys(policy).length ? workspaceSettings.parseChanges(policy) : {};
      if (!doc.settings || typeof doc.settings !== 'object' || Array.isArray(doc.settings)) doc.settings = {};
      if (s.reportingCurrency !== undefined) {
        money.precisionOf(s.reportingCurrency);
        // New shared expenses use the reporting currency, so it cannot change while anyone's shared
        // balance is open: that balance would be left in a currency the group no longer uses
        // (financial review finding 3). Confirmed payments only, like the balances themselves.
        const open = s.reportingCurrency !== doc.settings.reportingCurrency ? groups.openCurrencies(doc) : [];
        if (open.length) throw conflict(`Shared expenses are not settled up in ${open.join(', ')}. Settle up first, then change the reporting currency.`, 'group_balances_open');
        set('settings.reportingCurrency', doc.settings.reportingCurrency, s.reportingCurrency, () => { doc.settings.reportingCurrency = s.reportingCurrency; });
      }
      for (const c of workspaceSettings.changesFor(doc, parsed, member)) set(`settings.${c.key}`, c.from, c.to, () => { doc.settings[c.key] = c.to; });
    }
    if (!changed.length) return undefined;
    doc.history = [...(doc.history || []), { at: ctx.nowIso(), by: member.subject, changes, reason: fields.text(body.reason, { field: 'Reason', max: 200 }) }];
    audit.record(doc, { actor: member.subject, action: 'workspace.update', targetType: 'workspace', targetId: doc.id, at: ctx.nowIso(), fields: changed });
    return { workspace: model.summary(doc, member) };
  }, { expectedEtag: header(req, 'if-match') || undefined });
  if (!result) { const { doc, member } = await store.loadWorkspace(ctx, id); return { body: { workspace: model.summary(doc, member) } }; }
  return { body: result };
}

async function archive(ctx, req) {
  const id = requireId(query(req, 'id'), 'id');
  const body = fields.onlyKeys(readBody(req), ['reason']);
  const { result } = await store.mutateWorkspace(ctx, id, (doc, member) => {
    if (member.role !== 'owner') throw forbidden('Only an owner can archive a workspace.');
    if (doc.status === 'archived') return { workspace: model.summary(doc, member) };
    doc.status = 'archived';
    doc.archivedAt = ctx.nowIso();
    addLifecycle(doc, { at: doc.archivedAt, by: member.subject, state: 'archived', reason: fields.text(body.reason, { field: 'Reason', max: 200 }) });
    audit.record(doc, { actor: member.subject, action: 'workspace.archive', targetType: 'workspace', targetId: doc.id, at: ctx.nowIso() });
    return { workspace: model.summary(doc, member) };
  }, { allowHeadroom: true, archived: true });
  return { body: result };
}

async function post(ctx, req) {
  if (query(req, 'action') === 'restore') {
    const id = requireId(query(req, 'id'), 'id');
    const body = fields.onlyKeys(readBody(req), ['reason']);
    // Unarchiving counts toward the creator's active-workspace limit like creating one (SEC-T4).
    const { doc: current } = await store.loadWorkspace(ctx, id, { archived: true });
    if (current.status === 'archived' && current.createdBy === ctx.principal.subject) await store.assertCanCreateWorkspace(ctx, { restoring: true });
    const { result } = await store.mutateWorkspace(ctx, id, (doc, member) => {
      if (member.role !== 'owner') throw forbidden('Only an owner can restore a workspace.');
      if (doc.status !== 'archived') return { workspace: model.summary(doc, member) };
      // The archive period stays in the lifecycle; only the current state changes (audit B16).
      addLifecycle(doc, { at: ctx.nowIso(), by: member.subject, state: 'active', reason: fields.text(body.reason, { field: 'Reason', max: 200 }) });
      doc.status = 'active';
      doc.archivedAt = null;
      audit.record(doc, { actor: member.subject, action: 'workspace.restore', targetType: 'workspace', targetId: doc.id, at: ctx.nowIso() });
      return { workspace: model.summary(doc, member) };
    }, { archived: true });
    return { body: result };
  }
  if (query(req, 'action') !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: get, POST: post, PATCH: patch, DELETE: archive };
