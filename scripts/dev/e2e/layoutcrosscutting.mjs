// BT-013-16 item 8 (Terry, 2026-09-21): the cross-cutting concerns individual per-page flagship
// scenarios cannot catch on their own — two workspaces applying genuinely DIFFERENT flagship layouts
// at the same time with no cross-contamination, and a member's own real privacy holding up
// SPECIFICALLY under a flagship-rendered Dashboard and Accounts page (not just Classic, which
// already has this coverage elsewhere, e.g. privacy.mjs). TWO WORKSPACES, TWO BROWSERS (owner +
// member) AT ONCE.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";
import { newIdempotencyKey } from "../harness/api.mjs";

export const name = "layoutcrosscutting";
export const title = "BT-013-16 item 8: two workspaces with different flagship layouts at once, and a member's real privacy holding up under a flagship renderer";
export const needsBrowser = true;

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  // ---- two workspaces, two genuinely different flagship layouts, at the same time -------------------
  const A = await createWorkspace(h, { name: "E2E Cross-cutting Household A", kind: "household", members: { bob: "member" } });
  const B = await createWorkspace(h, { name: "E2E Cross-cutting Household B", kind: "household" });
  const apiAlice = h.api("alice");
  await applyLayout(apiAlice, A.ws.id, "ledgerfly-forecast");
  await applyLayout(apiAlice, B.ws.id, "acru-overview");

  // A private account only Alice can see, plus a shared one Bob can, in workspace A.
  const hidden = firstRecord(await apiAlice.ok("accounts", { method: "POST", query: A.q, body: { name: "E2E Alice Private Reserve", type: "savings", currency: "EUR", openingBalance: "9999.00" }, idempotencyKey: newIdempotencyKey() }));
  const shared = firstRecord(await apiAlice.ok("accounts", { method: "POST", query: A.q, body: { name: "E2E Shared Checking", type: "checking", currency: "EUR", visibility: "shared", openingBalance: "200.00" }, idempotencyKey: newIdempotencyKey() }));
  await apiAlice.ok("transactions", { method: "POST", query: A.q, body: { accountId: hidden.id, kind: "expense", amount: "42.00", notes: "E2E-PRIVATE-NOTE" } });

  const b = await h.browsers(["alice", "bob"], { prefix: "layoutcrosscutting-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); }
  await b.alice.useWorkspace(A.name);
  await b.bob.useWorkspace(A.name);

  // ---- Alice (owner, workspace A): Executive Forecast, with her own private account visible --------
  await b.alice.goto("dashboard");
  await b.alice.waitFor("!!document.querySelector('.dashflag')", { what: "Alice's Executive Forecast Dashboard" });
  const aliceText = await b.alice.text(".dashflag");
  await b.alice.shot("1-alice-executive-forecast");
  // The private account's real balance after its own 42.00 expense (9999.00 - 42.00 = 9957.00),
  // shown both on its own account row and inside the net-position total (9957.00 + 200.00 = 10157.00).
  t.check("Alice (owner) sees her own private account's real balance reflected under Executive Forecast", {
    expected: true, actual: aliceText.includes("E2E Alice Private Reserve") && /9,?957\.00/.test(aliceText) && /10,?157\.00/.test(aliceText),
  });

  // ---- Bob (member, SAME workspace A, SAME layout): never sees Alice's private account or note ------
  await b.bob.goto("dashboard");
  await b.bob.waitFor("!!document.querySelector('.dashflag')", { what: "Bob's Executive Forecast Dashboard (the SAME workspace layout, not his own choice)" });
  const bobDashText = await b.bob.text(".dashflag");
  await b.bob.shot("2-bob-executive-forecast-same-workspace");
  t.check("Bob sees the SAME workspace layout (Executive Forecast) as Alice — layout is workspace-wide, not personal", { expected: true, actual: !!bobDashText });
  t.check("Bob's Executive Forecast Dashboard never shows Alice's private account name, note, real balance, or the combined total that would include it", {
    expected: false, actual: bobDashText.includes("E2E Alice Private Reserve") || bobDashText.includes("E2E-PRIVATE-NOTE") || /9,?957\.00/.test(bobDashText) || /10,?157\.00/.test(bobDashText),
  });
  t.check("Bob's Executive Forecast Dashboard DOES show the shared account he is authorized to see", { expected: true, actual: bobDashText.includes("200.00") });

  await b.bob.goto("accounts");
  await b.bob.waitFor("!!document.querySelector('.dashflag')", { what: "Bob's Executive Forecast Accounts page" });
  const bobAcctText = await b.bob.text(".dashflag");
  t.check("Bob's Executive Forecast Accounts page never shows Alice's private account at all, not even its name", { expected: false, actual: bobAcctText.includes("E2E Alice Private Reserve") });
  t.check("Bob's Executive Forecast Accounts page shows only the one account he is authorized to see", { expected: true, actual: bobAcctText.includes("E2E Shared Checking") });

  // ---- Workspace B (a different workspace, Financial Overview): genuinely independent ---------------
  await b.alice.useWorkspace(B.name);
  await b.alice.goto("dashboard");
  await b.alice.waitFor("!!document.querySelector('.dashflag')", { what: "Alice's Financial Overview Dashboard in the OTHER workspace" });
  const bDashText = await b.alice.text(".dashflag");
  t.check("Workspace B renders its own, genuinely different flagship layout (Financial Overview, not Executive Forecast)", { expected: true, actual: !bDashText.includes("Total balance") });
  t.check("Workspace B shows none of Workspace A's real data (a completely separate tenant)", {
    expected: false, actual: bDashText.includes("E2E Alice Private Reserve") || bDashText.includes("E2E Shared Checking") || /9,?957\.00/.test(bDashText),
  });

  // Switching back confirms A kept its OWN layout the whole time, unaffected by B's.
  await b.alice.useWorkspace(A.name);
  await b.alice.goto("dashboard");
  await b.alice.waitFor("!!document.querySelector('.dashflag')", { what: "Alice back on workspace A's own Executive Forecast" });
  const aBackText = await b.alice.text(".dashflag");
  t.check("Workspace A still shows Executive Forecast's own identity after visiting workspace B, unaffected by B's own layout", { expected: true, actual: aBackText.includes("Total balance") });

  t.check("alice: no console errors/exceptions", { expected: [], actual: b.alice.problems() });
  t.check("bob: no console errors/exceptions", { expected: [], actual: b.bob.problems() });
  await b.alice.close();
  await b.bob.close();
}
