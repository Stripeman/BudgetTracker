// BT-013-16 step 5 (Terry, 2026-09-21): the Accounts page under each flagship layout. The real
// accounts table — every real action (Edit, Close/Reopen, Who can see this, Remove, Delete
// permanently) — stays completely shared and unchanged. Alice records a real account, applies each
// flagship layout in turn, confirms it and its real balance still appear, confirms the real actions
// menu still opens, then confirms Classic is unaffected. ONE BROWSER.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "accountsflagship";
export const title = "BT-013-16 step 5: Accounts renders real data differently under each flagship layout, real actions unchanged, in a real browser";
export const needsBrowser = true;

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Accounts Flagship Household", kind: "household" });
  const api = h.api("alice");
  const q = W.q;

  await api.ok("accounts", { method: "POST", query: q, body: { name: "E2E Flagship Savings", type: "savings", currency: "EUR", openingBalance: "750.00" } });

  const b = await h.browsers(["alice"], { prefix: "accountsflagship-", width: 1440, height: 1000 });
  await b.alice.open("accounts");
  await b.alice.useWorkspace(W.name);
  await b.alice.waitForText("E2E Flagship Savings", { scope: "main" });
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
    t.check(`${c.name}: the real account and its real balance appear, unchanged`, { expected: true, actual: text.includes("E2E Flagship Savings") && /EUR 750\.00/.test(text) });
    const shot = await b.alice.shot(`${c.id}`);
    t.note(`screenshot of Accounts under ${c.name}: ${shot}`);
  }

  // ---- the real actions menu still opens under a flagship layout ---------------------------------
  const actionsLabel = await b.alice.evaluate(`(() => { const b = [...document.querySelectorAll('main button[aria-label^="Actions for"]')][0]; return b ? b.getAttribute('aria-label') : null; })()`);
  if (!actionsLabel) throw new Error("could not find the account's actions-menu trigger");
  await b.alice.click({ role: "button", name: actionsLabel });
  await b.alice.waitFor(`document.querySelector('[role="menu"]') && !document.querySelector('[role="menu"]').hidden`, { what: "the real actions menu to open" });

  // ---- back to Classic ------------------------------------------------------------------------
  await applyLayout(api, W.ws.id, "classic");
  await b.alice.reload();
  await b.alice.waitForText("E2E Flagship Savings", { scope: "main" });
  t.check("switching back to Classic removes the flagship wrapper entirely", { expected: false, actual: await b.alice.evaluate(`!!document.querySelector('.dashflag')`) });

  t.check("alice: no console errors/exceptions across every layout", { expected: [], actual: b.alice.problems() });
  await b.alice.close();
}
