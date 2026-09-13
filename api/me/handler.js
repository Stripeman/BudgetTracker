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
  return {
    body: {
      user: { name: user.name || '', email: user.email, siteAdmin: ctx.siteAdmin },
      workspaces,
      preferences: { stored, ...prefs._resolve(stored, siteDoc) },
      site: site.publicView(siteDoc, true),
      app: appInfo(ctx.env),
    },
  };
}

module.exports = { GET: get };
