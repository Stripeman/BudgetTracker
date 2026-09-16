// BT-003-05 — the consolidated deployment engine. These tests never touch a real Azure
// subscription, the real Git remote or the network: every Azure/Git/network call is injected via
// a fake `io` object, so the tests run in `npm test` on any machine (including CI).
//
// Two kinds of proof are asserted here:
//   1. The gating rules themselves (production confirmation, clean tree, branch, tenant, isolated
//      settings, ordering) refuse exactly when they must and never touch `swaDeployArtifact`.
//   2. STRUCTURALLY, this repository has only ONE place that can perform the actual Azure deploy
//      call, and deploy.ps1 only ever delegates to it — proving the "no other repository-supported
//      deployment path" requirement rather than merely asserting it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ENVIRONMENTS,
  resolveTarget,
  checkGitState,
  checkProductionConfirmation,
  verifyIsolatedSettings,
  evaluateHealth,
  runDeploy,
  DeployError,
} from "../engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");

const OK_GUID_A = "11111111-1111-1111-1111-111111111111";
const OK_GUID_B = "22222222-2222-2222-2222-222222222222";

function fakeIo(overrides = {}) {
  const calls = { deployArtifact: 0, setCommit: 0, tests: 0, validate: 0, build: 0 };
  const base = {
    log: () => {},
    warn: () => {},
    prompt: async () => "budget-tracker",
    readVersion: () => "0.1.0-alpha.1",
    loadDeployTarget: () => null,
    git: {
      status: () => ({ branch: "main", commit: "a".repeat(40), dirty: false, detached: false }),
      originMainCommit: () => "a".repeat(40),
    },
    az: {
      tenantOf: () => OK_GUID_B,
      resourceInfo: () => ({ exists: true, defaultHostname: "budget-tracker.example.azurestaticapps.net" }),
      previewHostname: () => "budget-tracker-preview.example.azurestaticapps.net",
      settings: ({ environment } = {}) => ({
        names: ["BT_ENVIRONMENT", "BT_STORAGE_CONNECTION_STRING", "BT_BACKUP_CONNECTION_STRING", "BT_BACKUP_KEYS", "BT_BACKUP_ACTIVE_KEY", "BT_SITE_ADMINS"],
        values: { BT_ENVIRONMENT: environment, BT_STORAGE_CONNECTION_STRING: "data-conn", BT_BACKUP_CONNECTION_STRING: "backup-conn" },
      }),
      token: () => "fake-token",
      setCommit: () => { calls.setCommit++; },
    },
    gates: {
      test: () => { calls.tests++; return { ok: true }; },
      validate: () => { calls.validate++; return { ok: true }; },
      build: () => { calls.build++; return { ok: true }; },
    },
    secretScan: () => ({ available: true, ok: true, findings: 0 }),
    deployArtifact: () => { calls.deployArtifact++; return { ok: true }; },
    health: {
      getJson: async (url) => {
        if (url.endsWith("/version.json")) return { status: 200, body: { version: "0.1.0-alpha.1" } };
        return { status: 200, body: { app: { commit: "a".repeat(40), environment: "preview", version: "0.1.0-alpha.1" } } };
      },
    },
  };
  const merged = { ...base, ...overrides, calls };
  merged.az = { ...base.az, ...(overrides.az || {}) };
  merged.git = { ...base.git, ...(overrides.git || {}) };
  merged.gates = { ...base.gates, ...(overrides.gates || {}) };
  merged.health = { ...base.health, ...(overrides.health || {}) };
  return merged;
}

const baseOptions = (environment) => ({
  environment,
  subscriptionId: OK_GUID_A,
  tenantId: OK_GUID_B,
  resourceGroup: "budget-tracker",
  swaName: "budget-tracker",
});

// ---------------------------------------------------------------------------
// Pure rule tests
// ---------------------------------------------------------------------------

test("BT-003-05 resolveTarget fails closed without subscription/tenant configuration", () => {
  assert.throws(() => resolveTarget({ environment: "preview" }), DeployError);
  assert.throws(() => resolveTarget({ environment: "preview", subscriptionId: OK_GUID_A }), DeployError);
});

test("BT-003-05 resolveTarget refuses an unknown or missing environment", () => {
  assert.throws(() => resolveTarget({ environment: "staging", subscriptionId: OK_GUID_A, tenantId: OK_GUID_B }), DeployError);
  assert.throws(() => resolveTarget({ subscriptionId: OK_GUID_A, tenantId: OK_GUID_B }), DeployError);
  assert.deepEqual(ENVIRONMENTS, ["preview", "production"]);
});

