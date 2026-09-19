// BT-009-26, in a real browser: insights — event spending/category/participant/settlement summaries
// derived from canonical calculations, shown on the Shared expenses page.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "groupinsights";
export const title = "BT-009-26: insights (spending/category/participant/settlement summaries) in Shared expenses, in a real browser";
export const needsBrowser = true;

const INSIGHTS = '[aria-labelledby="grp-insights"]';

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Insights Trip", kind: "group", members: { bob: "member" } });
  const { alice } = await h.browsers(["alice"], { prefix: "groupinsights-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(INSIGHTS))) { t.skip("insights in the browser", "the Insights card is not present at this commit"); return; }

  const before = await alice.text(INSIGHTS);
  t.check("before any shared expense, insights says so plainly instead of showing an empty table", { expected: true, actual: before.includes("insights will appear once there are some") });

  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E insights dinner");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "90.00");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });

  await alice.waitForText("Total spent", { scope: INSIGHTS });
  const after = await alice.text(INSIGHTS);
  t.check("the real total, category and participant breakdown appear, matching the real expense just added", {
    expected: true,
    actual: after.includes("EUR 90.00") && after.includes("Uncategorized") && after.includes("Bob Fictional"),
  });
  await alice.shot("1-insights-populated");

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
