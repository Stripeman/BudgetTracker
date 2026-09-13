'use strict';
// Application version and environment, shown in the app so every Staging review names the
// exact build. api/version.json must equal the root version.json (checked by the validator).
const { version, channel } = require('../version.json');

// "preview" is the named preview environment of the single BudgetTracker Static Web App (fictional
// data, its own storage accounts). A separate Staging instance can be added later as "staging".
const ENVIRONMENTS = ['local', 'preview', 'staging', 'production'];

function appInfo(env) {
  const environment = ENVIRONMENTS.includes(env.BT_ENVIRONMENT) ? env.BT_ENVIRONMENT : 'unconfigured';
  return { name: 'BudgetTracker', version, channel, environment, commit: /^[0-9a-f]{7,40}$/.test(env.BT_COMMIT || '') ? env.BT_COMMIT : null };
}

module.exports = { appInfo, version };
