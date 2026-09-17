// Multi-user real-browser scenarios against an ISOLATED local dev server (BT-004-06).
//
//   npm run e2e                          every scenario
//   npm run e2e -- --only privacy,shared  some of them (names below; "group" means shared)
//   npm run e2e -- --list                 list them
//   npm run e2e -- --keep-data            keep the run's fictional data directory afterwards
//
// Not part of `npm test`: it needs Microsoft Edge (BT_EDGE_PATH overrides its location). Each run
// seeds fresh fictional data under .local/e2e/<run>/, starts its own dev server on a free port,
// opens one headless Edge per fictional user, prints PASS / FAIL / SKIP with expected and actual
// values, saves screenshots under .local/e2e/<run>/shots, stops every process it started, proves
// none is left, and exits non-zero on any failure.
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

const SCENARIOS = [privacy, shared, concurrency, guards, dropdown, staging, recheck, settings, accounts, bills, remove, deleteworkspace, move, analytics, login, gallery, permanentdelete, dashboard];
const ALIASES = { group: "shared", "shared-expenses": "shared", picker: "dropdown", dropdowns: "dropdown", "route-guards": "guards", "staging-link": "staging", "workspace-settings": "settings", "edit-account": "accounts", "remove-account": "remove", "delete-workspace": "deleteworkspace", archive: "deleteworkspace", "move-entry": "move", "move-account": "move", usage: "analytics", "site-usage": "analytics", "sign-in": "login", landing: "login", "design-gallery": "gallery", layouts: "gallery", "permanent-delete": "permanentdelete", "bt-014": "permanentdelete", "record-deletion": "permanentdelete", tooltip: "bills", "record-next": "bills", "spending-by-category": "dashboard", "top-merchants": "dashboard", "this-week": "dashboard" };
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
let harness = null;
let finishing = null;

async function finish(extraFailure = false) {
  if (finishing) return finishing;
  finishing = (async () => {
    let cleanupOk = true;
    if (harness) {
      const c = await harness.close();
      console.log("\nCleanup (only processes this run started)");
      console.log(`  dev server pid ${c.serverReport.pid} on port ${c.serverReport.port}: ${c.serverReport.stillRunning ? "STILL RUNNING" : "stopped"}`);
      for (const e of c.edgeReports) {
        console.log(`  ${e.label} pid ${e.pid}: ${e.closedByCdp ? "closed by Browser.close" : "not closed by CDP"}; msedge PIDs with its profile ${JSON.stringify(e.seen)}; killed ${JSON.stringify(e.killed)}; survivors ${JSON.stringify(e.survivors)}; profile ${e.profileRemoved ? "removed" : "NOT removed"}`);
      }
      console.log(`  msedge processes still holding a profile of this run: ${c.leftoverEdge.length ? JSON.stringify(c.leftoverEdge) : "none"}`);
      console.log(`  tracked processes still alive: ${c.leftover.length ? JSON.stringify(c.leftover) : "none"}`);
      console.log(`  every PID this run started or found: ${JSON.stringify(c.tracked.map((p) => `${p.pid} ${p.label}`))}`);
      console.log(`  fictional data ${c.keepData ? `kept at ${rel(harness.server.dataRoot)}` : c.dataRemoved ? "removed" : "NOT removed"}; screenshots and logs in ${rel(runDir)}`);
      cleanupOk = !c.serverReport.stillRunning && !c.leftoverEdge.length && !c.leftover.length && !c.profilesLeft.length && c.edgeReports.every((e) => e.profileRemoved && !e.survivors.length);
      if (!cleanupOk) console.log("  CLEANUP INCOMPLETE (see above)");
    }
    const { pass, fail, skip } = t.counts();
    fs.writeFileSync(path.join(runDir, "results.json"), JSON.stringify({ runId, base: harness ? harness.base : null, results: t.results }, null, 2));
    const code = fail || extraFailure || !cleanupOk ? 1 : 0;
    console.log(`\nResult: ${pass} passed, ${fail} failed, ${skip} skipped${cleanupOk ? "" : ", cleanup incomplete"} (exit ${code})`);
    return code;
  })();
  return finishing;
}

process.on("SIGINT", async () => { console.log("\nInterrupted: cleaning up"); process.exit(await finish(true)); });

let setupFailed = false;
try {
  harness = await createHarness({ runDir, keepData: args.keepData });
  console.log(`BudgetTracker e2e run ${runId}`);
  console.log(`  isolated dev server ${harness.base} (pid ${harness.server.pid}), fresh fictional seed in ${rel(harness.server.dataRoot)}`);
  console.log(`  evidence in ${rel(runDir)}; Edge ${edgeAvailable() ? EDGE : "NOT FOUND"}`);
  for (const s of selected) {
    console.log(`\n== ${s.name}: ${s.title}`);
    t.scenario(s.name);
    if (s.needsBrowser && !edgeAvailable()) { t.skip(s.name, `Microsoft Edge was not found at ${EDGE}; set BT_EDGE_PATH`); continue; }
    try {
      await s.run(harness, t);
    } catch (err) {
      t.check("the scenario ran to its end", { expected: "no error", actual: String((err && err.stack) || err).split("\n").slice(0, 3).join(" | "), pass: false });
    } finally {
      await harness.closeBrowsers();
    }
  }
} catch (err) {
  setupFailed = true;
  console.error(`Harness setup failed: ${(err && err.stack) || err}`);
}
process.exit(await finish(setupFailed));
