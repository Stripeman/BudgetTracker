'use strict';
// THE route registry: one place that names every function, its methods and its options. The
// function directories, staticwebapp.config.json and the validator are all checked against it.
const ROUTES = Object.freeze({
  me: { methods: ['GET', 'PATCH'] },
  workspaces: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  members: { methods: ['GET', 'PATCH', 'DELETE'] },
  invitations: { methods: ['GET', 'POST', 'DELETE'] },
  grants: { methods: ['GET', 'POST', 'DELETE'] },
  accounts: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  transactions: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  // Merchants are archived, never a blind overwrite (BT-001-05): closing and reopening are POST
  // actions. Permanent deletion (BT-014) is also a POST action (?action=delete-impact /
  // delete-permanent), never a bare DELETE, so it can never be reached by mistake.
  payees: { methods: ['GET', 'POST', 'PATCH'] },
  categories: { methods: ['GET', 'POST', 'PATCH'] },
  // Workspace-scoped account TYPE definitions (BT-019-02): name, colour, icon, each mapped to one
  // of the fixed underlying accounting classes in ledger.js (ACCOUNT_TYPES) — never a second,
  // independent accounting model. Retired, never deleted, like every other managed type/directory
  // record in this codebase.
  'account-types': { methods: ['GET', 'POST', 'PATCH'] },
  // Workspace-scoped category TYPE definitions (BT-019-01): name, colour, icon, each mapped to one
  // of the two fixed category classes (expense/income) categories.js already uses — the same
  // presentation/behaviour separation as account-types above.
  'category-types': { methods: ['GET', 'POST', 'PATCH'] },
  // Workspace-scoped merchant TYPE definitions (BT-019-03): name, colour, icon, each mapped to one
  // of the fixed merchant classes merchants.js already uses — the same pattern as the two above.
  'merchant-types': { methods: ['GET', 'POST', 'PATCH'] },
  contacts: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  people: { methods: ['GET'] },
  preferences: { methods: ['GET', 'PUT'] },
  audit: { methods: ['GET'] },
  budgets: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  recurring: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  forecast: { methods: ['GET', 'POST'] },
  // Shared expenses and settlement (BT-009): expenses and payments are voided, never deleted.
  group: { methods: ['GET', 'POST', 'PATCH'] },
  // The icon catalogue (BT-011-05): icons are retired or switched off, never deleted.
  icons: { methods: ['GET', 'POST', 'PATCH'] },
  backups: { methods: ['GET', 'POST'] },
  restore: { methods: ['POST'] },
  'site-settings': { methods: ['GET', 'PUT'], options: { anonymous: true } },
  roles: { methods: ['POST'], options: { anonymous: true, csrfExempt: true } },
  // Site usage/activity aggregate (BT-012-01) and, since BT-014, the site-wide workspace directory
  // (?action=directory) and administrative workspace deletion (?action=delete-impact /
  // delete-permanent): site administrators only, never financial data — counts and operational
  // metadata only, enforced the same way as the usage dashboard above.
  analytics: { methods: ['GET', 'POST'] },
  // Design Gallery (BT-013): 20 layout-theme concepts for review, site administrators only. GET
  // returns the manifests, catalog overrides and Terry's recorded picks; PATCH records a catalog
  // change or a pick. Never financial data; never wired to a real workspace's data.
  'design-gallery': { methods: ['GET', 'PATCH'] },
});

module.exports = { ROUTES };
