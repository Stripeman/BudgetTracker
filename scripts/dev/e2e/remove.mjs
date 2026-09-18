// REMOVE AN ACCOUNT (BT-006-05; Terry, 2026-09-14: "i just created the wrong one and now i cant remove
// it"), TWO BROWSERS AT ONCE, fictional data only. Alice creates an account by mistake in her browser,
// removes it there, and it leaves her Accounts page, her quick-entry account choices and her dashboard;
// it is listed under Removed accounts, and Bring back returns it with its history. An account with
// entries gets the stricter dialog (a reason is required; Close instead is offered; Escape removes
// nothing). Bob owns this workspace (Alice already creates a workspace in every other scenario, and a
// person may create 10 a day), so the privacy check is the strict one: even the workspace owner sees
// none of Alice's private accounts and cannot remove them; Alice, a member, cannot remove the shared one.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "remove";
export const title = "Remove an account created by mistake: the empty and has-entries dialogs, gone from lists, pickers and the dashboard, Removed accounts and Bring back, the owner Bob refused on Alice's private account";
export const needsBrowser = true;

const MODAL = ".modal";
const accountRows = (s) => s.evaluate("[...document.querySelectorAll('table[aria-label=\"Accounts\"] tbody th strong')].map((x) => x.textContent)");
// BT-015: a row's actions are inside its own compact "::" menu now, never inline buttons — open the
// named record's menu, read its items by accessible name (or text), then close it again so only one
// is ever open at a time (registerPopup would otherwise close a PREVIOUS one anyway, but this keeps
// each read scoped to exactly the row it asked about).
async function menuItemsFor(s, recordName, { scope = "main" } = {}) {
  await s.openRecordMenu(recordName, { scope });
  const items = await s.evaluate("[...document.querySelectorAll('.actionsmenu__panel:not([hidden]) .actionsmenu__item')].map((b) => b.getAttribute('aria-label') || b.textContent.trim())");
  await s.press("Escape");
  await s.waitFor("!document.querySelector('.actionsmenu__panel:not([hidden])')", { what: `the actions menu for "${recordName}" to close` });
  return items;
}
// The account choices in quick entry: the native select behind the "Account" command picker.
const entryAccounts = (s) => s.evaluate("(() => { const sel = [...document.querySelectorAll('.modal select')].find((x) => [...x.options].some((o) => / \\(EUR\\)$/.test(o.text))); return sel ? [...sel.options].map((o) => o.text) : null; })()");
const modalGone = (s, what) => s.waitFor("!document.querySelector('.modal')", { what });

async function quickEntryAccounts(s) {
  await s.goto("transactions");
  await s.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await s.waitFor("!!document.querySelector('.modal')", { what: "quick entry" });
  const offered = await entryAccounts(s);
  await s.click({ role: "button", name: "Cancel", scope: MODAL });
  await modalGone(s, "quick entry to close");
  return offered;
}

