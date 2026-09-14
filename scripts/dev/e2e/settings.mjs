// WORKSPACE SETTINGS (Terry, 2026-09-14: "the user should be able to decide", then "build all 10"),
// THREE BROWSERS AT ONCE, fictional data only. Alice (owner) changes settings in her own browser on the
// Workspace page's "Workspace settings" card; Bob (member) and Carol (viewer) see the effect in theirs,
// and the API refuses what the server must refuse.
//   (f) Carol, while still a member, added EUR 23.45 on the shared E2E Joint; Alice then made her a
//       viewer. Bob cannot change it until Alice chooses "Any entry"; then he corrects it to 25.00 in his
//       browser, with a reason, and the correction is kept with his name.
//   (a) Alice turns Shared expenses off: the nav item, the dashboard summary and the page go for Bob and
//       /api/group refuses him; the dinner recorded before is still there when it is turned on again.
//   (h) Alice sets member restores to "Not allowed": Bob's restore is refused (preview and execute).
// Since the UX/accessibility review of eefd115 (fix/workspace-settings-ux): errors in the error style with
// the setting marked invalid, "More about this", collapsible groups, Undo and "You have unsaved changes",
// the leave question, the number field, read-only lists and history for everyone, smaller group headings,
// the restores note, a way back from the "off" page, hints in the forms, and the group card read-only for
// members. Since the security review of eefd115: Bob is offered no change on a transfer bill or entry into
// Alice's private account (M-1, L-3). Since the financial recheck of 53cf181: a new budget starting in a
// finished period is refused under "Not allowed" and needs confirming otherwise (FIN-1).
import { createWorkspace, DISPLAY, firstRecord } from "../harness/fixtures.mjs";

export const name = "settings";
export const title = "Workspace settings across users: (f), (a), (h), read-only and history for everyone; the review's card (errors, undo, leave question, groups, number field, way back, hints); M-1, L-3 and FIN-1 in the browser";
export const needsBrowser = true;

const CARD = 'section[aria-labelledby="ws-settings"]';
const GCARD = 'section[aria-labelledby="grp-settings"]';
const HISTORY = 'section[aria-labelledby="ws-history"]';
const SAVED = "Settings saved. Everyone in the workspace now works this way.";
const navLinks = (s) => s.evaluate("[...document.querySelectorAll('.app__nav a')].map((a) => a.textContent)");
// A full reload only once the page is quiet (a request still running when the page reloads is cancelled).
const fresh = async (s, route) => { await s.settle(); await s.reload(); await s.goto(route); };
const rowButtons = (s, amountText) => s.evaluate(`(() => { const r = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes(${JSON.stringify(amountText)})); return r ? [...r.querySelectorAll('button')].map((x) => x.textContent.trim()) : null; })()`);
// The smallest element of the page that shows `text` and holds buttons: a bill's row on the Bills page.
const itemButtons = (s, text) => s.evaluate(`(() => { const els = [...document.querySelectorAll("main li, main tr, main article, main div")].filter((e) => e.innerText && e.innerText.includes(${JSON.stringify(text)}) && e.querySelector("button")); els.sort((a, b) => a.innerText.length - b.innerText.length); const e = els[0]; return e ? [...e.querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") || b.textContent).trim()) : null; })()`);
const iso = (d) => d.toISOString().slice(0, 10);

// Opens a collapsed settings group (its heading is a toggle button named by the group).
async function openGroup(s, scope, group) {
  const state = await s.evaluate(`(() => { const b = [...document.querySelectorAll('${scope} button.settings-group__toggle')].find((x) => x.textContent === ${JSON.stringify(group)}); return b ? b.getAttribute('aria-expanded') : null; })()`);
  if (state === null) throw new Error(`${s.name}: there is no settings group ${group}`);
  if (state === "false") await s.click({ role: "button", name: group, scope });
}

