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

// BT-009-25: 'itemized' is stored exactly like 'amounts' (each line names its own final, already-
// reconciled amount) — the raw line-items/tax/tip/discount/fee that PRODUCED those amounts are kept
// separately on the expense (`e.itemization`, computed once by `computeItemization` below and never
// touched by `computeShares`/`storedSplitBroken` here), so every existing balance/export/backup code
// path that already handles 'amounts' handles 'itemized' identically, with zero new blast radius.
const METHODS = Object.freeze(['equal', 'amounts', 'percentages', 'shares', 'fixed-remainder', 'itemized']);
// BT-009-25: the split methods a PROPORTION-only saved preset may use — never 'amounts' or
// 'fixed-remainder', whose values name a specific money amount that does not generalize across
// different expense sizes the way an equal split, a share count or a percentage does.
const PRESET_METHODS = Object.freeze(['equal', 'shares', 'percentages']);
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
// A stored split is { method, lines: [{ ref, value }] } where value is null (equal, or a
// 'fixed-remainder' line that shares the remainder), a whole number of shares, a canonical
// percentage string, or minor units (amounts, or a 'fixed-remainder' line's own fixed amount).
function computeShares(totalMinor, split) {
  if (split.method === 'amounts' || split.method === 'itemized') {
    return { shares: split.lines.map((l) => ({ ref: l.ref, amountMinor: l.value, adjustmentMinor: 0 })), residualMinor: 0 };
  }
  // BT-009-25: "fixed allocations plus a split remainder" (Terry, 2026-09-19) — a line with a
  // value is a FIXED amount (kept exactly, no rounding adjustment, same as 'amounts'); a line
  // with no value shares whatever is LEFT, equally, using the exact same deterministic largest-
  // remainder allocation (`money.allocate`) every other weighted method already uses, applied
  // only to the remainder pool and only among the remainder lines.
  if (split.method === 'fixed-remainder') {
    const fixedTotal = money.sum(split.lines.filter((l) => l.value !== null).map((l) => l.value));
    const remainderTotal = totalMinor - fixedTotal;
    const remainderCount = split.lines.filter((l) => l.value === null).length;
    const remainderParts = remainderCount ? money.allocate(remainderTotal, split.lines.filter((l) => l.value === null).map(() => 1)) : [];
    const remainderFloor = remainderCount ? Math.floor(remainderTotal / remainderCount) : 0;
    let ri = 0;
    return {
      shares: split.lines.map((l) => {
        if (l.value !== null) return { ref: l.ref, amountMinor: l.value, adjustmentMinor: 0 };
        const amountMinor = remainderParts[ri];
        const adjustmentMinor = amountMinor - remainderFloor;
        ri += 1;
        return { ref: l.ref, amountMinor, adjustmentMinor };
      }),
      residualMinor: remainderTotal - remainderFloor * remainderCount,
    };
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
  // BT-009-25: a 'fixed-remainder' line either names its own fixed amount, or is left out
  // entirely to share whatever is left over, equally, with every other line that also left it out.
  if (method === 'fixed-remainder' && (value === undefined || value === null)) return null;
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
  if (method === 'amounts' || method === 'itemized') {
    const sum = money.sum(lines.map((l) => l.value));
    if (sum !== totalMinor) {
      throw badRequest(`The amounts add up to ${money.toDecimal(sum, currency)} but the expense is ${money.toDecimal(totalMinor, currency)}.`, 'split_amount_total');
    }
  }
  if (method === 'fixed-remainder') {
    const fixedTotal = money.sum(lines.filter((l) => l.value !== null).map((l) => l.value));
    if (fixedTotal > totalMinor) {
      throw badRequest(`The fixed amounts add up to ${money.toDecimal(fixedTotal, currency)}, more than the expense's ${money.toDecimal(totalMinor, currency)}.`, 'split_amount_total');
    }
    if (!lines.some((l) => l.value === null) && fixedTotal !== totalMinor) {
      throw badRequest(`With no one left to share the remainder, the fixed amounts must add up to exactly ${money.toDecimal(totalMinor, currency)}.`, 'split_amount_total');
    }
  }
  return { method, lines };
}

// BT-009-25: itemized receipt allocation (docs/BT-009-25-WORKED-EXAMPLES.md §2's worked example).
// `itemization = { lines: [{description, quantity, unitPriceMinor, refs: [ref,...]}], taxMinor,
// tipMinor, discountMinor, feeMinor }`. Each line's own total (quantity × unitPriceMinor,
// supporting a genuine quantity like "2x Pizza") is split EQUALLY among the people named in its
// own `refs` (a "shared line") via the same deterministic largest-remainder `money.allocate`
// mechanism every other weighted split method already uses. Tax/tip/fee (added) and discount
// (subtracted) are then allocated to every participant who has at least one item line,
// PROPORTIONALLY to their own item-line subtotal — same mechanism again, so the grand total always
// reconciles EXACTLY to `totalMinor` (the expense's own amount). Returns decimal-string values (the
// same shape client-typed 'amounts' values already have) so the result can be fed straight into the
// existing `normalizeSplit`/`computeShares` 'itemized' handling with zero special-casing there.
function computeItemization(itemization, totalMinor, currency, checkRef) {
  if (!itemization || typeof itemization !== 'object' || Array.isArray(itemization)) throw badRequest('Itemization is not valid.', 'invalid_itemization');
  fields.onlyKeys(itemization, ['lines', 'taxMinor', 'tipMinor', 'discountMinor', 'feeMinor']);
  if (!Array.isArray(itemization.lines) || !itemization.lines.length) throw badRequest('Add at least one item line.', 'invalid_itemization');
  if (itemization.lines.length > MAX_LINES) throw badRequest(`An itemized receipt can have at most ${MAX_LINES} lines.`, 'invalid_itemization');
  const perPersonMinor = new Map();
  const add = (ref, amt) => perPersonMinor.set(ref, (perPersonMinor.get(ref) || 0) + amt);
  const storedLines = [];
  let itemsSubtotal = 0;
  itemization.lines.forEach((line, i) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw badRequest(`Item line ${i + 1} is not valid.`, 'invalid_itemization');
    fields.onlyKeys(line, ['description', 'quantity', 'unitPriceMinor', 'refs']);
    const description = fields.text(line.description, { field: `Item ${i + 1}`, max: 120, required: true });
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) throw badRequest(`"${description}": quantity must be greater than zero.`, 'invalid_itemization');
    if (!money.isMinor(line.unitPriceMinor) || line.unitPriceMinor <= 0) throw badRequest(`"${description}": unit price must be greater than zero.`, 'invalid_itemization');
    const lineTotal = Math.round(quantity * line.unitPriceMinor);
    if (lineTotal <= 0 || lineTotal > MAX_GROUP_MINOR) throw badRequest(`"${description}": the line total is not valid.`, 'invalid_itemization');
    itemsSubtotal += lineTotal;
    if (!Array.isArray(line.refs) || !line.refs.length) throw badRequest(`"${description}": choose who shares this line.`, 'invalid_itemization');
    const refs = line.refs.map((r) => checkRef(r));
    if (unique(refs).length !== refs.length) throw badRequest(`"${description}": the same person is named twice.`, 'invalid_itemization');
    const parts = money.allocate(lineTotal, refs.map(() => 1));
    refs.forEach((ref, j) => add(ref, parts[j]));
    storedLines.push({ description, quantity, unitPriceMinor: line.unitPriceMinor, refs });
  });
  const fee = (key, field) => {
    const v = itemization[key];
    if (v === undefined || v === null || v === '') return 0;
    if (!money.isMinor(v) || v < 0) throw badRequest(`${field} must be a non-negative amount.`, 'invalid_itemization');
    return v;
  };
  const taxMinor = fee('taxMinor', 'Tax');
  const tipMinor = fee('tipMinor', 'Tip');
  const discountMinor = fee('discountMinor', 'Discount');
  const feeMinor = fee('feeMinor', 'Fee');
  const netExtra = taxMinor + tipMinor - discountMinor + feeMinor;
  const refsWithItems = [...perPersonMinor.keys()];
  if (netExtra !== 0) {
    if (itemsSubtotal <= 0) throw badRequest('Tax, tip, discount or a fee needs at least one item line to allocate against.', 'invalid_itemization');
    const weights = refsWithItems.map((ref) => perPersonMinor.get(ref));
    const parts = money.allocate(Math.abs(netExtra), weights);
    const sign = netExtra < 0 ? -1 : 1;
    refsWithItems.forEach((ref, j) => add(ref, sign * parts[j]));
  }
  const grandTotal = itemsSubtotal + netExtra;
  // "Show any unallocated remainder" — a clear, itemization-specific message, not the generic
  // 'amounts' mismatch text, whenever the lines plus tax/tip/discount/fee do not equal the expense's
  // own entered total (e.g., a line was forgotten, or the receipt total was mistyped).
  if (grandTotal !== totalMinor) {
    const diff = totalMinor - grandTotal;
    throw badRequest(diff > 0
      ? `${money.toDecimal(diff, currency)} of the ${money.toDecimal(totalMinor, currency)} total is not yet allocated to any item line, tax, tip, discount or fee.`
      : `The item lines, tax, tip, discount and fee add up to ${money.toDecimal(grandTotal, currency)}, which is more than the expense's own ${money.toDecimal(totalMinor, currency)} total.`,
      'itemization_unallocated');
  }
  const lines = refsWithItems.map((ref) => ({ ref, value: money.toDecimal(perPersonMinor.get(ref), currency) }));
  return { lines, itemization: { lines: storedLines, taxMinor, tipMinor, discountMinor, feeMinor } };
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
  if (split.method === 'fixed-remainder') {
    const fixed = lines.filter((l) => l.value !== null);
    const remainderCount = lines.length - fixed.length;
    if (fixed.some((l) => !money.isMinor(l.value) || l.value <= 0 || l.value > MAX_GROUP_MINOR)) return true;
    let fixedTotal;
    try { fixedTotal = money.sum(fixed.map((l) => l.value)); } catch { return true; }
    if (remainderCount === 0) return fixedTotal !== totalMinor;
    return fixedTotal > totalMinor;
  }
  // 'amounts': every line names its own exact amount, summing to the total.
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
// have since left or been archived, so a correction never loses who paid or who shared. A contact
// that has since JOINED as a member (BT-009-15) is refused for a NEW submission the same way an
// archived one is — going forward, the relationship is recorded as the member they are, not the
// contact they were — but an existing record that already names them (`keep`) stays exactly as it
// was reviewed, never invalidated by something that happened after it was recorded.
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
      if (!c || ((c.deletedAt || c.joinedMemberId) && !keep.has(ref))) throw badRequest('That contact does not exist in this workspace.', 'invalid_person');
    }
    return ref;
  };
}

