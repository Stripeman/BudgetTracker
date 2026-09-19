'use strict';
// /api/group?workspaceId=   Shared expenses and settlement (BT-009)
//   GET                                     participants, expenses, settlements, balances per currency
//                                           (with suggestions and the direct view) and the caller's rights
//   GET  ?action=balances                   balances only
//   GET  ?action=history&expenseId= | &settlementId=   who changed what, from what to what, when, why
//   POST { description, date?, amount, currency?, rate?, rateSource?, rateDate?, categoryId?, notes?,
//          payers, split, ledger? }        add an expense (Idempotency-Key supported). `currency`
//                                           defaults to the group's reporting currency; a DIFFERENT
//                                           currency needs `rate` too (BT-009-13: 1 unit of `currency`
//                                           = `rate` units of the reporting currency) — the server
//                                           converts and stores both: `amount`/`currency` become the
//                                           converted reporting-currency figures every calculation
//                                           already uses, and `original` (amount, currency, rate,
//                                           source, date) is kept for good, exactly as entered.
//   PATCH { expenseId, revision, reason, description?, date?, amount?, currency?, rate?, rateSource?,
//           rateDate?, categoryId?, notes?, payers?, split? }  a foreign-currency expense's amount is
//                                           changed by resubmitting it in its OWN original currency
//                                           and rate, same as creating one; its currency itself can
//                                           never change once recorded
//   POST ?action=void    { expenseId | settlementId, revision, reason }
//   POST ?action=settle  { from, to, amount, currency?, date?, method?, notes?, ledger? }  report a
//                                           payment (Idempotency-Key supported)
//   POST ?action=confirm { settlementId, revision, ledger? }
//   POST ?action=dispute { settlementId, revision, reason }
//   POST ?action=ledger  { expenseId | settlementId | currency, accountId? }  record the caller's part of
//                                           the group in that currency on their own private account
//                                           (accountId), bring their entries up to date (no accountId)
//                                           or stop recording (accountId: null)
//   GET  ?action=events                     the event directory (BT-009-20): every named event, its
//                                           status and counts. An expense/settlement's `eventId`
//                                           (also optionally in POST { eventId }, default the
//                                           workspace's own default event, created lazily on first
//                                           use) says which one it belongs to; the plain GET above is
//                                           unchanged — every event combined, exactly as before events
//                                           existed.
//   POST ?action=create-event   { name, description?, icon?, color? }   any writer
//   POST ?action=event-status   { eventId, status: active|closed|archived, reason? }   manager/owner
//                                           only, audited. Closed: no new expenses, but new/confirmed/
//                                           disputed settlements and voiding a payment stay possible;
//                                           expense corrections and expense voids need it reopened.
//                                           Archived: fully read-only. Never forgives debt or erases
//                                           history either way.
//   GET  ?action=split-presets              saved split presets (BT-009-25): who is typically in a
//                                           recurring split and in what PROPORTION, reusable across
//                                           expense sizes. 'equal'/'shares'/'percentages' only — never
//                                           a money-shaped method.
//   POST ?action=create-split-preset  { name, method, lines }   any writer
//   POST ?action=delete-split-preset  { presetId }   its own creator, or a manager/owner
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
const sharedExport = require('../_shared/sharedexport');
const groupSettings = require('../_shared/group-settings');
const entries = require('../_shared/entries');
const model = require('../_shared/workspace-model');
const siteSettings = require('../_shared/site');
const workspaceSettings = require('../_shared/workspace-settings');
const { readDocument } = require('../_shared/schema');

// `confirmBackdated` accompanies `ledger` wherever both may appear: it answers the FA-1 warning (below)
// when starting to record on an account would backdate confirmed cash the caller has not yet seen.
const CREATE_KEYS = ['description', 'date', 'amount', 'currency', 'rate', 'rateSource', 'rateDate', 'categoryId', 'notes', 'payers', 'split', 'ledger', 'confirmBackdated', 'eventId'];
const PATCH_KEYS = ['expenseId', 'revision', 'reason', 'description', 'date', 'amount', 'currency', 'rate', 'rateSource', 'rateDate', 'categoryId', 'notes', 'payers', 'split', 'eventId'];
const SETTLE_KEYS = ['from', 'to', 'amount', 'currency', 'date', 'method', 'notes', 'ledger', 'confirmBackdated', 'eventId'];
// Every correction keeps the before and after values of these fields.
const TRACKED = ['description', 'date', 'amountMinor', 'original', 'categoryId', 'notes', 'payers', 'split', 'shares', 'eventId'];
const LINK_KEY = Object.freeze({ expense: 'groupExpenseId', settlement: 'groupSettlementId' });

