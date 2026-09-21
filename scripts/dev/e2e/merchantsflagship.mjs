// BT-013-16 step 5 (Terry, 2026-09-21): the Merchants page under each flagship layout. The real
// merchant list — every real action (Edit, History, Close/Reopen, Delete permanently) — stays
// completely shared and unchanged. Alice records a real merchant with a real spend, applies each
// flagship layout in turn, confirms it still appears with its real figures, then confirms Classic is
// unaffected. ONE BROWSER.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "merchantsflagship";
export const title = "BT-013-16 step 5: Merchants renders real data differently under each flagship layout, in a real browser";
export const needsBrowser = true;

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Merchants Flagship Household", kind: "household" });
  const api = h.api("alice");
  const q = W.q;

  const checking = firstRecord(await api.ok("accounts", { method: "POST", query: q, body: { name: "E2E Checking", type: "checking", currency: "EUR", openingBalance: "500.00" } }));
  const grocer = firstRecord(await api.ok("payees", { method: "POST", query: q, body: { name: "E2E Flagship Grocer" } }));
  await api.ok("transactions", { method: "POST", query: q, body: { accountId: checking.id, kind: "expense", amount: "18.75", payeeId: grocer.id, date: new Date().toISOString().slice(0, 10) } });

  const b = await h.browsers(["alice"], { prefix: "merchantsflagship-", width: 1440, height: 1000 });
  await b.alice.open("payees");
  await b.alice.useWorkspace(W.name);
  await b.alice.waitForText("E2E Flagship Grocer", { scope: "main" });
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
    t.check(`${c.name}: the real merchant and its real spend figure appear, unchanged`, { expected: true, actual: text.includes("E2E Flagship Grocer") && /EUR 18\.75/.test(text) });
    const shot = await b.alice.shot(`${c.id}`);
    t.note(`screenshot of Merchants under ${c.name}: ${shot}`);
  }

  // ---- back to Classic ------------------------------------------------------------------------
  await applyLayout(api, W.ws.id, "classic");
  await b.alice.reload();
  await b.alice.waitForText("E2E Flagship Grocer", { scope: "main" });
  t.check("switching back to Classic removes the flagship wrapper entirely", { expected: false, actual: await b.alice.evaluate(`!!document.querySelector('.dashflag')`) });

  t.check("alice: no console errors/exceptions across every layout", { expected: [], actual: b.alice.problems() });
  await b.alice.close();
}
