'use strict';
// /api/accounts?workspaceId=
//   GET                         accounts the caller may see (balances only with view-balances; `hasEntries`
//                               only with view-transactions); `removedCount` = removed accounts they may
//                               bring back; `includeDeleted=1` lists those too
//   POST   {...}                create; shared accounts need manager+, private any active member
//   PATCH  { accountId, revision, reason?, ... }   edit settings (private owner, or manager+ for shared)
//   POST   ?action=close  { accountId, revision, reason, closedOn? }   no new entries; history stays
//   POST   ?action=reopen { accountId, revision, reason? }
//   DELETE { accountId, reason } remove from lists (never erased; recoverable); history is kept
//   POST   ?action=restore { accountId, reason? }
// Nothing is physically deleted and every change keeps its before/after values, author, time and
// reason in the account's history (BT-001-05).
// Making a private account shared is a publication within the workspace and requires
// `confirmShare: true`. Currency and type are fixed after creation.
const { readBody, query, header, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { capabilitiesFor, roleAtLeast } = require('../_shared/authz');
const store = require('../_shared/store');
const ledger = require('../_shared/ledger');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const icons = require('../_shared/icons');
const deletion = require('../_shared/deletion');
const accountTypes = require('../_shared/account-types');

// The icon catalogue is read only when an icon is being chosen (BT-011-05).
const catalogFor = async (ctx, body) => (body.icon !== undefined ? (await icons.readCatalog(ctx.storage)).catalog : null);
const workspaceSettings = require('../_shared/workspace-settings');

// `status` is changed only by the close and reopen actions, which need a reason.
const EDITABLE = ['revision', 'reason', 'name', 'type', 'accountTypeId', 'currency', 'institution', 'maskedNumber', 'terms', 'notes', 'openingBalance', 'openingDate', 'visibility', 'confirmShare', 'icon'];
const TRACKED = ['name', 'type', 'accountTypeId', 'currency', 'institution', 'maskedNumber', 'terms', 'notes', 'openingBalanceMinor', 'openingDate', 'visibility', 'icon'];
const snap = (a) => Object.fromEntries(TRACKED.map((f) => [f, a[f] === undefined ? null : structuredClone(a[f])]));
const changesSince = (before, a) => TRACKED
  .filter((f) => JSON.stringify(before[f]) !== JSON.stringify(a[f] === undefined ? null : a[f]))
  .map((f) => ({ field: f, from: before[f], to: a[f] === undefined ? null : structuredClone(a[f]) }));

// A private account: its owner only. A shared account: whoever manages the workspace's shared lists —
// managers and owners, or members too when the workspace setting says so (Terry, 2026-09-14).
function mayManage(doc, account, member) {
  if (account.visibility === 'private') return account.ownerSubject === member.subject;
  return workspaceSettings.managesSharedLists(doc, member);
}

function locate(doc, principal, accountId, now) {
  const account = (doc.accounts || []).find((a) => a.id === accountId);
  if (!account || capabilitiesFor(doc, principal, account, now).size === 0) throw notFound('Unknown account.');
  return account;
}

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const includeDeleted = query(req, 'includeDeleted') === '1';
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  const now = ctx.now();
  const visible = (doc.accounts || []).filter((a) => capabilitiesFor(doc, ctx.principal, a, now).size > 0)
    .filter((a) => !a.deletedAt || (includeDeleted && mayManage(doc, a, member)));
  const accounts = visible.map((a) => ledger.accountView(doc, ctx.principal, a, now));
  // Net position per currency over accounts whose balances this person may see. Accounts they
  // cannot see contribute nothing — totals never reveal hidden balances. The breakdown separates
  // the viewer's own money, shared accounts, and accounts someone else shared with them, so a
  // grantee's headline figure is not silently inflated by another person's savings (UX-002).
  const totals = {};
  for (const a of accounts) {
    if (a.deletedAt || a.balanceMinor === undefined) continue;
    const t = totals[a.currency] || (totals[a.currency] = { all: 0, own: 0, shared: 0, granted: 0 });
    t.all = money.sum([t.all, a.balanceMinor]);
    t[a.access] = money.sum([t[a.access], a.balanceMinor]);
  }
  // How many removed accounts this person may bring back (BT-006-05), so the page can offer them
  // without loading them; accounts they may not manage are never counted.
  const removedCount = (doc.accounts || []).filter((a) => a.deletedAt && capabilitiesFor(doc, ctx.principal, a, now).size > 0 && mayManage(doc, a, member)).length;
  return {
    body: {
      accounts,
      removedCount,
      totals: Object.entries(totals).map(([currency, t]) => ({
        currency, minor: t.all, amount: money.toDecimal(t.all, currency),
        breakdown: { own: money.toDecimal(t.own, currency), shared: money.toDecimal(t.shared, currency), granted: money.toDecimal(t.granted, currency) },
      })),
    },
  };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'type', 'accountTypeId', 'currency', 'visibility', 'openingBalance', 'openingDate', 'institution', 'maskedNumber', 'terms', 'notes', 'icon']);
  const catalog = await catalogFor(ctx, body);
  const name = fields.text(body.name, { field: 'Name', max: 80, required: true });
  const currency = body.currency;
  money.precisionOf(currency);
  const visibility = fields.oneOf(body.visibility, ['private', 'shared'], 'Visibility', 'private');
  const openingDate = fields.date(body.openingDate, 'Opening date') || ctx.nowIso().slice(0, 10);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (visibility === 'shared' && !workspaceSettings.managesSharedLists(doc, member)) throw forbidden(member.role === 'viewer' ? 'Viewers cannot create shared accounts.' : 'Only owners and managers can create shared accounts in this workspace.');
    const nowIso = ctx.nowIso();
    // BT-019-02: `accountTypeId` is the friendlier, workspace-customizable way to choose a type;
    // the account's own canonical `type` (the fixed accounting class every balance/direction/
    // opening-balance rule already keys on) is always DERIVED from it here, once, and never
    // re-reads the type record again — so a type later renamed or recoloured can never disagree
    // with what an account already created from it actually is. Plain `type` alone (no
    // accountTypeId) is still accepted unchanged, for every existing caller.
    let type;
    let accountTypeId = null;
    if (body.accountTypeId !== undefined) {
      accountTypes.ensureSystemTypes(doc, nowIso);
      const chosen = accountTypes.findEffectiveType(doc, requireId(body.accountTypeId, 'accountTypeId'), nowIso);
      if (!chosen || chosen.retired) throw badRequest('Unknown or retired account type.', 'invalid_account_type');
      if (body.type !== undefined && body.type !== chosen.accountingClass) throw badRequest('This account type does not match the given type.', 'account_type_mismatch');
      type = chosen.accountingClass;
      accountTypeId = chosen.id;
    } else {
      type = fields.oneOf(body.type, ledger.ACCOUNT_TYPES, 'Type');
    }
    const openingBalanceMinor = ledger.openingBalance(type, body.openingBalance, currency);
    const record = {
      id: newId('acc'), name, type, accountTypeId, currency, visibility, openingBalanceMinor, openingDate,
      institution: fields.text(body.institution, { field: 'Institution', max: 80 }),
      maskedNumber: ledger.maskedNumber(body.maskedNumber),
      terms: ledger.validateTerms(type, body.terms, currency),
      notes: fields.text(body.notes, { field: 'Notes', max: 5000, multiline: true }),
      icon: body.icon === undefined ? null : icons.validateChoice(catalog, body.icon),
      status: 'open', deletedAt: null, revision: 1, history: [],
      ownerSubject: visibility === 'private' ? member.subject : null, createdBy: member.subject, createdAt: nowIso,
    };
    doc.accounts = [...(doc.accounts || []), record];
    ledger.assertLedgerInRange(doc);
    ledger.assertMemberQuota(doc, member, ctx.env);
    audit.record(doc, { actor: member.subject, action: 'account.create', targetType: 'account', targetId: record.id, scope: `account:${record.id}`, at: nowIso });
    return { account: ledger.accountView(doc, ctx.principal, record, ctx.now()) };
  }, { idempotencyKey: header(req, 'idempotency-key') || undefined, idempotencyScope: 'accounts.create', requestHash: store.requestHash({ q: wsId, body }) });
  return { status: 201, body: result };
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['accountId', ...EDITABLE]);
  const accountId = requireId(body.accountId, 'accountId');
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const account = locate(doc, ctx.principal, accountId, now);
    if (!mayManage(doc, account, member)) throw forbidden('Only the account owner (or a manager for shared accounts) can change this account.');
    // Record-level concurrency: a stale edit never silently overwrites someone else's (finding 8).
    if (!Number.isSafeInteger(body.revision)) throw badRequest('revision is required so a stale edit cannot overwrite a newer one.', 'missing_revision');
    if (body.revision !== (account.revision || 1)) throw conflict('This account changed since you loaded it. Reload to see the latest version.', 'stale_revision');
    const before = { openingBalanceMinor: account.openingBalanceMinor, openingDate: account.openingDate };
    const beforeAll = snap(account);
    const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
    if ((body.openingBalance !== undefined || body.openingDate !== undefined) && ledger.hasReconciledEntries(doc, account.id)) {
      throw conflict('This account has reconciled entries. Opening balance and date are locked to keep reconciled statements correct.', 'reconciled_locked');
    }
    // Type and currency may be fixed only while the account is exactly the "created by mistake"
    // case (Terry, 2026-09-17: "to minimize deleting... I should be able to edit my account,
    // namely account type, currency") — the same boundary ledger.hasEntries already draws for
    // deletion eligibility (BT-006-05). Once anything is recorded (an entry, a bill, a grant, a
    // Shared-expenses link — including deleted/reversed ones, which are kept), every transaction
    // on this account carries this exact currency (checkInvariants, api/_shared/backup.js) and
    // reinterpreting it under a new one would silently misstate real historical amounts, not just
    // relabel them — so it locks, the same way opening balance/date lock once reconciled.
    if ((body.type !== undefined || body.accountTypeId !== undefined || body.currency !== undefined) && ledger.hasEntries(doc, account)) {
      throw conflict('This account already has activity recorded against it (entries, bills, grants or a Shared-expenses link). Type and currency are locked once anything is recorded, so existing amounts are never silently reinterpreted.', 'has_entries_locked');
    }
    const changed = [];
    if (body.name !== undefined) { account.name = fields.text(body.name, { field: 'Name', max: 80, required: true }); changed.push('name'); }
    // BT-019-02: `accountTypeId` takes precedence when given (the friendlier picker); a bare `type`
    // still works unchanged for compatibility, but clears any previously-chosen type record, since
    // the raw accounting class was just set directly and no longer agrees with naming it by a type.
    if (body.accountTypeId !== undefined) {
      const nowIso = ctx.nowIso();
      accountTypes.ensureSystemTypes(doc, nowIso);
      if (body.accountTypeId === null) {
        if (account.accountTypeId !== null) { account.accountTypeId = null; changed.push('accountTypeId'); }
      } else {
        const chosen = accountTypes.findEffectiveType(doc, requireId(body.accountTypeId, 'accountTypeId'), nowIso);
        if (!chosen || chosen.retired) throw badRequest('Unknown or retired account type.', 'invalid_account_type');
        if (body.type !== undefined && body.type !== chosen.accountingClass) throw badRequest('This account type does not match the given type.', 'account_type_mismatch');
        if (chosen.id !== account.accountTypeId || chosen.accountingClass !== account.type) {
          account.accountTypeId = chosen.id;
          account.type = chosen.accountingClass;
          account.terms = ledger.validateTerms(account.type, undefined, account.currency);
          changed.push('accountTypeId', 'type', 'terms');
        }
      }
    } else if (body.type !== undefined && body.type !== account.type) {
      account.type = fields.oneOf(body.type, ledger.ACCOUNT_TYPES, 'Type');
      account.accountTypeId = null;
      // Type-specific terms (credit limit, APR, ...) may no longer apply to the new type — cleared
      // rather than silently carried over or left invalid; re-enter them if the new type needs them.
      account.terms = ledger.validateTerms(account.type, undefined, account.currency);
      changed.push('type', 'accountTypeId', 'terms');
    }
    if (body.currency !== undefined && body.currency !== account.currency) {
      money.precisionOf(body.currency);
      account.currency = body.currency;
      // The opening balance's minor-units number carries over unchanged — this fixes a
      // data-entry mistake (the wrong currency was picked), it is never a currency conversion.
      account.terms = ledger.validateTerms(account.type, undefined, account.currency);
      changed.push('currency', 'terms');
    }
    if (body.institution !== undefined) { account.institution = fields.text(body.institution, { field: 'Institution', max: 80 }); changed.push('institution'); }
    if (body.maskedNumber !== undefined) { account.maskedNumber = ledger.maskedNumber(body.maskedNumber); changed.push('maskedNumber'); }
    if (body.terms !== undefined) { account.terms = ledger.validateTerms(account.type, body.terms, account.currency); changed.push('terms'); }
    if (body.notes !== undefined) { account.notes = fields.text(body.notes, { field: 'Notes', max: 5000, multiline: true }); changed.push('notes'); }
    if (body.openingBalance !== undefined) { account.openingBalanceMinor = ledger.openingBalance(account.type, body.openingBalance, account.currency); changed.push('openingBalance'); }
    if (body.openingDate !== undefined) { account.openingDate = fields.date(body.openingDate, 'Opening date', { required: true }); changed.push('openingDate'); }
    if (body.icon !== undefined) {
      const icon = icons.validateChoice(catalog, body.icon, { current: account.icon || null });
      if (icon !== (account.icon || null)) { account.icon = icon; changed.push('icon'); }
    }
    if (body.visibility !== undefined && body.visibility !== account.visibility) {
      if (body.visibility !== 'shared') throw badRequest('A shared account cannot be made private; create a new private account instead.', 'visibility_change');
      if (body.confirmShare !== true) throw badRequest('Sharing exposes this account\'s balance and full history to every workspace member. Your shared-expense recording on this account stops; choose another private account in Shared expenses. Confirm with confirmShare: true.', 'confirm_required');
      account.visibility = 'shared';
      account.sharedAt = ctx.nowIso();
      account.sharedBy = member.subject;
      account.ownerSubject = null;
      for (const g of doc.grants || []) if (g.resourceId === account.id && g.revokedAt === null) { g.revokedAt = ctx.nowIso(); g.revokedBy = member.subject; }
      // Shared expenses are recorded only on their owner's own private account (security recheck R1):
      // every link to this account ends in this write, audited to its owner only. What is already on
      // the account stays as recorded.
      const at = ctx.nowIso();
      for (const l of doc.groupLedgers || []) {
        if (l.accountId !== account.id || l.endedAt) continue;
        l.endedAt = at;
        l.endReason = 'The account was shared';
        audit.record(doc, { actor: member.subject, action: 'group.ledger.end', targetType: 'group-ledger', targetId: l.id, scope: `self:${l.subject}`, at });
      }
      for (const rec of [...(doc.groupExpenses || []), ...(doc.groupSettlements || [])]) {
        for (const l of rec.ledgerLinks || []) if (l.accountId === account.id && !l.endedAt) { l.endedAt = at; l.endReason = 'The account was shared'; }
      }
      changed.push('visibility');
    }
    if (!changed.length) return { account: ledger.accountView(doc, ctx.principal, account, now) };
    ledger.assertLedgerInRange(doc);
    account.updatedAt = ctx.nowIso();
    account.updatedBy = member.subject;
    account.revision = (account.revision || 1) + 1;
    // Corrective history on the record itself (visible only to those who can see the account),
    // including before/after opening values; the workspace audit log keeps field names only.
    // Every change keeps its before and after values (terms such as credit limit or APR included)
    // and the optional reason (audit B8).
    const entry = { revision: account.revision, at: account.updatedAt, by: member.subject, fields: changed, changes: changesSince(beforeAll, account), reason };
    if (changed.includes('openingBalance') || changed.includes('openingDate')) {
      entry.before = before;
      entry.after = { openingBalanceMinor: account.openingBalanceMinor, openingDate: account.openingDate };
    }
    // Never truncated (BT-001-05): this history holds the before/after opening balance.
    account.history = [...(account.history || []), entry];
    audit.record(doc, { actor: member.subject, action: 'account.update', targetType: 'account', targetId: account.id, scope: `account:${account.id}`, at: ctx.nowIso(), fields: changed });
    return { account: ledger.accountView(doc, ctx.principal, account, now) };
  });
  return { body: result };
}

