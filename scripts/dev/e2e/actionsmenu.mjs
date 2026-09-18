// BT-015 — COMPACT RECORD ACTIONS MENU (Terry, 2026-09-18: "Reduce clutter, particularly on mobile,
// by moving record actions into a menu right-aligned on the same row as the record's title/name...
// Opening it must NEVER shift surrounding content or resize the form... Overlay the page correctly
// without clipping... Support keyboard navigation, Escape, outside-click dismissal and touch...
// Separate destructive actions visually and identify them clearly... Use the same pattern on desktop
// and mobile."). Verifies the shared app/js/ui/actionsmenu.js component, built on the exact BT-004-08
// overlay engine, across all four screens it replaced separate row buttons on: Accounts, Bills,
// Merchants, Transactions.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "actionsmenu";
export const title = "BT-015 compact record actions menu: no-reflow, exact preserved action order, keyboard/touch, destructive separation, on Accounts/Bills/Merchants/Transactions, desktop and mobile";
export const needsBrowser = true;

async function rowGeometry(s, rowText) {
  // Scoped to a row that actually carries the compact actions menu — some pages (Bills) show the
  // same record's name a second time in a separate "Needs attention" summary table that never uses
  // this component at all (different, unrelated buttons), which a plain text match would find first.
  return s.evaluate(`(() => {
    const row = [...document.querySelectorAll("tr")].find((tr) => tr.textContent.includes(${JSON.stringify(rowText)}) && tr.querySelector(".actionsmenu__toggle"));
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height), bottom: Math.round(r.bottom) };
  })()`);
}

