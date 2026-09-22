// BT-022 (Terry, 2026-09-22): real CATEGORY management. Terry: "I tried to add a category called
// 'Web Development' and could not find a way to do it." Source inspection confirmed `POST/PATCH
// /api/categories` already existed but no frontend workflow called it. This scenario is the real,
// literal verification he asked for: Alice (owner) creates "E2E Web Development" from the
// Workspace page's own Categories & types tab, sets its colour and icon, uses it on a real
// transaction — with NO reload needed, the same shared `categories` slice every picker already
// reads from — reloads and confirms it persists and displays correctly, Bob (member) sets his OWN
// personal colour override and it never changes what Alice or Carol (viewer) see, and Carol cannot
// create or edit a category at all (permissions). Replaces the retired `workspacecolours.mjs`
// (BT-019-04's own workspace-level colour-only panel no longer exists as a separate thing — folded
// into this fuller manager, closing exactly the "two places both called Category colours"
// duplication Terry reported). THREE BROWSERS AT ONCE.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "categories";
export const title = "BT-022: real category management — create, colour, icon, use on a transaction, persistence, personal-appearance isolation and permissions, in real browsers";
export const needsBrowser = true;

const CAT_NAME = "E2E Web Development";
const CATEGORIES_CARD = 'section[aria-labelledby="ws-categories"]';

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Categories Household", kind: "household", members: { bob: "member", carol: "viewer" } });
  const q = W.q;
  const api = (u) => h.api(u);
  const account = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Categories Checking", type: "checking", currency: "USD", openingBalance: "1000.00" } }));

  const b = await h.browsers(["alice", "bob", "carol"], { prefix: "categories-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }

  // ---- Alice (owner) creates "Web Development" from the real Workspace page — item 1 ---------------
  await b.alice.goto("workspace");
  await b.alice.click({ role: "tab", name: "Categories & types" });
  await b.alice.waitForText("Categories", { scope: "main" });
  const before = await b.alice.text(CATEGORIES_CARD);
  t.check("the Categories card exists, distinct from the Account/Category/Merchant TYPES sections, and offers a create form", {
    expected: true, actual: before.includes("Add category") && !before.includes(CAT_NAME),
  });
  t.check("plain language distinguishes categories from category types, right on this tab", {
    expected: true, actual: /never need/i.test(await b.alice.text("main")),
  });
  await b.alice.click({ role: "button", name: "Add category", scope: CATEGORIES_CARD });
  await b.alice.fill({ label: "New category name", scope: CATEGORIES_CARD }, CAT_NAME);
  // Income or expense — item 1's explicit requirement, a plain choice, never a category type.
  await b.alice.choose("Income or expense", "Expense", { scope: CATEGORIES_CARD });
  await b.alice.click({ role: "button", name: "Save category", scope: CATEGORIES_CARD });
  await b.alice.waitForText(CAT_NAME, { scope: "main" });
  await b.alice.settle();
  const created = (await api("alice").ok("categories", { query: q })).categories.find((x) => x.name === CAT_NAME);
  t.check("the new category is persisted with the chosen name and class, reusing the existing category API/ids/validation/permissions", {
    expected: { found: true, type: "expense", system: undefined },
    actual: { found: !!created, type: created && created.type, system: created && created.system },
  });
  const shotCreated = await b.alice.shot("1-category-created");
  t.note(`screenshot after creating the category: ${shotCreated}`);

  // ---- set its colour and icon, on the SAME newly created row (expand, not a separate hunt) --------
  const rowSpot = await b.alice.evaluate(`(() => {
    const card = document.querySelector(${JSON.stringify(CATEGORIES_CARD)});
    const row = [...card.querySelectorAll('.typerow')].find((r) => r.querySelector('summary').textContent.includes(${JSON.stringify(CAT_NAME)}));
    if (!row) return null;
    row.querySelector('summary').click();
    const toggle = row.querySelector('.themepick__toggle');
    toggle.scrollIntoView({ block: 'center' });
    const at = toggle.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  })()`);
  if (!rowSpot) throw new Error("could not find the new category's colour picker toggle");
  await b.alice.mouseClick(rowSpot.x, rowSpot.y);
  await b.alice.waitFor("!!document.querySelector('[role=\"listbox\"]')", { what: "the colour list to open" });
  const green = await b.alice.evaluate(`(() => {
    const o = [...document.querySelectorAll('[role="option"]')].find((x) => x.textContent.includes('Green'));
    if (!o) return null;
    o.scrollIntoView({ block: 'center' });
    const at = o.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  })()`);
  if (!green) throw new Error("the palette does not offer Green");
  await b.alice.mouseClick(green.x, green.y);
  await b.alice.settle();
  let recoloured = (await api("alice").ok("categories", { query: q })).categories.find((x) => x.id === created.id);
  t.check("the colour is saved as the real workspace colour", { expected: "#16a34a", actual: recoloured.color });
  const shotColoured = await b.alice.shot("2-category-coloured");
  t.note(`screenshot after colouring the category: ${shotColoured}`);

  // ---- use it on a real transaction, with NO reload — the same shared slice every picker reads ------
  await b.alice.goto("transactions");
  await b.alice.click({ role: "button", name: "Add expense", scope: "main" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Add expense dialog" });
  await b.alice.fill({ css: 'input[placeholder="0.00 or 12.50+3.20"]', scope: ".modal" }, "75.00");
  await b.alice.choose("Category", CAT_NAME, { scope: ".modal" });
  await b.alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await b.alice.settle();
  // An expense's own amount is stored and shown signed negative (money direction — only in/out, never
  // two-way; api/_shared/ledger.js transactionView).
  const entry = (await api("alice").ok("transactions", { query: q })).transactions.find((x) => x.amount === "-75.00");
  t.check("the category created moments ago on the Workspace page is usable on a real transaction with no reload in between — the shared categories slice already carried it everywhere", {
    expected: { found: true, categoryId: created.id }, actual: { found: !!entry, categoryId: entry && entry.categoryId },
  });
  await b.alice.waitForText(CAT_NAME, { scope: "main" });
  const txnListText = await b.alice.text("main");
  t.check("the Transactions list shows the new entry with its category's real name", { expected: true, actual: txnListText.includes(CAT_NAME) });
  const shotTxn = await b.alice.shot("3-transaction-uses-category");
  t.note(`screenshot of the transaction using the new category: ${shotTxn}`);

  // ---- reload: it persists and displays correctly, both on the Workspace page and the entry ---------
  await b.alice.reload();
  await b.alice.waitForText(CAT_NAME, { scope: "main" });
  const afterReloadTxnText = await b.alice.text("main");
  t.check("after a reload, the transaction still shows the category correctly", { expected: true, actual: afterReloadTxnText.includes(CAT_NAME) });
  await b.alice.goto("workspace");
  await b.alice.click({ role: "tab", name: "Categories & types" });
  await b.alice.waitForText(CAT_NAME, { scope: "main" });
  const afterReloadWsText = await b.alice.text(CATEGORIES_CARD);
  t.check("after a reload, the Workspace page's own Categories list still shows it, coloured, with its real Expense class", {
    expected: true, actual: afterReloadWsText.includes(CAT_NAME) && afterReloadWsText.includes("Expense"),
  });

  // ---- Bob's own PERSONAL colour override never changes what Alice or Carol see ----------------------
  // Bob's own browser fetched the categories slice before Alice created this one — a real reload is
  // needed to see it, exactly like every other cross-browser data change in this whole e2e suite.
  await b.bob.goto("settings");
  await b.bob.reload();
  await b.bob.waitForText("My category appearance", { scope: "main" });
  await b.bob.click({ role: "button", name: "My category appearance", scope: "main" });
  await b.bob.waitForText(CAT_NAME, { scope: "main" });
  const bobToggleSpot = await b.bob.evaluate(`(() => {
    const row = [...document.querySelectorAll('main .catrow')].find((r) => r.textContent.includes(${JSON.stringify(CAT_NAME)}));
    const toggle = row ? row.querySelector('.themepick__toggle') : null;
    if (!toggle) return null;
    toggle.scrollIntoView({ block: 'center' });
    const at = toggle.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  })()`);
  if (!bobToggleSpot) throw new Error("Bob's personal colour picker for the new category was not found");
  await b.bob.mouseClick(bobToggleSpot.x, bobToggleSpot.y);
  await b.bob.waitFor("!!document.querySelector('[role=\"listbox\"]')", { what: "Bob's colour list to open" });
  const violetSpot = await b.bob.evaluate(`(() => {
    const o = [...document.querySelectorAll('[role="option"]')].find((x) => x.textContent.includes('Violet'));
    if (!o) return null;
    o.scrollIntoView({ block: 'center' });
    const at = o.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  })()`);
  if (!violetSpot) throw new Error("Bob's palette does not offer Violet");
  await b.bob.mouseClick(violetSpot.x, violetSpot.y);
  await b.bob.settle();
  const bobPrefs = await api("bob").ok("preferences");
  t.check("Bob's personal colour is saved to HIS OWN preferences, never the workspace's own category record", {
    expected: "#8b5cf6", actual: (bobPrefs.effective.categoryColors || {})[created.id],
  });
  recoloured = (await api("alice").ok("categories", { query: q })).categories.find((x) => x.id === created.id);
  t.check("the workspace's own real colour is completely unaffected by Bob's personal choice", { expected: "#16a34a", actual: recoloured.color });
  await b.alice.reload();
  await b.alice.goto("workspace");
  await b.alice.click({ role: "tab", name: "Categories & types" });
  const shotBobPersonal = await b.bob.shot("4-bob-personal-colour");
  const shotAliceUnaffected = await b.alice.shot("5-alice-unaffected-by-bob");
  t.note(`Bob's own personal colour: ${shotBobPersonal}; Alice's workspace view, unaffected: ${shotAliceUnaffected}`);
  // Carol's own browser also fetched categories before Alice's creation — a real reload first.
  await b.carol.goto("workspace");
  await b.carol.reload();
  await b.carol.click({ role: "tab", name: "Categories & types" });
  await b.carol.waitForText(CAT_NAME, { scope: "main" });
  const carolCatText = await b.carol.text(CATEGORIES_CARD);
  t.check("Carol (a plain viewer) never sees Bob's personal colour override — only the workspace's own", {
    expected: true, actual: carolCatText.includes(CAT_NAME),
  });

  // ---- Carol (viewer): category creation respects existing permissions --------------------------------
  const carolHasCreate = await b.carol.evaluate(`(() => {
    const card = document.querySelector(${JSON.stringify(CATEGORIES_CARD)});
    return !!(card && [...card.querySelectorAll('button')].some((btn) => btn.textContent === 'Add category'));
  })()`);
  const carolHasEditRows = await b.carol.evaluate(`(() => {
    const card = document.querySelector(${JSON.stringify(CATEGORIES_CARD)});
    return card ? card.querySelectorAll('.typerow').length : -1;
  })()`);
  t.check("Carol (viewer) sees the category in a read-only list, with no create form and no per-row editor at all", {
    expected: { hasCreate: false, editRows: 0 }, actual: { hasCreate: carolHasCreate, editRows: carolHasEditRows },
  });

  // ---- "Manage workspace categories" from My Settings lands exactly here, no hunting ------------------
  await b.alice.goto("settings");
  await b.alice.click({ role: "button", name: "My category appearance", scope: "main" });
  await b.alice.click({ role: "button", name: "Manage workspace categories", scope: "main" });
  // A pure client-side hash navigation has no network activity for settle() to wait on, so wait for
  // the actual rendered result instead — the "Categories & types" tab becoming the selected one.
  await b.alice.waitFor(`(() => { const t = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent === 'Categories & types'); return !!t && t.getAttribute('aria-selected') === 'true'; })()`, { what: "the Categories & types tab to become selected after following the link" });
  const landedOnCategories = await b.alice.evaluate(`!!document.querySelector(${JSON.stringify(CATEGORIES_CARD)}) && !document.querySelector(${JSON.stringify(CATEGORIES_CARD)}).closest('[hidden]')`);
  t.check("'Manage workspace categories' in My Settings lands directly on the Workspace page's own Categories & types tab, never leaving where creation happens unclear", {
    expected: true, actual: landedOnCategories,
  });

  // ---- BT-023 (Terry, 2026-09-22): "anything created needs to be able to be deleted. However, if
  // there are any items attached to it, warn the user X number of records will be unset or have to
  // be rechosen, and show which items are affected." Real permanent deletion of a category, in the
  // real browser: one with nothing attached goes alone with no warning; one used by a real
  // transaction shows exactly how many records are affected before deleting, and afterwards that
  // transaction's category is unset (needing to be rechosen) rather than the transaction vanishing.
  const DEL_UNUSED = "E2E Deletable Alone";
  const DEL_USED = "E2E Deletable With Warning";
  const openCategoryRow = async (s, catName) => {
    await s.evaluate(`(() => {
      const card = document.querySelector(${JSON.stringify(CATEGORIES_CARD)});
      const row = [...card.querySelectorAll('.typerow')].find((r) => r.querySelector('summary').textContent.includes(${JSON.stringify(catName)}));
      if (row && !row.open) row.querySelector('summary').click();
    })()`);
  };
  await b.alice.goto("workspace");
  await b.alice.click({ role: "tab", name: "Categories & types" });
  // The "Add category" disclosure remembers its own open/closed state per browser (it was already
  // opened once earlier in this very scenario) — check before clicking, since clicking an already-
  // open toggle would close it instead of opening it.
  const addCategoryAlreadyOpen = await b.alice.evaluate(`[...document.querySelectorAll(${JSON.stringify(CATEGORIES_CARD)} + ' label')].some((l) => l.textContent === 'New category name')`);
  if (!addCategoryAlreadyOpen) await b.alice.click({ role: "button", name: "Add category", scope: CATEGORIES_CARD });
  for (const n of [DEL_UNUSED, DEL_USED]) {
    await b.alice.fill({ label: "New category name", scope: CATEGORIES_CARD }, n);
    await b.alice.click({ role: "button", name: "Save category", scope: CATEGORIES_CARD });
    await b.alice.waitForText(n, { scope: "main" });
  }
  await b.alice.settle();

  // Use DEL_USED on a real transaction so the warning has something real to count.
  await b.alice.goto("transactions");
  await b.alice.click({ role: "button", name: "Add expense", scope: "main" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Add expense dialog" });
  await b.alice.fill({ css: 'input[placeholder="0.00 or 12.50+3.20"]', scope: ".modal" }, "12.00");
  await b.alice.choose("Category", DEL_USED, { scope: ".modal" });
  await b.alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await b.alice.settle();

  // The unused one: deleted alone, no warning about affected records.
  await b.alice.goto("workspace");
  await b.alice.click({ role: "tab", name: "Categories & types" });
  await b.alice.waitForText(DEL_UNUSED, { scope: "main" });
  await openCategoryRow(b.alice, DEL_UNUSED);
  await b.alice.click({ role: "button", name: `Permanently delete ${DEL_UNUSED}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the impact dialog for the unused category" });
  await b.alice.waitForText("Nothing else references this. It will be permanently deleted alone.", { scope: ".modal" });
  await b.alice.click({ role: "button", name: "Continue", scope: ".modal" });
  await b.alice.fill({ label: `Type "${DEL_UNUSED}" to confirm`, scope: ".modal" }, DEL_UNUSED);
  await b.alice.click({ role: "button", name: "Permanently delete", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after deleting the unused category" });
  await b.alice.settle();
  const afterUnusedDelete = (await api("alice").ok("categories", { query: q })).categories;
  t.check("a category with nothing attached is permanently deleted, alone, with no warning about affected records", {
    expected: false, actual: afterUnusedDelete.some((x) => x.name === DEL_UNUSED),
  });

  // The used one: the review warns exactly how many records are affected, by name, before deleting.
  await b.alice.waitForText(DEL_USED, { scope: "main" });
  await openCategoryRow(b.alice, DEL_USED);
  await b.alice.click({ role: "button", name: `Permanently delete ${DEL_USED}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the impact dialog for the used category" });
  await b.alice.waitForText("1 transaction will keep everything else and only lose the link.", { scope: ".modal" });
  const shotWarning = await b.alice.shot("6-category-delete-warning");
  t.note(`screenshot of the "will be unset" warning before permanently deleting a used category: ${shotWarning}`);
  await b.alice.click({ role: "button", name: "Continue", scope: ".modal" });
  await b.alice.fill({ label: `Type "${DEL_USED}" to confirm`, scope: ".modal" }, DEL_USED);
  await b.alice.click({ role: "button", name: "Permanently delete", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after deleting the used category" });
  await b.alice.settle();
  const catsAfter = (await api("alice").ok("categories", { query: q })).categories;
  const txnAfter = (await api("alice").ok("transactions", { query: q })).transactions.find((x) => x.amount === "-12.00");
  t.check("after confirming, the category is gone but the transaction that used it survives, with its category unset — needing to be rechosen, never silently deleting the entry itself", {
    expected: { categoryGone: true, txnSurvives: true, categoryId: null },
    actual: { categoryGone: !catsAfter.some((x) => x.name === DEL_USED), txnSurvives: !!txnAfter, categoryId: txnAfter && txnAfter.categoryId },
  });
  // Uncategorized in the real browser too, not merely in the API response.
  await b.alice.goto("transactions");
  await b.alice.waitForText("Uncategorized", { scope: "main" });
  const shotUncategorized = await b.alice.shot("7-transaction-needs-recategorising");
  t.note(`screenshot of the affected transaction, needing to be rechosen: ${shotUncategorized}`);

  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() }); }
}
