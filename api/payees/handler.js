'use strict';
// /api/payees?workspaceId=     The managed merchant directory (BT-007-01)
//   GET                                   merchants the caller may see, with totals from visible entries
//                                         (?status=active|closed filters; default all)
//   GET ?action=suggest&payeeId=          explained, editable autofill from visible history and defaults
//   GET ?action=check&name=&visibility=   duplicate check before creating: exact and similar names
//   POST { name, visibility?, type?, aliases?, contact?, customerNumber?, openedOn?, defaultCategoryId?,
//          defaultAccountId?, defaultCurrency?, tags?, notes?, accountId?, allowDuplicate? }
//   POST ?action=archive { payeeId, revision, closedOn?, reason? }   closes it for new entries
//   POST ?action=reopen  { payeeId, revision, reason? }
//   PATCH { payeeId, revision, reason?, visibility?, allowDuplicate?, ...details }
// Creator, or manager+ for shared merchants, may change one. There is NO DELETE: merchants are never
// deleted (BT-001-05); entries keep their merchant link and every change keeps its before/after
// values, author, time and reason. Merchants are payees, not financial accounts.
const { readBody, query, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { can, capabilitiesFor, roleAtLeast, visibleTransactions } = require('../_shared/authz');
const store = require('../_shared/store');
const ledger = require('../_shared/ledger');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const merchants = require('../_shared/merchants');

const DETAIL_KEYS = ['name', 'type', 'aliases', 'contact', 'customerNumber', 'openedOn', 'defaultCategoryId', 'defaultAccountId', 'defaultCurrency', 'tags', 'notes'];
const EMPTY_CONTACT = Object.freeze({ website: '', address: '', phone: '', email: '' });

function aliases(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw badRequest('Aliases must be a list of at most 20 names.', 'invalid_field');
  return [...new Set(value.map((a) => fields.text(a, { field: 'Alias', max: 80, required: true })))];
}

function contact(value) {
  if (value === undefined || value === null) return { ...EMPTY_CONTACT };
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('Contact details must be an object.', 'invalid_field');
  fields.onlyKeys(value, ['website', 'address', 'phone', 'email']);
  const website = fields.text(value.website, { field: 'Website', max: 200 });
  if (website) {
    let url = null;
    try { url = new URL(website); } catch { url = null; }
    if (!url || !['https:', 'http:'].includes(url.protocol)) throw badRequest('Website must start with https:// or http://.', 'invalid_field');
  }
  const phone = fields.text(value.phone, { field: 'Phone', max: 40 });
  if (phone && !/^[0-9+().\-\s]{3,40}$/.test(phone)) throw badRequest('Phone may contain digits, spaces and + ( ) - . only.', 'invalid_field');
  return { website, address: fields.text(value.address, { field: 'Address', max: 300, multiline: true }), phone, email: fields.email(value.email, 'Email') };
}

function category(doc, value) {
  const id = fields.optionalId(value, 'Default category');
  if (id && !(doc.categories || []).some((c) => c.id === id)) throw badRequest('Unknown category.', 'invalid_category');
  return id;
}

// A shared merchant may only default to a shared account: its defaults are visible to every member.
function defaultAccount(doc, principal, value, visibility, now) {
  const id = fields.optionalId(value, 'Default account');
  if (!id) return null;
  const a = (doc.accounts || []).find((x) => x.id === id && !x.deletedAt);
  if (!a || !can(doc, principal, a, 'view-transactions', now)) throw badRequest('Unknown account.', 'invalid_default_account');
  if (visibility === 'shared' && a.visibility !== 'shared') throw badRequest('A shared merchant can only default to a shared account.', 'invalid_default_account');
  return id;
}

function currency(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!money.isCurrency(value)) throw badRequest('Default currency is not a known currency code.', 'invalid_currency');
  return value;
}

function mayEdit(p, member) {
  return p.ownerSubject === member.subject || (p.visibility === 'shared' && roleAtLeast(member.role, 'manager'));
}

