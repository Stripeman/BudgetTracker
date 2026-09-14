'use strict';
// Recurring costs and bills (BT-008-02): the occurrence model shared by the bills API, budgets and
// the cash-flow forecast.
//
// TERMS ARE VERSIONED. A bill's amount, amount type, category, payee and responsible person live in
// `versions`, each with an `effectiveFrom` date; an occurrence uses the latest version effective on
// its date. A change never edits an earlier version, and a recorded occurrence is an independent
// transaction (linked by links.recurringId + links.occurrence), so editing a bill can never rewrite
// what was already recorded.
//
// OCCURRENCE STATES: recorded (a live entry exists and has not been reversed) > skipped (explicitly, with a reason) > paused (inside
// a pause range) > due. Only "due" occurrences are forecast, committed in budgets, reminded about or
// reported overdue. Overdue = due, before today, and on/after the bill's tracking start (so creating a
// bill with a start date in the past does not flood the person with "missed" items they already paid).
const schedule = require('./schedule');

const BILL_TYPES = Object.freeze(['housing', 'utilities', 'subscription', 'insurance', 'debt-payment', 'membership', 'income', 'savings', 'custom']);
const KINDS = Object.freeze(['expense', 'income', 'fee', 'interest', 'transfer']);
const AMOUNT_TYPES = Object.freeze(['fixed', 'variable']);

function defaultKind(billType, toAccountId) {
  if (toAccountId) return 'transfer';
  return billType === 'income' ? 'income' : 'expense';
}

// Signed amount of one occurrence on the SOURCE account (a transfer leaves the source account).
const signed = (kind, magnitude) => (kind === 'income' ? magnitude : -magnitude);

// The version effective on `date`: the one with the latest effectiveFrom not after the date; among
// versions with the same effectiveFrom the most recently added wins.
function termsAt(bill, date) {
  let chosen = bill.versions[0];
  for (const v of bill.versions) if (v.effectiveFrom <= date && v.effectiveFrom >= chosen.effectiveFrom) chosen = v;
  return chosen;
}

// Skip and pause records are never edited or removed (BT-001-05): undoing a skip marks it
// withdrawn, and a resume is its own record from which the effective pause range is derived.
const activeSkips = (bill) => (bill.skips || []).filter((s) => !s.withdrawnAt);
function effectivePauses(bill) {
  const out = [];
  for (const p of bill.pauses || []) {
    const resumed = (bill.resumes || []).filter((r) => r.pauseId === p.id).map((r) => r.date).sort();
    if (!resumed.length) { out.push(p); continue; }
    const end = schedule.addDays(resumed[0], -1);
    if (end < p.from) continue;
    out.push({ ...p, until: p.until && p.until < end ? p.until : end });
  }
  return out;
}
const isPaused = (bill, date) => effectivePauses(bill).some((p) => p.from <= date && (!p.until || date <= p.until));
const isSkipped = (bill, date) => activeSkips(bill).some((s) => s.date === date);
const trackStart = (bill) => (bill.trackFrom && bill.trackFrom > bill.schedule.startDate ? bill.trackFrom : bill.schedule.startDate);

// A recording counts while it is live and not cancelled by a live reversal (FIN-R4): reversing a
// payment recorded by mistake reopens the occurrence, so it is owed, forecast and committed again
// and can be skipped. "Recorded once" holds among live, unreversed entries.
function recordingCounts(t, byId) {
  if (t.deletedAt || !t.links || !t.links.recurringId || !t.links.occurrence) return false;
  const reversal = t.reversedBy ? byId.get(t.reversedBy) : null;
  return !(reversal && !reversal.deletedAt);
}

// "<recurringId>|<occurrence>" -> transaction id, for every live, unreversed entry recorded from a bill.
function recordedSet(doc) {
  const byId = new Map((doc.transactions || []).map((t) => [t.id, t]));
  const out = new Map();
  for (const t of doc.transactions || []) {
    if (recordingCounts(t, byId)) out.set(`${t.links.recurringId}|${t.links.occurrence}`, t.id);
  }
  return out;
}

// Every live entry recorded for one occurrence, including one whose recording was reversed.
function liveRecordings(doc, billId, occurrence) {
  return (doc.transactions || []).filter((t) => !t.deletedAt && t.links && t.links.recurringId === billId && t.links.occurrence === occurrence);
}

// THE one rule for whether a bill's accounts can take its payments (FIN-R9). A bill whose source
// account, or a transfer's destination, is closed or removed cannot be recorded (account_closed),
// so it is left out of forecasts, budget commitments, the next-30-days total, overdue and due-soon
// items, and the Bills page shows it as needing attention instead. Returns null or the reason.
function accountIssue(doc, bill) {
  const find = (id) => (doc.accounts || []).find((a) => a.id === id);
  const source = find(bill.accountId);
  if (!source || source.deletedAt) return 'account_missing';
  if (source.status === 'closed') return 'account_closed';
  if (bill.kind === 'transfer') {
    const dest = find(bill.toAccountId);
    if (!dest || dest.deletedAt) return 'destination_missing';
    if (dest.status === 'closed') return 'destination_closed';
  }
  return null;
}

function occurrenceStatus(bill, date, recorded) {
  if (recorded.has(`${bill.id}|${date}`)) return 'recorded';
  if (isSkipped(bill, date)) return 'skipped';
  if (isPaused(bill, date)) return 'paused';
  return 'due';
}

function dueBetween(bill, from, to, recorded) {
  if (bill.deletedAt || to < from) return [];
  return schedule.occurrences(bill.schedule, from, to).filter((d) => occurrenceStatus(bill, d, recorded) === 'due');
}

function overdue(bill, today, recorded) {
  return dueBetween(bill, trackStart(bill), schedule.addDays(today, -1), recorded);
}

function reminders(bill, today, recorded) {
  return dueBetween(bill, today, schedule.addDays(today, bill.reminderDays || 0), recorded);
}

module.exports = {
  BILL_TYPES, KINDS, AMOUNT_TYPES, defaultKind, signed, termsAt, isPaused, isSkipped, activeSkips, effectivePauses, trackStart,
  recordingCounts, recordedSet, liveRecordings, accountIssue, occurrenceStatus, dueBetween, overdue, reminders,
};
