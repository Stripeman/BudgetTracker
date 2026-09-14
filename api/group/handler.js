'use strict';
// /api/group?workspaceId=   Shared expenses and settlement (BT-009)
//   GET                                     participants, expenses, settlements, balances per currency
//                                           (with suggestions and the direct view) and the caller's rights
//   GET  ?action=balances                   balances only
//   GET  ?action=history&expenseId= | &settlementId=   who changed what, from what to what, when, why
//   POST { description, date?, amount, currency?, categoryId?, notes?, payers, split, ledger? }
//                                           add an expense (Idempotency-Key supported)
//   PATCH { expenseId, revision, reason, description?, date?, amount?, categoryId?, notes?, payers?, split? }
//   POST ?action=void    { expenseId | settlementId, revision, reason }
//   POST ?action=settle  { from, to, amount, currency?, date?, method?, notes?, ledger? }  report a
//                                           payment (Idempotency-Key supported)
//   POST ?action=confirm { settlementId, revision, ledger? }
//   POST ?action=dispute { settlementId, revision, reason }
//   POST ?action=ledger  { expenseId | settlementId | currency, accountId? }  record the caller's part of
//                                           the group in that currency on their own private account
//                                           (accountId), bring their entries up to date (no accountId)
//                                           or stop recording (accountId: null)
//
// A group needs no account: an expense records who paid and who shared, nothing more (Terry,
// 2026-09-14). Nothing is ever deleted (BT-001-05): corrections keep before and after values with a
// reason; expenses and payments are voided, never removed, and stay listed.
//
// PERMISSIONS (server-side, deny by default; non-members, site administrators included, get 404):
//   viewers read only; members, managers and owners add expenses and report payments; the person who
//   added an expense or payment, or a manager or owner, corrects or voids it; the receiving member
//   confirms or disputes a payment to them; a manager or owner confirms a payment to a contact.
//
// SETTLEMENT STATES: reported (someone says it was paid) → confirmed (by the receiver) or disputed
// (by the receiver, with a reason) → confirmed. A payment reported by its receiver starts confirmed.
// Any of them can be voided with a reason. Only confirmed payments count in the net; reported ones
// are pending and disputed ones are shown apart. Suggested payments are computed, never stored.
//
// PERSONAL LEDGER (the brief's EUR 300 dinner rule, completed by Terry's model of 2026-09-14): anyone
// in the group may record their own part of it, per currency, on ONE private account of their own
// (security review S2). On that account, per group and currency: the entries move exactly the cash
// they moved; their shares of every active expense, whoever paid, are spending (`expense`); what they
// paid for others is `advance`, shares they did not pay are `payable`, confirmed repayments to them are
// `reimbursement` and by them `repayment` — so advances − reimbursements − payables + repayments is
// their group balance (financial review finding 2). The link is visible only to its owner; nobody else
// learns which account, balance, entry or note is involved. Only the owner ever writes there, and only
// their own entries (server-set `createdBy`) are counted or reversed (finding 1): when they add, change
// or void a record, their entries follow at once by reversal and new entries (never by rewriting); when
// someone else does, their entries are shown as needing review until they bring them up to date with
// ?action=ledger. The link is in `doc.groupLedgers`, never on a shared record, so it never changes a
// record's revision.
const { readBody, query, header, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { roleAtLeast, can, capabilitiesFor, canChangeRecord } = require('../_shared/authz');
const store = require('../_shared/store');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const ledger = require('../_shared/ledger');
const groups = require('../_shared/groups');
const groupSettings = require('../_shared/group-settings');
const entries = require('../_shared/entries');
const model = require('../_shared/workspace-model');
const siteSettings = require('../_shared/site');
const workspaceSettings = require('../_shared/workspace-settings');

const CREATE_KEYS = ['description', 'date', 'amount', 'currency', 'categoryId', 'notes', 'payers', 'split', 'ledger'];
const PATCH_KEYS = ['expenseId', 'revision', 'reason', 'description', 'date', 'amount', 'categoryId', 'notes', 'payers', 'split'];
const SETTLE_KEYS = ['from', 'to', 'amount', 'currency', 'date', 'method', 'notes', 'ledger'];
// Every correction keeps the before and after values of these fields.
const TRACKED = ['description', 'date', 'amountMinor', 'categoryId', 'notes', 'payers', 'split', 'shares'];
const LINK_KEY = Object.freeze({ expense: 'groupExpenseId', settlement: 'groupSettlementId' });

const selfRef = (member) => `member:${member.id}`;
const isManager = (member) => roleAtLeast(member.role, 'manager');
const writer = (member) => member.role !== 'viewer';
function requireWriter(member) {
  if (!writer(member)) throw forbidden('Viewers can see shared expenses but cannot add or change them.');
}
const reportingCurrency = (doc) => (doc.settings && doc.settings.reportingCurrency) || 'EUR';
// New expenses are in the reporting currency only in this increment (multi-currency group totals are
// pending, BT-009).
function currencyOf(doc, value) {
  const c = reportingCurrency(doc);
  if (value !== undefined && value !== null && value !== c) throw badRequest(`Shared expenses in this workspace are in ${c}. Other currencies are not supported yet.`, 'currency_not_supported');
  return c;
}
// A payment may also be in any currency that still has an open balance, so a balance left in an
// earlier reporting currency can always be cleared (financial review finding 3).
function settlementCurrency(doc, value) {
  const c = reportingCurrency(doc);
  if (value === undefined || value === null || value === c) return c;
  if (typeof value === 'string' && groups.openCurrencies(doc).includes(value)) return value;
  throw badRequest(`Payments in this workspace are in ${c}, or in a currency that still has an open balance. Nobody owes anything in that currency.`, 'currency_not_supported');
}
const nameOf = (doc, subject) => { const m = model.memberBySubject(doc, subject); return m ? m.name || 'Member' : 'Former member'; };

function checkRevision(rec, revision) {
  if (!Number.isSafeInteger(revision)) throw badRequest('revision is required so a stale change cannot overwrite a newer one.', 'missing_revision');
  if (revision !== rec.revision) throw conflict('This changed since you loaded it. Reload to see the latest version.', 'stale_revision');
}
const requireReason = (value, what) => {
  const reason = fields.text(value, { field: 'Reason', max: 200 });
  if (!reason) throw badRequest(`Give a reason for ${what}. It is kept with the history.`, 'reason_required');
  return reason;
};

function checkCategory(doc, value, current = null) {
  const id = fields.optionalId(value, 'Category');
  if (!id) return null;
  const c = (doc.categories || []).find((x) => x.id === id);
  if (!c || (c.archived && id !== current)) throw badRequest('Unknown category.', 'invalid_category');
  return id;
}

const findExpense = (doc, id) => {
  const e = (doc.groupExpenses || []).find((x) => x.id === id);
  if (!e) throw notFound('Unknown expense.');
  return e;
};
const findSettlement = (doc, id) => {
  const s = (doc.groupSettlements || []).find((x) => x.id === id);
  if (!s) throw notFound('Unknown payment.');
  return s;
};
const canChangeExpense = (e, member) => writer(member) && (e.createdBy === member.subject || isManager(member));

// The amount, payers, split and resulting shares, from the request and (for a correction) the record.
function expenseMoney(doc, body, rec) {
  const currency = rec ? rec.currency : currencyOf(doc, body.currency);
  const check = groups.participantChecker(doc, rec ? new Set(groups.recordRefs({ groupExpenses: [rec] })) : new Set());
  const amountMinor = !rec || body.amount !== undefined ? groups.positiveAmount(body.amount, currency, 'Amount') : rec.amountMinor;
  let payers;
  if (!rec || body.payers !== undefined) payers = groups.normalizePayers(body.payers, amountMinor, currency, check);
  else {
    payers = structuredClone(rec.payers);
    if (money.sum(payers.map((p) => p.amountMinor)) !== amountMinor) throw badRequest('The amount changed, so say again who paid how much.', 'payer_total');
  }
  let split;
  if (!rec || body.split !== undefined) split = groups.normalizeSplit(body.split, amountMinor, currency, check);
  else {
    split = structuredClone(rec.split);
    if (split.method === 'amounts' && money.sum(split.lines.map((l) => l.value)) !== amountMinor) throw badRequest('The amount changed, so give the split amounts again.', 'split_amount_total');
  }
  const shares = groups.computeShares(amountMinor, split).shares.map(({ ref, amountMinor: a }) => ({ ref, amountMinor: a }));
  return { currency, amountMinor, payers, split, shares };
}

// ---- the personal ledger ------------------------------------------------------------------------
// One link per person and currency (`doc.groupLedgers`): the account where that person records their
// own part of every shared expense and payment in that currency (Terry, 2026-09-14). It must be their
// OWN PRIVATE account (security review S2): nobody else can see which account or write to it. A
// per-record link from increment 1 (`rec.ledgerLinks`) still counts for its record while the person has
// no link for that currency, and only when it points at their own private account.
const ownPrivateAccount = (doc, accountId, subject) => {
  const a = (doc.accounts || []).find((x) => x.id === accountId);
  return a && !a.deletedAt && a.visibility === 'private' && a.ownerSubject === subject ? a : null;
};
const groupLink = (doc, subject, currency) => (doc.groupLedgers || []).find((l) => l.subject === subject && l.currency === currency && !l.endedAt) || null;
const recordLink = (rec, subject) => (rec.ledgerLinks || []).find((l) => l.subject === subject && !l.endedAt) || null;
function targetOf(doc, rec, subject) {
  const g = groupLink(doc, subject, rec.currency);
  if (g) return g.accountId;
  const l = recordLink(rec, subject);
  return l && ownPrivateAccount(doc, l.accountId, subject) ? l.accountId : null;
}

// A person's live entries for one record, on any account: not deleted, not reversed, not reversals.
// An entry is theirs when they created it — `createdBy` is set by the server and never edited, and
// clients cannot add group links (S3) — so one person's update never counts, compares or reverses
// another person's entries (financial review finding 1).
const isLive = (t) => !!t.links && !t.deletedAt && !t.reversedBy && !t.links.reverses;
function liveEntries(doc, rec, type, subject) {
  const key = LINK_KEY[type];
  return (doc.transactions || []).filter((t) => isLive(t) && t.links[key] === rec.id && t.createdBy === subject);
}
// The same, indexed once for a whole view.
function entryIndex(doc, subject) {
  const map = new Map();
  for (const t of doc.transactions || []) {
    if (t.createdBy !== subject || !isLive(t)) continue;
    for (const [type, key] of Object.entries(LINK_KEY)) {
      if (!t.links[key]) continue;
      const k = `${type}|${t.links[key]}`;
      map.set(k, [...(map.get(k) || []), t]);
    }
  }
  return (rec, type) => map.get(`${type}|${rec.id}`) || [];
}
const entryKey = (x) => `${x.kind}|${x.amountMinor}|${x.categoryId || ''}|${x.date}`;
const sameEntries = (live, desired) => JSON.stringify(live.map(entryKey).sort()) === JSON.stringify(desired.map(entryKey).sort());

const NOTES = Object.freeze({
  expense: (rec) => `My share of shared expense: ${rec.description}`,
  advance: (rec) => `Paid for others in shared expense: ${rec.description}`,
  payable: (rec) => `Owed to others for shared expense: ${rec.description}`,
  reimbursement: () => 'Repayment received in Shared expenses',
  repayment: () => 'Repayment made in Shared expenses',
});

// Brings the caller's own entries for one record in line with it on their account: reverses what no
// longer matches (or sits on another account) and adds what the record now needs, in the same write.
// Only the entries' owner runs this. Returns 'same', 'updated' or the problem that stopped it; `strict`
// throws the problem instead (otherwise the entries are left for the owner to review — a derived
// "needs review", never a stored flag).
function syncRecord(ctx, doc, member, rec, type, { reason, strict }) {
  const now = ctx.now();
  const nowIso = ctx.nowIso();
  // Nothing is ever written to an account that is not the person's own private account (security
  // recheck R1). A link whose account stopped being theirs (for example shared) needs another account.
  const link = groupLink(doc, member.subject, rec.currency);
  if (link && !ownPrivateAccount(doc, link.accountId, member.subject)) {
    if (strict) throw conflict('The account your shared expenses are recorded on is no longer your own private account. Choose another private account of yours in Shared expenses.', 'account_not_own');
    return 'not_own';
  }
  const live = liveEntries(doc, rec, type, member.subject);
  // Entries already on an account that is no longer theirs are real cash history: kept exactly as
  // recorded — never reversed, and never recorded again on another account.
  if (live.some((t) => !ownPrivateAccount(doc, t.accountId, member.subject))) return 'same';
  const targetId = targetOf(doc, rec, member.subject);
  const desired = targetId ? groups.desiredEntries(rec, type, selfRef(member)) : [];
  const onTarget = live.filter((t) => t.accountId === targetId);
  const elsewhere = live.filter((t) => t.accountId !== targetId);
  const matches = sameEntries(onTarget, desired);
  if (matches && !elsewhere.length) return 'same';
  const toReverse = matches ? elsewhere : live;
  const toAdd = matches ? [] : desired;
  const touched = [...new Set([...toReverse.map((t) => t.accountId), ...(toAdd.length ? [targetId] : [])])];
  for (const id of touched) {
    const account = (doc.accounts || []).find((a) => a.id === id);
    let problem = null;
    if (!account || account.deletedAt || capabilitiesFor(doc, ctx.principal, account, now).size === 0) problem = 'unavailable';
    else if (account.status === 'closed') problem = 'closed';
    else if (account.currency !== rec.currency) problem = 'currency';
    else if (!can(doc, ctx.principal, account, 'create', now) || toReverse.some((t) => t.accountId === id && !canChangeRecord(doc, ctx.principal, account, t, 'edit', now))) problem = 'rights';
    if (!problem) continue;
    if (!strict) return problem;
    if (problem === 'unavailable') throw notFound('Unknown account.');
    if (problem === 'closed') throw conflict(`${account.name} is closed. Reopen it on the Accounts page to update its entries.`, 'account_closed');
    if (problem === 'currency') throw badRequest(`${account.name} is in ${account.currency}, not ${rec.currency}.`, 'currency_mismatch');
    throw forbidden('You cannot change the entries on this account.');
  }
  const key = LINK_KEY[type];
  for (const t of toReverse) {
    const rev = entries.reverseEntry(doc, t, { by: member.subject, at: nowIso, reason, links: { [key]: rec.id } });
    audit.record(doc, { actor: member.subject, action: 'transaction.reverse', targetType: 'transaction', targetId: t.id, scope: `account:${t.accountId}`, at: nowIso });
    audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: rev.id, scope: `account:${t.accountId}`, at: nowIso });
  }
  for (const d of toAdd) {
    const t = entries.newEntry({ accountId: targetId, currency: rec.currency, kind: d.kind, amountMinor: d.amountMinor, date: d.date, categoryId: d.categoryId, notes: NOTES[d.kind](rec), links: { [key]: rec.id }, by: member.subject, at: nowIso });
    doc.transactions = [...(doc.transactions || []), t];
    audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: t.id, scope: `account:${targetId}`, at: nowIso });
  }
  ledger.assertLedgerInRange(doc);
  return 'updated';
}