const selfRef = (member) => `member:${member.id}`;
const isManager = (member) => roleAtLeast(member.role, 'manager');
const writer = (member) => member.role !== 'viewer';
function requireWriter(member) {
  if (!writer(member)) throw forbidden('Viewers can see shared expenses but cannot add or change them.');
}
const reportingCurrency = (doc) => (doc.settings && doc.settings.reportingCurrency) || 'EUR';
// BT-009-13 (Terry's split-costs check, 2026-09-14): "an expense may be entered in a currency other
// than the group's; it keeps the original amount and currency, the rate, its source and date, and
// the converted amount in the group currency; shares, balances and settlement use the converted
// amount with deterministic rounding; changing rates later never changes a recorded expense."
// Every calculation everywhere else in this file, and the whole of groups.js's balance engine,
// keeps operating on the expense's own `amountMinor`/`currency` exactly as before — those are
// ALWAYS the converted, reporting-currency figures; `original` is purely additional, preserved
// information, never read by any balance/share/settlement calculation. The server computes the
// conversion itself (`money.convert`, already built and used for account-to-account transfers;
// never the client's own arithmetic) so a mismatched rate can never silently corrupt a shared
// balance the way trusting a client-supplied converted amount could.
function expenseAmount(doc, body, field = 'Amount') {
  const reporting = reportingCurrency(doc);
  const requested = body.currency === undefined || body.currency === null ? reporting : body.currency;
  if (requested === reporting) {
    return { currency: reporting, amountMinor: groups.positiveAmount(body.amount, reporting, field), original: null };
  }
  money.precisionOf(requested); // throws badRequest('unsupported_currency') on an unknown code
  if (body.rate === undefined || body.rate === null) throw badRequest(`Give the exchange rate to convert from ${requested} to ${reporting}.`, 'missing_rate');
  const originalMinor = groups.positiveAmount(body.amount, requested, field);
  const rate = money.parseRate(body.rate);
  const amountMinor = money.convert(originalMinor, requested, reporting, rate.text);
  if (amountMinor <= 0) throw badRequest(`${field} converts to zero in ${reporting} at that rate.`, 'invalid_amount');
  if (amountMinor > groups.MAX_GROUP_MINOR) throw badRequest(`${field} is larger than a shared expense can be, once converted to ${reporting}.`, 'amount_too_large');
  return {
    currency: reporting, amountMinor,
    original: {
      amountMinor: originalMinor, currency: requested, rate: rate.text,
      rateSource: fields.oneOf(body.rateSource, ['bank-posted', 'manual', 'provider', 'agreed'], 'Rate source', 'manual'),
      rateDate: fields.date(body.rateDate, 'Rate date') || fields.date(body.date, 'Date') || null,
    },
  };
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

// ---- events (BT-009-20) ---------------------------------------------------------------------
// Shared expenses now belong to a named, stable EVENT (Terry, 2026-09-19): its own id, name,
// description, icon/colour and lifecycle status. This is the FOUNDATION only — a workspace's own
// balances/expenses/settlements views stay exactly as they were (all events combined) unless a
// caller explicitly asks to see one event's own slice, so nothing existing changes shape or
// behaviour by default. `api/_shared/schema.js`'s migration back-fills every pre-existing record
// into one legacy event; a workspace with no records yet has none until its first expense/payment
// lazily creates one (`resolveEvent` below) — never guessing separate historical boundaries.
const EVENT_STATUSES = ['active', 'closed', 'archived'];
const findEvent = (doc, id) => {
  const e = (doc.groupEvents || []).find((x) => x.id === id);
  if (!e) throw notFound('Unknown event.');
  return e;
};
// The event a record belongs to, or null for a record that predates events entirely and was
// never migrated (defensive only — every record in a document that has gone through
// `readDocument` has an `eventId`; this only guards a document read some other way, e.g. a test
// fixture built by hand).
const eventOf = (doc, rec) => (rec.eventId ? (doc.groupEvents || []).find((e) => e.id === rec.eventId) || null : null);
// Active: everything allowed. Closed: "no new expenses; outstanding balances remain visible and
// settlement/dispute resolution remains possible" (Terry, 2026-09-19) — callers that still allow a
// closed event pass `allowWhenClosed`. Archived is always fully read-only, with no exception.
function assertEventWritable(event, { allowWhenClosed = false } = {}) {
  if (!event) return;
  if (event.status === 'archived') throw conflict(`"${event.name}" is archived and read-only. Reopen it first.`, 'event_archived');
  if (event.status === 'closed' && !allowWhenClosed) throw conflict(`"${event.name}" is closed. Reopen it to make this change.`, 'event_closed');
}
// The event a new expense/settlement belongs to: the one named in the request, or the workspace's
// current default. A workspace that has never had a shared-expense record yet has no default —
// its very first one lazily creates a plain "General" event, atomically, in the same write (never
// a separate provisioning step nobody remembers to run). Terry, 2026-09-19: "Do not require a new
// workspace for every dinner, outing or event" — the reverse holds too: no event-picking ceremony
// is required before the very first expense either.
function resolveEvent(doc, member, nowIso, body) {
  if (body.eventId !== undefined) return findEvent(doc, requireId(body.eventId, 'eventId'));
  if (doc.defaultEventId) {
    const ev = (doc.groupEvents || []).find((e) => e.id === doc.defaultEventId);
    if (ev) return ev;
  }
  const ev = { id: newId('gev'), name: 'General', description: '', icon: null, color: null, status: 'active', createdAt: nowIso, createdBy: member.subject, history: [{ at: nowIso, by: member.subject, event: 'create' }] };
  doc.groupEvents = [...(doc.groupEvents || []), ev];
  doc.defaultEventId = ev.id;
  return ev;
}
function eventView(doc, ev) {
  const isDefault = doc.defaultEventId === ev.id;
  const expenseCount = (doc.groupExpenses || []).filter((e) => e.eventId === ev.id).length;
  const settlementCount = (doc.groupSettlements || []).filter((s) => s.eventId === ev.id).length;
  return {
    id: ev.id, name: ev.name, description: ev.description || '', icon: ev.icon || null, color: ev.color || null,
    status: ev.status, isDefault, expenseCount, settlementCount,
    createdBy: nameOf(doc, ev.createdBy), createdAt: ev.createdAt,
  };
}
const EVENT_CREATE_KEYS = ['name', 'description', 'icon', 'color', 'templateEventId'];
async function listEvents(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  return { body: { events: (doc.groupEvents || []).map((e) => eventView(doc, e)) } };
}
async function createEvent(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), EVENT_CREATE_KEYS);
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
    requireWriter(member);
    const nowIso = ctx.nowIso();
    // BT-009-22: an event template copies only its reusable SETUP (description, icon, colour) —
    // never its participants, expenses, settlements or any financial record, and never
    // silently recreates an invitation or access grant. The new event's own id, status and
    // history all start completely fresh, exactly like any other new event.
    const template = body.templateEventId !== undefined && body.templateEventId !== null ? findEvent(doc, requireId(body.templateEventId, 'templateEventId')) : null;
    const ev = {
      id: newId('gev'), name: fields.text(body.name, { field: 'Name', max: 80, required: true }),
      description: body.description !== undefined ? fields.text(body.description, { field: 'Description', max: 500, multiline: true }) : (template ? template.description : ''),
      icon: body.icon !== undefined ? (body.icon === null ? null : fields.text(body.icon, { field: 'Icon', max: 40 })) : (template ? template.icon : null),
      color: body.color !== undefined ? (body.color === null ? null : fields.text(body.color, { field: 'Colour', max: 20 })) : (template ? template.color : null),
      status: 'active', createdAt: nowIso, createdBy: member.subject,
      history: [{ at: nowIso, by: member.subject, event: 'create', ...(template ? { fromTemplate: template.id } : {}) }],
    };
    doc.groupEvents = [...(doc.groupEvents || []), ev];
    if (!doc.defaultEventId) doc.defaultEventId = ev.id;
    audit.record(doc, { actor: member.subject, action: 'group.event.create', targetType: 'group-event', targetId: ev.id, at: nowIso });
    return { event: eventView(doc, ev) };
  });
  return { status: 201, body: result };
}
// Active <-> closed <-> archived, and archived back to active directly (a restore). Never the
// no-op of "changing" to the same status, so history only ever records a real transition.
const EVENT_TRANSITIONS = { active: ['closed', 'archived'], closed: ['active', 'archived'], archived: ['active'] };
async function eventStatusAction(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['eventId', 'status', 'reason']);
  const id = requireId(body.eventId, 'eventId');
  const status = fields.oneOf(body.status, EVENT_STATUSES, 'Status');
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
    // Closing, archiving or reopening an event is a structural, workspace-wide change — a higher
    // bar than adding one's own expense (Terry, 2026-09-19: "requires the appropriate permission
    // and an audited action"), so a manager or owner only; disclosed as a reasonable default, not
    // a literal instruction.
    if (!isManager(member)) throw forbidden('Only a manager or owner can close, archive or reopen an event.');
    const ev = findEvent(doc, id);
    if (ev.status === status) throw conflict(`This event is already ${status}.`, 'no_change');
    if (!(EVENT_TRANSITIONS[ev.status] || []).includes(status)) throw conflict(`An event cannot go directly from ${ev.status} to ${status}.`, 'invalid_transition');
    const nowIso = ctx.nowIso();
    const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
    ev.status = status;
    ev.history = [...(ev.history || []), { at: nowIso, by: member.subject, event: status, ...(reason ? { reason } : {}) }];
    audit.record(doc, { actor: member.subject, action: `group.event.${status}`, targetType: 'group-event', targetId: ev.id, at: nowIso, ...(reason ? { fields: ['status'] } : {}) });
    return { event: eventView(doc, ev) };
  });
  return { body: result };
}

// ---- saved split presets (BT-009-25) --------------------------------------------------------
// A preset remembers WHO is typically in a recurring split and in what PROPORTION (Terry,
// 2026-09-19: "saved split presets"), never a money amount — 'amounts' and 'fixed-remainder'
// name specific amounts that only make sense for one particular expense, so they are not
// preset-able; 'equal', 'shares' and 'percentages' are proportions that genuinely repeat across
// different expense sizes ("the housemates always split 50/50", "Alice always covers 60% of the
// car"). Applying a preset only pre-fills the Add expense dialog's own form fields (never writes
// anything by itself); a person no longer in the workspace by the time it is used is simply left
// out when applied, client-side — nothing here is a financial record, so nothing needs a
// migration or a schema version bump.
const PRESET_METHODS = groups.PRESET_METHODS;
const PRESET_KEYS = ['name', 'method', 'lines'];
// Lines keep only their ref, like every other split view (payers/shares) — the client already
// resolves a ref to a display name from `data.participants`, the one place that mapping lives.
function presetView(doc, member, p) {
  return { id: p.id, name: p.name, method: p.method, lines: p.lines.map((l) => ({ ref: l.ref, value: l.value })), createdBy: nameOf(doc, p.createdBy), createdBySelf: p.createdBy === member.subject, createdAt: p.createdAt };
}
async function listSplitPresets(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  return { body: { presets: (doc.groupSplitPresets || []).map((p) => presetView(doc, member, p)) } };
}
async function createSplitPreset(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), PRESET_KEYS);
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
    requireWriter(member);
    const check = groups.participantChecker(doc);
    // A preset needs no total amount, so it is validated the same way a real split's lines are
    // (method, refs, shape) against a placeholder total — 100 minor units divides evenly enough
    // for 'equal'/'shares' to always normalize; 'percentages' is checked on its own units anyway
    // and never touches the placeholder total at all.
    const split = groups.normalizeSplit({ method: fields.oneOf(body.method, PRESET_METHODS, 'Split method'), lines: body.lines }, 100, reportingCurrency(doc), check);
    const nowIso = ctx.nowIso();
    const preset = { id: newId('gsp'), name: fields.text(body.name, { field: 'Name', max: 80, required: true }), method: split.method, lines: split.lines, createdBy: member.subject, createdAt: nowIso };
    doc.groupSplitPresets = [...(doc.groupSplitPresets || []), preset];
    audit.record(doc, { actor: member.subject, action: 'group.split-preset.create', targetType: 'group-split-preset', targetId: preset.id, at: nowIso });
    return { preset: presetView(doc, member, preset) };
  });
  return { status: 201, body: result };
}
async function deleteSplitPreset(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['presetId']);
  const id = requireId(body.presetId, 'presetId');
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
    const p = (doc.groupSplitPresets || []).find((x) => x.id === id);
    if (!p) throw notFound('Unknown split preset.');
    // Its own creator, or a manager/owner — the same bar as changing someone else's expense.
    if (p.createdBy !== member.subject && !isManager(member)) throw forbidden('Only the person who saved this split, or a manager or owner, can remove it.');
    doc.groupSplitPresets = doc.groupSplitPresets.filter((x) => x.id !== id);
    audit.record(doc, { actor: member.subject, action: 'group.split-preset.delete', targetType: 'group-split-preset', targetId: id, at: ctx.nowIso() });
    return { removed: true };
  });
  return { body: result };
}