// BT-009-15 (Terry's split-costs check, 2026-09-14): "inviting a shared contact to join links the
// invitation to that contact; on acceptance the new member's expenses, shares, payments and
// balance continue from the contact's... the records themselves never rewritten." A contact that
// has joined carries `joinedMemberId` (set by api/invitations/handler.js's accept route);
// `canonicalRef` maps its OLD `contact:<id>` ref onto the new `member:<id>` ref for every
// calculation below, while the STORED records (`doc.groupExpenses`/`groupSettlements`) keep their
// original ref forever, completely untouched — this only ever affects a derived, recomputed-on-
// read view, never what is saved (matching every other balance/suggestion/direct value in this
// file, none of which is ever stored either).
function canonicalRef(doc, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('contact:')) return ref;
  const c = (doc.contacts || []).find((x) => x.id === ref.slice('contact:'.length));
  return c && c.joinedMemberId ? `member:${c.joinedMemberId}` : ref;
}
// A read-only VIEW of the document with every payer/share/settlement ref canonicalized, used as
// the one choke point every calculation in this file reads shared-expense records through — so a
// joined contact's history is combined with their member's without needing to remember to
// canonicalize at each of the many places a ref is read. Returns the SAME object, no copy at all,
// when nothing has ever joined (the overwhelmingly common case) — this is not a mutation either
// way: `doc` itself is never written to.
function canonicalDoc(doc) {
  if (!(doc.contacts || []).some((c) => c.joinedMemberId)) return doc;
  const remap = (ref) => canonicalRef(doc, ref);
  return {
    ...doc,
    groupExpenses: (doc.groupExpenses || []).map((e) => ({ ...e, payers: (e.payers || []).map((p) => ({ ...p, ref: remap(p.ref) })), shares: (e.shares || []).map((s) => ({ ...s, ref: remap(s.ref) })) })),
    groupSettlements: (doc.groupSettlements || []).map((s) => ({ ...s, from: remap(s.from), to: remap(s.to) })),
  };
}

