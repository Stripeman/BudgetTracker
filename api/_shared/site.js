'use strict';
// Operational site settings. These never contain financial data and grant no financial access.
const { readDocument, stampDocument } = require('./schema');
const { paths } = require('./store');

const THEME_MODES = ['system', 'light', 'dark'];
const PALETTES = ['midnight', 'slate', 'forest', 'solar', 'teal', 'rose', 'amber', 'indigo'];
const EDITOR_TOOLBARS = ['simple', 'advanced', 'custom'];

const DEFAULT_SITE = Object.freeze({
  branding: { name: 'BudgetTracker' },
  defaults: { themeMode: 'system', themePalette: 'midnight', editorToolbar: 'simple', dateFormat: 'iso', locale: 'en' },
  locked: [],
  modules: { sharedExpenses: true, trips: true, forecasting: true, imports: true },
  publicSharingEnabled: false,
  invitationPolicy: 'owners-and-managers',
  uploadLimitBytes: 5 * 1024 * 1024,
  exchangeRateProvider: 'manual',
  announcement: { text: '', version: 0, active: false, audience: 'signed-in' },
  maintenanceMessage: '',
  backupPolicy: { onDemand: true, beforeDestructive: true, retentionDays: 35 },
});

async function readSite(storage) {
  const { value, etag } = await storage.getJson(paths.site());
  const doc = readDocument('site', value);
  const merged = { ...structuredClone(DEFAULT_SITE), ...(doc || {}) };
  merged.defaults = { ...DEFAULT_SITE.defaults, ...((doc && doc.defaults) || {}) };
  return { site: merged, etag, exists: !!doc };
}

// What anyone may learn before signing in: branding, theme defaults and a public announcement.
// The staging link's site default (BT-011-06) is for signed-in people only: a visitor to the
// Production site never learns where the staging site is.
function publicView(site, signedIn) {
  const a = site.announcement || {};
  const showAnnouncement = a.active && a.text && (a.audience === 'everyone' || signedIn);
  const { stagingUrl, ...publicDefaults } = site.defaults || {};
  return {
    branding: site.branding, defaults: signedIn ? site.defaults : publicDefaults, locked: site.locked,
    announcement: showAnnouncement ? { text: a.text, version: a.version } : null,
    maintenanceMessage: site.maintenanceMessage || '', publicSharingEnabled: !!site.publicSharingEnabled,
    modules: site.modules,
  };
}

// The site settings without the staging-link default (BT-011-06), for people who may not see it:
// visitors who are not signed in, and signed-in people who are neither a site administrator nor an
// active member of any workspace (security review of d363eff, finding 1).
function withoutStagingDefault(site) {
  const { stagingUrl, ...defaults } = site.defaults || {};
  return { ...site, defaults };
}

module.exports = { DEFAULT_SITE, THEME_MODES, PALETTES, EDITOR_TOOLBARS, readSite, publicView, withoutStagingDefault, stampSite: (d) => stampDocument('site', d) };
