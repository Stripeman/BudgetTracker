// BT-013-16 step 5 (Terry, 2026-09-21): the Transactions page under each flagship layout, with real
// data. Unlike Dashboard, the filters, the table and every real action (Edit, Reverse, Move, Add as
// bill, Delete, Delete permanently) stay completely shared and unchanged — only a KPI strip (the
// same real per-currency figures) and the surrounding card differ. Alice records a real expense,
// applies each flagship layout in turn, confirms the KPI strip shows the same real figure the plain
// summary already proves correct, confirms filtering and editing still work exactly as before, then
// confirms Classic is unaffected. ONE BROWSER — this is a rendering-correctness and no-regression
// proof, not a multi-user isolation scenario (already covered elsewhere).
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "transactionsflagship";
export const title = "BT-013-16 step 5: Transactions renders real data differently under each flagship layout, filters and editing unchanged, in a real browser";
export const needsBrowser = true;

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Transactions Flagship Household", kind: "household" });
  const api = h.api("alice");
  const q = W.q;

  const checking = firstRecord(await api.ok("accounts", { method: "POST", query: q, body: { name: "E2E Checking", type: "checking", currency: "EUR", openingBalance: "500.00" } }));
  const categories = (await api.ok("categories", { query: q })).categories;
  const groceries = categories.find((c) => c.name === "Groceries");
  const grocer = firstRecord(await api.ok("payees", { method: "POST", query: q, body: { name: "E2E Flagship Grocer" } }));
  await api.ok("transactions", { method: "POST", query: q, body: { accountId: checking.id, kind: "expense", amount: "20.00", categoryId: groceries.id, payeeId: grocer.id, date: new Date().toISOString().slice(0, 10) } });

  const b = await h.browsers(["alice"], { prefix: "transactionsflagship-", width: 1440, height: 1000 });
  await b.alice.open("transactions");
  await b.alice.useWorkspace(W.name);
  await b.alice.waitForText("E2E Flagship Grocer", { scope: "main" });
  t.check("Classic (the default) never shows the flagship KPI strip", { expected: false, actual: await b.alice.evaluate(`!!document.querySelector('.dashflag')`) });

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
    t.check(`${c.name}: the KPI strip shows the same real spent figure`, { expected: true, actual: /EUR 20\.00/.test(text) });
    t.check(`${c.name}: the real merchant row is still shown, unchanged`, { expected: true, actual: text.includes("E2E Flagship Grocer") });
    t.check(`${c.name}: the real filters panel is present`, { expected: true, actual: await b.alice.evaluate(`!!document.querySelector('.filters-box')`) });
    const shot = await b.alice.shot(`${c.id}`);
    t.note(`screenshot of Transactions under ${c.name}: ${shot}`);
  }

  // ---- filtering still works exactly as before, under a flagship layout ---------------------------
  await b.alice.evaluate("(() => { const f = document.querySelector('.filters-box'); if (f) f.open = true; })()");
  await b.alice.fill({ label: "Search" }, "no such merchant at all");
  await b.alice.settle();
  await b.alice.waitForText("No entries match these filters", { scope: "main" });
  await b.alice.click({ role: "button", name: "Clear filters" });
  await b.alice.settle();
  await b.alice.waitForText("E2E Flagship Grocer", { scope: "main" });
  const rowsAfterClear = await b.alice.evaluate(`document.querySelectorAll('main tbody tr').length`);
  t.check("filtering (and clearing it) still works exactly as before under a flagship layout", { expected: true, actual: rowsAfterClear > 0 });

  // ---- editing the real entry still works exactly as before, under a flagship layout --------------
  const actionsLabel = await b.alice.evaluate(`(() => { const b = [...document.querySelectorAll('main button[aria-label^="Actions for"]')][0]; return b ? b.getAttribute('aria-label') : null; })()`);
  if (!actionsLabel) throw new Error("could not find the row's actions-menu trigger");
  await b.alice.click({ role: "button", name: actionsLabel });
  await b.alice.click({ role: "menuitem", name: actionsLabel.replace("Actions for ", "Edit ") });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the real edit dialog, unchanged by layout" });
  await b.alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close" });

  // ---- back to Classic: the flagship wrapper is gone, everything else unaffected ------------------
  await applyLayout(api, W.ws.id, "classic");
  await b.alice.reload();
  await b.alice.waitForText("E2E Flagship Grocer", { scope: "main" });
  t.check("switching back to Classic removes the flagship wrapper entirely", { expected: false, actual: await b.alice.evaluate(`!!document.querySelector('.dashflag')`) });

  t.check("alice: no console errors/exceptions across every layout", { expected: [], actual: b.alice.problems() });
  await b.alice.close();
}
