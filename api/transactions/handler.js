'use strict';
// /api/transactions?workspaceId=
//   GET     filters: accountId, payeeId, categoryId, tag, kind, status, ref, from, to, min, max,
//           q, includeDeleted, limit, offset. Only transactions on accounts the caller may view.
//   POST    create one entry, or a transfer pair written atomically (Idempotency-Key supported)
//   PATCH   { transactionId, revision, ... }  — the record revision must match (no silent
//           overwrite of someone else's edit); reconciled amounts/dates/accounts are locked
//   DELETE  { transactionId, revision }        soft delete (both legs of a transfer)
//   POST    ?action=restore { transactionId }
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

const CREATE_KEYS = ['accountId', 'kind', 'amount', 'date', 'postedDate', 'payeeId', 'categoryId', 'splits', 'tags', 'notes', 'status', 'responsibleRef', 'transfer', 'original', 'links'];
const PATCH_KEYS = ['transactionId', 'revision', 'reason', 'kind', 'amount', 'date', 'postedDate', 'payeeId', 'categoryId', 'splits', 'tags', 'notes', 'status', 'responsibleRef', 'original', 'toAmount'];
const LOCKED_WHEN_RECONCILED = ['amount', 'date', 'kind', 'toAmount'];

// AMENDMENTS (BT-001-05): an entry is never silently overwritten. Every change keeps the before and
// after values of each field, who made it and when; a financial change (or un-reconciling) also
// needs a reason. A reconciled entry is corrected by a reversal plus a new entry, never by editing.
const AMENDABLE = ['amountMinor', 'kind', 'date', 'postedDate', 'categoryId', 'splits', 'payeeId', 'responsibleRef', 'original', 'status', 'tags', 'notes'];
const FINANCIAL = new Set(['amountMinor', 'kind', 'date', 'postedDate', 'categoryId', 'splits', 'payeeId', 'responsibleRef', 'original']);
const valueOf = (t, f) => (t[f] === undefined ? null : structuredClone(t[f]));
const snapshot = (t) => Object.fromEntries(AMENDABLE.map((f) => [f, valueOf(t, f)]));
const diff = (before, t) => AMENDABLE.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(valueOf(t, f))).map((f) => ({ field: f, from: before[f], to: valueOf(t, f) }));
function amend(t, by, at, reason, changes) {
  t.amendments = [...(t.amendments || []), { revision: t.revision, at, by, reason: reason || '', changes }];
}

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

function validateLinks(links) {
  if (links === undefined || links === null) return {};
  if (typeof links !== 'object' || Array.isArray(links)) throw badRequest('Links must be an object.', 'invalid_field');
  fields.onlyKeys(links, ['debtId', 'tripId', 'groupExpenseId', 'reimbursementOf', 'billId']);
  const out = {};
  for (const [k, v] of Object.entries(links)) { const id = fields.optionalId(v, k); if (id) out[k] = id; }
  return out;
}

