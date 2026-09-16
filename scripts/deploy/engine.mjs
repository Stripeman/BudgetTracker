// BudgetTracker deployment engine (BT-003-05 consolidation, 2026-09-16).
//
// This module is the ONLY place that knows how to deploy BudgetTracker to Azure. deploy.ps1 is
// an INTERFACE over it, not an implementation: every gating rule (clean tree, branch, tenant,
// production confirmation, gate ordering, receipt) lives here, so invoking this engine directly
// with `node scripts/deploy/engine.mjs ...` enforces exactly the same rules deploy.ps1 does —
// there is no weaker path. See docs/DEPLOYMENT.md "Deployment procedure" and the reconciliation
// note in PROJECT_STATE.md for why this replaced the single-file deploy.ps1.
//
// Adapted from TaskTracker's proven "thin CLI over a shared engine" structure (T: main, read-only
// via `git show`) — deliberately NOT a line-for-line port. TaskTracker's engine has a browser
// Setup Wizard, a `--ci` token-authenticated mode and `--skip-tests`/`--skip-live-check` escape
// hatches; none of those exist here. BudgetTracker's brief requires the complete gate — test,
// validate, build, secret-scan, and a real post-deploy health check — EVERY time, with no flag to
// weaken it, and Terry's own typed production confirmation is never suspended (TaskTracker
// currently suspends its interactive prompt "for the beta phase" — a historical deployment
// exception this repository's rules say not to copy).
//
// This file performs ONLY read-only Git operations (status, fetch, rev-parse). It never pushes,
// merges or commits.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACT_DIR = path.join(ROOT, ".local", "artifact");
const SITE_PATH = path.join(ARTIFACT_DIR, "site");
const API_PATH = path.join(ARTIFACT_DIR, "api");

export class DeployError extends Error {}

// There is deliberately no default and no "staging" entry yet (docs/DEPLOYMENT.md: no separate
// Staging app exists). Adding staging later is meant to be exactly this: one more name here, one
// more block in .local/deploy-target.json's shape, nothing structural.
export const ENVIRONMENTS = ["preview", "production"];

const GUID_RE = /^[0-9a-f-]{36}$/i;
const REQUIRED_SETTINGS = [
  "BT_ENVIRONMENT",
  "BT_STORAGE_CONNECTION_STRING",
  "BT_BACKUP_CONNECTION_STRING",
  "BT_BACKUP_KEYS",
  "BT_BACKUP_ACTIVE_KEY",
  "BT_SITE_ADMINS",
];

// ---------------------------------------------------------------------------
// Pure, independently-testable rules. No process spawning, no network, no fs beyond what the
// caller hands in. These are the functions the bypass-proof tests exercise directly.
// ---------------------------------------------------------------------------

/** Reads .local/deploy-target.json (gitignored, operator-supplied). Returns null if absent. */
export function loadDeployTarget(root = ROOT) {
  const file = path.join(root, ".local", "deploy-target.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new DeployError(".local/deploy-target.json could not be parsed as JSON. Nothing was deployed.");
  }
}

/**
 * Resolves the deployment target. Explicit flags win over .local/deploy-target.json. Fails
 * closed (BT brief: "fail closed when configuration is missing or ambiguous") rather than
 * inferring anything from ambient `az` context.
 */
export function resolveTarget({ environment, subscriptionId, tenantId, resourceGroup, swaName, deployTarget }) {
  if (!environment || !ENVIRONMENTS.includes(environment)) {
    throw new DeployError(
      `Unknown or missing environment "${environment ?? ""}". Known environments: ${ENVIRONMENTS.join(", ")}. There is no default; -Environment is required.`
    );
  }
  const sub = subscriptionId || deployTarget?.subscriptionId;
  const ten = tenantId || deployTarget?.tenantId;
  const rg = resourceGroup || deployTarget?.resourceGroup || "budget-tracker";
  const swa = swaName || deployTarget?.swaName || "budget-tracker";
  if (!sub || !ten) {
    throw new DeployError(
      "Subscription and tenant are not configured. Pass -SubscriptionId/-TenantId, or create " +
      ".local/deploy-target.json with \"subscriptionId\" and \"tenantId\" (docs/DEPLOYMENT.md). Nothing was deployed."
    );
  }
  if (!GUID_RE.test(sub) || !GUID_RE.test(ten)) {
    throw new DeployError("Subscription id or tenant id is not a GUID. Nothing was deployed.");
  }
  return { environment, subscriptionId: sub, tenantId: ten, resourceGroup: rg, swaName: swa };
}

