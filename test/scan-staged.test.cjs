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

test('BT-003-03 lockfile deprecation notices are the only place a real-looking address is allowed', () => {
  // Assembled at runtime so this file never contains a scannable address.
  const address = 'maintainer' + '@' + 'package-author.dev';
  const deprecation = `      "deprecated": "Old versions are unsupported; contact ${address}",`;
  assert.deepEqual(scanContent('package-lock.json', deprecation), [], 'npm deprecation metadata in a lockfile');
  assert.deepEqual(scanContent('api/package-lock.json', deprecation), [], 'nested lockfile');
  const otherField = `      "author": "${address}",`;
  assert.ok(rules(scanContent('package-lock.json', otherField)).includes('personal-email'), 'any other lockfile field still blocks');
  assert.ok(rules(scanContent('notes.md', deprecation)).includes('personal-email'), 'the same text elsewhere still blocks');
  assert.ok(rules(scanContent('package.json', deprecation)).includes('personal-email'), 'package.json is not a lockfile');
});

test('BT-003-03 copyright lines in a vendored bundle banner are the only vendored place an address is allowed', () => {
  // Assembled at runtime so this file never contains a scannable address.
  const address = 'author' + '@' + 'package-author.dev';
  const vendored = 'app/js/vendor/tiptap/tiptap-bundle.js';
  const bundle = ['/*', ' * GENERATED FILE - DO NOT EDIT BY HAND.', ` *     Copyright (C) 2015 by Some Author <${address}>`, ' */', `var contact="${address}";`].join('\n');
  const emails = (file, text) => scanContent(file, text).filter((f) => f.rule === 'personal-email').map((f) => f.line);
  assert.deepEqual(emails(vendored, bundle), [5], 'the banner copyright line is allowed; the same address in the code still blocks');
  assert.deepEqual(emails('app/js/ui/shell.js', bundle), [3, 5], 'the same banner outside app/js/vendor still blocks');
  assert.deepEqual(emails(vendored, ['var a = 1;', ` *     Copyright (C) 2015 by Some Author <${address}>`].join('\n')), [2], 'no opening comment, no exception');
  assert.deepEqual(emails(vendored, ['/*', ' * notices', ' */', ` *     Copyright (C) 2015 by Some Author <${address}>`].join('\n')), [4], 'only inside the opening comment');
  assert.deepEqual(emails(vendored, ['/*', ` * contact ${address}`, ' */'].join('\n')), [2], 'only copyright lines, not any line of the banner');
});

test('BT-003-03 SEC-R6 the banner exemption covers only addresses, only registered bundles and only a bounded generated banner', () => {
  // Assembled at runtime so this file never contains a scannable address or card number.
  const address = 'author' + '@' + 'package-author.dev';
  const card = '4111 1111 ' + '1111 1111';
  const banner = (extra = []) => ['/*', ' * GENERATED FILE - DO NOT EDIT BY HAND.', ...extra,
    ` *     Copyright (C) 2015 by Some Author <${address}>`, ` *     Copyright (C) 2016 card ${card}`, ' */', 'var a=1;'].join('\n');
  const found = (file, text) => rules(scanContent(file, text));
  const bundle = 'app/js/vendor/tiptap/tiptap-bundle.js';
  assert.deepEqual(found(bundle, banner()), ['payment-card-number'], 'card numbers are still found on copyright lines');
  for (const file of ['docs/app/js/vendor/tiptap/x.js', 'app/js/vendor/other/x.js', 'app/js/vendor/tiptap/nested/x.js']) {
    assert.ok(found(file, banner()).includes('personal-email'), `${file} is not a registered bundle`);
  }
  assert.ok(found(bundle, banner(Array.from({ length: 400 }, () => ' * filler'))).includes('personal-email'), 'a banner that does not close nearby is not a banner');
  assert.ok(found(bundle, banner().replace('GENERATED FILE', 'NOTICE')).includes('personal-email'), 'only the generator\'s banner');
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
