'use strict';
// Adapts plain handlers `{ GET(ctx, req), POST(ctx, req), ... }` to Azure Functions v3 and to
// tests. Handlers return `{ status?, body?, headers? }` or throw HttpError.
//
// CSRF: every state-changing request must carry `X-BT-Request: 1`. A cross-site form cannot set
// a custom header, and the API allows no cross-origin requests, so a forged submission is refused
// before any handler runs.
const { randomBytes } = require('node:crypto');
const { respond, errorResponse, header, methodNotAllowed, forbidden, unavailable } = require('./http');
const { requirePrincipal, principalFrom, isSiteAdmin } = require('./identity');
const { createBlobStorage, createFileStorage } = require('./storage');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let cachedStorage = null;

// Storage selection fails closed. File storage is local development only and is refused when
// Azure environment markers are present, so it can never be what a deployment uses.
function storageFor(env) {
  if (cachedStorage) return cachedStorage;
  const mode = env.BT_STORAGE;
  if (mode === 'blob') {
    cachedStorage = createBlobStorage({ connectionString: env.BT_STORAGE_CONNECTION_STRING, container: env.BT_DATA_CONTAINER });
  } else if (mode === 'file') {
    if (env.BT_LOCAL_DEV !== '1' || env.WEBSITE_SITE_NAME || env.WEBSITE_INSTANCE_ID) {
      throw unavailable('storage_not_configured', 'Local file storage is only available in local development.');
    }
    if (!env.BT_FILE_STORAGE_DIR) throw unavailable('storage_not_configured', 'Local storage directory is not configured.');
    cachedStorage = createFileStorage(env.BT_FILE_STORAGE_DIR);
  } else {
    throw unavailable('storage_not_configured', 'Storage is not configured.');
  }
  return cachedStorage;
}

async function invoke(handlers, req, deps, options = {}) {
  const requestId = randomBytes(6).toString('hex');
  const env = deps.env || {};
  try {
    const method = String((req && req.method) || 'GET').toUpperCase();
    const fn = Object.prototype.hasOwnProperty.call(handlers, method) ? handlers[method] : null;
    if (!fn) throw methodNotAllowed();
    // `csrfExempt` is only for the SWA rolesSource callback, which SWA calls server-to-server
    // and which changes no state.
    if (MUTATING.has(method) && !options.csrfExempt && header(req, 'x-bt-request') !== '1') throw forbidden('This request is missing its protection header.');
    const principal = options.anonymous ? principalFrom(req, env) : requirePrincipal(req, env);
    const storage = deps.storage || storageFor(env);
    const now = deps.now || (() => Date.now());
    const ctx = Object.freeze({
      principal, env, storage, now, requestId, log: deps.log,
      nowIso: () => new Date(now()).toISOString(),
      siteAdmin: principal ? isSiteAdmin(principal, env) : false,
    });
    const out = (await fn(ctx, req)) || {};
    return respond(out.status || 200, out.body, out.headers);
  } catch (err) {
    return errorResponse(err, deps.log, requestId);
  }
}

// Azure Functions v3 entry point.
function route(handlers, options = {}) {
  return async function azureFunction(context, req) {
    context.res = await invoke(handlers, req, { env: process.env, log: context.log }, options);
  };
}

module.exports = { invoke, route, storageFor, _resetStorage: () => { cachedStorage = null; } };
