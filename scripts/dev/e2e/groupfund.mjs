// BT-009-25, in a real browser: shared income / prepaid contributions / deposits — the Shared fund
// card, adding a contribution, applying part of it to a fund-paid expense, returning the leftover,
// and proving the ordinary Shared-expenses balance is completely unaffected throughout (docs/
// BT-009-25-WORKED-EXAMPLES.md §4's worked example).
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "groupfund";
export const title = "BT-009-25: the shared fund (contributions/deposits) in Shared expenses, in a real browser";
export const needsBrowser = true;

const FUND = '[aria-labelledby="grp-fund"]';

export async function run(h, t) {
  const api = (u) => h.api(u);
  const W = await createWorkspace(h, { name: "E2E Fund Trip", kind: "group", members: { bob: "member" } });
  const { alice } = await h.browsers(["alice"], { prefix: "groupfund-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(FUND))) { t.skip("the shared fund in the browser", "the Shared fund card is not present at this commit"); return; }

  const fundText = await alice.text(FUND);
  t.check("the Shared fund card states plainly that this never counts as income or spending, and never changes the Balances card", { expected: true, actual: fundText.includes("never counts as income or spending, and never changes the Balances card above") });

  // ---- 1. An ordinary shared expense, to prove its balance stays untouched by fund activity --------
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E fund-paid hotel");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "100.00");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });

  const refs = await api("alice").ok("members", { query: W.q });
  const aliceRef = `member:${refs.members.find((m) => m.name.startsWith("Alice")).id}`;
  const balancesBefore = await api("alice").ok("group", { query: { ...W.q, action: "balances" } });
  const netBefore = balancesBefore.balances[0].rows.find((r) => r.ref === aliceRef).net;

  // ---- 2. A real click on "Add contribution…" ------------------------------------------------------
  await alice.click({ role: "button", name: "Add contribution…", scope: FUND });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add contribution dialog" });
  await alice.fill({ label: "Amount", scope: ".modal" }, "50.00");
  await alice.shot("1-add-contribution-dialog");
  await alice.click({ role: "button", name: "Add contribution", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("Contribution", { scope: FUND });

  // ---- 3. Apply part of it, then return the rest -----------------------------------------------------
  await alice.click({ role: "button", name: "Apply part of You's contribution", scope: FUND });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Apply dialog" });
  await alice.fill({ label: "Amount", scope: ".modal" }, "30.00");
  await alice.click({ role: "button", name: "Apply", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("30.00", { scope: FUND });

  await alice.click({ role: "button", name: "Return part of You's contribution", scope: FUND });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Return dialog" });
  await alice.shot("2-return-dialog");
  await alice.click({ role: "button", name: "Return", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("No contributions or deposits recorded yet.", { scope: FUND }).catch(() => {});

  const fundAfter = await api("alice").ok("group", { query: { ...W.q, action: "contributions" } });
  const c = fundAfter.contributions[0];
  t.check("the fund's own applied/returned history reconciles exactly (30.00 applied, 20.00 returned, nothing still held)", {
    expected: { applied: "30.00", returned: "20.00", held: "0.00" }, actual: { applied: c.applied, returned: c.returned, held: c.held },
  });

  // ---- 4. The ordinary Shared-expenses balance is completely unaffected by any of this ---------------
  const balancesAfter = await api("alice").ok("group", { query: { ...W.q, action: "balances" } });
  const netAfter = balancesAfter.balances[0].rows.find((r) => r.ref === aliceRef).net;
  t.check("Alice's ordinary Shared-expenses balance is completely untouched by the fund's own contribution/apply/return history", { expected: netBefore, actual: netAfter });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
