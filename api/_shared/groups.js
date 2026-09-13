'use strict';
// THE shared-expense model (BT-009). Group expenses and settlements live in the workspace document
// (`groupExpenses[]`, `groupSettlements[]`). Balances, suggestions and the direct view are DERIVED on
// read from those records — never stored — so they cannot drift.
//
// SIGN CONVENTION (one definition for every view):
//   net = paid − share − received + paid out
// where "received" and "paid out" count CONFIRMED settlements only. A POSITIVE net means the group
// owes that person (they get money back); a NEGATIVE net means they owe the group. The nets of one
// currency always add up to exactly zero. Reported payments are "pending" and disputed ones are
// shown apart; neither is in the net. Suggestions count a reported payment as made, but only up to
// what its payer owes and its receiver is owed, so a pending claim never turns a creditor into a
// debtor; the direct view counts reported payments in full between those two people.
//
// Money is integer minor units (money.js). Shares come from money.allocate — deterministic largest
// remainder, ties to the first listed person — and the rounding adjustment (the minor units added to
// a share beyond its exact floor) is returned so it can be shown.
const { badRequest } = require('./http');
const money = require('./money');
const fields = require('./fields');
const people = require('./people');
const model = require('./workspace-model');

const METHODS = Object.freeze(['equal', 'amounts', 'percentages', 'shares']);
const SETTLEMENT_STATES = Object.freeze(['reported', 'confirmed', 'disputed']);
const MAX_LINES = 50;
// Bounded like a bill (SEC-B3) so sums over many records stay exact.
const MAX_GROUP_MINOR = 1e10;
const MAX_SHARES = 1000;
// Percentages have up to 4 decimal places: 1% = 10,000 units, 100% = 1,000,000.
const PERCENT_UNIT = 10000;
const HUNDRED_PERCENT = 100 * PERCENT_UNIT;
const PERCENT_RE = /^(\d{1,3})(?:\.(\d{1,4}))?$/;

function percentUnits(value, field = 'Percentage') {
  const m = typeof value === 'string' ? PERCENT_RE.exec(value.trim()) : null;
  if (!m) throw badRequest(`${field} must be a percentage such as "33.33" (up to 4 decimal places).`, 'invalid_split');
  const units = Number(m[1]) * PERCENT_UNIT + Number((m[2] || '').padEnd(4, '0'));
  if (units <= 0 || units > HUNDRED_PERCENT) throw badRequest(`${field} must be more than 0% and at most 100%.`, 'invalid_split');
  return units;
}

function percentText(units) {
  const frac = String(units % PERCENT_UNIT).padStart(4, '0').replace(/0+$/, '');
  return `${Math.floor(units / PERCENT_UNIT)}${frac ? `.${frac}` : ''}`;
}

function positiveAmount(text, currency, field) {
  const minor = money.parseDecimal(text, currency, field);
  if (minor <= 0) throw badRequest(`${field} must be greater than zero.`, 'invalid_amount');
  if (minor > MAX_GROUP_MINOR) throw badRequest(`${field} is larger than a shared expense can be.`, 'amount_too_large');
  return minor;
}

// ---- splits ----------------------------------------------------------------------------------
// A stored split is { method, lines: [{ ref, value }] } where value is null (equal), a whole number
// of shares, a canonical percentage string, or minor units (amounts).
function computeShares(totalMinor, split) {
  if (split.method === 'amounts') {
    return { shares: split.lines.map((l) => ({ ref: l.ref, amountMinor: l.value, adjustmentMinor: 0 })), residualMinor: 0 };
  }
  const weights = split.lines.map((l) => (split.method === 'equal' ? 1 : split.method === 'shares' ? l.value : percentUnits(l.value)));
  const parts = money.allocate(totalMinor, weights);
  const totalWeight = weights.reduce((a, b) => a + BigInt(b), 0n);
  const floors = weights.map((w) => Number((BigInt(totalMinor) * BigInt(w)) / totalWeight));
  return {
    shares: split.lines.map((l, i) => ({ ref: l.ref, amountMinor: parts[i], adjustmentMinor: parts[i] - floors[i] })),
    residualMinor: totalMinor - floors.reduce((a, b) => a + b, 0),
  };
}

