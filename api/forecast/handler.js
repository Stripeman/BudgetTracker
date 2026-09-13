'use strict';
// /api/forecast?workspaceId=&horizon=30|60|90|365&buffer=&bufferCurrency=
//   GET                     the baseline projection (expected, conservative, optimistic)
//   POST ?action=scenario   { horizon?, buffer?, bufferCurrency?, changes:[...] }  what-if
//                           changes applied in memory only — NOTHING is saved (non-mutating)
// Only accounts whose balance the caller may see are projected; upcoming items are included only
// for accounts whose entries the caller may also see.
const { readBody, query, badRequest, notFound } = require('../_shared/http');
const { requireId } = require('../_shared/ids');
const { can } = require('../_shared/authz');
const store = require('../_shared/store');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const budgeting = require('../_shared/budgeting');

const HORIZONS = [30, 60, 90, 365];

function options(ctx, doc, src) {
  const horizonDays = src.horizon === undefined ? 90 : Number(src.horizon);
  if (!HORIZONS.includes(horizonDays)) throw badRequest(`Horizon must be one of ${HORIZONS.join(', ')} days.`, 'invalid_horizon');
  let bufferMinor = null;
  let bufferCurrency = null;
  if (src.buffer !== undefined && src.buffer !== null && src.buffer !== '') {
    bufferCurrency = src.bufferCurrency || (doc.settings && doc.settings.reportingCurrency) || 'EUR';
    bufferMinor = money.parseDecimal(String(src.buffer), bufferCurrency, 'Buffer');
  }
  return { today: ctx.nowIso().slice(0, 10), horizonDays, bufferMinor, bufferCurrency, now: ctx.now() };
}

async function get(ctx, req) {
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const opts = options(ctx, doc, { horizon: query(req, 'horizon'), buffer: query(req, 'buffer'), bufferCurrency: query(req, 'bufferCurrency') });
  return { body: { forecast: budgeting.forecast(doc, ctx.principal, opts), scenario: false } };
}

function validChanges(doc, principal, changes, now) {
  if (changes === undefined) return [];
  if (!Array.isArray(changes) || changes.length > 50) throw badRequest('Changes must be a list of at most 50 items.', 'invalid_scenario');
  return changes.map((c, i) => {
    if (!c || typeof c !== 'object') throw badRequest(`Change ${i + 1} is not valid.`, 'invalid_scenario');
    const type = fields.oneOf(c.type, ['one-off', 'change-recurring', 'exclude-recurring'], `Change ${i + 1} type`);
    if (type === 'one-off') {
      fields.onlyKeys(c, ['type', 'accountId', 'date', 'amount']);
      const a = (doc.accounts || []).find((x) => x.id === c.accountId && !x.deletedAt);
      if (!a || !can(doc, principal, a, 'view-balances', now)) throw notFound('Unknown account.');
      return { type, accountId: a.id, date: fields.date(c.date, 'Date', { required: true }), amountMinor: money.parseDecimal(c.amount, a.currency, 'Amount') };
    }
    fields.onlyKeys(c, type === 'change-recurring' ? ['type', 'recurringId', 'amount'] : ['type', 'recurringId']);
    const r = (doc.recurring || []).find((x) => x.id === c.recurringId && !x.deletedAt);
    const a = r && (doc.accounts || []).find((x) => x.id === r.accountId);
    if (!r || !a || !can(doc, principal, a, 'view-transactions', now)) throw notFound('Unknown commitment.');
    return type === 'change-recurring' ? { type, recurringId: r.id, amountMinor: money.parseDecimal(c.amount, r.currency, 'Amount') } : { type, recurringId: r.id };
  });
}

async function post(ctx, req) {
  if (query(req, 'action') !== 'scenario') throw notFound();
  const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
  const body = fields.onlyKeys(readBody(req), ['horizon', 'buffer', 'bufferCurrency', 'changes']);
  const { doc } = await store.loadWorkspace(ctx, wsId);
  const opts = options(ctx, doc, body);
  const adjustments = validChanges(doc, ctx.principal, body.changes, opts.now);
  return { body: { forecast: budgeting.forecast(doc, ctx.principal, { ...opts, adjustments }), scenario: true, saved: false } };
}

module.exports = { GET: get, POST: post };
