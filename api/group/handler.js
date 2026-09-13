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
//   POST ?action=ledger  { expenseId | settlementId, accountId? }  record on the caller's own account
//                                           (accountId), bring those entries up to date (no accountId)
//                                           or stop recording there (accountId: null)
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
// PERSONAL LEDGER LINK (the brief's EUR 300 dinner rule): a payer may also record an expense on an
// account of theirs where they may add entries — their share as an `expense`, the rest as an
// `advance` (money lent) — and the receiver of a confirmed payment may record it as a
// `reimbursement`, in the same atomic write. The link is visible only to its owner; nobody else learns
// which account, balance, entry or note is involved. Only the link's owner ever writes to that
// account: when they change or void the record, their entries follow at once by reversal and new
// entries (never by rewriting); when someone else does, their entries are shown as needing review
// until they bring them up to date with ?action=ledger.
const { readBody, query, header, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { roleAtLeast, can, capabilitiesFor, canChangeRecord } = require('../_shared/authz');
const store = require('../_shared/store');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const ledger = require('../_shared/ledger');
const groups = require('../_shared/groups');
const entries = require('../_shared/entries');
const model = require('../_shared/workspace-model');

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
// One currency per workspace in this increment (multi-currency group totals are pending, BT-009).
function currencyOf(doc, value) {
  const c = reportingCurrency(doc);
  if (value !== undefined && value !== null && value !== c) throw badRequest(`Shared expenses in this workspace are in ${c}. Other currencies are not supported yet.`, 'currency_not_supported');
  return c;
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

// ---- the personal ledger link --------------------------------------------------------------------
const activeLink = (rec, subject) => (rec.ledgerLinks || []).find((l) => l.subject === subject && !l.endedAt) || null;

// Live entries on one account that came from this record: not deleted, not reversed, not reversals.
function liveLinked(doc, rec, type, accountId) {
  const key = LINK_KEY[type];
  return (doc.transactions || []).filter((t) => t.accountId === accountId && t.links && t.links[key] === rec.id && !t.deletedAt && !t.reversedBy && !t.links.reverses);
}
const entryKey = (x) => `${x.kind}|${x.amountMinor}|${x.categoryId || ''}|${x.date}`;
const sameEntries = (live, desired) => JSON.stringify(live.map(entryKey).sort()) === JSON.stringify(desired.map(entryKey).sort());

function noteFor(rec, kind) {
  if (kind === 'reimbursement') return 'Repayment recorded in Shared expenses';
  return `${kind === 'advance' ? 'Paid for others in' : 'My share of'} shared expense: ${rec.description}`;
}

// Brings the caller's own entries for one record in line with it: reverses those that no longer
// match and adds what the record now needs, in the same write. Only the link's owner runs this.
// `strict` throws when the account cannot take the change; otherwise the entries are left for the
// owner to review (a derived "needs review", never a stored flag).
function syncLedger(ctx, doc, member, rec, type, link, { reason, strict }) {
  const now = ctx.now();
  const nowIso = ctx.nowIso();
  const desired = link.endedAt ? [] : groups.desiredEntries(rec, type, selfRef(member));
  const live = liveLinked(doc, rec, type, link.accountId);
  if (sameEntries(live, desired)) return false;
  const account = (doc.accounts || []).find((a) => a.id === link.accountId);
  let problem = null;
  if (!account || account.deletedAt || capabilitiesFor(doc, ctx.principal, account, now).size === 0) problem = 'unavailable';
  else if (account.status === 'closed') problem = 'closed';
  else if (account.currency !== rec.currency) problem = 'currency';
  else if (!can(doc, ctx.principal, account, 'create', now) || live.some((t) => !canChangeRecord(doc, ctx.principal, account, t, 'edit', now))) problem = 'rights';
  if (problem) {
    if (!strict) return false;
    if (problem === 'unavailable') throw notFound('Unknown account.');
    if (problem === 'closed') throw conflict(`${account.name} is closed. Reopen it on the Accounts page to update its entries.`, 'account_closed');
    if (problem === 'currency') throw badRequest(`${account.name} is in ${account.currency}, not ${rec.currency}.`, 'currency_mismatch');
    throw forbidden('You cannot change the entries on this account.');
  }
  const key = LINK_KEY[type];
  for (const t of live) {
    const rev = entries.reverseEntry(doc, t, { by: member.subject, at: nowIso, reason, links: { [key]: rec.id } });
    audit.record(doc, { actor: member.subject, action: 'transaction.reverse', targetType: 'transaction', targetId: t.id, scope: `account:${account.id}`, at: nowIso });
    audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: rev.id, scope: `account:${account.id}`, at: nowIso });
  }
  for (const d of desired) {
    const t = entries.newEntry({ accountId: account.id, currency: account.currency, kind: d.kind, amountMinor: d.amountMinor, date: d.date, categoryId: d.categoryId, notes: noteFor(rec, d.kind), links: { [key]: rec.id }, by: member.subject, at: nowIso });
    doc.transactions = [...(doc.transactions || []), t];
    audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: t.id, scope: `account:${account.id}`, at: nowIso });
  }
  ledger.assertLedgerInRange(doc);
  return true;
}