function history(t, by, at, changed) {
  // Never truncated (BT-001-05); growth is bounded by the member quota and the document cap.
  t.history = [...(t.history || []), { revision: t.revision, at, by, fields: changed }];
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
  for (const t of txns) {
    const bucket = ledger.classify(t.kind);
    if (t.deletedAt || bucket === 'transfer') continue;
    let amount = t.amountMinor;
    if (f.categoryId && (t.splits || []).length) amount = money.sum(t.splits.filter((s) => s.categoryId === f.categoryId).map((s) => s.amountMinor));
    const s = summary[t.currency] || (summary[t.currency] = { gross: 0, refunds: 0, income: 0, adjustments: 0, advances: 0, reimbursements: 0, count: 0 });
    s.count += 1;
    if (bucket === 'spending') s.gross = money.sum([s.gross, -amount]);
    else if (bucket === 'refund') s.refunds = money.sum([s.refunds, amount]);
    else if (bucket === 'income') s.income = money.sum([s.income, amount]);
    else if (bucket === 'adjustment') s.adjustments = money.sum([s.adjustments, amount]);
    else if (bucket === 'advance') s.advances = money.sum([s.advances, -amount]);
    else if (bucket === 'reimbursement') s.reimbursements = money.sum([s.reimbursements, amount]);
  }
  const limit = Math.min(Math.max(parseInt(query(req, 'limit') || '200', 10) || 200, 1), 1000);
  const offset = Math.max(parseInt(query(req, 'offset') || '0', 10) || 0, 0);
  const look = lookups(doc);
  const page = txns.slice(offset, offset + limit).map((t) => {
    const view = ledger.transactionView(doc, t, ctx.principal, now, look);
    const account = look.accounts.get(t.accountId);
    view.responsible = people.labelFor(t.responsibleRef, { doc, user });
    view.canEdit = canChangeRecord(doc, ctx.principal, account, t, 'edit', now);
    view.canDelete = canChangeRecord(doc, ctx.principal, account, t, 'delete', now);
    return view;
  });
  return {
    body: {
      transactions: page, total: txns.length, offset, limit,
      summary: Object.entries(summary).map(([currency, s]) => ({
        currency, count: s.count, gross: money.toDecimal(s.gross, currency), refunds: money.toDecimal(s.refunds, currency),
        net: money.toDecimal(money.sum([s.gross, -s.refunds]), currency), income: money.toDecimal(s.income, currency),
        adjustments: money.toDecimal(s.adjustments, currency), advances: money.toDecimal(s.advances, currency),
        reimbursements: money.toDecimal(s.reimbursements, currency),
      })),
    },
  };
}

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
      if (deleted && t.status === 'reconciled') throw conflict('Reconciled entries cannot be deleted. Reverse them instead.', 'reconciled_locked');
      // Deleting takes an entry out of balances but never erases it; the reason is kept (BT-001-05).
      const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
      if (deleted && !reason) throw badRequest('Give a reason for deleting this entry. It is kept with the entry\'s history.', 'reason_required');
      const legs = t.transferId ? (doc.transactions || []).filter((x) => x.transferId === t.transferId) : [t];
      for (const x of legs) {
        const acc = (doc.accounts || []).find((a) => a.id === x.accountId);
        if (!acc || !canChangeRecord(doc, ctx.principal, acc, x, 'delete', now)) throw forbidden('You cannot change both sides of this transfer.');
      }
      // A bill payment recorded again after this entry was deleted must not be doubled (SEC-B6).
      if (!deleted) {
        for (const x of legs) {
          const l = x.links || {};
          if (!l.recurringId || !l.occurrence) continue;
          const clash = (doc.transactions || []).some((y) => !y.deletedAt && !legs.includes(y) && y.links && y.links.recurringId === l.recurringId && y.links.occurrence === l.occurrence);
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
    if (t.transferId) throw badRequest('Reverse a transfer by recording a transfer back.', 'unsupported');
    if (t.links && t.links.reverses) throw conflict('A reversal cannot itself be reversed. Record a new entry instead.', 'is_reversal');
    if (t.reversedBy) throw conflict('This entry has already been reversed.', 'already_reversed');
    const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
    if (!reason) throw badRequest('Give a reason for the reversal. It is kept with both entries.', 'reason_required');
    const rev = {
      id: newId('txn'), accountId: t.accountId, kind: t.kind, amountMinor: -t.amountMinor, currency: t.currency,
      payeeId: t.payeeId || null, categoryId: t.categoryId || null, splits: (t.splits || []).map((s) => ({ ...s, amountMinor: -s.amountMinor })),
      responsibleRef: t.responsibleRef || null, original: null, transferId: null, counterpartAccountId: null,
      date: fields.date(body.date, 'Date') || nowIso.slice(0, 10), postedDate: null, status: 'pending', tags: [...(t.tags || [])],
      notes: `Reversal: ${reason}`, links: { reverses: t.id }, createdBy: member.subject, createdAt: nowIso, revision: 1, deletedAt: null,
    };
    history(rev, member.subject, nowIso, ['create', 'reversal']);
    t.reversedBy = rev.id;
    t.revision += 1;
    t.updatedAt = nowIso;
    amend(t, member.subject, nowIso, reason, [{ field: 'reversedBy', from: null, to: rev.id }]);
    doc.transactions = [...(doc.transactions || []), rev];
    ledger.assertLedgerInRange(doc);
    ledger.assertMemberQuota(doc, member, ctx.env);
    audit.record(doc, { actor: member.subject, action: 'transaction.reverse', targetType: 'transaction', targetId: t.id, scope: `account:${account.id}`, at: nowIso });
    audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: rev.id, scope: `account:${account.id}`, at: nowIso });
    const look = lookups(doc);
    return { transactions: [t, rev].map((x) => ledger.transactionView(doc, x, ctx.principal, now, look)) };
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
