'use strict';
// THE ONLY PLACE document schema versions are declared or written. Every persisted document
// carries `schemaVersion`. A version newer than this code is refused — reading it as current
// would silently drop fields on the next write — and nothing is changed.
const { unavailable } = require('./http');

const CURRENT = Object.freeze({ workspace: 2, user: 1, site: 1, backup: 1, usage: 1, gallery: 1 });

// BT-009-20 (Shared-expense EVENTS, the foundation, 2026-09-19): a workspace's shared-expense
// records used to be one undivided ledger; they now belong to a named, stable "event" (its own
// id, name, lifecycle status). A workspace already at version 1 is migrated on read: every
// existing groupExpense/groupSettlement that has no `eventId` yet joins ONE legacy event, created
// once and reused (never guessing separate historical event boundaries — Terry, 2026-09-19,
// "do not guess historical event boundaries"). A workspace with no shared-expense records at all
// needs no legacy event; its first real event is created lazily, on first use, by
// `api/group/handler.js`'s `resolveEvent`. Deterministic and idempotent: the same input document
// always produces the same legacy event id (`gev_legacy`), so re-reading an un-migrated document
// (an aborted write that was never saved) never creates a second one.
function migrateWorkspaceV1(doc) {
  const hasRecords = (doc.groupExpenses && doc.groupExpenses.length) || (doc.groupSettlements && doc.groupSettlements.length);
  if (!hasRecords) return { ...doc, groupEvents: Array.isArray(doc.groupEvents) ? doc.groupEvents : [] };
  const untaggedExpense = (doc.groupExpenses || []).some((e) => !e.eventId);
  const untaggedSettlement = (doc.groupSettlements || []).some((s) => !s.eventId);
  if (!untaggedExpense && !untaggedSettlement) return doc;
  const legacy = {
    id: 'gev_legacy', name: 'Shared expenses (before events)',
    description: 'Every expense and payment recorded before named events existed.',
    icon: null, color: null, status: 'active', createdAt: null, createdBy: null, history: [],
  };
  const groupEvents = (doc.groupEvents || []).some((e) => e.id === legacy.id) ? doc.groupEvents : [...(doc.groupEvents || []), legacy];
  return {
    ...doc,
    groupEvents,
    defaultEventId: doc.defaultEventId || legacy.id,
    groupExpenses: (doc.groupExpenses || []).map((e) => (e.eventId ? e : { ...e, eventId: legacy.id })),
    groupSettlements: (doc.groupSettlements || []).map((s) => (s.eventId ? s : { ...s, eventId: legacy.id })),
  };
}

// Per-type, per-version upgrade steps applied in memory on read. Record the migration plan in
// PROJECT_STATE.md before bumping CURRENT.
const MIGRATIONS = Object.freeze({ workspace: { 1: migrateWorkspaceV1 }, user: {}, site: {}, backup: {}, usage: {}, gallery: {} });

function readDocument(type, doc) {
  if (!Object.prototype.hasOwnProperty.call(CURRENT, type)) throw new Error(`Unknown document type ${type}`);
  if (doc === null || doc === undefined) return null;
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw unavailable('storage_corrupt', 'Stored data could not be read. No data has been changed.');
  }
  let version = doc.schemaVersion;
  if (!Number.isInteger(version) || version < 1) {
    throw unavailable('schema_invalid', 'Stored data has no valid schema version. No data has been changed.');
  }
  if (version > CURRENT[type]) {
    throw unavailable('schema_unsupported',
      `Stored ${type} data is version ${version}, newer than this application supports (${CURRENT[type]}). No data has been changed.`);
  }
  let out = doc;
  while (version < CURRENT[type]) {
    const step = MIGRATIONS[type][version];
    if (!step) throw unavailable('schema_too_old', `Stored ${type} data version ${version} cannot be upgraded. No data has been changed.`);
    out = step(out);
    version += 1;
  }
  return out;
}

function stampDocument(type, doc) {
  return { ...doc, schemaVersion: CURRENT[type] };
}

module.exports = { CURRENT, readDocument, stampDocument };
