'use strict';
// /api/me — the boot payload: who you are, your workspaces, effective preferences, the public
// site settings and the application version/environment.
const { readDocument } = require('../_shared/schema');
const { activeMember } = require('../_shared/authz');
const store = require('../_shared/store');
const model = require('../_shared/workspace-model');
const site = require('../_shared/site');
const { appInfo } = require('../_shared/version');
const prefs = require('../preferences/handler');
const fields = require('../_shared/fields');
const { readBody } = require('../_shared/http');

async function get(ctx) {
  const user = await store.ensureUser(ctx);
  const workspaces = [];
  for (const id of user.workspaceIds || []) {
    const { value } = await ctx.storage.getJson(store.paths.workspace(id));
    const doc = readDocument('workspace', value);
    const member = doc && activeMember(doc, ctx.principal);
    if (member) workspaces.push(model.summary(doc, member));
  }
  const { site: siteDoc } = await site.readSite(ctx.storage);
  const stored = user.preferences || {};
  // The site's staging-link default reaches only site administrators and active members of at least
  // one workspace (security review of d363eff, finding 1). `workspaces` holds exactly the workspaces
  // where this person is an active member.
  const visible = ctx.siteAdmin || workspaces.length ? siteDoc : site.withoutStagingDefault(siteDoc);
  return {
    body: {
      // `subject` is the caller's own provider subject, shown so an operator can list it in
      // BT_SITE_ADMINS (the edge siteadmin role matches subjects only).
      user: { name: user.name || '', email: user.email, subject: ctx.principal.subject, siteAdmin: ctx.siteAdmin },
      workspaces,
      preferences: { stored, ...prefs._resolve(stored, visible) },
      site: site.publicView(visible, true),
      app: appInfo(ctx.env),
    },
  };
}

// PATCH { name } — the name other members see. Static Web Apps never passes the provider's claims
// (including its display name) to the API, only to /.auth/me, so without this every member showed as
// "Member" (Terry's preview check, 2026-09-14). The name is self-asserted, exactly like the provider's
// own display name, and validated like any text. It is saved to the person's profile and to their
// member record in every workspace they belong to; a self-set name is never overwritten by the
// provider's.
async function patch(ctx, req) {
  const body = fields.onlyKeys(readBody(req), ['name']);
  const name = fields.text(body.name, { field: 'Name', max: 80, required: true });
  let workspaceIds = [];
  await store.mutateUser(ctx, (user) => {
    workspaceIds = [...(user.workspaceIds || [])];
    if (user.name === name && user.nameSource === 'self') return undefined;
    user.name = name;
    user.nameSource = 'self';
    return true;
  });
  for (const id of workspaceIds) {
    try {
      await store.mutateWorkspace(ctx, id, (doc, member) => {
        if (member.name === name) return undefined;
        member.name = name;
        return { ok: true };
      }, { allowHeadroom: true });
    } catch (e) {
      // A workspace the person has left (or that is gone) keeps their earlier name.
      if (e.status !== 404) throw e;
    }
  }
  return get(ctx);
}

module.exports = { GET: get, PATCH: patch };