// Starts recording a record on one of the caller's accounts (or moves it to another one).
function linkLedger(ctx, doc, member, rec, type, accountId) {
  const now = ctx.now();
  const nowIso = ctx.nowIso();
  const ref = selfRef(member);
  if (type === 'expense' && !(rec.payers || []).some((p) => p.ref === ref)) throw badRequest('Only someone who paid can record this expense on their own account.', 'not_a_payer');
  if (type === 'settlement' && rec.to !== ref) throw badRequest('Only the person who received this payment can record it on their own account.', 'not_recipient');
  const account = (doc.accounts || []).find((a) => a.id === accountId && !a.deletedAt);
  if (!account || capabilitiesFor(doc, ctx.principal, account, now).size === 0) throw notFound('Unknown account.');
  if (!can(doc, ctx.principal, account, 'create', now)) throw forbidden('You cannot add entries to this account.');
  if (account.status === 'closed') throw conflict(`${account.name} is closed. Choose an open account.`, 'account_closed');
  if (account.currency !== rec.currency) throw badRequest(`${account.name} is in ${account.currency}, but this is in ${rec.currency}. Choose an account in ${rec.currency}.`, 'currency_mismatch');
  const current = activeLink(rec, member.subject);
  if (current && current.accountId === account.id) return current;
  if (current) {
    current.endedAt = nowIso;
    syncLedger(ctx, doc, member, rec, type, current, { reason: 'Recorded on another account instead', strict: true });
  }
  const link = { subject: member.subject, accountId: account.id, linkedAt: nowIso, endedAt: null };
  // The link list is the owner's private bookkeeping: it never changes the shared record's revision.
  rec.ledgerLinks = [...(rec.ledgerLinks || []), link];
  audit.record(doc, { actor: member.subject, action: 'group.ledger.link', targetType: type === 'expense' ? 'group-expense' : 'group-settlement', targetId: rec.id, scope: `self:${member.subject}`, at: nowIso });
  return link;
}

// After the caller changes or voids a record, their own entries follow in the same write when they can.
function followOwnLink(ctx, doc, member, rec, type, reason) {
  const link = activeLink(rec, member.subject);
  if (link) syncLedger(ctx, doc, member, rec, type, link, { reason, strict: false });
}