const reasonFor = (rec, type, fallback) => (rec.voidedAt ? `${type === 'expense' ? 'Shared expense' : 'Repayment'} voided: ${rec.voidReason || ''}`.trim() : fallback);

// Every record in one currency, for the caller. Records whose entries sit on an account the caller
// cannot change now are left as they are (they stay "needs review") and counted.
function syncCurrency(ctx, doc, member, currency, reason) {
  const out = { updated: 0, blocked: 0 };
  for (const [type, list] of [['expense', doc.groupExpenses || []], ['settlement', doc.groupSettlements || []]]) {
    for (const rec of list) {
      if (rec.currency !== currency) continue;
      const r = syncRecord(ctx, doc, member, rec, type, { reason: reasonFor(rec, type, reason), strict: false });
      if (r === 'updated') out.updated += 1;
      else if (r !== 'same') out.blocked += 1;
    }
  }
  return out;
}

function checkOwnAccount(ctx, doc, member, accountId, currency) {
  const account = (doc.accounts || []).find((a) => a.id === accountId && !a.deletedAt);
  if (!account || capabilitiesFor(doc, ctx.principal, account, ctx.now()).size === 0) throw notFound('Unknown account.');
  if (!ownPrivateAccount(doc, account.id, member.subject)) throw badRequest('Choose a private account of your own. Shared accounts and other people\'s accounts cannot be used, because only you may see which account your shared expenses are recorded on.', 'not_own_account');
  if (account.status === 'closed') throw conflict(`${account.name} is closed. Choose an open account.`, 'account_closed');
  if (account.currency !== currency) throw badRequest(`${account.name} is in ${account.currency}, but this is in ${currency}. Choose an account in ${currency}.`, 'currency_mismatch');
  return account;
}

