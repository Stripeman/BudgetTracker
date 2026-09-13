'use strict';
// Budgets and cash-flow forecasting (BT-008-01). Everything here is computed ON READ from the
// ledger and the bills — no stored totals that could drift — and every figure is exact integer
// minor units.
//
// DOUBLE-COUNTING RULE: a bill occurrence is "committed" only while it is due (not recorded, skipped
// or paused). Once recorded it is an actual entry and no longer committed, so availability does not
// change when a bill becomes real. Overdue occurrences in the current period stay committed: they
// are still owed.
//
// PRIVACY: shared budgets count only SHARED accounts (every member sees the same figures and no
// private spending leaks into them); a private budget counts the accounts its owner may see.
// Forecasts use only accounts whose balance the viewer may see, and include upcoming items only
// where the viewer may also see transactions.
const money = require('./money');
const schedule = require('./schedule');
const ledger = require('./ledger');
const bills = require('./bills');
const { can } = require('./authz');

// ---- periods --------------------------------------------------------------------------------
// Monthly periods start on the anchor's day of month (clamped); weekly and biweekly periods are
// aligned to the anchor date. Returns inclusive { start, end } containing `day`.
function periodFor(budget, day) {
  const anchor = budget.startDate;
  if (budget.period === 'monthly') {
    const dom = Number(anchor.slice(8, 10));
    let start = schedule.addMonthsClamped(day.slice(0, 8) + '01', 0, dom);
    if (start > day) start = schedule.addMonthsClamped(start, -1, dom);
    const next = schedule.addMonthsClamped(start, 1, dom);
    return { start, end: schedule.addDays(next, -1) };
  }
  const len = budget.period === 'biweekly' ? 14 : 7;
  const offset = schedule.daysBetween(anchor, day);
  const k = Math.floor(offset / len);
  const start = schedule.addDays(anchor, k * len);
  return { start, end: schedule.addDays(start, len - 1) };
}

function previousPeriod(budget, period) {
  return periodFor(budget, schedule.addDays(period.start, -1));
}

// A budget's plan (period, anchor and lines) is versioned from a date (audit B13): each period is
// measured against the plan in force on that date, so changing a plan never rewrites how earlier
// periods went. Budgets from before versioning have one implicit version.
function budgetTermsAt(budget, date) {
  const versions = budget.versions && budget.versions.length
    ? budget.versions
    : [{ effectiveFrom: budget.startDate, period: budget.period, startDate: budget.startDate, lines: budget.lines }];
  let chosen = versions[0];
  for (const v of versions) if (v.effectiveFrom <= date && v.effectiveFrom >= chosen.effectiveFrom) chosen = v;
  return chosen;
}

// ---- scope ------------------------------------------------------------------------------------
function scopeAccounts(doc, budget, now) {
  const accounts = (doc.accounts || []).filter((a) => !a.deletedAt && a.currency === budget.currency);
  if (budget.scope === 'shared') return accounts.filter((a) => a.visibility === 'shared');
  const owner = { subject: budget.ownerSubject };
  return accounts.filter((a) => can(doc, owner, a, 'view-transactions', now));
}

// Net spending in one category over a date range: spending kinds add, refunds subtract; split
// entries contribute only their matching lines.
function netSpending(doc, accountIds, categoryId, from, to) {
  let total = 0;
  for (const t of doc.transactions || []) {
    if (t.deletedAt || !accountIds.has(t.accountId) || t.date < from || t.date > to) continue;
    const bucket = ledger.classify(t.kind);
    if (bucket !== 'spending' && bucket !== 'refund') continue;
    let amount;
    if ((t.splits || []).length) amount = money.sum(t.splits.filter((s) => s.categoryId === categoryId).map((s) => s.amountMinor));
    else if (t.categoryId === categoryId) amount = t.amountMinor;
    else continue;
    total = money.sum([total, -amount]);
  }
  return total;
}

// Bill occurrences still owed in [from, to]: future ones, plus past ones that are overdue.
function committedSpending(doc, accountIds, categoryId, from, to, today, recorded) {
  let total = 0;
  for (const b of doc.recurring || []) {
    if (b.deletedAt || !accountIds.has(b.accountId) || ledger.classify(b.kind) !== 'spending') continue;
    const start = bills.trackStart(b);
    for (const date of bills.dueBetween(b, from, to, recorded)) {
      if (date < today && date < start) continue;
      const terms = bills.termsAt(b, date);
      if (terms.categoryId === categoryId) total = money.sum([total, terms.amountMinor]);
    }
  }
  return total;
}

// Amounts too large to add up exactly are reported for that budget instead of failing every
// budget in the workspace (security review SEC-B3).
function budgetStatus(doc, budget, today, now) {
  try {
    return computeStatus(doc, budget, today, now);
  } catch (e) {
    if (!e || e.code !== 'amount_overflow') throw e;
    return { period: periodFor(budget, today), currency: budget.currency, lines: [], totals: null, error: 'too_large', explanation: 'These amounts are too large to add up exactly.', scopeNote: '', excludedCurrencyAccounts: 0 };
  }
}

