'use strict';
// Identifiers. Ids are immutable and server-generated; client-supplied ids are validated against
// a strict character set before they are used in a storage path or comparison.
const { randomBytes, createHash } = require('node:crypto');
const { badRequest } = require('./http');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

function isSafeId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

function requireId(value, field = 'id') {
  if (!isSafeId(value)) throw badRequest(`${field} is missing or not a valid identifier.`, 'invalid_id');
  return value;
}

// Idempotency keys come from clients, so they are validated like ids but may be longer.
const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
function isIdempotencyKey(value) {
  return typeof value === 'string' && KEY_RE.test(value);
}

function newToken() {
  return randomBytes(32).toString('base64url');
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

module.exports = { newId, isSafeId, requireId, isIdempotencyKey, newToken, sha256Hex, ID_RE };