// Types the optional reason, presses Save settings and waits for the card to say it saved.
async function saveSettings(s, reason) {
  if (reason) await s.fill({ label: "Reason for the change (optional)", scope: CARD }, reason);
  await s.click({ role: "button", name: "Save settings", scope: CARD });
  await s.waitFor(`(() => { const c = document.querySelector('${CARD}'); return !!c && c.innerText.includes(${JSON.stringify(SAVED)}); })()`, { what: "the saved line in the Workspace settings card" });
  await s.settle();
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Settings Household", kind: "household", members: { bob: "member", carol: "member" } });
  const q = W.q;
  const api = (u) => h.api(u);
  const joint = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Joint", type: "checking", currency: "EUR", visibility: "shared", openingBalance: "500.00" } }));
  const savings = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Alice Savings", type: "savings", currency: "EUR", openingBalance: "100.00" } }));
  const carolEntry = firstRecord(await api("carol").ok("transactions", { method: "POST", query: q, body: { accountId: joint.id, kind: "expense", amount: "23.45", notes: "E2E Carol's groceries" } }));
  await api("alice").ok("members", { method: "PATCH", query: q, body: { memberId: W.memberOf("carol").id, role: "viewer" } });
  const [A, B] = [W.ref("alice"), W.ref("bob")];
  const dinner = (await api("alice").ok("group", { method: "POST", query: q, body: { description: "E2E settings dinner", amount: "40.00", payers: [{ ref: A }], split: { method: "equal", lines: [{ ref: A }, { ref: B }] } } })).expense;
  // Money into Alice's private account: a transfer entry and a monthly transfer bill (M-1, L-3).
  await api("alice").ok("transactions", { method: "POST", query: q, body: { accountId: joint.id, kind: "transfer", amount: "61.00", notes: "E2E to Alice's savings", transfer: { toAccountId: savings.id } } });
  const nextMonth = iso(new Date(Date.now() + 20 * 86400000));
  await api("alice").ok("recurring", { method: "POST", query: q, body: { name: "E2E savings transfer", kind: "transfer", accountId: joint.id, toAccountId: savings.id, amount: "200.00", schedule: { freq: "monthly", interval: 1, startDate: nextMonth } } });
  const bobWallet = firstRecord(await api("bob").ok("accounts", { method: "POST", query: q, body: { name: "E2E Bob Wallet", type: "cash", currency: "EUR", openingBalance: "50.00" } }));
  const archiveId = (await api("alice").ok("backups", { method: "POST", query: q, body: {} })).archive.archiveId;
  await api("bob").ok("transactions", { method: "POST", query: q, body: { accountId: bobWallet.id, kind: "expense", amount: "3.00", notes: "E2E after the backup" } });
  t.note(`workspace ${W.name}: ${W.id}`);

  const b = await h.browsers(["alice", "bob", "carol"], { prefix: "settings-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }
  await b.alice.goto("workspace");
  if (!(await b.alice.exists(CARD))) { t.skip("settings in the browser", "the Workspace settings card is not present at this commit"); return; }
  await b.alice.waitForText("Save settings", { scope: CARD });

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

  // ---- the card itself (UX review of eefd115) ---------------------------------------------------------
  const look = await b.alice.evaluate(`(() => {
    const c = document.querySelector('${CARD}');
    const size = (e) => e ? parseFloat(getComputedStyle(e).fontSize) : null;
    const toggles = [...c.querySelectorAll('button.settings-group__toggle')];
    return {
      height: Math.round(c.getBoundingClientRect().height),
      widest: Math.max(...[...c.querySelectorAll('.cmdpick__trigger, input[type=number]')].filter((x) => x.getBoundingClientRect().width > 0).map((x) => Math.round(x.getBoundingClientRect().width))),
      cardTitle: size(c.querySelector('h2.card__title')), groupTitle: size(c.querySelector('h3.settings-group__title')),
      groups: toggles.map((x) => [x.textContent, x.getAttribute('aria-expanded')]),
    };
  })()`);
  t.check("finding 2 and 7: groups collapse (the first open), controls at form width, the card shorter than the review's 1,893 px, group headings not larger than the card's title", {
    expected: { first: "true", othersClosed: true, formWidth: true, shorter: true, headingNotLarger: true },
    actual: { first: look.groups[0] && look.groups[0][1], othersClosed: look.groups.slice(1).every((g) => g[1] === "false"), formWidth: look.widest > 0 && look.widest <= 560, shorter: look.height < 1893, headingNotLarger: look.groupTitle <= look.cardTitle },
  });
  t.note(`card at 1280 px: ${look.height} px high, widest control ${look.widest} px, card title ${look.cardTitle} px, group title ${look.groupTitle} px; groups ${JSON.stringify(look.groups)}`);
  // "More about this" on the Shared expenses setting (the first group, open).
  const moreSel = `${CARD} button.linklike[aria-label="More about this: Use Shared expenses in this workspace"]`;
  const moreBefore = await b.alice.evaluate(`(() => { const m = document.querySelector('${moreSel}'); return m ? [m.getAttribute('aria-expanded'), document.getElementById(m.getAttribute('aria-controls')).hidden] : null; })()`);
  await b.alice.click({ css: moreSel });
  const moreAfter = await b.alice.evaluate(`(() => { const m = document.querySelector('${CARD} button.linklike[aria-controls]'); const x = document.querySelector('${CARD} [aria-label^="Less about this: Use Shared expenses"]'); return x ? [x.getAttribute('aria-expanded'), document.getElementById(x.getAttribute('aria-controls')).hidden] : null; })()`);
  t.check("finding 2: “More about this” shows the rest of the explanation (aria-expanded false → true)", { expected: { before: ["false", true], after: ["true", false] }, actual: { before: moreBefore, after: moreAfter } });

  // Finding 1: "Merge that also brings back deleted entries" follows "Merge"; then a refused number.
  await openGroup(b.alice, CARD, "Restores by members");
  const kinds = () => b.alice.evaluate(`(() => { const box = (t) => { const l = [...document.querySelectorAll('${CARD} label')].find((x) => x.textContent === t); return l ? document.getElementById(l.getAttribute('for')) : null; }; const d = box('Merge that also brings back deleted entries'); return { checked: d.checked, disabled: d.disabled }; })()`);
  const kindsStart = await kinds();
  await b.alice.click({ role: "checkbox", name: "Merge — add missing records", scope: CARD });
  const kindsOff = await kinds();
  await b.alice.click({ role: "checkbox", name: "Merge — add missing records", scope: CARD });
  const kindsBack = await kinds();
  const restoresNote = (await b.alice.text(CARD)).includes("Members can't restore from the app yet; this applies to restores through the API.");
  t.check("finding 1 and 8: with Merge off, “Merge that also brings back deleted entries” is unticked and unavailable; the restores group says members can't restore from the app yet", {
    expected: { start: { checked: true, disabled: false }, off: { checked: false, disabled: true }, back: { checked: false, disabled: false }, note: true },
    actual: { start: kindsStart, off: kindsOff, back: kindsBack, note: restoresNote },
  });
  await b.alice.click({ role: "button", name: "Undo changes", scope: CARD });
  await openGroup(b.alice, CARD, "Bills");
  const days = "Days before the due date a new bill shows as Due soon";
  const numberField = await b.alice.evaluate(`(() => { const l = [...document.querySelectorAll('${CARD} label')].find((x) => x.textContent === ${JSON.stringify(days)}); const i = l && document.getElementById(l.getAttribute('for')); return i ? { type: i.type, min: i.min, max: i.max, unit: (i.parentNode.querySelector('.input-with-unit__unit') || {}).textContent } : null; })()`);
  await b.alice.fill({ label: days, scope: CARD }, "61");
  await b.alice.click({ role: "button", name: "Save settings", scope: CARD });
  await b.alice.settle();
  const refusal = await b.alice.evaluate(`(() => { const c = document.querySelector('${CARD}'); const e = c.querySelector('.error-text'); const l = [...c.querySelectorAll('label')].find((x) => x.textContent === ${JSON.stringify(days)}); const i = document.getElementById(l.getAttribute('for'));
    return { visible: !!e && !e.hidden, role: e && e.getAttribute('role'), text: e && e.textContent, color: e && getComputedStyle(e).color, statusText: c.querySelector('[role=status]').textContent, invalid: i.getAttribute('aria-invalid'), pointsAt: (i.getAttribute('aria-describedby') || '').split(' ').includes(e.id), focused: document.activeElement === i }; })()`);
  const helpColor = await b.alice.evaluate(`getComputedStyle(document.querySelector('${CARD} .field__help')).color`);
  const errorShot = await b.alice.shot("settings-error");
  t.check("finding 1 and 5: the due-soon days are a number field (0–60, “days”); 61 is refused in the error style, the field is marked invalid, points at the message and has focus", {
    expected: { field: { type: "number", min: "0", max: "60", unit: "days" }, visible: true, role: "alert", text: "“Days before the due date a new bill shows as Due soon”: enter a whole number from 0 to 60.", notHelpColour: true, statusText: "", invalid: "true", pointsAt: true, focused: true },
    actual: { field: numberField, visible: refusal.visible, role: refusal.role, text: refusal.text, notHelpColour: refusal.color !== helpColor, statusText: refusal.statusText, invalid: refusal.invalid, pointsAt: refusal.pointsAt, focused: refusal.focused },
  });
  t.note(`screenshot of the refused value: ${errorShot}`);

  // Finding 3: an edit shows the unsaved line; leaving the page asks first; Cancel keeps it; Undo puts it back.
  await b.alice.click({ role: "button", name: "Undo changes", scope: CARD });
  await openGroup(b.alice, CARD, "Budgets");
  await b.alice.choose("Weeks start on", "Sunday", { scope: CARD });
  const unsaved = await b.alice.evaluate(`!document.querySelector('${CARD} .settings-bar__unsaved').hidden`);
  await b.alice.click({ role: "link", name: "Dashboard" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the leave question" });
  const question = await b.alice.text(".modal");
  await b.alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the leave question to close" });
  // The value the picker shows (its trigger is named by the label, so its name is not the value).
  const weekStartShown = () => b.alice.evaluate(`(() => { const l = [...document.querySelectorAll('${CARD} label')].find((x) => x.textContent === 'Weeks start on'); const t = l && document.getElementById(l.getAttribute('for')); const v = t && t.querySelector('.cmdpick__value'); return v ? v.textContent : null; })()`);
  const stayed = { hash: await b.alice.evaluate("location.hash"), value: await weekStartShown() };
  await b.alice.click({ role: "button", name: "Undo changes", scope: CARD });
  const undone = { unsaved: await b.alice.evaluate(`!document.querySelector('${CARD} .settings-bar__unsaved').hidden`), value: await weekStartShown() };
  t.check("finding 3: an edit shows “You have unsaved changes”; leaving the page asks “Leave without saving?”; Cancel stays with the edit; Undo changes puts it back", {
    expected: { unsaved: true, asked: true, names: true, hash: "#/workspace", keptSunday: true, undone: false, backToMonday: true },
    actual: { unsaved, asked: question.includes("Leave without saving?"), names: question.includes("You have unsaved changes in Workspace settings."), hash: stayed.hash, keptSunday: /Sunday/.test(stayed.value), undone: undone.unsaved, backToMonday: /Monday/.test(undone.value) },
  });

  // ---- (f) Alice lets members change any entry on shared accounts; Bob corrects Carol's entry --------
  await openGroup(b.alice, CARD, "Entries and shared lists");
  await b.alice.choose("Which entries a member may correct on shared accounts", "Any entry", { scope: CARD });
  await saveSettings(b.alice, "E2E we share the bookkeeping");
  await fresh(b.bob, "transactions");
  const offered = await rowButtons(b.bob, "23.45");
  const transferLeg = await rowButtons(b.bob, "61.00");
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
  // M-1 and L-3 (security review of eefd115): nothing into Alice's private account is Bob's to change.
  await b.bob.goto("bills");
  await b.bob.waitForText("E2E savings transfer", { scope: "main" });
  const billButtons = (await itemButtons(b.bob, "E2E savings transfer")) || [];
  t.check("M-1 and L-3: under 'Any entry' Bob is offered no Edit, Pause or End on Alice's transfer bill into her private account, and no Edit or Delete on the Joint side of her transfer into it", {
    expected: { bill: [], leg: [] },
    actual: { bill: billButtons.filter((x) => /^(Edit|Pause|End|Skip)/.test(x)), leg: (transferLeg || []).filter((x) => ["Edit", "Delete"].includes(x)) },
  });

  // ---- (a) Alice turns Shared expenses off: gone for Bob, and the API refuses him -----------------------
  await b.alice.goto("workspace");
  await b.alice.waitForText("Save settings", { scope: CARD });
  await b.alice.choose("Use Shared expenses in this workspace", "Off", { scope: CARD });
  await saveSettings(b.alice);
  const aliceNav = (await navLinks(b.alice)).includes("Shared expenses");
  await fresh(b.bob, "dashboard");
  const off = { nav: (await navLinks(b.bob)).includes("Shared expenses"), dashboard: (await b.bob.text("main")).includes("Your balance") };
  await b.bob.goto("group");
  const bobOff = await b.bob.text("main");
  off.page = bobOff.includes("Shared expenses are turned off in this workspace");
  off.ask = bobOff.includes("Ask an owner or manager to turn it on.");
  const refused = await api("bob").request("group", { query: q });
  off.api = [refused.status, refused.code];
  const shotOff = await b.bob.shot("shared-expenses-off");
  // Finding 9: Alice's way back from the off page.
  await b.alice.goto("group");
  await b.alice.click({ role: "link", name: "Open Workspace settings" });
  await b.alice.waitFor(`(() => { const a = document.activeElement; const l = a && a.id ? document.querySelector('label[for="' + a.id + '"]') : null; return !!l && l.textContent === 'Use Shared expenses in this workspace'; })()`, { what: "focus on the Shared expenses setting" });
  const wayBack = { hash: await b.alice.evaluate("location.hash") };
  await api("alice").ok("workspaces", { method: "PATCH", query: { id: W.id }, body: { settings: { sharedExpenses: true } } });
  const back = await api("bob").ok("group", { query: q });
  t.check("(a) after Alice turns Shared expenses off, her nav drops it at once; for Bob the nav item, the dashboard summary and the page go, the page tells him whom to ask, and /api/group refuses him; turned on again, the dinner is back", {
    expected: { aliceNav: false, nav: false, dashboard: false, page: true, ask: true, api: [403, "shared_expenses_off"], dinner: true },
    actual: { aliceNav, ...off, dinner: back.expenses.some((e) => e.id === dinner.id && e.description === "E2E settings dinner") },
  });
  t.check("finding 9: on the off page Alice follows “Open Workspace settings” to the Workspace page with focus on “Use Shared expenses in this workspace”", { expected: { hash: "#/workspace?setting=sharedExpenses" }, actual: wayBack });
  t.note(`screenshot of Bob's Shared expenses page while it is off: ${shotOff}`);

  // ---- (h) Alice sets member restores to "Not allowed": Bob's restore is refused ----------------------
  await b.alice.settle(); await b.alice.reload(); await b.alice.goto("workspace");
  await b.alice.waitForText("Save settings", { scope: CARD });
  await openGroup(b.alice, CARD, "Restores by members");
  await b.alice.choose("How often a member may restore their own records", "Not allowed", { scope: CARD });
  await saveSettings(b.alice);
  const pv = await api("bob").request("restore", { method: "POST", query: { action: "preview" }, body: { workspaceId: W.id, archiveId, mode: "merge" } });
  const ex = await api("bob").request("restore", { method: "POST", query: { action: "execute" }, body: { workspaceId: W.id, archiveId, mode: "replace", confirm: "REPLACE", expectedEtag: "e2e" } });
  t.check("(h) with member restores “Not allowed” (set in Alice's browser) Bob's merge preview and replace are refused", {
    expected: { preview: [403, "member_restores_off"], execute: [403, "member_restores_off"] },
    actual: { preview: [pv.status, pv.code], execute: [ex.status, ex.code] },
  });

  // ---- read-only for Carol (viewer) and Bob (member): a label–value list and the history --------------
  await fresh(b.carol, "workspace");
  // textContent, not innerText: the setting sits in a group that starts collapsed.
  await b.carol.waitFor(`(() => { const c = document.querySelector('${CARD}'); return !!c && c.textContent.includes('Which entries a member may correct on shared accounts'); })()`, { what: "Carol's read-only settings" });
  const carolCard = await b.carol.evaluate(`(() => { const c = document.querySelector('${CARD}'); return { pickers: c.querySelectorAll('select').length, inputs: c.querySelectorAll('input').length, save: [...c.querySelectorAll('button')].some((x) => x.textContent === 'Save settings'), dl: c.querySelectorAll('dl dt').length === c.querySelectorAll('dl dd.settings-dl__value').length && c.querySelectorAll('dl dt').length > 0, text: c.textContent }; })()`);
  const carolShot = await b.carol.shot("settings-read-only");
  await fresh(b.alice, "workspace");
  await b.alice.waitForText("Any entry", { scope: HISTORY });
  const historyText = await b.alice.text(HISTORY);
  t.check("finding 6: Carol (viewer) reads each setting as a label–value pair, owner-only ones marked, who changes them said once, and the settings history with who and why; Alice's Workspace changes list them in words", {
    expected: { pickers: 0, inputs: 0, save: false, dl: true, any: true, notAllowed: true, ownersOnly: true, saidOnce: 1, history: true, reason: true, workspaceChanges: true },
    actual: {
      pickers: carolCard.pickers, inputs: carolCard.inputs, save: carolCard.save, dl: carolCard.dl,
      any: /Which entries a member may correct on shared accounts\s*Any entry/.test(carolCard.text), notAllowed: /How often a member may restore their own records\s*Owners only\s*Not allowed/.test(carolCard.text),
      ownersOnly: carolCard.text.includes("Owners only"), saidOnce: carolCard.text.split("Owners and managers change them").length - 1,
      history: carolCard.text.includes("Which entries a member may correct on shared accounts: Only entries they added → Any entry"), reason: carolCard.text.includes("Reason: E2E we share the bookkeeping"),
      workspaceChanges: historyText.includes("Which entries a member may correct on shared accounts Only entries they added → Any entry"),
    },
  });
  t.note(`screenshot of Carol's read-only card: ${carolShot}`);
  await fresh(b.bob, "group");
  await b.bob.waitFor(`!!document.querySelector('${GCARD}:not([hidden])')`, { what: "the group settings card for Bob" });
  const bobGroup = await b.bob.evaluate(`(() => { const c = document.querySelector('${GCARD}'); return { pickers: c.querySelectorAll('select').length, save: [...c.querySelectorAll('button')].some((x) => x.textContent === 'Save settings'), text: c.textContent }; })()`);
  t.check("finding 11: Bob (member) sees the Shared expenses settings card read-only like the workspace card, with who changes them said once", {
    expected: { pickers: 0, save: false, saidOnce: true },
    actual: { pickers: bobGroup.pickers, save: bobGroup.save, saidOnce: bobGroup.text.includes("Owners and managers change them; you can see how it is set up and every change below.") },
  });

  // ---- finding 10: the forms say where a default came from ------------------------------------------
  await b.alice.goto("planning");
  await b.alice.click({ role: "button", name: "Add budget", scope: ".page-head, main" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "Add budget" });
  const budgetHint = (await b.alice.text(".modal")).includes("Monthly is this workspace's usual period (Workspace settings).");
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "Add budget to close" });
  await b.alice.goto("bills");
  await b.alice.click({ role: "button", name: "Add bill" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "Add bill" });
  const billHint = (await b.alice.text(".modal")).includes("New bills start with this workspace's 3 days (Workspace settings).");
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "Add bill to close" });
  t.check("finding 10: Add budget and Add bill say which default came from Workspace settings", { expected: { budget: true, bill: true }, actual: { budget: budgetHint, bill: billHint } });

  // ---- FIN-1 (financial recheck of 53cf181): a new budget that starts in a finished period ------------
  const sixtyDaysAgo = iso(new Date(Date.now() - 60 * 86400000));
  const addBudget = async (startDate) => {
    await b.alice.goto("planning");
    await b.alice.click({ role: "button", name: "Add budget", scope: ".page-head, main" });
    await b.alice.waitFor("!!document.querySelector('.modal')", { what: "Add budget" });
    await b.alice.fill({ label: "Name", scope: ".modal" }, `E2E started ${startDate}`);
    await b.alice.fill({ label: "Planned amount", scope: ".modal" }, "100.00");
    await b.alice.evaluate(`(() => { const l = [...document.querySelectorAll('.modal label')].find((x) => x.textContent === 'Starts on'); const i = document.getElementById(l.getAttribute('for')); i.value = ${JSON.stringify(startDate)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await b.alice.click({ role: "button", name: "Add budget", scope: ".modal" });
    // Wait for the answer itself: the dialog closes, or it shows the server's message. (The network can look
    // quiet for a moment right after the click, before the request is under way.)
    await b.alice.waitFor("(() => { const m = document.querySelector('.modal'); const e = m && m.querySelector('.modal__error'); return !m || (!!e && !e.hidden && e.textContent.length > 0); })()", { what: "the answer to Add budget" });
    await b.alice.settle();
  };
  const confirmBox = () => b.alice.evaluate("(() => { const l = [...document.querySelectorAll('.modal label')].find((x) => x.textContent === 'Also count the periods that have finished'); return l ? !l.hidden : null; })()");
  await addBudget(sixtyDaysAgo);
  const asked = { text: await b.alice.text(".modal"), box: await confirmBox() };
  t.note(`FIN-1: Add budget from ${sixtyDaysAgo} answered: ${JSON.stringify(asked.text.replace(/\s+/g, " ").slice(-400))}; confirmation box shown: ${asked.box}`);
  if (asked.box) {
    await b.alice.click({ role: "checkbox", name: "Also count the periods that have finished", scope: ".modal" });
    await b.alice.click({ role: "button", name: "Add budget", scope: ".modal" });
    await b.alice.waitFor("!document.querySelector('.modal')", { what: "Add budget to close after confirming" });
  } else if (await b.alice.exists(".modal")) {
    await b.alice.press("Escape");
  }
  const createdConfirmed = (await api("alice").ok("budgets", { query: q })).budgets.some((x) => x.name === `E2E started ${sixtyDaysAgo}`);
  await api("alice").ok("workspaces", { method: "PATCH", query: { id: W.id }, body: { settings: { budgetBackdating: "never" } } });
  await fresh(b.alice, "planning");
  await addBudget(iso(new Date(Date.now() - 45 * 86400000)));
  const never = { text: await b.alice.text(".modal"), box: await confirmBox() };
  await b.alice.press("Escape");
  t.check("FIN-1: under “Allowed after a confirmation” Alice's budget starting 60 days ago asks for the confirmation and is added once she ticks it; under “Not allowed” one starting 45 days ago is refused with the reason and no confirmation is offered", {
    expected: { askedWhy: true, box: true, created: true, neverWhy: true, neverBox: false },
    actual: { askedWhy: asked.text.includes("count periods that have finished"), box: asked.box, created: createdConfirmed, neverWhy: never.text.includes("This workspace does not let a new budget cover periods that have finished."), neverBox: never.box },
  });

  // ---- evidence at 390 px and in dark mode ------------------------------------------------------------
  const { alice: narrow } = await h.browsers(["alice"], { prefix: "settings-390-", width: 390, height: 844 });
  await narrow.open("dashboard"); await narrow.useWorkspace(W.name); await narrow.goto("workspace");
  await narrow.waitForText("Save settings", { scope: CARD });
  const overflow = await narrow.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth");
  t.check("390 px: the Workspace page has no horizontal overflow with the settings card", { expected: false, actual: overflow });
  await narrow.evaluate(`document.querySelector('${CARD}').scrollIntoView({ block: 'start' })`);
  t.note(`screenshot at 390 px: ${await narrow.shot("card-390")}`);
  await b.alice.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await b.alice.goto("workspace");
  await b.alice.waitForText("Save settings", { scope: CARD });
  await b.alice.evaluate(`document.querySelector('${CARD}').scrollIntoView({ block: 'start' })`);
  t.note(`screenshot of Alice's card in dark mode: ${await b.alice.shot("workspace-settings-dark")}`);

  // ---- every browser stayed clean (FIN-1's refusals are expected 409s) ----------------------------------
  for (const s of [...Object.values(b), narrow]) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems({ allowHttp: [{ status: 409, path: /\/api\/budgets/ }] }) }); }
}
