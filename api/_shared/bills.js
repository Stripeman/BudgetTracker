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
// OCCURRENCE STATES: recorded (an entry exists) > skipped (explicitly, with a reason) > paused (inside
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

const isPaused = (bill, date) => (bill.pauses || []).some((p) => p.from <= date && (!p.until || date <= p.until));
const isSkipped = (bill, date) => (bill.skips || []).some((s) => s.date === date);
const trackStart = (bill) => (bill.trackFrom && bill.trackFrom > bill.schedule.startDate ? bill.trackFrom : bill.schedule.startDate);

// "<recurringId>|<occurrence>" -> transaction id, for every live entry recorded from a bill.
function recordedSet(doc) {
  const out = new Map();
  for (const t of doc.transactions || []) {
    if (!t.deletedAt && t.links && t.links.recurringId && t.links.occurrence) out.set(`${t.links.recurringId}|${t.links.occurrence}`, t.id);
  }
  return out;
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
  BILL_TYPES, KINDS, AMOUNT_TYPES, defaultKind, signed, termsAt, isPaused, isSkipped, trackStart,
  recordedSet, occurrenceStatus, dueBetween, overdue, reminders,
};