/**
 * Validates the source branch, commit and working tree. Every deployment is tied to an exact
 * commit: a dirty tree would publish something that is not that commit (this happened once in
 * preview on 2026-09-13 and is recorded in PROJECT_STATE.md).
 */
export function checkGitState({ environment, branch, commit, dirty, detached, originMainCommit }) {
  if (detached) {
    return { ok: false, reason: "HEAD is detached. Deploy from a named branch so the deployed commit is understood." };
  }
  if (dirty) {
    return {
      ok: false,
      reason: "Commit your changes first: deployments must come from a clean tree so the deployed artifact equals the recorded commit.",
    };
  }
  if (environment === "production") {
    if (branch !== "main") return { ok: false, reason: "Production deploys only from main." };
    if (!originMainCommit) return { ok: false, reason: "Could not read origin/main. Nothing was deployed." };
    if (commit !== originMainCommit) return { ok: false, reason: "HEAD must equal origin/main. Nothing was deployed." };
  }
  return { ok: true };
}

/** Production requires typing the exact Static Web App name. Never suspended, never optional. */
export function checkProductionConfirmation({ typed, swaName }) {
  if (typed !== swaName) return { ok: false, reason: "Confirmation did not match the Static Web App name. Nothing was deployed." };
  return { ok: true };
}

/**
 * "Storage scope" and "application settings" validation (BT brief bullet list): the target
 * environment must already carry every setting the API refuses to start without, and its data
 * and backup connection strings must differ — Preview and Production, and data and backups, stay
 * isolated. Values are compared in memory only and never returned to a caller that might log them.
 */
export function verifyIsolatedSettings({ environment, settingNames, storageConnectionString, backupConnectionString, reportedEnvironment }) {
  const missing = REQUIRED_SETTINGS.filter((name) => !settingNames.includes(name));
  if (missing.length) {
    return {
      ok: false,
      reason: `The ${environment} environment is missing required application settings: ${missing.join(", ")}. Run scripts/deploy/configure-settings.ps1 first. Nothing was deployed.`,
    };
  }
  if (storageConnectionString && backupConnectionString && storageConnectionString === backupConnectionString) {
    return {
      ok: false,
      reason: "Data and backup storage connection strings are identical. Nothing was deployed.",
    };
  }
  if (reportedEnvironment && reportedEnvironment !== environment) {
    return {
      ok: false,
      reason: `The target reports BT_ENVIRONMENT=${reportedEnvironment}, not ${environment}. Refusing to deploy into a mismatched environment.`,
    };
  }
  return { ok: true };
}

/** The post-deploy health check: a real claim, separate from "the upload succeeded". */
export function evaluateHealth({ versionResponse, siteSettingsResponse, expectedCommit, expectedEnvironment, expectedVersion, hostname }) {
  if (!versionResponse || versionResponse.status !== 200) {
    return { ok: false, message: `https://${hostname}/version.json returned ${versionResponse ? versionResponse.status : "no response"}` };
  }
  if (!siteSettingsResponse || siteSettingsResponse.status !== 200) {
    return { ok: false, message: `https://${hostname}/api/site-settings returned ${siteSettingsResponse ? siteSettingsResponse.status : "no response"}` };
  }
  const liveCommit = siteSettingsResponse.body?.app?.commit;
  const liveEnvironment = siteSettingsResponse.body?.app?.environment;
  const liveVersion = siteSettingsResponse.body?.app?.version || versionResponse.body?.version;
  if (liveEnvironment !== expectedEnvironment) {
    return { ok: false, message: `live environment is "${liveEnvironment}", expected "${expectedEnvironment}". Refusing to call this healthy.` };
  }
  if (!liveCommit || liveCommit !== expectedCommit) {
    return { ok: false, message: `live commit is ${liveCommit || "unknown"}, expected ${expectedCommit} (it can lag briefly after upload; recheck).` };
  }
  const versionNote = liveVersion && liveVersion !== expectedVersion ? ` (reported version ${liveVersion}, package.json says ${expectedVersion})` : "";
  return { ok: true, message: `live at https://${hostname}, commit and environment verified${versionNote}` };
}

// ---------------------------------------------------------------------------
// Default (real) I/O adapters. Every Azure/Git/network call the engine makes is behind this
// object so tests can inject fakes and never touch a real subscription or the real Git remote.
// The Git adapter exposes ONLY read-only operations (status, fetch of origin/main, rev-parse) —
// there is no push or merge capability anywhere in this object.
// ---------------------------------------------------------------------------