function lineValue(method, value, currency, i) {
  const who = `Split line ${i + 1}`;
  if (method === 'equal') {
    if (value !== undefined && value !== null) throw badRequest(`${who}: an equal split takes no value.`, 'invalid_split');
    return null;
  }
  if (method === 'shares') {
    if (!Number.isInteger(value) || value < 1 || value > MAX_SHARES) throw badRequest(`${who}: shares must be a whole number from 1 to ${MAX_SHARES}.`, 'invalid_split');
    return value;
  }
  if (method === 'percentages') return percentText(percentUnits(value, who));
  return positiveAmount(value, currency, `${who} amount`);
}

// Validates a split from a client. `checkRef` validates and returns each person reference.
function normalizeSplit(input, totalMinor, currency, checkRef) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Choose how to split the expense.', 'invalid_split');
  fields.onlyKeys(input, ['method', 'lines']);
  const method = fields.oneOf(input.method, METHODS, 'Split method');
  if (!Array.isArray(input.lines) || !input.lines.length) throw badRequest('Choose at least one person to share the expense.', 'invalid_split');
  if (input.lines.length > MAX_LINES) throw badRequest(`A split can have at most ${MAX_LINES} people.`, 'invalid_split');
  const seen = new Set();
  const lines = input.lines.map((l, i) => {
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw badRequest(`Split line ${i + 1} is not valid.`, 'invalid_split');
    fields.onlyKeys(l, ['ref', 'value']);
    const ref = checkRef(l.ref);
    if (seen.has(ref)) throw badRequest('Each person can be in the split only once.', 'duplicate_participant');
    seen.add(ref);
    return { ref, value: lineValue(method, l.value, currency, i) };
  });
  if (method === 'percentages') {
    const sum = lines.reduce((a, l) => a + percentUnits(l.value), 0);
    if (sum !== HUNDRED_PERCENT) throw badRequest(`The percentages add up to ${percentText(sum)}%. They must add up to exactly 100%.`, 'split_percent_total');
  }
  if (method === 'amounts') {
    const sum = money.sum(lines.map((l) => l.value));
    if (sum !== totalMinor) {
      throw badRequest(`The amounts add up to ${money.toDecimal(sum, currency)} but the expense is ${money.toDecimal(totalMinor, currency)}.`, 'split_amount_total');
    }
  }
  return { method, lines };
}

// The same rules as normalizeSplit, applied to a STORED split (amounts already in minor units), for
// the backup and restore integrity check (financial review finding 6). True when the split is one the
// API would never have stored.
function storedSplitBroken(split, totalMinor) {
  if (!split || typeof split !== 'object' || !METHODS.includes(split.method)) return true;
  const lines = split.lines;
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) return true;
  if (lines.some((l) => !l || typeof l.ref !== 'string')) return true;
  if (unique(lines.map((l) => l.ref)).length !== lines.length) return true;
  if (split.method === 'equal') return lines.some((l) => l.value !== null);
  if (split.method === 'shares') return lines.some((l) => !Number.isInteger(l.value) || l.value < 1 || l.value > MAX_SHARES);
  if (split.method === 'percentages') {
    let sum = 0;
    for (const l of lines) {
      let units;
      try { units = percentUnits(l.value); } catch { return true; }
      if (percentText(units) !== l.value) return true;
      sum += units;
    }
    return sum !== HUNDRED_PERCENT;
  }
  if (lines.some((l) => !money.isMinor(l.value) || l.value <= 0 || l.value > MAX_GROUP_MINOR)) return true;
  try { return money.sum(lines.map((l) => l.value)) !== totalMinor; } catch { return true; }
}

