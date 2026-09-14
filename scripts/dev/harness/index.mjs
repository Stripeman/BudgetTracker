// The multi-user real-browser test harness (BT-004-06).
//
//   const h = await createHarness({ runDir });          // isolated, freshly seeded dev server
//   const { alice, bob } = await h.browsers(["alice", "bob"]);   // concurrent headless Edge sessions
//   await alice.open("group"); await alice.click({ role: "button", name: "Add expense" });
//   await Promise.all([h.api("alice").request(...), h.api("alice").request(...)]);   // parallel API
//   const cleanup = await h.close();                    // every process it started, stopped and verified
//
// Fictional users (scripts/dev/server.mjs): alice owner, bob member, carol viewer of the seeded
// household; dave a site administrator (by configuration, never by membership); eve an outsider.
import fs from "node:fs";
import path from "node:path";
import { assertUnderLocal } from "./guards.mjs";
import { startIsolatedServer } from "./devserver.mjs";
import { openSession } from "./session.mjs";
import { apiClient } from "./api.mjs";
import { tracked, pidsByCommandLine, removeDir } from "./processes.mjs";

export { edgeAvailable, EDGE } from "./edge.mjs";
export { newIdempotencyKey } from "./api.mjs";

export async function createHarness({ runDir, keepData = false }) {
  assertUnderLocal(runDir);
  fs.mkdirSync(path.join(runDir, "shots"), { recursive: true });
  const server = await startIsolatedServer({ runDir });
  const open = new Set();
  const edgeReports = [];

  const harness = {
    base: server.base,
    server,
    runDir,
    api: (user) => apiClient(server.base, user),

    // Starts one headless Edge per fictional user at the same time, each with its own profile,
    // debugging port and sign-in. If any fails to start, the others are closed again.
    async browsers(users, { prefix = "", width, height } = {}) {
      const settled = await Promise.allSettled(users.map((user) => openSession({ base: server.base, user, runDir, prefix, width, height })));
      const started = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
      for (const s of started) open.add(s);
      const failed = settled.find((s) => s.status === "rejected");
      if (failed) { await harness.closeBrowsers(); throw failed.reason; }
      return Object.fromEntries(started.map((s) => [s.name, s]));
    },

    async closeBrowsers() {
      const list = [...open];
      open.clear();
      const reports = await Promise.all(list.map((s) => s.close()));
      edgeReports.push(...reports);
      return reports;
    },

    // Stops everything it started and proves it: no browser still holding a profile under this run,
    // no spawned process still running (by its own handle, so a reused PID cannot confuse it), the
    // profiles gone, and (unless kept) the run's fictional data removed.
    async close() {
      await harness.closeBrowsers();
      const serverReport = await server.stop();
      const profilesDir = path.join(runDir, "profiles");
      const leftoverEdge = await pidsByCommandLine(profilesDir);
      const leftover = tracked().filter((p) => p.running === true);
      const profilesLeft = fs.existsSync(profilesDir) ? fs.readdirSync(profilesDir) : [];
      if (!profilesLeft.length && fs.existsSync(profilesDir)) await removeDir(profilesDir);
      const dataRemoved = keepData ? false : await removeDir(assertUnderLocal(server.dataRoot));
      return { serverReport, edgeReports, leftoverEdge, leftover, profilesLeft, dataRemoved, keepData, tracked: tracked() };
    },
  };
  return harness;
}
