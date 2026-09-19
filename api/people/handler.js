'use strict';
// /api/people?workspaceId=&field=
// Options for the searchable people selectors: payee, paidBy, participant, responsible,
// reimbursement, tripMember. New members and contacts appear here immediately. Every option has
// a stable typed reference and a type label. Private contacts are marked privateOnly — they can
// be chosen only on the caller's private records.
const { query } = require('../_shared/http');
const { requireId } = require('../_shared/ids');
const { readDocument } = require('../_shared/schema');
const { visibleTransactions } = require('../_shared/authz');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');
const ledger = require('../_shared/ledger');
const fields = require('../_shared/fields');

const FIELDS = ['payee', 'paidBy', 'participant', 'responsible', 'reimbursement', 'tripMember'];

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const field = fields.oneOf(query(req, 'field'), FIELDS, 'Field', 'participant');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const { value } = await ctx.storage.getJson(store.paths.user(ctx.principal.subject));
  const user = readDocument('user', value) || { contacts: [] };
  const options = [];
  if (field === 'payee') {
    // Closed merchants are not offered for new entries (BT-007-01); their history is unaffected.
    for (const p of ledger.visiblePayees(doc, ctx.principal, visibleTransactions(doc, ctx.principal, ctx.now()))) {
      if ((p.status || 'active') === 'closed') continue;
      // Aliases only for merchants the caller fully sees (security review SEC-B8).
      const full = p.visibility === 'shared' || p.ownerSubject === ctx.principal.subject;
      options.push({ ref: `payee:${p.id}`, label: p.name, type: 'payee', typeLabel: 'Payee', hint: full ? (p.aliases || []).join(', ') : '' });
    }
  }
  for (const m of model.activeMembers(doc)) {
    options.push({ ref: `member:${m.id}`, label: m.name || 'Member', type: 'member', typeLabel: 'Member', self: m.subject === ctx.principal.subject });
  }
  // BT-009-15: a contact who has joined as a member is not offered here either — the relationship
  // for anything NEW is the member they are now, not the contact they were (their own member entry
  // above already covers them); their past records keep naming the contact regardless (BT-001-05).
  for (const c of doc.contacts || []) {
    if (!c.deletedAt && !c.joinedMemberId) options.push({ ref: `contact:${c.id}`, label: c.name, type: 'contact', typeLabel: 'Contact', hint: c.kind === 'business' ? 'Business' : '' });
  }
  for (const c of user.contacts || []) {
    if (!c.deletedAt) options.push({ ref: `pcontact:${c.id}`, label: c.name, type: 'private-contact', typeLabel: 'Private contact', privateOnly: true });
  }
  return {
    body: {
      field, options,
      note: field === 'paidBy' ? 'Choosing who paid records the payer. It does not give them access or debit their account.' : undefined,
    },
  };
}

module.exports = { GET: list };
