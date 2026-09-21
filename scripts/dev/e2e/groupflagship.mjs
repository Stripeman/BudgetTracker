// BT-013-16 step 5 (Terry, 2026-09-21): the Shared expenses page under each flagship layout. This
// page is already a stack of individually-carded sections; every one of them, and every real action
// inside them, stays completely shared and unchanged — the same stack is reparented into a
// `.dashflag` accent wrapper rather than restructured (a deliberately narrower scope than the other
// real pages, given this page's size and financial risk — disclosed in PROJECT_STATE.md). Alice
// records a real shared expense through the real dialog, applies each flagship layout in turn,
// confirms the real expense and every real card still appear, then confirms Classic is unaffected.
export const name = "groupflagship";
export const title = "BT-013-16 step 5: Shared expenses renders real data differently under each flagship layout, every real card unchanged, in a real browser";
export const needsBrowser = true;

import { createWorkspace } from "../harness/fixtures.mjs";

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Group Flagship Trip", kind: "group", members: { bob: "member" } });
  const api = h.api("alice");

  const { alice } = await h.browsers(["alice"], { prefix: "groupflagship-", width: 1440, height: 1000 });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.waitForText("Balances", { scope: "main" });

  // ---- a real shared expense, through the real dialog, unchanged by this checkpoint --------------
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E Flagship Dinner");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "60.00");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("E2E Flagship Dinner", { scope: "main" });

  t.check("Classic (the default) never shows the flagship wrapper", { expected: false, actual: await alice.evaluate(`!!document.querySelector('.dashflag')`) });

  const CASES = [
    { id: "ledgerfly-forecast", name: "Executive Forecast" },
    { id: "finexa-budget", name: "Budget Workspace" },
    { id: "acru-overview", name: "Financial Overview" },
  ];
  for (const c of CASES) {
    await applyLayout(api, W.ws.id, c.id);
    await alice.reload();
    await alice.waitFor("!!document.querySelector('.dashflag')", { what: `the ${c.name} flagship arrangement` });
    const text = await alice.text(".dashflag");
    t.check(`${c.name}: every real card is still present, and the real expense still appears`, {
      expected: true, actual: text.includes("Balances") && text.includes("Settle up") && text.includes("Expenses") && text.includes("Payments") && text.includes("E2E Flagship Dinner"),
    });
    const shot = await alice.shot(`${c.id}`);
    t.note(`screenshot of Shared expenses under ${c.name}: ${shot}`);
  }

  // ---- back to Classic ------------------------------------------------------------------------
  await applyLayout(api, W.ws.id, "classic");
  await alice.reload();
  await alice.waitForText("E2E Flagship Dinner", { scope: "main" });
  t.check("switching back to Classic removes the flagship wrapper entirely", { expected: false, actual: await alice.evaluate(`!!document.querySelector('.dashflag')`) });

  t.check("alice: no console errors/exceptions across every layout", { expected: [], actual: alice.problems() });
  await alice.close();
}
