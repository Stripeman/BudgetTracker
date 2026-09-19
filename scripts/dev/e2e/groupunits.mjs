// BT-009-25, in a real browser: settlement units (couples/families) — adding a household from real
// checkboxes, the honest "display only" note, the "By household" toggle merging a suggestion into
// one line while still recording against the real underlying person, and removing a household.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "groupunits";
export const title = "BT-009-25: settlement units (couples/families) in Shared expenses, in a real browser";
export const needsBrowser = true;

const UNITS = '[aria-labelledby="grp-units"]';
const SETTLE = '[aria-labelledby="grp-settle"]';

export async function run(h, t) {
  const api = (u) => h.api(u);
  const W = await createWorkspace(h, { name: "E2E Units Trip", kind: "group", members: { bob: "member", carol: "member" } });
  const { alice } = await h.browsers(["alice"], { prefix: "groupunits-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(UNITS))) { t.skip("settlement units in the browser", "the Households card is not present at this commit"); return; }

  const unitsText = await alice.text(UNITS);
  t.check("the Households card states plainly that this never changes who paid what or who owes what", { expected: true, actual: unitsText.includes("never changes who paid what or who owes what") });

  // ---- 1. A EUR 90.00 dinner, Alice pays, split equally three ways ---------------------------------
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E units dinner");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "90.00");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });

  // ---- 2. Add a household (Alice + Bob), from real checkboxes --------------------------------------
  await alice.click({ role: "button", name: "Add household…", scope: UNITS });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add household dialog" });
  await alice.fill({ label: "Name", scope: ".modal" }, "E2E Smiths");
  await alice.click({ role: "checkbox", name: "Alice Fictional (you)", scope: ".modal" });
  await alice.click({ role: "checkbox", name: "Bob Fictional", scope: ".modal" });
  await alice.shot("1-add-household-dialog");
  await alice.click({ role: "button", name: "Add household", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("E2E Smiths", { scope: UNITS });

  // A real API check that the underlying individual balances are completely unaffected by the unit.
  const balancesAfterUnit = (await api("alice").ok("group", { query: { ...W.q, action: "balances" } })).balances[0];
  const netOf = (ref) => balancesAfterUnit.rows.find((r) => r.ref === ref).net;
  const refs = (await api("alice").ok("members", { query: W.q })).members;
  const aliceRef = `member:${refs.find((m) => m.name.startsWith("Alice")).id}`;
  const bobRef = `member:${refs.find((m) => m.name.startsWith("Bob")).id}`;
  const carolRef = `member:${refs.find((m) => m.name.startsWith("Carol")).id}`;
  t.check("creating a household never changes any individual net balance", {
    expected: { alice: "60.00", bob: "-30.00", carol: "-30.00" },
    actual: { alice: netOf(aliceRef), bob: netOf(bobRef), carol: netOf(carolRef) },
  });

  // ---- 3. "By household" merges the suggestion into one line, naming the real receiving person -----
  // Alice (the household's real receiving member, larger individual net) is also the person looking,
  // so this correctly reads "Carol pays you" — exactly as personal as every other suggestion on this
  // page — rather than showing the household's own name, proving the real person underneath the
  // household was resolved and used, never hidden.
  await alice.click({ role: "button", name: "By household", scope: SETTLE });
  await alice.waitForText("Carol", { scope: SETTLE });
  const settleText = await alice.text(SETTLE);
  t.check("the merged suggestion reads as one line, naming the real receiving person ('you', since Alice both is looking and is the household's real receiver), not two separate payments", {
    expected: { count: 1, readsYou: true }, actual: { count: (settleText.match(/Record payment/g) || []).length, readsYou: /Carol Fictional pays you/.test(settleText) },
  });
  await alice.shot("2-by-household-toggle");

  // ---- 4. Recording it uses the REAL person (Alice), never the household itself --------------------
  await alice.click({ role: "button", name: /^Record payment/, scope: SETTLE });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Record a payment dialog" });
  const dialogText = await alice.text(".modal");
  t.check("the payment dialog names a real person to receive it, never the household", { expected: true, actual: /Alice Fictional/.test(dialogText) });
  await alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close" });

  // ---- 5. Remove the household — a plain member and viewer-role permission check are already unit --
  await alice.click({ role: "button", name: "Remove household E2E Smiths", scope: UNITS });
  await alice.waitForText("No households yet.", { scope: UNITS });
  const afterRemove = await api("alice").ok("group", { query: { ...W.q, action: "units" } });
  t.check("removing a household in the browser really removes it, verified directly against the API", { expected: 0, actual: afterRemove.units.length });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
