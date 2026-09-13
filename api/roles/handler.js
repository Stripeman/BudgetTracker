'use strict';
// POST /api/roles — Static Web Apps `rolesSource`. SWA calls this at sign-in with the identity
// it has just verified and caches the returned roles for the session. The `siteadmin` role is
// only a coarse route gate; every function re-checks BT_SITE_ADMINS on each request, so a
// revoked administrator loses access immediately. Roles never include financial access.
const { readBody } = require('../_shared/http');
const { isSiteAdmin, normalizeEmail } = require('../_shared/identity');

async function post(ctx, req) {
  let body = {};
  try { body = readBody(req); } catch { return { body: { roles: [] } }; }
  const provider = typeof body.identityProvider === 'string' ? body.identityProvider.toLowerCase() : '';
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const email = normalizeEmail(body.userDetails);
  if (!provider || !userId || !email) return { body: { roles: [] } };
  const roles = isSiteAdmin({ subject: `${provider}:${userId}`, email }, ctx.env) ? ['siteadmin'] : [];
  return { body: { roles } };
}

module.exports = { POST: post };
