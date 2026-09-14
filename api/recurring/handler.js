'use strict';
// /api/recurring?workspaceId=   Recurring costs and bills (BT-008-02)
//   GET                                              bills on accounts the caller may see, with next
//                                                    due date, upcoming, overdue, reminders, versions
//   GET  ?action=draft&recurringId=&occurrence=      review draft for one occurrence (nothing saved)
//   POST { name, billType, kind?, accountId, toAccountId?, amount, amountType?, schedule, categoryId?,
//          payeeId?, responsibleRef?, reminderDays?, notes?, tripId?, trackFrom? }
//   POST ?action=record { recurringId, occurrence, amount?, date?, categoryId?, payeeId?,
//          responsibleRef?, notes?, status? }   the reviewed occurrence becomes a real entry, once
//   POST ?action=skip { recurringId, occurrence, reason? }  |  ?action=unskip { recurringId, occurrence }
//   POST ?action=pause { recurringId, from, until? }        |  ?action=resume { recurringId, date? }
//   PATCH { recurringId, revision, effectiveFrom?, amount?, amountType?, categoryId?, payeeId?,
//           responsibleRef?, name?, billType?, notes?, reminderDays?, endDate? }
//   DELETE { recurringId, revision }                 soft delete; recorded entries are kept
//
// AUTHORIZATION follows the bill's account (and the destination account for transfers): seeing a
// bill needs view-transactions; creating or recording needs create; changing, skipping or pausing
// follows the same rule as editing an entry (a plain member may change only shared bills they
// created). Other people's private bills are 404, never 403.
//
// HISTORY: term changes (amount, amount type, category, payee, responsible person) need an
// effective date and add a version; earlier versions and recorded entries are never modified.
const { readBody, query, header, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { can, canChangeRecord } = require('../_shared/authz');
const { readDocument } = require('../_shared/schema');
const store = require('../_shared/store');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const people = require('../_shared/people');
const schedule = require('../_shared/schedule');
const ledger = require('../_shared/ledger');
const bills = require('../_shared/bills');
const merchants = require('../_shared/merchants');
const icons = require('../_shared/icons');

const CREATE_KEYS = ['name', 'billType', 'kind', 'accountId', 'toAccountId', 'amount', 'amountType', 'schedule', 'categoryId', 'payeeId', 'responsibleRef', 'reminderDays', 'notes', 'tripId', 'trackFrom', 'icon'];
const PATCH_KEYS = ['recurringId', 'revision', 'effectiveFrom', 'amount', 'amountType', 'categoryId', 'payeeId', 'responsibleRef', 'name', 'billType', 'notes', 'reminderDays', 'endDate', 'icon'];
// The icon catalogue is read only when an icon is being chosen (BT-011-05).
const catalogFor = async (ctx, body) => (body.icon !== undefined ? (await icons.readCatalog(ctx.storage)).catalog : null);
const TERM_KEYS = ['amount', 'amountType', 'categoryId', 'payeeId', 'responsibleRef'];
const NOT_FOR_TRANSFERS = ['categoryId', 'payeeId', 'responsibleRef'];

async function readUser(ctx) {
  const { value } = await ctx.storage.getJson(store.paths.user(ctx.principal.subject));
  return readDocument('user', value) || { contacts: [] };
}

function accountFor(doc, principal, id, capability, now) {
  const a = (doc.accounts || []).find((x) => x.id === id && !x.deletedAt);
  if (!a || !can(doc, principal, a, 'view-transactions', now)) throw notFound('Unknown account.');
  if (capability && !can(doc, principal, a, capability, now)) throw forbidden(`You do not have ${capability} permission on this account.`);
  // A closed account takes no new bills (BT-001-05, audit D1).
  if (capability === 'create' && a.status === 'closed') throw conflict(`${a.name} is closed. Reopen it on the Accounts page first.`, 'account_closed');
  return a;
}

function checkCategory(doc, value) {
  const id = fields.optionalId(value, 'Category');
  if (id && !(doc.categories || []).some((c) => c.id === id)) throw badRequest('Unknown category.', 'invalid_category');
  return id;
}

// Bounded so a year of occurrences across every bill in a workspace can never overflow a total
// and break bills, budgets or the forecast for everyone (security review SEC-B3).
const MAX_BILL_MINOR = 1e10;
const MAX_BILLS = 500;

function positive(text, currency, field = 'Amount') {
  const m = money.parseDecimal(text, currency, field);
  if (m <= 0) throw badRequest(`${field} must be greater than zero.`, 'invalid_amount');
  if (m > MAX_BILL_MINOR) throw badRequest(`${field} is larger than a recurring bill can be.`, 'amount_too_large');
  return m;
}

function reminderDays(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > 60) throw badRequest('Reminder must be a whole number of days from 0 to 60.', 'invalid_field');
  return value;
}