// A merchant visible only because it appears on an entry the viewer can see shows its NAME only —
// never the owner's notes, contact details, aliases or defaults (security review finding 9).
function view(doc, p, principal, member, stats, now) {
  const full = p.visibility === 'shared' || p.ownerSubject === principal.subject;
  const out = {
    id: p.id, name: p.name, normalizedName: p.normalizedName || merchants.normalizeName(p.name), visibility: p.visibility,
    status: merchants.statusOf(p), ownedBySelf: p.ownerSubject === principal.subject, referenceOnly: !full, stats: stats || [],
    aliases: [], notes: '', defaultCategoryId: null,
  };
  if (!full) return out;
  const acct = p.defaultAccountId && (doc.accounts || []).find((a) => a.id === p.defaultAccountId && !a.deletedAt);
  const names = new Map((doc.members || []).map((m) => [m.subject, m.name || 'Member']));
  return {
    ...out, type: p.type || 'other', aliases: p.aliases || [], notes: p.notes || '', defaultCategoryId: p.defaultCategoryId || null,
    contact: { ...EMPTY_CONTACT, ...(p.contact || {}) }, customerNumber: p.customerNumber || '',
    openedOn: p.openedOn || null, closedOn: p.closedOn || null, closeReason: p.closeReason || '',
    defaultAccountId: acct && can(doc, principal, acct, 'view-transactions', now) ? acct.id : null,
    defaultCurrency: p.defaultCurrency || null, tags: p.tags || [], revision: p.revision || 1,
    canEdit: !!member && mayEdit(p, member),
    // Others see a once-private merchant's history only from when it was shared, and without the
    // values it had before (security review SEC-B11).
    history: (p.history || []).filter((h) => p.ownerSubject === principal.subject || !p.sharedAt || h.at >= p.sharedAt).slice(-20).map((h) => ({
      at: h.at, by: names.get(h.by) || 'Former member', reason: h.reason || '',
      changes: p.ownerSubject !== principal.subject && p.sharedAt && h.at === p.sharedAt ? h.changes.map((c) => ({ field: c.field, from: null, to: c.to })) : h.changes,
    })),
  };
}

function statsFor(txns) {
  const byPayee = new Map();
  for (const t of txns) {
    if (!t.payeeId) continue;
    const bucket = ledger.classify(t.kind);
    if (bucket !== 'spending' && bucket !== 'refund') continue;
    const perCurrency = byPayee.get(t.payeeId) || new Map();
    const s = perCurrency.get(t.currency) || { count: 0, gross: 0, refunds: 0, last: null };
    s.count += 1;
    if (bucket === 'refund') s.refunds = money.sum([s.refunds, t.amountMinor]);
    else s.gross = money.sum([s.gross, -t.amountMinor]);
    if (!s.last || t.date > s.last) s.last = t.date;
    perCurrency.set(t.currency, s);
    byPayee.set(t.payeeId, perCurrency);
  }
  return (id) => [...(byPayee.get(id) || new Map()).entries()].map(([c, s]) => ({
    currency: c, count: s.count, gross: money.toDecimal(s.gross, c), refunds: money.toDecimal(s.refunds, c),
    net: money.toDecimal(money.sum([s.gross, -s.refunds]), c), lastDate: s.last,
  }));
}

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  const now = ctx.now();
  const txns = visibleTransactions(doc, ctx.principal, now);
  const action = query(req, 'action');
  if (action === 'suggest') return suggest(doc, ctx, req, txns, now);
  if (action === 'check') return check(doc, ctx, req, now);
  if (action !== undefined) throw notFound();
  const status = query(req, 'status') === undefined ? null : fields.oneOf(query(req, 'status'), ['active', 'closed'], 'Status');
  const stats = statsFor(txns);
  const payees = ledger.visiblePayees(doc, ctx.principal, txns)
    .filter((p) => !status || merchants.statusOf(p) === status)
    .map((p) => view(doc, p, ctx.principal, member, stats(p.id), now));
  payees.sort((a, b) => a.name.localeCompare(b.name));
  return { body: { payees } };
}

function check(doc, ctx, req, now) {
  const name = fields.text(query(req, 'name'), { field: 'Name', max: 80, required: true });
  const visibility = fields.oneOf(query(req, 'visibility'), ['private', 'shared'], 'Visibility', 'private');
  const { exact, similar } = merchants.findDuplicates(doc, ctx.principal, now, { name, visibility, ownerSubject: ctx.principal.subject });
  return { body: { normalizedName: merchants.normalizeName(name), exact: exact.map(merchants.brief), similar: similar.map(merchants.brief) } };
}

