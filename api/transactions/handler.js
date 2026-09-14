'use strict';
// /api/transactions?workspaceId=
//   GET     filters: accountId, payeeId, categoryId, tag, kind, status, ref, from, to, min, max,
//           q, includeDeleted, limit, offset. Only transactions on accounts the caller may view.
//   POST    create one entry, or a transfer pair written atomically (Idempotency-Key supported)
//   PATCH   { transactionId, revision, ... }  — the record revision must match (no silent
//           overwrite of someone else's edit); reconciled amounts/dates/accounts are locked
//   DELETE  { transactionId, revision, reason } soft delete (both legs of a transfer; a reversal
//           and the entry it reverses together)
//   POST    ?action=restore { transactionId }  restores the same group
const { readBody, query, header, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { capabilitiesFor, can, canChangeRecord } = require('../_shared/authz');
const { readDocument } = require('../_shared/schema');
const store = require('../_shared/store');
const ledger = require('../_shared/ledger');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const people = require('../_shared/people');
const audit = require('../_shared/audit');
const merchants = require('../_shared/merchants');
const bills = require('../_shared/bills');

const CREATE_KEYS = ['accountId', 'kind', 'amount', 'date', 'postedDate', 'payeeId', 'categoryId', 'splits', 'tags', 'notes', 'status', 'responsibleRef', 'transfer', 'original', 'links'];
const PATCH_KEYS = ['transactionId', 'revision', 'reason', 'kind', 'amount', 'date', 'postedDate', 'payeeId', 'categoryId', 'splits', 'tags', 'notes', 'status', 'responsibleRef', 'original', 'toAmount'];
const LOCKED_WHEN_RECONCILED = ['amount', 'date', 'kind', 'toAmount'];
// REVERSAL PAIRS (FIN-R1): a reversal must stay the exact opposite of the entry it reverses (same
// account, kind, category, merchant and splits, opposite amount). Every financial field of BOTH
// halves is therefore fixed for good; notes, tags and status stay editable. A correction is a new
// entry. The pair is also deleted and restored together (FIN-R2, FIN-R3; see setDeleted).
const LOCKED_WHEN_REVERSED = ['kind', 'amount', 'date', 'postedDate', 'payeeId', 'categoryId', 'splits', 'responsibleRef', 'original', 'toAmount'];
const inReversalPair = (t) => Boolean(t.reversedBy || (t.links && t.links.reverses));

// AMENDMENTS (BT-001-05): an entry is never silently overwritten. Every change keeps the before and
// after values of each field, who made it and when; a financial change (or un-reconciling) also
// needs a reason. A reconciled entry is corrected by a reversal plus a new entry, never by editing.
const AMENDABLE = ['amountMinor', 'kind', 'date', 'postedDate', 'categoryId', 'splits', 'payeeId', 'responsibleRef', 'original', 'status', 'tags', 'notes'];
const FINANCIAL = new Set(['amountMinor', 'kind', 'date', 'postedDate', 'categoryId', 'splits', 'payeeId', 'responsibleRef', 'original']);
const valueOf = (t, f) => (t[f] === undefined ? null : structuredClone(t[f]));
const snapshot = (t) => Object.fromEntries(AMENDABLE.map((f) => [f, valueOf(t, f)]));
const diff = (before, t) => AMENDABLE.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(valueOf(t, f))).map((f) => ({ field: f, from: before[f], to: valueOf(t, f) }));
// History, amendments and reversals are shared with the shared-expense route (BT-009), so both write
// entries with exactly the same mechanics.
const { amend, history, reverseEntry } = require('../_shared/entries');

async function readUser(ctx) {
  const { value } = await ctx.storage.getJson(store.paths.user(ctx.principal.subject));
  return readDocument('user', value) || { contacts: [] };
}

function lookups(doc) {
  return {
    accounts: new Map((doc.accounts || []).map((a) => [a.id, a])),
    payees: new Map((doc.payees || []).map((p) => [p.id, p])),
  };
}

function accountFor(doc, principal, accountId, capability, now) {
  const account = (doc.accounts || []).find((a) => a.id === accountId && !a.deletedAt);
  if (!account || capabilitiesFor(doc, principal, account, now).size === 0) throw notFound('Unknown account.');
  if (capability && !can(doc, principal, account, capability, now)) throw forbidden(`You do not have ${capability} permission on this account.`);
  // A closed account keeps its history but takes no new entries (BT-001-05, audit D1).
  if (capability === 'create' && account.status === 'closed') throw conflict(`${account.name} is closed. Reopen it on the Accounts page to add entries.`, 'account_closed');
  return account;
}

// The merchant is chosen from the managed directory by id, never typed as free text (BT-007-01).
// A closed merchant cannot be used for a new entry, but an entry keeps the merchant it has.
function resolvePayee(doc, principal, body, account, now, current = null) {
  return merchants.requireMerchant(doc, principal, account, body.payeeId, now, { current });
}

function checkCategory(doc, categoryId) {
  const id = fields.optionalId(categoryId, 'Category');
  if (id && !(doc.categories || []).some((c) => c.id === id)) throw badRequest('Unknown category.', 'invalid_category');
  return id;
}