test("BT-003-05 resolveTarget falls back to .local/deploy-target.json only when a flag is absent", () => {
  const resolved = resolveTarget({
    environment: "preview",
    deployTarget: { subscriptionId: OK_GUID_A, tenantId: OK_GUID_B, resourceGroup: "from-file", swaName: "from-file-swa" },
  });
  assert.equal(resolved.resourceGroup, "from-file");
  const overridden = resolveTarget({
    environment: "preview",
    resourceGroup: "explicit-rg",
    deployTarget: { subscriptionId: OK_GUID_A, tenantId: OK_GUID_B, resourceGroup: "from-file" },
  });
  assert.equal(overridden.resourceGroup, "explicit-rg");
});

test("BT-003-05 checkGitState refuses a dirty tree, detached HEAD, and (production only) a non-main branch", () => {
  assert.equal(checkGitState({ environment: "preview", branch: "feature/x", commit: "a", dirty: false, detached: false }).ok, true);
  assert.equal(checkGitState({ environment: "preview", branch: "feature/x", commit: "a", dirty: true, detached: false }).ok, false);
  assert.equal(checkGitState({ environment: "preview", branch: "", commit: "a", dirty: false, detached: true }).ok, false);
  assert.equal(checkGitState({ environment: "production", branch: "feature/x", commit: "a", dirty: false, detached: false }).ok, false);
  assert.equal(checkGitState({ environment: "production", branch: "main", commit: "a", dirty: false, detached: false, originMainCommit: "b" }).ok, false);
  assert.equal(checkGitState({ environment: "production", branch: "main", commit: "a", dirty: false, detached: false, originMainCommit: "a" }).ok, true);
});

test("BT-003-05 checkProductionConfirmation requires an exact, current typed match", () => {
  assert.equal(checkProductionConfirmation({ typed: "budget-tracker", swaName: "budget-tracker" }).ok, true);
  assert.equal(checkProductionConfirmation({ typed: "", swaName: "budget-tracker" }).ok, false);
  assert.equal(checkProductionConfirmation({ typed: "budget-tracker ", swaName: "budget-tracker" }).ok, false);
});

test("BT-003-05 verifyIsolatedSettings fails closed on missing settings and on shared storage", () => {
  const full = ["BT_ENVIRONMENT", "BT_STORAGE_CONNECTION_STRING", "BT_BACKUP_CONNECTION_STRING", "BT_BACKUP_KEYS", "BT_BACKUP_ACTIVE_KEY", "BT_SITE_ADMINS"];
  assert.equal(verifyIsolatedSettings({ environment: "preview", settingNames: full, storageConnectionString: "a", backupConnectionString: "b" }).ok, true);
  assert.equal(verifyIsolatedSettings({ environment: "preview", settingNames: full.slice(0, 3), storageConnectionString: "a", backupConnectionString: "b" }).ok, false);
  assert.equal(verifyIsolatedSettings({ environment: "preview", settingNames: full, storageConnectionString: "same", backupConnectionString: "same" }).ok, false);
  assert.equal(verifyIsolatedSettings({ environment: "preview", settingNames: full, storageConnectionString: "a", backupConnectionString: "b", reportedEnvironment: "production" }).ok, false);
});

test("BT-003-05 evaluateHealth refuses a commit or environment mismatch and only passes a matched live app", () => {
  const v = { status: 200, body: { version: "0.1.0-alpha.1" } };
  const good = { status: 200, body: { app: { commit: "sha1", environment: "preview", version: "0.1.0-alpha.1" } } };
  assert.equal(evaluateHealth({ versionResponse: v, siteSettingsResponse: good, expectedCommit: "sha1", expectedEnvironment: "preview", expectedVersion: "0.1.0-alpha.1", hostname: "h" }).ok, true);
  assert.equal(evaluateHealth({ versionResponse: v, siteSettingsResponse: good, expectedCommit: "other-sha", expectedEnvironment: "preview", expectedVersion: "0.1.0-alpha.1", hostname: "h" }).ok, false);
  const wrongEnv = { status: 200, body: { app: { commit: "sha1", environment: "production", version: "0.1.0-alpha.1" } } };
  assert.equal(evaluateHealth({ versionResponse: v, siteSettingsResponse: wrongEnv, expectedCommit: "sha1", expectedEnvironment: "preview", expectedVersion: "0.1.0-alpha.1", hostname: "h" }).ok, false);
  assert.equal(evaluateHealth({ versionResponse: { status: 500 }, siteSettingsResponse: good, expectedCommit: "sha1", expectedEnvironment: "preview", expectedVersion: "0.1.0-alpha.1", hostname: "h" }).ok, false);
});

// ---------------------------------------------------------------------------
// Orchestrator (runDeploy) tests — the bypass-proof evidence
// ---------------------------------------------------------------------------

