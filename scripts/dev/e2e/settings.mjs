// WORKSPACE SETTINGS (Terry, 2026-09-14: "the user should be able to decide", then "build all 10"),
// THREE BROWSERS AT ONCE, fictional data only. Alice (owner) changes settings in her own browser on the
// Workspace page's "Workspace settings" card; Bob (member) and Carol (viewer) see the effect in theirs,
// and the API refuses what the server must refuse.
//   (f) Carol, while still a member, added EUR 23.45 on the shared E2E Joint; Alice then made her a
//       viewer. Bob cannot change it until Alice chooses "Any entry"; then he corrects it to 25.00 in his
//       browser, with a reason, and the correction is kept with his name.
//   (a) Alice turns Shared expenses off: the nav item, the dashboard summary and the page go for Bob and
//       /api/group refuses him; the dinner recorded before is still there when it is turned on again.
//   (h) Alice sets member restores to 0: Bob's restore is refused (preview and execute).
import { createWorkspace, DISPLAY, firstRecord } from "../harness/fixtures.mjs";

export const name = "settings";
export const title = "Workspace settings across users: members changing others' entries, Shared expenses off (nav, dashboard, page, API), member restores 0, read-only for a viewer, history in words";
export const needsBrowser = true;

const CARD = 'section[aria-labelledby="ws-settings"]';
const HISTORY = 'section[aria-labelledby="ws-history"]';
const navLinks = (s) => s.evaluate("[...document.querySelectorAll('.app__nav a')].map((a) => a.textContent)");
// A full reload only once the page is quiet (a request still running when the page reloads is cancelled).
const fresh = async (s, route) => { await s.settle(); await s.reload(); await s.goto(route); };
const rowButtons = (s, amountText) => s.evaluate(`(() => { const r = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes(${JSON.stringify(amountText)})); return r ? [...r.querySelectorAll('button')].map((x) => x.textContent.trim()) : null; })()`);

