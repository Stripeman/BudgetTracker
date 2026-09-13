'use strict';
// The version the API reports names the code it actually runs (release readiness D2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appInfo } = require('../_shared/version');

test('the commit stamped into the artifact wins over the BT_COMMIT setting', () => {
  const setting = 'a3d8c162a7f273ec2ea16ef435190e97caba0be2';
  const stamped = '841d151ef64ce720dbdf6c922d82dd6e4650c011';
  // A stale setting (as on the 41ec172 preview deploy) cannot hide which code runs.
  assert.equal(appInfo({ BT_ENVIRONMENT: 'preview', BT_COMMIT: setting }, stamped).commit, stamped);
  // Without a stamp (development and tests) the setting is used, and anything else is null.
  assert.equal(appInfo({ BT_ENVIRONMENT: 'preview', BT_COMMIT: setting }, null).commit, setting);
  assert.equal(appInfo({ BT_ENVIRONMENT: 'production', BT_COMMIT: 'not-a-sha' }, null).commit, null);
  assert.equal(appInfo({ BT_ENVIRONMENT: 'production' }, null).environment, 'production');
});