function tripFor(doc, value) {
  const id = fields.optionalId(value, 'Trip');
  if (id && !(doc.trips || []).some((t) => t.id === id && !t.deletedAt)) throw badRequest('Unknown trip.', 'invalid_trip');
  return id;
}

function history(r, by, at, changed, changes = []) {
  // Never truncated (BT-001-05); growth is bounded by the member quota and the document cap.
  // `changes` keeps the before and after values of detail edits (audit B14).
  r.history = [...(r.history || []), { revision: r.revision, at, by, fields: changed, ...(changes.length ? { changes } : {}) }];
}

function locate(doc, principal, id, now) {
  const r = (doc.recurring || []).find((x) => x.id === id && !x.deletedAt);
  const a = r && (doc.accounts || []).find((x) => x.id === r.accountId);
  // A bill on a deleted account is gone for everyone, like the account itself (SEC-B7).
  if (!r || !a || a.deletedAt || !can(doc, principal, a, 'view-transactions', now)) throw notFound('Unknown bill.');
  return { r, a };
}

// Overdue means owed and tracked: an occurrence before the bill's tracking start was never owed
// here, so it keeps its own date when recorded (financial retest FIN-U1).
const isOverdue = (r, occurrence, today) => occurrence < today && occurrence >= bills.trackStart(r);

function requireOccurrence(r, value) {
  const occurrence = fields.date(value, 'Occurrence', { required: true });
  if (!schedule.occurrences(r.schedule, occurrence, occurrence).length) throw badRequest('That date is not an occurrence of this bill.', 'invalid_occurrence');
  return occurrence;
}

