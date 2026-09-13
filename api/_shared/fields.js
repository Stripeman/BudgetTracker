'use strict';
// Request-field validation. Every value taken from a client passes through one of these, and
// server-owned fields (ids, createdBy, createdAt, revision, balances) are never read from input.
const { badRequest } = require('./http');
const { isSafeId } = require('./ids');
const { EMAIL_RE, normalizeEmail } = require('./identity');
const richtext = require('./richtext');
const invisible = require('./invisible');

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function text(value, { field, max = 200, required = false, multiline = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} is required.`, 'missing_field');
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`, 'invalid_field');
  const out = multiline ? value.replace(/\r\n/g, '\n').trim() : value.trim();
  if (!multiline && /[\n\r\t]/.test(out)) throw badRequest(`${field} must be a single line.`, 'invalid_field');
  if (CONTROL.test(out)) throw badRequest(`${field} contains control characters.`, 'invalid_field');
  // Names and notes are shown to other members, so characters that hide or reorder text are refused
  // here too — the same list rich text uses (security retest SEC-U2).
  if (invisible.firstForbidden(out) !== null) throw badRequest(`${field} contains invisible or direction-changing characters.`, 'invalid_field');
  if (out.length > max) throw badRequest(`${field} must be at most ${max} characters.`, 'invalid_field');
  if (required && !out) throw badRequest(`${field} is required.`, 'missing_field');
  return out;
}

// Notes that may be formatted (BT-011-02). A plain string is validated exactly as `text()` with
// multiple lines, so existing notes are unchanged; a formatted document must pass the rich-text
// validator and is stored in its canonical form; an empty document is stored as ''. Not wired into
// any handler until the client can display documents.
function richText(value, { field, max = 5000 } = {}) {
  if (value !== null && typeof value === 'object') {
    const doc = richtext.validate(value, { field, max });
    return richtext.isEmpty(doc) ? '' : doc;
  }
  return text(value, { field, max, multiline: true });
}

function oneOf(value, allowed, field, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`, 'invalid_field');
  return value;
}

function bool(value, field, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`, 'invalid_field');
  return value;
}

// Calendar dates are plain YYYY-MM-DD (never timestamps) and must be real dates.
function date(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} is required.`, 'missing_field');
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${field} must be a date (YYYY-MM-DD).`, 'invalid_date');
  // Bounded: years before 100 would be read as 1900s by Date.UTC, and far dates only cost time
  // in schedule arithmetic (security review SEC-B4, SEC-B12).
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2200) throw badRequest(`${field} must be between the years 1900 and 2200.`, 'invalid_date');
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw badRequest(`${field} is not a real date.`, 'invalid_date');
  return value;
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (!isSafeId(value)) throw badRequest(`${field} is not a valid identifier.`, 'invalid_id');
  return value;
}

function idList(value, field, max = 50) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max || !value.every(isSafeId)) throw badRequest(`${field} must be a list of identifiers.`, 'invalid_field');
  return [...new Set(value)];
}

function tags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw badRequest('Tags must be a list of at most 20 items.', 'invalid_field');
  return [...new Set(value.map((t) => text(t, { field: 'Tag', max: 40, required: true }).toLowerCase()))];
}

function email(value, field, { required = false } = {}) {
  const out = normalizeEmail(value);
  if (!out) {
    if (required) throw badRequest(`${field} is required.`, 'missing_field');
    return '';
  }
  if (!EMAIL_RE.test(out) || out.length > 254) throw badRequest(`${field} is not a valid email address.`, 'invalid_email');
  return out;
}

// Rejects any unknown key so a client cannot smuggle server-owned fields through a body.
function onlyKeys(body, allowed) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw badRequest(`Unknown field: ${key.slice(0, 40)}.`, 'unknown_field');
  }
  return body;
}

module.exports = { text, richText, oneOf, bool, date, optionalId, idList, tags, email, onlyKeys };