function computeStatus(doc, budget, today, now) {
  const terms = budgetTermsAt(budget, today);
  const period = periodFor(terms, today);
  const prev = previousPeriod(terms, period);
  const prevTerms = budgetTermsAt(budget, prev.start);
  const accounts = scopeAccounts(doc, budget, now);
  const ids = new Set(accounts.map((a) => a.id));
  const recorded = bills.recordedSet(doc);
  const c = budget.currency;
  const categories = new Map((doc.categories || []).map((x) => [x.id, x.name]));
  const totals = { planned: 0, actual: 0, committed: 0, carry: 0, available: 0 };
  const lines = terms.lines.map((line) => {
    const actual = netSpending(doc, ids, line.categoryId, period.start, period.end);
    const committed = committedSpending(doc, ids, line.categoryId, period.start, period.end, today, recorded);
    // What was left of LAST period's own plan for this category.
    const prevLine = prevTerms.lines.find((l) => l.categoryId === line.categoryId);
    const carry = line.rollover && prevLine ? money.sum([prevLine.amountMinor, -netSpending(doc, ids, line.categoryId, prev.start, prev.end)]) : 0;
    const available = money.sum([line.amountMinor, carry, -actual, -committed]);
    for (const [k, v] of [['planned', line.amountMinor], ['actual', actual], ['committed', committed], ['carry', carry], ['available', available]]) totals[k] = money.sum([totals[k], v]);
    return {
      categoryId: line.categoryId, category: categories.get(line.categoryId) || 'Removed category', rollover: !!line.rollover,
      planned: money.toDecimal(line.amountMinor, c), actual: money.toDecimal(actual, c), committed: money.toDecimal(committed, c),
      carry: money.toDecimal(carry, c), available: money.toDecimal(available, c), over: available < 0,
    };
  });
  // Counted only within the budget's own scope, so it reveals nothing about others' accounts (SEC-B9).
  const owner = { subject: budget.ownerSubject };
  const inScope = budget.scope === 'shared' ? (a) => a.visibility === 'shared' : (a) => can(doc, owner, a, 'view-transactions', now);
  const otherCurrency = (doc.accounts || []).filter((a) => !a.deletedAt && a.currency !== c && inScope(a)).length;
  return {
    period, currency: c, lines,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, money.toDecimal(v, c)])),
    explanation: 'Available = planned + carried over − spent − bills still owed this period. Refunds reduce spending. A recorded bill counts as spent, not as owed.',
    scopeNote: budget.scope === 'shared' ? 'Counts shared accounts only; members\' private spending is never included.' : 'Counts accounts you can see.',
    excludedCurrencyAccounts: otherCurrency,
  };
}