function view(doc, r, principal, user, today, now, recorded) {
  const a = (doc.accounts || []).find((x) => x.id === r.accountId);
  const dest = r.toAccountId ? (doc.accounts || []).find((x) => x.id === r.toAccountId) : null;
  const payees = new Map((doc.payees || []).map((p) => [p.id, p]));
  const names = new Map((doc.members || []).map((m) => [m.subject, m.name || 'Member']));
  const c = r.currency;
  const termsView = (v) => ({
    effectiveFrom: v.effectiveFrom, amount: money.toDecimal(v.amountMinor, c), amountType: v.amountType, categoryId: v.categoryId,
    payeeId: v.payeeId || null, payeeName: v.payeeId && payees.get(v.payeeId) ? payees.get(v.payeeId).name : '',
    responsible: people.labelFor(v.responsibleRef, { doc, user }),
  });
  // A bill whose account is closed or removed takes no payments, so it has nothing due; it is shown
  // with the reason instead of silently vanishing (FIN-R9).
  // Whether a destination the viewer cannot see was closed or removed is not theirs to know (SEC-T3).
  const issue = bills.accountIssue(doc, r);
  const hiddenDest = issue && issue.startsWith('destination_') && !(dest && can(doc, principal, dest, 'view-balances', now));
  const inactiveReason = hiddenDest ? 'destination_unavailable' : issue;
  const upcoming = inactiveReason ? [] : bills.dueBetween(r, today, schedule.addDays(today, 400), recorded).slice(0, 6);
  // The full overdue list is counted; only the displayed list is bounded (FIN-R12).
  const overdue = inactiveReason ? [] : bills.overdue(r, today, recorded);
  const prefix = `${r.id}|`;
  return {
    id: r.id, name: r.name, billType: r.billType, kind: r.kind, currency: c,
    ...icons.effective('bill', r, doc),
    accountId: r.accountId, accountName: a ? a.name : '',
    // Someone else's private destination is neither named nor identified (SEC-B12).
    toAccountId: dest && can(doc, principal, dest, 'view-balances', now) ? r.toAccountId : null,
    toAccountName: dest ? (can(doc, principal, dest, 'view-balances', now) ? dest.name : 'Another member\'s account') : null,
    ...termsView(bills.termsAt(r, today)),
    schedule: { freq: r.schedule.freq, interval: r.schedule.interval, startDate: r.schedule.startDate, endDate: r.schedule.endDate },
    reminderDays: r.reminderDays, notes: r.notes || '', tripId: r.tripId || null, trackFrom: r.trackFrom,
    nextDue: upcoming[0] || null, upcoming, inactiveReason,
    overdue: overdue.slice(-24), overdueCount: overdue.length,
    reminders: inactiveReason ? [] : bills.reminders(r, today, recorded),
    skips: bills.activeSkips(r).map((s) => ({ date: s.date, reason: s.reason || '' })),
    pauses: bills.effectivePauses(r).map((p) => ({ id: p.id, from: p.from, until: p.until })),
    pausedNow: bills.isPaused(r, today),
    ended: !!(r.schedule.endDate && r.schedule.endDate < today),
    versions: r.versions.map(termsView),
    recordedCount: [...recorded.keys()].filter((k) => k.startsWith(prefix)).length,
    history: (r.history || []).slice(-20).map((h) => ({ at: h.at, by: names.get(h.by) || 'Former member', fields: h.fields, changes: h.changes || [] })),
    revision: r.revision,
    canEdit: a ? canChangeRecord(doc, principal, a, r, 'edit', now) : false,
    canDelete: a ? canChangeRecord(doc, principal, a, r, 'delete', now) : false,
    canRecord: !inactiveReason && !!a && can(doc, principal, a, 'create', now) && (!dest || can(doc, principal, dest, 'create', now)),
  };
}

async function list(ctx, req) {
  const action = query(req, 'action');
  if (action === 'draft') return draft(ctx, req);
  if (action !== undefined) throw notFound();
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const user = await readUser(ctx);
  const now = ctx.now();
  const today = ctx.nowIso().slice(0, 10);
  const recorded = bills.recordedSet(doc);
  const visible = (doc.recurring || []).filter((r) => {
    if (r.deletedAt) return false;
    const a = (doc.accounts || []).find((x) => x.id === r.accountId);
    return a && !a.deletedAt && can(doc, ctx.principal, a, 'view-transactions', now);
  });
  const views = visible.map((r) => view(doc, r, ctx.principal, user, today, now, recorded));
  // NEXT 30 DAYS (FIN-R11): a transfer between two accounts whose entries the viewer sees is a
  // movement, reported apart from money in and out; a transfer into an account the viewer cannot
  // see has left their view, so it counts as money out for them.
  const next30 = {};
  const seesEntries = (id) => { const x = (doc.accounts || []).find((acc) => acc.id === id && !acc.deletedAt); return !!x && can(doc, ctx.principal, x, 'view-transactions', now); };
  for (const r of visible) {
    if (bills.accountIssue(doc, r)) continue;
    const internal = r.kind === 'transfer' && seesEntries(r.toAccountId);
    for (const d of bills.dueBetween(r, today, schedule.addDays(today, 30), recorded)) {
      const s = next30[r.currency] || (next30[r.currency] = { out: 0, in: 0, moved: 0 });
      const m = bills.termsAt(r, d).amountMinor;
      if (r.kind === 'income') s.in = money.sum([s.in, m]);
      else if (internal) s.moved = money.sum([s.moved, m]);
      else s.out = money.sum([s.out, m]);
    }
  }
  const summary = {
    overdue: views.reduce((n, v) => n + v.overdueCount, 0),
    dueSoon: views.reduce((n, v) => n + v.reminders.length, 0),
    next30Days: Object.entries(next30).map(([currency, s]) => ({ currency, outgoing: money.toDecimal(s.out, currency), incoming: money.toDecimal(s.in, currency), transfers: money.toDecimal(s.moved, currency) })),
  };
  return { body: { recurring: views, summary, today } };
}

