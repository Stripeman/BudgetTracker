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

// Control characters are refused in addresses too (security recheck L5).
const EMAIL_CONTROLS = Object.freeze([[0x00, 0x1f], [0x7f, 0x9f]]);
function email(value, field, { required = false } = {}) {
  const out = normalizeEmail(value);
  if (!out) {
    if (required) throw badRequest(`${field} is required.`, 'missing_field');
    return '';
  }
  // Addresses are shown to other members too, so invisible and direction-changing characters are refused (SEC-V2).
  if (!EMAIL_RE.test(out) || out.length > 254 || invisible.firstForbidden(out, EMAIL_CONTROLS) !== null) throw badRequest(`${field} is not a valid email address.`, 'invalid_email');
  return out;
}

// A web address a person saves to open later, such as the staging link (BT-011-06). It builds on
// the rich-text link rule (richtext.safeLinkHref: "//" and no backslash, no control or invisible
// characters) and is stricter:
//   * https only; http only when `localHttp` (the API runs in local development, decided on the
//     server by version.localDevelopment) AND the host is a loopback host: 127.0.0.1, [::1] or
//     localhost, on any port (Terry, 2026-09-14);
//   * printable ASCII only (no spaces, and no look-alike Unicode host: international names are written
//     in their xn-- form) and at most `max` characters, before and after normalising;
//   * the authority as TYPED has no "@" (so no user name or password) and no "%", no port 0 or empty
//     port, and a host that is a normal DNS name, a dotted-quad IPv4 address or a bracketed IPv6
//     address: no hexadecimal, octal or shortened IP forms and no empty labels (security review of
//     d363eff, finding 5). The typed form is checked because the URL parser would quietly turn
//     "0x7f.1" into 127.0.0.1 and "%65vil" into "evil";
//   * the value returned, and stored, is the normalised `new URL(value).href`.
// The browser applies the same rule before it draws the link (app/js/core/links.js; a mirror test runs
// identical cases through both). ANY FUTURE CONSUMER of a stored address (notifications, exports,
// emails) must pass it through this function again rather than trust what is stored (finding 6).
const WEB_ADDRESS_CHARS = /^[\x21-\x7e]+$/;
const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '[::1]', 'localhost']);
const IPV4_PART = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const DOTTED_QUAD = new RegExp(`^${IPV4_PART}(\\.${IPV4_PART}){3}$`);
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
// A last label the URL parser would read as a number (decimal, or 0x hexadecimal) makes it an IPv4 address.
const NUMERIC_LABEL = /^(\d+|0x[0-9a-f]*)$/i;

function typedHostOk(host) {
  if (host.startsWith('[')) return /^\[[0-9a-f:.]+\]$/i.test(host);
  if (DOTTED_QUAD.test(host)) return true;
  if (host.length > 253) return false;
  const labels = host.split('.');
  return labels.every((l) => DNS_LABEL.test(l)) && !NUMERIC_LABEL.test(labels[labels.length - 1]);
}

// The authority as typed: its host (lower case) and port, or null when the form is refused.
function typedAuthority(address) {
  const m = /^https?:\/\/([^/?#]*)/i.exec(address);
  if (!m || !m[1] || /[@%]/.test(m[1])) return null;
  const authority = m[1];
  let host = authority;
  let port = null;
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close < 0) return null;
    host = authority.slice(0, close + 1);
    const rest = authority.slice(close + 1);
    if (rest) { if (!rest.startsWith(':')) return null; port = rest.slice(1); }
  } else if (authority.includes(':')) {
    const parts = authority.split(':');
    if (parts.length !== 2) return null;
    [host, port] = parts;
  }
  if (port !== null && (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)) return null;
  return typedHostOk(host) ? { host: host.toLowerCase(), port } : null;
}

function webAddress(value, field, { max = 300, localHttp = false } = {}) {
  const refuse = (detail) => badRequest(`${field} ${detail}`, 'invalid_url');
  const rule = localHttp ? 'starting with https:// (or http:// for 127.0.0.1, [::1] or localhost while running locally)' : 'starting with https://';
  if (typeof value !== 'string') throw refuse(`must be a web address ${rule}.`);
  // Only ASCII spaces and line breaks around the address are trimmed: String.prototype.trim would
  // also strip a byte-order mark, and hidden characters are refused, never stripped.
  const cleaned = value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (cleaned.length > max) throw refuse(`must be at most ${max} characters.`);
  const invalid = () => refuse(`must be a web address ${rule}, without spaces, a user name, a password or hidden characters.`);
  // The link rule trims with String.prototype.trim, which would quietly drop a byte-order mark;
  // anything it would change is refused instead.
  if (!WEB_ADDRESS_CHARS.test(cleaned) || richtext.safeLinkHref(cleaned) !== cleaned) throw invalid();
  const typed = typedAuthority(cleaned);
  if (!typed) throw invalid();
  let url;
  try { url = new URL(cleaned); } catch { throw invalid(); }
  if (url.username || url.password || (!typed.host.startsWith('[') && url.hostname !== typed.host)) throw invalid();
  const loopback = LOOPBACK_HOSTS.includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && localHttp && loopback))) throw invalid();
  const href = url.href;
  if (href.length > max || !WEB_ADDRESS_CHARS.test(href)) throw refuse(`must be at most ${max} characters.`);
  return href;
}

// Rejects any unknown key so a client cannot smuggle server-owned fields through a body.
function onlyKeys(body, allowed) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw badRequest(`Unknown field: ${key.slice(0, 40)}.`, 'unknown_field');
  }
  return body;
}

module.exports = { text, richText, oneOf, bool, date, optionalId, idList, tags, email, webAddress, onlyKeys };