function validateOriginal(original) {
  if (original === undefined || original === null) return null;
  if (typeof original !== 'object' || Array.isArray(original)) throw badRequest('Original amount details must be an object.', 'invalid_field');
  fields.onlyKeys(original, ['amount', 'currency', 'rate', 'rateSource', 'rateDate']);
  const currency = original.currency;
  money.precisionOf(currency);
  const amountMinor = money.parseDecimal(original.amount, currency, 'Original amount');
  const rate = original.rate === undefined || original.rate === null ? null : money.parseRate(original.rate).text;
  return {
    amountMinor, currency, rate,
    rateSource: fields.oneOf(original.rateSource, ['bank-posted', 'manual', 'provider', 'agreed'], 'Rate source', rate ? 'manual' : 'bank-posted'),
    rateDate: fields.date(original.rateDate, 'Rate date'),
  };
}

// Links to shared expenses and repayments (`groupExpenseId`, `groupSettlementId`) are set only by the
// shared-expense route for the person recording their own part (BT-009): a client-supplied one could
// make that person's update reverse an unrelated entry or block it (financial review finding 4,
// security review S3). They are refused here; entries are never edited to carry them either.
const SERVER_ONLY_LINKS = new Set(['groupExpenseId', 'groupSettlementId']);

function validateLinks(links) {
  if (links === undefined || links === null) return {};
  if (typeof links !== 'object' || Array.isArray(links)) throw badRequest('Links must be an object.', 'invalid_field');
  for (const k of Object.keys(links)) {
    if (SERVER_ONLY_LINKS.has(k)) throw badRequest('Entries for shared expenses are recorded from Shared expenses, not added here.', 'invalid_field');
  }
  fields.onlyKeys(links, ['debtId', 'tripId', 'reimbursementOf', 'billId']);
  const out = {};
  for (const [k, v] of Object.entries(links)) { const id = fields.optionalId(v, k); if (id) out[k] = id; }
  return out;
}