// Who may correct or void a shared expense: the group setting "changeExpenses" (Terry, 2026-09-14).
// Viewers never may.
const canChangeExpense = (doc, e, member) => writer(member)
  && (e.createdBy === member.subject || isManager(member) || groupSettings.get(doc, 'changeExpenses') === 'any-writer');
const expenseRuleText = (doc) => (groupSettings.get(doc, 'changeExpenses') === 'any-writer'
  ? 'Viewers can see shared expenses but cannot change them.' : 'Only the person who added this expense, or a manager or owner, can change it.');

// Who may withdraw a confirmed payment (setting "withdrawPayments"): the receiver or a manager or owner
// (default), the receiver only, or anyone who can confirm payments. For a contact, who cannot sign in, a
// manager or owner acts as the receiver. Viewers never withdraw.
function canWithdraw(doc, s, member) {
  if (!writer(member)) return false;
  const me = selfRef(member);
  const forContact = s.to.startsWith('contact:') && isManager(member);
  const rule = groupSettings.get(doc, 'withdrawPayments');
  if (rule === 'receiver') return s.to === me || forContact;
  if (rule === 'confirmers') return s.to === me || forContact || groupSettings.confirmsAny(doc, member);
  return s.to === me || isManager(member);
}
const withdrawRuleText = (doc) => ({
  receiver: 'Only the person who received this payment can withdraw its confirmation.',
  confirmers: 'Only the person who received this payment, or someone who can confirm payments, can withdraw its confirmation.',
}[groupSettings.get(doc, 'withdrawPayments')] || 'Only the person who received this payment, or a manager or owner, can withdraw its confirmation.');

// Who may dispute a reported payment (setting "disputePayments"): its receiver, or also a manager or
// owner. The receiver always may, a viewer included (security review S7).
const canDisputePayment = (doc, s, member) => s.to === selfRef(member)
  || (groupSettings.get(doc, 'disputePayments') === 'receiver-or-manager' && isManager(member));

// A new expense's payer and split when the request leaves them out: the group's defaults (setting (b)).
// The caller's own defaults win over the group's when set (personal preferences groupPaidBy,
// groupSplitMethod, groupSplitWho), so the API and the browser start a new expense the same way
// (financial recheck of 53cf181, personal-defaults note).
function defaultPayers(doc, member, mine = {}) {
  const paidBy = mine.paidBy || groupSettings.get(doc, 'paidBy');
  if (paidBy === 'nobody' || !member) throw badRequest('Say who paid for this expense.', 'invalid_payers');
  return [{ ref: selfRef(member) }];
}
function defaultSplit(doc, member, mine = {}) {
  const method = mine.method || groupSettings.get(doc, 'splitMethod');
  if (method !== 'equal' || !member) throw badRequest('Choose how to split this expense: the default split needs a value for each person.', 'invalid_split');
  const refs = (mine.who || groupSettings.get(doc, 'splitWho')) === 'me' ? [selfRef(member)] : groups.participants(doc, null).filter((p) => p.active).map((p) => p.ref);
  return { method: 'equal', lines: refs.map((ref) => ({ ref })) };
}
// The caller's own defaults for a new expense, from their preferences; none set means the group's.
async function ownDefaults(ctx) {
  const { value } = await ctx.storage.getJson(store.paths.user(ctx.principal.subject));
  const prefs = ((readDocument('user', value) || {}).preferences) || {};
  return { method: prefs.groupSplitMethod || null, who: prefs.groupSplitWho || null, paidBy: prefs.groupPaidBy || null };
}

