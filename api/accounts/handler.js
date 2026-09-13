'use strict';
// /api/accounts?workspaceId=
//   GET                         accounts the caller may see (balances only with view-balances)
//   POST   {...}                create; shared accounts need manager+, private any active member
//   PATCH  { accountId, ... }   edit settings (private owner, or manager+ for shared)
//   DELETE { accountId }        soft delete (recoverable); history is kept
//   POST   ?action=restore { accountId }
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

const EDITABLE = ['revision', 'name', 'institution', 'maskedNumber', 'terms', 'notes', 'status', 'openingBalance', 'openingDate', 'visibility', 'confirmShare'];

function mayManage(account, member) {
  if (account.visibility === 'private') return account.ownerSubject === member.subject;
  return roleAtLeast(member.role, 'manager');
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
    .filter((a) => !a.deletedAt || (includeDeleted && mayManage(a, member)));
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
  return {
    body: {
      accounts,
      totals: Object.entries(totals).map(([currency, t]) => ({
        currency, minor: t.all, amount: money.toDecimal(t.all, currency),
        breakdown: { own: money.toDecimal(t.own, currency), shared: money.toDecimal(t.shared, currency), granted: money.toDecimal(t.granted, currency) },
      })),
    },
  };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'type', 'currency', 'visibility', 'openingBalance', 'openingDate', 'institution', 'maskedNumber', 'terms', 'notes']);
  const name = fields.text(body.name, { field: 'Name', max: 80, required: true });
  const type = fields.oneOf(body.type, ledger.ACCOUNT_TYPES, 'Type');
  const currency = body.currency;
  money.precisionOf(currency);
  const visibility = fields.oneOf(body.visibility, ['private', 'shared'], 'Visibility', 'private');
  const openingBalanceMinor = ledger.openingBalance(type, body.openingBalance, currency);
  const openingDate = fields.date(body.openingDate, 'Opening date') || ctx.nowIso().slice(0, 10);
  const account = {
    id: newId('acc'), name, type, currency, visibility, openingBalanceMinor, openingDate,
    institution: fields.text(body.institution, { field: 'Institution', max: 80 }),
    maskedNumber: ledger.maskedNumber(body.maskedNumber),
    terms: ledger.validateTerms(type, body.terms, currency),
    notes: fields.text(body.notes, { field: 'Notes', max: 5000, multiline: true }),
    status: 'open', deletedAt: null, revision: 1, history: [],
  };
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    if (visibility === 'shared' && !roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can create shared accounts.');
    const nowIso = ctx.nowIso();
    const record = { ...account, ownerSubject: visibility === 'private' ? member.subject : null, createdBy: member.subject, createdAt: nowIso };
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
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const account = locate(doc, ctx.principal, accountId, now);
    if (!mayManage(account, member)) throw forbidden('Only the account owner (or a manager for shared accounts) can change this account.');
    // Record-level concurrency: a stale edit never silently overwrites someone else's (finding 8).
    if (!Number.isSafeInteger(body.revision)) throw badRequest('revision is required so a stale edit cannot overwrite a newer one.', 'missing_revision');
    if (body.revision !== (account.revision || 1)) throw conflict('This account changed since you loaded it. Reload to see the latest version.', 'stale_revision');
    const before = { openingBalanceMinor: account.openingBalanceMinor, openingDate: account.openingDate };
    if ((body.openingBalance !== undefined || body.openingDate !== undefined)
        && (doc.transactions || []).some((t) => t.accountId === account.id && !t.deletedAt && t.status === 'reconciled')) {
      throw conflict('This account has reconciled entries. Opening balance and date are locked to keep reconciled statements correct.', 'reconciled_locked');
    }
    const changed = [];
    if (body.name !== undefined) { account.name = fields.text(body.name, { field: 'Name', max: 80, required: true }); changed.push('name'); }
    if (body.institution !== undefined) { account.institution = fields.text(body.institution, { field: 'Institution', max: 80 }); changed.push('institution'); }
    if (body.maskedNumber !== undefined) { account.maskedNumber = ledger.maskedNumber(body.maskedNumber); changed.push('maskedNumber'); }
    if (body.terms !== undefined) { account.terms = ledger.validateTerms(account.type, body.terms, account.currency); changed.push('terms'); }
    if (body.notes !== undefined) { account.notes = fields.text(body.notes, { field: 'Notes', max: 5000, multiline: true }); changed.push('notes'); }
    if (body.status !== undefined) { account.status = fields.oneOf(body.status, ['open', 'closed'], 'Status'); changed.push('status'); }
    if (body.openingBalance !== undefined) { account.openingBalanceMinor = ledger.openingBalance(account.type, body.openingBalance, account.currency); changed.push('openingBalance'); }
    if (body.openingDate !== undefined) { account.openingDate = fields.date(body.openingDate, 'Opening date', { required: true }); changed.push('openingDate'); }
    if (body.visibility !== undefined && body.visibility !== account.visibility) {
      if (body.visibility !== 'shared') throw badRequest('A shared account cannot be made private; create a new private account instead.', 'visibility_change');
      if (body.confirmShare !== true) throw badRequest('Sharing exposes this account\'s balance and full history to every workspace member. Confirm with confirmShare: true.', 'confirm_required');
      account.visibility = 'shared';
      account.sharedAt = ctx.nowIso();
      account.sharedBy = member.subject;
      account.ownerSubject = null;
      for (const g of doc.grants || []) if (g.resourceId === account.id && g.revokedAt === null) { g.revokedAt = ctx.nowIso(); g.revokedBy = member.subject; }
      changed.push('visibility');
    }
    if (!changed.length) return { account: ledger.accountView(doc, ctx.principal, account, now) };
    ledger.assertLedgerInRange(doc);
    account.updatedAt = ctx.nowIso();
    account.updatedBy = member.subject;
    account.revision = (account.revision || 1) + 1;
    // Corrective history on the record itself (visible only to those who can see the account),
    // including before/after opening values; the workspace audit log keeps field names only.
    const entry = { revision: account.revision, at: account.updatedAt, by: member.subject, fields: changed };
    if (changed.includes('openingBalance') || changed.includes('openingDate')) {
      entry.before = before;
      entry.after = { openingBalanceMinor: account.openingBalanceMinor, openingDate: account.openingDate };
    }
    account.history = [...(account.history || []), entry].slice(-50);
    audit.record(doc, { actor: member.subject, action: 'account.update', targetType: 'account', targetId: account.id, scope: `account:${account.id}`, at: ctx.nowIso(), fields: changed });
    return { account: ledger.accountView(doc, ctx.principal, account, now) };
  });
  return { body: result };
}

function setDeleted(deleted) {
  return async (ctx, req) => {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), ['accountId']);
    const accountId = requireId(body.accountId, 'accountId');
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const account = locate(doc, ctx.principal, accountId, ctx.now());
      if (!mayManage(account, member)) throw forbidden('Only the account owner (or a manager for shared accounts) can do that.');
      if (Boolean(account.deletedAt) === deleted) return { account: ledger.accountView(doc, ctx.principal, account, ctx.now()) };
      account.deletedAt = deleted ? ctx.nowIso() : null;
      account.deletedBy = deleted ? member.subject : null;
      audit.record(doc, { actor: member.subject, action: deleted ? 'account.delete' : 'account.restore', targetType: 'account', targetId: account.id, scope: `account:${account.id}`, at: ctx.nowIso() });
      return { account: ledger.accountView(doc, ctx.principal, account, ctx.now()) };
    }, { allowHeadroom: deleted });
    return { body: result };
  };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === 'restore') return setDeleted(false)(ctx, req);
  if (action !== undefined) throw notFound();
  return create(ctx, req);
}

module.exports = { GET: list, POST: post, PATCH: patch, DELETE: setDeleted(true) };
