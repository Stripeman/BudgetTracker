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
const { CONCEPT_IDS } = require('../_shared/layouts');

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

// Personal account/merchant type colours and icons (BT-024, Terry 2026-09-23: parity with
// categories above — the same personal-override mechanism, id prefix and validation, applied to
// the other two workspace-scoped type registries (BT-019-02/03). Never touches the workspace's own
// type record; never seen by anyone else.
function typeColors(prefix, fieldLabel) {
  return (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${fieldLabel} colours must be an object.`, 'invalid_field');
    const entries = Object.entries(v);
    if (entries.length > 500) throw badRequest(`Too many ${fieldLabel.toLowerCase()} colours.`, 'invalid_field');
    const out = {};
    const re = new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,64}$`);
    for (const [id, hex] of entries) {
      if (!re.test(id)) throw badRequest(`${fieldLabel} id is not valid.`, 'invalid_id');
      out[id] = colors.validateColor(hex, `${fieldLabel} colour`);
    }
    return out;
  };
}
function typeIcons(prefix, fieldLabel, storedKey) {
  return (v, { catalog, stored }) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${fieldLabel} icons must be an object.`, 'invalid_field');
    const entries = Object.entries(v);
    if (entries.length > 500) throw badRequest(`Too many ${fieldLabel.toLowerCase()} icons.`, 'invalid_field');
    const before = (stored && stored[storedKey]) || {};
    const out = {};
    const re = new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,64}$`);
    for (const [id, icon] of entries) {
      if (!re.test(id)) throw badRequest(`${fieldLabel} id is not valid.`, 'invalid_id');
      if (icon === null) throw badRequest(`Leave a ${fieldLabel.toLowerCase()} out to use the workspace icon.`, 'invalid_icon');
      out[id] = icons.validateChoice(catalog, icon, { current: Object.prototype.hasOwnProperty.call(before, id) ? before[id] : null, field: `${fieldLabel} icon` });
    }
    return out;
  };
}
const accountTypeColors = typeColors('atype', 'Account type');
const accountTypeIcons = typeIcons('atype', 'Account type', 'accountTypeIcons');
const merchantTypeColors = typeColors('mtype', 'Merchant type');
const merchantTypeIcons = typeIcons('mtype', 'Merchant type', 'merchantTypeIcons');

// Per-design Gallery colour customization (BT-013-15, Terry 2026-09-20): a site administrator's OWN
// personal preference only — never a workspace setting, never seen by or applied to anyone else, and
// never touching a real workspace's own layout. `{ <conceptId>: { light, dark, preset } }`. `light`/
// `dark` each get the SAME >=3:1 non-text-contrast bar the Gallery's own built-in accentLight/
// accentDark pairs already hold (api/_shared/layouts.js, app/test/gallerypatterns.test.js) — checked
// against the real light surface and the real dark surface RESPECTIVELY (never both, since each hex
// is only ever used in its own mode), so a person can never save a combination that would be
// unreadable in the mode it is actually shown in; the specific problem is explained back, never a
// silent rejection. `preset` is a purely cosmetic label (which preset currently matches, for
// highlighting in the picker) and never affects rendering — a stale value after presets change is
// harmless, so it only needs a safe shape, not a fixed enum.
function galleryAccentHex(value, surface, field) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw badRequest(`${field} must be a colour written like #3b82f6.`, 'invalid_color');
  const hex = value.toLowerCase();
  if (colors.contrast(hex, surface) < colors.MIN_CONTRAST) throw badRequest(`${field} is too close to its own background to read clearly. Choose a stronger colour.`, 'color_contrast');
  return hex;
}
function galleryDesignColors(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('Gallery design colours must be an object.', 'invalid_field');
  const entries = Object.entries(v);
  if (entries.length > CONCEPT_IDS.length) throw badRequest('Too many gallery design colours.', 'invalid_field');
  const out = {};
  for (const [id, cfg] of entries) {
    if (!CONCEPT_IDS.includes(id)) throw badRequest('Gallery concept id is not valid.', 'invalid_id');
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw badRequest('Gallery design colour entry is not valid.', 'invalid_field');
    const entry = {};
    if (cfg.light !== undefined && cfg.light !== null) entry.light = galleryAccentHex(cfg.light, colors.SURFACES[0], 'Design accent colour (light mode)');
    if (cfg.dark !== undefined && cfg.dark !== null) entry.dark = galleryAccentHex(cfg.dark, colors.SURFACES[1], 'Design accent colour (dark mode)');
    if (cfg.preset !== undefined && cfg.preset !== null) {
      if (typeof cfg.preset !== 'string' || cfg.preset.length > 40 || !/^[a-z0-9-]+$/.test(cfg.preset)) throw badRequest('Preset id is not valid.', 'invalid_field');
      entry.preset = cfg.preset;
    }
    if (Object.keys(entry).length) out[id] = entry;
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
  accountTypeColors,
  accountTypeIcons,
  merchantTypeColors,
  merchantTypeIcons,
  galleryDesignColors,
  // The staging (preview) site's address, opened from the account menu (BT-011-06). The app never
  // hard-codes it: each person sets it, or inherits the site default. Stored normalised; http to a
  // loopback host only while the API runs in local development.
  stagingUrl: (v, extra) => fields.webAddress(v, 'Staging link', { localHttp: !!(extra && extra.localHttp) }),
  // Each person's own defaults for Shared expenses (BT-009, Terry 2026-09-14). Not set (null) means the
  // group's setting; the balance view not set means Fewest payments.
  groupSplitMethod: (v) => fields.oneOf(v, ['equal', 'amounts', 'percentages', 'shares'], 'Default split'),
  groupSplitWho: (v) => fields.oneOf(v, ['everyone', 'me'], 'Who shares by default'),
  groupPaidBy: (v) => fields.oneOf(v, ['me', 'nobody'], 'Who paid by default'),
  groupBalanceView: (v) => fields.oneOf(v, ['suggested', 'direct'], 'Balance view'),
};
const BUILT_IN = { locale: 'en', timeZone: 'UTC', dateFormat: 'iso', numberFormat: '1,234.56', displayCurrency: null, balanceMasking: false, defaultWorkspaceId: null, dashboardWidgets: ['balances', 'upcoming', 'budgets', 'recent'], favoritePayees: [], categoryColors: {}, categoryIcons: {}, accountTypeColors: {}, accountTypeIcons: {}, merchantTypeColors: {}, merchantTypeIcons: {}, galleryDesignColors: {}, stagingUrl: null };

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
    const doc = readDocument('workspace', value);
    if (doc && doc.status !== 'archived' && activeMember(doc, ctx.principal)) return true;
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
  const needsCatalog = ['categoryIcons', 'accountTypeIcons', 'merchantTypeIcons'].some((k) => body[k] !== undefined && body[k] !== null);
  if (needsCatalog) {
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