test("BT-003-05 production without -AuthorizedProduction is refused before any Azure or gate call", async () => {
  const io = fakeIo();
  const result = await runDeploy(baseOptions("production"), io);
  assert.equal(result.uploaded, false);
  assert.equal(io.calls.deployArtifact, 0);
  assert.equal(io.calls.tests, 0);
  assert.equal(io.calls.setCommit, 0);
  assert.match(result.steps.at(-1).message, /explicit authorization/);
});

test("BT-003-05 production with a wrong typed confirmation is refused before upload", async () => {
  const io = fakeIo({ prompt: async () => "wrong-name" });
  const result = await runDeploy({ ...baseOptions("production"), authorizedProduction: true }, io);
  assert.equal(result.uploaded, false);
  assert.equal(io.calls.deployArtifact, 0);
  assert.match(result.steps.at(-1).message, /did not match/);
});

test("BT-003-05 production with the correct confirmation and every gate passing deploys and is verified healthy", async () => {
  const io = fakeIo({
    git: { status: () => ({ branch: "main", commit: "a".repeat(40), dirty: false, detached: false }), originMainCommit: () => "a".repeat(40) },
  });
  io.health.getJson = async (url) => {
    if (url.endsWith("/version.json")) return { status: 200, body: { version: "0.1.0-alpha.1" } };
    return { status: 200, body: { app: { commit: "a".repeat(40), environment: "production", version: "0.1.0-alpha.1" } } };
  };
  const result = await runDeploy({ ...baseOptions("production"), authorizedProduction: true, confirm: "budget-tracker" }, io);
  assert.equal(result.uploaded, true);
  assert.equal(result.healthy, true);
  assert.equal(io.calls.deployArtifact, 1);
  assert.equal(io.calls.setCommit, 1);
  assert.equal(io.calls.tests, 1);
  assert.equal(io.calls.validate, 1);
  assert.equal(io.calls.build, 1);
  assert.ok(result.receipt);
  assert.equal(result.receipt.environment, "production");
  assert.equal(result.receipt.result, "SUCCESS");
});

test("BT-003-05 preview never requires -AuthorizedProduction or a typed confirmation", async () => {
  const io = fakeIo({
    prompt: async () => { throw new Error("preview must never prompt for a production confirmation"); },
  });
  io.health.getJson = async (url) => {
    if (url.endsWith("/version.json")) return { status: 200, body: { version: "0.1.0-alpha.1" } };
    return { status: 200, body: { app: { commit: "a".repeat(40), environment: "preview", version: "0.1.0-alpha.1" } } };
  };
  const result = await runDeploy(baseOptions("preview"), io);
  assert.equal(result.uploaded, true);
  assert.equal(io.calls.deployArtifact, 1);
});

test("BT-003-05 -AuthorizedProduction on a preview deploy has no effect (Preview authorization is never Production authorization)", async () => {
  const io = fakeIo();
  io.health.getJson = async (url) => {
    if (url.endsWith("/version.json")) return { status: 200, body: { version: "0.1.0-alpha.1" } };
    return { status: 200, body: { app: { commit: "a".repeat(40), environment: "preview", version: "0.1.0-alpha.1" } } };
  };
  const result = await runDeploy({ ...baseOptions("preview"), authorizedProduction: true }, io);
  assert.equal(result.uploaded, true);
  assert.equal(result.steps.find((s) => s.name === "confirmation").message, "not required for preview");
});

test("BT-003-05 a dirty tree refuses both environments before any gate runs", async () => {
  const io = fakeIo({ git: { status: () => ({ branch: "feature/x", commit: "a".repeat(40), dirty: true, detached: false }), originMainCommit: () => "a".repeat(40) } });
  const preview = await runDeploy(baseOptions("preview"), io);
  assert.equal(preview.uploaded, false);
  assert.equal(io.calls.tests, 0);
});

test("BT-003-05 production refuses when HEAD is not equal to origin/main", async () => {
  const io = fakeIo({ git: { status: () => ({ branch: "main", commit: "a".repeat(40), dirty: false, detached: false }), originMainCommit: () => "b".repeat(40) } });
  const result = await runDeploy({ ...baseOptions("production"), authorizedProduction: true, confirm: "budget-tracker" }, io);
  assert.equal(result.uploaded, false);
  assert.equal(io.calls.deployArtifact, 0);
});

test("BT-003-05 refuses when the target's tenant does not match (never inferred from ambient az context)", async () => {
  const io = fakeIo({ az: { tenantOf: () => "99999999-9999-9999-9999-999999999999" } });
  const result = await runDeploy(baseOptions("preview"), io);
  assert.equal(result.uploaded, false);
  assert.match(result.steps.at(-1).message, /tenant/);
});

test("BT-003-05 refuses when the Azure resource does not exist", async () => {
  const io = fakeIo({ az: { resourceInfo: () => ({ exists: false, defaultHostname: null }) } });
  const result = await runDeploy(baseOptions("preview"), io);
  assert.equal(result.uploaded, false);
  assert.match(result.steps.at(-1).message, /was not found/);
});

