'use strict';
// /api/preferences — the caller's own preferences only. No route reads anyone else's.
//   GET   { stored, effective, sources, locked }
//   PUT   partial update; null clears a value back to the inherited default
// Effective values are computed on read: personal choice → site default → built-in default.
// A site-locked key cannot be overridden, and the source of each value is reported so the UI
// can show inherited / customized / locked.
const { readBody, badRequest, forbidden } = require('../_shared/http');
const { isSafeId } = require('../_shared/ids');
const store = require('../_shared/store');
const site = require('../_shared/site');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const colors = require('../_shared/colors');

// Personal category colours (BT-011-04): { <categoryId>: "#rrggbb" }, validated like workspace
// colours. Keys must be category ids, so no key can reach an object's prototype.
function categoryColors(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('Category colours must be an object.', 'invalid_field');
  const entries = Object.entries(v);
  if (entries.length > 500) throw badRequest('Too many category colours.', 'invalid_field');
  const out = {};
  for (const [id, hex] of entries) {
    if (!/^cat_[A-Za-z0-9_-]{1,64}$/.test(id)) throw badRequest('Category id is not valid.', 'invalid_id');
    out[id] = colors.validateColor(hex, 'Category colour');
  }
  return out;
}

const VALIDATORS = {
  themeMode: (v) => fields.oneOf(v, site.THEME_MODES, 'Theme mode'),
  themePalette: (v) => fields.oneOf(v, site.PALETTES, 'Theme palette'),
  editorToolbar: (v) => fields.oneOf(v, site.EDITOR_TOOLBARS, 'Editor toolbar'),
  locale: (v) => { if (typeof v !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(v)) throw badRequest('Locale is not valid.', 'invalid_field'); return v; },
  timeZone: (v) => { if (typeof v !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(v) || v.length > 60) throw badRequest('Time zone is not valid.', 'invalid_field'); return v; },
  dateFormat: (v) => fields.oneOf(v, ['iso', 'dmy', 'mdy'], 'Date format'),
  numberFormat: (v) => fields.oneOf(v, ['1,234.56', '1.234,56', '1 234,56'], 'Number format'),
  displayCurrency: (v) => { money.precisionOf(v); return v; },
  balanceMasking: (v) => fields.bool(v, 'Balance masking'),
  defaultWorkspaceId: (v) => { if (!isSafeId(v)) throw badRequest('Workspace id is not valid.', 'invalid_id'); return v; },
  dashboardWidgets: (v) => {
    const allowed = ['balances', 'upcoming', 'budgets', 'recent', 'debts', 'goals', 'forecast', 'settlements', 'trips'];
    if (!Array.isArray(v) || v.length > allowed.length || !v.every((w) => allowed.includes(w))) throw badRequest('Dashboard widgets are not valid.', 'invalid_field');
    return [...new Set(v)];
  },
  favoritePayees: (v) => { if (!Array.isArray(v) || v.length > 50 || !v.every(isSafeId)) throw badRequest('Favourite payees are not valid.', 'invalid_field'); return [...new Set(v)]; },
  categoryColors,
};
const BUILT_IN = { locale: 'en', timeZone: 'UTC', dateFormat: 'iso', numberFormat: '1,234.56', displayCurrency: null, balanceMasking: false, defaultWorkspaceId: null, dashboardWidgets: ['balances', 'upcoming', 'budgets', 'recent'], favoritePayees: [], categoryColors: {} };

function resolve(stored, siteDoc) {
  const effective = {};
  const sources = {};
  for (const key of Object.keys(VALIDATORS)) {
    const locked = (siteDoc.locked || []).includes(key);
    const siteValue = siteDoc.defaults ? siteDoc.defaults[key] : undefined;
    if (!locked && stored[key] !== undefined && stored[key] !== null) { effective[key] = stored[key]; sources[key] = 'personal'; }
    else if (siteValue !== undefined) { effective[key] = siteValue; sources[key] = locked ? 'locked' : 'site'; }
    else { effective[key] = BUILT_IN[key] !== undefined ? BUILT_IN[key] : null; sources[key] = 'default'; }
  }
  return { effective, sources };
}

async function get(ctx) {
  const user = await store.ensureUser(ctx);
  const { site: siteDoc } = await site.readSite(ctx.storage);
  const stored = user.preferences || {};
  return { body: { stored, ...resolve(stored, siteDoc), locked: siteDoc.locked || [] } };
}

async function put(ctx, req) {
  const body = readBody(req);
  fields.onlyKeys(body, Object.keys(VALIDATORS));
  const { site: siteDoc } = await site.readSite(ctx.storage);
  for (const key of Object.keys(body)) {
    if ((siteDoc.locked || []).includes(key)) throw forbidden(`${key} is set by the site and cannot be changed personally.`);
  }
  const clean = {};
  for (const [key, value] of Object.entries(body)) clean[key] = value === null ? null : VALIDATORS[key](value);
  const stored = await store.mutateUser(ctx, (user) => {
    const prefs = { ...(user.preferences || {}) };
    for (const [key, value] of Object.entries(clean)) { if (value === null) delete prefs[key]; else prefs[key] = value; }
    user.preferences = prefs;
    return prefs;
  });
  return { body: { stored, ...resolve(stored, siteDoc), locked: siteDoc.locked || [] } };
}

module.exports = { GET: get, PUT: put, _resolve: resolve };
