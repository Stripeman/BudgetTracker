'use strict';
// /api/design-gallery — BT-013: the Design Gallery for Terry's 20-concept layout review (design
// brief, 2026-09-16). Site administrators only, both server-side (checked on every request, never
// trusted from a cached role — the same rule as /api/analytics and /api/site-settings) and in the
// app (the nav entry and page hide themselves for anyone else).
//
// HARD INVARIANT (unchanged by this route): site administration never sees financial records. This
// route never reads or returns anything from a real workspace — it serves static concept metadata
// (api/_shared/layouts.js), a site-admin catalog override document, and Terry's recorded picks. The
// concepts themselves are rendered client-side against bundled fictional fixtures, never live data.
const { readBody, forbidden, unauthorized, badRequest } = require('../_shared/http');
const { newId } = require('../_shared/ids');
const { CONCEPTS, CONCEPT_IDS, REQUIRED_PAGES, REAL_LAYOUT_OPTIONS, REAL_DEFAULT_LAYOUT_ID, CATALOG_STATUSES } = require('../_shared/layouts');
const gallery = require('../_shared/gallery');
const fields = require('../_shared/fields');
const { readDocument } = require('../_shared/schema');

function requireAdmin(ctx) {
  if (!ctx.principal) throw unauthorized();
  if (!ctx.siteAdmin) throw forbidden('The Design Gallery is only shown to site administrators.');
}

function publicConcepts(g) {
  return CONCEPTS.map((c) => {
    const over = gallery.catalogEntry(g, c.id);
    return {
      ...c,
      name: over.nameOverride || c.name,
      tagline: over.descriptionOverride || c.tagline,
      catalog: { status: over.status, replacementId: over.replacementId, note: over.note },
    };
  });
}

async function get(ctx) {
  requireAdmin(ctx);
  const { gallery: g } = await gallery.readGallery(ctx.storage);
  return {
    body: {
      concepts: publicConcepts(g),
      requiredPages: REQUIRED_PAGES,
      realLayoutOptions: REAL_LAYOUT_OPTIONS,
      realDefaultLayoutId: REAL_DEFAULT_LAYOUT_ID,
      picks: g.picks,
    },
  };
}

// `changes` = { picks?: { selectedIds: [id...], note? }, catalog?: { <conceptId>: { status, replacementId?, note?, nameOverride?, descriptionOverride? } } }
function cleanPicks(input, current) {
  const body = fields.onlyKeys(input, ['selectedIds', 'note']);
  const selectedIds = body.selectedIds === undefined ? current.selectedIds : body.selectedIds;
  if (!Array.isArray(selectedIds) || !selectedIds.every((id) => CONCEPT_IDS.includes(id))) {
    throw badRequest('Picks must be a list of known concept ids.', 'invalid_field');
  }
  const note = body.note === undefined ? current.note : fields.text(body.note, { field: 'Picks note', max: 500, multiline: true });
  return { selectedIds: [...new Set(selectedIds)], note };
}

function cleanCatalogEntry(id, input) {
  if (!CONCEPT_IDS.includes(id)) throw badRequest(`There is no concept called ${JSON.stringify(id).slice(0, 60)}.`, 'unknown_concept');
  const body = fields.onlyKeys(input, ['status', 'replacementId', 'note', 'nameOverride', 'descriptionOverride']);
  const status = body.status === undefined ? 'review' : fields.oneOf(body.status, CATALOG_STATUSES, `Status for ${id}`);
  const replacementId = body.replacementId === undefined || body.replacementId === null ? null : body.replacementId;
  if (replacementId !== null && (!CONCEPT_IDS.includes(replacementId) || replacementId === id)) {
    throw badRequest(`The replacement for ${id} must be a different known concept.`, 'invalid_field');
  }
  // A retired concept needs either a replacement or an explanatory note (BT-013: "a replacement path
  // for retired layouts") — never silently retired with nothing for an affected workspace to be told.
  const note = body.note === undefined ? '' : fields.text(body.note, { field: `Note for ${id}`, max: 500, multiline: true });
  if (status === 'retired' && !replacementId && !note) {
    throw badRequest(`Retiring ${id} needs a replacement concept or a note explaining what to do instead.`, 'invalid_field');
  }
  return {
    status, replacementId, note,
    nameOverride: body.nameOverride === undefined || body.nameOverride === null ? null : fields.text(body.nameOverride, { field: `Name for ${id}`, max: 60 }),
    descriptionOverride: body.descriptionOverride === undefined || body.descriptionOverride === null ? null : fields.text(body.descriptionOverride, { field: `Description for ${id}`, max: 200 }),
  };
}

async function patch(ctx, req) {
  requireAdmin(ctx);
  const body = fields.onlyKeys(readBody(req), ['picks', 'catalog']);
  if (body.picks === undefined && body.catalog === undefined) throw badRequest('Send picks and/or a catalog change.', 'invalid_field');
  let saved;
  await gallery.update(ctx.storage, gallery.paths.gallery(), (value) => {
    const stored = readDocument('gallery', value);
    const current = { ...structuredClone(gallery.DEFAULT_GALLERY), ...(stored || {}) };
    current.catalog = { ...((stored && stored.catalog) || {}) };
    current.picks = { ...structuredClone(gallery.DEFAULT_GALLERY.picks), ...((stored && stored.picks) || {}) };
    current.audit = [...((stored && stored.audit) || [])];
    const next = { ...current };
    const changes = [];
    if (body.picks !== undefined) {
      const before = current.picks.selectedIds;
      next.picks = cleanPicks(body.picks, current.picks);
      next.picks.updatedAt = ctx.nowIso();
      next.picks.updatedBy = ctx.principal.subject;
      if (JSON.stringify([...before].sort()) !== JSON.stringify([...next.picks.selectedIds].sort())) {
        changes.push({ field: 'picks.selectedIds', before, after: next.picks.selectedIds });
      }
    }
    if (body.catalog !== undefined) {
      const patchObj = fields.onlyKeys(body.catalog || {}, CONCEPT_IDS);
      next.catalog = { ...current.catalog };
      for (const [id, entryPatch] of Object.entries(patchObj)) {
        const before = gallery.catalogEntry(current, id);
        const cleaned = cleanCatalogEntry(id, entryPatch);
        next.catalog[id] = cleaned;
        if (JSON.stringify(before) !== JSON.stringify(cleaned)) changes.push({ field: `catalog.${id}`, before, after: cleaned });
      }
    }
    if (!changes.length) { saved = current; return undefined; }
    next.audit = [...current.audit, { id: newId('aud'), at: ctx.nowIso(), actor: ctx.principal.subject, action: 'gallery.update', changes }]; // never truncated (BT-001-05)
    saved = gallery.stampGallery(next);
    return saved;
  });
  return { body: { concepts: publicConcepts(saved), picks: saved.picks } };
}

module.exports = { GET: get, PATCH: patch };