async function draft(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const user = await readUser(ctx);
  const now = ctx.now();
  const today = ctx.nowIso().slice(0, 10);
  const { r } = locate(doc, ctx.principal, requireId(query(req, 'recurringId'), 'recurringId'), now);
  const occurrence = requireOccurrence(r, query(req, 'occurrence'));
  const status = bills.occurrenceStatus(r, occurrence, bills.recordedSet(doc));
  if (status === 'recorded') throw conflict('This occurrence is already recorded.', 'already_recorded');
  const t = bills.termsAt(r, occurrence);
  const payee = t.payeeId && (doc.payees || []).find((p) => p.id === t.payeeId);
  return {
    body: {
      saved: false,
      draft: {
        recurringId: r.id, name: r.name, occurrence, date: isOverdue(r, occurrence, today) ? today : occurrence, status, overdue: status === 'due' && isOverdue(r, occurrence, today),
        kind: r.kind, accountId: r.accountId, toAccountId: r.toAccountId || null, currency: r.currency,
        amount: money.toDecimal(t.amountMinor, r.currency), amountType: t.amountType, amountIsEstimate: t.amountType === 'variable',
        categoryId: t.categoryId, payeeId: t.payeeId || null, payeeName: payee ? payee.name : '', responsible: people.labelFor(t.responsibleRef, { doc, user }),
      },
    },
  };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), CREATE_KEYS);
  const user = await readUser(ctx);
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const nowIso = ctx.nowIso();
    const today = nowIso.slice(0, 10);
    if ((doc.recurring || []).filter((x) => !x.deletedAt).length >= MAX_BILLS) throw conflict(`This workspace has reached its limit of ${MAX_BILLS} bills. End bills you no longer need.`, 'too_many_bills');
    const billType = fields.oneOf(body.billType, bills.BILL_TYPES, 'Bill type', 'custom');
    const a = accountFor(doc, ctx.principal, requireId(body.accountId, 'accountId'), 'create', now);
    const kind = fields.oneOf(body.kind, bills.KINDS, 'Kind', bills.defaultKind(billType, body.toAccountId));
    const sched = schedule.validateSchedule(body.schedule);
    const r = {
      id: newId('rec'), name: fields.text(body.name, { field: 'Name', max: 80, required: true }), billType, kind,
      accountId: a.id, toAccountId: null, currency: a.currency, schedule: sched,
      reminderDays: reminderDays(body.reminderDays, 3), notes: fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }),
      tripId: tripFor(doc, body.tripId), trackFrom: fields.date(body.trackFrom, 'Track from') || today,
      icon: body.icon === undefined ? null : icons.validateChoice(catalog, body.icon),
      versions: [], skips: [], pauses: [], resumes: [], createdBy: member.subject, createdAt: nowIso, revision: 1, deletedAt: null, history: [],
    };
    const version = {
      id: newId('ver'), effectiveFrom: sched.startDate, amountMinor: positive(body.amount, a.currency),
      amountType: fields.oneOf(body.amountType, bills.AMOUNT_TYPES, 'Amount type', 'fixed'),
      categoryId: null, payeeId: null, responsibleRef: null, createdAt: nowIso, createdBy: member.subject,
    };
    if (kind === 'transfer') {
      if (NOT_FOR_TRANSFERS.some((k) => body[k] !== undefined)) throw badRequest('Transfers between accounts have no category, payee or responsible person.', 'invalid_transfer');
      const dest = accountFor(doc, ctx.principal, requireId(body.toAccountId, 'toAccountId'), 'create', now);
      if (dest.id === a.id) throw badRequest('A transfer needs two different accounts.', 'invalid_transfer');
      if (dest.currency !== a.currency) throw badRequest('Recurring transfers between currencies are not supported yet.', 'unsupported');
      r.toAccountId = dest.id;
    } else {
      if (body.toAccountId !== undefined) throw badRequest('Only transfers have a destination account.', 'invalid_field');
      version.categoryId = checkCategory(doc, body.categoryId);
      version.payeeId = merchants.requireMerchant(doc, ctx.principal, a, body.payeeId, now);
      version.responsibleRef = people.requireRef(body.responsibleRef, { doc, user, visibility: a.visibility });
    }
    r.versions.push(version);
    history(r, member.subject, nowIso, ['create']);
    doc.recurring = [...(doc.recurring || []), r];
    ledger.assertMemberQuota(doc, member, ctx.env);
    audit.record(doc, { actor: member.subject, action: 'recurring.create', targetType: 'recurring', targetId: r.id, scope: `account:${a.id}`, at: nowIso });
    return { recurring: view(doc, r, ctx.principal, user, today, now, bills.recordedSet(doc)) };
  }, { idempotencyKey: header(req, 'idempotency-key') || undefined, idempotencyScope: 'recurring.create', requestHash: store.requestHash({ q: wsId, body }) });
  return { status: 201, body: result };
}

