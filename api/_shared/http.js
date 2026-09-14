'use strict';
// HTTP helpers shared by every function. Every error body is { error: { code, message } } so
// the client branches on `code`. Internal errors never reach the client and are logged only as
// codes and stack frames — never messages, request bodies or financial values.

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const badRequest = (message, code = 'bad_request', details) =>
  new HttpError(400, code, message || 'The request is not valid.', details);
const unauthorized = () => new HttpError(401, 'unauthenticated', 'Sign in to continue.');
const forbidden = (message) => new HttpError(403, 'forbidden', message || 'You do not have permission to do that.');
// Not found is also what a caller receives for something that exists but is outside their
// authorization, so a response never confirms that another workspace or record exists.
const notFound = (message) => new HttpError(404, 'not_found', message || 'Not found.');
const methodNotAllowed = () => new HttpError(405, 'method_not_allowed', 'That method is not supported here.');
const conflict = (message, code = 'conflict', details) =>
  new HttpError(409, code, message || 'That changed while you were editing it. Reload and try again.', details);
const tooLarge = (message) => new HttpError(413, 'too_large', message || 'That is too large.');
const unavailable = (code, message) => new HttpError(503, code, message || 'The service is temporarily unavailable.');

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// JSON.parse that cannot pollute prototypes: dangerous keys are dropped during parsing.
function safeParse(text) {
  return JSON.parse(text, (key, value) => (UNSAFE_KEYS.has(key) ? undefined : value));
}

const MAX_BODY_BYTES = 1024 * 1024;

// Azure Functions may hand over a parsed object, a string or a Buffer. All three are normalized
// through text so every body is parsed by safeParse and bounded by size.
function readBody(req, maxBytes = MAX_BODY_BYTES) {
  const raw = req && (req.rawBody !== undefined ? req.rawBody : req.body);
  if (raw === undefined || raw === null || raw === '') return {};
  let text;
  if (Buffer.isBuffer(raw)) text = raw.toString('utf8');
  else if (typeof raw === 'string') text = raw;
  else text = JSON.stringify(raw);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw tooLarge('The request body is too large.');
  let value;
  try { value = safeParse(text); } catch { throw badRequest('The request body is not valid JSON.', 'invalid_json'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('The request body must be a JSON object.', 'invalid_json');
  return value;
}

function header(req, name) {
  const headers = (req && req.headers) || {};
  const wanted = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return null;
}

function query(req, name) {
  const q = (req && req.query) || {};
  const value = Object.prototype.hasOwnProperty.call(q, name) ? q[name] : undefined;
  return value === undefined || value === '' ? undefined : String(value);
}

const BASE_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  // Financial responses must never be cached by a shared or private cache.
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
});

function respond(status, body, headers) {
  return {
    status,
    headers: { ...BASE_HEADERS, ...(headers || {}) },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

function logInternal(log, err, requestId) {
  if (!log) return;
  const frames = String((err && err.stack) || '').split('\n').slice(1, 6).map((l) => l.trim());
  const entry = { requestId, name: err && err.name, code: err && err.code, frames };
  (log.error || log)(`internal_error ${JSON.stringify(entry)}`);
}

function errorResponse(err, log, requestId) {
  if (err instanceof HttpError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return respond(err.status, body);
  }
  if (err && err.code === 'precondition_failed') {
    return respond(409, { error: { code: 'conflict', message: 'That changed while you were editing it. Reload and try again.' } });
  }
  logInternal(log, err, requestId);
  return respond(500, { error: { code: 'server_error', message: 'Something went wrong on our side. No details were recorded about your data.', requestId } });
}

module.exports = {
  HttpError, badRequest, unauthorized, forbidden, notFound, methodNotAllowed, conflict, tooLarge,
  unavailable, safeParse, readBody, header, query, respond, errorResponse, MAX_BODY_BYTES,
};