function endRecordLinks(doc, member, currency, nowIso, why) {
  for (const rec of [...(doc.groupExpenses || []), ...(doc.groupSettlements || [])]) {
    if (rec.currency !== currency) continue;
    const l = recordLink(rec, member.subject);
    if (l) { l.endedAt = nowIso; l.endReason = why; }
  }
}

// Records all of the caller's part in one currency on one of their own private accounts (or moves it
// there), ending any per-record links of increment 1 in that currency, and brings it all up to date.
function linkCurrency(ctx, doc, member, currency, accountId) {
  const nowIso = ctx.nowIso();
  const account = checkOwnAccount(ctx, doc, member, accountId, currency);
  const current = groupLink(doc, member.subject, currency);
  if (!current || current.accountId !== account.id) {
    if (current) { current.endedAt = nowIso; current.endReason = 'Recorded on another account instead'; }
    endRecordLinks(doc, member, currency, nowIso, 'Replaced by one account for every shared expense');
    const link = { id: newId('gld'), subject: member.subject, currency, accountId: account.id, linkedAt: nowIso, endedAt: null };
    // The caller's private bookkeeping: it never changes a shared record's revision.
    doc.groupLedgers = [...(doc.groupLedgers || []), link];
    audit.record(doc, { actor: member.subject, action: 'group.ledger.link', targetType: 'group-ledger', targetId: link.id, scope: `self:${member.subject}`, at: nowIso });
  }
  return syncCurrency(ctx, doc, member, currency, 'Shared expenses');
}

