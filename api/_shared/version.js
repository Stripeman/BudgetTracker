'use strict';
// Application version and environment, shown in the app so every Staging review names the
// exact build. api/version.json must equal the root version.json (checked by the validator).
const { version, channel } = require('../version.json');

// "preview" is the named preview environment of the single BudgetTracker Static Web App (fictional
// data, its own storage accounts). A separate Staging instance can be added later as "staging".
const ENVIRONMENTS = ['local', 'preview', 'staging', 'production'];

// The commit the RUNNING code was built from, stamped into the artifact by scripts/build-artifact.mjs
// (api/build.json, never in the repository). It wins over the BT_COMMIT setting, which only shows
// that a setting changed: on 2026-09-13 a preview deploy set BT_COMMIT while the API kept running
// older code (release readiness D2). Absent in development and tests.
const SHA = /^[0-9a-f]{7,40}$/;
let STAMPED = null;
try {
  const stamp = require('../build.json');
  if (stamp && SHA.test(stamp.commit || '')) STAMPED = stamp.commit;
} catch { STAMPED = null; }

function appInfo(env, stamped = STAMPED) {
  const environment = ENVIRONMENTS.includes(env.BT_ENVIRONMENT) ? env.BT_ENVIRONMENT : 'unconfigured';
  const setting = SHA.test(env.BT_COMMIT || '') ? env.BT_COMMIT : null;
  return { name: 'BudgetTracker', version, channel, environment, commit: stamped || setting };
}

module.exports = { appInfo, version };