// ---- forecast ---------------------------------------------------------------------------------
// Returns a projection for accounts whose balance the viewer may see. `adjustments` are what-if
// changes applied only in memory: { type: 'one-off', accountId, date, amountMinor } |
// { type: 'change-recurring', recurringId, amountMinor } | { type: 'exclude-recurring', recurringId }.
// Overdue bill occurrences are placed on TODAY: they are still owed.
function forecast(doc, principal, { today, horizonDays, bufferMinor = null, bufferCurrency = null, adjustments = [], now }) {
  const end = schedule.addDays(today, horizonDays);
  const recorded = bills.recordedSet(doc);
  const changes = new Map(adjustments.filter((a) => a.type === 'change-recurring').map((a) => [a.recurringId, a.amountMinor]));
  const excluded = new Set(adjustments.filter((a) => a.type === 'exclude-recurring').map((a) => a.recurringId));
  const visible = (doc.accounts || []).filter((a) => !a.deletedAt && (a.status || 'open') === 'open' && can(doc, principal, a, 'view-balances', now));
  const detail = new Set(visible.filter((a) => can(doc, principal, a, 'view-transactions', now)).map((a) => a.id));
  const events = new Map(visible.map((a) => [a.id, []]));
  const push = (accountId, date, amountMinor, certainty, label) => {
    if (events.has(accountId) && detail.has(accountId)) events.get(accountId).push({ date, amountMinor, certainty, label });
  };
  const startBalance = new Map();
  for (const a of visible) {
    let bal = a.openingBalanceMinor || 0;
    for (const t of doc.transactions || []) {
      if (t.accountId !== a.id || t.deletedAt) continue;
      if (t.date <= today) bal = money.sum([bal, t.amountMinor]);
      else if (t.date <= end) push(a.id, t.date, t.amountMinor, 'confirmed', 'Scheduled entry');
    }
    startBalance.set(a.id, bal);
  }
  // A bill counts only for someone who may see entries on its SOURCE account, so the incoming side
  // of another member's private transfer never shows in a shared account's forecast (SEC-B2).
  const live = new Map((doc.accounts || []).filter((a) => !a.deletedAt).map((a) => [a.id, a]));
  const canSeeSource = (id) => live.has(id) && can(doc, principal, live.get(id), 'view-transactions', now);
  for (const b of doc.recurring || []) {
    if (b.deletedAt || excluded.has(b.id) || !canSeeSource(b.accountId)) continue;
    const owed = [
      ...bills.overdue(b, today, recorded).map((due) => ({ due, at: today, overdue: true })),
      ...bills.dueBetween(b, today, end, recorded).map((due) => ({ due, at: due, overdue: false })),
    ];
    for (const o of owed) {
      const terms = bills.termsAt(b, o.due);
      const magnitude = changes.has(b.id) ? Math.abs(changes.get(b.id)) : terms.amountMinor;
      const certainty = terms.amountType === 'variable' ? 'estimate' : 'confirmed';
      const label = o.overdue ? `${b.name} (overdue since ${o.due})` : b.name;
      push(b.accountId, o.at, bills.signed(b.kind, magnitude), certainty, label);
      if (b.kind === 'transfer') push(b.toAccountId, o.at, magnitude, certainty, label);
    }
  }
  for (const adj of adjustments) if (adj.type === 'one-off' && adj.date >= today && adj.date <= end) push(adj.accountId, adj.date, adj.amountMinor, 'scenario', 'What-if change');

  const variants = {
    expected: () => true,
    conservative: (e) => !(e.certainty === 'estimate' && e.amountMinor > 0),
    optimistic: (e) => !(e.certainty === 'estimate' && e.amountMinor < 0),
  };
  const warnings = [];
  const accounts = visible.map((a) => {
    const list = events.get(a.id).sort((x, y) => (x.date === y.date ? 0 : x.date < y.date ? -1 : 1));
    const buffer = bufferMinor !== null && bufferCurrency === a.currency ? bufferMinor : null;
    const out = { accountId: a.id, name: a.name, currency: a.currency, start: money.toDecimal(startBalance.get(a.id), a.currency), itemsShared: detail.has(a.id), events: list.length, warnings: [] };
    try {
    for (const [name, keep] of Object.entries(variants)) {
      let bal = startBalance.get(a.id);
      let min = { minor: bal, date: today };
      let below = buffer !== null && bal < buffer ? today : null;
      const firstBelowZero = { date: bal < 0 ? today : null, minor: bal };
      const outgoing = [];
      const crossing = { zero: bal < 0 ? [] : null, buffer: below ? [] : null };
      for (const e of list) {
        if (!keep(e)) continue;
        bal = money.sum([bal, e.amountMinor]);
        if (e.amountMinor < 0) outgoing.push(e.label);
        if (bal < min.minor) min = { minor: bal, date: e.date };
        if (buffer !== null && below === null && bal < buffer) { below = e.date; crossing.buffer = [...outgoing]; }
        if (firstBelowZero.date === null && bal < 0) { firstBelowZero.date = e.date; firstBelowZero.minor = bal; crossing.zero = [...outgoing]; }
      }
      out[name] = { end: money.toDecimal(bal, a.currency), lowest: { amount: money.toDecimal(min.minor, a.currency), date: min.date }, belowBufferFrom: below };
      // Cash-flow conflicts are reported on the expected projection, naming the obligations that
      // lead up to the shortfall (most recent last, at most five). Liabilities (loans, cards) are
      // normally negative, so only asset accounts are warned about.
      if (name === 'expected' && !ledger.LIABILITY_TYPES.has(a.type)) {
        const names = (xs) => [...new Set(xs || [])].slice(-5);
        if (firstBelowZero.date) out.warnings.push({ type: 'below-zero', date: firstBelowZero.date, balance: money.toDecimal(firstBelowZero.minor, a.currency), obligations: names(crossing.zero) });
        if (below && buffer !== null) out.warnings.push({ type: 'below-buffer', date: below, buffer: money.toDecimal(buffer, a.currency), obligations: names(crossing.buffer) });
      }
    }
    } catch (e) {
      if (!e || e.code !== 'amount_overflow') throw e;
      // One balance too large to add up exactly is reported, never allowed to fail the forecast.
      out.error = 'too_large';
      out.warnings = [];
      for (const name of Object.keys(variants)) out[name] = null;
    }
    for (const w of out.warnings) warnings.push({ accountId: a.id, accountName: a.name, currency: a.currency, ...w });
    return out;
  });
  return {
    today, horizonDays, end, accounts, warnings,
    assumptions: [
      'Starts from balances recorded up to today; later-dated entries are treated as confirmed.',
      'Includes bills that are due and not yet recorded, skipped or paused. Overdue bills are counted today.',
      'Variable bills use their estimate. Conservative leaves out estimated income; optimistic leaves out estimated expenses.',
      'What-if changes are applied only to this forecast and are never saved.',
      'Accounts whose entries are not shared with you show their balance without upcoming items.',
    ],
    generatedAt: new Date(now).toISOString(),
  };
}

module.exports = { periodFor, previousPeriod, budgetTermsAt, budgetStatus, forecast, netSpending, committedSpending };