// Stops recording in one currency: the link is kept as ended and every entry it made is reversed.
function unlinkCurrency(ctx, doc, member, currency) {
  const nowIso = ctx.nowIso();
  const current = groupLink(doc, member.subject, currency);
  if (current) {
    const account = (doc.accounts || []).find((a) => a.id === current.accountId);
    if (account && !account.deletedAt && account.status === 'closed') throw conflict(`${account.name} is closed. Reopen it on the Accounts page first, so its entries can be reversed.`, 'account_closed');
    current.endedAt = nowIso;
    current.endReason = 'Stopped recording';
    audit.record(doc, { actor: member.subject, action: 'group.ledger.unlink', targetType: 'group-ledger', targetId: current.id, scope: `self:${member.subject}`, at: nowIso });
  }
  endRecordLinks(doc, member, currency, nowIso, 'Stopped recording');
  return syncCurrency(ctx, doc, member, currency, 'No longer recorded from Shared expenses');
}

// After the caller adds, changes or voids a record, their own entries follow in the same write when they can.
function followOwnLink(ctx, doc, member, rec, type, reason) {
  syncRecord(ctx, doc, member, rec, type, { reason, strict: false });
}

// What the caller has recorded for one record, shown only to them.
function myLedger(ctx, doc, member, rec, type, entriesFor = entryIndex(doc, member.subject)) {
  const targetId = targetOf(doc, rec, member.subject);
  const live = entriesFor(rec, type);
  const desired = targetId ? groups.desiredEntries(rec, type, selfRef(member)) : [];
  if (!live.length && !desired.length) return null;
  const now = ctx.now();
  const sees = (id) => { const a = (doc.accounts || []).find((x) => x.id === id); return a && !a.deletedAt && capabilitiesFor(doc, ctx.principal, a, now).size > 0 ? a : null; };
  // Kept as recorded on an account that is no longer their own private account (R1): nothing to update.
  const foreign = live.find((t) => !ownPrivateAccount(doc, t.accountId, member.subject));
  if (foreign) {
    const where = sees(foreign.accountId);
    return {
      accountId: where ? where.id : null, accountName: where ? where.name : null, accountUnavailable: !where, needsReview: false, kept: true,
      entries: live.filter((t) => sees(t.accountId)).map((t) => ({ id: t.id, kind: t.kind, amount: money.toDecimal(t.amountMinor, t.currency) })),
    };
  }
  const account = targetId ? sees(targetId) : null;
  return {
    accountId: account ? account.id : null, accountName: account ? account.name : null, accountUnavailable: !!targetId && !account,
    needsReview: live.some((t) => t.accountId !== targetId) || !sameEntries(live.filter((t) => t.accountId === targetId), desired),
    entries: live.filter((t) => sees(t.accountId)).map((t) => ({ id: t.id, kind: t.kind, amount: money.toDecimal(t.amountMinor, t.currency) })),
  };
}

// The caller's current links, one per currency, with how many records need updating.
function myLedgers(ctx, doc, member, entriesFor) {
  const now = ctx.now();
  return (doc.groupLedgers || []).filter((l) => l.subject === member.subject && !l.endedAt).map((l) => {
    const a = (doc.accounts || []).find((x) => x.id === l.accountId);
    const visible = !!a && !a.deletedAt && capabilitiesFor(doc, ctx.principal, a, now).size > 0;
    let reviewCount = 0;
    for (const [type, list] of [['expense', doc.groupExpenses || []], ['settlement', doc.groupSettlements || []]]) {
      for (const rec of list) {
        if (rec.currency !== l.currency) continue;
        const m = myLedger(ctx, doc, member, rec, type, entriesFor);
        if (m && m.needsReview) reviewCount += 1;
      }
    }
    // A link whose account stopped being its owner's private account writes nothing until they choose
    // another one (R1); it counts as unavailable so the choice is offered again.
    const own = !!ownPrivateAccount(doc, l.accountId, member.subject);
    return { currency: l.currency, accountId: visible ? a.id : null, accountName: visible ? a.name : null, accountUnavailable: !visible || !own, needsAccount: !own, since: l.linkedAt, reviewCount };
  });
}

// ---- views ---------------------------------------------------------------------------------------
function expenseView(ctx, doc, member, e) {
  const dec = (m) => money.toDecimal(m, e.currency);
  let computed = null;
  try { computed = groups.computeShares(e.amountMinor, e.split); } catch { computed = null; }
  const adjustment = (i) => (computed && computed.shares[i] && computed.shares[i].ref === e.shares[i].ref && computed.shares[i].amountMinor === e.shares[i].amountMinor ? computed.shares[i].adjustmentMinor : 0);
  const residualMinor = computed ? computed.residualMinor : 0;
  const changeable = canChangeExpense(e, member) && !e.voidedAt;
  const out = {
    id: e.id, description: e.description, date: e.date, currency: e.currency, amount: dec(e.amountMinor), amountMinor: e.amountMinor,
    categoryId: e.categoryId || null, notes: e.notes || '',
    payers: e.payers.map((p) => ({ ref: p.ref, amount: dec(p.amountMinor), amountMinor: p.amountMinor })),
    split: { method: e.split.method, lines: e.split.lines.map((l) => ({ ref: l.ref, value: e.split.method === 'amounts' ? dec(l.value) : l.value })) },
    shares: e.shares.map((s, i) => ({ ref: s.ref, amount: dec(s.amountMinor), amountMinor: s.amountMinor, adjustmentMinor: adjustment(i) })),
    rounding: { residualMinor, residual: dec(residualMinor) },
    status: e.voidedAt ? 'void' : 'active', voidedAt: e.voidedAt || null, voidReason: e.voidReason || '', voidedBy: e.voidedBy ? nameOf(doc, e.voidedBy) : null,
    createdBy: nameOf(doc, e.createdBy), createdBySelf: e.createdBy === member.subject, createdAt: e.createdAt, updatedAt: e.updatedAt || null,
    revision: e.revision, amendmentCount: (e.amendments || []).length, canEdit: changeable, canVoid: changeable,
  };
  const mine = myLedger(ctx, doc, member, e, 'expense');
  if (mine) out.myLedger = mine;
  return out;
}

