'use strict';
// The real, site-wide workspace-layout catalogue (BT-013-16). Modelled directly on the icon
// catalogue (api/_shared/icons.js, BT-011-05): layouts are retired, never deleted — a retired layout
// leaves every picker for NEW selection but keeps rendering wherever a workspace already applies it.
// `site/layouts.json` holds only the site-wide retirement state and its audit trail; it is never
// financial data and never references a specific workspace.
//
// This is deliberately separate from a WORKSPACE's own choices:
//   - `doc.hiddenLayouts` (workspace document field, this module's `validateHide`) is "Remove from
//     this workspace's choices" — hides an option for one workspace only, always restorable, and
//     `classic` (the one SYSTEM entry) can never be hidden, so a reliable fallback always remains.
//   - `doc.settings.layoutColors` (this module's `validateLayoutColors`) is the workspace-DEFAULT
//     colour scheme per layout (manager+), stored beside `typeIcons`/`categoryColors`-style settings-
//     adjacent values rather than the generic SETTINGS allowlist, since its shape is a nested object
//     per layout id, not one of the allowlist's scalar/set types. The PERSONAL colour override reuses
//     the already-real `galleryDesignColors` preference (api/preferences/handler.js) against these
//     same ids — no new personal-preference mechanism.
//   - `layoutId` itself (api/_shared/workspace-settings.js) is the workspace's actually-applied
//     choice, changed through the existing `PATCH /api/workspaces?id=`. Its generic shape (one of the
//     four known ids) is enforced there; the extra business rule — a site-retired or
//     workspace-hidden id may not be newly chosen, though an already-applied value always stays
//     accepted — is layered on in api/workspaces/handler.js `patch()`, using `isSelectable` below,
//     the same layered pattern `reportingCurrency` already uses for its own extra rule.
const { badRequest, notFound } = require('./http');
const { readDocument, stampDocument } = require('./schema');
const colors = require('./colors');
const { REAL_LAYOUT_OPTIONS, findConcept } = require('./layouts');

const BUILT_IN_IDS = Object.freeze(REAL_LAYOUT_OPTIONS.map((o) => o.value));
// `classic` is the application's own existing implicit layout, never backed by a Gallery concept and
// never retirable or hideable — Terry's "Classic remains available as the fallback" (item 5).
const SYSTEM = Object.freeze(new Set(['classic']));
// The three flagship ids ALSO have a Gallery concept (name, accentLight/accentDark, tagline) to draw
// a real card from; `classic` does not, and is described here instead.
const CLASSIC_META = Object.freeze({ id: 'classic', name: 'Classic (current)', tagline: 'The application\'s existing layout: today\'s navigation, density and dashboard, unchanged.' });
function metaFor(id) {
  if (id === 'classic') return CLASSIC_META;
  const c = findConcept(id);
  return c ? { id, name: c.name, tagline: c.tagline, accentLight: c.accentLight, accentDark: c.accentDark } : { id, name: id };
}
const BUILT_IN = Object.freeze(BUILT_IN_IDS.map((id) => Object.freeze({ id, system: SYSTEM.has(id), ...metaFor(id) })));
// Layouts a workspace may colour-customize a DEFAULT scheme for: every real layout except `classic`,
// which is not a Gallery concept and has no accent-colour identity of its own (it uses the existing
// application-wide theme picker instead).
const COLORABLE_IDS = Object.freeze(BUILT_IN_IDS.filter((id) => id !== 'classic'));

const PATH = 'site/layouts.json';

async function readCatalog(storage) {
  const { value, etag } = await storage.getJson(PATH);
  const doc = readDocument('site', value);
  return { catalog: { retired: [], audit: [], ...(doc || {}) }, etag };
}
const stamp = (catalog) => stampDocument('site', catalog);

// A built-in layout may be newly chosen unless it has been retired (SYSTEM entries can never be
// retired in the first place, so `classic` is always selectable).
function isSelectable(catalog, id) {
  if (!BUILT_IN_IDS.includes(id)) return false;
  return SYSTEM.has(id) || !(catalog.retired || []).includes(id);
}

// The extra business rule layered onto `layoutId` in api/workspaces/handler.js `patch()`. The
// generic shape (one of the four known ids) is already enforced by workspace-settings.js's own
// `valid()`; this only refuses a NEWLY chosen id that is currently retired. The value already
// applied to a workspace is always re-accepted, exactly like validateChoice in icons.js — a retired
// layout keeps rendering wherever it is already used, it only leaves the picker.
function validateChoice(catalog, value, { current = null } = {}) {
  if (value === current) return value;
  if (!isSelectable(catalog, value)) throw badRequest('This layout has been retired by the site administrator and cannot be newly applied. Choose another layout.', 'layout_retired');
  return value;
}

function catalogView(catalog) {
  const retired = new Set(catalog.retired || []);
  return BUILT_IN.map((l) => ({ ...l, retired: retired.has(l.id), selectable: l.system || !retired.has(l.id) }));
}

// ---- per-workspace "Remove from this workspace's choices" (doc.hiddenLayouts) --------------------

// `classic` can never be hidden (Terry: "Classic remains available as the fallback"); a currently-
// applied layout may still be hidden (it stops being OFFERED for new selection, exactly like a
// retired one) but stays applied until something else is chosen.
function validateHideTarget(id) {
  if (!BUILT_IN_IDS.includes(id)) throw notFound('Unknown layout.');
  if (SYSTEM.has(id)) throw badRequest('Classic is the reliable fallback and cannot be removed from this workspace\'s choices.', 'layout_system');
  return id;
}

// ---- workspace-default colour scheme per layout (doc.settings.layoutColors) ----------------------
// Same shape and same >=3:1 non-text-contrast rule as the personal `galleryDesignColors` preference
// (api/preferences/handler.js) — checked against each mode's real surface respectively, so a manager
// can never save a combination unreadable in the mode it is shown in.
function accentHex(value, surface, field) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw badRequest(`${field} must be a colour written like #3b82f6.`, 'invalid_color');
  const hex = value.toLowerCase();
  if (colors.contrast(hex, surface) < colors.MIN_CONTRAST) throw badRequest(`${field} is too close to its own background to read clearly. Choose a stronger colour.`, 'color_contrast');
  return hex;
}
function validateLayoutColorEntry(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw badRequest('Layout colour entry is not valid.', 'invalid_field');
  const entry = {};
  if (cfg.light !== undefined && cfg.light !== null) entry.light = accentHex(cfg.light, colors.SURFACES[0], 'Layout colour (light mode)');
  if (cfg.dark !== undefined && cfg.dark !== null) entry.dark = accentHex(cfg.dark, colors.SURFACES[1], 'Layout colour (dark mode)');
  if (cfg.preset !== undefined && cfg.preset !== null) {
    if (typeof cfg.preset !== 'string' || cfg.preset.length > 40 || !/^[a-z0-9-]+$/.test(cfg.preset)) throw badRequest('Preset id is not valid.', 'invalid_field');
    entry.preset = cfg.preset;
  }
  return entry;
}
function validateLayoutId(id) {
  if (!COLORABLE_IDS.includes(id)) throw badRequest('This layout does not support a workspace colour scheme.', 'invalid_layout');
  return id;
}

module.exports = {
  BUILT_IN_IDS, BUILT_IN, SYSTEM, COLORABLE_IDS, PATH,
  readCatalog, stamp, isSelectable, validateChoice, catalogView,
  validateHideTarget, validateLayoutColorEntry, validateLayoutId,
};