function setDeleted(deleted) {
  return async (ctx, req) => {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), ['accountId', 'reason']);
    const accountId = requireId(body.accountId, 'accountId');
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const account = locate(doc, ctx.principal, accountId, ctx.now());
      if (!mayManage(doc, account, member)) throw forbidden('Only the account owner (or a manager for shared accounts) can do that.');
      if (Boolean(account.deletedAt) === deleted) return { account: ledger.accountView(doc, ctx.principal, account, ctx.now()) };
      // Removing an account hides it from lists; it is never erased, and the reason is kept.
      const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
      if (deleted && !reason) throw badRequest('Give a reason for removing this account. It is kept with its history.', 'reason_required');
      const nowIso = ctx.nowIso();
      account.deletedAt = deleted ? nowIso : null;
      account.deletedBy = deleted ? member.subject : null;
      account.revision = (account.revision || 1) + 1;
      account.history = [...(account.history || []), { revision: account.revision, at: nowIso, by: member.subject, fields: ['deleted'], changes: [{ field: 'deleted', from: !deleted, to: deleted }], reason }];
      audit.record(doc, { actor: member.subject, action: deleted ? 'account.delete' : 'account.restore', targetType: 'account', targetId: account.id, scope: `account:${account.id}`, at: ctx.nowIso() });
      return { account: ledger.accountView(doc, ctx.principal, account, ctx.now()) };
    }, { allowHeadroom: deleted });
    return { body: result };
  };
}

