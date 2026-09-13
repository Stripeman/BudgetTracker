'use strict';
// THE route registry: one place that names every function, its methods and its options. The
// function directories, staticwebapp.config.json and the validator are all checked against it.
const ROUTES = Object.freeze({
  me: { methods: ['GET'] },
  workspaces: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  members: { methods: ['GET', 'PATCH', 'DELETE'] },
  invitations: { methods: ['GET', 'POST', 'DELETE'] },
  grants: { methods: ['GET', 'POST', 'DELETE'] },
  accounts: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  transactions: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  payees: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  categories: { methods: ['GET', 'POST', 'PATCH'] },
  contacts: { methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  people: { methods: ['GET'] },
  preferences: { methods: ['GET', 'PUT'] },
  audit: { methods: ['GET'] },
  'site-settings': { methods: ['GET', 'PUT'], options: { anonymous: true } },
  roles: { methods: ['POST'], options: { anonymous: true, csrfExempt: true } },
});

module.exports = { ROUTES };