async function openRowMenu(s, rowText) {
  const at = await s.evaluate(`(() => {
    const row = [...document.querySelectorAll("tr")].find((tr) => tr.textContent.includes(${JSON.stringify(rowText)}) && tr.querySelector(".actionsmenu__toggle"));
    const toggle = row && row.querySelector(".actionsmenu__toggle");
    if (!toggle) return null;
    const r = toggle.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!at) throw new Error(`${s.name}: no actions-menu toggle found for row "${rowText}"`);
  await s.mouseClick(at.x, at.y);
  await s.waitFor("!!document.querySelector('.actionsmenu__panel:not([hidden])')", { what: `the actions menu for "${rowText}" to open` });
}

// The VISIBLE text of each item, excluding its own sr-only description where one exists (Bills'
// "Record next", wrapped by infoTip() — the wrapper's textContent legitimately includes both the
// visible label and the off-screen description; this reads only what a sighted person sees).
const menuItemTexts = (s) => s.evaluate(`[...document.querySelectorAll('.actionsmenu__panel:not([hidden]) .actionsmenu__item')].map((b) => {
  const clone = b.cloneNode(true);
  clone.querySelectorAll('.sr-only').forEach((n) => n.remove());
  return clone.textContent.trim();
})`);

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Actions Menu Household", kind: "household" });
  const q = W.q;
  const alice = h.api("alice");
  const account = firstRecord(await alice.ok("accounts", { method: "POST", query: q, body: { name: "E2E Menu Checking", type: "checking", currency: "USD", openingBalance: "500.00" } }));
  const bill = firstRecord(await alice.ok("recurring", { method: "POST", query: q, body: { name: "E2E Menu Rent", billType: "housing", accountId: account.id, amount: "900.00", schedule: { freq: "monthly", startDate: new Date().toISOString().slice(0, 10) } } }));
  const merchant = firstRecord(await alice.ok("payees", { method: "POST", query: q, body: { name: "E2E Menu Grocer" } }));
  const entry = firstRecord(await alice.ok("transactions", { method: "POST", query: q, body: { accountId: account.id, kind: "expense", amount: "12.50", payeeId: merchant.id } }));
  t.note(`workspace ${W.name}: ${W.id}; account ${account.id}; bill ${bill.id}; merchant ${merchant.id}; entry ${entry.id}`);

  const { alice: s } = await h.browsers(["alice"], { prefix: "actionsmenu-" });
  await s.open("dashboard");
  await s.useWorkspace(W.name);

  // ---- Accounts: exact order, no-reflow, destructive separation ----------------------------------
  await s.goto("accounts");
  await s.waitForText(account.name, { scope: "main" });
  const beforeAccounts = await rowGeometry(s, account.name);
  await openRowMenu(s, account.name);
  const afterAccounts = await rowGeometry(s, account.name);
  t.check("Accounts: opening the row's actions menu never moves the row itself", { expected: beforeAccounts, actual: afterAccounts });
  const accountItems = await menuItemTexts(s);
  t.check("Accounts: exact preserved action order (Edit, Close, Who can see this, Remove, Delete permanently)", {
    expected: ["Edit", "Close", "Who can see this", "Remove", "Delete permanently"], actual: accountItems,
  });
  const accountDangerClass = await s.evaluate("(() => { const items = [...document.querySelectorAll('.actionsmenu__panel:not([hidden]) .actionsmenu__item')]; const dp = items.find((b) => b.textContent.trim() === 'Delete permanently'); return { danger: dp.classList.contains('actionsmenu__item--danger'), separated: dp.classList.contains('actionsmenu__item--separated') }; })()");
  t.check("Accounts: 'Delete permanently' is visually separated and marked destructive, not colour alone (text already says what it does)", { expected: { danger: true, separated: true }, actual: accountDangerClass });
  const shotAccounts = await s.shot("actionsmenu-accounts-open");
  t.check("Accounts: no console errors/exceptions", { expected: [], actual: s.problems() });
  await s.press("Escape");
  await s.waitFor("!document.querySelector('.actionsmenu__panel:not([hidden])')", { what: "the Accounts menu to close" });
  t.note(`screenshot: ${shotAccounts}`);

  // ---- Bills: exact order including Record next's own tooltip ------------------------------------
  await s.goto("bills");
  await s.waitForText(bill.name, { scope: "main" });
  const beforeBills = await rowGeometry(s, bill.name);
  await openRowMenu(s, bill.name);
  const afterBills = await rowGeometry(s, bill.name);
  t.check("Bills: opening the row's actions menu never moves the row itself", { expected: beforeBills, actual: afterBills });
  const billItems = await menuItemTexts(s);
  t.check("Bills: exact preserved action order (Edit, Record next, Pause, End, History, Delete permanently)", {
    expected: ["Edit", "Record next", "Pause", "End", "History", "Delete permanently"], actual: billItems,
  });
  const shotBills = await s.shot("actionsmenu-bills-open");
  await s.press("Escape");
  await s.waitFor("!document.querySelector('.actionsmenu__panel:not([hidden])')", { what: "the Bills menu to close" });
  t.note(`screenshot: ${shotBills}`);

  // ---- Merchants: exact order, "History" (renamed), Close ------------------------------------------
  await s.goto("payees");
  await s.waitForText(merchant.name, { scope: "main" });
  const beforeMerchants = await rowGeometry(s, merchant.name);
  await openRowMenu(s, merchant.name);
  const afterMerchants = await rowGeometry(s, merchant.name);
  t.check("Merchants: opening the row's actions menu never moves the row itself", { expected: beforeMerchants, actual: afterMerchants });
  const merchantItems = await menuItemTexts(s);
  t.check("Merchants: exact preserved action order (Edit, History, Close, Delete permanently)", {
    expected: ["Edit", "History", "Close", "Delete permanently"], actual: merchantItems,
  });
  const shotMerchants = await s.shot("actionsmenu-merchants-open");
  await s.press("Escape");
  await s.waitFor("!document.querySelector('.actionsmenu__panel:not([hidden])')", { what: "the Merchants menu to close" });
  t.note(`screenshot: ${shotMerchants}`);

  // ---- Transactions: exact order, "Move" (renamed) --------------------------------------------------
  await s.goto("transactions");
  await s.waitForText("E2E Menu Grocer", { scope: "main" });
  const beforeTxn = await rowGeometry(s, "E2E Menu Grocer");
  await openRowMenu(s, "E2E Menu Grocer");
  const afterTxn = await rowGeometry(s, "E2E Menu Grocer");
  t.check("Transactions: opening the row's actions menu never moves the row itself", { expected: beforeTxn, actual: afterTxn });
  const txnItems = await menuItemTexts(s);
  // A brand-new fictional entry has no amendment history yet, so "History" legitimately does not
  // appear (matches the pre-existing `t.amendmentCount ?` condition) — check the STABLE part of the
  // order (Edit first, Move present and renamed, Delete permanently last) rather than an exact list.
  t.check("Transactions: exact preserved action order — Edit first, 'Move' present (renamed from 'Move to another account'), 'Delete permanently' last", {
    expected: { first: "Edit", hasMove: true, last: "Delete permanently" },
    actual: { first: txnItems[0], hasMove: txnItems.includes("Move"), last: txnItems[txnItems.length - 1] },
  });

  // ---- keyboard navigation: ArrowDown moves focus among real menuitem buttons ----------------------
  const kbd = await s.evaluate("(() => { const panel = document.querySelector('.actionsmenu__panel:not([hidden])'); const items = [...panel.querySelectorAll('[role=\"menuitem\"]')]; return { role: panel.getAttribute('role'), itemCount: items.length, firstRole: items[0] && items[0].getAttribute('role') }; })()");
  t.check("Transactions: the open panel is a real role=menu with real role=menuitem children", { expected: { role: "menu", firstRole: "menuitem" }, actual: { role: kbd.role, firstRole: kbd.firstRole } });
  await s.press("ArrowDown");
  const focusedAfterArrow = await s.evaluate("document.activeElement && document.activeElement.getAttribute('role')");
  t.check("Transactions: ArrowDown moves focus to a real, focusable menu item", { expected: "menuitem", actual: focusedAfterArrow });
  await s.press("Escape");
  await s.waitFor("!document.querySelector('.actionsmenu__panel:not([hidden])')", { what: "the Transactions menu to close via Escape" });
  const focusedAfterEscape = await s.evaluate("document.activeElement && document.activeElement.classList.contains('actionsmenu__toggle')");
  t.check("Escape closes the menu and returns focus to its own trigger", { expected: true, actual: focusedAfterEscape });

  // ---- outside-click dismissal ----------------------------------------------------------------------
  await openRowMenu(s, "E2E Menu Grocer");
  const heading = await s.locate({ css: "h1", scope: "main" });
  await s.mouseClick(heading.x, heading.y);
  await s.settle();
  const closedByOutsideClick = await s.evaluate("!document.querySelector('.actionsmenu__panel:not([hidden])')");
  t.check("a click outside the open menu (on the page heading) dismisses it", { expected: true, actual: closedByOutsideClick });

  // ---- mobile: same pattern, no-reflow, comfortable touch target -----------------------------------
  const { alice: phone } = await h.browsers(["alice"], { prefix: "actionsmenu-phone-", width: 390, height: 844 });
  await phone.open("dashboard");
  await phone.useWorkspace(W.name);
  await phone.goto("accounts");
  await phone.waitForText(account.name, { scope: "main" });
  const beforePhone = await rowGeometry(phone, account.name);
  const toggleBox = await phone.evaluate(`(() => {
    const row = [...document.querySelectorAll("tr")].find((tr) => tr.textContent.includes(${JSON.stringify(account.name)}));
    const toggle = row && [...row.querySelectorAll("button")].find((b) => b.classList.contains("actionsmenu__toggle"));
    if (!toggle) return null;
    const r = toggle.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  t.check("the trigger is a comfortable touch target on mobile (at least 40x40 CSS px)", { expected: true, actual: !!toggleBox && toggleBox.width >= 40 && toggleBox.height >= 40 });
  await openRowMenu(phone, account.name);
  const afterPhone = await rowGeometry(phone, account.name);
  t.check("mobile: opening the menu never moves the row (same pattern as desktop)", { expected: beforePhone, actual: afterPhone });
  const phonePanelInViewport = await phone.evaluate("(() => { const p = document.querySelector('.actionsmenu__panel:not([hidden])'); const r = p.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()");
  t.check("mobile: the open panel stays fully inside the viewport, never clipped", { expected: true, actual: phonePanelInViewport });
  const shotPhone = await phone.shot("actionsmenu-mobile-accounts");
  t.note(`screenshot: ${shotPhone}`);
  t.check("phone: no console errors/exceptions", { expected: [], actual: phone.problems() });

  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: s.problems() });
}