// Who paid: one or more { ref, amount } that add up exactly to the total. A single payer may leave
// the amount out; it is then the total.
function normalizePayers(input, totalMinor, currency, checkRef) {
  if (!Array.isArray(input) || !input.length) throw badRequest('Say who paid.', 'invalid_payers');
  if (input.length > MAX_LINES) throw badRequest(`At most ${MAX_LINES} people can pay one expense.`, 'invalid_payers');
  const seen = new Set();
  const payers = input.map((p, i) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw badRequest(`Payer ${i + 1} is not valid.`, 'invalid_payers');
    fields.onlyKeys(p, ['ref', 'amount']);
    const ref = checkRef(p.ref);
    if (seen.has(ref)) throw badRequest('Each person can be listed as a payer only once.', 'duplicate_participant');
    seen.add(ref);
    const amountMinor = p.amount === undefined && input.length === 1 ? totalMinor : positiveAmount(p.amount, currency, `Amount paid by payer ${i + 1}`);
    return { ref, amountMinor };
  });
  const sum = money.sum(payers.map((p) => p.amountMinor));
  if (sum !== totalMinor) {
    throw badRequest(`The amounts paid add up to ${money.toDecimal(sum, currency)} but the expense is ${money.toDecimal(totalMinor, currency)}.`, 'payer_total');
  }
  return payers;
}

// Who may take part: active members and shared (workspace) contacts. Private contacts never — the
// other members cannot see them. People already on the record being edited stay allowed even if they
// have since left or been archived, so a correction never loses who paid or who shared.
function participantChecker(doc, keep = new Set()) {
  return (ref) => {
    const { type, id } = people.parseRef(ref);
    if (type === 'pcontact') {
      throw badRequest('Private contacts cannot take part in shared expenses, because the other members cannot see them. Add a shared contact on the Workspace page instead.', 'private_contact');
    }
    if (type === 'member') {
      const m = model.findMember(doc, id);
      if (!m || (m.status !== 'active' && !keep.has(ref))) throw badRequest('That member is not active in this workspace.', 'invalid_person');
    } else {
      const c = (doc.contacts || []).find((x) => x.id === id);
      if (!c || (c.deletedAt && !keep.has(ref))) throw badRequest('That contact does not exist in this workspace.', 'invalid_person');
    }
    return ref;
  };
}

// ---- people ----------------------------------------------------------------------------------
function recordRefs(doc) {
  const out = [];
  for (const e of doc.groupExpenses || []) {
    for (const p of e.payers || []) out.push(p.ref);
    for (const s of e.shares || []) out.push(s.ref);
  }
  for (const s of doc.groupSettlements || []) out.push(s.from, s.to);
  return out;
}

// Everyone who can be chosen now (active members in joining order, then shared contacts), followed
// by anyone else the records name (former members, archived contacts), marked inactive. This order
// is also the stable tie order for suggestions.
function participants(doc, principal) {
  const out = [];
  const seen = new Set();
  const push = (p) => { if (!seen.has(p.ref)) { seen.add(p.ref); out.push(p); } };
  for (const m of model.activeMembers(doc)) push({ ref: `member:${m.id}`, name: m.name || 'Member', type: 'member', self: !!principal && m.subject === principal.subject, active: true });
  for (const c of doc.contacts || []) if (!c.deletedAt) push({ ref: `contact:${c.id}`, name: c.name, type: 'contact', self: false, active: true });
  for (const ref of recordRefs(doc)) {
    if (seen.has(ref)) continue;
    const l = people.labelFor(ref, { doc });
    push({ ref, name: l.label, type: l.type, self: false, active: false });
  }
  return out;
}

// ---- balances --------------------------------------------------------------------------------
const sumByRef = (list) => {
  const out = new Map();
  for (const x of list || []) out.set(x.ref, money.sum([out.get(x.ref) || 0, x.amountMinor]));
  return out;
};
const unique = (list) => [...new Set(list)];

function blankRow(ref) {
  return { ref, paidMinor: 0, shareMinor: 0, settledOutMinor: 0, settledInMinor: 0, pendingOutMinor: 0, pendingInMinor: 0, disputedOutMinor: 0, disputedInMinor: 0, netMinor: 0, basisMinor: 0, expenses: [] };
}