function settlementView(ctx, doc, member, s) {
  const me = selfRef(member);
  const toContact = s.to.startsWith('contact:');
  const live = !s.voidedAt;
  const open = live && writer(member);
  const out = {
    id: s.id, from: s.from, to: s.to, amount: money.toDecimal(s.amountMinor, s.currency), amountMinor: s.amountMinor, currency: s.currency,
    date: s.date, method: s.method || '', notes: s.notes || '', status: s.status, voided: !!s.voidedAt,
    voidedAt: s.voidedAt || null, voidReason: s.voidReason || '', voidedBy: s.voidedBy ? nameOf(doc, s.voidedBy) : null,
    disputeReason: s.disputeReason || '', confirmedBy: s.confirmedBy ? nameOf(doc, s.confirmedBy) : null, confirmedAt: s.confirmedAt || null,
    // Confirmed by the manager or owner who reported it (S5); a confirmation withdrawn by a void (S6).
    confirmedByReporter: !!s.confirmedByReporter, withdrawn: !!s.withdrawn,
    // Who confirmed, relative to the payment: its receiver, the person who paid it, or someone else.
    confirmation: s.status === 'confirmed' && s.confirmedBy ? {
      by: nameOf(doc, s.confirmedBy),
      relation: (() => { const m = model.memberBySubject(doc, s.confirmedBy); const ref = m ? `member:${m.id}` : null; return ref === s.to ? 'receiver' : ref === s.from ? 'payer' : 'other'; })(),
    } : null,
    createdBy: nameOf(doc, s.createdBy), createdBySelf: s.createdBy === member.subject, createdAt: s.createdAt, revision: s.revision,
    // Confirming follows the group setting "Anyone in the group can confirm payments": any member who can
    // add to the group, or a viewer for a payment made to them (S7); when it is off, the payer never
    // confirms (S5). Once confirmed, only the receiving member or a manager or owner may withdraw it (S6).
    // Per person (Terry, 2026-09-14): an owner's or manager's override for this member, otherwise the group setting.
    canConfirm: live && s.status !== 'confirmed' && (s.to === me || (groupSettings.confirmsAny(doc, member) ? writer(member) : s.from !== me && toContact && open && isManager(member))),
    canDispute: live && s.status === 'reported' && s.to === me,
    canVoid: open && (s.status === 'confirmed' ? (s.to === me || isManager(member)) : (s.createdBy === member.subject || isManager(member))),
  };
  const mine = myLedger(ctx, doc, member, s, 'settlement');
  if (mine) out.myLedger = mine;
  return out;
}

function balancesView(doc, parts) {
  const names = new Map(parts.map((p) => [p.ref, p.name]));
  return groups.balances(doc, parts.map((p) => p.ref), { ensureCurrency: reportingCurrency(doc) }).map((b) => {
    const dec = (m) => money.toDecimal(m, b.currency);
    const pair = (x) => ({ from: x.from, to: x.to, amountMinor: x.amountMinor, amount: dec(x.amountMinor) });
    return {
      currency: b.currency,
      rows: b.rows.map((r) => ({
        ref: r.ref, name: names.get(r.ref) || 'Unknown',
        paidMinor: r.paidMinor, paid: dec(r.paidMinor), shareMinor: r.shareMinor, share: dec(r.shareMinor),
        receivedMinor: r.settledInMinor, received: dec(r.settledInMinor), paidOutMinor: r.settledOutMinor, paidOut: dec(r.settledOutMinor),
        netMinor: r.netMinor, net: dec(r.netMinor),
        pendingInMinor: r.pendingInMinor, pendingIn: dec(r.pendingInMinor), pendingOutMinor: r.pendingOutMinor, pendingOut: dec(r.pendingOutMinor),
        disputedInMinor: r.disputedInMinor, disputedIn: dec(r.disputedInMinor), disputedOutMinor: r.disputedOutMinor, disputedOut: dec(r.disputedOutMinor),
        expenses: r.expenses.map((x) => ({ expenseId: x.expenseId, description: x.description, date: x.date, paid: dec(x.paidMinor), share: dec(x.shareMinor), effect: dec(x.effectMinor) })),
      })),
      suggestions: b.suggestions.map(pair),
      direct: b.direct.map(pair),
    };
  });
}

const newestFirst = (a, b) => (a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt)) : String(b.date).localeCompare(String(a.date)));

async function list(ctx, req) {
  const action = query(req, 'action');
  if (action === 'history') return recordHistory(ctx, req);
  if (action !== undefined && action !== 'balances') throw notFound();
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  const parts = groups.participants(doc, ctx.principal);
  const balances = balancesView(doc, parts);
  if (action === 'balances') return { body: { currency: reportingCurrency(doc), balances } };
  return {
    body: {
      currency: reportingCurrency(doc), kind: doc.kind,
      // The group's settings from the one list, with who changed what (Terry, 2026-09-14).
      groupSettings: groupSettings.view(doc, (s) => nameOf(doc, s), member, isManager(member)),
      permissions: { role: member.role, canAdd: writer(member), canManage: isManager(member), selfRef: selfRef(member) },
      participants: parts,
      expenses: [...(doc.groupExpenses || [])].sort(newestFirst).map((e) => expenseView(ctx, doc, member, e)),
      settlements: [...(doc.groupSettlements || [])].sort(newestFirst).map((s) => settlementView(ctx, doc, member, s)),
      // The caller's own accounts for their part of the group, per currency; shown only to them, and
      // left out when there are none (like `myLedger` on a record).
      ...(() => { const mine = myLedgers(ctx, doc, member, entryIndex(doc, member.subject)); return mine.length ? { myLedgers: mine } : {}; })(),
      balances,
      basis: 'Balances count confirmed payments only. Suggested and direct payments also count reported payments as made, so nobody is asked to pay twice; suggestions count a reported payment only up to what is owed. Disputed payments are not counted.',
    },
  };
}

// ---- expenses ------------------------------------------------------------------------------------
function ledgerChoice(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('Choose an account to record this on.', 'invalid_field');
  fields.onlyKeys(value, ['accountId']);
  return requireId(value.accountId, 'accountId');
}

