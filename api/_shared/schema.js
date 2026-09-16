'use strict';
// THE ONLY PLACE document schema versions are declared or written. Every persisted document
// carries `schemaVersion`. A version newer than this code is refused — reading it as current
// would silently drop fields on the next write — and nothing is changed.
const { unavailable } = require('./http');

const CURRENT = Object.freeze({ workspace: 1, user: 1, site: 1, backup: 1, usage: 1 });

// Per-type, per-version upgrade steps applied in memory on read. None exist yet; add a step
// here and record the migration plan in PROJECT_STATE.md before bumping CURRENT.
const MIGRATIONS = Object.freeze({ workspace: {}, user: {}, site: {}, backup: {}, usage: {} });

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