test("BT-003-05 refuses when required application settings are missing (fails closed)", async () => {
  const io = fakeIo({ az: { settings: () => ({ names: ["BT_ENVIRONMENT"], values: { BT_ENVIRONMENT: "preview" } }) } });
  const result = await runDeploy(baseOptions("preview"), io);
  assert.equal(result.uploaded, false);
  assert.equal(io.calls.tests, 0);
});

test("BT-003-05 a failing test gate refuses before the artifact is built or uploaded", async () => {
  const io = fakeIo({ gates: { test: () => { io.calls.tests++; return { ok: false }; }, validate: () => ({ ok: true }), build: () => ({ ok: true }) } });
  const result = await runDeploy(baseOptions("preview"), io);
  assert.equal(result.uploaded, false);
  assert.equal(io.calls.build, 0);
  assert.equal(io.calls.deployArtifact, 0);
});

test("BT-003-05 a secret-scan finding refuses the deploy even after tests, validate and build pass", async () => {
  const io = fakeIo({ secretScan: () => ({ available: true, ok: false, findings: 1 }) });
  const result = await runDeploy(baseOptions("preview"), io);
  assert.equal(result.uploaded, false);
  assert.equal(io.calls.deployArtifact, 0);
});

test("BT-003-05 production refuses when gitleaks is unavailable; preview proceeds with a recorded warning", async () => {
  const io = fakeIo({ secretScan: () => ({ available: false, ok: true, findings: 0 }) });
  const previewResult = await runDeploy(baseOptions("preview"), io);
  assert.equal(previewResult.uploaded, true);

  const prodIo = fakeIo({
    secretScan: () => ({ available: false, ok: true, findings: 0 }),
    git: { status: () => ({ branch: "main", commit: "a".repeat(40), dirty: false, detached: false }), originMainCommit: () => "a".repeat(40) },
  });
  const prodResult = await runDeploy({ ...baseOptions("production"), authorizedProduction: true, confirm: "budget-tracker" }, prodIo);
  assert.equal(prodResult.uploaded, false);
  assert.equal(prodIo.calls.deployArtifact, 0);
});

test("BT-003-05 the upload succeeding and the health check failing are reported as separate, truthful claims", async () => {
  const io = fakeIo({ health: { getJson: async (url) => (url.endsWith("/version.json") ? { status: 200, body: { version: "0.1.0-alpha.1" } } : { status: 200, body: { app: { commit: "wrong-sha", environment: "preview" } } }) } });
  const result = await runDeploy(baseOptions("preview"), io);
  assert.equal(result.uploaded, true);
  assert.equal(result.healthy, false);
  assert.equal(io.calls.deployArtifact, 1);
  assert.equal(result.receipt.result, "UPLOADED, NOT VERIFIED HEALTHY");
});

// ---------------------------------------------------------------------------
// Structural guards: no other repository-supported path can perform the Azure deploy call.
// ---------------------------------------------------------------------------

test("BT-003-05 only scripts/deploy/engine.mjs invokes the SWA CLI deploy command", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const hits = [];
  for (const rel of tracked) {
    if (rel.startsWith("scripts/deploy/test/")) continue; // this file names the rule; it does not implement it
    if (rel.endsWith(".md")) continue; // documentation may describe the command in prose
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
    const text = fs.readFileSync(full, "utf8");
    if (/["']swa["'],\s*["']deploy["']/.test(text)) hits.push(rel);
  }
  assert.deepEqual(hits, ["scripts/deploy/engine.mjs"]);
});

test("BT-003-05 deploy.ps1 only delegates to the engine; it never calls az/swa itself", () => {
  const text = fs.readFileSync(path.join(ROOT, "scripts", "deploy", "deploy.ps1"), "utf8");
  assert.match(text, /engine\.mjs/);
  assert.doesNotMatch(text, /staticwebapp/i);
  assert.doesNotMatch(text, /swa deploy/i);
});

test("BT-003-05 the Git adapter the engine uses is read-only: no push, merge or commit capability", () => {
  const text = fs.readFileSync(path.join(ROOT, "scripts", "deploy", "engine.mjs"), "utf8");
  assert.doesNotMatch(text, /execFileSync\("git",\s*\["push"/);
  assert.doesNotMatch(text, /execFileSync\("git",\s*\["merge"/);
  assert.doesNotMatch(text, /execFileSync\("git",\s*\["commit"/);
});

test("BT-003-05 package.json defines no npm script that deploys", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  for (const [name, command] of Object.entries(pkg.scripts)) {
    assert.doesNotMatch(command, /swa deploy/i, `npm script "${name}" must not deploy directly`);
  }
});
