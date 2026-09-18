'use strict';
// Storage adapters behind one interface, plus the ETag-guarded update loop.
//
//   getJson(name)                -> { value, etag, exists }
//   putJson(name, value, cond)   -> etag      cond: { ifMatch } | { ifNoneMatch: '*' } | {}
//   getBytes(name)               -> { bytes, etag } | null
//   putBytes(name, bytes, cond)  -> etag
//   list(prefix)                 -> [names]
//   delete(name)                 -> true if something was removed, false if it was already gone
//                                    (security review S3: whole-workspace permanent deletion needs
//                                    a real way to remove attachment blobs, not just the JSON
//                                    document; idempotent so a retried purge is always safe)
//
// DEPARTURE FROM TASKTRACKER: unparseable JSON is REFUSED (503 storage_corrupt), never treated
// as an empty document. Treating corruption as "empty" would let the next write replace a
// damaged ledger with nothing.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { safeParse, unavailable, conflict } = require('./http');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;

function checkName(name) {
  if (typeof name !== 'string' || name.length > 400 || !NAME_RE.test(name) || name.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error('Invalid storage name');
  }
  return name;
}

class PreconditionFailed extends Error {
  constructor() { super('Storage precondition failed'); this.code = 'precondition_failed'; }
}

function parseStored(buffer) {
  try { return safeParse(buffer.toString('utf8')); } catch {
    throw unavailable('storage_corrupt', 'Stored data could not be read. No data has been changed.');
  }
}

const etagOf = (bytes) => `"${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`;

function conditionsMet(current, cond = {}) {
  if (cond.ifNoneMatch === '*' && current) return false;
  if (cond.ifMatch !== undefined && (!current || current.etag !== cond.ifMatch)) return false;
  return true;
}

