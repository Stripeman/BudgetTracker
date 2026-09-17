'use strict';
// Design Gallery storage (BT-013): site administrators' catalog overrides (approved/retired state,
// safe name/description overrides, a replacement path for a retired concept) and Terry's recorded
// implementation picks. One denormalized document, the same shape as site/settings.json and
// site/usage.json, so a change is a single ETag-guarded read-modify-write with an atomic audit
// entry — never best-effort (SECURITY.md). NEVER financial data: this document only ever references
// the concept ids declared in api/_shared/layouts.js and short administrative text Terry or a site
// administrator writes about them.
const { update } = require('./storage');
const { readDocument, stampDocument } = require('./schema');
const { paths } = require('./store');
const { CONCEPT_IDS, CATALOG_STATUSES } = require('./layouts');

const DEFAULT_GALLERY = Object.freeze({ catalog: {}, picks: { selectedIds: [], note: '', updatedAt: null, updatedBy: null }, audit: [] });

function mergeDefaults(stored) {
  return {
    ...structuredClone(DEFAULT_GALLERY),
    ...(stored || {}),
    catalog: { ...((stored && stored.catalog) || {}) },
    picks: { ...structuredClone(DEFAULT_GALLERY.picks), ...((stored && stored.picks) || {}) },
    audit: [...((stored && stored.audit) || [])],
  };
}

async function readGallery(storage) {
  const { value, etag } = await storage.getJson(paths.gallery());
  const doc = readDocument('gallery', value);
  return { gallery: mergeDefaults(doc), etag, exists: !!doc };
}

// The catalog override for one concept, merged over its built-in manifest default (`review`, no
// replacement, no override text) — the same "stored value or default" pattern as workspace and
// group settings.
function catalogEntry(gallery, id) {
  const stored = gallery.catalog[id];
  return {
    status: (stored && CATALOG_STATUSES.includes(stored.status)) ? stored.status : 'review',
    replacementId: (stored && CONCEPT_IDS.includes(stored.replacementId)) ? stored.replacementId : null,
    note: (stored && typeof stored.note === 'string') ? stored.note : '',
    nameOverride: (stored && typeof stored.nameOverride === 'string' && stored.nameOverride) ? stored.nameOverride : null,
    descriptionOverride: (stored && typeof stored.descriptionOverride === 'string' && stored.descriptionOverride) ? stored.descriptionOverride : null,
  };
}

// This is a standalone site-level document (like site/settings.json and site/usage.json), never
// part of any workspace document, so it is never a workspace backup/restore concern.
module.exports = { DEFAULT_GALLERY, readGallery, catalogEntry, stampGallery: (d) => stampDocument('gallery', d), update, paths };
