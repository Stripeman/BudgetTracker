// Guard rails of the multi-user browser harness (BT-004-06): which ports it may use, where it may
// write, and its command-line options. Pure functions, tested in test/harness.test.cjs.
import net from "node:net";
import path from "node:path";
import { ROOT, LOCAL, isInside } from "../dataroot.mjs";

export { ROOT, LOCAL, isInside };

// Never bound, stopped or touched: the other local application's ports (SWA CLI 4280, Functions
// host 7071, Azurite 10000-10002) and Terry's own BudgetTracker dev server (4380).
export const RESERVED_PORTS = Object.freeze([4280, 4380, 7071, 10000, 10001, 10002]);

export function assertAllowedPort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Port ${port} is not a usable local port.`);
  if (RESERVED_PORTS.includes(port)) throw new Error(`Port ${port} is reserved (another local application or Terry's dev server); the harness never uses it.`);
  return port;
}

// Everything the harness writes (data, profiles, logs, screenshots) is strictly inside .local/.
export function assertUnderLocal(target, root = ROOT) {
  const full = path.resolve(target);
  if (!isInside(path.join(root, ".local"), full)) throw new Error(`${full} is not inside .local/; the harness writes nowhere else.`);
  return full;
}

// A free loopback port chosen by the operating system, never a reserved one.
export async function freePort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.unref();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const { port: chosen } = probe.address();
        probe.close(() => resolve(chosen));
      });
    });
    if (!RESERVED_PORTS.includes(port)) return port;
  }
  throw new Error("No free local port was found.");
}

//   --only a,b     run only these scenarios (also --only=a,b; repeatable)
//   --keep-data    keep the run's fictional data directory afterwards (profiles are always removed)
//   --list         list the scenarios and exit
export function parseArgs(argv) {
  const out = { only: null, keepData: false, list: false, help: false };
  const addOnly = (value) => {
    const names = String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!names.length) throw new Error("--only needs one or more scenario names.");
    out.only = [...(out.only || []), ...names];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--only") { addOnly(argv[i + 1]); i += 1; }
    else if (a.startsWith("--only=")) addOnly(a.slice("--only=".length));
    else if (a === "--keep-data") out.keepData = true;
    else if (a === "--list") out.list = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown option ${a}.`);
  }
  return out;
}
