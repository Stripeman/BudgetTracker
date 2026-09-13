'use strict';
// /api/workspaces — the tenant boundary.
//   GET              list the caller's workspaces (derived index, re-verified per workspace)
//   GET ?id=         one workspace
//   POST             create (Idempotency-Key supported); the creator becomes its owner
//   PATCH ?id=       rename / shared settings (owner or manager)
//   DELETE ?id=      archive (owner) — recoverable, never a permanent delete
//   POST ?id=&action=restore   unarchive (owner)
const { readBody, query, header, badRequest, forbidden, notFound } = require('../_shared/http');
const { newId, requireId, isIdempotencyKey } = require('../_shared/ids');
const { PreconditionFailed } = require('../_shared/storage');
const { readDocument } = require('../_shared/schema');
const { roleAtLeast, activeMember } = require('../_shared/authz');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');
const fields = require('../_shared/fields');
const money = require('../_shared/money');
const audit = require('../_shared/audit');

async function list(ctx) {
  const user = await store.ensureUser(ctx);
  const out = [];
  for (const id of user.workspaceIds || []) {
    const { value } = await ctx.storage.getJson(store.paths.workspace(id));
    const doc = readDocument('workspace', value);
    const member = doc && activeMember(doc, ctx.principal);
    if (member) out.push(model.summary(doc, member));
  }
  return { body: { workspaces: out } };
}

async function get(ctx, req) {
  const id = query(req, 'id');
  if (!id) return list(ctx);
  const { doc, etag, member } = await store.loadWorkspace(ctx, id);
  return { body: { workspace: { ...model.summary(doc, member), settings: doc.settings }, etag }, headers: { ETag: etag } };
}

async function create(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['name', 'kind', 'reportingCurrency']);
  const name = fields.text(body.name, { field: 'Name', max: 80, required: true });
  const kind = fields.oneOf(body.kind, model.KINDS, 'Kind', 'household');
  const currency = body.reportingCurrency || 'EUR';
  money.precisionOf(currency);
  const key = header(req, 'idempotency-key');
  if (key !== null && !isIdempotencyKey(key)) throw badRequest('The Idempotency-Key header is not valid.', 'invalid_idempotency_key');

  // Reserve the id in the creator's own document first, so a retried request with the same key
  // converges on one workspace instead of creating two.
  const wsId = await store.mutateUser(ctx, (user) => {
    if (!user.idempotency || typeof user.idempotency !== 'object') user.idempotency = {};
    if (key && user.idempotency[`ws|${key}`]) return user.idempotency[`ws|${key}`].id;
    const id = newId('ws');
    if (key) user.idempotency[`ws|${key}`] = { id, at: ctx.nowIso() };
    return id;
  });
  const doc = model.newWorkspaceDoc({ id: wsId, name, kind, currency, principal: ctx.principal, nowIso: ctx.nowIso() });
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
  const body = fields.onlyKeys(readBody(req), ['name', 'settings']);
  const { result } = await store.mutateWorkspace(ctx, id, (doc, member) => {
    if (!roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can change workspace settings.');
    const changed = [];
    if (body.name !== undefined) { doc.name = fields.text(body.name, { field: 'Name', max: 80, required: true }); changed.push('name'); }
    if (body.settings !== undefined) {
      const s = fields.onlyKeys(body.settings || {}, ['reportingCurrency', 'budgetPeriod', 'weekStart']);
      if (s.reportingCurrency !== undefined) { money.precisionOf(s.reportingCurrency); doc.settings.reportingCurrency = s.reportingCurrency; changed.push('settings.reportingCurrency'); }
      if (s.budgetPeriod !== undefined) { doc.settings.budgetPeriod = fields.oneOf(s.budgetPeriod, ['weekly', 'biweekly', 'monthly', 'custom'], 'Budget period'); changed.push('settings.budgetPeriod'); }
      if (s.weekStart !== undefined) { if (![0, 1, 6].includes(s.weekStart)) throw badRequest('Week start must be 0, 1 or 6.', 'invalid_field'); doc.settings.weekStart = s.weekStart; changed.push('settings.weekStart'); }
    }
    if (!changed.length) return undefined;
    audit.record(doc, { actor: member.subject, action: 'workspace.update', targetType: 'workspace', targetId: doc.id, at: ctx.nowIso(), fields: changed });
    return { workspace: model.summary(doc, member) };
  }, { expectedEtag: header(req, 'if-match') || undefined });
  if (!result) { const { doc, member } = await store.loadWorkspace(ctx, id); return { body: { workspace: model.summary(doc, member) } }; }
  return { body: result };
}

async function archive(ctx, req) {
  const id = requireId(query(req, 'id'), 'id');
  const { result } = await store.mutateWorkspace(ctx, id, (doc, member) => {
    if (member.role !== 'owner') throw forbidden('Only an owner can archive a workspace.');
    if (doc.status === 'archived') return { workspace: model.summary(doc, member) };
    doc.status = 'archived';
    doc.archivedAt = ctx.nowIso();
    audit.record(doc, { actor: member.subject, action: 'workspace.archive', targetType: 'workspace', targetId: doc.id, at: ctx.nowIso() });
    return { workspace: model.summary(doc, member) };
  }, { allowHeadroom: true });
  return { body: result };
}

async function post(ctx, req) {
  if (query(req, 'action') === 'restore') {
    const id = requireId(query(req, 'id'), 'id');
    const { result } = await store.mutateWorkspace(ctx, id, (doc, member) => {
      if (member.role !== 'owner') throw forbidden('Only an owner can restore a workspace.');
      if (doc.status !== 'archived') return { workspace: model.summary(doc, member) };
      doc.status = 'active';
      doc.archivedAt = null;
      audit.record(doc, { actor: member.subject, action: 'workspace.restore', targetType: 'workspace', targetId: doc.id, at: ctx.nowIso() });
      return { workspace: model.summary(doc, member) };
    });
    return { body: result };
  }
  if (query(req, 'action') !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: get, POST: post, PATCH: patch, DELETE: archive };