async function createExpense(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), CREATE_KEYS);
  const ledgerAccountId = ledgerChoice(body.ledger);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    requireWriter(member);
    const nowIso = ctx.nowIso();
    const m = expenseMoney(doc, body, null);
    const rec = {
      id: newId('gex'), description: fields.text(body.description, { field: 'Description', max: 120, required: true }),
      date: fields.date(body.date, 'Date') || nowIso.slice(0, 10), currency: m.currency, amountMinor: m.amountMinor,
      categoryId: checkCategory(doc, body.categoryId), notes: fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }),
      payers: m.payers, split: m.split, shares: m.shares,
      createdBy: member.subject, createdAt: nowIso, revision: 1, voidedAt: null,
      history: [{ revision: 1, at: nowIso, by: member.subject, event: 'create' }], amendments: [], ledgerLinks: [],
    };
    doc.groupExpenses = [...(doc.groupExpenses || []), rec];
    audit.record(doc, { actor: member.subject, action: 'group.expense.create', targetType: 'group-expense', targetId: rec.id, at: nowIso });
    // Recorded on the caller's own account through a new or changed link for this currency, or through
    // the link they already have (their own write, so their entries follow at once).
    if (ledgerAccountId) linkCurrency(ctx, doc, member, rec.currency, ledgerAccountId);
    else followOwnLink(ctx, doc, member, rec, 'expense', 'Shared expense');
    return { expense: expenseView(ctx, doc, member, rec) };
  }, { idempotencyKey: header(req, 'idempotency-key') || undefined, idempotencyScope: 'group.expense.create', requestHash: store.requestHash({ q: wsId, body }) });
  return { status: 201, body: result };
}

async function patchExpense(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), PATCH_KEYS);
  const id = requireId(body.expenseId, 'expenseId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const e = findExpense(doc, id);
    if (!canChangeExpense(e, member)) throw forbidden('Only the person who added this expense, or a manager or owner, can change it.');
    if (e.voidedAt) throw conflict('This expense is void, so it cannot be changed. Add a new expense instead.', 'voided');
    checkRevision(e, body.revision);
    const reason = requireReason(body.reason, 'this correction');
    const nowIso = ctx.nowIso();
    const before = Object.fromEntries(TRACKED.map((k) => [k, structuredClone(e[k] === undefined ? null : e[k])]));
    const m = expenseMoney(doc, body, e);
    const next = {
      description: body.description !== undefined ? fields.text(body.description, { field: 'Description', max: 120, required: true }) : e.description,
      date: body.date !== undefined ? fields.date(body.date, 'Date', { required: true }) : e.date,
      amountMinor: m.amountMinor,
      categoryId: body.categoryId !== undefined ? checkCategory(doc, body.categoryId, e.categoryId) : e.categoryId || null,
      notes: body.notes !== undefined ? fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }) : e.notes || '',
      payers: m.payers, split: m.split, shares: m.shares,
    };
    const changes = TRACKED.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k])).map((k) => ({ field: k, from: before[k], to: structuredClone(next[k]) }));
    if (!changes.length) return { expense: expenseView(ctx, doc, member, e) };
    Object.assign(e, next);
    e.revision += 1;
    e.updatedAt = nowIso;
    e.updatedBy = member.subject;
    e.amendments = [...(e.amendments || []), { revision: e.revision, at: nowIso, by: member.subject, reason, changes }];
    e.history = [...(e.history || []), { revision: e.revision, at: nowIso, by: member.subject, event: 'update', fields: changes.map((c) => c.field) }];
    audit.record(doc, { actor: member.subject, action: 'group.expense.update', targetType: 'group-expense', targetId: e.id, at: nowIso, fields: changes.map((c) => c.field) });
    followOwnLink(ctx, doc, member, e, 'expense', `Shared expense corrected: ${reason}`);
    return { expense: expenseView(ctx, doc, member, e) };
  });
  return { body: result };
}

// ---- settlements ---------------------------------------------------------------------------------
async function createSettlement(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), SETTLE_KEYS);
  const ledgerAccountId = ledgerChoice(body.ledger);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    requireWriter(member);
    const nowIso = ctx.nowIso();
    const currency = settlementCurrency(doc, body.currency);
    const check = groups.participantChecker(doc);
    const from = check(body.from);
    const to = check(body.to);
    if (from === to) throw badRequest('A payment needs two different people.', 'same_person');
    // Someone saying they RECEIVED a payment is the confirmation itself.
    const receiver = to === selfRef(member);
    const s = {
      id: newId('gst'), from, to, amountMinor: groups.positiveAmount(body.amount, currency, 'Amount'), currency,
      date: fields.date(body.date, 'Date') || nowIso.slice(0, 10),
      method: fields.text(body.method, { field: 'Payment method', max: 60 }), notes: fields.text(body.notes, { field: 'Notes', max: 500, multiline: true }),
      status: receiver ? 'confirmed' : 'reported', confirmedBy: receiver ? member.subject : null, confirmedAt: receiver ? nowIso : null,
      createdBy: member.subject, createdAt: nowIso, revision: 1, voidedAt: null,
      history: [{ revision: 1, at: nowIso, by: member.subject, event: 'reported' }, ...(receiver ? [{ revision: 1, at: nowIso, by: member.subject, event: 'confirmed' }] : [])],
      ledgerLinks: [],
    };
    doc.groupSettlements = [...(doc.groupSettlements || []), s];
    audit.record(doc, { actor: member.subject, action: 'group.settlement.report', targetType: 'group-settlement', targetId: s.id, at: nowIso });
    if (receiver) audit.record(doc, { actor: member.subject, action: 'group.settlement.confirm', targetType: 'group-settlement', targetId: s.id, at: nowIso });
    // Recorded on the caller's own account through a new or changed link for this currency, or the one
    // they already have. Anyone in the payment has a part in it; entries follow once it is confirmed.
    if (ledgerAccountId) linkCurrency(ctx, doc, member, s.currency, ledgerAccountId);
    else followOwnLink(ctx, doc, member, s, 'settlement', 'Repayment');
    return { settlement: settlementView(ctx, doc, member, s) };
  }, { idempotencyKey: header(req, 'idempotency-key') || undefined, idempotencyScope: 'group.settle', requestHash: store.requestHash({ q: wsId, body }) });
  return { status: 201, body: result };
}

