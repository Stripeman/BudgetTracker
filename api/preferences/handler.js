'use strict';
// /api/preferences — the caller's own preferences only. No route reads anyone else's.
//   GET   { stored, effective, sources, locked }
//   PUT   partial update; null clears a value back to the inherited default
// Effective values are computed on read: personal choice → site default → built-in default.
// A site-locked key cannot be set personally, and its source is ALWAYS reported as "locked" (with the
// site's value, or the built-in default when the site set none), so the UI never offers a change that
// would be refused. Clearing one's OWN stored value (null) is always allowed, even under a lock
// (security review of d363eff, finding 2).
// The site's staging-link default is shown only to site administrators and to active members of at
// least one workspace; everyone else gets it omitted (finding 1).
const { readBody, badRequest, forbidden } = require('../_shared/http');
const { isSafeId } = require('../_shared/ids');
const { readDocument } = require('../_shared/schema');
const { activeMember } = require('../_shared/authz');
const { localDevelopment } = require('../_shared/version');
const store = require('../_shared/store');
const site = require('../_shared/site');
const money = require('../_shared/money');
const fields = require('../_shared/fields');
const colors = require('../_shared/colors');
const icons = require('../_shared/icons');

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

// Personal category icons (BT-011-05): { <categoryId>: <iconId> }, validated against the catalogue.
// An icon already in the person's preferences stays accepted even if it was later switched off.
function categoryIcons(v, { catalog, stored }) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('Category icons must be an object.', 'invalid_field');
  const entries = Object.entries(v);
  if (entries.length > 500) throw badRequest('Too many category icons.', 'invalid_field');
  const before = (stored && stored.categoryIcons) || {};
  const out = {};
  for (const [id, icon] of entries) {
    if (!/^cat_[A-Za-z0-9_-]{1,64}$/.test(id)) throw badRequest('Category id is not valid.', 'invalid_id');
    if (icon === null) throw badRequest('Leave a category out to use the workspace icon.', 'invalid_icon');
    out[id] = icons.validateChoice(catalog, icon, { current: Object.prototype.hasOwnProperty.call(before, id) ? before[id] : null, field: 'Category icon' });
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
  categoryIcons,
  // The staging (preview) site's address, opened from the account menu (BT-011-06). The app never
  // hard-codes it: each person sets it, or inherits the site default. Stored normalised; http to a
  // loopback host only while the API runs in local development.
  stagingUrl: (v, extra) => fields.webAddress(v, 'Staging link', { localHttp: !!(extra && extra.localHttp) }),
};
const BUILT_IN = { locale: 'en', timeZone: 'UTC', dateFormat: 'iso', numberFormat: '1,234.56', displayCurrency: null, balanceMasking: false, defaultWorkspaceId: null, dashboardWidgets: ['balances', 'upcoming', 'budgets', 'recent'], favoritePayees: [], categoryColors: {}, categoryIcons: {}, stagingUrl: null };

function resolve(stored, siteDoc) {
  const effective = {};
  const sources = {};
  for (const key of Object.keys(VALIDATORS)) {
    const locked = (siteDoc.locked || []).includes(key);
    const siteValue = siteDoc.defaults ? siteDoc.defaults[key] : undefined;
    const builtIn = BUILT_IN[key] !== undefined ? BUILT_IN[key] : null;
    if (locked) { effective[key] = siteValue !== undefined ? siteValue : builtIn; sources[key] = 'locked'; }
    else if (stored[key] !== undefined && stored[key] !== null) { effective[key] = stored[key]; sources[key] = 'personal'; }
    else if (siteValue !== undefined) { effective[key] = siteValue; sources[key] = 'site'; }
    else { effective[key] = builtIn; sources[key] = 'default'; }
  }
  return { effective, sources };
}

// Whether this caller may see the site's staging-link default: a site administrator, or an active
// member of at least one workspace. Reads the person's document and workspaces without writing.
async function seesSiteStaging(ctx, user) {
  if (ctx.siteAdmin) return true;
  const doc = user || readDocument('user', (await ctx.storage.getJson(store.paths.user(ctx.principal.subject))).value);
  for (const id of (doc && doc.workspaceIds) || []) {
    const { value } = await ctx.storage.getJson(store.paths.workspace(id));
    if (activeMember(readDocument('workspace', value), ctx.principal)) return true;
  }
  return false;
}

// The site settings as this signed-in caller may see them.
async function siteFor(ctx, siteDoc, user) {
  return (await seesSiteStaging(ctx, user)) ? siteDoc : site.withoutStagingDefault(siteDoc);
}

async function get(ctx) {
  const user = await store.ensureUser(ctx);
  const { site: siteDoc } = await site.readSite(ctx.storage);
  const visible = await siteFor(ctx, siteDoc, user);
  const stored = user.preferences || {};
  return { body: { stored, ...resolve(stored, visible), locked: siteDoc.locked || [] } };
}

async function put(ctx, req) {
  const body = readBody(req);
  fields.onlyKeys(body, Object.keys(VALIDATORS));
  const { site: siteDoc } = await site.readSite(ctx.storage);
  // A locked key cannot be SET personally; clearing one's own stored value (null) is always allowed.
  for (const [key, value] of Object.entries(body)) {
    if (value !== null && (siteDoc.locked || []).includes(key)) throw forbidden(`${key} is set by the site and cannot be changed personally.`);
  }
  const extra = { localHttp: localDevelopment(ctx.env || {}) };
  if (body.categoryIcons !== undefined && body.categoryIcons !== null) {
    extra.catalog = (await icons.readCatalog(ctx.storage)).catalog;
    extra.stored = (await store.ensureUser(ctx)).preferences || {};
  }
  const clean = {};
  for (const [key, value] of Object.entries(body)) clean[key] = value === null ? null : VALIDATORS[key](value, extra);
  const stored = await store.mutateUser(ctx, (user) => {
    const prefs = { ...(user.preferences || {}) };
    for (const [key, value] of Object.entries(clean)) { if (value === null) delete prefs[key]; else prefs[key] = value; }
    user.preferences = prefs;
    return prefs;
  });
  const visible = await siteFor(ctx, siteDoc);
  return { body: { stored, ...resolve(stored, visible), locked: siteDoc.locked || [] } };
}

module.exports = { GET: get, PUT: put, _resolve: resolve, _siteFor: siteFor };
