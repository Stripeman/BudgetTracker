'use strict';
// /api/budgets?workspaceId=
//   GET                         budgets the caller may see, each with its current-period status
//   POST   { name, scope, currency, period, startDate, lines:[{categoryId, amount, rollover}] }
//   PATCH  { budgetId, revision, ... }   shared: manager+; private: its owner
//   DELETE { budgetId, revision }        soft delete
// Shared budgets are visible to every member and count shared accounts only; private budgets are
// visible only to their owner.
const { readBody, query, badRequest, forbidden, notFound, conflict } = require('../_shared/http');
const { newId, requireId } = require('../_shared/ids');
const { roleAtLeast } = require('../_shared/authz');
const store = require('../_shared/store');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const audit = require('../_shared/audit');
const budgeting = require('../_shared/budgeting');

const PERIODS = ['monthly', 'weekly', 'biweekly'];

function visibleTo(budget, member) {
  return !budget.deletedAt && (budget.scope === 'shared' || budget.ownerSubject === member.subject);
}
function mayEdit(budget, member) {
  return budget.scope === 'shared' ? roleAtLeast(member.role, 'manager') : budget.ownerSubject === member.subject;
}

function validLines(lines, currency, doc) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) throw badRequest('A budget needs between 1 and 100 category lines.', 'invalid_budget');
  const categories = new Set((doc.categories || []).map((c) => c.id));
  const seen = new Set();
  return lines.map((l, i) => {
    if (!l || typeof l !== 'object') throw badRequest(`Line ${i + 1} is not valid.`, 'invalid_budget');
    fields.onlyKeys(l, ['categoryId', 'amount', 'rollover']);
    const categoryId = requireId(l.categoryId, `Line ${i + 1} category`);
    if (!categories.has(categoryId)) throw badRequest(`Line ${i + 1} category does not exist.`, 'invalid_category');
    if (seen.has(categoryId)) throw badRequest('Each category can appear once per budget.', 'invalid_budget');
    seen.add(categoryId);
    const amountMinor = money.parseDecimal(l.amount, currency, `Line ${i + 1} amount`);
    if (amountMinor < 0) throw badRequest('Planned amounts cannot be negative.', 'invalid_amount');
    return { categoryId, amountMinor, rollover: fields.bool(l.rollover, 'Rollover') };
  });
}

function view(doc, budget, member, today, now) {
  return {
    id: budget.id, name: budget.name, scope: budget.scope, currency: budget.currency, period: budget.period, startDate: budget.startDate,
    revision: budget.revision, ownedBySelf: budget.ownerSubject === member.subject, canEdit: mayEdit(budget, member),
    lines: budget.lines.map((l) => ({ categoryId: l.categoryId, amount: money.toDecimal(l.amountMinor, budget.currency), rollover: l.rollover })),
    status: budgeting.budgetStatus(doc, budget, today, now),
  };
}

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  const today = fields.date(query(req, 'date'), 'Date') || ctx.nowIso().slice(0, 10);
  const budgets = (doc.budgets || []).filter((b) => visibleTo(b, member)).map((b) => view(doc, b, member, today, ctx.now()));
  return { body: { budgets, today } };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'scope', 'currency', 'period', 'startDate', 'lines']);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const scope = fields.oneOf(body.scope, ['shared', 'private'], 'Scope', 'private');
    if (scope === 'shared' && !roleAtLeast(member.role, 'manager')) throw forbidden('Only owners and managers can create shared budgets.');
    const currency = body.currency || (doc.settings && doc.settings.reportingCurrency) || 'EUR';
    money.precisionOf(currency);
    const nowIso = ctx.nowIso();
    const budget = {
      id: newId('bud'), name: fields.text(body.name, { field: 'Name', max: 80, required: true }), scope, currency,
      period: fields.oneOf(body.period, PERIODS, 'Period', 'monthly'),
      startDate: fields.date(body.startDate, 'Start date') || `${nowIso.slice(0, 7)}-01`,
      lines: validLines(body.lines, currency, doc), ownerSubject: member.subject, createdBy: member.subject, createdAt: nowIso, revision: 1, deletedAt: null,
    };
    doc.budgets = [...(doc.budgets || []), budget];
    audit.record(doc, { actor: member.subject, action: 'budget.create', targetType: 'budget', targetId: budget.id, scope: scope === 'shared' ? 'members' : `self:${member.subject}`, at: nowIso });
    return { budget: view(doc, budget, member, nowIso.slice(0, 10), ctx.now()) };
  });
  return { status: 201, body: result };
}

function locate(doc, member, id) {
  const b = (doc.budgets || []).find((x) => x.id === id);
  if (!b || !visibleTo(b, member)) throw notFound('Unknown budget.');
  if (!mayEdit(b, member)) throw forbidden('You cannot change this budget.');
  return b;
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['budgetId', 'revision', 'name', 'lines', 'period', 'startDate']);
  const id = requireId(body.budgetId, 'budgetId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const b = locate(doc, member, id);
    if (body.revision !== b.revision) throw conflict('This budget changed since you loaded it. Reload to see the latest version.', 'stale_revision');
    const changed = [];
    if (body.name !== undefined) { b.name = fields.text(body.name, { field: 'Name', max: 80, required: true }); changed.push('name'); }
    if (body.lines !== undefined) { b.lines = validLines(body.lines, b.currency, doc); changed.push('lines'); }
    if (body.period !== undefined) { b.period = fields.oneOf(body.period, PERIODS, 'Period'); changed.push('period'); }
    if (body.startDate !== undefined) { b.startDate = fields.date(body.startDate, 'Start date', { required: true }); changed.push('startDate'); }
    if (changed.length) {
      b.revision += 1;
      b.updatedAt = ctx.nowIso();
      audit.record(doc, { actor: member.subject, action: 'budget.update', targetType: 'budget', targetId: b.id, scope: b.scope === 'shared' ? 'members' : `self:${member.subject}`, at: ctx.nowIso(), fields: changed });
    }
    return { budget: view(doc, b, member, ctx.nowIso().slice(0, 10), ctx.now()) };
  });
  return { body: result };
}

async function remove(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['budgetId', 'revision']);
  const id = requireId(body.budgetId, 'budgetId');
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const b = locate(doc, member, id);
    if (body.revision !== b.revision) throw conflict('This budget changed since you loaded it.', 'stale_revision');
    b.deletedAt = ctx.nowIso();
    b.revision += 1;
    audit.record(doc, { actor: member.subject, action: 'budget.delete', targetType: 'budget', targetId: b.id, scope: b.scope === 'shared' ? 'members' : `self:${member.subject}`, at: ctx.nowIso() });
    return { removed: b.id };
  }, { allowHeadroom: true });
  return { body: result };
}

module.exports = { GET: list, POST: create, PATCH: patch, DELETE: remove };