// Fewest payments: first every creditor whose balance exactly matches a debtor's is paid by that debtor
// in one payment (financial review finding 7: greedy alone turned +4 −9 +9 +6 −4 +6 −12 into six
// payments instead of four); then the largest remaining debtor pays the largest remaining creditor,
// repeatedly. Creditors are taken largest first, ties to the person listed first, and each is matched
// to the first debtor of the same amount in that order, so the result is deterministic. Every net is
// cleared exactly; each payment clears at least one person, so at most n − 1 payments. Computed on
// `basisMinor` (the net once reported payments are counted as made, up to what is owed), so nobody is
// asked to pay twice.
function suggest(rows, rank) {
  const cmp = (a, b) => b.left - a.left || rank(a.ref) - rank(b.ref) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  let creditors = rows.filter((r) => r.basisMinor > 0).map((r) => ({ ref: r.ref, left: r.basisMinor })).sort(cmp);
  let debtors = rows.filter((r) => r.basisMinor < 0).map((r) => ({ ref: r.ref, left: -r.basisMinor })).sort(cmp);
  const out = [];
  for (const c of creditors) {
    const d = debtors.find((x) => x.left > 0 && x.left === c.left);
    if (!d) continue;
    out.push({ from: d.ref, to: c.ref, amountMinor: c.left });
    c.left = 0;
    d.left = 0;
  }
  creditors = creditors.filter((c) => c.left > 0);
  debtors = debtors.filter((d) => d.left > 0);
  while (creditors.length && debtors.length) {
    creditors.sort(cmp);
    debtors.sort(cmp);
    const c = creditors[0];
    const d = debtors[0];
    const x = Math.min(c.left, d.left);
    out.push({ from: d.ref, to: c.ref, amountMinor: x });
    c.left -= x;
    d.left -= x;
    if (!c.left) creditors.shift();
    if (!d.left) debtors.shift();
  }
  return out;
}

// Direct debts, not redistributed: for each expense, what each person paid for themselves is set
// aside first; each remaining share is then matched to the payers in the order they are listed, so
// the amounts are exact integers on both sides. Confirmed and reported settlements reduce the debt
// between those two people. Each pair is netted to one direction.
function direct(doc, currency, rank) {
  const owe = new Map();
  const add = (from, to, x) => {
    if (from === to || x <= 0) return;
    if (!owe.has(from)) owe.set(from, new Map());
    owe.get(from).set(to, money.sum([owe.get(from).get(to) || 0, x]));
  };
  for (const e of doc.groupExpenses || []) {
    if (e.voidedAt || e.currency !== currency) continue;
    const paid = sumByRef(e.payers);
    const share = sumByRef(e.shares);
    const self = (ref) => Math.min(paid.get(ref) || 0, share.get(ref) || 0);
    const creditors = unique((e.payers || []).map((p) => p.ref)).map((ref) => ({ ref, left: paid.get(ref) - self(ref) })).filter((c) => c.left > 0);
    const debtors = unique((e.shares || []).map((s) => s.ref)).map((ref) => ({ ref, left: share.get(ref) - self(ref) })).filter((d) => d.left > 0);
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const x = Math.min(debtors[i].left, creditors[j].left);
      add(debtors[i].ref, creditors[j].ref, x);
      debtors[i].left -= x;
      creditors[j].left -= x;
      if (!debtors[i].left) i += 1;
      if (!creditors[j].left) j += 1;
    }
  }
  for (const s of doc.groupSettlements || []) {
    if (s.voidedAt || s.currency !== currency || (s.status !== 'confirmed' && s.status !== 'reported')) continue;
    add(s.to, s.from, s.amountMinor);
  }
  const refs = unique([...owe.keys(), ...[...owe.values()].flatMap((m) => [...m.keys()])]);
  const get = (a, b) => (owe.get(a) && owe.get(a).get(b)) || 0;
  const out = [];
  for (let x = 0; x < refs.length; x += 1) {
    for (let y = x + 1; y < refs.length; y += 1) {
      const d = money.sum([get(refs[x], refs[y]), -get(refs[y], refs[x])]);
      if (d > 0) out.push({ from: refs[x], to: refs[y], amountMinor: d });
      else if (d < 0) out.push({ from: refs[y], to: refs[x], amountMinor: -d });
    }
  }
  const byRank = (a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((p, q) => byRank(p.from, q.from) || byRank(p.to, q.to));
}

