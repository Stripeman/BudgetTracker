// Multi-user real-browser scenarios against an ISOLATED local dev server (BT-004-06).
//
//   npm run e2e                          every scenario
//   npm run e2e -- --only privacy,shared  some of them (names below; "group" means shared)
//   npm run e2e -- --list                 list them
//   npm run e2e -- --keep-data            keep every scenario's fictional data directory afterwards
//
// Not part of `npm test`: it needs Microsoft Edge (BT_EDGE_PATH overrides its location). ISOLATION
// (Terry, 2026-09-18: "Fix the E2E harness isolation problem. A full suite that exhausts one shared
// fictional identity's daily quota is unfinished test infrastructure. Give scenarios isolated
// synthetic identities or fresh isolated test state... Do not weaken the application's actual limits
// or silently skip failing scenarios."): every scenario gets its OWN isolated dev server, its OWN
// fresh port and its OWN freshly seeded fictional data under .local/e2e/<run>/<scenario>/ — never one
// shared server/seed for the whole run. Before this, every scenario's fictional "alice" (the default
// workspace owner almost all of them use) was the SAME underlying user document for the whole
// invocation, so running many scenarios together exhausted alice's real, intentional 10-workspaces-
// per-day limit (api/_shared/store.js) partway through — a test-infrastructure artifact, not a
// product defect, but a real gap: it silently turned unrelated later scenarios into false failures
// instead of proving anything. Giving each scenario its own fresh server (BT_MAX_WORKSPACE_CREATIONS
// _PER_DAY is never touched, and no scenario's own failure is ever swallowed — every one still runs
// and reports) removes the collision at its root, in the harness, not the application: the real limit
// itself still runs, deliberately, in the `guards` scenario (quota.mjs' dedicated coverage, run in its
// own isolated server exactly like every other scenario). Each scenario opens one headless Edge per
// fictional user (alice owner, bob member, carol viewer, dave site administrator, eve outsider), a
// direct API client per user, prints PASS / FAIL / SKIP with expected and actual values, saves
// screenshots under its own scenario subdirectory, stops every process it started, proves none is
// left, and the whole run exits non-zero on any failure anywhere.
import fs from "node:fs";
import path from "node:path";
import { ROOT, parseArgs, assertUnderLocal } from "../harness/guards.mjs";
import { createHarness, edgeAvailable, EDGE } from "../harness/index.mjs";
import { createReport } from "../harness/report.mjs";
import * as privacy from "./privacy.mjs";
import * as shared from "./shared.mjs";
import * as concurrency from "./concurrency.mjs";
import * as guards from "./guards.mjs";
import * as dropdown from "./dropdown.mjs";
import * as staging from "./staging.mjs";
import * as recheck from "./recheck.mjs";
import * as settings from "./settings.mjs";
import * as accounts from "./accounts.mjs";
import * as bills from "./bills.mjs";
import * as remove from "./remove.mjs";
import * as deleteworkspace from "./deleteworkspace.mjs";
import * as move from "./move.mjs";
import * as analytics from "./analytics.mjs";
import * as login from "./login.mjs";
import * as gallery from "./gallery.mjs";
import * as permanentdelete from "./permanentdelete.mjs";
import * as dashboard from "./dashboard.mjs";
import * as accountrequests from "./accountrequests.mjs";
import * as transactions from "./transactions.mjs";
import * as overlay from "./overlay.mjs";
import * as quota from "./quota.mjs";
import * as actionsmenu from "./actionsmenu.mjs";
import * as mysettings from "./mysettings.mjs";
import * as addbillfromentry from "./addbillfromentry.mjs";

const SCENARIOS = [privacy, shared, concurrency, guards, dropdown, staging, recheck, settings, accounts, bills, remove, deleteworkspace, move, analytics, login, gallery, permanentdelete, dashboard, accountrequests, transactions, overlay, quota, actionsmenu, mysettings, addbillfromentry];
const ALIASES = { group: "shared", "shared-expenses": "shared", picker: "dropdown", dropdowns: "dropdown", "route-guards": "guards", "staging-link": "staging", "workspace-settings": "settings", "edit-account": "accounts", "remove-account": "remove", "delete-workspace": "deleteworkspace", archive: "deleteworkspace", "move-entry": "move", "move-account": "move", usage: "analytics", "site-usage": "analytics", "sign-in": "login", landing: "login", "design-gallery": "gallery", layouts: "gallery", "permanent-delete": "permanentdelete", "bt-014": "permanentdelete", "record-deletion": "permanentdelete", tooltip: "bills", "record-next": "bills", "spending-by-category": "dashboard", "top-merchants": "dashboard", "this-week": "dashboard", "account-requests": "accountrequests", "bt-014-17": "accountrequests", "quick-entry": "transactions", "add-expense": "transactions", "new-merchant": "transactions", "no-reflow": "overlay", "icon-picker": "overlay", "theme-picker": "overlay", "colour-palette": "overlay", "workspace-rate": "quota", "workspace-quota": "quota", "rate-limit": "quota", "record-actions": "actionsmenu", "bt-015": "actionsmenu", "action-menu": "actionsmenu", "compact-actions": "actionsmenu", "my-settings": "mysettings", "bt-017": "mysettings", "settings-redesign": "mysettings", "add-as-bill": "addbillfromentry", "bill-from-entry": "addbillfromentry", "bill-from-transaction": "addbillfromentry" };
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

