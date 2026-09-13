'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scanPath, scanContent } = require('../scripts/scan-staged.cjs');

const rules = findings => findings.map(f => f.rule).sort();

test('BT-003-03 blocks private paths regardless of ignore rules', () => {
  for (const [file, rule] of [['.env', 'environment-file'], ['api/.env.production', 'environment-file'],
    ['api/local.settings.json', 'functions-local-settings'], ['certs/site.pfx', 'key-material'],
    ['backups/ws.btbackup', 'archive-or-backup'], ['statement.ofx', 'bank-export'],
    ['receipts/dinner.txt', 'private-data-directory'], ['budget.xlsx', 'spreadsheet'],
    ['Budget_Tracker_Project_Instructions.docx', 'document'], ['local.sqlite', 'local-database'],
    ['imports/bank.csv', 'private-data-directory'], ['bank.csv', 'csv-outside-fixtures'],
    ['photos/receipt.jpg', 'image-outside-assets']]) {
    assert.ok(rules(scanPath(file)).includes(rule), `${file} should raise ${rule}`);
  }
  assert.ok(rules(scanPath('backups/ws.json')).includes('private-data-directory'), 'root backups/ still blocked');
  assert.ok(rules(scanPath('api/__blobstorage__/x')).includes('emulator-state'), 'emulator state blocked at any depth');
  for (const file of ['.env.example', 'api/test/fixtures/fictional-bank.csv', 'app/assets/icon.png',
    'docs/PROJECT_BRIEF.md', 'api/_shared/money.js', 'api/backups/handler.js', 'api/backups/function.json',
    'scripts/recovery/drill.cjs']) {
    assert.deepEqual(scanPath(file), [], `${file} should be allowed`);
  }
});

test('BT-003-03 detects secrets and personal financial identifiers without echoing values', () => {
  // Assembled at runtime so this test file itself never contains a scannable literal.
  const cases = [
    ['AccountKey=' + 'A'.repeat(40), 'azure-storage-key'],
    ['GOCSPX-' + 'b'.repeat(20), 'google-client-secret'],
    ['gh' + 'p_' + 'c'.repeat(30), 'github-token'],
    ['-----BEGIN ' + 'PRIVATE KEY-----', 'private-key'],
    ['client_secret = "' + 'd'.repeat(16) + '"', 'assigned-secret'],
    ['contact ' + 'someone' + '@' + 'gmail.com', 'personal-email'],
    ['card 4111 1111 ' + '1111 1111', 'payment-card-number'],
    ['iban GB82 WEST ' + '1234 5698 7654 32', 'iban'],
  ];
  for (const [line, rule] of cases) {
    const found = scanContent('x.js', `ok\n${line}\n`);
    assert.ok(rules(found).includes(rule), `${rule} not detected`);
    assert.equal(found.find(f => f.rule === rule).line, 2);
    assert.ok(!JSON.stringify(found).includes(line.slice(-8)), 'finding must not echo the value');
  }
});

test('BT-003-03 allows fictional addresses, local emulator strings and non-card numbers', () => {
  const text = [
    'owner@example.com and reviewer@example.org',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    'AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true',
    'createdAt 1789300000000 amountMinor 4111111111111112',
    'ref GB00 NOTA REAL 0000 0000 00',
  ].join('\n');
  assert.deepEqual(scanContent('x.md', text), []);
});
