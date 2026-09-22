// BT-013-16 step 5 (Terry, 2026-09-21): the Planning (Budget/Cash flow) page under each flagship
// layout. Budgets, the forecast, its filters/warnings and What-if stay completely shared and
// unchanged — only the surrounding card wrapper per layout differs. Alice creates a real budget,
// applies each flagship layout in turn, confirms the real budget figures and the cash-flow section
// still appear, confirms the forecast's own "Update forecast" control still works, then confirms
// Classic is unaffected. ONE BROWSER — rendering-correctness and no-regression proof.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "planningflagship";
export const title = "BT-013-16 step 5: Planning (Budget) renders real data differently under each flagship layout, forecast controls unchanged, in a real browser";
export const needsBrowser = true;

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Planning Flagship Household", kind: "household" });
  const api = h.api("alice");
  const q = W.q;

  const categories = (await api.ok("categories", { query: q })).categories;
  const groceries = categories.find((c) => c.name === "Groceries");
  await api.ok("budgets", { method: "POST", query: q, body: { name: "E2E Flagship Budget", period: "monthly", startDate: new Date().toISOString().slice(0, 8) + "01", lines: [{ categoryId: groceries.id, amount: "300.00" }] } });

  const b = await h.browsers(["alice"], { prefix: "planningflagship-", width: 1440, height: 1000 });
  await b.alice.open("planning");
  await b.alice.useWorkspace(W.name);
  await b.alice.waitForText("E2E Flagship Budget", { scope: "main" });
  t.check("Classic (the default) never shows the flagship wrapper", { expected: false, actual: await b.alice.evaluate(`!!document.querySelector('.dashflag')`) });

  const CASES = [
    { id: "ledgerfly-forecast", name: "Executive Forecast" },
    { id: "finexa-budget", name: "Budget Workspace" },
    { id: "acru-overview", name: "Financial Overview" },
  ];
  for (const c of CASES) {
    await applyLayout(api, W.ws.id, c.id);
    await b.alice.reload();
    await b.alice.waitFor("!!document.querySelector('.dashflag')", { what: `the ${c.name} flagship arrangement` });
    const text = await b.alice.text(".dashflag");
    t.check(`${c.name}: the real budget name and planned figure appear`, { expected: true, actual: text.includes("E2E Flagship Budget") && /EUR 300\.00/.test(text) });
    t.check(`${c.name}: the Cash flow and What if sections are still present`, { expected: true, actual: text.includes("Cash flow") && text.includes("What if") });
    const shot = await b.alice.shot(`${c.id}`);
    t.note(`screenshot of Planning under ${c.name}: ${shot}`);
  }

  // ---- the forecast's own real control still works under a flagship layout ------------------------
  await b.alice.choose("Look ahead", "60 days");
  await b.alice.settle();
  const stillOnAcru = await b.alice.evaluate(`!!document.querySelector('.dashflag')`);
  t.check("the forecast horizon control still works under a flagship layout, without breaking it", { expected: true, actual: stillOnAcru });

  // ---- back to Classic ------------------------------------------------------------------------
  await applyLayout(api, W.ws.id, "classic");
  await b.alice.reload();
  await b.alice.waitForText("E2E Flagship Budget", { scope: "main" });
  t.check("switching back to Classic removes the flagship wrapper entirely", { expected: false, actual: await b.alice.evaluate(`!!document.querySelector('.dashflag')`) });

  t.check("alice: no console errors/exceptions across every layout", { expected: [], actual: b.alice.problems() });
  await b.alice.close();
}