// Turns one reviewed occurrence into a real entry. The (bill, occurrence) pair is unique among live
// entries, so a double click, a retry or a second person cannot record it twice. Values not given
// come from the terms effective on the occurrence date; a variable bill needs the actual amount.
async function record(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['recurringId', 'occurrence', 'amount', 'date', 'categoryId', 'payeeId', 'responsibleRef', 'notes', 'status']);
  const user = await readUser(ctx);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const nowIso = ctx.nowIso();
    const { r, a } = locate(doc, ctx.principal, requireId(body.recurringId, 'recurringId'), now);
    if (!can(doc, ctx.principal, a, 'create', now)) throw forbidden('You cannot add entries to this account.');
    if (a.status === 'closed') throw conflict(`${a.name} is closed. Reopen it on the Accounts page to record this payment.`, 'account_closed');
    const occurrence = requireOccurrence(r, body.occurrence);
    const status = bills.occurrenceStatus(r, occurrence, bills.recordedSet(doc));
    if (status === 'recorded') throw conflict('This occurrence is already recorded.', 'already_recorded');
    if (status === 'skipped') throw conflict('This occurrence was skipped. Undo the skip before recording it.', 'skipped');
    if (status === 'paused') throw conflict('This occurrence falls in a pause. Resume the bill before recording it.', 'paused');
    const terms = bills.termsAt(r, occurrence);
    if (body.amount === undefined && terms.amountType === 'variable') throw badRequest('This bill varies. Enter the actual amount before recording it.', 'amount_required');
    // Never copy a reference to a category that no longer exists into a new entry (SEC-B1).
    if (r.kind !== 'transfer' && body.categoryId === undefined && terms.categoryId && !(doc.categories || []).some((c) => c.id === terms.categoryId)) {
      throw conflict('This bill\'s category no longer exists. Choose a category for this payment or edit the bill.', 'bill_category_missing');
    }
    const magnitude = body.amount === undefined ? terms.amountMinor : positive(body.amount, r.currency);
    const base = {
      // An overdue occurrence is paid today unless told otherwise, so it moves from owed to spent in
      // the same budget period and what is available does not jump (financial retest FIN-T3).
      date: fields.date(body.date, 'Date') || (isOverdue(r, occurrence, nowIso.slice(0, 10)) ? nowIso.slice(0, 10) : occurrence), postedDate: null,
      status: fields.oneOf(body.status, ['pending', 'cleared'], 'Status', 'pending'),
      notes: fields.text(body.notes, { field: 'Notes', max: 5000, multiline: true }),
      createdBy: member.subject, createdAt: nowIso, revision: 1, deletedAt: null, original: null,
    };
    const created = [];
    if (r.kind === 'transfer') {
      if (NOT_FOR_TRANSFERS.some((k) => body[k] !== undefined)) throw badRequest('Transfers between accounts have no category, payee or responsible person.', 'invalid_transfer');
      const dest = (doc.accounts || []).find((x) => x.id === r.toAccountId);
      // Permission first, so the answer never reveals whether someone else's account still exists (SEC-B12).
      if (!dest || !can(doc, ctx.principal, dest, 'create', now)) throw forbidden('You cannot add entries to the destination account.');
      if (dest.deletedAt) throw conflict('The destination account no longer exists.', 'destination_missing');
      if (dest.status === 'closed') throw conflict(`${dest.name} is closed. Reopen it to record this transfer.`, 'account_closed');
      const transferId = newId('xfr');
      const leg = (accountId, amountMinor, counterpartAccountId) => ({
        ...base, id: newId('txn'), accountId, kind: 'transfer', amountMinor, currency: r.currency, transferId, counterpartAccountId,
        payeeId: null, categoryId: null, responsibleRef: null, tags: [], splits: [], links: { recurringId: r.id, occurrence },
      });
      created.push(leg(a.id, -magnitude, dest.id), leg(dest.id, magnitude, a.id));
    } else {
      created.push({
        ...base, id: newId('txn'), accountId: a.id, kind: r.kind, amountMinor: bills.signed(r.kind, magnitude), currency: r.currency,
        // A new entry never links to a closed merchant, including the bill's own (BT-007-01).
        payeeId: body.payeeId !== undefined ? merchants.requireMerchant(doc, ctx.principal, a, body.payeeId, now) : merchants.requireOpen(doc, terms.payeeId),
        categoryId: body.categoryId !== undefined ? checkCategory(doc, body.categoryId) : terms.categoryId,
        responsibleRef: body.responsibleRef !== undefined ? people.requireRef(body.responsibleRef, { doc, user, visibility: a.visibility }) : terms.responsibleRef,
        transferId: null, counterpartAccountId: null, tags: [], splits: [], links: { recurringId: r.id, occurrence },
      });
    }
    for (const t of created) history(t, member.subject, nowIso, ['create', 'from-bill']);
    doc.transactions = [...(doc.transactions || []), ...created];
    ledger.assertLedgerInRange(doc);
    ledger.assertMemberQuota(doc, member, ctx.env);
    for (const t of created) audit.record(doc, { actor: member.subject, action: 'transaction.create', targetType: 'transaction', targetId: t.id, scope: `account:${t.accountId}`, at: nowIso });
    audit.record(doc, { actor: member.subject, action: 'recurring.record', targetType: 'recurring', targetId: r.id, scope: `account:${a.id}`, at: nowIso });
    const look = { accounts: new Map((doc.accounts || []).map((x) => [x.id, x])), payees: new Map((doc.payees || []).map((x) => [x.id, x])) };
    return { occurrence, transactions: created.map((t) => ledger.transactionView(doc, t, ctx.principal, now, look)) };
  }, { idempotencyKey: header(req, 'idempotency-key') || undefined, idempotencyScope: 'recurring.record', requestHash: store.requestHash({ q: wsId, body }) });
  return { status: 201, body: result };
}

