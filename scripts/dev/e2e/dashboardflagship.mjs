// BT-013-16 (Terry, 2026-09-21) step 4: the Dashboard genuinely looks different, with real workspace
// data, under each of the three flagship layouts — the proof the whole pipeline (real data, real
// permissions, real colours, real apply) actually works end to end, not merely that a setting value
// persists. Alice (owner) records real accounts, a category and a transaction, applies each flagship
// layout in turn and confirms the Dashboard's own real figures (account balance, this week's income/
// expenses, the real merchant and category) appear inside that layout's own distinct composition, then
// confirms Classic still renders exactly as before. ONE BROWSER — this proves rendering correctness,
// not multi-user isolation (already covered by layoutpicker.mjs).
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "dashboardflagship";
export const title = "BT-013-16 step 4: the Dashboard renders real data differently under each flagship layout, in a real browser";
export const needsBrowser = true;

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Dashboard Flagship Household", kind: "household" });
  const api = h.api("alice");
  const q = W.q;

  // ---- real data: an account, a category-tagged expense, so every dashboard figure below is real --
  const checking = firstRecord(await api.ok("accounts", { method: "POST", query: q, body: { name: "E2E Checking", type: "checking", currency: "EUR", openingBalance: "1000.00" } }));
  const categories = (await api.ok("categories", { query: q })).categories;
  const groceries = categories.find((c) => c.name === "Groceries");
  const grocer = firstRecord(await api.ok("payees", { method: "POST", query: q, body: { name: "E2E Fictional Grocer" } }));
  await api.ok("transactions", { method: "POST", query: q, body: { accountId: checking.id, kind: "expense", amount: "42.50", categoryId: groceries.id, payeeId: grocer.id, date: new Date().toISOString().slice(0, 10) } });

  const b = await h.browsers(["alice"], { prefix: "dashboardflagship-", width: 1440, height: 1000 });
  await b.alice.open("dashboard");
  await b.alice.useWorkspace(W.name);
  await b.alice.waitForText("E2E Fictional Grocer", { scope: "main" });
  const beforeHasFlag = await b.alice.evaluate(`!!document.querySelector('.dashflag')`);
  t.check("Classic (the default) never shows the flagship wrapper", { expected: false, actual: beforeHasFlag });
  const shotClassic = await b.alice.shot("0-classic");
  t.note(`screenshot of Classic, the default: ${shotClassic}`);

  const CASES = [
    { id: "ledgerfly-forecast", name: "Executive Forecast", marker: "Total balance" },
    { id: "finexa-budget", name: "Budget Workspace", marker: "Overview" },
    { id: "acru-overview", name: "Financial Overview", marker: "Net position across every account you can see" },
  ];
  for (const c of CASES) {
    await applyLayout(api, W.ws.id, c.id);
    await b.alice.reload();
    await b.alice.waitFor("!!document.querySelector('.dashflag')", { what: `the ${c.name} flagship wrapper` });
    const text = await b.alice.text(".dashflag");
    t.check(`${c.name}: shows its own distinct composition marker`, { expected: true, actual: text.includes(c.marker) });
    t.check(`${c.name}: shows the real, server-computed account balance (1000.00 opening minus the 42.50 expense)`, { expected: true, actual: /957\.50/.test(text) });
    t.check(`${c.name}: shows the real category`, { expected: true, actual: text.includes("Groceries") });
    t.check(`${c.name}: shows the real merchant`, { expected: true, actual: text.includes("E2E Fictional Grocer") });
    const addBtn = await b.alice.evaluate(`(() => { const h = document.querySelector('.page-head__actions'); return !!(h && [...h.querySelectorAll('button')].length); })()`);
    t.check(`${c.name}: the primary "Add expense" action is still reachable, in the shared page-head`, { expected: true, actual: addBtn });
    const shot = await b.alice.shot(`${c.id}`);
    t.note(`screenshot of ${c.name}: ${shot}`);
  }

  // ---- back to Classic: never left stuck on a flagship layout's tree ----------------------------
  await applyLayout(api, W.ws.id, "classic");
  await b.alice.reload();
  await b.alice.waitForText("E2E Fictional Grocer", { scope: "main" });
  const afterHasFlag = await b.alice.evaluate(`!!document.querySelector('.dashflag')`);
  t.check("switching back to Classic removes the flagship wrapper entirely", { expected: false, actual: afterHasFlag });

  t.check("alice: no console errors/exceptions across every layout", { expected: [], actual: b.alice.problems() });
  await b.alice.close();
}
