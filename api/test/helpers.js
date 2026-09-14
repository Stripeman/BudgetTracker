'use strict';
// Test harness: real handlers, real runtime (identity parsing, CSRF, error shaping), in-memory
// storage and a controllable clock. All people and data are fictional.
const { invoke } = require('../_shared/runtime');
const { createMemoryStorage } = require('../_shared/storage');
const { ROUTES } = require('../_shared/routes');

const USERS = Object.freeze({
  alice: { userId: 'g-alice', email: 'alice@example.com', name: 'Alice Fictional' },
  bob: { userId: 'g-bob', email: 'bob@example.com', name: 'Bob Fictional' },
  carol: { userId: 'g-carol', email: 'carol@example.com', name: 'Carol Fictional' },
  dave: { userId: 'g-dave', email: 'dave@example.com', name: 'Dave Siteadmin' },
  eve: { userId: 'g-eve', email: 'eve@example.com', name: 'Eve Outsider' },
});

function principalHeader(user, overrides = {}) {
  const p = {
    identityProvider: 'google', userId: user.userId, userDetails: user.email,
    userRoles: ['anonymous', 'authenticated'], claims: [{ typ: 'name', val: user.name }], ...overrides,
  };
  return Buffer.from(JSON.stringify(p)).toString('base64');
}

// Fictional test-only backup keys, generated per process; never real key material.
const { randomBytes } = require('node:crypto');
const TEST_KEYS = { k1: randomBytes(32).toString('base64'), k2: randomBytes(32).toString('base64') };

function harness(options = {}) {
  const storage = options.storage || createMemoryStorage();
  const backupStorage = options.backupStorage || createMemoryStorage();
  let t = Date.parse(options.start || '2026-09-13T10:00:00Z');
  const clock = { now: () => t, advance: (ms) => { t += ms; }, iso: () => new Date(t).toISOString() };
  const env = {
    BT_SITE_ADMINS: 'dave@example.com', BT_ENVIRONMENT: 'local',
    BT_BACKUP_KEYS: `k1:${TEST_KEYS.k1}`, BT_BACKUP_ACTIVE_KEY: 'k1', ...(options.env || {}),
  };
  const handlers = {};
  async function call(route, method, { user, as, query = {}, body, headers = {}, csrf = true } = {}) {
    if (!handlers[route]) handlers[route] = require(`../${route}/handler.js`);
    const h = { ...headers };
    const who = user || (as ? USERS[as] : null);
    if (who) h['x-ms-client-principal'] = principalHeader(who);
    if (csrf && method !== 'GET') h['x-bt-request'] = '1';
    const res = await invoke(handlers[route], { method, headers: h, query, body }, { storage, backupStorage, env, now: clock.now, log: () => {} }, (ROUTES[route] || {}).options || {});
    return { status: res.status, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
  }
  return { storage, backupStorage, clock, env, call };
}

// Household fixture used by the permission matrix:
//   Alice: owner. Bob: member. Carol: viewer. Dave: site admin (not a member). Eve: outsider.
//   Joint: shared checking. AliceSavings: Alice private. BobCard: Bob private credit card.
async function household(h) {
  const ok = (res, status = 200) => { if (res.status !== status) throw new Error(`fixture step failed ${res.status} ${JSON.stringify(res.body)}`); return res.body; };
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Household', kind: 'household', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (as, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: USERS[as].email, role } }), 201);
    ok(await h.call('invitations', 'POST', { as, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  await join('carol', 'viewer');
  const account = async (as, body) => ok(await h.call('accounts', 'POST', { as, query: q, body }), 201).account;
  const joint = await account('alice', { name: 'Joint', type: 'checking', currency: 'EUR', visibility: 'shared', openingBalance: '1000.00' });
  const aliceSavings = await account('alice', { name: 'Alice Savings', type: 'savings', currency: 'EUR', openingBalance: '5000.00' });
  const bobCard = await account('bob', { name: 'Bob Card', type: 'credit-card', currency: 'EUR', terms: { creditLimit: '2000.00' } });
  const tx = async (as, body) => ok(await h.call('transactions', 'POST', { as, query: q, body }), 201).transactions[0];
  // Merchants are managed records chosen by id (BT-007-01): Bob's is private, Alice's shared.
  const jeweller = await merchant(h, q, 'bob', { name: 'Secret Jeweller' });
  const grocer = await merchant(h, q, 'alice', { name: 'Fictional Grocer', visibility: 'shared' });
  const secret = await tx('bob', { accountId: bobCard.id, kind: 'expense', amount: '250.00', payeeId: jeweller.id, date: '2026-09-10' });
  const grocery = await tx('alice', { accountId: joint.id, kind: 'expense', amount: '82.40', payeeId: grocer.id, date: '2026-09-11' });
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const memberId = (name) => members.find((m) => m.name.startsWith(name)).id;
  return { ws, q, joint, aliceSavings, bobCard, secret, grocery, memberId, merchants: { jeweller, grocer } };
}

async function merchant(h, q, as, body) {
  const res = await h.call('payees', 'POST', { as, query: q, body });
  if (res.status !== 201) throw new Error(`merchant fixture failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.payee;
}

module.exports = { USERS, TEST_KEYS, principalHeader, harness, household, merchant };