// Balances per currency: one row per person (everyone in `order`, then anyone else the records name),
// with a breakdown of the expenses behind it, the suggested settlements and the direct view.
// `ensureCurrency` adds an empty table for that currency when there are no records yet.
function balances(doc, order, { ensureCurrency = null } = {}) {
  const index = new Map(order.map((r, i) => [r, i]));
  const rank = (ref) => (index.has(ref) ? index.get(ref) : order.length);
  const tables = new Map();
  const table = (currency) => { if (!tables.has(currency)) tables.set(currency, new Map()); return tables.get(currency); };
  const rowOf = (currency, ref) => { const t = table(currency); if (!t.has(ref)) t.set(ref, blankRow(ref)); return t.get(ref); };
  const plus = (a, b) => money.sum([a, b]);
  if (ensureCurrency) table(ensureCurrency);
  for (const e of doc.groupExpenses || []) {
    if (e.voidedAt) continue;
    const paid = sumByRef(e.payers);
    const share = sumByRef(e.shares);
    for (const ref of unique([...(e.payers || []).map((p) => p.ref), ...(e.shares || []).map((s) => s.ref)])) {
      const r = rowOf(e.currency, ref);
      const p = paid.get(ref) || 0;
      const s = share.get(ref) || 0;
      r.paidMinor = plus(r.paidMinor, p);
      r.shareMinor = plus(r.shareMinor, s);
      r.expenses.push({ expenseId: e.id, description: e.description, date: e.date, paidMinor: p, shareMinor: s, effectMinor: money.sum([p, -s]) });
    }
  }
  for (const s of doc.groupSettlements || []) {
    if (s.voidedAt) continue;
    const from = rowOf(s.currency, s.from);
    const to = rowOf(s.currency, s.to);
    if (s.status === 'confirmed') { from.settledOutMinor = plus(from.settledOutMinor, s.amountMinor); to.settledInMinor = plus(to.settledInMinor, s.amountMinor); }
    else if (s.status === 'reported') { from.pendingOutMinor = plus(from.pendingOutMinor, s.amountMinor); to.pendingInMinor = plus(to.pendingInMinor, s.amountMinor); }
    else if (s.status === 'disputed') { from.disputedOutMinor = plus(from.disputedOutMinor, s.amountMinor); to.disputedInMinor = plus(to.disputedInMinor, s.amountMinor); }
  }
  const out = [];
  for (const currency of [...tables.keys()].sort()) {
    const t = tables.get(currency);
    for (const ref of order) if (!t.has(ref)) t.set(ref, blankRow(ref));
    const rows = [...t.values()].sort((a, b) => rank(a.ref) - rank(b.ref) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
    for (const r of rows) r.netMinor = money.sum([r.paidMinor, -r.shareMinor, -r.settledInMinor, r.settledOutMinor]);
    // The suggestion basis counts a reported (not yet confirmed) payment as made, but only up to what
    // its payer still owes and its receiver is still owed (financial review finding 5): a claim of
    // 80.00 against a debt of 50.00 must not make the creditor owe 30.00. Taken in a fixed order (date,
    // then when reported, then id), so the basis is deterministic and still adds up to zero.
    const left = new Map(rows.map((r) => [r.ref, r.netMinor]));
    const pending = (doc.groupSettlements || []).filter((s) => !s.voidedAt && s.status === 'reported' && s.currency === currency)
      .sort((p, q) => String(p.date).localeCompare(String(q.date)) || String(p.createdAt).localeCompare(String(q.createdAt)) || String(p.id).localeCompare(String(q.id)));
    for (const s of pending) {
      const x = Math.min(s.amountMinor, Math.max(0, -left.get(s.from)), Math.max(0, left.get(s.to)));
      if (x <= 0) continue;
      left.set(s.from, money.sum([left.get(s.from), x]));
      left.set(s.to, money.sum([left.get(s.to), -x]));
    }
    for (const r of rows) r.basisMinor = left.get(r.ref);
    out.push({ currency, rows, suggestions: suggest(rows, rank), direct: direct(doc, currency, rank) });
  }
  return out;
}

// ---- personal ledger ---------------------------------------------------------------------------
// The entries a person's own account should hold for one record (the brief's EUR 300 dinner rule):
//   expense    what they paid is charged to their account: their own share as spending (`expense`),
//              the rest as money lent to the others (`advance`), which is neither spending nor income.
//              Someone who paid less than their share has only what they paid as spending now.
//   settlement a CONFIRMED repayment to them is a `reimbursement` that clears the advance.
// Amounts are signed from the account holder's point of view (ledger.js). A void record wants none.
function desiredEntries(rec, type, ref) {
  if (rec.voidedAt) return [];
  if (type === 'expense') {
    const paid = sumByRef(rec.payers).get(ref) || 0;
    if (!paid) return [];
    const own = Math.min(paid, sumByRef(rec.shares).get(ref) || 0);
    const out = [];
    if (own > 0) out.push({ kind: 'expense', amountMinor: -own, categoryId: rec.categoryId || null, date: rec.date });
    if (paid - own > 0) out.push({ kind: 'advance', amountMinor: -(paid - own), categoryId: null, date: rec.date });
    return out;
  }
  if (rec.status !== 'confirmed' || rec.to !== ref) return [];
  return [{ kind: 'reimbursement', amountMinor: rec.amountMinor, categoryId: null, date: rec.date }];
}

// ---- integrity (used by backups and restores) -----------------------------------------------------
// Returns the name of the first broken rule, or null. Rule names only — never records or values.
function invariantProblem(doc) {
  const members = new Set((doc.members || []).map((m) => m.id));
  const contacts = new Set((doc.contacts || []).map((c) => c.id));
  const categories = new Set((doc.categories || []).map((c) => c.id));
  const refOk = (ref) => {
    try {
      const { type, id } = people.parseRef(ref);
      return type === 'member' ? members.has(id) : type === 'contact' ? contacts.has(id) : false;
    } catch { return false; }
  };
  const total = (list) => { try { return money.sum(list.map((x) => x.amountMinor)); } catch { return null; } };
  for (const e of doc.groupExpenses || []) {
    if (!money.isCurrency(e.currency) || !money.isMinor(e.amountMinor) || e.amountMinor <= 0) return 'group expense amounts';
    if (!Array.isArray(e.payers) || !e.payers.length || !Array.isArray(e.shares) || !e.shares.length) return 'group expense people';
    if (e.payers.some((p) => !refOk(p.ref) || !money.isMinor(p.amountMinor) || p.amountMinor <= 0)) return 'group expense payers';
    if (unique(e.payers.map((p) => p.ref)).length !== e.payers.length || total(e.payers) !== e.amountMinor) return 'group expense payers';
    if (e.shares.some((s) => !refOk(s.ref) || !money.isMinor(s.amountMinor) || s.amountMinor < 0)) return 'group expense shares';
    if (total(e.shares) !== e.amountMinor) return 'group expense shares';
    // The stored split follows the rules the API applies, and the stored shares are exactly what it
    // gives: one canonical calculation.
    if (storedSplitBroken(e.split, e.amountMinor)) return 'group expense split';
    let expected;
    try {
      if (e.split.lines.length !== e.shares.length) throw new Error('split');
      expected = computeShares(e.amountMinor, e.split).shares;
    } catch { return 'group expense shares'; }
    if (expected.some((s, i) => s.ref !== e.shares[i].ref || s.amountMinor !== e.shares[i].amountMinor)) return 'group expense shares';
    if (e.categoryId && !categories.has(e.categoryId)) return 'group expense category';
  }
  for (const s of doc.groupSettlements || []) {
    if (!money.isCurrency(s.currency) || !money.isMinor(s.amountMinor) || s.amountMinor <= 0) return 'group settlement amounts';
    if (!refOk(s.from) || !refOk(s.to) || s.from === s.to) return 'group settlement people';
    if (!SETTLEMENT_STATES.includes(s.status)) return 'group settlement state';
  }
  return null;
}

// Member ids named by shared-expense records (for restore planning).
function memberIds(doc) {
  const out = new Set();
  for (const ref of recordRefs(doc)) {
    try { const { type, id } = people.parseRef(ref); if (type === 'member') out.add(id); } catch { /* checked elsewhere */ }
  }
  return out;
}

module.exports = {
  METHODS, SETTLEMENT_STATES, MAX_LINES, MAX_GROUP_MINOR, HUNDRED_PERCENT,
  percentUnits, percentText, positiveAmount, computeShares, normalizeSplit, normalizePayers, participantChecker,
  participants, recordRefs, sumByRef, balances, desiredEntries, invariantProblem, memberIds,
};
