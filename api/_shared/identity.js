'use strict';
// THE ONLY IDENTITY ADAPTER. Azure Static Web Apps authenticates the user (Google) and injects
// `x-ms-client-principal` on requests that reach the managed Functions API. Nothing else a
// client sends about who it is — ids, emails, roles, flags in bodies — is ever trusted.
//
// Assumption (recorded in SECURITY.md): the Functions app is reachable only through Static Web
// Apps (managed functions), so a client cannot supply this header directly. The local dev server
// injects it on loopback only and refuses to run where Azure environment markers exist.
//
// Output is a frozen null-prototype object of plain strings, so inherited or getter properties
// can never influence an authorization decision (review finding 6).
const { header, safeParse, unauthorized } = require('./http');
const { sha256Hex } = require('./ids');

const PRINCIPAL_HEADER = 'x-ms-client-principal';
const USER_ID_RE = /^[A-Za-z0-9_.:@|-]{1,128}$/;
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,63}$/;

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function listSetting(env, name) {
  return String((env && env[name]) || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function allowedProviders(env) {
  const configured = listSetting(env, 'BT_AUTH_PROVIDERS').map((s) => s.toLowerCase());
  return configured.length ? configured : ['google'];
}

function claim(claims, type) {
  if (!Array.isArray(claims)) return '';
  for (const c of claims) {
    if (c && typeof c.typ === 'string' && typeof c.val === 'string' && (c.typ === type || c.typ.endsWith(`/${type}`))) return c.val;
  }
  return '';
}

function principalFrom(req, env) {
  const raw = header(req, PRINCIPAL_HEADER);
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 16384) return null;
  let parsed;
  try { parsed = safeParse(Buffer.from(raw, 'base64').toString('utf8')); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const provider = typeof parsed.identityProvider === 'string' ? parsed.identityProvider.toLowerCase() : '';
  if (!allowedProviders(env).includes(provider)) return null;
  const userId = typeof parsed.userId === 'string' ? parsed.userId : '';
  if (!USER_ID_RE.test(userId)) return null;
  const email = normalizeEmail(parsed.userDetails);
  if (!EMAIL_RE.test(email)) return null;
  const roles = Array.isArray(parsed.userRoles) ? parsed.userRoles : [];
  if (!roles.includes('authenticated')) return null;
  const name = claim(parsed.claims, 'name').slice(0, 120);
  const out = Object.create(null);
  out.subject = `${provider}:${userId}`;
  out.provider = provider;
  out.email = email;
  out.name = name && !name.includes('@') ? name : '';
  return Object.freeze(out);
}

function requirePrincipal(req, env) {
  const principal = principalFrom(req, env);
  if (!principal) throw unauthorized();
  return principal;
}

// Site administration is OPERATIONAL authority only. It is re-read from configuration on every
// request (so revocation is immediate) and is never an input to financial authorization.
// `subjectOnly` is used by the anonymous rolesSource endpoint: matching a caller-supplied email
// there would let anyone confirm which addresses are site administrators (security review
// finding 7). Provider subjects are opaque, so matching them discloses nothing useful.
function isSiteAdmin(principal, env, { subjectOnly = false } = {}) {
  if (!principal) return false;
  const entries = listSetting(env, 'BT_SITE_ADMINS').map((s) => s.toLowerCase());
  if (entries.includes(String(principal.subject).toLowerCase())) return true;
  return !subjectOnly && entries.includes(principal.email);
}

// Storage key for one person's document: a hash, so a provider id or email never forms a path.
function userKey(subject) {
  return sha256Hex(`user:${subject}`);
}

module.exports = { PRINCIPAL_HEADER, principalFrom, requirePrincipal, isSiteAdmin, normalizeEmail, userKey, EMAIL_RE };
