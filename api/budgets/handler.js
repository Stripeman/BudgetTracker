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
const ledger = require('../_shared/ledger');
const icons = require('../_shared/icons');
const workspaceSettings = require('../_shared/workspace-settings');

const PERIODS = ['monthly', 'weekly', 'biweekly'];
// The icon catalogue is read only when an icon is being chosen (BT-011-05).
const catalogFor = async (ctx, body) => (body.icon !== undefined ? (await icons.readCatalog(ctx.storage)).catalog : null);

// Budgets are archived, never deleted (BT-001-05): `deletedAt` marks an archived budget, which is
// listed with includeArchived=1 and can be restored.
function visibleTo(budget, member, { archived = false } = {}) {
  return (archived || !budget.deletedAt) && (budget.scope === 'shared' || budget.ownerSubject === member.subject);
}

// Before/after values of every change to the budget itself, with who, when and why. The plan has
// its own versions.
function recordHistory(b, by, at, changes, reason = '') {
  if (!changes.length) return;
  b.history = [...(b.history || []), { at, by, changes, reason }];
}
// A shared budget: whoever manages the workspace's shared lists (workspace setting, Terry 2026-09-14);
// a private budget: its owner only.
function mayEdit(doc, budget, member) {
  return budget.scope === 'shared' ? workspaceSettings.managesSharedLists(doc, member) : budget.ownerSubject === member.subject;
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
  const terms = budgeting.budgetTermsAt(budget, today);
  const names = new Map((doc.members || []).map((m) => [m.subject, m.name || 'Member']));
  const lineView = (l) => ({ categoryId: l.categoryId, amount: money.toDecimal(l.amountMinor, budget.currency), rollover: l.rollover });
  return {
    id: budget.id, name: budget.name, scope: budget.scope, currency: budget.currency, period: terms.period, startDate: terms.startDate,
    ...icons.effective('budget', budget, doc),
    revision: budget.revision, ownedBySelf: budget.ownerSubject === member.subject, canEdit: mayEdit(doc, budget, member),
    archived: !!budget.deletedAt, archivedAt: budget.deletedAt || null, archiveReason: budget.archiveReason || '',
    history: (budget.history || []).map((h) => ({ at: h.at, by: names.get(h.by) || 'Former member', changes: h.changes, reason: h.reason || '' })),
    lines: terms.lines.map(lineView),
    versions: (budget.versions || []).map((v) => ({ effectiveFrom: v.effectiveFrom, period: v.period, reason: v.reason || '', backdated: !!v.backdated, by: v.createdBy ? names.get(v.createdBy) || 'Former member' : null, lines: v.lines.map(lineView) })),
    status: budgeting.budgetStatus(doc, budget, today, now),
  };
}

async function list(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc, member } = await store.loadWorkspace(ctx, wsId);
  const today = fields.date(query(req, 'date'), 'Date') || ctx.nowIso().slice(0, 10);
  const archived = query(req, 'includeArchived') === '1';
  const budgets = (doc.budgets || []).filter((b) => visibleTo(b, member, { archived })).map((b) => view(doc, b, member, today, ctx.now()));
  return { body: { budgets, today } };
}

async function create(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['name', 'scope', 'currency', 'period', 'startDate', 'lines', 'icon']);
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const scope = fields.oneOf(body.scope, ['shared', 'private'], 'Scope', 'private');
    if (scope === 'shared' && !workspaceSettings.managesSharedLists(doc, member)) throw forbidden(member.role === 'viewer' ? 'Viewers cannot create shared budgets.' : 'Only owners and managers can create shared budgets in this workspace.');
    const currency = body.currency || (doc.settings && doc.settings.reportingCurrency) || 'EUR';
    money.precisionOf(currency);
    const nowIso = ctx.nowIso();
    // The workspace's budget period and week start are the defaults for a new budget (workspace
    // settings, Terry 2026-09-14): monthly from the first of the month unless the workspace says
    // otherwise; weekly and two-weekly from the latest week-start day. What is sent always wins.
    const period = fields.oneOf(body.period, PERIODS, 'Period', workspaceSettings.get(doc, 'budgetPeriod'));
    const budget = {
      id: newId('bud'), name: fields.text(body.name, { field: 'Name', max: 80, required: true }), scope, currency,
      period,
      startDate: fields.date(body.startDate, 'Start date') || workspaceSettings.defaultBudgetStart(doc, period, nowIso.slice(0, 10)),
      lines: validLines(body.lines, currency, doc), ownerSubject: member.subject, createdBy: member.subject, createdAt: nowIso, revision: 1, deletedAt: null,
      icon: body.icon === undefined ? null : icons.validateChoice(catalog, body.icon),
    };
    budget.versions = [{ effectiveFrom: budget.startDate, period: budget.period, startDate: budget.startDate, lines: budget.lines, createdAt: nowIso, createdBy: member.subject, reason: '' }];
    doc.budgets = [...(doc.budgets || []), budget];
    ledger.assertMemberQuota(doc, member, ctx.env);
    audit.record(doc, { actor: member.subject, action: 'budget.create', targetType: 'budget', targetId: budget.id, scope: scope === 'shared' ? 'members' : `self:${member.subject}`, at: nowIso });
    return { budget: view(doc, budget, member, nowIso.slice(0, 10), ctx.now()) };
  });
  return { status: 201, body: result };
}