function settlementChange(kind) {
  return async (ctx, req) => {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), kind === 'confirm' ? ['settlementId', 'revision', 'ledger'] : ['settlementId', 'revision', 'reason']);
    const id = requireId(body.settlementId, 'settlementId');
    const ledgerAccountId = kind === 'confirm' ? ledgerChoice(body.ledger) : null;
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const s = findSettlement(doc, id);
      const me = selfRef(member);
      // A viewer may confirm or dispute a payment made to them, and nothing else (security review S7).
      if (s.to !== me) requireWriter(member);
      const nowIso = ctx.nowIso();
      if (kind === 'confirm') {
        // "Can confirm payments" (Terry, 2026-09-14): the owner's or manager's override for this person
        // if set, otherwise the group setting "Anyone in the group can confirm payments" (on by
        // default). When it applies, the person confirms any reported payment, their own included; a
        // viewer never gets more than one made to them. Otherwise: never the person who paid (security
        // review S5); the receiving member, or a manager or owner for a contact.
        const anyone = groupSettings.confirmsAny(doc, member);
        if (!anyone) {
          if (s.from === me) throw forbidden('You paid this, so someone else must confirm that it arrived.');
          const allowed = s.to === me || (s.to.startsWith('contact:') && isManager(member));
          if (!allowed) throw forbidden(s.to.startsWith('contact:') ? 'Only a manager or owner can confirm a payment to a contact.' : 'Only the person who received this payment can confirm it.');
        }
        // Starting to record on an account is not something a viewer can do (S7).
        if (ledgerAccountId) requireWriter(member);
        if (s.voidedAt) throw conflict('This payment is void.', 'already_void');
        if (s.status === 'confirmed') throw conflict('This payment is already confirmed.', 'already_confirmed');
        checkRevision(s, body.revision);
        // A manager or owner confirming a contact payment they reported themselves is allowed — a group
        // with one owner must be able to record them — but kept and shown distinctly (S5).
        // Marked only under the strict rules; when anyone may confirm, the confirmation says who it was.
        const byReporter = !anyone && s.to !== me && s.createdBy === member.subject;
        s.status = 'confirmed';
        s.confirmedBy = member.subject;
        s.confirmedAt = nowIso;
        s.confirmedByReporter = byReporter;
        s.revision += 1;
        s.history = [...(s.history || []), { revision: s.revision, at: nowIso, by: member.subject, event: byReporter ? 'confirmed-by-reporter' : 'confirmed' }];
        audit.record(doc, { actor: member.subject, action: 'group.settlement.confirm', targetType: 'group-settlement', targetId: s.id, at: nowIso });
        if (ledgerAccountId) linkCurrency(ctx, doc, member, s.currency, ledgerAccountId);
        else followOwnLink(ctx, doc, member, s, 'settlement', 'Repayment');
      } else {
        if (s.to !== me) throw forbidden('Only the person who received this payment can dispute it.');
        if (s.voidedAt) throw conflict('This payment is void.', 'already_void');
        if (s.status !== 'reported') throw conflict('Only a reported payment can be disputed. Void a confirmed payment instead.', 'not_disputable');
        checkRevision(s, body.revision);
        const reason = requireReason(body.reason, 'disputing this payment');
        s.status = 'disputed';
        s.disputedBy = member.subject;
        s.disputedAt = nowIso;
        s.disputeReason = reason;
        s.revision += 1;
        s.history = [...(s.history || []), { revision: s.revision, at: nowIso, by: member.subject, event: 'disputed', reason }];
        audit.record(doc, { actor: member.subject, action: 'group.settlement.dispute', targetType: 'group-settlement', targetId: s.id, at: nowIso });
      }
      return { settlement: settlementView(ctx, doc, member, s) };
    });
    return { body: result };
  };
}

// ---- void (expenses and payments) ----------------------------------------------------------------
async function voidRecord(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['expenseId', 'settlementId', 'revision', 'reason']);
  const type = pickType(body);
  const id = requireId(type === 'expense' ? body.expenseId : body.settlementId, type === 'expense' ? 'expenseId' : 'settlementId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const rec = type === 'expense' ? findExpense(doc, id) : findSettlement(doc, id);
    // Once a payment is confirmed, the payer or reporter alone can no longer take it back: only its
    // receiving member or a manager or owner may, and it is recorded as a withdrawn confirmation
    // (security review S6). Before that, whoever reported it (or a manager or owner) may void it.
    const confirmedPayment = type === 'settlement' && rec.status === 'confirmed';
    const allowed = writer(member) && (confirmedPayment ? (rec.to === selfRef(member) || isManager(member)) : (rec.createdBy === member.subject || isManager(member)));
    if (!allowed) {
      throw forbidden(confirmedPayment ? 'Only the person who received this payment, or a manager or owner, can withdraw its confirmation.'
        : `Only the person who added this ${type === 'expense' ? 'expense' : 'payment'}, or a manager or owner, can void it.`);
    }
    if (rec.voidedAt) throw conflict(`This ${type === 'expense' ? 'expense' : 'payment'} is already void.`, 'already_void');
    checkRevision(rec, body.revision);
    const reason = requireReason(body.reason, 'voiding it');
    const nowIso = ctx.nowIso();
    rec.voidedAt = nowIso;
    rec.voidedBy = member.subject;
    rec.voidReason = reason;
    rec.revision += 1;
    if (confirmedPayment) rec.withdrawn = true;
    rec.history = [...(rec.history || []), { revision: rec.revision, at: nowIso, by: member.subject, event: confirmedPayment ? 'withdrawn' : 'void', reason }];
    if (type === 'expense') rec.amendments = [...(rec.amendments || []), { revision: rec.revision, at: nowIso, by: member.subject, reason, changes: [{ field: 'status', from: 'active', to: 'void' }] }];
    audit.record(doc, { actor: member.subject, action: `group.${type}.void`, targetType: `group-${type}`, targetId: rec.id, at: nowIso });
    followOwnLink(ctx, doc, member, rec, type, `${type === 'expense' ? 'Shared expense' : 'Repayment'} voided: ${reason}`);
    return type === 'expense' ? { expense: expenseView(ctx, doc, member, rec) } : { settlement: settlementView(ctx, doc, member, rec) };
  }, { allowHeadroom: false });
  return { body: result };
}

function pickType(body) {
  const e = body.expenseId !== undefined;
  const s = body.settlementId !== undefined;
  if (e === s) throw badRequest('Send either expenseId or settlementId.', 'missing_field');
  return e ? 'expense' : 'settlement';
}