// ---- people ----------------------------------------------------------------------------------
function recordRefs(doc) {
  doc = canonicalDoc(doc);
  const out = [];
  for (const e of doc.groupExpenses || []) {
    for (const p of e.payers || []) out.push(p.ref);
    for (const s of e.shares || []) out.push(s.ref);
  }
  for (const s of doc.groupSettlements || []) out.push(s.from, s.to);
  // BT-009-25: a linked refund's own allocation names real people too (its "explicitly reviewed
  // adjustment" can, in principle, name someone the original expense's split did not) — treated
  // exactly like an expense's own payers/shares for participant listing and restore/create-new
  // member-reference blocking, never a silent exception to either.
  for (const rf of doc.groupRefunds || []) for (const s of rf.shares || []) out.push(s.ref);
  // BT-009-25: a shared-income/deposit contribution names a real contributor and holder — treated
  // exactly like every other financial record's own references for participant listing and
  // restore/create-new member-reference blocking.
  for (const c of doc.groupContributions || []) out.push(c.contributor, c.holder);
  // BT-009-26: an in-app payment reminder names who is owed and who is being reminded — treated the
  // same way for participant listing and restore/create-new member-reference blocking, even though
  // it moves no money itself.
  for (const r of doc.groupPaymentRequests || []) out.push(r.from, r.to);
  return out;
}