async function list(ctx, req) {
  if (query(req, 'action') === 'history') return amendmentHistory(ctx, req);
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const user = await readUser(ctx);
  const now = ctx.now();
  const includeDeleted = query(req, 'includeDeleted') === '1';
  const visibleAccountIds = new Set((doc.accounts || []).filter((a) => can(doc, ctx.principal, a, 'view-transactions', now)).map((a) => a.id));
  let txns = (doc.transactions || []).filter((t) => visibleAccountIds.has(t.accountId) && (includeDeleted || !t.deletedAt));
  const f = {
    accountId: query(req, 'accountId'), payeeId: query(req, 'payeeId'), categoryId: query(req, 'categoryId'),
    tag: query(req, 'tag'), kind: query(req, 'kind'), status: query(req, 'status'), ref: query(req, 'ref'),
    from: fields.date(query(req, 'from'), 'From'), to: fields.date(query(req, 'to'), 'To'),
    min: query(req, 'min'), max: query(req, 'max'), q: (query(req, 'q') || '').toLowerCase().slice(0, 80),
  };
  const payees = new Map((doc.payees || []).map((p) => [p.id, p]));
  txns = txns.filter((t) => {
    if (f.accountId && t.accountId !== f.accountId) return false;
    if (f.payeeId && t.payeeId !== f.payeeId) return false;
    if (f.categoryId && t.categoryId !== f.categoryId && !(t.splits || []).some((s) => s.categoryId === f.categoryId)) return false;
    if (f.tag && !(t.tags || []).includes(f.tag.toLowerCase())) return false;
    if (f.kind && t.kind !== f.kind) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.ref && t.responsibleRef !== f.ref) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.min !== undefined && money.compareAbsToDecimal(t.amountMinor, t.currency, f.min) < 0) return false;
    if (f.max !== undefined && money.compareAbsToDecimal(t.amountMinor, t.currency, f.max) > 0) return false;
    if (f.q) {
      const payee = t.payeeId && payees.get(t.payeeId);
      // Aliases are searched only for merchants the caller fully sees (security review SEC-B8).
      const full = payee && (payee.visibility === 'shared' || payee.ownerSubject === ctx.principal.subject);
      const hay = `${payee ? payee.name : ''} ${((full && payee.aliases) || []).join(' ')} ${t.notes || ''} ${(t.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
  txns.sort((a, b) => (a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt)) : b.date.localeCompare(a.date)));
  // Merchant-style summary: gross spending, refunds and net are reported separately. Advances and
  // reimbursements (receivables) and adjustments have their own buckets and are never counted as
  // spending or income. With a category filter, split entries contribute only matching lines.
  const summary = {};
  // What is owed to or by the viewer counts their OWN private accounts only (financial recheck F2): an
  // amount someone else lent from a shared account is never the viewer's receivable.
  const ownPrivate = new Set((doc.accounts || []).filter((a) => !a.deletedAt && a.visibility === 'private' && a.ownerSubject === ctx.principal.subject).map((a) => a.id));
  const OWED = new Set(['advance', 'reimbursement', 'payable', 'repayment']);
  // A removed account is out of every list and total (never erased, and its entries stay readable), so
  // what was recorded there is not counted twice once it is recorded on another account (F2).
  const removed = new Set((doc.accounts || []).filter((a) => a.deletedAt).map((a) => a.id));
  for (const t of txns) {
    const bucket = ledger.classify(t.kind);
    if (t.deletedAt || bucket === 'transfer' || removed.has(t.accountId)) continue;
    let amount = t.amountMinor;
    if (f.categoryId && (t.splits || []).length) amount = money.sum(t.splits.filter((s) => s.categoryId === f.categoryId).map((s) => s.amountMinor));
    const s = summary[t.currency] || (summary[t.currency] = { gross: 0, refunds: 0, income: 0, adjustments: 0, advances: 0, reimbursements: 0, payables: 0, repayments: 0, receivable: 0, count: 0 });
    // advances − reimbursements − payables + repayments is −(the sum of their signed amounts).
    if (OWED.has(bucket) && ownPrivate.has(t.accountId)) s.receivable = money.sum([s.receivable, -amount]);
    s.count += 1;
    if (bucket === 'spending') s.gross = money.sum([s.gross, -amount]);
    else if (bucket === 'refund') s.refunds = money.sum([s.refunds, amount]);
    else if (bucket === 'income') s.income = money.sum([s.income, amount]);
    else if (bucket === 'adjustment') s.adjustments = money.sum([s.adjustments, amount]);
    else if (bucket === 'advance') s.advances = money.sum([s.advances, -amount]);
    else if (bucket === 'reimbursement') s.reimbursements = money.sum([s.reimbursements, amount]);
    // Money owed to others for their shared expenses, and repayments made to them (BT-009).
    else if (bucket === 'payable') s.payables = money.sum([s.payables, amount]);
    else if (bucket === 'repayment') s.repayments = money.sum([s.repayments, -amount]);
  }
  const limit = Math.min(Math.max(parseInt(query(req, 'limit') || '200', 10) || 200, 1), 1000);
  const offset = Math.max(parseInt(query(req, 'offset') || '0', 10) || 0, 0);
  const look = lookups(doc);
  // A transfer is edited and deleted as a pair, and the routes require the right on every leg, so the
  // list offers Edit and Delete only when both sides may change (security review of eefd115, L-3).
  const legs = new Map();
  for (const x of doc.transactions || []) if (x.transferId) legs.set(x.transferId, [...(legs.get(x.transferId) || []), x]);
  const mayChange = (t, account, capability) => {
    if (!canChangeRecord(doc, ctx.principal, account, t, capability, now)) return false;
    if (!t.transferId) return true;
    return (legs.get(t.transferId) || []).filter((x) => x.id !== t.id).every((x) => {
      const other = look.accounts.get(x.accountId);
      return !!other && canChangeRecord(doc, ctx.principal, other, x, capability, now);
    });
  };
  const page = txns.slice(offset, offset + limit).map((t) => {
    const view = ledger.transactionView(doc, t, ctx.principal, now, look);
    const account = look.accounts.get(t.accountId);
    view.responsible = people.labelFor(t.responsibleRef, { doc, user });
    view.canEdit = mayChange(t, account, 'edit');
    view.canDelete = mayChange(t, account, 'delete');
    return view;
  });
  return {
    body: {
      transactions: page, total: txns.length, offset, limit,
      // The kinds that may be entered by hand here (group setting "Owed-to-others and repayment entries").
      entryKinds: entryKinds(doc),
      summary: Object.entries(summary).map(([currency, s]) => ({
        currency, count: s.count, gross: money.toDecimal(s.gross, currency), refunds: money.toDecimal(s.refunds, currency),
        net: money.toDecimal(money.sum([s.gross, -s.refunds]), currency), income: money.toDecimal(s.income, currency),
        adjustments: money.toDecimal(s.adjustments, currency), advances: money.toDecimal(s.advances, currency),
        reimbursements: money.toDecimal(s.reimbursements, currency),
        payables: money.toDecimal(s.payables, currency), repayments: money.toDecimal(s.repayments, currency),
        // What is owed to the viewer (negative: what they owe), on their own private accounts only: lent
        // − repaid to them − owed to others + repaid by them. For an account that records shared
        // expenses it is the group balance.
        receivable: money.toDecimal(s.receivable, currency),
      })),
    },
  };
}

// `payable` (a share someone else paid, no money moved) and `repayment` are made by the shared-expense
// route for the person recording their own part of a group (BT-009). A lone payable by hand would create
// money that never arrived — a payable of 100.00 raises a balance by 100.00 — so by default both are
// refused here (financial recheck N1). A group may allow entering them by hand (the group setting
// "Owed-to-others and repayment entries", Terry 2026-09-14): a repayment is then valid alone, and an
// owed amount is always recorded as a pair with its matching share as spending (see create), never
// alone. No entry is ever changed to or from them. `advance` and `reimbursement` stay manual.
const SERVER_ONLY_KINDS = new Set(['payable', 'repayment']);
function refuseServerOnlyKind(kind) {
  if (SERVER_ONLY_KINDS.has(kind)) throw badRequest('Money owed for a shared expense and repayments of it cannot be turned into other entries, or other entries into them.', 'server_only_kind');
}
const handEntryAllowed = (doc) => require('../_shared/group-settings').get(doc, 'ownedEntries') === 'manual';
// The kinds a person may enter here, in this workspace (the client offers exactly these).
const MANUAL_KINDS = Object.freeze(['expense', 'income', 'transfer', 'refund', 'fee', 'reimbursement', 'advance', 'adjustment', 'interest']);
const entryKinds = (doc) => (handEntryAllowed(doc) ? [...MANUAL_KINDS, 'payable', 'repayment'] : [...MANUAL_KINDS]);

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), CREATE_KEYS);
  const user = await readUser(ctx);
  const kind = fields.oneOf(body.kind, ledger.TX_KINDS, 'Kind', 'expense');
  const accountId = requireId(body.accountId, 'accountId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const nowIso = ctx.nowIso();
    const account = accountFor(doc, ctx.principal, accountId, 'create', now);
    const date = fields.date(body.date, 'Date') || nowIso.slice(0, 10);
    const base = {
      date, postedDate: fields.date(body.postedDate, 'Posted date'),
      status: fields.oneOf(body.status, ledger.TX_STATUSES, 'Status', 'pending'),
      tags: fields.tags(body.tags), notes: fields.text(body.notes, { field: 'Notes', max: 5000, multiline: true }),
      links: validateLinks(body.links), createdBy: member.subject, createdAt: nowIso, revision: 1, deletedAt: null,
    };
    if (base.status === 'reconciled') throw badRequest('New entries cannot start reconciled; reconcile them against a statement.', 'invalid_status');

    if (kind === 'transfer') {
      const t = body.transfer;
      if (!t || typeof t !== 'object') throw badRequest('A transfer needs a destination account.', 'missing_field');
      fields.onlyKeys(t, ['toAccountId', 'toAmount', 'rate']);
      const toId = requireId(t.toAccountId, 'Destination account');
      if (toId === account.id) throw badRequest('A transfer needs two different accounts.', 'invalid_transfer');
      const dest = accountFor(doc, ctx.principal, toId, 'create', now);
      const out = money.parseDecimal(body.amount, account.currency, 'Amount');
      if (out <= 0) throw badRequest('Amount must be greater than zero.', 'invalid_amount');
      let inMinor = out;
      let rate = null;
      if (dest.currency !== account.currency) {
        if (t.toAmount !== undefined) inMinor = money.parseDecimal(t.toAmount, dest.currency, 'Received amount');
        else if (t.rate !== undefined) { rate = money.parseRate(t.rate).text; inMinor = money.convert(out, account.currency, dest.currency, rate); }
        else throw badRequest('Transfers between currencies need the received amount or the rate.', 'missing_rate');
        if (inMinor <= 0) throw badRequest('Received amount must be greater than zero.', 'invalid_amount');
      }
      const transferId = newId('xfr');
      const context = dest.currency !== account.currency ? { amountMinor: out, currency: account.currency, rate, rateSource: rate ? 'manual' : 'bank-posted', rateDate: date } : null;
      const legOut = { ...base, id: newId('txn'), accountId: account.id, kind: 'transfer', amountMinor: -out, currency: account.currency, transferId, counterpartAccountId: dest.id, payeeId: null, categoryId: null, splits: [], responsibleRef: null, original: null };
      const legIn = { ...base, id: newId('txn'), accountId: dest.id, kind: 'transfer', amountMinor: inMinor, currency: dest.currency, transferId, counterpartAccountId: account.id, payeeId: null, categoryId: null, splits: [], responsibleRef: null, original: context, tags: [...base.tags], links: { ...base.links } };
      history(legOut, member.subject, nowIso, ['create']);
      history(legIn, member.subject, nowIso, ['create']);
      doc.transactions = [...(doc.transactions || []), legOut, legIn];
      ledger.assertLedgerInRange(doc);
      ledger.assertMemberQuota(doc, member, ctx.env);
      audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: legOut.id, scope: `account:${account.id}`, at: nowIso });
      audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: legIn.id, scope: `account:${dest.id}`, at: nowIso });
      const look = lookups(doc);
      return { transactions: [legOut, legIn].map((x) => ledger.transactionView(doc, x, ctx.principal, now, look)) };
    }

    if (SERVER_ONLY_KINDS.has(kind) && !handEntryAllowed(doc)) {
      throw badRequest('Money owed for a shared expense and repayments of it are recorded from Shared expenses. An owner or manager can allow entering them by hand in the Shared expenses settings.', 'server_only_kind');
    }
    // An amount owed entered by hand is recorded as a pair, in this one write: the share as spending (in
    // the chosen category, with the chosen merchant) and the matching payable. The balance does not
    // change; spending grows by the share and what is owed by the same amount (Terry's decision C).
    if (kind === 'payable') {
      if (body.splits !== undefined && body.splits !== null && (!Array.isArray(body.splits) || body.splits.length)) throw badRequest('An amount owed takes one category, not split lines.', 'invalid_field');
      const magnitude = -ledger.signedAmount('expense', body.amount, account.currency);
      const owedPairId = newId('owe');
      const common = {
        ...base, accountId: account.id, currency: account.currency, splits: [], original: null, transferId: null, counterpartAccountId: null, owedPairId,
        responsibleRef: people.requireRef(body.responsibleRef, { doc, user, visibility: account.visibility }),
      };
      const share = { ...common, id: newId('txn'), kind: 'expense', amountMinor: -magnitude, payeeId: resolvePayee(doc, ctx.principal, body, account, now), categoryId: checkCategory(doc, body.categoryId) };
      const owed = { ...common, id: newId('txn'), kind: 'payable', amountMinor: magnitude, payeeId: null, categoryId: null, tags: [...base.tags], links: { ...base.links } };
      history(share, member.subject, nowIso, ['create']);
      history(owed, member.subject, nowIso, ['create']);
      doc.transactions = [...(doc.transactions || []), share, owed];
      ledger.assertLedgerInRange(doc);
      ledger.assertMemberQuota(doc, member, ctx.env);
      for (const x of [share, owed]) audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: x.id, scope: `account:${account.id}`, at: nowIso });
      const look = lookups(doc);
      return { transactions: [share, owed].map((x) => ledger.transactionView(doc, x, ctx.principal, now, look)) };
    }
    const amountMinor = ledger.signedAmount(kind, body.amount, account.currency);
    const splits = ledger.validateSplits(body.splits, amountMinor, account.currency, doc);
    const txn = {
      ...base, id: newId('txn'), accountId: account.id, kind, amountMinor, currency: account.currency,
      payeeId: resolvePayee(doc, ctx.principal, body, account, now),
      categoryId: splits.length ? null : checkCategory(doc, body.categoryId), splits,
      responsibleRef: people.requireRef(body.responsibleRef, { doc, user, visibility: account.visibility }),
      original: validateOriginal(body.original), transferId: null, counterpartAccountId: null,
    };
    history(txn, member.subject, nowIso, ['create']);
    doc.transactions = [...(doc.transactions || []), txn];
    ledger.assertLedgerInRange(doc);
    ledger.assertMemberQuota(doc, member, ctx.env);
    audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: txn.id, scope: `account:${account.id}`, at: nowIso });
    return { transactions: [ledger.transactionView(doc, txn, ctx.principal, now, lookups(doc))] };
  }, { idempotencyKey: header(req, 'idempotency-key') || undefined, idempotencyScope: 'transactions.create', requestHash: store.requestHash({ q: wsId, body }) });
  return { status: 201, body: result };
}

function findTxn(doc, principal, id, now) {
  const t = (doc.transactions || []).find((x) => x.id === id);
  const account = t && (doc.accounts || []).find((a) => a.id === t.accountId);
  if (!t || !account || !can(doc, principal, account, 'view-transactions', now)) throw notFound('Unknown transaction.');
  return { t, account };
}

function checkRevision(t, revision) {
  if (!Number.isSafeInteger(revision)) throw badRequest('revision is required so a stale edit cannot overwrite a newer one.', 'missing_revision');
  if (revision !== t.revision) throw conflict('This entry changed since you loaded it. Reload to see the latest version.', 'stale_revision');
}

// Entries recorded from a shared expense or payment (server-set group links) follow that record: their
// owner's update from Shared expenses reverses and replaces them. Changing their financial details,
// reversing or deleting them here would leave them wrong until that update, so only notes, tags and
// status change here (financial recheck N2).
const sharedLinked = (t) => Boolean(t.links && (t.links.groupExpenseId || t.links.groupSettlementId));
const sharedLocked = () => conflict('This entry was recorded from Shared expenses, so its amount, date, type, category and merchant follow the shared expense. Change it in Shared expenses; notes, tags and status can be changed here.', 'shared_expense_locked');

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), PATCH_KEYS);
  const id = requireId(body.transactionId, 'transactionId');
  const user = await readUser(ctx);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const nowIso = ctx.nowIso();
    const { t, account } = findTxn(doc, ctx.principal, id, now);
    if (t.deletedAt) throw conflict('Restore this entry before editing it.', 'deleted');
    if (!canChangeRecord(doc, ctx.principal, account, t, 'edit', now)) throw forbidden('You cannot edit this entry.');
    checkRevision(t, body.revision);
    const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
    if (sharedLinked(t) && LOCKED_WHEN_REVERSED.some((k) => body[k] !== undefined)) throw sharedLocked();
    // A hand-entered amount owed and its share stay one pair: corrected by reversing both, never edited
    // (Terry's decision C).
    if (t.owedPairId && LOCKED_WHEN_REVERSED.some((k) => body[k] !== undefined)) {
      throw conflict('This amount owed and its matching share are recorded together, so their amount, date, type, category and merchant cannot change. Reverse it (both are reversed) and enter it again.', 'owed_pair_locked');
    }
    if (inReversalPair(t) && LOCKED_WHEN_REVERSED.some((k) => body[k] !== undefined)) {
      throw conflict(t.reversedBy
        ? 'This entry has been reversed, so its amount, date, type, category and merchant can no longer change. Add a new entry with the correct details.'
        : 'This is a reversal, so its amount, date, type, category and merchant always match the entry it reverses. Add a new entry with the correct details.', 'reversal_locked');
    }
    if (t.status === 'reconciled' && LOCKED_WHEN_RECONCILED.some((k) => body[k] !== undefined)) {
      throw conflict('This entry is reconciled. Change its status to cleared before editing amount, date or kind.', 'reconciled_locked');
    }
    const changed = [];
    const pair = t.transferId ? (doc.transactions || []).find((x) => x.transferId === t.transferId && x.id !== t.id) : null;
    const before = snapshot(t);
    const pairBefore = pair ? snapshot(pair) : null;
    if (t.transferId) {
      for (const k of ['kind', 'payeeId', 'categoryId', 'splits', 'responsibleRef', 'original']) {
        if (body[k] !== undefined) throw badRequest('Transfers only allow date, status, tags, notes and amounts to change.', 'invalid_transfer_edit');
      }
      const pairAccount = pair && (doc.accounts || []).find((a) => a.id === pair.accountId);
      if (!pair || !pairAccount || !canChangeRecord(doc, ctx.principal, pairAccount, pair, 'edit', now)) throw forbidden('You cannot edit both sides of this transfer.');
      if (body.amount !== undefined) {
        const self = money.parseDecimal(body.amount, t.currency, 'Amount');
        if (self <= 0) throw badRequest('Amount must be greater than zero.', 'invalid_amount');
        t.amountMinor = t.amountMinor < 0 ? -self : self;
        if (pair.currency === t.currency) pair.amountMinor = -t.amountMinor;
        else if (body.toAmount === undefined) throw badRequest('Changing a cross-currency transfer needs the other side\'s amount (toAmount).', 'missing_rate');
        changed.push('amount');
      }
      if (body.toAmount !== undefined) {
        // Same-currency transfers always mirror; a separate other-side amount would unbalance the
        // pair and destroy money (financial review finding 1).
        if (pair.currency === t.currency) throw badRequest('Both sides of a same-currency transfer are always equal. Change amount instead.', 'invalid_transfer_edit');
        const other = money.parseDecimal(body.toAmount, pair.currency, 'Other side amount');
        if (other <= 0) throw badRequest('Amount must be greater than zero.', 'invalid_amount');
        pair.amountMinor = pair.amountMinor < 0 ? -other : other;
        changed.push('toAmount');
      }
      // The receiving leg's exchange context must describe the amounts actually recorded now;
      // a stale rate would misstate history (financial review finding 6).
      if (pair.currency !== t.currency && (body.amount !== undefined || body.toAmount !== undefined)) {
        const incoming = t.amountMinor > 0 ? t : pair;
        const outgoing = incoming === t ? pair : t;
        incoming.original = { amountMinor: -outgoing.amountMinor, currency: outgoing.currency, rate: null, rateSource: 'bank-posted', rateDate: incoming.date };
      }
      for (const k of ['date', 'postedDate']) if (body[k] !== undefined) { t[k] = fields.date(body[k], k, { required: k === 'date' }); pair[k] = t[k]; changed.push(k); }
    } else {
      const kind = body.kind !== undefined ? fields.oneOf(body.kind, ledger.TX_KINDS.filter((k) => k !== 'transfer'), 'Kind') : t.kind;
      // No entry becomes, or stops being, a kind only Shared expenses make, and such an entry's amount
      // is not changed by hand (financial recheck N1).
      if (body.kind !== undefined || body.amount !== undefined) { refuseServerOnlyKind(kind); refuseServerOnlyKind(t.kind); }
      if (body.amount !== undefined || body.kind !== undefined) {
        const amountText = body.amount !== undefined ? body.amount : money.toDecimal(kind === 'adjustment' ? t.amountMinor : Math.abs(t.amountMinor), t.currency);
        t.amountMinor = ledger.signedAmount(kind, amountText, t.currency);
        if (kind !== t.kind) changed.push('kind');
        if (body.amount !== undefined) changed.push('amount');
        t.kind = kind;
      }
      if (body.splits !== undefined || body.amount !== undefined || body.kind !== undefined) {
        const splits = body.splits !== undefined ? body.splits : (t.splits || []).map((s) => ({ categoryId: s.categoryId, amount: money.toDecimal(Math.abs(s.amountMinor), t.currency), note: s.note }));
        t.splits = ledger.validateSplits(splits, t.amountMinor, t.currency, doc);
        if (t.splits.length) t.categoryId = null;
        if (body.splits !== undefined) changed.push('splits');
      }
      if (body.categoryId !== undefined) { if ((t.splits || []).length) throw badRequest('Split entries use per-line categories.', 'invalid_field'); t.categoryId = checkCategory(doc, body.categoryId); changed.push('categoryId'); }
      if (body.payeeId !== undefined) {
        const next = resolvePayee(doc, ctx.principal, body, account, now, t.payeeId);
        if (next !== t.payeeId) { t.payeeId = next; changed.push('payee'); }
      }
      if (body.responsibleRef !== undefined) { t.responsibleRef = people.requireRef(body.responsibleRef, { doc, user, visibility: account.visibility }); changed.push('responsibleRef'); }
      if (body.original !== undefined) { t.original = validateOriginal(body.original); changed.push('original'); }
      for (const k of ['date', 'postedDate']) if (body[k] !== undefined) { t[k] = fields.date(body[k], k, { required: k === 'date' }); changed.push(k); }
    }
    if (body.status !== undefined) {
      const status = fields.oneOf(body.status, ledger.TX_STATUSES, 'Status');
      t.status = status;
      if (pair) pair.status = status;
      changed.push('status');
    }
    if (body.tags !== undefined) { t.tags = fields.tags(body.tags); changed.push('tags'); }
    if (body.notes !== undefined) { t.notes = fields.text(body.notes, { field: 'Notes', max: 5000, multiline: true }); changed.push('notes'); }
    const changesFor = new Map([[t, diff(before, t)], ...(pair ? [[pair, diff(pairBefore, pair)]] : [])]);
    if (!changed.length || ![...changesFor.values()].some((c) => c.length)) return { transactions: [ledger.transactionView(doc, t, ctx.principal, now, lookups(doc))] };
    const financial = [...changesFor.values()].some((c) => c.some((x) => FINANCIAL.has(x.field)));
    const unreconciling = before.status === 'reconciled' && t.status !== 'reconciled';
    if ((financial || unreconciling) && !reason) throw badRequest('Give a reason for this correction. It is kept with the entry\'s history.', 'reason_required');
    ledger.assertLedgerInRange(doc);
    ledger.assertMemberQuota(doc, member, ctx.env);
    for (const x of pair ? [t, pair] : [t]) {
      x.revision += 1;
      x.updatedAt = nowIso;
      x.updatedBy = member.subject;
      history(x, member.subject, nowIso, changed);
      if (changesFor.get(x).length) amend(x, member.subject, nowIso, reason, changesFor.get(x));
      audit.record(doc, { actor: member.subject, action: 'transaction.update', targetType: 'transaction', targetId: x.id, scope: `account:${x.accountId}`, at: nowIso, fields: changed });
    }
    const look = lookups(doc);
    return { transactions: (pair ? [t, pair] : [t]).map((x) => ledger.transactionView(doc, x, ctx.principal, now, look)) };
  });
  return { body: result };
}

// The entries that are deleted and restored together: both legs of a transfer, or a reversal and
// the entry it reverses (FIN-R2, FIN-R3). A reversal and its original therefore always share their
// deletion state, so a live reversal never stands alone and a deleted one never leaves its original
// shown as reversed while counted in full.
function linkedEntries(doc, t) {
  const txns = doc.transactions || [];
  if (t.transferId) return txns.filter((x) => x.transferId === t.transferId);
  const partnerId = t.links && t.links.reverses ? t.links.reverses : t.reversedBy || null;
  const partner = partnerId ? txns.find((x) => x.id === partnerId) : null;
  return partner ? [t, partner] : [t];
}

function setDeleted(deleted) {
  return async (ctx, req) => {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), ['transactionId', 'revision', 'reason']);
    const id = requireId(body.transactionId, 'transactionId');
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const now = ctx.now();
      const nowIso = ctx.nowIso();
      const { t, account } = findTxn(doc, ctx.principal, id, now);
      if (!canChangeRecord(doc, ctx.principal, account, t, 'delete', now)) throw forbidden('You cannot delete or restore this entry.');
      if (Boolean(t.deletedAt) === deleted) return { changed: [] };
      if (deleted) checkRevision(t, body.revision);
      // Only entries not already in the target state change (they normally all are not).
      const legs = linkedEntries(doc, t).filter((x) => Boolean(x.deletedAt) !== deleted);
      // Entries recorded from Shared expenses are removed only by their owner's update there (N2).
      if (deleted && legs.some(sharedLinked)) throw sharedLocked();
      // A hand-entered amount owed and its share are corrected by reversing both, never deleted, so the
      // pair can never be split (Terry's decision C).
      if (deleted && legs.some((x) => x.owedPairId)) throw conflict('This amount owed and its matching share are recorded together. Reverse it instead (both are reversed).', 'owed_pair_locked');
      if (deleted && legs.some((x) => x.status === 'reconciled')) {
        throw conflict(legs.length > 1 && t.status !== 'reconciled'
          ? 'This entry is linked to a reconciled entry, so it cannot be deleted.'
          : 'Reconciled entries cannot be deleted. Reverse them instead.', 'reconciled_locked');
      }
      // Deleting takes an entry out of balances but never erases it; the reason is kept (BT-001-05).
      const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
      if (deleted && !reason) throw badRequest('Give a reason for deleting this entry. It is kept with the entry\'s history.', 'reason_required');
      for (const x of legs) {
        const acc = (doc.accounts || []).find((a) => a.id === x.accountId);
        if (!acc || !canChangeRecord(doc, ctx.principal, acc, x, 'delete', now)) {
          throw forbidden(t.transferId ? 'You cannot change both sides of this transfer.' : 'You cannot change both this entry and its reversal.');
        }
      }
      // A bill payment recorded again after this entry was deleted must not be doubled (SEC-B6).
      // Recordings are counted with the recording rule (bills.recordingCounts): one cancelled by a live
      // reversal does not count, on either side (financial retest FIN-T7).
      if (!deleted) {
        const byId = new Map((doc.transactions || []).map((y) => [y.id, y]));
        for (const x of legs) {
          const l = x.links || {};
          if (!l.recurringId || !l.occurrence) continue;
          if (x.reversedBy && legs.some((y) => y.id === x.reversedBy)) continue;
          const clash = (doc.transactions || []).some((y) => !legs.includes(y) && y.links && y.links.recurringId === l.recurringId && y.links.occurrence === l.occurrence && bills.recordingCounts(y, byId));
          if (clash) throw conflict('This bill payment was recorded again after this entry was deleted, so this one cannot be restored.', 'already_recorded');
        }
      }
      for (const x of legs) {
        // Who deleted it and when stay in the amendment even after a restore (audit B4).
        const prior = { deletedAt: x.deletedAt || null, deletedBy: x.deletedBy || null };
        x.deletedAt = deleted ? nowIso : null;
        x.deletedBy = deleted ? member.subject : null;
        x.revision += 1;
        history(x, member.subject, nowIso, [deleted ? 'delete' : 'restore']);
        amend(x, member.subject, nowIso, reason, [{ field: 'deleted', from: !deleted, to: deleted, ...(deleted ? {} : { previouslyDeletedAt: prior.deletedAt, previouslyDeletedBy: prior.deletedBy }) }]);
        audit.record(doc, { actor: member.subject, action: deleted ? 'transaction.delete' : 'transaction.restore', targetType: 'transaction', targetId: x.id, scope: `account:${x.accountId}`, at: nowIso });
      }
      if (!deleted) ledger.assertLedgerInRange(doc);
      return { changed: legs.map((x) => x.id) };
    }, { allowHeadroom: deleted });
    return { body: result };
  };
}

// A reversal corrects an entry — including a reconciled one — without touching it: a new entry of
// the same kind, account, category and merchant with the opposite amount, linked both ways. The
// person then records the correct entry. Balances, spending and budgets net out exactly.
async function reverse(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['transactionId', 'reason', 'date']);
  const id = requireId(body.transactionId, 'transactionId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const nowIso = ctx.nowIso();
    const { t, account } = findTxn(doc, ctx.principal, id, now);
    if (!can(doc, ctx.principal, account, 'create', now) || !canChangeRecord(doc, ctx.principal, account, t, 'edit', now)) throw forbidden('You cannot reverse this entry.');
    if (t.deletedAt) throw conflict('Deleted entries cannot be reversed.', 'deleted');
    // A reversal is a new entry, and closed accounts take no new entries (financial retest FIN-T8).
    if (account.status === 'closed') throw conflict(`${account.name} is closed. Reopen it on the Accounts page to correct its entries.`, 'account_closed');
    if (t.transferId) throw badRequest('Reverse a transfer by recording a transfer back.', 'unsupported');
    // Reversed only by their owner's update from Shared expenses (N2).
    if (sharedLinked(t)) throw sharedLocked();
    if (t.links && t.links.reverses) throw conflict('A reversal cannot itself be reversed. Record a new entry instead.', 'is_reversal');
    if (t.reversedBy) throw conflict('This entry has already been reversed.', 'already_reversed');
    const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
    if (!reason) throw badRequest('Give a reason for the reversal. It is kept with both entries.', 'reason_required');
    // Dated like the entry it reverses unless told otherwise, so the pair nets out in the same budget
    // period (financial retest FIN-T4).
    // A hand-entered amount owed and its matching share are reversed together, so the pair keeps
    // netting out and never leaves a lone payable (Terry's decision C).
    const targets = t.owedPairId ? (doc.transactions || []).filter((x) => x.owedPairId === t.owedPairId && !x.deletedAt && !x.reversedBy) : [t];
    const date = fields.date(body.date, 'Date') || t.date;
    const out = [];
    for (const x of targets) {
      const rev = reverseEntry(doc, x, { by: member.subject, at: nowIso, reason, date });
      audit.record(doc, { actor: member.subject, action: 'transaction.reverse', targetType: 'transaction', targetId: x.id, scope: `account:${account.id}`, at: nowIso });
      audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: rev.id, scope: `account:${account.id}`, at: nowIso });
      out.push(x, rev);
    }
    ledger.assertLedgerInRange(doc);
    ledger.assertMemberQuota(doc, member, ctx.env);
    const look = lookups(doc);
    return { transactions: out.map((x) => ledger.transactionView(doc, x, ctx.principal, now, look)) };
  }, { idempotencyKey: header(req, 'idempotency-key') || undefined, idempotencyScope: 'transactions.reverse', requestHash: store.requestHash({ q: wsId, body }) });
  return { status: 201, body: result };
}

// The full amendment history of one entry: who changed what, from what to what, when and why.
async function amendmentHistory(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const { t } = findTxn(doc, ctx.principal, requireId(query(req, 'transactionId'), 'transactionId'), ctx.now());
  const names = new Map((doc.members || []).map((m) => [m.subject, m.name || 'Member']));
  const value = (field, v) => {
    if (field === 'amountMinor' && typeof v === 'number') return money.toDecimal(v, t.currency);
    if (field === 'splits' && Array.isArray(v)) return v.map((s) => ({ categoryId: s.categoryId, amount: money.toDecimal(s.amountMinor, t.currency) }));
    if (field === 'original' && v && typeof v === 'object' && money.isMinor(v.amountMinor)) return { ...v, amount: money.toDecimal(v.amountMinor, v.currency) };
    return v;
  };
  return {
    body: {
      transactionId: t.id, createdAt: t.createdAt, createdBy: names.get(t.createdBy) || 'Former member',
      amendments: (t.amendments || []).map((a) => ({ at: a.at, by: names.get(a.by) || 'Former member', reason: a.reason, changes: a.changes.map((c) => ({ ...c, from: value(c.field, c.from), to: value(c.field, c.to) })) })),
    },
  };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'restore') return setDeleted(false)(ctx, req);
  if (action === 'reverse') return reverse(ctx, req);
  if (action !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: list, POST: post, PATCH: patch, DELETE: setDeleted(true) };
