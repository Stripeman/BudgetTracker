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
  // Merchants are never deleted (BT-001-05): closing and reopening are POST actions.
  payees: { methods: ['GET', 'POST', 'PATCH'] },
  categories: { methods: ['GET', 'POST', 'PATCH'] },
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
  // Site usage/activity aggregate (BT-012-01): site administrators only, never financial data.
  analytics: { methods: ['GET'] },
  // Design Gallery (BT-013): 20 layout-theme concepts for review, site administrators only. GET
  // returns the manifests, catalog overrides and Terry's recorded picks; PATCH records a catalog
  // change or a pick. Never financial data; never wired to a real workspace's data.
  'design-gallery': { methods: ['GET', 'PATCH'] },
});

module.exports = { ROUTES };
