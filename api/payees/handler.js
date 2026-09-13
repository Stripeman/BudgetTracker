'use strict';
// /api/payees?workspaceId=
//   GET                          visible payees with per-currency history totals from visible entries
//   GET ?action=suggest&payeeId= editable autofill suggestion, explained, from visible history only
//   POST   { name, aliases, visibility, defaultCategoryId, notes }
//   PATCH  { payeeId, ... }      creator, or manager+ for shared payees
//   DELETE { payeeId }           soft delete; historical entries keep their payee
// Merchants are payees, not financial accounts.
const { readBody, query, badRequest, forbidden, notFound } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { roleAtLeast, visibleTransactions } = require('../_shared/authz');
const store = require('../_shared/store');
const ledger = require('../_shared/ledger');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');

function aliases(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw badRequest('Aliases must be a list of at most 20 names.', 'invalid_field');
  return [...new Set(value.map((a) => fields.text(a, { field: 'Alias', max: 80, required: true })))];
}

function view(p, principal, stats) {
  return {
    id: p.id, name: p.name, aliases: p.aliases || [], visibility: p.visibility, defaultCategoryId: p.defaultCategoryId || null,
    notes: p.notes || '', ownedBySelf: p.ownerSubject === principal.subject, stats: stats || [],
  };
}

function mayEdit(p, member) {
  return p.ownerSubject === member.subject || (p.visibility === 'shared' && roleAtLeast(member.role, 'manager'));
}

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const now = ctx.now();
  const txns = visibleTransactions(doc, ctx.principal, now);
  if (query(req, 'action') === 'suggest') return suggest(doc, ctx, req, txns);
  const byPayee = new Map();
  for (const t of txns) {
    if (!t.payeeId) continue;
    const perCurrency = byPayee.get(t.payeeId) || new Map();
    const s = perCurrency.get(t.currency) || { count: 0, gross: 0, refunds: 0, last: null };
    s.count += 1;
    if (t.kind === 'refund') s.refunds = money.sum([s.refunds, t.amountMinor]);
    else if (t.amountMinor < 0) s.gross = money.sum([s.gross, -t.amountMinor]);
    if (!s.last || t.date > s.last) s.last = t.date;
    perCurrency.set(t.currency, s);
    byPayee.set(t.payeeId, perCurrency);
  }
  const payees = ledger.visiblePayees(doc, ctx.principal, txns).map((p) => view(p, ctx.principal,
    [...(byPayee.get(p.id) || new Map()).entries()].map(([currency, s]) => ({
      currency, count: s.count, gross: money.toDecimal(s.gross, currency), refunds: money.toDecimal(s.refunds, currency),
      net: money.toDecimal(money.sum([s.gross, -s.refunds]), currency), lastDate: s.last,
    }))));
  payees.sort((a, b) => a.name.localeCompare(b.name));
  return { body: { payees } };
}