// Everyone who can be chosen now (active members in joining order, then shared contacts), followed
// by anyone else the records name (former members, archived contacts), marked inactive. This order
// is also the stable tie order for suggestions. A contact who has joined (BT-009-15) is never
// listed separately — their own member entry above already represents them, and their past
// records now resolve to that same ref (canonicalRef), so they would otherwise appear twice.
function participants(doc, principal) {
  const out = [];
  const seen = new Set();
  const push = (p) => { if (!seen.has(p.ref)) { seen.add(p.ref); out.push(p); } };
  for (const m of model.activeMembers(doc)) push({ ref: `member:${m.id}`, name: m.name || 'Member', type: 'member', self: !!principal && m.subject === principal.subject, active: true });
  for (const c of doc.contacts || []) if (!c.deletedAt && !c.joinedMemberId) push({ ref: `contact:${c.id}`, name: c.name, type: 'contact', self: false, active: true });
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

// BT-009-25: settlement units (couples/families) are a DISPLAY/SUGGESTION-only grouping over
// already-computed individual rows — never a second calculation of balance itself, and never a
// thing that can hold money. Only active units are ever merged; a member in more than one active
// unit is refused at create time (invariantProblem), so there is never an ambiguous double-merge.
// A merged suggestion between two units (or a unit and an individual) still names a REAL person to
// actually pay/receive (`viaRef`/`viaName`): whichever member of the unit has the larger-magnitude
// individual basis, ties broken by participant order — deterministic, and always shown, never a
// silently guessed destination. Reduces payment COUNT only; the underlying `rows` (and every other
// output of `balances()`) are completely unaffected.
function unitSuggest(rows, rank, units) {
  const activeUnits = (units || []).filter((u) => u.active !== false);
  const memberToUnit = new Map();
  for (const u of activeUnits) for (const ref of u.memberRefs) if (!memberToUnit.has(ref)) memberToUnit.set(ref, u);
  const merged = new Map(); // unit id or ref -> { ref, basisMinor, members: [{ref, basisMinor}] }
  for (const r of rows) {
    const u = memberToUnit.get(r.ref);
    const key = u ? u.id : r.ref;
    if (!merged.has(key)) merged.set(key, { ref: key, basisMinor: 0, unit: u || null, members: [] });
    const m = merged.get(key);
    m.basisMinor = money.sum([m.basisMinor, r.basisMinor]);
    m.members.push({ ref: r.ref, basisMinor: r.basisMinor });
  }
  const mergedRows = [...merged.values()];
  const viaOf = (key) => {
    const m = merged.get(key);
    if (!m || !m.unit) return { viaRef: key, viaName: null };
    const chosen = [...m.members].sort((a, b) => Math.abs(b.basisMinor) - Math.abs(a.basisMinor) || rank(a.ref) - rank(b.ref))[0];
    return { viaRef: chosen.ref, viaName: null };
  };
  const raw = suggest(mergedRows, (key) => { const m = merged.get(key); return m && m.unit ? Math.min(...m.members.map((x) => rank(x.ref))) : rank(key); });
  return raw.map((s) => {
    const fromUnit = merged.get(s.from).unit;
    const toUnit = merged.get(s.to).unit;
    const fromVia = viaOf(s.from);
    const toVia = viaOf(s.to);
    return {
      from: fromUnit ? fromUnit.id : s.from, to: toUnit ? toUnit.id : s.to, amountMinor: s.amountMinor,
      fromIsUnit: !!fromUnit, toIsUnit: !!toUnit,
      fromName: fromUnit ? fromUnit.name : null, toName: toUnit ? toUnit.name : null,
      // The real person who would actually pay/receive — always named, never hidden behind the unit.
      fromRef: fromVia.viaRef, toRef: toVia.viaRef,
    };
  });
}

// Direct debts, not redistributed: for each expense, what each person paid for themselves is set
// aside first; each remaining share is then matched to the payers in the order they are listed, so
// the amounts are exact integers on both sides. Confirmed and reported settlements reduce the debt
// between those two people. Each pair is netted to one direction.
function direct(doc, currency, rank, countReported = true, counted = null) {
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
  const get = (a, b) => (owe.get(a) && owe.get(a).get(b)) || 0;
  // A confirmed payment reduces the debt between those two people in full.
  for (const s of doc.groupSettlements || []) {
    if (s.voidedAt || s.currency !== currency || s.status !== 'confirmed') continue;
    add(s.to, s.from, s.amountMinor);
  }
  // A reported payment counts only while the group counts them (setting "countReported", default on),
  // and only by what the suggestions count of it — up to what its payer still owes and its receiver is
  // still owed (financial recheck N-3): a claim of 50.00 against a debt of 30.00 never makes the receiver
  // owe 20.00, and the direct view still adds up to each person's basis.
  if (countReported) {
    for (const s of doc.groupSettlements || []) {
      if (s.voidedAt || s.currency !== currency || s.status !== 'reported') continue;
      const x = counted ? counted.get(s.id) || 0 : s.amountMinor;
      if (x > 0) add(s.to, s.from, x);
    }
  }
  const refs = unique([...owe.keys(), ...[...owe.values()].flatMap((m) => [...m.keys()])]);
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
// `countReported` (the group setting, default on): when off, suggestions and the direct view count
// confirmed payments only, like the balances themselves.
function balances(doc, order, { ensureCurrency = null, countReported = true } = {}) {
  // BT-009-15: canonicalized once here, at the top — `direct()` below is only ever called from
  // within this same function, so it receives the already-canonicalized doc too.
  doc = canonicalDoc(doc);
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
  // BT-009-25: a linked refund (docs/BT-009-25-WORKED-EXAMPLES.md §3) never edits the original
  // expense — its own record stays exactly as recorded, forever. It reduces, ON READ, the true
  // effective cost: the ORIGINAL PAYER(S)' "paid" (money genuinely came back — split proportionally
  // to how much each originally paid, via the same `money.allocate` largest-remainder mechanism
  // every other split already uses, so a multi-payer refund still reconciles exactly), and each
  // refunded participant's "share" by their own allocated part. A CONFIRMED settlement already
  // recorded is never touched by any of this — a resulting over/under-payment becomes a normal,
  // new, open balance, resolved by a normal new settlement (proven by the worked example's own
  // hand-computed, corrected zero-sum trace).
  const expenseById = new Map((doc.groupExpenses || []).map((e) => [e.id, e]));
  for (const rf of doc.groupRefunds || []) {
    if (rf.voidedAt) continue;
    const e = expenseById.get(rf.refundOf);
    if (!e || e.voidedAt) continue;
    const payerRefs = (e.payers || []).map((p) => p.ref);
    const payerWeights = (e.payers || []).map((p) => p.amountMinor);
    const payerParts = money.allocate(rf.amountMinor, payerWeights);
    payerRefs.forEach((ref, i) => {
      const row = rowOf(rf.currency, ref);
      row.paidMinor = plus(row.paidMinor, -payerParts[i]);
    });
    for (const line of rf.shares) {
      const row = rowOf(rf.currency, line.ref);
      row.shareMinor = plus(row.shareMinor, -line.amountMinor);
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
    const pending = (doc.groupSettlements || []).filter((s) => countReported && !s.voidedAt && s.status === 'reported' && s.currency === currency)
      .sort((p, q) => String(p.date).localeCompare(String(q.date)) || String(p.createdAt).localeCompare(String(q.createdAt)) || String(p.id).localeCompare(String(q.id)));
    // How much of each reported payment counts, used by the direct view too (financial recheck N-3).
    const counted = new Map();
    for (const s of pending) {
      const x = Math.min(s.amountMinor, Math.max(0, -left.get(s.from)), Math.max(0, left.get(s.to)));
      counted.set(s.id, x);
      if (x <= 0) continue;
      left.set(s.from, money.sum([left.get(s.from), x]));
      left.set(s.to, money.sum([left.get(s.to), -x]));
    }
    for (const r of rows) r.basisMinor = left.get(r.ref);
    out.push({
      currency, rows, suggestions: suggest(rows, rank), direct: direct(doc, currency, rank, countReported, counted),
      // BT-009-25: settlement units, a display/suggestion-only merge over the SAME rows above —
      // omitted (empty array) when no active unit exists, so every existing consumer of `balances()`
      // sees no change in shape unless units are actually in use.
      unitSuggestions: (doc.groupSettlementUnits || []).some((u) => u.active !== false) ? unitSuggest(rows, rank, doc.groupSettlementUnits) : [],
    });
  }
  return out;
}

// Currencies in which someone's balance is not zero (confirmed payments only). A workspace's reporting
// currency cannot change while any exists, and a payment may be recorded in any of them so an earlier
// currency's balance can always be cleared (financial review finding 3).
function openCurrencies(doc) {
  const refs = participants(doc, null).map((p) => p.ref);
  return balances(doc, refs).filter((b) => b.rows.some((r) => r.netMinor !== 0)).map((b) => b.currency);
}

// BT-009-26: "useful event spending, category, participant and settlement summaries derived from
// canonical calculations, respecting permissions and currencies" (Terry, 2026-09-19). Every number
// here is derived, on read, from the SAME records `balances()` already reads — never a second,
// independent calculation of anything; permission gating is the caller's (the same authority as
// balances/expenses already have — an insight is never shown to someone who could not already see
// the records behind it). One table per currency, exactly like `balances()`, so a multi-currency
// workspace's insights are never silently mixed into one meaningless total.
function insights(doc, order, { ensureCurrency = null } = {}) {
  doc = canonicalDoc(doc);
  const tables = new Map();
  const table = (currency) => {
    if (!tables.has(currency)) tables.set(currency, { currency, totalSpentMinor: 0, expenseCount: 0, byCategory: new Map(), byParticipant: new Map(), settlements: { confirmedMinor: 0, pendingMinor: 0, disputedMinor: 0, confirmedCount: 0, pendingCount: 0, disputedCount: 0 } });
    return tables.get(currency);
  };
  if (ensureCurrency) table(ensureCurrency);
  const byParticipantRow = (t, ref) => { if (!t.byParticipant.has(ref)) t.byParticipant.set(ref, { ref, paidMinor: 0, shareMinor: 0 }); return t.byParticipant.get(ref); };
  for (const e of doc.groupExpenses || []) {
    if (e.voidedAt) continue;
    const t = table(e.currency);
    t.totalSpentMinor = money.sum([t.totalSpentMinor, e.amountMinor]);
    t.expenseCount += 1;
    const catKey = e.categoryId || '__none__';
    if (!t.byCategory.has(catKey)) t.byCategory.set(catKey, { categoryId: e.categoryId || null, totalMinor: 0, count: 0 });
    const cat = t.byCategory.get(catKey);
    cat.totalMinor = money.sum([cat.totalMinor, e.amountMinor]);
    cat.count += 1;
    for (const p of e.payers || []) byParticipantRow(t, p.ref).paidMinor = money.sum([byParticipantRow(t, p.ref).paidMinor, p.amountMinor]);
    for (const s of e.shares || []) byParticipantRow(t, s.ref).shareMinor = money.sum([byParticipantRow(t, s.ref).shareMinor, s.amountMinor]);
  }
  for (const s of doc.groupSettlements || []) {
    if (s.voidedAt) continue;
    const t = table(s.currency);
    if (s.status === 'confirmed') { t.settlements.confirmedMinor = money.sum([t.settlements.confirmedMinor, s.amountMinor]); t.settlements.confirmedCount += 1; }
    else if (s.status === 'reported') { t.settlements.pendingMinor = money.sum([t.settlements.pendingMinor, s.amountMinor]); t.settlements.pendingCount += 1; }
    else if (s.status === 'disputed') { t.settlements.disputedMinor = money.sum([t.settlements.disputedMinor, s.amountMinor]); t.settlements.disputedCount += 1; }
  }
  const index = new Map(order.map((r, i) => [r, i]));
  const rank = (ref) => (index.has(ref) ? index.get(ref) : order.length);
  const out = [];
  for (const currency of [...tables.keys()].sort()) {
    const t = tables.get(currency);
    out.push({
      currency, totalSpentMinor: t.totalSpentMinor, expenseCount: t.expenseCount,
      byCategory: [...t.byCategory.values()].sort((a, b) => b.totalMinor - a.totalMinor),
      byParticipant: [...t.byParticipant.values()].sort((a, b) => rank(a.ref) - rank(b.ref)),
      settlements: t.settlements,
    });
  }
  return out;
}

// ---- personal ledger ---------------------------------------------------------------------------
// The entries a person's own account should hold for one record (the brief's EUR 300 dinner rule,
// completed by Terry's model of 2026-09-14, financial review finding 2). For each group and currency,
// on that account:
//   cash      = −(what they paid for expenses) + (repayments received) − (repayments made)
//   spending  = the sum of their shares of every active expense, whoever paid
//   owed      = advances − reimbursements − payables + repayments = their group balance
// so, per record:
//   expense    their share is spending (`expense`, in the expense's category). What they paid beyond
//              their share was lent (`advance`, money out); a share beyond what they paid is owed to
//              the others (`payable`, positive, no money moves). Together: −(what they paid).
//   settlement a CONFIRMED repayment to them is a `reimbursement` (money in); one they made is a
//              `repayment` (money out). Reported and disputed payments are not in the balance, so
//              they want nothing yet.
// Amounts are signed from the account holder's point of view (ledger.js). A void record wants none.
function desiredEntries(rec, type, ref) {
  if (rec.voidedAt) return [];
  if (type === 'expense') {
    const paid = sumByRef(rec.payers).get(ref) || 0;
    const share = sumByRef(rec.shares).get(ref) || 0;
    const out = [];
    if (share > 0) out.push({ kind: 'expense', amountMinor: -share, categoryId: rec.categoryId || null, date: rec.date });
    if (paid > share) out.push({ kind: 'advance', amountMinor: -(paid - share), categoryId: null, date: rec.date });
    if (share > paid) out.push({ kind: 'payable', amountMinor: share - paid, categoryId: null, date: rec.date });
    return out;
  }
  if (rec.status !== 'confirmed') return [];
  if (rec.to === ref) return [{ kind: 'reimbursement', amountMinor: rec.amountMinor, categoryId: null, date: rec.date }];
  if (rec.from === ref) return [{ kind: 'repayment', amountMinor: -rec.amountMinor, categoryId: null, date: rec.date }];
  return [];
}

const LINK_KEYS = Object.freeze({ expense: 'groupExpenseId', settlement: 'groupSettlementId' });

// Whether `subject` records `rec` on an account outside `accountIds` (restore planning): through their
// link for its currency, a per-record link of increment 1, or live entries of theirs.
function recordedOutside(doc, rec, type, subject, accountIds) {
  const key = LINK_KEYS[type];
  const links = [...(doc.groupLedgers || []).filter((l) => l.subject === subject && l.currency === rec.currency && !l.endedAt), ...(rec.ledgerLinks || []).filter((l) => l.subject === subject && !l.endedAt)];
  if (links.some((l) => !accountIds.has(l.accountId))) return true;
  return (doc.transactions || []).some((t) => t.createdBy === subject && t.links && t.links[key] === rec.id && !t.deletedAt && !t.reversedBy && !t.links.reverses && !accountIds.has(t.accountId));
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
    // BT-009-25: `e.itemization` is purely descriptive (the real, checked-above truth is
    // `e.split`/`e.shares`, produced from it once at creation) — validated lightly for shape and
    // real people, never re-derived or re-checked for reconciliation here.
    if (e.split.method === 'itemized') {
      const it = e.itemization;
      if (!it || !Array.isArray(it.lines) || !it.lines.length) return 'group expense itemization';
      for (const l of it.lines) {
        if (!l || typeof l.description !== 'string' || !l.description) return 'group expense itemization';
        if (!Number.isFinite(l.quantity) || l.quantity <= 0) return 'group expense itemization';
        if (!money.isMinor(l.unitPriceMinor) || l.unitPriceMinor <= 0) return 'group expense itemization';
        if (!Array.isArray(l.refs) || !l.refs.length || l.refs.some((r) => !refOk(r))) return 'group expense itemization';
      }
      for (const key of ['taxMinor', 'tipMinor', 'discountMinor', 'feeMinor']) {
        if (!money.isMinor(it[key]) || it[key] < 0) return 'group expense itemization';
      }
    } else if (e.itemization !== undefined && e.itemization !== null) return 'group expense itemization';
  }
  for (const s of doc.groupSettlements || []) {
    if (!money.isCurrency(s.currency) || !money.isMinor(s.amountMinor) || s.amountMinor <= 0) return 'group settlement amounts';
    if (!refOk(s.from) || !refOk(s.to) || s.from === s.to) return 'group settlement people';
    if (!SETTLEMENT_STATES.includes(s.status)) return 'group settlement state';
  }
  // Personal ledger links and the entries they make (security review S8). Documents without them —
  // older archives — pass unchanged.
  const subjects = new Set((doc.members || []).map((m) => m.subject));
  const accountsById = new Map((doc.accounts || []).map((a) => [a.id, a]));
  const activeLinks = new Set();
  for (const l of doc.groupLedgers || []) {
    if (!l || typeof l.id !== 'string' || !subjects.has(l.subject) || !money.isCurrency(l.currency)) return 'group ledger link';
    const a = accountsById.get(l.accountId);
    if (!a || a.currency !== l.currency) return 'group ledger link';
    if (!l.endedAt) {
      const k = `${l.subject}|${l.currency}`;
      if (activeLinks.has(k)) return 'group ledger link';
      activeLinks.add(k);
    }
  }
  // BT-009-20: every shared-expense event has a stable id, a valid lifecycle status, and every
  // expense/settlement's `eventId`, when set, names a real one. A record without an `eventId` at
  // all (a document from before events existed, not yet migrated) passes unchanged — the same
  // tolerance the ledger-link check just above already applies to older archives.
  const eventIds = (doc.groupEvents || []).map((e) => e.id);
  if (unique(eventIds).length !== eventIds.length) return 'group event ids';
  for (const e of doc.groupEvents || []) {
    if (typeof e.id !== 'string' || !e.id) return 'group event ids';
    if (!['active', 'closed', 'archived'].includes(e.status)) return 'group event status';
  }
  const events = new Set(eventIds);
  for (const r of [...(doc.groupExpenses || []), ...(doc.groupSettlements || [])]) {
    if (r.eventId !== undefined && r.eventId !== null && !events.has(r.eventId)) return 'group event reference';
  }
  for (const r of [...(doc.groupExpenses || []), ...(doc.groupSettlements || [])]) {
    if (r.ledgerLinks === undefined) continue;
    if (!Array.isArray(r.ledgerLinks)) return 'group ledger link';
    const active = new Set();
    for (const l of r.ledgerLinks) {
      if (!l || !subjects.has(l.subject) || !accountsById.has(l.accountId)) return 'group ledger link';
      if (!l.endedAt) {
        if (active.has(l.subject)) return 'group ledger link';
        active.add(l.subject);
      }
    }
  }
  // An entry recorded from a shared expense or payment names a record that exists — in the lists, or
  // set aside whole by a replace restore (nothing is ever deleted).
  const setAside = (collection) => (doc.superseded || []).filter((s) => s && s.collection === collection && s.record).map((s) => s.record.id);
  const expenseIds = new Set([...(doc.groupExpenses || []).map((e) => e.id), ...setAside('groupExpenses')]);
  const settlementIds = new Set([...(doc.groupSettlements || []).map((s) => s.id), ...setAside('groupSettlements')]);
  for (const t of doc.transactions || []) {
    const l = t.links || {};
    if (l.groupExpenseId !== undefined && l.groupExpenseId !== null && !expenseIds.has(l.groupExpenseId)) return 'transaction group link';
    if (l.groupSettlementId !== undefined && l.groupSettlementId !== null && !settlementIds.has(l.groupSettlementId)) return 'transaction group link';
  }
  // BT-009-25: a linked refund names a real expense — live, or set aside whole by a replace restore
  // (nothing is ever deleted), same tolerance as a transaction's own group link just above. Refunds
  // no more than that expense's own total (nor more than it, together with every other active
  // refund against the same expense — checked only when the expense is still live, since a set-
  // aside expense's own amount is no longer directly at hand to check against); its allocation
  // (`split`/`shares`) is exactly the same shape/rounding discipline as a real expense's split —
  // one canonical calculation, reused, never a second one invented for refunds.
  {
    const liveExpenseById = new Map((doc.groupExpenses || []).map((e) => [e.id, e]));
    const refundedSoFar = new Map();
    for (const rf of doc.groupRefunds || []) {
      if (!money.isCurrency(rf.currency) || !money.isMinor(rf.amountMinor) || rf.amountMinor <= 0) return 'group refund amounts';
      if (!expenseIds.has(rf.refundOf)) return 'group refund reference';
      if (storedSplitBroken(rf.split, rf.amountMinor)) return 'group refund split';
      let expected;
      try {
        if (rf.split.lines.length !== rf.shares.length) throw new Error('split');
        expected = computeShares(rf.amountMinor, rf.split).shares;
      } catch { return 'group refund shares'; }
      if (expected.some((s, i) => s.ref !== rf.shares[i].ref || s.amountMinor !== rf.shares[i].amountMinor)) return 'group refund shares';
      if (rf.shares.some((s) => !refOk(s.ref))) return 'group refund shares';
      const e = liveExpenseById.get(rf.refundOf);
      if (e) {
        if (rf.currency !== e.currency) return 'group refund currency';
        if (!rf.voidedAt) {
          const before = refundedSoFar.get(rf.refundOf) || 0;
          const after = before + rf.amountMinor;
          if (after > e.amountMinor) return 'group refund total exceeds expense';
          refundedSoFar.set(rf.refundOf, after);
        }
      }
    }
  }
  // BT-009-25: a saved split preset names a real method (never a money-shaped one — presets are
  // proportions, reusable across different expense sizes) and real people; unlike a real split it
  // is never checked against any particular total, so `storedSplitBroken` does not apply to it.
  for (const p of doc.groupSplitPresets || []) {
    if (!PRESET_METHODS.includes(p.method)) return 'split preset method';
    if (!Array.isArray(p.lines) || !p.lines.length || unique(p.lines.map((l) => l.ref)).length !== p.lines.length) return 'split preset lines';
    if (p.lines.some((l) => !refOk(l.ref))) return 'split preset lines';
    if (p.method === 'shares' && p.lines.some((l) => !Number.isInteger(l.value) || l.value < 1 || l.value > MAX_SHARES)) return 'split preset lines';
    if (p.method === 'percentages') {
      let sum = 0;
      for (const l of p.lines) { try { sum += percentUnits(l.value); } catch { return 'split preset lines'; } }
      if (sum !== HUNDRED_PERCENT) return 'split preset lines';
    }
  }
  // BT-009-25: a settlement unit (couples/families) names >=2 distinct real participants; a member
  // may belong to at most one ACTIVE unit at a time (an unambiguous merge — never two units both
  // claiming the same person). An inactive (deleted) unit is kept for audit but excluded from this
  // overlap check, exactly like an archived record elsewhere in this codebase.
  {
    const ids = (doc.groupSettlementUnits || []).map((u) => u.id);
    if (unique(ids).length !== ids.length) return 'settlement unit ids';
    const claimed = new Set();
    for (const u of doc.groupSettlementUnits || []) {
      if (typeof u.id !== 'string' || !u.id) return 'settlement unit ids';
      if (!Array.isArray(u.memberRefs) || u.memberRefs.length < 2) return 'settlement unit members';
      if (unique(u.memberRefs).length !== u.memberRefs.length) return 'settlement unit members';
      if (u.memberRefs.some((ref) => !refOk(ref))) return 'settlement unit members';
      if (u.active === false) continue;
      for (const ref of u.memberRefs) {
        if (claimed.has(ref)) return 'settlement unit overlap';
        claimed.add(ref);
      }
    }
  }
  // BT-009-25: a shared-income/deposit contribution names two real people (never the same one
  // twice) and never claims to have applied or returned more than it actually holds — the same
  // "never more than what exists" discipline every other financial record here already has.
  for (const c of doc.groupContributions || []) {
    if (!money.isCurrency(c.currency) || !money.isMinor(c.amountMinor) || c.amountMinor <= 0) return 'group contribution amounts';
    if (!refOk(c.contributor) || !refOk(c.holder) || c.contributor === c.holder) return 'group contribution people';
    if (!money.isMinor(c.appliedMinor) || c.appliedMinor < 0) return 'group contribution applied';
    if (!money.isMinor(c.returnedMinor) || c.returnedMinor < 0) return 'group contribution returned';
    if (c.appliedMinor + c.returnedMinor > c.amountMinor) return 'group contribution total exceeds amount';
  }
  // BT-009-26: an in-app payment reminder names two different real people, a positive amount in a
  // real currency, and a status from its own small lifecycle — it moves no money itself, so there
  // is nothing to reconcile against a balance, just the same shape discipline as everything else.
  const REQUEST_STATUSES = ['open', 'dismissed', 'cancelled'];
  for (const r of doc.groupPaymentRequests || []) {
    if (!refOk(r.from) || !refOk(r.to) || r.from === r.to) return 'group payment request people';
    if (!money.isCurrency(r.currency) || !money.isMinor(r.amountMinor) || r.amountMinor <= 0) return 'group payment request amount';
    if (!REQUEST_STATUSES.includes(r.status)) return 'group payment request status';
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

// BT-014, Terry 2026-09-17: deletion behaviour depends on "whether the shared expense involves
// another workspace ... Contacts without their own participating workspace do not count as
// another workspace." Every participant a shared expense can name today is either an active
// member of THIS workspace (`member:<id>`) or a contact recorded IN this workspace's own
// `contacts[]` (`contact:<id>`, created by api/contacts, scoped to `workspaceId` — see
// participantChecker above, which refuses a private, cross-workspace contact outright). No field
// anywhere in this codebase links a shared-expense record, a contact or a workspace to ANOTHER
// workspace's id (confirmed by a repository-wide search before writing this); BT-010 (trip/
// multicurrency) and the rest of BT-009-11 remain planned, not built. So every shared expense
// this workspace holds today is, by construction, "managed solely by this workspace" — the
// sever-and-preserve-for-the-other-side branch of Terry's rule is not reachable YET. This
// function exists so that branch has exactly one place to become real later (once a contact or
// record can carry another workspace's id) instead of being silently assumed away at every call
// site: it returns the (today always empty) list of foreign workspace ids a shared expense would
// need severing from, so callers can plainly show "no foreign participation found" rather than
// having to know the reason themselves.
function foreignWorkspaceIds(doc) {
  void doc;
  return [];
}

module.exports = {
  METHODS, PRESET_METHODS, SETTLEMENT_STATES, MAX_LINES, MAX_GROUP_MINOR, HUNDRED_PERCENT,
  percentUnits, percentText, positiveAmount, computeShares, normalizeSplit, computeItemization, normalizePayers, participantChecker,
  participants, recordRefs, sumByRef, balances, insights, openCurrencies, desiredEntries, recordedOutside, invariantProblem, memberIds,
  foreignWorkspaceIds, canonicalRef, canonicalDoc,
};
