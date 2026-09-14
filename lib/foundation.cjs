'use strict';

// Local foundation prototype. Trusted identity and durable storage adapters are pending.
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const CAPABILITIES = new Set(['view-balances', 'view-transactions', 'create', 'edit', 'delete',
  'comment', 'download-receipts', 'export', 'invite', 'change-permissions', 'publish']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('Invalid or unauthorized recovery operation'); };
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

// Principal must come from a trusted server identity adapter, never request JSON.
function mayAccess(principal, resource, capability, grants, now = Date.now()) {
  if (!principal || principal.verified !== true || !identifier(principal.subject) ||
      !resource || !identifier(resource.id) || !identifier(resource.workspaceId) ||
      !identifier(resource.ownerId) || !CAPABILITIES.has(capability) || !Number.isFinite(now)) return false;
  if (principal.subject === resource.ownerId) return true;
  if (!Array.isArray(grants)) return false;
  return grants.some(g => g && g.subject === principal.subject && g.resourceId === resource.id &&
    g.workspaceId === resource.workspaceId && g.capability === capability &&
    g.revoked === false && Number.isFinite(g.expiresAt) && g.expiresAt > now);
}

function validateSnapshot(s) {
  if (!s || s.schemaVersion !== 1 || !identifier(s.workspaceId) ||
      !Array.isArray(s.records) || !Array.isArray(s.attachments) || !Array.isArray(s.grants) ||
      s.records.length > 10000 || s.attachments.length > 1000) fail();
  const ids = new Set();
  for (const r of s.records) {
    if (!r || !identifier(r.id) || ids.has(r.id) || r.workspaceId !== s.workspaceId ||
        !identifier(r.ownerId) || typeof r.amountMinor !== 'string' ||
        !/^-?(0|[1-9][0-9]{0,29})$/.test(r.amountMinor) || !/^[A-Z]{3}$/.test(r.currency) ||
        !Number.isInteger(r.precision) || r.precision < 0 || r.precision > 6 ||
        !Array.isArray(r.attachmentIds)) fail();
    ids.add(r.id);
  }
  const attachments = new Set();
  for (const a of s.attachments) {
    if (!a || !identifier(a.id) || attachments.has(a.id) || !ids.has(a.recordId) ||
        a.workspaceId !== s.workspaceId || typeof a.base64 !== 'string' ||
        a.base64.length > 7000000) fail();
    const bytes = Buffer.from(a.base64, 'base64');
    if (bytes.toString('base64') !== a.base64 || hash(bytes) !== a.sha256) fail();
    attachments.add(a.id);
  }
  for (const r of s.records) {
    if (new Set(r.attachmentIds).size !== r.attachmentIds.length) fail();
    for (const id of r.attachmentIds) {
      if (!s.attachments.some(a => a.id === id && a.recordId === r.id)) fail();
    }
  }
  for (const a of s.attachments) {
    if (!s.records.find(r => r.id === a.recordId).attachmentIds.includes(a.id)) fail();
  }
  return s;
}

function checkRecovery(operator, workspaceId) {
  if (!identifier(workspaceId) || !operator || operator.verified !== true ||
      !identifier(operator.subject) || operator.capability !== 'recover-workspace' ||
      operator.workspaceId !== workspaceId) fail();
}

// Caller supplies a consistent snapshot and separately protected 256-bit key.
function encryptSnapshot(snapshot, key, operator) {
  checkRecovery(operator, snapshot?.workspaceId);
  validateSnapshot(snapshot);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  const plaintext = Buffer.from(JSON.stringify(snapshot));
  if (plaintext.length > 16000000) fail();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('BudgetTracker:snapshot:v1'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from('BT01'), nonce, cipher.getAuthTag(), ciphertext]);
}

// No filesystem writes. Preview is isolated and strips ALL archived sharing grants.
function previewRestore(archive, key, operator, expectedWorkspaceId) {
  checkRecovery(operator, expectedWorkspaceId);
  try {
    if (!Buffer.isBuffer(archive) || archive.length < 33 || archive.length > 16000032 ||
        archive.subarray(0, 4).toString() !== 'BT01' || !Buffer.isBuffer(key) || key.length !== 32) fail();
    const decipher = createDecipheriv('aes-256-gcm', key, archive.subarray(4, 16));
    decipher.setAAD(Buffer.from('BudgetTracker:snapshot:v1'));
    decipher.setAuthTag(archive.subarray(16, 32));
    const snapshot = validateSnapshot(JSON.parse(Buffer.concat([
      decipher.update(archive.subarray(32)), decipher.final(),
    ]).toString('utf8')));
    if (snapshot.workspaceId !== expectedWorkspaceId) fail();
    // Allowlisted reconstruction excludes archived roles/settings and unknown privilege fields.
    const records = snapshot.records.map(r => ({ id: r.id, workspaceId: r.workspaceId,
      ownerId: r.ownerId, amountMinor: r.amountMinor, currency: r.currency,
      precision: r.precision, attachmentIds: [...r.attachmentIds] }));
    const attachments = snapshot.attachments.map(a => ({ id: a.id, recordId: a.recordId,
      workspaceId: a.workspaceId, base64: a.base64, sha256: a.sha256 }));
    return { schemaVersion: 1, workspaceId: snapshot.workspaceId, records, attachments,
      grants: [], requiresReauthorization: true, executable: false };
  } catch { fail(); }
}

module.exports = { mayAccess, validateSnapshot, encryptSnapshot, previewRestore };
