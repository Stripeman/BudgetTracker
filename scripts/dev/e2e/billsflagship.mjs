// BT-013-16 step 5 (Terry, 2026-09-21): the Bills page under each flagship layout. The existing
// Overdue/Due soon/Next 30 days cards already serve the flagship "KPI strip" role as-is; "Needs
// attention" and "All bills" — every real action (Edit, Record next, Pause/Resume, End, History,
// Delete permanently) — stay completely shared and unchanged. Alice records a real bill, applies
// each flagship layout in turn, confirms the real bill and its cards still appear, confirms the
// bill's own actions menu still works, then confirms Classic is unaffected. ONE BROWSER.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "billsflagship";
export const title = "BT-013-16 step 5: Bills renders real data differently under each flagship layout, real actions unchanged, in a real browser";
export const needsBrowser = true;

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Bills Flagship Household", kind: "household" });
  const api = h.api("alice");
  const q = W.q;

  const checking = (await api.ok("accounts", { method: "POST", query: q, body: { name: "E2E Checking", type: "checking", currency: "EUR", openingBalance: "500.00" } })).account;
  await api.ok("recurring", { method: "POST", query: q, body: { name: "E2E Flagship Rent", kind: "expense", billType: "housing", accountId: checking.id, amount: "300.00", amountType: "fixed", schedule: { freq: "monthly", interval: 1, startDate: new Date().toISOString().slice(0, 10) }, reminderDays: 3 } });

  const b = await h.browsers(["alice"], { prefix: "billsflagship-", width: 1440, height: 1000 });
  await b.alice.open("bills");
  await b.alice.useWorkspace(W.name);
  await b.alice.waitForText("E2E Flagship Rent", { scope: "main" });
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
    t.check(`${c.name}: the real bill and its real KPI cards (Overdue/Due soon) appear, unchanged`, { expected: true, actual: text.includes("E2E Flagship Rent") && text.includes("Overdue") && text.includes("Due soon") });
    const shot = await b.alice.shot(`${c.id}`);
    t.note(`screenshot of Bills under ${c.name}: ${shot}`);
  }

  // ---- the real actions menu still works under a flagship layout ---------------------------------
  const actionsLabel = await b.alice.evaluate(`(() => { const b = [...document.querySelectorAll('main button[aria-label^="Actions for"]')][0]; return b ? b.getAttribute('aria-label') : null; })()`);
  if (!actionsLabel) throw new Error("could not find the bill's actions-menu trigger");
  await b.alice.click({ role: "button", name: actionsLabel });
  await b.alice.click({ role: "menuitem", name: actionsLabel.replace("Actions for ", "Edit ") });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the real edit dialog, unchanged by layout" });
  await b.alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close" });

  // ---- back to Classic ------------------------------------------------------------------------
  await applyLayout(api, W.ws.id, "classic");
  await b.alice.reload();
  await b.alice.waitForText("E2E Flagship Rent", { scope: "main" });
  t.check("switching back to Classic removes the flagship wrapper entirely", { expected: false, actual: await b.alice.evaluate(`!!document.querySelector('.dashflag')`) });

  t.check("alice: no console errors/exceptions across every layout", { expected: [], actual: b.alice.problems() });
  await b.alice.close();
}
