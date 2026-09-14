'use strict';
// Workspace audit history. DEPARTURE FROM TASKTRACKER: audit is NOT best-effort. Entries are
// appended to the workspace document inside the same ETag-guarded write as the change they
// describe, so a change and its audit record commit together or not at all.
//
// Entries hold who, what action, which record and when — never amounts, balances, notes or
// other financial content. Each entry carries a `scope` so the audit view applies the same
// authorization as the records themselves:
//   'members'        membership/workspace events every active member may see
//   'account:<id>'   visible only to people who can view that account
//   'self:<subject>' visible only to that person (e.g. their own preference/grant events)
const { newId } = require('./ids');

const ACTION_RE = /^[a-z][a-z0-9.-]{1,60}$/;

function record(doc, { actor, action, targetType, targetId, scope, at, fields }) {
  if (!ACTION_RE.test(action)) throw new Error('Invalid audit action');
  if (!Array.isArray(doc.audit)) doc.audit = [];
  const entry = { id: newId('aud'), at, actor, action, targetType: targetType || null, targetId: targetId || null, scope: scope || 'members' };
  // Field NAMES only — which fields changed, never their values.
  if (Array.isArray(fields) && fields.length) entry.fields = fields.filter((f) => typeof f === 'string');
  doc.audit.push(entry);
  return entry;
}

module.exports = { record };