// ---- the caller's own account --------------------------------------------------------------------
//   { expenseId | settlementId }                   bring the caller's entries for that record up to date
//   { expenseId | settlementId, accountId }        record the caller's part of every shared expense and
//                                                  payment in that record's currency on their own private
//                                                  account (or move it there) and bring it all up to date
//   { expenseId | settlementId, accountId: null }  stop recording in that currency: entries reversed,
//                                                  the link kept as ended
//   { currency, accountId? }                       the same by currency; without accountId, bring every
//                                                  record in that currency up to date
async function ledgerAction(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['expenseId', 'settlementId', 'currency', 'accountId']);
  const named = ['expenseId', 'settlementId', 'currency'].filter((k) => body[k] !== undefined);
  if (named.length !== 1) throw badRequest('Send one of expenseId, settlementId or currency.', 'missing_field');
  const type = body.expenseId !== undefined ? 'expense' : body.settlementId !== undefined ? 'settlement' : null;
  const id = type ? requireId(type === 'expense' ? body.expenseId : body.settlementId, type === 'expense' ? 'expenseId' : 'settlementId') : null;
  if (!type && !money.isCurrency(body.currency)) throw badRequest('currency must be a currency code such as "EUR".', 'invalid_field');
  const choosing = Object.prototype.hasOwnProperty.call(body, 'accountId');
  const accountId = choosing && body.accountId !== null ? requireId(body.accountId, 'accountId') : null;
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    // Bringing one's own entries up to date, or stopping, only writes to one's own private account, so a
    // viewer may do it too — for example after being made a viewer (security review S7). Starting or
    // moving a link is for members, managers and owners.
    if (choosing && accountId !== null) requireWriter(member);
    const rec = type ? (type === 'expense' ? findExpense(doc, id) : findSettlement(doc, id)) : null;
    const currency = rec ? rec.currency : body.currency;
    let outcome = null;
    if (choosing && accountId === null) outcome = unlinkCurrency(ctx, doc, member, currency);
    else if (choosing) {
      if (rec && rec.voidedAt) throw conflict('This is void, so there is nothing to record.', 'already_void');
      outcome = linkCurrency(ctx, doc, member, currency, accountId);
    } else if (rec) {
      // One record must come up to date or say why (strict). With nothing of the caller's on it there
      // is nothing to do, so repeating it is harmless.
      syncRecord(ctx, doc, member, rec, type, { reason: reasonFor(rec, type, 'Updated to match Shared expenses'), strict: true });
    } else outcome = syncCurrency(ctx, doc, member, currency, 'Updated to match Shared expenses');
    const out = { myLedgers: myLedgers(ctx, doc, member, entryIndex(doc, member.subject)), ...(outcome ? { updated: outcome.updated, notUpdated: outcome.blocked } : {}) };
    if (rec) out[type] = type === 'expense' ? expenseView(ctx, doc, member, rec) : settlementView(ctx, doc, member, rec);
    return out;
  });
  return { body: result };
}

// ---- history -------------------------------------------------------------------------------------
async function recordHistory(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const expenseId = query(req, 'expenseId');
  const settlementId = query(req, 'settlementId');
  const type = pickType({ expenseId, settlementId });
  const rec = type === 'expense' ? findExpense(doc, requireId(expenseId, 'expenseId')) : findSettlement(doc, requireId(settlementId, 'settlementId'));
  const c = rec.currency;
  const dec = (v) => (money.isMinor(v) ? money.toDecimal(v, c) : v);
  const fmt = (field, v) => {
    if (v === null || v === undefined) return v;
    if (field === 'amountMinor') return dec(v);
    if ((field === 'payers' || field === 'shares') && Array.isArray(v)) return v.map((x) => ({ ref: x.ref, amount: dec(x.amountMinor) }));
    if (field === 'split' && v && Array.isArray(v.lines)) return { method: v.method, lines: v.lines.map((l) => ({ ref: l.ref, value: v.method === 'amounts' ? dec(l.value) : l.value })) };
    return v;
  };
  return {
    body: {
      id: rec.id, type, createdAt: rec.createdAt, createdBy: nameOf(doc, rec.createdBy),
      history: (rec.history || []).map((x) => ({ at: x.at, by: nameOf(doc, x.by), event: x.event, reason: x.reason || '', fields: x.fields || [] })),
      amendments: (rec.amendments || []).map((a) => ({ at: a.at, by: nameOf(doc, a.by), reason: a.reason, revision: a.revision, changes: a.changes.map((ch) => ({ field: ch.field, from: fmt(ch.field, ch.from), to: fmt(ch.field, ch.to) })) })),
    },
  };
}

// ---- group settings -----------------------------------------------------------------------------
// POST ?action=settings { changes: { <key>: <value> }, reason? }: owners and managers change the
// group's settings from the one list in api/_shared/group-settings.js; every real change is kept in
// the history (who, when, from, to, why) and audited, in the same write.
async function settingsAction(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['changes', 'reason']);
  const changes = groupSettings.parseChanges(body.changes);
  const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (!isManager(member)) throw forbidden('Only owners and managers can change the group\'s settings.');
    const at = ctx.nowIso();
    const changed = groupSettings.apply(doc, changes, { by: member.subject, at, reason });
    if (changed.length) audit.record(doc, { actor: member.subject, action: 'group.settings.update', targetType: 'workspace', targetId: doc.id, at, fields: changed });
    return { groupSettings: groupSettings.view(doc, (s) => nameOf(doc, s), member, true) };
  });
  return { body: result };
}

const ACTIONS = Object.freeze({ void: voidRecord, settle: createSettlement, confirm: settlementChange('confirm'), dispute: settlementChange('dispute'), ledger: ledgerAction, settings: settingsAction });

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === undefined) return createExpense(ctx, req);
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) throw notFound();
  return ACTIONS[action](ctx, req);
}

// Shared expenses may be turned off for the whole site by its administrator or for this workspace by
// its owners and managers (workspace settings, Terry 2026-09-14). Then every route here is refused with
// a clear message — after the membership check, so someone outside the workspace still gets not found —
// and nothing recorded is touched; it all comes back when it is turned on again.
async function sharedExpensesGate(ctx, req) {
  const { doc } = await store.loadWorkspace(ctx, requireId(query(req, 'workspaceId'), 'workspaceId'));
  const { site } = await siteSettings.readSite(ctx.storage);
  workspaceSettings.assertSharedExpenses(doc, site);
}
const gated = (fn) => async (ctx, req) => { await sharedExpensesGate(ctx, req); return fn(ctx, req); };

module.exports = { GET: gated(list), POST: gated(post), PATCH: gated(patchExpense) };
