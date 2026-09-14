'use strict';
// /api/site-settings — operational administration. Anonymous GET returns the public subset.
// PUT is site-admin only (re-checked here on every request, never trusted from a cached role).
// Changing the announcement text increments its version so everyone sees it again.
// Site administration never grants access to any workspace or financial record.
const { readBody, header, badRequest, forbidden, unauthorized } = require('../_shared/http');
const { update } = require('../_shared/storage');
const { readDocument } = require('../_shared/schema');
const store = require('../_shared/store');
const site = require('../_shared/site');
const fields = require('../_shared/fields');
const { newId } = require('../_shared/ids');
const { appInfo } = require('../_shared/version');

const EDITABLE = ['branding', 'defaults', 'locked', 'modules', 'publicSharingEnabled', 'invitationPolicy', 'uploadLimitBytes', 'exchangeRateProvider', 'announcement', 'maintenanceMessage', 'backupPolicy'];
const LOCKABLE = ['themeMode', 'themePalette', 'editorToolbar', 'balanceMasking', 'dateFormat', 'locale', 'stagingUrl'];

// The application version, environment and deployed commit are public (the repository is public),
// so anyone can verify which build a deployment runs without signing in.
async function get(ctx) {
  const { site: doc, etag } = await site.readSite(ctx.storage);
  const app = appInfo(ctx.env);
  if (ctx.principal && ctx.siteAdmin) return { body: { settings: { ...doc, audit: undefined }, etag, admin: true, app } };
  return { body: { settings: site.publicView(doc, !!ctx.principal), app } };
}

function clean(body, current) {
  const next = { ...current };
  const changed = [];
  if (body.branding !== undefined) { fields.onlyKeys(body.branding || {}, ['name']); next.branding = { name: fields.text(body.branding.name, { field: 'Site name', max: 60, required: true }) }; changed.push('branding'); }
  if (body.defaults !== undefined) {
    const d = fields.onlyKeys(body.defaults || {}, ['themeMode', 'themePalette', 'editorToolbar', 'dateFormat', 'locale', 'stagingUrl']);
    next.defaults = {
      themeMode: fields.oneOf(d.themeMode, site.THEME_MODES, 'Default theme mode', current.defaults.themeMode),
      themePalette: fields.oneOf(d.themePalette, site.PALETTES, 'Default palette', current.defaults.themePalette),
      editorToolbar: fields.oneOf(d.editorToolbar, site.EDITOR_TOOLBARS, 'Default editor toolbar', current.defaults.editorToolbar),
      dateFormat: fields.oneOf(d.dateFormat, ['iso', 'dmy', 'mdy'], 'Default date format', current.defaults.dateFormat),
      locale: d.locale === undefined ? current.defaults.locale : fields.text(d.locale, { field: 'Locale', max: 5, required: true }),
    };
    // The staging link everyone inherits (BT-011-06): kept when another default changes, validated
    // like the personal one, and removed (not stored as null) when cleared.
    const stagingUrl = d.stagingUrl === undefined ? current.defaults.stagingUrl : d.stagingUrl === null ? undefined : fields.webAddress(d.stagingUrl, 'Staging link');
    if (stagingUrl) next.defaults.stagingUrl = stagingUrl;
    changed.push('defaults');
  }
  if (body.locked !== undefined) {
    if (!Array.isArray(body.locked) || !body.locked.every((k) => LOCKABLE.includes(k))) throw badRequest(`Locked keys must be chosen from: ${LOCKABLE.join(', ')}.`, 'invalid_field');
    next.locked = [...new Set(body.locked)]; changed.push('locked');
  }
  if (body.modules !== undefined) {
    const m = fields.onlyKeys(body.modules || {}, ['sharedExpenses', 'trips', 'forecasting', 'imports']);
    next.modules = { ...current.modules };
    for (const [k, v] of Object.entries(m)) next.modules[k] = fields.bool(v, k);
    changed.push('modules');
  }
  if (body.publicSharingEnabled !== undefined) { next.publicSharingEnabled = fields.bool(body.publicSharingEnabled, 'Public sharing'); changed.push('publicSharingEnabled'); }
  if (body.invitationPolicy !== undefined) { next.invitationPolicy = fields.oneOf(body.invitationPolicy, ['owners-and-managers', 'owners-only'], 'Invitation policy'); changed.push('invitationPolicy'); }
  if (body.uploadLimitBytes !== undefined) {
    if (!Number.isInteger(body.uploadLimitBytes) || body.uploadLimitBytes < 100000 || body.uploadLimitBytes > 10 * 1024 * 1024) throw badRequest('Upload limit must be between 100 KB and 10 MB.', 'invalid_field');
    next.uploadLimitBytes = body.uploadLimitBytes; changed.push('uploadLimitBytes');
  }
  if (body.exchangeRateProvider !== undefined) { next.exchangeRateProvider = fields.oneOf(body.exchangeRateProvider, ['manual'], 'Exchange-rate provider'); changed.push('exchangeRateProvider'); }
  if (body.maintenanceMessage !== undefined) { next.maintenanceMessage = fields.text(body.maintenanceMessage, { field: 'Maintenance message', max: 300 }); changed.push('maintenanceMessage'); }
  if (body.announcement !== undefined) {
    const a = fields.onlyKeys(body.announcement || {}, ['text', 'active', 'audience']);
    const text = a.text === undefined ? current.announcement.text : fields.text(a.text, { field: 'Announcement', max: 2000, multiline: true });
    next.announcement = {
      text, active: fields.bool(a.active, 'Announcement active', current.announcement.active),
      audience: fields.oneOf(a.audience, ['everyone', 'signed-in'], 'Audience', current.announcement.audience),
      version: text !== current.announcement.text ? (current.announcement.version || 0) + 1 : current.announcement.version || 0,
    };
    changed.push('announcement');
  }
  if (body.backupPolicy !== undefined) {
    const b = fields.onlyKeys(body.backupPolicy || {}, ['onDemand', 'beforeDestructive', 'retentionDays']);
    const retentionDays = b.retentionDays === undefined ? current.backupPolicy.retentionDays : b.retentionDays;
    if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 3650) throw badRequest('Retention must be 7–3650 days.', 'invalid_field');
    next.backupPolicy = { onDemand: fields.bool(b.onDemand, 'On-demand backups', current.backupPolicy.onDemand), beforeDestructive: true, retentionDays };
    changed.push('backupPolicy');
  }
  return { next, changed };
}

async function put(ctx, req) {
  if (!ctx.principal) throw unauthorized();
  if (!ctx.siteAdmin) throw forbidden('Only site administrators can change site settings.');
  const body = fields.onlyKeys(readBody(req), EDITABLE);
  let saved;
  await update(ctx.storage, store.paths.site(), (value) => {
    const stored = readDocument('site', value);
    const current = { ...structuredClone(site.DEFAULT_SITE), ...(stored || {}) };
    current.defaults = { ...site.DEFAULT_SITE.defaults, ...((stored && stored.defaults) || {}) };
    const { next, changed } = clean(body, current);
    if (!changed.length) { saved = current; return undefined; }
    next.audit = [...((stored && stored.audit) || []), { id: newId('aud'), at: ctx.nowIso(), actor: ctx.principal.subject, action: 'site.update', fields: changed }]; // never truncated (BT-001-05)
    saved = site.stampSite(next);
    return saved;
  }, { expectedEtag: header(req, 'if-match') || undefined });
  return { body: { settings: { ...saved, audit: undefined } } };
}

module.exports = { GET: get, PUT: put };
