// An ISOLATED local dev server for one harness run: its own free port (never 4280, 4380, 7071 or
// 10000-10002), its own data directory under .local/e2e/<run>/data, seeded fresh with the fictional
// seed. Terry's .local/dev-data and his server on 4380 are never read, written or touched.
import fs from "node:fs";
import path from "node:path";
import { ROOT, assertUnderLocal, assertAllowedPort, freePort } from "./guards.mjs";
import { spawnTracked, killTree, isRunning, exitOf } from "./processes.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startIsolatedServer({ runDir }) {
  const dataRoot = assertUnderLocal(path.join(runDir, "data"));
  if (fs.existsSync(dataRoot) && fs.readdirSync(dataRoot).length) throw new Error(`${dataRoot} is not empty; every run seeds fresh data.`);
  fs.mkdirSync(dataRoot, { recursive: true });
  const env = { ...process.env, BT_DEV_DATA_ROOT: dataRoot };
  delete env.BT_DEV_PORT;

  const seedLog = path.join(runDir, "seed.log");
  const seedFd = fs.openSync(seedLog, "w");
  const seed = spawnTracked(process.execPath, [path.join(ROOT, "scripts", "dev", "seed.mjs")], { label: "fictional seed", kind: "node", cwd: ROOT, env, stdio: ["ignore", seedFd, seedFd] });
  fs.closeSync(seedFd);
  const seedCode = await exitOf(seed, 180000);
  if (seedCode !== 0) {
    if (isRunning(seed)) await killTree(seed.pid);
    throw new Error(`The fictional seed failed (exit ${seedCode}); see ${path.relative(ROOT, seedLog)}.`);
  }

  const logFile = path.join(runDir, "server.log");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = assertAllowedPort(await freePort());
    const fd = fs.openSync(logFile, "a");
    const child = spawnTracked(process.execPath, [path.join(ROOT, "scripts", "dev", "server.mjs")], {
      label: "isolated dev server", kind: "node", cwd: ROOT, env: { ...env, BT_DEV_PORT: String(port) }, stdio: ["ignore", fd, fd],
    });
    fs.closeSync(fd);
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30000;
    let up = false;
    while (Date.now() < deadline && child.exitCode === null) {
      // Our own server answers for the fictional outsider Eve, who exists only in this dev server.
      try { up = (await fetch(`${base}/api/me`, { headers: { Cookie: "bt_dev_user=eve", Accept: "application/json" } })).status === 200; } catch { up = false; }
      if (up) break;
      await sleep(150);
    }
    if (up && child.exitCode === null) {
      return {
        base, port, pid: child.pid, dataRoot, logFile,
        async stop() {
          const wasRunning = isRunning(child);
          if (wasRunning) await killTree(child.pid);
          await exitOf(child, 5000);
          return { label: "isolated dev server", pid: child.pid, port, wasRunning, stillRunning: isRunning(child) };
        },
      };
    }
    if (isRunning(child)) await killTree(child.pid);
  }
  throw new Error(`The isolated dev server did not start; see ${path.relative(ROOT, logFile)}.`);
}
