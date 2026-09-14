// Processes the harness starts, and ONLY those. Every process it spawns is recorded with its Node
// child handle; an Edge child process is recorded when it is found by the harness's own profile path
// under .local/. Nothing here looks up or stops a process by name or port.
//
// PID REUSE: Windows reuses a PID soon after its process exits (seen in concurrent runs). So:
//   * a process we spawned is killed only while its child handle says it is still running (Windows
//     never reuses the PID of a process while a handle to it is open);
//   * a process found by profile path is killed only right after it is found again holding that path,
//     one process at a time (no /T), never from an earlier list.
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = [];

export const isRunning = (child) => !!child && child.exitCode === null && child.signalCode === null;

// What was started or found, and whether a spawned process is still running (found ones are checked
// by profile path instead, which cannot be confused by a reused PID).
export const tracked = () => started.map(({ child, ...p }) => ({ ...p, running: child ? isRunning(child) : null }));

export function spawnTracked(command, args, { label, kind, profile = null, ...options }) {
  const child = spawn(command, args, { windowsHide: true, ...options });
  if (!child.pid) throw new Error(`${label} did not start (${command}).`);
  started.push({ pid: child.pid, label, kind, profile, found: false, child });
  return child;
}

// A process found by our own profile path (an Edge child) is recorded as ours too.
export function remember(pid, label, kind, profile) {
  if (!started.some((p) => p.pid === pid)) started.push({ pid, label, kind, profile, found: true, child: null });
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; }
}

function run(file, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

// Stops a process the harness owns (see the PID-reuse rules above). On Windows `taskkill /F /PID`,
// with /T for a tree we spawned: Edge and the dev server ignore a plain kill of the parent (Edge
// survived edge.kill(), PROJECT_STATE tooling debt).
export async function killTree(pid, { tree = true } = {}) {
  if (!isAlive(pid)) return false;
  if (process.platform === "win32") await run("taskkill", [...(tree ? ["/T"] : []), "/F", "/PID", String(pid)]);
  else { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  for (let i = 0; i < 30 && isAlive(pid); i += 1) await sleep(100);
  return true;
}

// PIDs of `image` processes whose command line contains `fragment` — always a path under the
// harness's own run directory in .local/, so only our own browsers can match.
export async function pidsByCommandLine(fragment, image = "msedge.exe") {
  if (process.platform === "win32") {
    const frag = String(fragment).replace(/'/g, "''");
    const script = `Get-CimInstance Win32_Process -Filter "Name='${image}'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf('${frag}', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { $_.ProcessId }`;
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return stdout.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  }
  const { stdout } = await run("ps", ["-eo", "pid=,args="]);
  return stdout.split("\n").filter((line) => line.includes(fragment) && line.includes(image.replace(/\.exe$/, ""))).map((line) => Number(line.trim().split(/\s+/)[0])).filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
}

// Removes a directory the harness created, retrying while Windows still holds a lock on it.
export async function removeDir(dir, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked; retry */ }
    if (!fs.existsSync(dir)) return true;
    await sleep(250);
  }
  return !fs.existsSync(dir);
}

export function exitOf(child, timeout) {
  return new Promise((resolve) => {
    if (!isRunning(child)) { resolve(child.exitCode); return; }
    const timer = setTimeout(() => resolve(null), timeout);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
}