// Closing keeps the account and its history visible but refuses new entries and bills on it;
// reopening allows them again. Both need the current revision; closing needs a reason.
function lifecycle(action) {
  return async (ctx, req) => {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), action === 'close' ? ['accountId', 'revision', 'reason', 'closedOn'] : ['accountId', 'revision', 'reason']);
    const accountId = requireId(body.accountId, 'accountId');
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const now = ctx.now();
      const nowIso = ctx.nowIso();
      const account = locate(doc, ctx.principal, accountId, now);
      if (!mayManage(doc, account, member)) throw forbidden('Only the account owner (or a manager for shared accounts) can close or reopen it.');
      if (!Number.isSafeInteger(body.revision)) throw badRequest('revision is required so a stale change cannot overwrite a newer one.', 'missing_revision');
      if (body.revision !== (account.revision || 1)) throw conflict('This account changed since you loaded it. Reload to see the latest version.', 'stale_revision');
      const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
      const from = account.status || 'open';
      if (action === 'close') {
        if (from === 'closed') throw conflict('This account is already closed.', 'already_closed');
        if (!reason) throw badRequest('Give a reason for closing this account. It is kept with its history.', 'reason_required');
        account.status = 'closed';
        account.closedOn = fields.date(body.closedOn, 'Date closed') || nowIso.slice(0, 10);
      } else {
        if (from !== 'closed') throw conflict('This account is not closed.', 'not_closed');
        account.status = 'open';
      }
      account.revision = (account.revision || 1) + 1;
      account.updatedAt = nowIso;
      account.updatedBy = member.subject;
      account.history = [...(account.history || []), {
        revision: account.revision, at: nowIso, by: member.subject, fields: ['status'],
        changes: [{ field: 'status', from, to: account.status }], reason, ...(action === 'close' ? { closedOn: account.closedOn } : {}),
      }];
      audit.record(doc, { actor: member.subject, action: `account.${action}`, targetType: 'account', targetId: account.id, scope: `account:${account.id}`, at: nowIso });
      return { account: ledger.accountView(doc, ctx.principal, account, now) };
    });
    return { body: result };
  };
}

// Permanent deletion (BT-014): a genuinely new action alongside remove/close above, never
// replacing them. Authority mirrors edit authority (mayManage): the private owner, or whoever
// manages shared lists for a shared account.
const permanentRoutes = deletion.makeRoutes({
  type: 'account', idField: 'accountId',
  find: (doc, id, ctx) => (doc.accounts || []).find((a) => a.id === id && capabilitiesFor(doc, ctx.principal, a, ctx.now()).size > 0) || null,
  authorize: (doc, member, account) => { if (!mayManage(doc, account, member)) throw forbidden('Only the account owner (or a manager for shared accounts) can permanently delete this account.'); },
  scopeFor: (account) => `account:${account.id}`,
});

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'restore') return setDeleted(false)(ctx, req);
  if (action === 'close' || action === 'reopen') return lifecycle(action)(ctx, req);
  if (action === 'delete-impact') return permanentRoutes.impactRoute(ctx, req);
  if (action === 'delete-permanent') return permanentRoutes.permanentRoute(ctx, req);
  if (action !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: list, POST: post, PATCH: patch, DELETE: setDeleted(true) };