function locate(doc, member, id, { archived = false } = {}) {
  const b = (doc.budgets || []).find((x) => x.id === id);
  if (!b || !visibleTo(b, member, { archived })) throw notFound('Unknown budget.');
  if (!mayEdit(doc, b, member)) throw forbidden('You cannot change this budget.');
  return b;
}

async function patch(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['budgetId', 'revision', 'name', 'lines', 'period', 'startDate', 'effectiveFrom', 'confirmBackdate', 'reason', 'icon']);
  const id = requireId(body.budgetId, 'budgetId');
  const catalog = await catalogFor(ctx, body);
  const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
    const b = locate(doc, member, id);
    if (body.revision !== b.revision) throw conflict('This budget changed since you loaded it. Reload to see the latest version.', 'stale_revision');
    const changed = [];
    const details = [];
    if (body.name !== undefined) {
      const name = fields.text(body.name, { field: 'Name', max: 80, required: true });
      if (name !== b.name) { details.push({ field: 'name', from: b.name, to: name }); b.name = name; changed.push('name'); }
    }
    if (body.icon !== undefined) {
      const icon = icons.validateChoice(catalog, body.icon, { current: b.icon || null });
      if (icon !== (b.icon || null)) {
        // Before and after are kept (BT-001-05).
        b.iconHistory = [...(b.iconHistory || []), { at: ctx.nowIso(), by: member.subject, from: b.icon || null, to: icon }];
        details.push({ field: 'icon', from: b.icon || null, to: icon });
        b.icon = icon;
        changed.push('icon');
      }
    }
    recordHistory(b, member.subject, ctx.nowIso(), details, fields.text(body.reason, { field: 'Reason', max: 200 }));
    if (body.lines !== undefined || body.period !== undefined || body.startDate !== undefined) {
      // A plan change is a new version from a date — by default the start of the current period —
      // so earlier periods keep the plan they had (audit B13). Earlier versions are never edited.
      const today = ctx.nowIso().slice(0, 10);
      const current = budgeting.budgetTermsAt(b, today);
      const currentStart = budgeting.periodFor(current, today).start;
      const effectiveFrom = fields.date(body.effectiveFrom, 'Effective from') || currentStart;
      const v = {
        effectiveFrom, backdated: false,
        period: body.period !== undefined ? fields.oneOf(body.period, PERIODS, 'Period') : current.period,
        startDate: body.startDate !== undefined ? fields.date(body.startDate, 'Start date', { required: true }) : current.startDate,
        lines: body.lines !== undefined ? validLines(body.lines, b.currency, doc) : current.lines,
        createdAt: ctx.nowIso(), createdBy: member.subject, reason: fields.text(body.reason, { field: 'Reason', max: 200 }),
      };
      // A date before the current period rewrites periods that have finished (BT-001-05, audit B13;
      // FIN-R14). So does a new period type or start day whose first period begins before the change
      // takes effect: days already counted under the old periods would count again (FIN-T6). Either
      // needs an explicit confirmation, and the version is marked backdated. A change of amounts
      // alone keeps the periods, so any date within the current period or later needs none (FIN-U2).
      const firstNewStart = budgeting.periodFor(v, effectiveFrom).start;
      const newPeriods = v.period !== current.period || v.startDate !== current.startDate;
      v.backdated = effectiveFrom < currentStart || (newPeriods && firstNewStart < effectiveFrom);
      // A workspace may rule such changes out altogether ("Budget changes may apply to past periods:
      // Never"); confirming does not override it.
      if (v.backdated && workspaceSettings.get(doc, 'budgetBackdating') === 'never') {
        throw conflict(effectiveFrom < currentStart
          ? `This workspace does not let budget changes apply to periods that have finished. Start the change on ${currentStart} or later.`
          : `This workspace does not let budget changes apply to periods that have finished. With this period and start day, the period containing ${effectiveFrom} begins on ${firstNewStart}; start the change on a date where a new period begins, in the current period or later.`, 'backdate_off');
      }
      if (v.backdated && fields.bool(body.confirmBackdate, 'Confirm backdate') !== true) {
        throw conflict(effectiveFrom < currentStart
          ? `This change would apply from before the current period (which started ${currentStart}) and change periods that have finished. Confirm that this is intended.`
          : `With this period and start day, the period containing ${effectiveFrom} begins on ${firstNewStart}, before the change takes effect, so some days would count in two periods. Start the change on ${firstNewStart} or confirm that this is intended.`, 'backdate_unconfirmed');
      }
      if (!v.backdated) fields.bool(body.confirmBackdate, 'Confirm backdate');
      const base = b.versions && b.versions.length ? b.versions : [{ effectiveFrom: b.startDate, period: b.period, startDate: b.startDate, lines: b.lines }];
      b.versions = [...base, v];
      // The plan in force TODAY is mirrored at the top level for older readers — not simply the
      // version just added, which may be future-dated or backdated behind a later one (FIN-R14).
      const inForce = budgeting.budgetTermsAt(b, today);
      b.lines = inForce.lines;
      b.period = inForce.period;
      b.startDate = inForce.startDate;
      changed.push('plan');
    } else if (body.effectiveFrom !== undefined || body.confirmBackdate !== undefined) {
      throw badRequest('An effective date applies only to changes of the plan (lines, period or start).', 'invalid_field');
    }
    if (changed.length) {
      b.revision += 1;
      b.updatedAt = ctx.nowIso();
      ledger.assertMemberQuota(doc, member, ctx.env);
      audit.record(doc, { actor: member.subject, action: 'budget.update', targetType: 'budget', targetId: b.id, scope: b.scope === 'shared' ? 'members' : `self:${member.subject}`, at: ctx.nowIso(), fields: changed });
    }
    return { budget: view(doc, b, member, ctx.nowIso().slice(0, 10), ctx.now()) };
  });
  return { body: result };
}