// Types the optional reason, presses Save workspace settings and waits for the card to say it saved.
async function saveSettings(s, reason) {
  if (reason) await s.fill({ label: "Reason for the change (optional)", scope: CARD }, reason);
  await s.click({ role: "button", name: "Save workspace settings", scope: CARD });
  await s.waitFor(`(() => { const c = document.querySelector('${CARD}'); return !!c && c.innerText.includes('Saved. Everyone in the workspace now works this way.'); })()`, { what: "the Saved note in the Workspace settings card" });
  await s.settle();
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Settings Household", kind: "household", members: { bob: "member", carol: "member" } });
  const q = W.q;
  const api = (u) => h.api(u);
  const joint = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Joint", type: "checking", currency: "EUR", visibility: "shared", openingBalance: "500.00" } }));
  const carolEntry = firstRecord(await api("carol").ok("transactions", { method: "POST", query: q, body: { accountId: joint.id, kind: "expense", amount: "23.45", notes: "E2E Carol's groceries" } }));
  await api("alice").ok("members", { method: "PATCH", query: q, body: { memberId: W.memberOf("carol").id, role: "viewer" } });
  const [A, B] = [W.ref("alice"), W.ref("bob")];
  const dinner = (await api("alice").ok("group", { method: "POST", query: q, body: { description: "E2E settings dinner", amount: "40.00", payers: [{ ref: A }], split: { method: "equal", lines: [{ ref: A }, { ref: B }] } } })).expense;
  const bobWallet = firstRecord(await api("bob").ok("accounts", { method: "POST", query: q, body: { name: "E2E Bob Wallet", type: "cash", currency: "EUR", openingBalance: "50.00" } }));
  const archiveId = (await api("alice").ok("backups", { method: "POST", query: q, body: {} })).archive.archiveId;
  await api("bob").ok("transactions", { method: "POST", query: q, body: { accountId: bobWallet.id, kind: "expense", amount: "3.00", notes: "E2E after the backup" } });
  t.note(`workspace ${W.name}: ${W.id}`);

  const b = await h.browsers(["alice", "bob", "carol"], { prefix: "settings-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }
  await b.alice.goto("workspace");
  if (!(await b.alice.exists(CARD))) { t.skip("settings in the browser", "the Workspace settings card is not present at this commit"); return; }

  // ---- the defaults: today's behaviour --------------------------------------------------------------
  await b.bob.waitForText("Your balance in Shared expenses", { scope: "main" });
  const before = { nav: (await navLinks(b.bob)).includes("Shared expenses"), dashboard: (await b.bob.text("main")).includes("Your balance in Shared expenses") };
  await b.bob.goto("transactions");
  before.buttons = await rowButtons(b.bob, "23.45");
  before.direct = (await api("bob").request("transactions", { method: "PATCH", query: q, body: { transactionId: carolEntry.id, revision: carolEntry.revision, amount: "24.00", reason: "E2E try" } })).status;
  before.preview = (await api("bob").request("restore", { method: "POST", query: { action: "preview" }, body: { workspaceId: W.id, archiveId, mode: "merge" } })).status;
  t.check("defaults: Bob sees Shared expenses in the nav of this household and its balance on his dashboard; he cannot change Carol's entry (no buttons, API 403); his restore preview works", {
    expected: { nav: true, dashboard: true, buttons: [], direct: 403, preview: 200 }, actual: before,
  });

  // ---- (f) Alice lets members change any entry on shared accounts; Bob corrects Carol's entry --------
  await b.alice.choose("Which entries a member may correct on shared accounts", "Any entry", { scope: CARD });
  await saveSettings(b.alice, "E2E we share the bookkeeping");
  await fresh(b.bob, "transactions");
  const offered = await rowButtons(b.bob, "23.45");
  const editAt = await b.bob.evaluate(`(() => { const r = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes('23.45'));
    const e = r && [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Edit'); if (!e) return null;
    e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
  if (!editAt) throw new Error(`bob: Carol's entry offers no Edit after the setting; offered ${JSON.stringify(offered)}`);
  await b.bob.mouseClick(editAt.x, editAt.y);
  await b.bob.waitFor("!!document.querySelector('.modal')", { what: "Bob's edit form" });
  await b.bob.fill({ css: 'input[placeholder="0.00 or 12.50+3.20"]', scope: ".modal" }, "25.00");
  await b.bob.fill({ label: "Reason for this change", scope: ".modal" }, "E2E the receipt said 25.00");
  await b.bob.click({ role: "button", name: "Save changes", scope: ".modal" });
  await b.bob.waitFor("!document.querySelector('.modal')", { what: "the edit form to close after saving" });
  const corrected = (await api("alice").ok("transactions", { query: q })).transactions.find((x) => x.id === carolEntry.id);
  const history = JSON.stringify(await api("alice").ok("transactions", { query: { ...q, action: "history", transactionId: carolEntry.id } }));
  await fresh(b.carol, "transactions");
  const carolButtons = (await rowButtons(b.carol, "25.00")) || [];
  t.check("(f) with 'Any entry' Bob is offered Edit on Carol's entry and corrects it to 25.00 in his browser; the correction keeps his name and reason; Carol (viewer) may read its History but change nothing", {
    expected: { edit: true, amount: "-25.00", byBob: true, reason: true, carolChanges: [], carolHistory: true },
    actual: {
      edit: (offered || []).includes("Edit"), amount: corrected.amount, byBob: history.includes(DISPLAY.bob), reason: history.includes("E2E the receipt said 25.00"),
      carolChanges: carolButtons.filter((x) => ["Edit", "Delete", "Reverse"].includes(x)), carolHistory: carolButtons.includes("History"),
    },
  });

  // ---- (a) Alice turns Shared expenses off: gone for Bob, and the API refuses him -----------------------
  await b.alice.goto("workspace");
  await b.alice.choose("Use Shared expenses in this workspace", "Off", { scope: CARD });
  await saveSettings(b.alice);
  const aliceNav = (await navLinks(b.alice)).includes("Shared expenses");
  await fresh(b.bob, "dashboard");
  const off = { nav: (await navLinks(b.bob)).includes("Shared expenses"), dashboard: (await b.bob.text("main")).includes("Your balance") };
  await b.bob.goto("group");
  off.page = (await b.bob.text("main")).includes("Shared expenses are turned off in this workspace");
  const refused = await api("bob").request("group", { query: q });
  off.api = [refused.status, refused.code];
  const shotOff = await b.bob.shot("shared-expenses-off");
  await api("alice").ok("workspaces", { method: "PATCH", query: { id: W.id }, body: { settings: { sharedExpenses: true } } });
  const back = await api("bob").ok("group", { query: q });
  t.check("(a) after Alice turns Shared expenses off, her nav drops it at once; for Bob the nav item, the dashboard summary and the page go and /api/group refuses him; turned on again, the dinner is back", {
    expected: { aliceNav: false, nav: false, dashboard: false, page: true, api: [403, "shared_expenses_off"], dinner: true },
    actual: { aliceNav, ...off, dinner: back.expenses.some((e) => e.id === dinner.id && e.description === "E2E settings dinner") },
  });
  t.note(`screenshot of Bob's Shared expenses page while it is off: ${shotOff}`);

  // ---- (h) Alice sets member restores to 0: Bob's restore is refused ------------------------------------
  await b.alice.goto("workspace");
  await b.alice.settle();
  await b.alice.choose("How often a member may restore their own records", "0", { scope: CARD });
  await saveSettings(b.alice);
  const pv = await api("bob").request("restore", { method: "POST", query: { action: "preview" }, body: { workspaceId: W.id, archiveId, mode: "merge" } });
  const ex = await api("bob").request("restore", { method: "POST", query: { action: "execute" }, body: { workspaceId: W.id, archiveId, mode: "replace", confirm: "REPLACE", expectedEtag: "e2e" } });
  t.check("(h) with member restores at 0 (set in Alice's browser) Bob's merge preview and replace are refused", {
    expected: { preview: [403, "member_restores_off"], execute: [403, "member_restores_off"] },
    actual: { preview: [pv.status, pv.code], execute: [ex.status, ex.code] },
  });

  // ---- Carol (viewer) sees the settings but cannot change them; Alice's history names them in words ---
  await fresh(b.carol, "workspace");
  await b.carol.waitForText("Which entries a member may correct on shared accounts", { scope: CARD });
  const carolCard = await b.carol.evaluate(`(() => { const c = document.querySelector('${CARD}'); return { pickers: c.querySelectorAll('select').length, save: [...c.querySelectorAll('button')].some((x) => x.textContent === 'Save workspace settings'), text: c.innerText }; })()`);
  await fresh(b.alice, "workspace");
  await b.alice.waitForText("Any entry", { scope: HISTORY });
  const historyText = await b.alice.text(HISTORY);
  t.check("Carol (viewer) sees each setting in words with who changes it, and no controls; Alice's Workspace changes list the changes in words with her reason", {
    expected: { pickers: 0, save: false, any: true, zero: true, who: true, history: true, reason: true },
    actual: {
      pickers: carolCard.pickers, save: carolCard.save, any: /Which entries a member may correct on shared accounts\s*Any entry/.test(carolCard.text),
      zero: /How often a member may restore their own records\s*0/.test(carolCard.text), who: carolCard.text.includes("Only owners change this."),
      history: historyText.includes("Which entries a member may correct on shared accounts Only entries they added → Any entry"),
      reason: historyText.includes("E2E we share the bookkeeping"),
    },
  });
  t.note(`screenshot of Alice's Workspace settings card: ${await b.alice.shot("workspace-settings")}`);

  // ---- every browser stayed clean -----------------------------------------------------------------
  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() }); }
}
