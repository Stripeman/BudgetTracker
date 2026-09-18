// WORKSPACE CREATION QUOTA (Terry, 2026-09-18: "Give scenarios isolated synthetic identities or
// fresh isolated test state while retaining dedicated quota coverage. Do not weaken the application's
// actual limits or silently skip failing scenarios."). This is the "dedicated quota coverage" half of
// that instruction: a scenario that DELIBERATELY, on purpose, in its own isolated server (so it can
// never collide with or be collided into by any other scenario), proves the real
// 10-workspaces-per-day-per-owner limit (api/_shared/store.js `recordCreation`, `MAX_CREATIONS_PER_
// DAY`) still works end to end against a real running server — not lowered, not mocked, not skipped.
// It is the reason every OTHER scenario no longer needs to (and, since the harness isolation fix, no
// longer can accidentally) exercise this limit as a side effect of simply calling createWorkspace().
import { newIdempotencyKey } from "../harness/api.mjs";

export const name = "quota";
export const title = "Workspace creation quota: the real 10-a-day-per-owner limit is enforced, per user, and never touched by test-harness isolation";
export const needsBrowser = false;

// The real, documented default (api/_shared/store.js MAX_CREATIONS_PER_DAY, stated verbatim in its
// own refusal message). The fictional seed (scripts/dev/seed.mjs) already creates exactly 2
// workspaces for alice ("Fictional Household", "Fictional Dinner Club") before any scenario runs, on
// this SAME freshly seeded, isolated server — so this scenario tops her up to the real limit rather
// than assuming a fresh zero, and asserts the exact boundary either way.
const DAILY_LIMIT = 10;
const SEED_ALREADY_USED = 2;

export async function run(h, t) {
  const alice = h.api("alice");
  const bob = h.api("bob");
  const remaining = DAILY_LIMIT - SEED_ALREADY_USED;
  const created = [];
  const statuses = [];
  for (let i = 1; i <= remaining; i += 1) {
    const res = await alice.request("workspaces", { method: "POST", body: { name: `E2E Quota ${i}`, kind: "personal" }, idempotencyKey: newIdempotencyKey() });
    statuses.push(res.status);
    if (res.ok) created.push(res.data.workspace.id);
  }
  t.check(`alice tops up to today's real, unweakened ${DAILY_LIMIT}-a-day limit (the seed already used ${SEED_ALREADY_USED}; ${remaining} more succeed here)`, {
    expected: remaining, actual: created.length,
  });

  const overLimit = await alice.request("workspaces", { method: "POST", body: { name: "E2E Quota over the limit", kind: "personal" }, idempotencyKey: newIdempotencyKey() });
  t.check(`the ${DAILY_LIMIT + 1}th workspace today is refused with 409 workspace_rate — the real limit, not raised or skipped for this test`, {
    expected: { status: 409, code: "workspace_rate" }, actual: { status: overLimit.status, code: overLimit.code },
  });
  t.check("nothing was written for the refused attempt (no partial workspace)", { expected: false, actual: !!(overLimit.data && overLimit.data.workspace) });

  // The limit is per OWNER, not global or per-server: a different fictional identity, on the SAME
  // isolated server, on the SAME day, is completely unaffected by alice's exhausted quota.
  const bobsFirst = await bob.request("workspaces", { method: "POST", body: { name: "E2E Quota Bob 1", kind: "personal" }, idempotencyKey: newIdempotencyKey() });
  t.check("a different owner (bob), on the same server and the same day, is unaffected by alice's exhausted quota (the limit is per person)", {
    expected: 201, actual: bobsFirst.status,
  });

  // The refusal is real and persists — trying again (a different attempt, a different Idempotency-
  // Key) is refused again, not a one-off glitch of exactly one call.
  const another = await alice.request("workspaces", { method: "POST", body: { name: "E2E Quota further attempt", kind: "personal" }, idempotencyKey: newIdempotencyKey() });
  t.check("alice is still refused on a further attempt after the limit (the refusal persists, not a one-off)", { expected: 409, actual: another.status });

  t.note(`topped up ${created.length} workspaces for alice this run (statuses: ${JSON.stringify(statuses)}); ids: ${JSON.stringify(created)}`);
}