// Autofill is a SUGGESTION: every value is returned separately with the reason, the client keeps
// every field editable, and nothing is saved until the person saves the entry. Merchant defaults
// fill in only where there is no history, and only for merchants the caller fully sees.
function suggest(doc, ctx, req, txns, now) {
  const payeeId = requireId(query(req, 'payeeId'), 'payeeId');
  const payee = ledger.visiblePayees(doc, ctx.principal, txns).find((p) => p.id === payeeId);
  if (!payee) throw notFound('Unknown payee.');
  const full = payee.visibility === 'shared' || payee.ownerSubject === ctx.principal.subject;
  const history = txns.filter((t) => t.payeeId === payeeId && t.kind !== 'transfer').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
  const mode = (values) => {
    const counts = new Map();
    for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
    let best = null;
    for (const [v, c] of counts) if (!best || c > best.c) best = { v, c };
    return best;
  };
  const cat = mode(history.map((t) => t.categoryId));
  const acc = mode(history.map((t) => t.accountId));
  const last = history[0];
  const defAccount = full && payee.defaultAccountId && (doc.accounts || []).find((a) => a.id === payee.defaultAccountId && !a.deletedAt);
  const usableDefault = defAccount && can(doc, ctx.principal, defAccount, 'create', now) ? defAccount.id : null;
  const defCategory = full ? payee.defaultCategoryId || null : null;
  const suggestion = {
    payeeId, basedOn: history.length,
    categoryId: cat ? cat.v : defCategory,
    // Plain-language reasons (UX-006). "Your" entries means entries this person may see.
    categoryReason: cat ? `You used this in ${cat.c} of your last ${history.length} ${payee.name} entries.` : defCategory ? `The default category for ${payee.name}.` : null,
    accountId: acc ? acc.v : usableDefault,
    accountReason: acc ? `You paid ${payee.name} from this account in ${acc.c} of your last ${history.length} entries.` : usableDefault ? `The default account for ${payee.name}.` : null,
    kind: last ? last.kind : 'expense',
    amount: last ? money.toDecimal(Math.abs(last.amountMinor), last.currency) : null,
    currency: last ? last.currency : (full ? payee.defaultCurrency || null : null),
    amountReason: last ? `From your last ${payee.name} entry (${last.date}).` : null,
    tags: last ? last.tags || [] : [],
    splits: last && (last.splits || []).length ? last.splits.map((s) => ({ categoryId: s.categoryId, amount: money.toDecimal(Math.abs(s.amountMinor), last.currency) })) : [],
  };
  return { body: { suggestion, note: 'Suggestions use only entries you are allowed to see and are never saved until you save the entry.' } };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), [...DETAIL_KEYS, 'visibility', 'accountId', 'allowDuplicate']);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const nowIso = ctx.nowIso();
    let visibility = fields.oneOf(body.visibility, ['private', 'shared'], 'Visibility', 'private');
    let ownerSubject = member.subject;
    if (body.accountId !== undefined) {
      // Created while entering an expense on a particular account: the merchant takes that account's
      // scope, so it is usable there. On someone else's private account it belongs to that account's
      // owner and does not outlive a revoked grant in the creator's hands (security review finding 9).
      // The same rule as adding an entry: any access makes the account known, `create` is required.
      const a = (doc.accounts || []).find((x) => x.id === body.accountId && !x.deletedAt);
      const caps = a ? capabilitiesFor(doc, ctx.principal, a, now) : new Set();
      if (!caps.size) throw notFound('Unknown account.');
      if (!caps.has('create')) throw forbidden('You cannot add entries to this account.');
      if (a.visibility === 'shared') visibility = 'shared';
      else if (a.ownerSubject !== member.subject) { visibility = 'private'; ownerSubject = a.ownerSubject; }
    }
    if (visibility === 'shared' && member.role === 'viewer') throw forbidden('Viewers cannot add shared merchants.');
    const name = fields.text(body.name, { field: 'Name', max: 80, required: true });
    const aliasList = aliases(body.aliases);
    const dup = merchants.findDuplicates(doc, ctx.principal, now, { name, aliases: aliasList, visibility, ownerSubject });
    if (dup.exact.length && fields.bool(body.allowDuplicate, 'Allow duplicate') !== true) throw merchants.duplicateError(dup.exact[0]);
    const p = {
      id: newId('pay'), name, normalizedName: merchants.normalizeName(name), aliases: aliasList, visibility, ownerSubject,
      type: fields.oneOf(body.type, merchants.MERCHANT_TYPES, 'Merchant type', 'other'), contact: contact(body.contact),
      customerNumber: fields.text(body.customerNumber, { field: 'Customer number', max: 60 }),
      openedOn: fields.date(body.openedOn, 'Date opened'), closedOn: null, closeReason: '', status: 'active',
      defaultCategoryId: category(doc, body.defaultCategoryId), defaultAccountId: defaultAccount(doc, ctx.principal, body.defaultAccountId, visibility, now),
      defaultCurrency: currency(body.defaultCurrency), tags: fields.tags(body.tags), notes: fields.text(body.notes, { field: 'Notes', max: 5000, multiline: true }),
      attachments: [], createdAt: nowIso, createdBy: member.subject, revision: 1, deletedAt: null,
      history: [{ revision: 1, at: nowIso, by: member.subject, changes: [{ field: 'create' }] }],
    };
    doc.payees = [...(doc.payees || []), p];
    ledger.assertMemberQuota(doc, member, ctx.env);
    audit.record(doc, { actor: member.subject, action: 'payee.create', targetType: 'payee', targetId: p.id, scope: visibility === 'shared' ? 'members' : `self:${ownerSubject}`, at: nowIso });
    return { payee: view(doc, p, ctx.principal, member, [], now), similar: dup.similar.map(merchants.brief) };
  });
  return { status: 201, body: result };
}

