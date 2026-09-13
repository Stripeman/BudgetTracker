'use strict';
// Ledger-entry helpers shared by every route that writes entries (BT-006, BT-001-05). Moved here
// from api/transactions/handler.js so the shared-expense route (BT-009) creates and reverses entries
// with exactly the same mechanics instead of a copy.
//
// Nothing is ever overwritten: every change keeps who, when and (for corrections) why; an entry is
// corrected by a REVERSAL — a new entry of the same kind, account, category and merchant with the
// opposite amount, linked both ways — never by editing or erasing it.
const { newId } = require('./ids');

// Never truncated (BT-001-05); growth is bounded by the member quota and the document cap.
function history(t, by, at, changed) {
  t.history = [...(t.history || []), { revision: t.revision, at, by, fields: changed }];
}

function amend(t, by, at, reason, changes) {
  t.amendments = [...(t.amendments || []), { revision: t.revision, at, by, reason: reason || '', changes }];
}

// Adds the reversal of `t` to the document and marks `t` as reversed. The caller checks permission,
// closed accounts and the other rules first, and records the audit entries in the same write.
// `date` defaults to the entry's own date so the pair nets out in the same budget period (FIN-T4).
// `links` adds traceability links (for example the shared expense it came from) beside `reverses`.
function reverseEntry(doc, t, { by, at, reason, date = null, links = {} }) {
  const rev = {
    id: newId('txn'), accountId: t.accountId, kind: t.kind, amountMinor: -t.amountMinor, currency: t.currency,
    payeeId: t.payeeId || null, categoryId: t.categoryId || null, splits: (t.splits || []).map((s) => ({ ...s, amountMinor: -s.amountMinor })),
    responsibleRef: t.responsibleRef || null, original: null, transferId: null, counterpartAccountId: null,
    date: date || t.date, postedDate: null, status: 'pending', tags: [...(t.tags || [])],
    notes: `Reversal: ${reason}`, links: { ...links, reverses: t.id }, createdBy: by, createdAt: at, revision: 1, deletedAt: null,
  };
  history(rev, by, at, ['create', 'reversal']);
  t.reversedBy = rev.id;
  t.revision += 1;
  t.updatedAt = at;
  amend(t, by, at, reason, [{ field: 'reversedBy', from: null, to: rev.id }]);
  doc.transactions = [...(doc.transactions || []), rev];
  return rev;
}

// A plain single-account entry (no merchant, splits or transfer), for entries another record causes
// — a shared expense recorded on the payer's own account (BT-009). `amountMinor` is already signed.
function newEntry({ accountId, currency, kind, amountMinor, date, categoryId = null, notes = '', links = {}, by, at }) {
  const t = {
    id: newId('txn'), accountId, kind, amountMinor, currency, payeeId: null, categoryId, splits: [],
    responsibleRef: null, original: null, transferId: null, counterpartAccountId: null,
    date, postedDate: null, status: 'pending', tags: [], notes, links, createdBy: by, createdAt: at, revision: 1, deletedAt: null,
  };
  history(t, by, at, ['create']);
  return t;
}

module.exports = { history, amend, reverseEntry, newEntry };