// git and node ship as real .exe files on Windows, so their plain names resolve without a shell.
// npm, npx and az ship as .cmd batch wrappers on Windows: invoking "npm.cmd" directly (no shell)
// fails with EINVAL, so calls to them additionally pass `shell: WIN` (verified empirically before
// this shipped: plain "npm"/"az" fail with ENOENT, "npm.cmd"/"az.cmd" without a shell fail with
// EINVAL, and only "npm.cmd"/"az.cmd" WITH a shell succeed).
const WIN = process.platform === "win32";
function bin(name) {
  return WIN ? `${name}.cmd` : name;
}
function shellOpt() {
  return WIN ? { shell: true } : {};
}

function readVersion(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.version;
}

function gitStatus(root = ROOT) {
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim().length > 0;
  return { branch, commit, dirty, detached: branch === "" };
}

function gitOriginMainCommit(root = ROOT) {
  execFileSync("git", ["fetch", "origin", "main", "--quiet"], { cwd: root, stdio: "inherit" });
  return execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
}

function azTenantOf(subscriptionId) {
  return execFileSync(bin("az"), ["account", "show", "--subscription", subscriptionId, "--query", "tenantId", "-o", "tsv", "--only-show-errors"], {
    encoding: "utf8",
    ...shellOpt(),
  }).trim();
}

function azResourceInfo({ resourceGroup, swaName, subscriptionId }) {
  let out;
  try {
    out = execFileSync(
      bin("az"),
      ["staticwebapp", "show", "-n", swaName, "-g", resourceGroup, "--subscription", subscriptionId, "--query", "{name:name,host:defaultHostname}", "-o", "json", "--only-show-errors"],
      { encoding: "utf8", ...shellOpt() }
    );
  } catch {
    return { exists: false, defaultHostname: null };
  }
  const parsed = JSON.parse(out || "null");
  if (!parsed || !parsed.name) return { exists: false, defaultHostname: null };
  return { exists: true, defaultHostname: parsed.host || null };
}

// The JMESPath query deliberately avoids a `| [0]` pipe stage: with shell:true on Windows this
// argument passes through cmd.exe, and `|` is a shell metacharacter. Asking for a plain array and
// indexing it here in JS avoids relying on quoting a pipe correctly through the shell.
function azPreviewHostname({ resourceGroup, swaName, subscriptionId }) {
  const out = execFileSync(
    bin("az"),
    ["staticwebapp", "environment", "list", "-n", swaName, "-g", resourceGroup, "--subscription", subscriptionId, "--query", "[?name=='preview'].hostname", "-o", "json", "--only-show-errors"],
    { encoding: "utf8", ...shellOpt() }
  );
  const hosts = JSON.parse(out || "[]");
  return Array.isArray(hosts) && hosts[0] ? hosts[0] : null;
}

function azSettings({ resourceGroup, swaName, subscriptionId, environment }) {
  const envArgs = environment === "production" ? [] : ["--environment-name", "preview"];
  const out = execFileSync(
    bin("az"),
    ["staticwebapp", "appsettings", "list", "-n", swaName, "-g", resourceGroup, "--subscription", subscriptionId, ...envArgs, "--query", "properties", "-o", "json", "--only-show-errors"],
    { encoding: "utf8", ...shellOpt() }
  );
  const values = JSON.parse(out || "{}") || {};
  return { names: Object.keys(values), values };
}

function azToken({ resourceGroup, swaName, subscriptionId }) {
  return execFileSync(
    bin("az"),
    ["staticwebapp", "secrets", "list", "-n", swaName, "-g", resourceGroup, "--subscription", subscriptionId, "--query", "properties.apiKey", "-o", "tsv", "--only-show-errors"],
    { encoding: "utf8", ...shellOpt() }
  ).trim();
}

function azSetCommit({ resourceGroup, swaName, subscriptionId, environment, commit }) {
  const envArgs = environment === "production" ? [] : ["--environment-name", "preview"];
  execFileSync(
    bin("az"),
    ["staticwebapp", "appsettings", "set", "-n", swaName, "-g", resourceGroup, "--subscription", subscriptionId, ...envArgs, "--setting-names", `BT_COMMIT=${commit}`, "--only-show-errors"],
    { stdio: "inherit", ...shellOpt() }
  );
}