function locate(doc, principal, id, now) {
  const p = ledger.visiblePayees(doc, principal, visibleTransactions(doc, principal, now)).find((x) => x.id === id);
  if (!p) throw notFound('Unknown payee.');
  return p;
}

function checkRevision(p, revision) {
  if (!Number.isSafeInteger(revision)) throw badRequest('revision is required so a stale edit cannot overwrite a newer one.', 'missing_revision');
  if (revision !== (p.revision || 1)) throw conflict('This merchant changed since you loaded it. Reload to see the latest version.', 'stale_revision');
}

// Applies a change and records its before and after values; unchanged values are not recorded.
function recorder(p) {
  const changes = [];
  const set = (field, value) => {
    const from = p[field] === undefined ? null : p[field];
    if (JSON.stringify(from) === JSON.stringify(value === undefined ? null : value)) return;
    // Account ids never go into history: they could identify someone's private account (SEC-B11).
    const redact = (v) => (field === 'defaultAccountId' && v ? 'an account' : v);
    changes.push({ field, from: redact(from), to: redact(value === undefined ? null : value) });
    p[field] = value;
  };
  return { set, changes };
}

function commit(doc, p, member, nowIso, changes, reason, action, env) {
  if (!changes.length) return;
  p.revision = (p.revision || 1) + 1;
  p.updatedAt = nowIso;
  p.history = [...(p.history || []), { revision: p.revision, at: nowIso, by: member.subject, changes, reason: reason || '' }];
  ledger.assertMemberQuota(doc, member, env);
  audit.record(doc, { actor: member.subject, action, targetType: 'payee', targetId: p.id, scope: p.visibility === 'shared' ? 'members' : `self:${p.ownerSubject}`, at: nowIso, fields: changes.map((c) => c.field) });
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['payeeId', 'revision', 'reason', 'visibility', 'allowDuplicate', ...DETAIL_KEYS]);
  const id = requireId(body.payeeId, 'payeeId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const now = ctx.now();
    const nowIso = ctx.nowIso();
    const p = locate(doc, ctx.principal, id, now);
    if (!mayEdit(p, member)) throw forbidden('You cannot edit this merchant.');
    checkRevision(p, body.revision);
    const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
    const { set, changes } = recorder(p);
    if (body.visibility !== undefined && body.visibility !== p.visibility) {
      if (body.visibility !== 'shared' || p.ownerSubject !== member.subject || member.role === 'viewer') throw forbidden('Only the creator can share a private merchant.');
      set('visibility', 'shared');
      p.sharedAt = nowIso;
      const acct = p.defaultAccountId && (doc.accounts || []).find((a) => a.id === p.defaultAccountId);
      if (acct && acct.visibility !== 'shared') set('defaultAccountId', null);
    }
    if (body.name !== undefined || body.aliases !== undefined) {
      const name = body.name !== undefined ? fields.text(body.name, { field: 'Name', max: 80, required: true }) : p.name;
      const aliasList = body.aliases !== undefined ? aliases(body.aliases) : p.aliases || [];
      const dup = merchants.findDuplicates(doc, ctx.principal, now, { name, aliases: aliasList, visibility: p.visibility, ownerSubject: p.ownerSubject, exceptId: p.id });
      if (dup.exact.length && fields.bool(body.allowDuplicate, 'Allow duplicate') !== true) throw merchants.duplicateError(dup.exact[0]);
      set('name', name);
      set('aliases', aliasList);
      p.normalizedName = merchants.normalizeName(name);
    }
    if (body.type !== undefined) set('type', fields.oneOf(body.type, merchants.MERCHANT_TYPES, 'Merchant type'));
    if (body.contact !== undefined) set('contact', contact(body.contact));
    if (body.customerNumber !== undefined) set('customerNumber', fields.text(body.customerNumber, { field: 'Customer number', max: 60 }));
    if (body.openedOn !== undefined) {
      const openedOn = fields.date(body.openedOn, 'Date opened');
      if (openedOn && p.closedOn && openedOn > p.closedOn) throw badRequest('The opening date is after the closing date.', 'invalid_date');
      set('openedOn', openedOn);
    }
    if (body.defaultCategoryId !== undefined) set('defaultCategoryId', category(doc, body.defaultCategoryId));
    if (body.defaultAccountId !== undefined) set('defaultAccountId', defaultAccount(doc, ctx.principal, body.defaultAccountId, p.visibility, now));
    if (body.defaultCurrency !== undefined) set('defaultCurrency', currency(body.defaultCurrency));
    if (body.tags !== undefined) set('tags', fields.tags(body.tags));
    if (body.notes !== undefined) set('notes', fields.text(body.notes, { field: 'Notes', max: 5000, multiline: true }));
    commit(doc, p, member, nowIso, changes, reason, 'payee.update', ctx.env);
    return { payee: view(doc, p, ctx.principal, member, [], now) };
  });
  return { body: result };
}