export async function run(h, t) {
  const W = await createWorkspace(h, { owner: "bob", name: "E2E Remove Household", kind: "household", members: { alice: "member" } });
  const q = W.q;
  const api = (u) => h.api(u);
  const everyday = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Everyday", type: "checking", currency: "EUR", openingBalance: "100.00" } }));
  await api("alice").ok("transactions", { method: "POST", query: q, body: { accountId: everyday.id, kind: "expense", amount: "12.30", notes: "E2E groceries" } });
  const joint = firstRecord(await api("bob").ok("accounts", { method: "POST", query: q, body: { name: "E2E Joint", type: "checking", currency: "EUR", visibility: "shared", openingBalance: "40.00" } }));
  t.note(`workspace ${W.name}: ${W.id}`);

  const b = await h.browsers(["alice", "bob"], { prefix: "remove-" });
  for (const s of Object.values(b)) { await s.open("accounts"); await s.useWorkspace(W.name); await s.goto("accounts"); }
  const alice = b.alice;

  // ---- Alice creates an account by mistake, in her browser -------------------------------------------
  await alice.click({ role: "button", name: "Add account", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add account dialog" });
  await alice.fill({ label: "Name", scope: MODAL }, "E2E Wrong wallet");
  await alice.click({ role: "button", name: "Create account", scope: MODAL });
  await modalGone(alice, "the Add account dialog to close");
  await alice.waitForText("E2E Wrong wallet", { scope: "main" });
  const created = (await api("alice").ok("accounts", { query: q })).accounts.find((a) => a.name === "E2E Wrong wallet");
  const offeredBefore = await quickEntryAccounts(alice);
  await alice.goto("accounts");
  const wrongWalletItems = await menuItemsFor(alice, "E2E Wrong wallet");
  const jointItemsForAlice = await menuItemsFor(alice, "E2E Joint");
  t.check("Alice's new account is on her Accounts page with Remove, the server says it has no entries, and quick entry offers it; as a member she has no Remove on the shared Joint", {
    expected: { listed: true, remove: true, hasEntries: false, offered: true, jointRemove: false },
    actual: {
      listed: (await accountRows(alice)).includes("E2E Wrong wallet"), remove: wrongWalletItems.includes("Remove E2E Wrong wallet"), hasEntries: created && created.hasEntries,
      offered: (offeredBefore || []).includes("E2E Wrong wallet (EUR)"), jointRemove: jointItemsForAlice.includes("Remove E2E Joint"),
    },
  });

  // ---- the empty-account dialog ----------------------------------------------------------------------
  await alice.openRecordMenu("E2E Wrong wallet", { scope: "main" });
  await alice.click({ role: "button", name: "Remove E2E Wrong wallet" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Remove dialog" });
  const dialog = await alice.evaluate(`(() => { const m = document.querySelector('.modal'); const i = m.querySelector('input'); return {
    title: m.querySelector('h2').textContent, text: m.querySelector('.modal__body p').textContent, reason: i.value, focused: document.activeElement === i,
    buttons: [...m.querySelectorAll('.modal__foot button')].map((x) => x.textContent), danger: [...m.querySelectorAll('.modal__foot button')].find((x) => x.textContent === 'Remove account').classList.contains('btn--danger') }; })()`);
  const shotDialog = await alice.shot("remove-empty-dialog");
  t.check("the dialog for an account with no entries: title, wording, the reason pre-filled and focused, Cancel and a danger Remove account", {
    expected: { title: "Remove E2E Wrong wallet?", text: "This account has no entries. It will be removed from your lists. You can bring it back from Removed accounts.", reason: "Created by mistake", focused: true, buttons: ["Cancel", "Remove account"], danger: true },
    actual: dialog,
  });
  t.note(`screenshot of the Remove dialog: ${shotDialog}`);
  await alice.click({ role: "button", name: "Remove account", scope: MODAL });
  await modalGone(alice, "the Remove dialog to close");
  await alice.waitFor("![...document.querySelectorAll('table[aria-label=\"Accounts\"] tbody th strong')].some((x) => x.textContent === 'E2E Wrong wallet')", { what: "the account to leave the list" });
  const afterRemove = { rows: await accountRows(alice), focus: await alice.evaluate("document.activeElement ? document.activeElement.textContent : null") };
  const offeredAfter = await quickEntryAccounts(alice);
  await alice.goto("dashboard");
  const dashboard = await alice.text("main");
  const listed = await api("alice").ok("accounts", { query: q });
  t.check("after Remove account it is gone from Alice's Accounts page, her quick-entry choices, her dashboard and her totals (100.00 − 12.30 + 40.00 = 127.70); focus is on Show removed accounts (1)", {
    expected: { listed: false, focus: "Show removed accounts (1)", offered: false, dashboard: false, total: "127.70", removedCount: 1 },
    actual: {
      listed: afterRemove.rows.includes("E2E Wrong wallet"), focus: afterRemove.focus, offered: (offeredAfter || []).includes("E2E Wrong wallet (EUR)"), dashboard: dashboard.includes("E2E Wrong wallet"),
      total: (listed.totals.find((x) => x.currency === "EUR") || {}).amount, removedCount: listed.removedCount,
    },
  });

  // ---- Removed accounts and Bring back ----------------------------------------------------------------
  await alice.goto("accounts");
  await alice.click({ role: "button", name: "Show removed accounts (1)" });
  await alice.waitForText("Bring back", { scope: "main" });
  const removedText = await alice.evaluate("(() => { const s = [...document.querySelectorAll('section')].find((x) => x.querySelector('h2') && x.querySelector('h2').textContent === 'Removed accounts'); return s ? s.innerText : ''; })()");
  const shotRemoved = await alice.shot("removed-accounts");
  await alice.click({ role: "button", name: "Bring back E2E Wrong wallet" });
  await alice.waitFor("[...document.querySelectorAll('table[aria-label=\"Accounts\"] tbody th strong')].some((x) => x.textContent === 'E2E Wrong wallet')", { what: "the account to come back to the list" });
  const offeredBack = await quickEntryAccounts(alice);
  const audit = (await api("alice").ok("audit", { query: q })).entries.filter((e) => e.targetId === created.id).map((e) => e.action);
  t.check("Show removed accounts lists it with the date removed and Bring back; Bring back returns it to the list and quick entry; the audit keeps create, delete and restore", {
    expected: { listed: true, removedOn: true, back: true, audit: ["account.create", "account.delete", "account.restore"] },
    actual: { listed: removedText.includes("E2E Wrong wallet"), removedOn: /Removed \d{4}-\d{2}-\d{2}/.test(removedText), back: (offeredBack || []).includes("E2E Wrong wallet (EUR)"), audit: [...audit].sort() },
  });
  t.note(`screenshot of Removed accounts: ${shotRemoved}`);

  // ---- an account with entries: the stricter dialog ----------------------------------------------------
  await alice.goto("accounts");
  await alice.openRecordMenu("E2E Everyday", { scope: "main" });
  await alice.click({ role: "button", name: "Remove E2E Everyday" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Remove dialog for an account with entries" });
  const strict = await alice.evaluate("(() => { const m = document.querySelector('.modal'); return { text: m.querySelector('.modal__body p').textContent, reason: m.querySelector('input').value, buttons: [...m.querySelectorAll('.modal__foot button')].map((x) => x.textContent) }; })()");
  await alice.click({ role: "button", name: "Remove account", scope: MODAL });
  const refused = await alice.evaluate("(() => { const m = document.querySelector('.modal'); const e = m && m.querySelector('.modal__error'); return { open: !!m, error: e && !e.hidden ? e.textContent : '', invalid: m ? m.querySelector('input').getAttribute('aria-invalid') : null }; })()");
  const shotStrict = await alice.shot("remove-has-entries-dialog");
  await alice.press("Escape");
  await modalGone(alice, "Escape to close the dialog");
  const still = (await api("alice").ok("accounts", { query: q })).accounts.some((a) => a.id === everyday.id);
  t.check("an account with entries: the dialog says so, offers Close instead, refuses an empty reason inside the dialog; Escape closes it and nothing is removed", {
    expected: { entries: true, closeInstead: true, reason: "", open: true, error: "Give a reason for removing this account. It is kept with the account's history.", invalid: "true", still: true },
    actual: { entries: strict.text.startsWith("This account has entries."), closeInstead: strict.buttons.includes("Close instead"), reason: strict.reason, open: refused.open, error: refused.error, invalid: refused.invalid, still },
  });
  t.note(`screenshot of the has-entries dialog: ${shotStrict}`);

  // The dialog says a removed account's entries are kept and can still be found under Transactions.
  await api("alice").ok("accounts", { method: "DELETE", query: q, body: { accountId: everyday.id, reason: "E2E moved to Joint" } });
  await alice.settle();
  await alice.reload();
  await alice.goto("transactions");
  await alice.waitForText("12.30", { scope: "main" });
  const kept = { page: (await alice.text("main")).includes("E2E Everyday"), listed: (await api("alice").ok("accounts", { query: q })).accounts.some((a) => a.id === everyday.id) };
  t.check("after E2E Everyday is removed its 12.30 entry is still on Alice's Transactions page (kept, as the dialog says) while the account is out of her account list", {
    expected: { page: true, listed: false }, actual: kept,
  });

  // ---- Bob owns the workspace, yet cannot see or remove Alice's private accounts -----------------------
  await b.bob.goto("accounts");
  await b.bob.waitForText("E2E Joint", { scope: "main" });
  const bobRows = await accountRows(b.bob);
  const bobJointItems = await menuItemsFor(b.bob, "E2E Joint");
  const bobPrivate = await api("bob").request("accounts", { method: "DELETE", query: q, body: { accountId: created.id, reason: "E2E try" } });
  const aliceShared = await api("alice").request("accounts", { method: "DELETE", query: q, body: { accountId: joint.id, reason: "E2E try" } });
  const bobList = await api("bob").ok("accounts", { query: { ...q, includeDeleted: "1" } });
  t.check("Bob (the owner) sees none of Alice's private accounts and has Remove only on the shared Joint; the API answers 404 to him for her private account and 403 to Alice (a member) for the shared one; none of her removed accounts is counted for him", {
    expected: { rows: ["E2E Joint"], remove: ["Remove E2E Joint"], bobOnPrivate: 404, aliceOnShared: 403, removedCount: 0 },
    actual: { rows: bobRows, remove: bobJointItems.filter((x) => x.startsWith("Remove")), bobOnPrivate: bobPrivate.status, aliceOnShared: aliceShared.status, removedCount: bobList.removedCount },
  });

  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() }); }
}