function runNpm(args) {
  try {
    execFileSync(bin("npm"), args, { cwd: ROOT, stdio: "inherit", ...shellOpt() });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function runBuild() {
  try {
    // node is a real .exe on every platform this repository supports; no shell needed.
    execFileSync("node", ["scripts/build-artifact.mjs"], { cwd: ROOT, stdio: "inherit" });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// THE ONLY PLACE IN THIS REPOSITORY THAT CALLS `swa deploy`. A structural regression test
// (scripts/deploy/test/engine.test.mjs) asserts that string appears in exactly this file among
// tracked, non-documentation sources, so a second deployment path cannot be added silently.
function swaDeployArtifact({ token, environment }) {
  const env = { ...process.env, SWA_CLI_DEPLOYMENT_TOKEN: token };
  try {
    execFileSync(
      bin("npx"),
      ["--no-install", "swa", "deploy", path.relative(ROOT, SITE_PATH), "--api-location", path.relative(ROOT, API_PATH), "--api-language", "node", "--api-version", "22", "--env", environment, "--no-use-keychain"],
      { cwd: ROOT, stdio: "inherit", env, ...shellOpt() }
    );
    return { ok: true };
  } catch {
    return { ok: false };
  } finally {
    delete env.SWA_CLI_DEPLOYMENT_TOKEN;
  }
}

function secretScanArtifact({ environment }) {
  const { gitleaksBinary } = require("../scan-staged.cjs");
  const gitleaks = gitleaksBinary();
  if (!gitleaks) return { available: false, ok: true, findings: 0 };
  try {
    execFileSync(gitleaks, ["dir", ARTIFACT_DIR, "--redact", "--no-banner"], { stdio: "inherit" });
    return { available: true, ok: true, findings: 0 };
  } catch {
    return { available: true, ok: false, findings: 1 };
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function promptSync(question) {
  const iface = readline.createInterface({ input: process.stdin, output: process.stdout });
  return await new Promise((resolve) => iface.question(question, (answer) => { iface.close(); resolve(answer); }));
}

export function createDefaultIo(root = ROOT) {
  return {
    log: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    prompt: promptSync,
    readVersion: () => readVersion(root),
    loadDeployTarget: () => loadDeployTarget(root),
    git: {
      status: () => gitStatus(root),
      originMainCommit: () => gitOriginMainCommit(root),
    },
    az: {
      tenantOf: azTenantOf,
      resourceInfo: azResourceInfo,
      previewHostname: azPreviewHostname,
      settings: azSettings,
      token: azToken,
      setCommit: azSetCommit,
    },
    gates: {
      test: () => runNpm(["test"]),
      validate: () => runNpm(["run", "validate"]),
      build: () => runBuild(),
    },
    secretScan: secretScanArtifact,
    deployArtifact: swaDeployArtifact,
    health: { getJson: fetchJson },
  };
}

// ---------------------------------------------------------------------------
// The orchestrator. Every rule above runs in this fixed order, whether this function is called
// from deploy.ps1, from `node scripts/deploy/engine.mjs` directly, or from a test. It never
// throws for an expected refusal — it returns a result whose `steps` explain exactly what
// stopped it, so "no false success" holds for callers that forget to catch.
// ---------------------------------------------------------------------------

export async function runDeploy(rawOptions, io = createDefaultIo()) {
  const steps = [];
  const record = (name, ok, message) => steps.push({ name, ok, message });
  const refuse = (name, message) => {
    record(name, false, message);
    return { uploaded: false, healthy: false, environment: rawOptions.environment, steps, receipt: null };
  };

  let target;
  try {
    target = resolveTarget({ ...rawOptions, deployTarget: rawOptions.deployTarget ?? (io.loadDeployTarget ? io.loadDeployTarget() : null) });
  } catch (err) {
    return refuse("target", err.message);
  }
  record("target", true, `${target.swaName} / ${target.resourceGroup} (${target.environment})`);

  let gitInfo;
  try {
    gitInfo = io.git.status();
  } catch (err) {
    return refuse("gitState", `Could not read Git state: ${err.message}`);
  }
  let originMainCommit = null;
  if (target.environment === "production") {
    try {
      originMainCommit = io.git.originMainCommit();
    } catch (err) {
      return refuse("gitState", `Could not read origin/main: ${err.message}`);
    }
  }
  const gitCheck = checkGitState({ environment: target.environment, ...gitInfo, originMainCommit });
  if (!gitCheck.ok) return refuse("gitState", gitCheck.reason);
  record("gitState", true, `branch ${gitInfo.branch}, commit ${gitInfo.commit.slice(0, 7)}, tree clean`);

  const version = io.readVersion();
  io.log(renderTargetBlock({ target, gitInfo, version }));

  if (target.environment === "production") {
    if (!rawOptions.authorizedProduction) {
      return refuse("confirmation", "Production deployment requires Terry's explicit authorization (-AuthorizedProduction). Nothing was deployed.");
    }
    const typed = rawOptions.confirm !== undefined
      ? rawOptions.confirm
      : await io.prompt(`Type the Static Web App name (${target.swaName}) to deploy commit ${gitInfo.commit.slice(0, 7)} to PRODUCTION: `);
    const confirmCheck = checkProductionConfirmation({ typed, swaName: target.swaName });
    if (!confirmCheck.ok) return refuse("confirmation", confirmCheck.reason);
    record("confirmation", true, "typed confirmation matched");
  } else {
    // Never treat Preview authorization as Production authorization: this branch never
    // inspects rawOptions.authorizedProduction or rawOptions.confirm at all.
    record("confirmation", true, "not required for preview");
  }

  let tenant;
  try {
    tenant = io.az.tenantOf(target.subscriptionId);
  } catch (err) {
    return refuse("azureResource", `Could not read the subscription's tenant: ${err.message}`);
  }
  if (tenant !== target.tenantId) return refuse("azureResource", "Subscription is not in the selected tenant. Nothing was deployed.");

  let resource;
  try {
    resource = io.az.resourceInfo({ resourceGroup: target.resourceGroup, swaName: target.swaName, subscriptionId: target.subscriptionId });
  } catch (err) {
    return refuse("azureResource", `Could not read the Static Web App: ${err.message}`);
  }
  if (!resource.exists) {
    return refuse("azureResource", `Static Web App ${target.swaName} was not found in resource group ${target.resourceGroup}. Nothing was deployed.`);
  }
  record("azureResource", true, `tenant verified; ${target.swaName} exists in ${target.resourceGroup}`);

  let settings;
  try {
    settings = io.az.settings({ resourceGroup: target.resourceGroup, swaName: target.swaName, subscriptionId: target.subscriptionId, environment: target.environment });
  } catch (err) {
    return refuse("settings", `Could not read application settings: ${err.message}`);
  }
  const settingsCheck = verifyIsolatedSettings({
    environment: target.environment,
    settingNames: settings.names,
    storageConnectionString: settings.values?.BT_STORAGE_CONNECTION_STRING,
    backupConnectionString: settings.values?.BT_BACKUP_CONNECTION_STRING,
    reportedEnvironment: settings.values?.BT_ENVIRONMENT,
  });
  if (!settingsCheck.ok) return refuse("settings", settingsCheck.reason);
  record("settings", true, "required settings present; data and backup storage are isolated");

  const testResult = io.gates.test();
  if (!testResult.ok) return refuse("test", "Tests failed. Nothing was deployed.");
  record("test", true, "npm test passed");

  const validateResult = io.gates.validate();
  if (!validateResult.ok) return refuse("validate", "Validation failed. Nothing was deployed.");
  record("validate", true, "npm run validate passed");

  const buildResult = io.gates.build();
  if (!buildResult.ok) return refuse("build", "Artifact build failed. Nothing was deployed.");
  record("build", true, "artifact built from the allowlist");

  const scan = io.secretScan({ environment: target.environment });
  if (scan.available === false) {
    if (target.environment === "production") {
      return refuse("secretScan", "gitleaks was not found (.local/bin or PATH). Production requires a secret scan of the built artifact. Nothing was deployed.");
    }
    record("secretScan", true, "gitleaks not found; skipped for preview (CI secret-scan remains the enforced layer)");
  } else if (!scan.ok) {
    return refuse("secretScan", "gitleaks found a possible secret in the built artifact. Nothing was deployed.");
  } else {
    record("secretScan", true, "gitleaks found no leaks in the built artifact");
  }

  let token;
  try {
    token = io.az.token({ resourceGroup: target.resourceGroup, swaName: target.swaName, subscriptionId: target.subscriptionId });
  } catch (err) {
    return refuse("upload", `Could not read the deployment token: ${err.message}`);
  }
  if (!token) return refuse("upload", "Could not read the deployment token. Nothing was deployed.");

  const swaEnv = target.environment === "production" ? "production" : "preview";
  const deployResult = io.deployArtifact({ token, environment: swaEnv, sitePath: SITE_PATH, apiPath: API_PATH });
  token = null;
  if (!deployResult.ok) return refuse("upload", "Deployment command failed.");
  record("upload", true, `uploaded to ${swaEnv}`);

  try {
    io.az.setCommit({ resourceGroup: target.resourceGroup, swaName: target.swaName, subscriptionId: target.subscriptionId, environment: swaEnv, commit: gitInfo.commit });
    record("commitSetting", true, "BT_COMMIT recorded");
  } catch (err) {
    record("commitSetting", false, `Deployed, but BT_COMMIT could not be recorded: ${err.message}`);
  }

  let hostname = null;
  try {
    hostname = swaEnv === "production" ? resource.defaultHostname : io.az.previewHostname({ resourceGroup: target.resourceGroup, swaName: target.swaName, subscriptionId: target.subscriptionId });
  } catch {
    hostname = null;
  }

  let health;
  if (!hostname) {
    health = { ok: false, message: "could not determine the deployed hostname" };
  } else {
    let versionResponse = null;
    let siteSettingsResponse = null;
    try {
      versionResponse = await io.health.getJson(`https://${hostname}/version.json`);
    } catch (err) {
      health = { ok: false, message: `could not reach https://${hostname}/version.json: ${err.message}` };
    }
    if (!health) {
      try {
        siteSettingsResponse = await io.health.getJson(`https://${hostname}/api/site-settings`);
      } catch (err) {
        health = { ok: false, message: `could not reach https://${hostname}/api/site-settings: ${err.message}` };
      }
    }
    if (!health) {
      health = evaluateHealth({
        versionResponse,
        siteSettingsResponse,
        expectedCommit: gitInfo.commit,
        expectedEnvironment: target.environment,
        expectedVersion: version,
        hostname,
      });
    }
  }
  record("healthCheck", health.ok, health.message);

  const receipt = {
    target: `${target.swaName} / ${target.resourceGroup}`,
    environment: target.environment,
    url: hostname ? `https://${hostname}` : "(unknown)",
    branch: gitInfo.branch,
    sha: gitInfo.commit,
    version,
    checks: steps.map((s) => `${s.ok ? "ok" : "FAIL"} ${s.name}`),
    result: health.ok ? "SUCCESS" : "UPLOADED, NOT VERIFIED HEALTHY",
  };
  io.log(renderReceipt(receipt));

  return { uploaded: true, healthy: health.ok, environment: target.environment, steps, receipt };
}

function renderTargetBlock({ target, gitInfo, version }) {
  return [
    "",
    `BudgetTracker deployment -> ${target.environment.toUpperCase()}`,
    `  Static Web App : ${target.swaName}`,
    `  Resource Group : ${target.resourceGroup}`,
    `  Branch         : ${gitInfo.branch}`,
    `  Commit         : ${gitInfo.commit}`,
    `  App version    : ${version}`,
    "",
  ].join("\n");
}

function renderReceipt(receipt) {
  return [
    "",
    "DEPLOYMENT RECEIPT",
    `  target  : ${receipt.target} (${receipt.environment})`,
    `  url     : ${receipt.url}`,
    `  sha     : ${receipt.sha}`,
    `  version : ${receipt.version}`,
    `  checks  : ${receipt.checks.join(", ")}`,
    `  result  : ${receipt.result}`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry point. deploy.ps1 always calls this with `node`; it is also the direct-invocation
// path that must enforce the same rules (see the module header).
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    environment: typeof args.environment === "string" ? args.environment : undefined,
    subscriptionId: typeof args["subscription-id"] === "string" ? args["subscription-id"] : undefined,
    tenantId: typeof args["tenant-id"] === "string" ? args["tenant-id"] : undefined,
    resourceGroup: typeof args["resource-group"] === "string" ? args["resource-group"] : undefined,
    swaName: typeof args["swa-name"] === "string" ? args["swa-name"] : undefined,
    authorizedProduction: !!args["authorized-production"],
    confirm: typeof args.confirm === "string" ? args.confirm : undefined,
  };

  const result = await runDeploy(options);
  if (!result.uploaded) {
    console.error("");
    console.error(`Nothing was deployed to ${result.environment ?? "(unresolved)"}.`);
    const last = result.steps[result.steps.length - 1];
    if (last) console.error(`  ${last.name}: ${last.message}`);
    console.error("");
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.healthy ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
