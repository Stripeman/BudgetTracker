'use strict';
// The workspace document shape (schema v1) and member projections.
const { newId } = require('./ids');
const { stampDocument } = require('./schema');
const audit = require('./audit');

const KINDS = Object.freeze(['personal', 'household', 'group', 'trip']);

const DEFAULT_CATEGORIES = [
  ['Housing', 'expense'], ['Utilities', 'expense'], ['Groceries', 'expense'], ['Dining', 'expense'],
  ['Transport', 'expense'], ['Health', 'expense'], ['Insurance', 'expense'], ['Entertainment', 'expense'],
  ['Shopping', 'expense'], ['Travel', 'expense'], ['Education', 'expense'], ['Gifts and donations', 'expense'],
  ['Fees and charges', 'expense'], ['Interest', 'expense'], ['Salary', 'income'], ['Other income', 'income'],
  ['Uncategorized', 'expense'],
];

function newWorkspaceDoc({ id, name, kind, currency, principal, nowIso }) {
  const doc = {
    id, name, kind, status: 'active', createdAt: nowIso, createdBy: principal.subject, updatedAt: nowIso, revision: 1,
    settings: { reportingCurrency: currency, budgetPeriod: 'monthly', weekStart: 1 },
    members: [{ id: newId('mem'), subject: principal.subject, email: principal.email, name: principal.name || '', role: 'owner', status: 'active', joinedAt: nowIso }],
    invitations: [], grants: [], contacts: [], accounts: [], payees: [],
    categories: DEFAULT_CATEGORIES.map(([n, t]) => ({ id: newId('cat'), name: n, type: t, parentId: null, archived: false })),
    transactions: [], audit: [], idempotency: {},
  };
  audit.record(doc, { actor: principal.subject, action: 'workspace.create', targetType: 'workspace', targetId: id, at: nowIso });
  return stampDocument('workspace', doc);
}

const activeMembers = (doc) => (doc.members || []).filter((m) => m.status === 'active');
const activeOwners = (doc) => activeMembers(doc).filter((m) => m.role === 'owner');
const findMember = (doc, memberId) => (doc.members || []).find((m) => m.id === memberId) || null;
const memberBySubject = (doc, subject) => (doc.members || []).find((m) => m.subject === subject) || null;

function summary(doc, member) {
  return {
    id: doc.id, name: doc.name, kind: doc.kind, status: doc.status, role: member.role,
    reportingCurrency: doc.settings && doc.settings.reportingCurrency, revision: doc.revision,
    memberCount: activeMembers(doc).length, archivedAt: doc.archivedAt || null,
  };
}

// Members see each other's names and roles. Email addresses are shown only to the person
// themselves and to managers/owners, who administer membership by email.
function memberView(m, viewer) {
  const out = { id: m.id, name: m.name || 'Member', role: m.role, status: m.status, joinedAt: m.joinedAt || null };
  if (m.subject === viewer.subject) out.self = true;
  if (out.self || viewer.role === 'owner' || viewer.role === 'manager') out.email = m.email;
  return out;
}

module.exports = { KINDS, newWorkspaceDoc, activeMembers, activeOwners, findMember, memberBySubject, summary, memberView };