// Autofill is a SUGGESTION: every value is returned separately with the reason, the client keeps
// every field editable, and nothing is saved until the person saves the entry.
function suggest(doc, ctx, req, txns) {
  const payeeId = requireId(query(req, 'payeeId'), 'payeeId');
  const payee = ledger.visiblePayees(doc, ctx.principal, txns).find((p) => p.id === payeeId);
  if (!payee) throw notFound('Unknown payee.');
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
  const suggestion = {
    payeeId, basedOn: history.length,
    categoryId: cat ? cat.v : payee.defaultCategoryId || null,
    categoryReason: cat ? `Used in ${cat.c} of your last ${history.length} visible entries for ${payee.name}.` : payee.defaultCategoryId ? 'Payee default category.' : null,
    accountId: acc ? acc.v : null,
    accountReason: acc ? `Used in ${acc.c} of your last ${history.length} visible entries.` : null,
    kind: last ? last.kind : 'expense',
    amount: last ? money.toDecimal(Math.abs(last.amountMinor), last.currency) : null,
    currency: last ? last.currency : null,
    amountReason: last ? `Your most recent visible entry on ${last.date}.` : null,
    tags: last ? last.tags || [] : [],
    splits: last && (last.splits || []).length ? last.splits.map((s) => ({ categoryId: s.categoryId, amount: money.toDecimal(Math.abs(s.amountMinor), last.currency) })) : [],
  };
  return { body: { suggestion, note: 'Suggestions use only entries you are allowed to see and are never saved until you save the entry.' } };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'aliases', 'visibility', 'defaultCategoryId', 'notes']);
  const name = fields.text(body.name, { field: 'Name', max: 80, required: true });
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const visibility = fields.oneOf(body.visibility, ['private', 'shared'], 'Visibility', 'private');
    if (visibility === 'shared' && member.role === 'viewer') throw forbidden('Viewers cannot add shared payees.');
    const categoryId = fields.optionalId(body.defaultCategoryId, 'Default category');
    if (categoryId && !(doc.categories || []).some((c) => c.id === categoryId)) throw badRequest('Unknown category.', 'invalid_category');
    const p = { id: newId('pay'), name, aliases: aliases(body.aliases), visibility, ownerSubject: member.subject, defaultCategoryId: categoryId, notes: fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }), createdAt: ctx.nowIso(), deletedAt: null };
    doc.payees = [...(doc.payees || []), p];
    audit.record(doc, { actor: member.subject, action: 'payee.create', targetType: 'payee', targetId: p.id, scope: visibility === 'shared' ? 'members' : `self:${member.subject}`, at: ctx.nowIso() });
    return { payee: view(p, ctx.principal) };
  });
  return { status: 201, body: result };
}

function locate(doc, principal, id, now) {
  const p = ledger.visiblePayees(doc, principal, visibleTransactions(doc, principal, now)).find((x) => x.id === id);
  if (!p) throw notFound('Unknown payee.');
  return p;
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['payeeId', 'name', 'aliases', 'defaultCategoryId', 'notes', 'visibility']);
  const id = requireId(body.payeeId, 'payeeId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const p = locate(doc, ctx.principal, id, ctx.now());
    if (!mayEdit(p, member)) throw forbidden('You cannot edit this payee.');
    const changed = [];
    if (body.name !== undefined) { p.name = fields.text(body.name, { field: 'Name', max: 80, required: true }); changed.push('name'); }
    if (body.aliases !== undefined) { p.aliases = aliases(body.aliases); changed.push('aliases'); }
    if (body.notes !== undefined) { p.notes = fields.text(body.notes, { field: 'Notes', max: 2000, multiline: true }); changed.push('notes'); }
    if (body.defaultCategoryId !== undefined) {
      const categoryId = fields.optionalId(body.defaultCategoryId, 'Default category');
      if (categoryId && !(doc.categories || []).some((c) => c.id === categoryId)) throw badRequest('Unknown category.', 'invalid_category');
      p.defaultCategoryId = categoryId; changed.push('defaultCategoryId');
    }
    if (body.visibility !== undefined && body.visibility !== p.visibility) {
      if (body.visibility !== 'shared' || p.ownerSubject !== member.subject || member.role === 'viewer') throw forbidden('Only the creator can share a private payee.');
      p.visibility = 'shared'; changed.push('visibility');
    }
    if (changed.length) audit.record(doc, { actor: member.subject, action: 'payee.update', targetType: 'payee', targetId: p.id, scope: p.visibility === 'shared' ? 'members' : `self:${member.subject}`, at: ctx.nowIso(), fields: changed });
    return { payee: view(p, ctx.principal) };
  });
  return { body: result };
}

async function remove(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['payeeId']);
  const id = requireId(body.payeeId, 'payeeId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const p = locate(doc, ctx.principal, id, ctx.now());
    if (!mayEdit(p, member)) throw forbidden('You cannot remove this payee.');
    p.deletedAt = ctx.nowIso();
    audit.record(doc, { actor: member.subject, action: 'payee.delete', targetType: 'payee', targetId: p.id, scope: p.visibility === 'shared' ? 'members' : `self:${member.subject}`, at: ctx.nowIso() });
    return { removed: p.id };
  });
  return { body: result };
}

module.exports = { GET: list, POST: create, PATCH: patch, DELETE: remove };