// ---- memory (tests) -------------------------------------------------------------------------
function createMemoryStorage(options = {}) {
  const files = new Map();
  let counter = 0;
  const failWrite = options.failWrite || (() => false);
  const api = {
    kind: 'memory',
    files,
    async getJson(name) {
      const hit = files.get(checkName(name));
      if (!hit) return { value: null, etag: null, exists: false };
      return { value: parseStored(hit.bytes), etag: hit.etag, exists: true };
    },
    async putJson(name, value, cond) {
      return api.putBytes(name, Buffer.from(JSON.stringify(value)), cond);
    },
    async getBytes(name) {
      const hit = files.get(checkName(name));
      return hit ? { bytes: Buffer.from(hit.bytes), etag: hit.etag } : null;
    },
    async putBytes(name, bytes, cond) {
      checkName(name);
      if (failWrite(name)) { const e = new Error('Injected storage failure'); e.code = 'injected_failure'; throw e; }
      if (!conditionsMet(files.get(name), cond)) throw new PreconditionFailed();
      const etag = `"m${++counter}"`;
      files.set(name, { bytes: Buffer.from(bytes), etag });
      return etag;
    },
    async list(prefix) {
      return [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    async delete(name) {
      checkName(name);
      return files.delete(name);
    },
  };
  return api;
}

// ---- file (local development only) ----------------------------------------------------------
function createFileStorage(root) {
  const base = path.resolve(root);
  fs.mkdirSync(base, { recursive: true });
  const locks = new Map();
  const full = (name) => path.join(base, ...checkName(name).split('/'));
  async function withLock(name, fn) {
    const prior = locks.get(name) || Promise.resolve();
    let release;
    const next = new Promise((r) => { release = r; });
    locks.set(name, prior.then(() => next));
    await prior;
    try { return await fn(); } finally { release(); if (locks.get(name) === next) locks.delete(name); }
  }
  function readRaw(name) {
    try { const bytes = fs.readFileSync(full(name)); return { bytes, etag: etagOf(bytes) }; } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  const api = {
    kind: 'file',
    async getJson(name) {
      const hit = readRaw(name);
      if (!hit) return { value: null, etag: null, exists: false };
      return { value: parseStored(hit.bytes), etag: hit.etag, exists: true };
    },
    async putJson(name, value, cond) {
      return api.putBytes(name, Buffer.from(JSON.stringify(value)), cond);
    },
    async getBytes(name) { return readRaw(name); },
    async putBytes(name, bytes, cond) {
      return withLock(name, async () => {
        if (!conditionsMet(readRaw(name), cond)) throw new PreconditionFailed();
        const target = full(name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(temp, bytes);
        fs.renameSync(temp, target);
        return etagOf(bytes);
      });
    },
    async list(prefix) {
      const out = [];
      const walk = (dir, rel) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name.endsWith('.tmp')) continue;
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(path.join(dir, e.name), r); else if (r.startsWith(prefix)) out.push(r);
        }
      };
      walk(base, '');
      return out.sort();
    },
    async delete(name) {
      return withLock(name, async () => {
        try { fs.unlinkSync(full(name)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
      });
    },
  };
  return api;
}

// ---- Azure Blob Storage (deployed) ----------------------------------------------------------
function createBlobStorage({ connectionString, container }) {
  if (!connectionString || !container) throw unavailable('storage_not_configured', 'Storage is not configured.');
  // Lazy so tests and local development never load the SDK.
  const { BlobServiceClient } = require('@azure/storage-blob');
  const client = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(container);
  let ready = null;
  const ensure = () => { if (!ready) ready = client.createIfNotExists({ access: undefined }).then(() => client); return ready; };
  const isMissing = (e) => e && (e.statusCode === 404 || e.code === 'BlobNotFound');
  const isPrecondition = (e) => e && (e.statusCode === 412 || e.statusCode === 409 || e.code === 'ConditionNotMet' || e.code === 'BlobAlreadyExists');
  async function readRaw(name) {
    const c = await ensure();
    try {
      const buffer = await c.getBlockBlobClient(checkName(name)).downloadToBuffer();
      const props = await c.getBlockBlobClient(name).getProperties();
      return { bytes: buffer, etag: props.etag };
    } catch (e) { if (isMissing(e)) return null; throw e; }
  }
  const api = {
    kind: 'blob',
    async getJson(name) {
      const c = await ensure();
      const blob = c.getBlockBlobClient(checkName(name));
      try {
        const dl = await blob.download();
        const chunks = [];
        for await (const chunk of dl.readableStreamBody) chunks.push(Buffer.from(chunk));
        return { value: parseStored(Buffer.concat(chunks)), etag: dl.etag, exists: true };
      } catch (e) { if (isMissing(e)) return { value: null, etag: null, exists: false }; throw e; }
    },
    async putJson(name, value, cond) {
      return api.putBytes(name, Buffer.from(JSON.stringify(value)), cond, 'application/json');
    },
    async getBytes(name) { return readRaw(name); },
    async putBytes(name, bytes, cond = {}, contentType = 'application/octet-stream') {
      const c = await ensure();
      const conditions = cond.ifNoneMatch === '*' ? { ifNoneMatch: '*' } : cond.ifMatch ? { ifMatch: cond.ifMatch } : undefined;
      try {
        const res = await c.getBlockBlobClient(checkName(name)).upload(bytes, bytes.length, {
          conditions, blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: 'no-store' },
        });
        return res.etag;
      } catch (e) { if (isPrecondition(e)) throw new PreconditionFailed(); throw e; }
    },
    async list(prefix) {
      const c = await ensure();
      const out = [];
      for await (const item of c.listBlobsFlat({ prefix })) out.push(item.name);
      return out.sort();
    },
    async delete(name) {
      const c = await ensure();
      try { const res = await c.getBlockBlobClient(checkName(name)).deleteIfExists(); return !!res.succeeded; } catch (e) { if (isMissing(e)) return false; throw e; }
    },
  };
  return api;
}

// ETag-guarded read-modify-write. `mutate(value, meta)` must be pure with respect to captured
// state because it re-runs after a lost race. Returning undefined aborts without writing.
// `expectedEtag` is the client's precondition: a stale one is refused, never retried.
async function update(storage, name, mutate, options = {}) {
  const attempts = options.attempts || 6;
  for (let i = 0; i < attempts; i += 1) {
    const current = await storage.getJson(name);
    if (options.expectedEtag && current.etag !== options.expectedEtag) {
      throw conflict('That changed since you loaded it. Reload and try again.', 'etag_mismatch');
    }
    const next = await mutate(current.value, { exists: current.exists, attempt: i });
    if (next === undefined) return { value: current.value, etag: current.etag, written: false };
    try {
      const etag = await storage.putJson(name, next, current.exists ? { ifMatch: current.etag } : { ifNoneMatch: '*' });
      return { value: next, etag, written: true };
    } catch (e) {
      if (!(e instanceof PreconditionFailed)) throw e;
      await new Promise((r) => setTimeout(r, 10 * (i + 1)));
    }
  }
  throw conflict('This record kept changing. Reload and try again.');
}

module.exports = { createMemoryStorage, createFileStorage, createBlobStorage, update, PreconditionFailed, checkName };