// The amount, payers, split and resulting shares, from the request and (for a correction) the record.
// A new expense without payers or a split takes the group's defaults for `member`.
function expenseMoney(doc, body, rec, member = null, mine = {}) {
  // BT-009-13: currency/rate are only ever considered together with `amount` — resubmitting a rate
  // alone changes nothing (the literal requirement: "changing rates later never changes a recorded
  // expense"). Resubmitting the amount on an existing foreign-currency expense re-uses its own
  // original currency and last rate unless a new one is explicitly given; its currency itself can
  // never change once recorded (correct it by voiding and adding a new expense instead).
  let currency, amountMinor, original;
  if (!rec) {
    ({ currency, amountMinor, original } = expenseAmount(doc, body));
  } else if (body.amount === undefined) {
    currency = rec.currency; amountMinor = rec.amountMinor; original = rec.original || null;
  } else {
    const impliedCurrency = rec.original ? rec.original.currency : rec.currency;
    if (body.currency !== undefined && body.currency !== null && body.currency !== impliedCurrency) {
      throw badRequest("A shared expense's own currency cannot be changed once recorded. Void it and add a new one instead.", 'currency_locked');
    }
    ({ currency, amountMinor, original } = expenseAmount(doc, {
      ...body, currency: impliedCurrency,
      rate: body.rate !== undefined ? body.rate : (rec.original ? rec.original.rate : undefined),
      rateSource: body.rateSource !== undefined ? body.rateSource : (rec.original ? rec.original.rateSource : undefined),
      rateDate: body.rateDate !== undefined ? body.rateDate : (rec.original ? rec.original.rateDate : undefined),
    }));
  }
  const check = groups.participantChecker(doc, rec ? new Set(groups.recordRefs({ groupExpenses: [rec] })) : new Set());
  let payers;
  if (!rec || body.payers !== undefined) payers = groups.normalizePayers(body.payers === undefined ? defaultPayers(doc, member, mine) : body.payers, amountMinor, currency, check);
  else {
    payers = structuredClone(rec.payers);
    if (money.sum(payers.map((p) => p.amountMinor)) !== amountMinor) throw badRequest('The amount changed, so say again who paid how much.', 'payer_total');
  }
  let split;
  if (!rec || body.split !== undefined) split = groups.normalizeSplit(body.split === undefined ? defaultSplit(doc, member, mine) : body.split, amountMinor, currency, check);
  else {
    split = structuredClone(rec.split);
    if (split.method === 'amounts' && money.sum(split.lines.map((l) => l.value)) !== amountMinor) throw badRequest('The amount changed, so give the split amounts again.', 'split_amount_total');
    if (split.method === 'fixed-remainder') {
      const fixedTotal = money.sum(split.lines.filter((l) => l.value !== null).map((l) => l.value));
      const hasRemainder = split.lines.some((l) => l.value === null);
      if (fixedTotal > amountMinor || (!hasRemainder && fixedTotal !== amountMinor)) throw badRequest('The amount changed, so give the split amounts again.', 'split_amount_total');
    }
  }
  const shares = groups.computeShares(amountMinor, split).shares.map(({ ref, amountMinor: a }) => ({ ref, amountMinor: a }));
  return { currency, amountMinor, payers, split, shares, original };
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
// Why an account can no longer hold a person's part (financial recheck F2): removed, out of their
// reach, not their own private account (for example shared), or closed. null for their own usable
// private account.
function formerReason(ctx, doc, member, accountId) {
  const a = (doc.accounts || []).find((x) => x.id === accountId);
  if (!a || a.deletedAt) return 'deleted';
  if (capabilitiesFor(doc, ctx.principal, a, ctx.now()).size === 0) return 'unavailable';
  if (!ownPrivateAccount(doc, accountId, member.subject)) return 'shared';
  if (a.status === 'closed') return 'closed';
  return null;
}
// What stops the person writing their entries on an account now (reversing `toReverse`, or adding).
function writeProblem(ctx, doc, accountId, rec, toReverse) {
  const now = ctx.now();
  const account = (doc.accounts || []).find((a) => a.id === accountId);
  if (!account || account.deletedAt || capabilitiesFor(doc, ctx.principal, account, now).size === 0) return 'unavailable';
  if (account.status === 'closed') return 'closed';
  if (account.currency !== rec.currency) return 'currency';
  if (!can(doc, ctx.principal, account, 'create', now) || toReverse.some((t) => t.accountId === accountId && !canChangeRecord(doc, ctx.principal, account, t, 'edit', now))) return 'rights';
  return null;
}
// Entries that can never be reversed where they are: the account is gone or out of the person's reach.
const unreachable = (ctx, doc, rec, t) => ['unavailable', 'rights'].includes(writeProblem(ctx, doc, t.accountId, rec, [t]));

// Whether a person's entries (or the entries a record wants) for one record moved real cash (financial
// recheck of 53cf181, N-1): money lent, repaid to them or repaid by them, or a share not fully covered by
// an amount owed (they paid at least part of it). A share someone else paid, with its amount owed, moved
// no cash.
const CASH_KINDS = new Set(['advance', 'reimbursement', 'repayment']);
function movedCash(list) {
  if (list.some((t) => CASH_KINDS.has(t.kind))) return true;
  const sum = (kind) => list.filter((t) => t.kind === kind).reduce((a, t) => a + t.amountMinor, 0);
  return sum('expense') + sum('payable') !== 0;
}
// Where a person's part of one record belongs (N-1; decision 2026-09-14: an account's balance is always
// the cash that really moved through it). A part that moved cash stays on the account the money used,
// as long as the person may still write there (a closed account still counts: it asks to be reopened),
// and corrections land there too; otherwise it goes on the account they record on now. A part that moved
// no cash follows the account they record on now.
function placeFor(ctx, doc, rec, live, wanted, targetId) {
  const ids = [...new Set(live.map((t) => t.accountId))];
  const anchorId = live.length && ids.length === 1 && movedCash(live) && [null, 'closed'].includes(writeProblem(ctx, doc, ids[0], rec, live)) ? ids[0] : null;
  return movedCash(wanted) ? anchorId || targetId : targetId || anchorId;
}

function syncRecord(ctx, doc, member, rec, type, { reason, strict, stop = false }) {
  const nowIso = ctx.nowIso();
  // Nothing new is recorded on an account that is not the person's own private account (security
  // recheck R1). A link whose account stopped being theirs (for example shared) needs another account.
  const link = groupLink(doc, member.subject, rec.currency);
  if (link && !ownPrivateAccount(doc, link.accountId, member.subject)) {
    if (strict) throw conflict('The account your shared expenses are recorded on is no longer your own private account. Choose another private account of yours in Shared expenses.', 'account_not_own');
    return 'not_own';
  }
  const live = liveEntries(doc, rec, type, member.subject);
  const wanted = groups.desiredEntries(rec, type, selfRef(member));
  // Where the part belongs (N-1): where the money moved, or the account they record on now. Stopping
  // reverses everything the sync made.
  const targetId = stop ? null : placeFor(ctx, doc, rec, live, wanted, targetOf(doc, rec, member.subject));
  // Financial recheck F2 (decision 2026-09-14): without an account to record on, entries left on a
  // former account are not touched — reversing them would record the person's part nowhere. Only
  // stopping reverses them.
  if (!targetId && !stop && live.some((t) => formerReason(ctx, doc, member, t.accountId))) {
    if (strict) throw conflict('Your part of this is on an account that is no longer your own private account. Choose a private account of yours in Shared expenses to record it there.', 'account_needed');
    return 'no_account';
  }
  const desired = targetId ? wanted : [];
  const onTarget = live.filter((t) => t.accountId === targetId);
  const elsewhere = live.filter((t) => t.accountId !== targetId);
  // F2: the person's own entries elsewhere are reversed where they are (they created them; this route
  // may do so even though the transactions route locks them) and their whole part is recorded on the
  // current account. Where the account is gone or out of reach they cannot be reversed: they are left
  // exactly as they are (never deleted) and shown as left on a former account.
  const movable = elsewhere.filter((t) => !unreachable(ctx, doc, rec, t));
  const matches = sameEntries(onTarget, desired);
  if (matches && !movable.length) return 'same';
  const toReverse = matches ? movable : [...onTarget, ...movable];
  const toAdd = matches ? [] : desired;
  const touched = [...new Set([...toReverse.map((t) => t.accountId), ...(toAdd.length ? [targetId] : [])])];
  for (const id of touched) {
    const account = (doc.accounts || []).find((a) => a.id === id);
    const problem = writeProblem(ctx, doc, id, rec, toReverse);
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
function syncCurrency(ctx, doc, member, currency, reason, { stop = false } = {}) {
  const out = { updated: 0, blocked: 0 };
  for (const [type, list] of [['expense', doc.groupExpenses || []], ['settlement', doc.groupSettlements || []]]) {
    for (const rec of list) {
      if (rec.currency !== currency) continue;
      const r = syncRecord(ctx, doc, member, rec, type, { reason: reasonFor(rec, type, reason), strict: false, stop });
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

// Confirmed cash entries (advance, reimbursement, repayment — never the non-cash expense-share or
// payable entries, which never move real money) that a FIRST link in this currency would create out of
// nowhere, because they have been waiting since before the person ever had an account linked: nothing
// of theirs is recorded for that record yet (financial recheck of 41494d1, FA-1). Backdating these
// silently would change the newly linked account's balance the instant the link is made, with no
// warning, so the caller must see and confirm the amount first — unlike an ordinary relink or refresh,
// where the entries already exist somewhere and are only being moved or brought up to date. `exceptId`
// leaves out the one record this same request is creating or confirming (an expense or settlement made
// with `ledger` in the same call): its own amount is already right there in the request, so it is the
// caller's own current action, not a surprise about earlier activity they were not shown.
function pendingBackdatedCash(doc, member, currency, exceptId = null) {
  const out = [];
  for (const [type, list] of [['expense', doc.groupExpenses || []], ['settlement', doc.groupSettlements || []]]) {
    for (const rec of list) {
      if (rec.currency !== currency || rec.voidedAt || rec.id === exceptId) continue;
      if (liveEntries(doc, rec, type, member.subject).length) continue;
      for (const d of groups.desiredEntries(rec, type, selfRef(member))) if (CASH_KINDS.has(d.kind)) out.push(d);
    }
  }
  return out;
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
// `exceptId` is the record this same request is creating or confirming (see pendingBackdatedCash).
function linkCurrency(ctx, doc, member, currency, accountId, { confirmBackdated = false, exceptId = null } = {}) {
  const nowIso = ctx.nowIso();
  const account = checkOwnAccount(ctx, doc, member, accountId, currency);
  const current = groupLink(doc, member.subject, currency);
  // A FIRST link in this currency (FA-1): warn before silently backdating confirmed cash entries.
  if (!current) {
    const pending = pendingBackdatedCash(doc, member, currency, exceptId);
    if (pending.length && confirmBackdated !== true) {
      const total = money.sum(pending.map((d) => d.amountMinor));
      const noun = pending.length === 1 ? 'entry' : 'entries';
      throw conflict(
        `Linking this account will add ${pending.length} cash ${noun} totaling ${money.toDecimal(total, currency)}, because you have confirmed activity in this group with no account linked yet.`,
        'confirm_backdated',
        { count: pending.length, amount: money.toDecimal(total, currency), amountMinor: total, currency },
      );
    }
  }
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
  return syncCurrency(ctx, doc, member, currency, 'No longer recorded from Shared expenses', { stop: true });
}

// After the caller adds, changes or voids a record, their own entries follow in the same write when they can.
function followOwnLink(ctx, doc, member, rec, type, reason) {
  syncRecord(ctx, doc, member, rec, type, { reason, strict: false });
}

// What the caller has recorded for one record, shown only to them.
function myLedger(ctx, doc, member, rec, type, entriesFor = entryIndex(doc, member.subject)) {
  // A link to an account that is no longer the person's usable private account (removed, out of reach or
  // shared) is no account to record on (financial recheck F2); a closed own account still is, and asks
  // to be reopened.
  const linked = targetOf(doc, rec, member.subject);
  const current = linked && ['deleted', 'unavailable', 'shared'].includes(formerReason(ctx, doc, member, linked)) ? null : linked;
  const live = entriesFor(rec, type);
  const wanted = groups.desiredEntries(rec, type, selfRef(member));
  // The same place as the sync uses (N-1): where the money moved, or the account they record on now.
  const targetId = placeFor(ctx, doc, rec, live, wanted, current);
  const desired = targetId ? wanted : [];
  if (!live.length && !desired.length) return null;
  const now = ctx.now();
  const sees = (id) => { const a = (doc.accounts || []).find((x) => x.id === id); return a && !a.deletedAt && capabilitiesFor(doc, ctx.principal, a, now).size > 0 ? a : null; };
  const account = targetId ? sees(targetId) : null;
  // A part kept where the money moved, on an account that is not (or no longer) the person's own.
  const keptReason = targetId && targetId !== current ? formerReason(ctx, doc, member, targetId) : null;
  const onTarget = live.filter((t) => t.accountId === targetId);
  const elsewhere = live.filter((t) => t.accountId !== targetId);
  // Financial recheck F2: entries on an account that is no longer the person's usable private account
  // need review, with the reason; once their part is on a current account, entries that cannot be
  // reversed where they are (the account is gone or out of reach) are shown as left on a former account.
  // An account the person still sees but can no longer change is "read-only" (financial recheck N-2).
  const former = elsewhere.map((t) => { const r = formerReason(ctx, doc, member, t.accountId); return { t, reason: r === 'shared' && unreachable(ctx, doc, rec, t) ? 'read-only' : r }; }).filter((x) => x.reason);
  const movable = elsewhere.filter((t) => !unreachable(ctx, doc, rec, t));
  const needsReview = targetId ? movable.length > 0 || !sameEntries(onTarget, desired) : former.length > 0;
  const first = former[0] || null;
  const firstAccount = first ? sees(first.t.accountId) : null;
  const left = !!first && !!targetId && !movable.includes(first.t);
  return {
    accountId: account ? account.id : null, accountName: account ? account.name : null, accountUnavailable: !!targetId && !account,
    needsReview,
    ...(first ? { formerAccount: { reason: first.reason, name: firstAccount ? firstAccount.name : null, left }, note: formerNote(first.reason, firstAccount ? firstAccount.name : null, { left, hasAccount: !!targetId }) }
      : keptReason && account ? { keptAccount: { reason: keptReason, name: account.name }, note: `Your part stays on ${account.name}, where the money moved.` } : {}),
    entries: live.filter((t) => sees(t.accountId)).map((t) => ({ id: t.id, kind: t.kind, amount: money.toDecimal(t.amountMinor, t.currency) })),
  };
}

// The plain explanation that goes with a former account (F2).
function formerNote(reason, name, { left, hasAccount }) {
  const where = reason === 'deleted' ? 'an account that no longer exists' : reason === 'unavailable' ? 'an account you can no longer see'
    : reason === 'closed' ? `${name || 'an account'}, which is closed` : reason === 'read-only' ? `${name || 'an account'}, which you can no longer change`
      : `${name || 'an account'}, which is now shared`;
  if (left) return `Your part was recorded on ${where}. Those entries are left on a former account as they were, and your whole part is recorded on your current account.`;
  if (reason === 'closed') return `Your part was recorded on ${where}. Reopen it on the Accounts page so it can be updated.`;
  // Until an account is chosen, a part the totals leave out (removed, out of reach, or read-only) is said
  // to be missing from them (financial recheck of 53cf181, note on incomplete figures).
  const leftOut = !hasAccount && ['deleted', 'unavailable', 'read-only'].includes(reason) ? ' Until you do, your totals leave this part out.' : '';
  return `Your part was recorded on ${where}. ${hasAccount ? 'Update your account to record it on your own account instead.' : 'Choose a private account of yours to record it there.'}${leftOut}`;
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
  // BT-009-20: a closed or archived event's own expenses can never be corrected or voided from
  // here (reopening the event is a separate, audited, manager/owner action) — never offering a
  // control the server would refuse anyway.
  const eventLocked = (() => { const ev = eventOf(doc, e); return !!ev && ev.status !== 'active'; })();
  const changeable = canChangeExpense(doc, e, member) && !e.voidedAt && !eventLocked;
  // BT-009-13: the original entered amount/currency/rate, preserved exactly as recorded — refreshing
  // rates elsewhere never touches this. `amount`/`amountMinor`/`currency` above stay the CONVERTED
  // reporting-currency figures every share/balance/settlement calculation already uses; this is
  // purely additional, descriptive information about where they came from.
  const original = e.original ? { amount: money.toDecimal(e.original.amountMinor, e.original.currency), amountMinor: e.original.amountMinor, currency: e.original.currency, rate: e.original.rate, rateSource: e.original.rateSource, rateDate: e.original.rateDate } : null;
  const out = {
    id: e.id, description: e.description, date: e.date, currency: e.currency, amount: dec(e.amountMinor), amountMinor: e.amountMinor, original,
    eventId: e.eventId || null,
    categoryId: e.categoryId || null, notes: e.notes || '',
    payers: e.payers.map((p) => ({ ref: p.ref, amount: dec(p.amountMinor), amountMinor: p.amountMinor })),
    // 'fixed-remainder' lines are either a fixed minor amount (shown as decimal, like 'amounts')
    // or null (shares the remainder) — never converted, since money.toDecimal has no null case.
    split: { method: e.split.method, lines: e.split.lines.map((l) => ({ ref: l.ref, value: (e.split.method === 'amounts' || (e.split.method === 'fixed-remainder' && l.value !== null)) ? dec(l.value) : l.value })) },
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

// Who may confirm a DISPUTED payment (group setting "settleDisputes", financial recheck F1): its receiver
// (a manager or owner for a contact, who cannot sign in) by default; or also any manager or owner; or
// anyone who can confirm payments. "Anyone in the group can confirm payments" alone never settles a
// dispute. A viewer settles only a dispute over a payment made to them.
function canSettleDispute(doc, s, member) {
  const me = selfRef(member);
  if (s.to === me) return true;
  const rule = groupSettings.get(doc, 'settleDisputes');
  // The person who paid never settles a dispute over their own payment, a manager or owner included,
  // unless the group lets anyone who can confirm payments settle disputes (security recheck R3-1).
  if (s.from === me && rule !== 'confirmers') return false;
  const forContact = s.to.startsWith('contact:') && isManager(member);
  if (rule === 'receiver-or-manager') return isManager(member);
  if (rule === 'confirmers') return forContact || groupSettings.confirmsAny(doc, member);
  return forContact;
}
// The earlier payment between the same two people, in the same currency, that is still disputed when a
// new one is reported (security recheck R3-2): the new report settles that dispute, so confirming it
// follows "Who can settle a disputed payment". Once the earlier one is resolved, nothing is open.
const openDisputeFor = (doc, s) => (s.reportedAgainOf
  ? (doc.groupSettlements || []).find((x) => x.id === s.reportedAgainOf && x.status === 'disputed' && !x.voidedAt) || null : null);
const settlesDispute = (doc, s) => !s.voidedAt && (s.status === 'disputed' || (s.status === 'reported' && !!openDisputeFor(doc, s)));
const settleDisputeText = (doc) => ({
  'receiver-or-manager': 'This payment is disputed, so only the person who received it, or a manager or owner, can confirm it.',
  confirmers: 'This payment is disputed, so only someone who can confirm payments can confirm it.',
}[groupSettings.get(doc, 'settleDisputes')] || 'This payment is disputed, so only the person who received it can confirm it (a manager or owner for a contact).');

function settlementView(ctx, doc, member, s) {
  const me = selfRef(member);
  const toContact = s.to.startsWith('contact:');
  const live = !s.voidedAt;
  // BT-009-20: only an ARCHIVED event blocks confirming/disputing/voiding a payment (closed still
  // allows "settlement/dispute resolution", Terry, 2026-09-19) — never offering a control the
  // server would refuse anyway.
  const archivedLocked = (() => { const ev = eventOf(doc, s); return !!ev && ev.status === 'archived'; })();
  const open = live && writer(member) && !archivedLocked;
  const out = {
    id: s.id, from: s.from, to: s.to, amount: money.toDecimal(s.amountMinor, s.currency), amountMinor: s.amountMinor, currency: s.currency,
    eventId: s.eventId || null,
    date: s.date, method: s.method || '', notes: s.notes || '', status: s.status, voided: !!s.voidedAt,
    voidedAt: s.voidedAt || null, voidReason: s.voidReason || '', voidedBy: s.voidedBy ? nameOf(doc, s.voidedBy) : null,
    disputeReason: s.disputeReason || '', confirmedBy: s.confirmedBy ? nameOf(doc, s.confirmedBy) : null, confirmedAt: s.confirmedAt || null,
    // Confirmed by the manager or owner who reported it (S5); a confirmation withdrawn by a void (S6).
    confirmedByReporter: !!s.confirmedByReporter, withdrawn: !!s.withdrawn,
    // Confirmed over its receiver's dispute (F1): always shown as such.
    confirmedOverDispute: !!s.confirmedOverDispute,
    // Reported again while an earlier payment between them was disputed (R3-2): the earlier one's id.
    reportedAgainOf: s.reportedAgainOf || null,
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
    // A disputed payment follows "Who can settle a disputed payment" (F1).
    canConfirm: live && !archivedLocked && s.status !== 'confirmed' && (settlesDispute(doc, s) ? canSettleDispute(doc, s, member)
      : s.to === me || (groupSettings.confirmsAny(doc, member) ? writer(member) : s.from !== me && toContact && open && isManager(member))),
    canDispute: live && !archivedLocked && s.status === 'reported' && canDisputePayment(doc, s, member),
    canVoid: open && (s.status === 'confirmed' ? canWithdraw(doc, s, member) : (s.createdBy === member.subject || isManager(member))),
  };
  const mine = myLedger(ctx, doc, member, s, 'settlement');
  if (mine) out.myLedger = mine;
  return out;
}

function balancesView(doc, parts) {
  const names = new Map(parts.map((p) => [p.ref, p.name]));
  return groups.balances(doc, parts.map((p) => p.ref), { ensureCurrency: reportingCurrency(doc), countReported: groupSettings.get(doc, 'countReported') }).map((b) => {
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

// BT-014, Terry 2026-09-17: "offer the deleting workspace a download of its authorized
// shared-expense information ... before either deletion or disconnection ... Downloading is
// optional and must not execute or confirm deletion." Any active member may download exactly the
// data their own Shared expenses page already shows them (same authority as ?action=balances
// above) — this route never deletes or disconnects anything by itself; it is read-only. The raw
// text or base64-encoded binary is returned inside the normal JSON envelope (`content` plus
// `encoding`), not as a binary response body, because this codebase's one shared HTTP responder
// (api/_shared/http.js `respond`) always JSON-encodes `body` for every route; the client builds
// the downloadable file from `content` (decoding base64 first for XLSX/PDF) with a Blob, so no
// change was needed to that shared response path. CSV, JSON, XLSX and PDF (BT-014-06) — see
// api/_shared/sharedexport.js.
async function exportReport(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const format = query(req, 'format') || 'json';
  const { doc } = await store.loadWorkspace(ctx, wsId);
  // BT-009-23: an optional ?eventId= scopes the export to one event's own expenses, settlements
  // and balances — the same authorized report `sharedExport` has always built, just filtered to
  // one event first (never a second export format or a second code path).
  const eventIdParam = query(req, 'eventId');
  const scopedEvent = eventIdParam !== undefined ? findEvent(doc, requireId(eventIdParam, 'eventId')) : null;
  const scopedDoc = scopedEvent
    ? { ...doc, groupExpenses: (doc.groupExpenses || []).filter((e) => e.eventId === scopedEvent.id), groupSettlements: (doc.groupSettlements || []).filter((s) => s.eventId === scopedEvent.id) }
    : doc;
  const out = await sharedExport.render(scopedDoc, ctx.principal, format, ctx.nowIso());
  if (!out) throw badRequest(`Unsupported export format. Choose one of: ${sharedExport.FORMATS.join(', ')}.`, 'invalid_format');
  const filename = scopedEvent ? out.filename.replace(/^shared-expenses-/, `shared-expenses-${scopedEvent.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-`) : out.filename;
  return { body: { format, filename, mime: out.mime, content: out.body, encoding: out.encoding } };
}

async function list(ctx, req) {
  const action = query(req, 'action');
  if (action === 'history') return recordHistory(ctx, req);
  if (action === 'export') return exportReport(ctx, req);
  if (action === 'events') return listEvents(ctx, req);
  if (action === 'split-presets') return listSplitPresets(ctx, req);
  if (action !== undefined && action !== 'balances') throw notFound();
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  // BT-009-21: an optional ?eventId= scopes expenses/settlements/balances to ONE event — the event
  // directory's own "view this event" action. Omitted entirely, the response is exactly what it
  // has always been: every event combined (never a breaking change to the existing page).
  // Participants, permissions and settings are workspace-wide either way — events are an
  // ORGANIZATIONAL grouping, not a separate access boundary (Terry, 2026-09-19); the client is
  // told this in words (`eventAccessNote`), never left to assume otherwise.
  const eventIdParam = query(req, 'eventId');
  const scopedEvent = eventIdParam !== undefined ? findEvent(doc, requireId(eventIdParam, 'eventId')) : null;
  const scopedDoc = scopedEvent
    ? { ...doc, groupExpenses: (doc.groupExpenses || []).filter((e) => e.eventId === scopedEvent.id), groupSettlements: (doc.groupSettlements || []).filter((s) => s.eventId === scopedEvent.id) }
    : doc;
  const parts = groups.participants(doc, ctx.principal);
  const balances = balancesView(scopedDoc, parts);
  if (action === 'balances') return { body: { currency: reportingCurrency(doc), balances } };
  return {
    body: {
      currency: reportingCurrency(doc), kind: doc.kind,
      // The group's settings from the one list, with who changed what (Terry, 2026-09-14).
      groupSettings: groupSettings.view(doc, (s) => nameOf(doc, s), member, isManager(member)),
      permissions: { role: member.role, canAdd: writer(member), canManage: isManager(member), selfRef: selfRef(member) },
      participants: parts,
      expenses: [...(scopedDoc.groupExpenses || [])].sort(newestFirst).map((e) => expenseView(ctx, doc, member, e)),
      settlements: [...(scopedDoc.groupSettlements || [])].sort(newestFirst).map((s) => settlementView(ctx, doc, member, s)),
      // The caller's own accounts for their part of the group, per currency; shown only to them, and
      // left out when there are none (like `myLedger` on a record).
      ...(() => { const mine = myLedgers(ctx, doc, member, entryIndex(doc, member.subject)); return mine.length ? { myLedgers: mine } : {}; })(),
      balances,
      basis: groupSettings.get(doc, 'countReported')
        ? 'Balances count confirmed payments only. Suggested and direct payments also count reported payments as made, so nobody is asked to pay twice; suggestions count a reported payment only up to what is owed. Disputed payments are not counted.'
        : 'Balances count confirmed payments only. Reported payments are not counted until they are confirmed, in the suggested and direct payments too. Disputed payments are not counted.',
      // BT-009-20/21: the event directory and the current default; when scoped to one event,
      // exactly which one, plus the honest access-scope disclosure (BT-009-21 — events are
      // organizational, never a separate visibility boundary unless enforced on every backend
      // path, and it is not: every workspace member with access to Shared expenses already sees
      // every event's records combined by default, exactly as this same route always returned).
      events: (doc.groupEvents || []).map((e) => eventView(doc, e)), defaultEventId: doc.defaultEventId || null,
      ...(scopedEvent ? { currentEvent: eventView(doc, scopedEvent) } : {}),
      eventAccessNote: 'Events organize expenses and payments; they do not change who can see them. Everyone who can see Shared expenses in this workspace can see every event in it.',
      // BT-009-25: saved split presets, embedded with the rest so the Add expense dialog needs no
      // second round trip to offer them.
      splitPresets: (doc.groupSplitPresets || []).map((p) => presetView(doc, member, p)),
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
  // Read before the write, and only when the request leaves the payer or the split out.
  const mine = body.payers === undefined || body.split === undefined ? await ownDefaults(ctx) : {};
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
    requireWriter(member);
    const nowIso = ctx.nowIso();
    // BT-009-20: resolved (and, for a workspace's very first expense, lazily created) BEFORE
    // `expenseMoney` reads anything else, so "no such event" or "that event is closed/archived"
    // both fail this write cleanly, before any other field is even validated.
    const groupEvent = resolveEvent(doc, member, nowIso, body);
    assertEventWritable(groupEvent);
    const m = expenseMoney(doc, body, null, member, mine);
    const rec = {
      id: newId('gex'), description: fields.text(body.description, { field: 'Description', max: 120, required: true }),
      date: fields.date(body.date, 'Date') || nowIso.slice(0, 10), currency: m.currency, amountMinor: m.amountMinor, original: m.original,
      categoryId: checkCategory(doc, body.categoryId), notes: fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }),
      payers: m.payers, split: m.split, shares: m.shares, eventId: groupEvent.id,
      createdBy: member.subject, createdAt: nowIso, revision: 1, voidedAt: null,
      history: [{ revision: 1, at: nowIso, by: member.subject, event: 'create' }], amendments: [], ledgerLinks: [],
    };
    doc.groupExpenses = [...(doc.groupExpenses || []), rec];
    audit.record(doc, { actor: member.subject, action: 'group.expense.create', targetType: 'group-expense', targetId: rec.id, at: nowIso });
    // Recorded on the caller's own account through a new or changed link for this currency, or through
    // the link they already have (their own write, so their entries follow at once).
    if (ledgerAccountId) linkCurrency(ctx, doc, member, rec.currency, ledgerAccountId, { confirmBackdated: body.confirmBackdated === true, exceptId: rec.id });
    else followOwnLink(ctx, doc, member, rec, 'expense', 'Shared expense');
    return { expense: expenseView(ctx, doc, member, rec) };
  }, { idempotencyKey: header(req, 'idempotency-key') || undefined, idempotencyScope: 'group.expense.create', requestHash: store.requestHash({ q: wsId, body }) });
  return { status: 201, body: result };
}

async function patchExpense(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), PATCH_KEYS);
  const id = requireId(body.expenseId, 'expenseId');
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
    const e = findExpense(doc, id);
    if (!canChangeExpense(doc, e, member)) throw forbidden(expenseRuleText(doc));
    if (e.voidedAt) throw conflict('This expense is void, so it cannot be changed. Add a new expense instead.', 'voided');
    // BT-009-20: "Expense corrections on closed events require reopening" (Terry, 2026-09-19) —
    // closed is not enough for a correction, unlike a new settlement against it.
    assertEventWritable(eventOf(doc, e));
    checkRevision(e, body.revision);
    // BT-009-24: moving an expense to a different event is a safe, explicit, explained move —
    // never silent, never into/out of a non-active event (that is exactly what "closed"/
    // "archived" mean: this event's own membership is frozen either way). Voiding an expense
    // never counts as a move (its event never changes), so there is nothing to un-teach here.
    let toEvent = null;
    if (body.eventId !== undefined && body.eventId !== e.eventId) {
      toEvent = findEvent(doc, requireId(body.eventId, 'eventId'));
      if (toEvent.status !== 'active') throw conflict(`"${toEvent.name}" is ${toEvent.status} and cannot receive a moved expense. Reopen it first.`, `event_${toEvent.status}`);
    }
    const reason = requireReason(body.reason, 'this correction');
    const nowIso = ctx.nowIso();
    const before = Object.fromEntries(TRACKED.map((k) => [k, structuredClone(e[k] === undefined ? null : e[k])]));
    const m = expenseMoney(doc, body, e);
    const next = {
      description: body.description !== undefined ? fields.text(body.description, { field: 'Description', max: 120, required: true }) : e.description,
      date: body.date !== undefined ? fields.date(body.date, 'Date', { required: true }) : e.date,
      amountMinor: m.amountMinor, original: m.original,
      categoryId: body.categoryId !== undefined ? checkCategory(doc, body.categoryId, e.categoryId) : e.categoryId || null,
      notes: body.notes !== undefined ? fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }) : e.notes || '',
      payers: m.payers, split: m.split, shares: m.shares,
      eventId: toEvent ? toEvent.id : e.eventId,
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
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
    requireWriter(member);
    const nowIso = ctx.nowIso();
    // BT-009-20: "settlement/dispute resolution remains possible" on a CLOSED event (Terry,
    // 2026-09-19) — a new payment report is exactly that, so closed does not block it; archived
    // (fully read-only) still does.
    const groupEvent = resolveEvent(doc, member, nowIso, body);
    assertEventWritable(groupEvent, { allowWhenClosed: true });
    const currency = settlementCurrency(doc, body.currency);
    const check = groups.participantChecker(doc);
    const from = check(body.from);
    const to = check(body.to);
    if (from === to) throw badRequest('A payment needs two different people.', 'same_person');
    // Someone saying they RECEIVED a payment is the confirmation itself, unless the group turned that
    // off (setting "receiverConfirms", default on); then it is reported and confirmed as a separate step.
    const receiver = to === selfRef(member) && groupSettings.get(doc, 'receiverConfirms');
    // Reported again while an earlier payment between the same two people in this currency is disputed
    // (security recheck R3-2): still allowed — people do pay again — but marked, linked to the disputed
    // one, and confirming it settles that dispute. The receiver recording it confirms it over the dispute.
    const earlier = (doc.groupSettlements || []).find((x) => x.from === from && x.to === to && x.currency === currency && x.status === 'disputed' && !x.voidedAt) || null;
    const s = {
      id: newId('gst'), from, to, amountMinor: groups.positiveAmount(body.amount, currency, 'Amount'), currency, eventId: groupEvent.id,
      date: fields.date(body.date, 'Date') || nowIso.slice(0, 10),
      method: fields.text(body.method, { field: 'Payment method', max: 60 }), notes: fields.text(body.notes, { field: 'Notes', max: 500, multiline: true }),
      status: receiver ? 'confirmed' : 'reported', confirmedBy: receiver ? member.subject : null, confirmedAt: receiver ? nowIso : null,
      createdBy: member.subject, createdAt: nowIso, revision: 1, voidedAt: null,
      reportedAgainOf: earlier ? earlier.id : null,
      ...(receiver && earlier ? { confirmedOverDispute: true } : {}),
      history: [{ revision: 1, at: nowIso, by: member.subject, event: earlier ? 'reported-again' : 'reported', ...(earlier ? { of: earlier.id } : {}) },
        ...(receiver ? [{ revision: 1, at: nowIso, by: member.subject, event: earlier ? 'confirmed-over-dispute' : 'confirmed' }] : [])],
      ledgerLinks: [],
    };
    doc.groupSettlements = [...(doc.groupSettlements || []), s];
    audit.record(doc, { actor: member.subject, action: 'group.settlement.report', targetType: 'group-settlement', targetId: s.id, at: nowIso, ...(earlier ? { fields: ['reportedAgainAfterDispute'] } : {}) });
    if (receiver) audit.record(doc, { actor: member.subject, action: 'group.settlement.confirm', targetType: 'group-settlement', targetId: s.id, at: nowIso, ...(earlier ? { fields: ['overDispute'] } : {}) });
    // Recorded on the caller's own account through a new or changed link for this currency, or the one
    // they already have. Anyone in the payment has a part in it; entries follow once it is confirmed.
    if (ledgerAccountId) linkCurrency(ctx, doc, member, s.currency, ledgerAccountId, { confirmBackdated: body.confirmBackdated === true, exceptId: s.id });
    else followOwnLink(ctx, doc, member, s, 'settlement', 'Repayment');
    return { settlement: settlementView(ctx, doc, member, s) };
  }, { idempotencyKey: header(req, 'idempotency-key') || undefined, idempotencyScope: 'group.settle', requestHash: store.requestHash({ q: wsId, body }) });
  return { status: 201, body: result };
}

function settlementChange(kind) {
  return async (ctx, req) => {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), kind === 'confirm' ? ['settlementId', 'revision', 'ledger', 'confirmBackdated'] : ['settlementId', 'revision', 'reason']);
    const id = requireId(body.settlementId, 'settlementId');
    const ledgerAccountId = kind === 'confirm' ? ledgerChoice(body.ledger) : null;
    const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
      const s = findSettlement(doc, id);
      const me = selfRef(member);
      // A viewer may confirm or dispute a payment made to them, and nothing else (security review S7).
      if (s.to !== me) requireWriter(member);
      // BT-009-20: confirming or disputing is exactly the "settlement/dispute resolution" a closed
      // event still allows; only archived blocks it.
      assertEventWritable(eventOf(doc, s), { allowWhenClosed: true });
      const nowIso = ctx.nowIso();
      if (kind === 'confirm') {
        // "Can confirm payments" (Terry, 2026-09-14): the owner's or manager's override for this person
        // if set, otherwise the group setting "Anyone in the group can confirm payments" (on by
        // default). When it applies, the person confirms any reported payment, their own included; a
        // viewer never gets more than one made to them. Otherwise: never the person who paid (security
        // review S5); the receiving member, or a manager or owner for a contact.
        const anyone = groupSettings.confirmsAny(doc, member);
        // Over a dispute, only as "Who can settle a disputed payment" allows (financial recheck F1): being
        // able to confirm payments moves a reported payment to confirmed, never a disputed one on its own.
        // A report made again while an earlier one between them is disputed settles that dispute (R3-2).
        const overDispute = settlesDispute(doc, s);
        if (overDispute) {
          if (!canSettleDispute(doc, s, member)) throw forbidden(settleDisputeText(doc));
        } else if (!anyone) {
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
        s.confirmedOverDispute = overDispute;
        s.revision += 1;
        s.history = [...(s.history || []), { revision: s.revision, at: nowIso, by: member.subject, event: overDispute ? 'confirmed-over-dispute' : byReporter ? 'confirmed-by-reporter' : 'confirmed' }];
        audit.record(doc, { actor: member.subject, action: 'group.settlement.confirm', targetType: 'group-settlement', targetId: s.id, at: nowIso, ...(overDispute ? { fields: ['overDispute'] } : {}) });
        // The settlement being confirmed right now is the caller's own current action, not a surprise
        // about other, unrelated pre-existing activity (FA-1): its own amount is exempted from the check.
        if (ledgerAccountId) linkCurrency(ctx, doc, member, s.currency, ledgerAccountId, { confirmBackdated: body.confirmBackdated === true, exceptId: s.id });
        else followOwnLink(ctx, doc, member, s, 'settlement', 'Repayment');
      } else {
        if (!canDisputePayment(doc, s, member)) {
          throw forbidden(groupSettings.get(doc, 'disputePayments') === 'receiver-or-manager' ? 'Only the person who received this payment, or a manager or owner, can dispute it.' : 'Only the person who received this payment can dispute it.');
        }
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
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
    const rec = type === 'expense' ? findExpense(doc, id) : findSettlement(doc, id);
    // Once a payment is confirmed, the payer or reporter alone can no longer take it back: only its
    // receiving member or a manager or owner may, and it is recorded as a withdrawn confirmation
    // (security review S6). Before that, whoever reported it (or a manager or owner) may void it.
    const confirmedPayment = type === 'settlement' && rec.status === 'confirmed';
    // An expense follows the group setting "changeExpenses"; a confirmed payment "withdrawPayments".
    const allowed = type === 'expense' ? canChangeExpense(doc, rec, member)
      : writer(member) && (confirmedPayment ? canWithdraw(doc, rec, member) : (rec.createdBy === member.subject || isManager(member)));
    if (!allowed) {
      throw forbidden(type === 'expense' ? expenseRuleText(doc).replace('change it', 'void it') : confirmedPayment ? withdrawRuleText(doc)
        : 'Only the person who added this payment, or a manager or owner, can void it.');
    }
    if (rec.voidedAt) throw conflict(`This ${type === 'expense' ? 'expense' : 'payment'} is already void.`, 'already_void');
    // BT-009-20: voiding an expense is correction-like (blocked once closed, per Terry's rule for
    // expense corrections); voiding a payment is dispute/settlement resolution, which a closed
    // event still allows — only archived (fully read-only) blocks it.
    assertEventWritable(eventOf(doc, rec), { allowWhenClosed: type === 'settlement' });
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
  const body = fields.onlyKeys(readBody(req), ['expenseId', 'settlementId', 'currency', 'accountId', 'confirmBackdated']);
  const named = ['expenseId', 'settlementId', 'currency'].filter((k) => body[k] !== undefined);
  if (named.length !== 1) throw badRequest('Send one of expenseId, settlementId or currency.', 'missing_field');
  const type = body.expenseId !== undefined ? 'expense' : body.settlementId !== undefined ? 'settlement' : null;
  const id = type ? requireId(type === 'expense' ? body.expenseId : body.settlementId, type === 'expense' ? 'expenseId' : 'settlementId') : null;
  if (!type && !money.isCurrency(body.currency)) throw badRequest('currency must be a currency code such as "EUR".', 'invalid_field');
  const choosing = Object.prototype.hasOwnProperty.call(body, 'accountId');
  const accountId = choosing && body.accountId !== null ? requireId(body.accountId, 'accountId') : null;
  const confirmBackdated = body.confirmBackdated === true;
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
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
      // Naming a specific record is choosing where that one goes right now (FA-1): its own amount is
      // exempt from the backdating check, like a create or confirm with `ledger` in the same request.
      outcome = linkCurrency(ctx, doc, member, currency, accountId, { confirmBackdated, exceptId: rec ? rec.id : null });
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
    if (field === 'split' && v && Array.isArray(v.lines)) return { method: v.method, lines: v.lines.map((l) => ({ ref: l.ref, value: (v.method === 'amounts' || v.method === 'fixed-remainder') ? dec(l.value) : l.value })) };
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
  const { result } = await mutateGroup(ctx, wsId, (doc, member) => {
    if (!isManager(member)) throw forbidden('Only owners and managers can change the group\'s settings.');
    const at = ctx.nowIso();
    const changed = groupSettings.apply(doc, changes, { by: member.subject, at, reason });
    if (changed.length) audit.record(doc, { actor: member.subject, action: 'group.settings.update', targetType: 'workspace', targetId: doc.id, at, fields: changed });
    return { groupSettings: groupSettings.view(doc, (s) => nameOf(doc, s), member, true) };
  });
  return { body: result };
}

const ACTIONS = Object.freeze({
  void: voidRecord, settle: createSettlement, confirm: settlementChange('confirm'), dispute: settlementChange('dispute'), ledger: ledgerAction, settings: settingsAction,
  'create-event': createEvent, 'event-status': eventStatusAction,
  'create-split-preset': createSplitPreset, 'delete-split-preset': deleteSplitPreset,
});

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
  gateSite.set(ctx, site);
}

// Every group write checks Shared expenses again on the document it is about to change, in the same
// ETag-guarded write, so a switch-off that lands between the gate's read and the write refuses the write
// (security review of eefd115, L-2). The site's switch is the one the gate read for this request.
const gateSite = new WeakMap();
function mutateGroup(ctx, wsId, fn, options) {
  return store.mutateWorkspace(ctx, wsId, (doc, member) => {
    workspaceSettings.assertSharedExpenses(doc, gateSite.get(ctx));
    return fn(doc, member);
  }, options);
}
const gated = (fn) => async (ctx, req) => { await sharedExpensesGate(ctx, req); return fn(ctx, req); };

module.exports = { GET: gated(list), POST: gated(post), PATCH: gated(patchExpense) };
