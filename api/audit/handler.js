'use strict';
// /api/audit?workspaceId=&limit=&before=
// Audit history filtered by the same authorization as the records it describes: account events
// only for people who can see that account, personal events only for that person. Actors are
// shown by member name, never by provider subject. Entries contain no financial values.
const { query } = require('../_shared/http');
const { requireId } = require('../_shared/ids');
const { capabilitiesFor } = require('../_shared/authz');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  const now = ctx.now();
  const accounts = new Map((doc.accounts || []).map((a) => [a.id, a]));
  const visible = (entry) => {
    const scope = String(entry.scope || 'members');
    if (scope === 'members') return true;
    if (scope === 'managers') return member.role === 'owner' || member.role === 'manager';
    if (scope.startsWith('self:')) return scope.slice(5) === ctx.principal.subject;
    if (scope.startsWith('account:')) {
      const account = accounts.get(scope.slice(8));
      return !!account && capabilitiesFor(doc, ctx.principal, account, now).size > 0;
    }
    return false;
  };
  const limit = Math.min(Math.max(parseInt(query(req, 'limit') || '100', 10) || 100, 1), 500);
  const before = query(req, 'before');
  const entries = (doc.audit || []).filter(visible).filter((e) => !before || e.at < before)
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
    .map((e) => {
      const m = model.memberBySubject(doc, e.actor);
      return { id: e.id, at: e.at, action: e.action, targetType: e.targetType, targetId: e.targetId, fields: e.fields || [], actor: m ? (m.name || 'Member') : 'Former member', actorSelf: e.actor === ctx.principal.subject };
    });
  return { body: { entries } };
}

module.exports = { GET: list };
