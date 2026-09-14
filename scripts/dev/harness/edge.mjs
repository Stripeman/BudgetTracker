// Starting and RELIABLY stopping headless Microsoft Edge on Windows (BT-004-06).
//
// Each browser has its own throwaway profile under .local/ and its own loopback debugging port.
// Stopping one is done in this order, because Edge keeps its profile locked and survives a plain
// kill of the process it was started as (PROJECT_STATE "tooling debt"; seen again here: a process
// still held the profile after Browser.close):
//   1. record every msedge.exe whose command line holds OUR profile path (the browser and children);
//   2. ask the browser to close through CDP (Browser.close) and give it a moment;
//   3. if the process we started is still running (its Node handle says so), kill its tree;
//   4. find again what still holds our profile path and kill exactly those, one at a time — never
//      from the earlier list, whose PIDs may have been reused by another program since;
//   5. remove the profile, retrying while Windows releases its locks.
// Nothing else is ever looked up or stopped.
import fs from "node:fs";
import { connect } from "./cdp.mjs";
import { spawnTracked, remember, killTree, isRunning, pidsByCommandLine, removeDir } from "./processes.mjs";
import { assertAllowedPort, assertUnderLocal } from "./guards.mjs";

export const EDGE = process.env.BT_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const edgeAvailable = () => fs.existsSync(EDGE);

export async function launchEdge({ profile, port, label, width = 1280, height = 900 }) {
  assertUnderLocal(profile);
  assertAllowedPort(port);
  fs.mkdirSync(profile, { recursive: true });
  const child = spawnTracked(EDGE, [
    "--headless=new", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking",
    "--disable-component-update", `--window-size=${width},${height}`, "about:blank",
  ], { label, kind: "edge", profile, stdio: "ignore" });
  let spawnError = null;
  child.once("error", (err) => { spawnError = err; });
  const handle = { child, pid: child.pid, profile, port, label, browserWs: null, pageWs: null, product: null };
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (spawnError) break;
    try {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (version.webSocketDebuggerUrl && page) {
        Object.assign(handle, { browserWs: version.webSocketDebuggerUrl, pageWs: page.webSocketDebuggerUrl, product: version.Browser });
        return handle;
      }
    } catch { /* not listening yet */ }
    await sleep(150);
  }
  const report = await stopEdge(handle);
  throw new Error(`${label}: Edge did not open its debugging port ${port}${spawnError ? ` (${spawnError.message})` : ""}; cleanup ${JSON.stringify(report)}`);
}

export async function stopEdge({ child, profile, browserWs, label }) {
  assertUnderLocal(profile);
  const report = { label, pid: child ? child.pid : null, profile, seen: [], closedByCdp: false, killed: [], survivors: [], profileRemoved: false };
  report.seen = await pidsByCommandLine(profile);
  for (const p of report.seen) remember(p, `${label} (found by its profile path)`, "edge", profile);
  if (browserWs) {
    try {
      const browser = connect(browserWs, { timeoutMs: 4000 });
      await browser.send("Browser.close");
      browser.close();
      report.closedByCdp = true;
    } catch { /* already gone or not answering: the steps below cover it */ }
  }
  for (let i = 0; i < 30 && isRunning(child); i += 1) await sleep(100);
  if (isRunning(child) && await killTree(child.pid)) report.killed.push(child.pid);
  for (const p of await pidsByCommandLine(profile)) {
    remember(p, `${label} (found by its profile path)`, "edge", profile);
    if (await killTree(p, { tree: false })) report.killed.push(p);
  }
  await sleep(200);
  report.survivors = [...(await pidsByCommandLine(profile)), ...(isRunning(child) ? [child.pid] : [])];
  report.profileRemoved = await removeDir(profile);
  return report;
}