// Closing and reopening. Neither touches any entry: the history stays exactly as recorded.
function lifecycle(action) {
  return async (ctx, req) => {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), action === 'archive' ? ['payeeId', 'revision', 'reason', 'closedOn'] : ['payeeId', 'revision', 'reason']);
    const id = requireId(body.payeeId, 'payeeId');
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const now = ctx.now();
      const nowIso = ctx.nowIso();
      const p = locate(doc, ctx.principal, id, now);
      if (!mayEdit(p, member)) throw forbidden('You cannot close or reopen this merchant.');
      checkRevision(p, body.revision);
      const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
      const { set, changes } = recorder(p);
      if (action === 'archive') {
        if (merchants.statusOf(p) === 'closed') throw conflict('This merchant is already closed.', 'already_closed');
        const closedOn = fields.date(body.closedOn, 'Date closed') || nowIso.slice(0, 10);
        if (p.openedOn && closedOn < p.openedOn) throw badRequest('The closing date is before the opening date.', 'invalid_date');
        set('status', 'closed');
        set('closedOn', closedOn);
        set('closeReason', reason);
      } else {
        if (merchants.statusOf(p) !== 'closed') throw conflict('This merchant is not closed.', 'not_closed');
        set('status', 'active');
        set('closedOn', null);
        set('closeReason', '');
      }
      commit(doc, p, member, nowIso, changes, reason, action === 'archive' ? 'payee.archive' : 'payee.reopen', ctx.env);
      return { payee: view(doc, p, ctx.principal, member, [], now) };
    });
    return { body: result };
  };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === undefined) return create(ctx, req);
  if (action === 'archive' || action === 'reopen') return lifecycle(action)(ctx, req);
  throw notFound();
}

module.exports = { GET: list, POST: post, PATCH: patch };
