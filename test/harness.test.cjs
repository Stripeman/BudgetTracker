'use strict';
// Guard rails of the multi-user browser harness (BT-004-06): it never uses the other local
// application's ports or Terry's dev server port, writes only strictly inside .local/, and the dev
// server's optional data root cannot point outside .local/. The browser scenarios themselves run with
// `npm run e2e` (they need Microsoft Edge), not here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

test('the harness refuses reserved ports and accepts an ordinary free one', async () => {
  const g = await load('scripts/dev/harness/guards.mjs');
  for (const port of [4280, 4380, 7071, 10000, 10001, 10002]) assert.throws(() => g.assertAllowedPort(port), /reserved/, String(port));
  for (const port of [0, 80, 1023, 65536, 45123.5, '45123']) assert.throws(() => g.assertAllowedPort(port), /not a usable/, String(port));
  assert.equal(g.assertAllowedPort(45123), 45123);
  const free = await g.freePort();
  assert.ok(Number.isInteger(free) && !g.RESERVED_PORTS.includes(free));
});

test('the harness writes only strictly inside .local/', async () => {
  const g = await load('scripts/dev/harness/guards.mjs');
  const inside = path.join(ROOT, '.local', 'e2e', 'run-1', 'data');
  assert.equal(g.assertUnderLocal(inside), inside);
  for (const outside of [ROOT, path.join(ROOT, '.local'), path.join(ROOT, '.localother', 'x'), path.join(ROOT, '.local', '..', 'api'), path.join(ROOT, 'api'), path.parse(ROOT).root]) {
    assert.throws(() => g.assertUnderLocal(outside), /not inside \.local/, outside);
  }
});

test('the dev server data root: unchanged by default, and an override must be inside .local/', async () => {
  const d = await load('scripts/dev/dataroot.mjs');
  const standard = d.resolveDataRoot({}, ROOT);
  assert.deepEqual([standard.dataDir, standard.backupDir, standard.keyFile], [path.join(ROOT, '.local', 'dev-data'), path.join(ROOT, '.local', 'dev-backups'), path.join(ROOT, '.local', 'dev-backup-key')]);
  const run = path.join(ROOT, '.local', 'e2e', 'run-1', 'data');
  assert.equal(d.resolveDataRoot({ BT_DEV_DATA_ROOT: run }, ROOT).dataDir, path.join(run, 'dev-data'));
  for (const bad of [ROOT, path.join(ROOT, '.local'), path.join(ROOT, '.local', '..', 'data'), path.join(ROOT, 'data')]) {
    assert.throws(() => d.resolveDataRoot({ BT_DEV_DATA_ROOT: bad }, ROOT), /inside \.local/, bad);
  }
});

test('scenario selection options', async () => {
  const g = await load('scripts/dev/harness/guards.mjs');
  assert.deepEqual(g.parseArgs([]), { only: null, keepData: false, list: false, help: false });
  assert.deepEqual(g.parseArgs(['--only', 'privacy,shared', '--only=guards', '--keep-data']).only, ['privacy', 'shared', 'guards']);
  assert.equal(g.parseArgs(['--keep-data']).keepData, true);
  assert.throws(() => g.parseArgs(['--only']), /needs one or more/);
  assert.throws(() => g.parseArgs(['--bogus']), /Unknown option/);
});