// DELETE archives a budget (it leaves the list; its plan, versions and history stay) and
// POST ?action=restore brings it back. Both keep who, when and the optional reason.
function lifecycle(archive) {
  return async (ctx, req) => {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), ['budgetId', 'revision', 'reason']);
    const id = requireId(body.budgetId, 'budgetId');
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const b = locate(doc, member, id, { archived: !archive });
      if (body.revision !== b.revision) throw conflict('This budget changed since you loaded it.', 'stale_revision');
      if (!archive && !b.deletedAt) throw conflict('This budget is not archived.', 'not_archived');
      const nowIso = ctx.nowIso();
      const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
      recordHistory(b, member.subject, nowIso, [{ field: 'archived', from: !archive, to: archive }], reason);
      b.deletedAt = archive ? nowIso : null;
      b.deletedBy = archive ? member.subject : null;
      b.archiveReason = archive ? reason : '';
      b.revision += 1;
      audit.record(doc, { actor: member.subject, action: archive ? 'budget.delete' : 'budget.restore', targetType: 'budget', targetId: b.id, scope: b.scope === 'shared' ? 'members' : `self:${member.subject}`, at: nowIso });
      return archive ? { removed: b.id, archived: true } : { budget: view(doc, b, member, nowIso.slice(0, 10), ctx.now()) };
    }, { allowHeadroom: archive });
    return { body: result };
  };
}

async function post(ctx, req) {
  const action = query(req, 'action');
  if (action === undefined) return create(ctx, req);
  if (action === 'restore') return lifecycle(false)(ctx, req);
  throw notFound();
}

module.exports = { GET: list, POST: post, PATCH: patch, DELETE: lifecycle(true) };
