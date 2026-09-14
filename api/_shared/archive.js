'use strict';
// Encrypted backup archive format (BT-002), version 1.
//
//   "BTBK" | u8 format=1 | u32be headerLength | header JSON | nonce(12) | tag(16) | ciphertext
//
// The header is plaintext so an operator can identify an archive without decrypting it, and it is
// AUTHENTICATED: magic, length and header bytes are the AES-256-GCM additional data. Changing the
// workspace, schema, archive id, time or key id breaks authentication (prototype review finding 2).
// The workspace check happens BEFORE decryption, and each workspace has its own key derived with
// HKDF from a master key, so an archive for workspace A cannot be opened as workspace B's.
//
// Master keys come from configuration (`BT_BACKUP_KEYS=id:base64,...`, `BT_BACKUP_ACTIVE_KEY=id`)
// and never appear in archives, logs or responses. Old key ids stay listed to read old archives;
// new archives always use the active key (rotation).
const { createCipheriv, createDecipheriv, hkdfSync, randomBytes } = require('node:crypto');
const { safeParse, unavailable, HttpError } = require('./http');
const { isSafeId } = require('./ids');

const MAGIC = Buffer.from('BTBK');
const FORMAT = 1;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_HEADER_BYTES = 4096;
const KEY_ID_RE = /^[a-z0-9-]{1,32}$/;

const invalid = (code = 'archive_invalid') => new HttpError(422, code, 'This backup archive could not be verified. Nothing has been changed.');

function loadKeys(env) {
  const keys = new Map();
  for (const entry of String((env && env.BT_BACKUP_KEYS) || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = entry.indexOf(':');
    const id = entry.slice(0, at);
    const key = Buffer.from(entry.slice(at + 1), 'base64');
    if (at < 1 || !KEY_ID_RE.test(id) || key.length !== 32 || key.every((b) => b === 0)) {
      throw unavailable('backup_not_configured', 'Backup encryption keys are misconfigured.');
    }
    keys.set(id, key);
  }
  const active = env && env.BT_BACKUP_ACTIVE_KEY;
  if (!keys.size || !keys.has(active)) throw unavailable('backup_not_configured', 'Backups are not configured.');
  return { keys, active };
}

function workspaceKey(master, workspaceId) {
  return Buffer.from(hkdfSync('sha256', master, Buffer.from('BudgetTracker backup v1'), Buffer.from(`workspace:${workspaceId}`), 32));
}

const HEADER_FIELDS = ['format', 'kind', 'workspaceId', 'archiveId', 'schemaVersion', 'createdAt', 'keyId', 'reason'];

function canonicalHeader(h) {
  const out = {};
  for (const k of HEADER_FIELDS) out[k] = h[k];
  return Buffer.from(JSON.stringify(out));
}

function validHeader(h) {
  return h && typeof h === 'object' && h.format === FORMAT && h.kind === 'workspace-backup'
    && isSafeId(h.workspaceId) && isSafeId(h.archiveId) && Number.isInteger(h.schemaVersion) && h.schemaVersion >= 1
    && typeof h.createdAt === 'string' && Number.isFinite(Date.parse(h.createdAt)) && KEY_ID_RE.test(h.keyId || '')
    && typeof h.reason === 'string' && h.reason.length <= 40;
}

function seal(header, payload, keyring) {
  const h = { ...header, format: FORMAT, kind: 'workspace-backup', keyId: keyring.active };
  if (!validHeader(h)) throw new Error('Invalid archive header');
  const headerBytes = canonicalHeader(h);
  const prefix = Buffer.alloc(9);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt8(FORMAT, 4);
  prefix.writeUInt32BE(headerBytes.length, 5);
  const aad = Buffer.concat([prefix, headerBytes]);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', workspaceKey(keyring.keys.get(h.keyId), h.workspaceId), nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const archive = Buffer.concat([aad, nonce, cipher.getAuthTag(), ciphertext]);
  if (archive.length > MAX_ARCHIVE_BYTES) throw invalid('archive_too_large');
  return archive;
}

// Header only, without decrypting — for listing and the pre-decryption workspace check.
function readHeader(archive) {
  if (!Buffer.isBuffer(archive) || archive.length < 9 + 2 + 28 || archive.length > MAX_ARCHIVE_BYTES) throw invalid();
  if (!archive.subarray(0, 4).equals(MAGIC) || archive.readUInt8(4) !== FORMAT) throw invalid('archive_format');
  const len = archive.readUInt32BE(5);
  if (len < 2 || len > MAX_HEADER_BYTES || 9 + len + 28 > archive.length) throw invalid();
  let header;
  try { header = safeParse(archive.subarray(9, 9 + len).toString('utf8')); } catch { throw invalid(); }
  if (!validHeader(header) || !canonicalHeader(header).equals(archive.subarray(9, 9 + len))) throw invalid();
  return { header, headerEnd: 9 + len };
}

function open(archive, keyring, { expectedWorkspaceId } = {}) {
  const { header, headerEnd } = readHeader(archive);
  if (expectedWorkspaceId !== undefined && header.workspaceId !== expectedWorkspaceId) throw invalid('archive_workspace_mismatch');
  const master = keyring.keys.get(header.keyId);
  if (!master) throw new HttpError(422, 'backup_key_unavailable', 'The key for this backup is not available. Nothing has been changed.');
  try {
    const nonce = archive.subarray(headerEnd, headerEnd + 12);
    const tag = archive.subarray(headerEnd + 12, headerEnd + 28);
    const decipher = createDecipheriv('aes-256-gcm', workspaceKey(master, header.workspaceId), nonce, { authTagLength: 16 });
    decipher.setAAD(archive.subarray(0, headerEnd));
    decipher.setAuthTag(tag);
    const payload = Buffer.concat([decipher.update(archive.subarray(headerEnd + 28)), decipher.final()]);
    return { header, payload };
  } catch { throw invalid('archive_authentication'); }
}

module.exports = { loadKeys, seal, open, readHeader, MAX_ARCHIVE_BYTES, workspaceKey };
