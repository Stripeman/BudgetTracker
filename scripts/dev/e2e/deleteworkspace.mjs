// "DELETE WORKSPACE" (Terry, 2026-09-14: "as workspace admin, if I decide I don't want the workspace
// anymore..."), TWO BROWSERS AT ONCE, fictional data only. Alice (owner) deletes a workspace from her
// own browser on the Workspace page; Bob (member), open in his own browser at the same time, loses
// access; Alice brings it back from "Deleted workspaces" in My settings; Bob regains access. The
// underlying archive is recoverable (BT-001-05): nothing recorded is ever erased.
//
// Reuses the seeded "Fictional Household" (alice owner, bob already a member) rather than creating a
// new workspace: workspace creation is bounded to 10 a day per person (SEC-R5), and a full `npm run e2e`
// runs every scenario against the same isolated seed in one day, several of which already create a
// workspace as alice. This scenario runs last and brings the household back before it ends, so the
// household is exactly as the other scenarios left it by the time the run finishes.
import { firstRecord } from "../harness/fixtures.mjs";

export const name = "deleteworkspace";
export const title = "Delete workspace (owner) and Bring back: Bob loses access while it is deleted and regains it once Alice brings it back";
export const needsBrowser = true;

const pickerOptions = (s) => s.evaluate("[...document.querySelectorAll('#workspace-picker option')].map((o) => o.textContent)");
const DELETED_CARD = 'section[aria-labelledby="set-deleted"]';
const NAME = "Fictional Household";

export async function run(h, t) {
  const api = (u) => h.api(u);
  const found = (await api("alice").ok("workspaces")).workspaces.find((w) => w.name === NAME);
  if (!found) { t.skip("deleteworkspace", `the seeded workspace "${NAME}" was not found`); return; }
  const q = { workspaceId: found.id };
  const wallet = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Delete Wallet", type: "cash", currency: "EUR", visibility: "shared", openingBalance: "50.00" } }));
  await api("bob").ok("transactions", { method: "POST", query: q, body: { accountId: wallet.id, kind: "expense", amount: "4.50", notes: "E2E before delete" } });
  const W = { id: found.id, name: NAME, q };
  t.note(`workspace ${W.name}: ${W.id}`);

  const b = await h.browsers(["alice", "bob"], { prefix: "delete-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }

  // ---- before: Bob has ordinary access -------------------------------------------------------------
  await b.bob.goto("transactions");
  const beforeBob = await api("bob").request("accounts", { query: q });
  t.check("before: Bob's browser is in the workspace, and the API answers him normally", {
    expected: { picker: true, api: 200 },
    actual: { picker: (await pickerOptions(b.bob)).includes(W.name), api: beforeBob.status },
  });

  // ---- Alice deletes it, from her own browser --------------------------------------------------------
  await b.alice.goto("workspace");
  await b.alice.waitForText("Delete workspace…", { scope: "main" });
  await b.alice.click({ role: "button", name: "Delete workspace…", scope: "main" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Delete workspace dialog" });
  // A wrong name is refused, in the dialog, before anything is sent.
  await b.alice.fill({ label: `Type ${W.name} to confirm`, scope: ".modal" }, "not the right name");
  await b.alice.click({ role: "button", name: "Delete workspace", scope: ".modal" });
  await b.alice.waitForText(`Type the workspace name, ${W.name}, to confirm.`, { scope: ".modal" });
  const stillOpen = await b.alice.exists(".modal");
  t.note(`screenshot of the refused delete: ${await b.alice.shot("delete-refused")}`);
  await b.alice.fill({ label: `Type ${W.name} to confirm`, scope: ".modal" }, W.name);
  await b.alice.click({ role: "button", name: "Delete workspace", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after deleting" });
  await b.alice.settle();
  t.check("a wrong name is refused inside the dialog; the right name deletes it and closes the dialog", { expected: { stillOpen: true }, actual: { stillOpen } });

  // ---- after: it is gone from Alice's own picker; she landed somewhere real ---------------------------
  const aliceOptions = await pickerOptions(b.alice);
  const aliceRoute = await b.alice.evaluate("location.hash");
  t.check("Alice's browser drops it from her workspace picker at once and shows another workspace", { expected: { gone: true, onDashboard: true }, actual: { gone: !aliceOptions.includes(W.name), onDashboard: aliceRoute.startsWith("#/dashboard") } });

  // ---- Bob loses access: the API, and his own browser after a reload ----------------------------------
  const duringBob = await api("bob").request("accounts", { query: q });
  t.check("Bob's API access is refused while it is deleted, without disclosing anything about it", { expected: { status: 404, message: "This workspace is not available." }, actual: { status: duringBob.status, message: duringBob.message } });
  // A reload's own convenience re-selects the session's remembered workspace (useWorkspace); it is
  // exactly what must NOT be offered now, so the reload here is plain — forgetting it first.
  b.bob.workspace = null;
  await b.bob.reload();
  const bobOptionsDuring = await pickerOptions(b.bob);
  t.note(`screenshot of Bob's picker while it is deleted: ${await b.bob.shot("bob-during-delete")}`);
  t.check("Bob's own browser no longer lists it after a reload", { expected: false, actual: bobOptionsDuring.includes(W.name) });

  // ---- Alice brings it back, from My settings ----------------------------------------------------------
  await b.alice.goto("settings");
  await b.alice.waitForText("Deleted workspaces", { scope: "main" });
  await b.alice.waitForText(W.name, { scope: DELETED_CARD });
  t.note(`screenshot of Deleted workspaces: ${await b.alice.shot("deleted-workspaces")}`);
  await b.alice.click({ role: "button", name: `Bring back ${W.name}`, scope: DELETED_CARD });
  await b.alice.waitForText(`${W.name} is back.`, { scope: DELETED_CARD });
  await b.alice.settle();
  const afterBring = await pickerOptions(b.alice);
  t.check("Bring back says it is back and returns it to Alice's own workspace picker", { expected: true, actual: afterBring.includes(W.name) });

  // ---- Bob regains access -------------------------------------------------------------------------------
  const afterBob = await api("bob").request("accounts", { query: q });
  await b.bob.reload();
  const bobOptionsAfter = await pickerOptions(b.bob);
  t.check("Bob's API access and his own browser's picker both return, once Alice has brought it back", {
    expected: { api: 200, picker: true },
    actual: { api: afterBob.status, picker: bobOptionsAfter.includes(W.name) },
  });
  // Nothing recorded was lost: Bob's entry from before the delete is still there.
  const entries = await api("alice").ok("transactions", { query: q });
  t.check("nothing recorded was lost: Bob's entry from before the delete is still there", { expected: true, actual: entries.transactions.some((x) => x.notes === "E2E before delete") });

  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems({ allowHttp: [{ status: 404, path: /\/api\/(accounts|transactions)/ }] }) }); }
}
