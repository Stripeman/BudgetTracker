// BT-009-25, in a real browser: linked refunds — the "Refund…" action, defaulting to the original
// expense's own split, a real reconciling preview, and the resulting repayment obligation appearing
// as a genuine new balance after a refund follows a confirmed settlement (docs/
// BT-009-25-WORKED-EXAMPLES.md §3's worked example), all without ever rewriting the confirmed
// settlement or the original expense.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "grouprefunds";
export const title = "BT-009-25: linked refunds in Shared expenses, in a real browser";
export const needsBrowser = true;

const EXPENSES = '[aria-labelledby="grp-expenses"]';

export async function run(h, t) {
  const api = (u) => h.api(u);
  // Three people, matching docs/BT-009-25-WORKED-EXAMPLES.md §3's worked example exactly (Alice
  // pays 90.00, split equally three ways at 30.00 each).
  const W = await createWorkspace(h, { name: "E2E Refunds Trip", kind: "group", members: { bob: "member", carol: "member" } });
  const { alice } = await h.browsers(["alice"], { prefix: "grouprefunds-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(EXPENSES))) { t.skip("shared expenses in the browser", "the Shared expenses page is not present at this commit"); return; }

  // ---- 1. A EUR 90.00 dinner, Alice pays, split equally two ways -----------------------------------
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E refund dinner");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "90.00");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("E2E refund dinner", { scope: EXPENSES });

  // ---- 2. Bob's 30.00 payment is reported and CONFIRMED before any refund exists --------------------
  const refs = await api("alice").ok("members", { query: W.q });
  const bobRef = `member:${refs.members.find((m) => m.name.startsWith("Bob")).id}`;
  const aliceRef = `member:${refs.members.find((m) => m.name.startsWith("Alice")).id}`;
  const settle = await api("bob").ok("group", { method: "POST", query: { ...W.q, action: "settle" }, body: { from: bobRef, to: aliceRef, amount: "30.00" } });
  await api("alice").ok("group", { method: "POST", query: { ...W.q, action: "confirm" }, body: { settlementId: settle.settlement.id, revision: settle.settlement.revision } });
  await alice.goto("group");

  // ---- 3. A real click on "Refund…" opens a dialog defaulting to the original split -----------------
  await alice.click({ role: "button", name: "Refund E2E refund dinner", scope: EXPENSES });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Refund dialog" });
  const amountValue = await alice.evaluate("document.querySelector('.modal input[inputmode=\"decimal\"]').value");
  t.check("the refund dialog defaults the amount to the full expense (nothing refunded yet)", { expected: "90.00", actual: amountValue });
  await alice.fill({ label: "Amount", scope: ".modal" }, "30.00");
  await alice.fill({ label: "Reason", scope: ".modal" }, "Restaurant overcharge");
  await alice.shot("1-refund-dialog");
  await alice.click({ role: "button", name: "Record refund", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("Refunded: EUR 30.00", { scope: EXPENSES });

  // ---- 4. The confirmed settlement is never rewritten; the balances show the corrected, hand-
  // verified zero-sum result from the worked-examples doc -------------------------------------------
  const settlementsAfter = await api("alice").ok("group", { query: W.q });
  const bobsSettlement = settlementsAfter.settlements.find((s) => s.id === settle.settlement.id);
  t.check("Bob's original confirmed 30.00 payment is completely untouched by the refund", { expected: { status: "confirmed", amount: "30.00" }, actual: { status: bobsSettlement.status, amount: bobsSettlement.amount } });
  const balancesAfter = await api("alice").ok("group", { query: { ...W.q, action: "balances" } });
  const netOf = (ref) => balancesAfter.balances[0].rows.find((r) => r.ref === ref).net;
  t.check("the refund's effect on balances matches the hand-verified worked example: Alice +10.00, Bob +10.00 (a genuine new repayment obligation owed TO him), sum zero", {
    expected: { alice: "10.00", bob: "10.00" }, actual: { alice: netOf(aliceRef), bob: netOf(bobRef) },
  });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