let args;
try { args = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(2); }
if (args.help || args.list) {
  console.log("Scenarios (npm run e2e -- --only name[,name]):");
  for (const s of SCENARIOS) console.log(`  ${s.name.padEnd(12)} ${s.title}${s.needsBrowser ? "" : " (API only)"}`);
  process.exit(0);
}
const wanted = args.only ? args.only.map((n) => ALIASES[n] || n) : SCENARIOS.map((s) => s.name);
const unknown = wanted.filter((n) => !SCENARIOS.some((s) => s.name === n));
if (unknown.length) { console.error(`Unknown scenario ${unknown.join(", ")}. Known: ${SCENARIOS.map((s) => s.name).join(", ")}.`); process.exit(2); }
const selected = SCENARIOS.filter((s) => wanted.includes(s.name));

const runId = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15) + `-${process.pid}`;
const runDir = assertUnderLocal(path.join(ROOT, ".local", "e2e", runId));
fs.mkdirSync(runDir, { recursive: true });
const t = createReport();
let harness = null; // the ONE currently-open scenario's harness, if any (for SIGINT cleanup)
let currentScenarioName = null;
const closed = []; // { scenario, base, dataRoot, report } for every harness this run has already closed
let finishing = null;

function printCleanup(scenarioName, base, dataRoot, c) {
  console.log(`\nCleanup for "${scenarioName}" (its own isolated dev server, never shared with another scenario)`);
  console.log(`  dev server pid ${c.serverReport.pid} on port ${c.serverReport.port}: ${c.serverReport.stillRunning ? "STILL RUNNING" : "stopped"}`);
  for (const e of c.edgeReports) {
    console.log(`  ${e.label} pid ${e.pid}: ${e.closedByCdp ? "closed by Browser.close" : "not closed by CDP"}; msedge PIDs with its profile ${JSON.stringify(e.seen)}; killed ${JSON.stringify(e.killed)}; survivors ${JSON.stringify(e.survivors)}; profile ${e.profileRemoved ? "removed" : "NOT removed"}`);
  }
  console.log(`  msedge processes still holding a profile of this run: ${c.leftoverEdge.length ? JSON.stringify(c.leftoverEdge) : "none"}`);
  console.log(`  tracked processes still alive: ${c.leftover.length ? JSON.stringify(c.leftover) : "none"}`);
  console.log(`  fictional data ${c.keepData ? `kept at ${rel(dataRoot)}` : c.dataRemoved ? "removed" : "NOT removed"}`);
  const ok = !c.serverReport.stillRunning && !c.leftoverEdge.length && !c.leftover.length && !c.profilesLeft.length && c.edgeReports.every((e) => e.profileRemoved && !e.survivors.length);
  if (!ok) console.log(`  CLEANUP INCOMPLETE for "${scenarioName}" (see above)`);
  return ok;
}

// Closes whichever harness is currently open (normal end-of-scenario, or an interrupted scenario)
// and records its cleanup report. Never throws past this point: a cleanup problem is reported, not
// left to crash the run before every other scenario's own results are written.
async function closeCurrent() {
  if (!harness) return true;
  const name = currentScenarioName;
  const base = harness.base;
  const dataRoot = harness.server.dataRoot;
  const c = await harness.close();
  harness = null;
  currentScenarioName = null;
  const ok = printCleanup(name, base, dataRoot, c);
  closed.push({ scenario: name, base, ok });
  return ok;
}

async function finish(extraFailure = false) {
  if (finishing) return finishing;
  finishing = (async () => {
    const lastOk = await closeCurrent();
    const cleanupOk = lastOk && closed.every((c) => c.ok);
    const { pass, fail, skip } = t.counts();
    fs.writeFileSync(path.join(runDir, "results.json"), JSON.stringify({ runId, scenarios: closed.map((c) => ({ scenario: c.scenario, base: c.base, cleanupOk: c.ok })), results: t.results }, null, 2));
    const code = fail || extraFailure || !cleanupOk ? 1 : 0;
    console.log(`\nResult: ${pass} passed, ${fail} failed, ${skip} skipped${cleanupOk ? "" : ", cleanup incomplete"} (exit ${code})`);
    console.log(`Evidence in ${rel(runDir)} (one subdirectory per scenario, each its own isolated server and fictional seed).`);
    return code;
  })();
  return finishing;
}

process.on("SIGINT", async () => { console.log("\nInterrupted: cleaning up"); process.exit(await finish(true)); });

let setupFailed = false;
console.log(`BudgetTracker e2e run ${runId}`);
console.log(`  evidence in ${rel(runDir)}; Edge ${edgeAvailable() ? EDGE : "NOT FOUND"}`);
console.log(`  each scenario gets its OWN isolated dev server and fresh fictional seed (never shared)`);
for (const s of selected) {
  console.log(`\n== ${s.name}: ${s.title}`);
  t.scenario(s.name);
  if (s.needsBrowser && !edgeAvailable()) { t.skip(s.name, `Microsoft Edge was not found at ${EDGE}; set BT_EDGE_PATH`); continue; }
  try {
    harness = await createHarness({ runDir: assertUnderLocal(path.join(runDir, s.name)), keepData: args.keepData });
    currentScenarioName = s.name;
    console.log(`   isolated dev server ${harness.base} (pid ${harness.server.pid}), fresh fictional seed in ${rel(harness.server.dataRoot)}`);
  } catch (err) {
    setupFailed = true;
    t.check(`${s.name}: its own isolated dev server started`, { expected: "no error", actual: String((err && err.stack) || err).split("\n").slice(0, 3).join(" | "), pass: false });
    continue;
  }
  try {
    await s.run(harness, t);
  } catch (err) {
    t.check("the scenario ran to its end", { expected: "no error", actual: String((err && err.stack) || err).split("\n").slice(0, 3).join(" | "), pass: false });
  } finally {
    await harness.closeBrowsers();
    await closeCurrent();
  }
}
process.exit(await finish(setupFailed));