const CHANGE_KEYS = {
  skip: ['recurringId', 'occurrence', 'reason'],
  unskip: ['recurringId', 'occurrence'],
  pause: ['recurringId', 'from', 'until'],
  resume: ['recurringId', 'date'],
};

// Skips, pauses and resumes. None of them touches recorded entries.
function change(action) {
  return async (ctx, req) => {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), CHANGE_KEYS[action]);
    const user = await readUser(ctx);
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const now = ctx.now();
      const nowIso = ctx.nowIso();
      const today = nowIso.slice(0, 10);
      const { r, a } = locate(doc, ctx.principal, requireId(body.recurringId, 'recurringId'), now);
      if (!canChangeRecord(doc, ctx.principal, a, r, 'edit', now)) throw forbidden('You cannot change this bill.');
      const recorded = bills.recordedSet(doc);
      let changed = null;
      if (action === 'skip') {
        const occurrence = requireOccurrence(r, body.occurrence);
        if (recorded.has(`${r.id}|${occurrence}`)) throw conflict('This occurrence is already recorded. Delete that entry instead of skipping it.', 'already_recorded');
        if (!bills.isSkipped(r, occurrence)) {
          r.skips = [...(r.skips || []), { date: occurrence, reason: fields.text(body.reason, { field: 'Reason', max: 200 }), at: nowIso, by: member.subject }];
          changed = `skip ${occurrence}`;
        }
      } else if (action === 'unskip') {
        const occurrence = requireOccurrence(r, body.occurrence);
        if (bills.isSkipped(r, occurrence)) {
          // The skip record is kept and marked withdrawn, never removed (BT-001-05).
          r.skips = (r.skips || []).map((s) => (s.date === occurrence && !s.withdrawnAt ? { ...s, withdrawnAt: nowIso, withdrawnBy: member.subject } : s));
          changed = `unskip ${occurrence}`;
        }
      } else if (action === 'pause') {
        const from = fields.date(body.from, 'From', { required: true });
        const until = fields.date(body.until, 'Until');
        if (until && until < from) throw badRequest('The pause ends before it starts.', 'invalid_pause');
        const open = '9999-12-31';
        if (bills.effectivePauses(r).some((p) => from <= (p.until || open) && p.from <= (until || open))) throw conflict('This pause overlaps an existing pause.', 'overlapping_pause');
        r.pauses = [...(r.pauses || []), { id: newId('pau'), from, until: until || null, at: nowIso, by: member.subject }];
        changed = `pause ${from}${until ? ` to ${until}` : ''}`;
      } else {
        const date = fields.date(body.date, 'Date') || today;
        const covering = bills.effectivePauses(r).filter((p) => p.from <= date && (!p.until || date <= p.until));
        if (!covering.length) throw conflict('This bill is not paused on that date.', 'not_paused');
        // Pause records are never edited: each resume is its own record (BT-001-05).
        r.resumes = [...(r.resumes || []), ...covering.map((p) => ({ id: newId('res'), pauseId: p.id, date, at: nowIso, by: member.subject }))];
        changed = `resume ${date}`;
      }
      if (changed) {
        r.revision += 1;
        r.updatedAt = nowIso;
        history(r, member.subject, nowIso, [changed]);
        ledger.assertMemberQuota(doc, member, ctx.env);
        audit.record(doc, { actor: member.subject, action: `recurring.${action}`, targetType: 'recurring', targetId: r.id, scope: `account:${a.id}`, at: nowIso });
      }
      return { recurring: view(doc, r, ctx.principal, user, today, now, recorded) };
    });
    return { body: result };
  };
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), PATCH_KEYS);
  const user = await readUser(ctx);
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const nowIso = ctx.nowIso();
    const { r, a } = locate(doc, ctx.principal, requireId(body.recurringId, 'recurringId'), now);
    if (!canChangeRecord(doc, ctx.principal, a, r, 'edit', now)) throw forbidden('You cannot change this bill.');
    if (!Number.isSafeInteger(body.revision)) throw badRequest('revision is required so a stale edit cannot overwrite a newer one.', 'missing_revision');
    if (body.revision !== r.revision) throw conflict('This bill changed since you loaded it. Reload to see the latest version.', 'stale_revision');
    const changed = [];
    const details = [];
    const note = (field, from, to) => { if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) details.push({ field, from: from ?? null, to: to ?? null }); };
    let effectiveFrom = null;
    if (TERM_KEYS.some((k) => body[k] !== undefined)) {
      if (r.kind === 'transfer' && NOT_FOR_TRANSFERS.some((k) => body[k] !== undefined)) throw badRequest('Transfers between accounts have no category, payee or responsible person.', 'invalid_transfer');
      effectiveFrom = fields.date(body.effectiveFrom, 'Effective from', { required: true });
      if (effectiveFrom < r.schedule.startDate) throw badRequest('A change cannot take effect before the bill starts.', 'invalid_effective_date');
      const v = { ...bills.termsAt(r, effectiveFrom), id: newId('ver'), effectiveFrom, createdAt: nowIso, createdBy: member.subject };
      if (body.amount !== undefined) v.amountMinor = positive(body.amount, r.currency);
      if (body.amountType !== undefined) v.amountType = fields.oneOf(body.amountType, bills.AMOUNT_TYPES, 'Amount type');
      if (body.categoryId !== undefined) v.categoryId = checkCategory(doc, body.categoryId);
      if (body.payeeId !== undefined) v.payeeId = merchants.requireMerchant(doc, ctx.principal, a, body.payeeId, now, { current: v.payeeId });
      if (body.responsibleRef !== undefined) v.responsibleRef = people.requireRef(body.responsibleRef, { doc, user, visibility: a.visibility });
      r.versions = [...r.versions, v];
      changed.push('terms');
    } else if (body.effectiveFrom !== undefined) {
      throw badRequest('An effective date applies only to amount, category, payee or responsible-person changes.', 'invalid_field');
    }
    if (body.name !== undefined) { const v = fields.text(body.name, { field: 'Name', max: 80, required: true }); note('name', r.name, v); r.name = v; changed.push('name'); }
    if (body.billType !== undefined) { const v = fields.oneOf(body.billType, bills.BILL_TYPES, 'Bill type'); note('billType', r.billType, v); r.billType = v; changed.push('billType'); }
    if (body.notes !== undefined) { const v = fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }); note('notes', r.notes || '', v); r.notes = v; changed.push('notes'); }
    if (body.reminderDays !== undefined) { const v = reminderDays(body.reminderDays); note('reminderDays', r.reminderDays, v); r.reminderDays = v; changed.push('reminderDays'); }
    if (body.icon !== undefined) {
      const icon = icons.validateChoice(catalog, body.icon, { current: r.icon || null });
      if (icon !== (r.icon || null)) {
        // Before and after are kept in the history (BT-001-05).
        r.iconHistory = [...(r.iconHistory || []), { at: nowIso, by: member.subject, from: r.icon || null, to: icon }];
        note('icon', r.icon || null, icon);
        r.icon = icon;
        changed.push('icon');
      }
    }
    if (body.endDate !== undefined) {
      const endDate = fields.date(body.endDate, 'End date');
      if (endDate && endDate < r.schedule.startDate) throw badRequest('The end date is before the start date.', 'invalid_schedule');
      note('endDate', r.schedule.endDate || null, endDate || null);
      r.schedule = { ...r.schedule, endDate: endDate || null };
      changed.push('endDate');
    }
    if (changed.length) {
      r.revision += 1;
      r.updatedAt = nowIso;
      history(r, member.subject, nowIso, changed.map((c) => (c === 'terms' ? `terms from ${effectiveFrom}` : c)), details);
      ledger.assertMemberQuota(doc, member, ctx.env);
      audit.record(doc, { actor: member.subject, action: 'recurring.update', targetType: 'recurring', targetId: r.id, scope: `account:${a.id}`, at: nowIso, fields: changed });
    }
    return { recurring: view(doc, r, ctx.principal, user, nowIso.slice(0, 10), now, bills.recordedSet(doc)) };
  });
  return { body: result };
}

async function remove(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['recurringId', 'revision']);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const nowIso = ctx.nowIso();
    const { r, a } = locate(doc, ctx.principal, requireId(body.recurringId, 'recurringId'), now);
    if (!canChangeRecord(doc, ctx.principal, a, r, 'delete', now)) throw forbidden('You cannot remove this bill.');
    if (body.revision !== r.revision) throw conflict('This bill changed since you loaded it.', 'stale_revision');
    r.deletedAt = nowIso;
    r.revision += 1;
    history(r, member.subject, nowIso, ['delete']);
    audit.record(doc, { actor: member.subject, action: 'recurring.delete', targetType: 'recurring', targetId: r.id, scope: `account:${a.id}`, at: nowIso });
    return { removed: r.id };
  }, { allowHeadroom: true });
  return { body: result };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === undefined) return create(ctx, req);
  if (action === 'record') return record(ctx, req);
  if (Object.prototype.hasOwnProperty.call(CHANGE_KEYS, action)) return change(action)(ctx, req);
  throw notFound();
}

module.exports = { GET: list, POST: post, PATCH: patch, DELETE: remove };