function myLedger(ctx, doc, member, rec, type) {
  const link = activeLink(rec, member.subject);
  if (!link) return null;
  const account = (doc.accounts || []).find((a) => a.id === link.accountId);
  const visible = !!account && !account.deletedAt && capabilitiesFor(doc, ctx.principal, account, ctx.now()).size > 0;
  const live = liveLinked(doc, rec, type, link.accountId);
  return {
    accountId: visible ? account.id : null, accountName: visible ? account.name : null, accountUnavailable: !visible,
    needsReview: !sameEntries(live, groups.desiredEntries(rec, type, selfRef(member))),
    entries: visible ? live.map((t) => ({ id: t.id, kind: t.kind, amount: money.toDecimal(t.amountMinor, t.currency) })) : [],
  };
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
  const open = !s.voidedAt && writer(member);
  const out = {
    id: s.id, from: s.from, to: s.to, amount: money.toDecimal(s.amountMinor, s.currency), amountMinor: s.amountMinor, currency: s.currency,
    date: s.date, method: s.method || '', notes: s.notes || '', status: s.status, voided: !!s.voidedAt,
    voidedAt: s.voidedAt || null, voidReason: s.voidReason || '', voidedBy: s.voidedBy ? nameOf(doc, s.voidedBy) : null,
    disputeReason: s.disputeReason || '', confirmedBy: s.confirmedBy ? nameOf(doc, s.confirmedBy) : null, confirmedAt: s.confirmedAt || null,
    createdBy: nameOf(doc, s.createdBy), createdBySelf: s.createdBy === member.subject, createdAt: s.createdAt, revision: s.revision,
    canConfirm: open && s.status !== 'confirmed' && (s.to === me || (toContact && isManager(member))),
    canDispute: open && s.status === 'reported' && s.to === me,
    canVoid: open && (s.createdBy === member.subject || isManager(member)),
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
      permissions: { role: member.role, canAdd: writer(member), canManage: isManager(member), selfRef: selfRef(member) },
      participants: parts,
      expenses: [...(doc.groupExpenses || [])].sort(newestFirst).map((e) => expenseView(ctx, doc, member, e)),
      settlements: [...(doc.groupSettlements || [])].sort(newestFirst).map((s) => settlementView(ctx, doc, member, s)),
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
    if (ledgerAccountId) {
      const link = linkLedger(ctx, doc, member, rec, 'expense', ledgerAccountId);
      syncLedger(ctx, doc, member, rec, 'expense', link, { reason: 'Shared expense', strict: true });
    }
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
    const currency = currencyOf(doc, body.currency);
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
    if (ledgerAccountId && !receiver) throw badRequest('Only the person who received this payment can record it on their own account.', 'not_recipient');
    doc.groupSettlements = [...(doc.groupSettlements || []), s];
    audit.record(doc, { actor: member.subject, action: 'group.settlement.report', targetType: 'group-settlement', targetId: s.id, at: nowIso });
    if (receiver) audit.record(doc, { actor: member.subject, action: 'group.settlement.confirm', targetType: 'group-settlement', targetId: s.id, at: nowIso });
    if (ledgerAccountId) {
      const link = linkLedger(ctx, doc, member, s, 'settlement', ledgerAccountId);
      syncLedger(ctx, doc, member, s, 'settlement', link, { reason: 'Repayment', strict: true });
    }
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
      requireWriter(member);
      const me = selfRef(member);
      const nowIso = ctx.nowIso();
      if (kind === 'confirm') {
        const allowed = s.to === me || (s.to.startsWith('contact:') && isManager(member));
        if (!allowed) throw forbidden(s.to.startsWith('contact:') ? 'Only a manager or owner can confirm a payment to a contact.' : 'Only the person who received this payment can confirm it.');
        if (s.voidedAt) throw conflict('This payment is void.', 'already_void');
        if (s.status === 'confirmed') throw conflict('This payment is already confirmed.', 'already_confirmed');
        checkRevision(s, body.revision);
        s.status = 'confirmed';
        s.confirmedBy = member.subject;
        s.confirmedAt = nowIso;
        s.revision += 1;
        s.history = [...(s.history || []), { revision: s.revision, at: nowIso, by: member.subject, event: 'confirmed' }];
        audit.record(doc, { actor: member.subject, action: 'group.settlement.confirm', targetType: 'group-settlement', targetId: s.id, at: nowIso });
        if (ledgerAccountId) {
          const link = linkLedger(ctx, doc, member, s, 'settlement', ledgerAccountId);
          syncLedger(ctx, doc, member, s, 'settlement', link, { reason: 'Repayment', strict: true });
        } else followOwnLink(ctx, doc, member, s, 'settlement', 'Repayment');
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
    const allowed = writer(member) && (rec.createdBy === member.subject || isManager(member));
    if (!allowed) throw forbidden(`Only the person who added this ${type === 'expense' ? 'expense' : 'payment'}, or a manager or owner, can void it.`);
    if (rec.voidedAt) throw conflict(`This ${type === 'expense' ? 'expense' : 'payment'} is already void.`, 'already_void');
    checkRevision(rec, body.revision);
    const reason = requireReason(body.reason, 'voiding it');
    const nowIso = ctx.nowIso();
    rec.voidedAt = nowIso;
    rec.voidedBy = member.subject;
    rec.voidReason = reason;
    rec.revision += 1;
    rec.history = [...(rec.history || []), { revision: rec.revision, at: nowIso, by: member.subject, event: 'void', reason }];
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
async function ledgerAction(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['expenseId', 'settlementId', 'accountId']);
  const type = pickType(body);
  const id = requireId(type === 'expense' ? body.expenseId : body.settlementId, type === 'expense' ? 'expenseId' : 'settlementId');
  const choosing = Object.prototype.hasOwnProperty.call(body, 'accountId');
  const accountId = choosing && body.accountId !== null ? requireId(body.accountId, 'accountId') : null;
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    requireWriter(member);
    const rec = type === 'expense' ? findExpense(doc, id) : findSettlement(doc, id);
    const nowIso = ctx.nowIso();
    if (choosing && accountId === null) {
      const link = activeLink(rec, member.subject);
      if (link) {
        link.endedAt = nowIso;
        syncLedger(ctx, doc, member, rec, type, link, { reason: 'No longer recorded from Shared expenses', strict: true });
        audit.record(doc, { actor: member.subject, action: 'group.ledger.unlink', targetType: `group-${type}`, targetId: rec.id, scope: `self:${member.subject}`, at: nowIso });
      }
    } else if (choosing) {
      if (rec.voidedAt) throw conflict('This is void, so there is nothing to record.', 'already_void');
      const link = linkLedger(ctx, doc, member, rec, type, accountId);
      syncLedger(ctx, doc, member, rec, type, link, { reason: 'Shared expenses', strict: true });
    } else {
      const link = activeLink(rec, member.subject);
      if (!link) throw conflict('This is not recorded on any account of yours. Choose an account to record it on.', 'not_linked');
      syncLedger(ctx, doc, member, rec, type, link, { reason: rec.voidedAt ? `Voided: ${rec.voidReason || ''}`.trim() : 'Updated to match Shared expenses', strict: true });
    }
    return type === 'expense' ? { expense: expenseView(ctx, doc, member, rec) } : { settlement: settlementView(ctx, doc, member, rec) };
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

const ACTIONS = Object.freeze({ void: voidRecord, settle: createSettlement, confirm: settlementChange('confirm'), dispute: settlementChange('dispute'), ledger: ledgerAction });

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === undefined) return createExpense(ctx, req);
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) throw notFound();
  return ACTIONS[action](ctx, req);
}

module.exports = { GET: list, POST: post, PATCH: patchExpense };
