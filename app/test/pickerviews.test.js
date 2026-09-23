// BT-004-05 — every dropdown in the views is TaskTracker's command picker (Terry, 2026-09-14: "use the
// same component. and any drop down that possible to use, can use that too"). For each converted view:
// no plain native dropdown is left, each picker is labelled by its field, short fixed lists have no
// search box, and a choice made THROUGH THE PICKER is exactly what the view submits. Fictional data
// only. Layout, contrast and real screen-reader output are checked in a real browser, not here.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, pickerSpokenAs, chooseOption, chooseByKeyboard, offeredOptions, triggerFor } from "./pickerassert.js";
import { openNewWorkspace, createOnboarding } from "../js/ui/views/landing.js";
import { createView as createAccounts } from "../js/ui/views/accounts.js";
import { createView as createMerchants, openMerchantEditor } from "../js/ui/views/payees.js";
import { createView as createSettings } from "../js/ui/views/settings.js";
import { createView as createWorkspace } from "../js/ui/views/workspace.js";
import { todayIsoUTC } from "../js/core/format.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
import { spokenOf } from "./pickerassert.js";
// What a screen reader announces: the field's name, the value and how to use it (a11y review finding 6).
const spoken = (select) => spokenOf(triggerFor(select));

describe("BT-004-05 landing: New workspace and the first-workspace page", () => {
  test("Kind and Reporting currency are pickers; Kind is a short list without search", () => {
    const store = { actions: { createWorkspace: async () => ({ id: "ws_x", name: "x" }) } };
    const dialog = openNewWorkspace({ store }).element;
    assert.deepEqual(nativeDropdowns(dialog), []);
    assert.deepEqual(pickerLabels(dialog), ["Kind", "Reporting currency"]);
    assert.equal(spoken(pickerNamed(dialog, "Kind")), "Kind: Personal. Choose.");
    assert.equal(spoken(pickerNamed(dialog, "Reporting currency")), "Reporting currency: EUR. Search and choose.");
  });

  test("what is chosen in the pickers is what the workspace is created with", async () => {
    const calls = [];
    const store = { actions: { createWorkspace: async (body) => { calls.push(body); return { id: "ws_trip", name: body.name }; } } };
    const dialog = openNewWorkspace({ store }).element;
    dialog.querySelector("input").value = "Fictional trip to Porto";
    chooseByKeyboard(pickerNamed(dialog, "Kind"), { keys: ["t"] });
    chooseByKeyboard(pickerNamed(dialog, "Reporting currency"), { type: "gbp" });
    buttonNamed(dialog, "Create workspace").click();
    await tick();
    assert.deepEqual(calls, [{ name: "Fictional trip to Porto", kind: "trip", reportingCurrency: "GBP" }]);
  });

  test("the first-workspace page uses the same pickers", async () => {
    const calls = [];
    const view = createOnboarding({ store: { actions: { createWorkspace: async (body) => { calls.push(body); } } } });
    dom.body.appendChild(view.element);
    assert.deepEqual(nativeDropdowns(view.element), []);
    assert.equal(spoken(pickerNamed(view.element, "Kind")), "Kind: Household. Choose.");
    view.element.querySelector("input").value = "Fictional flat";
    chooseOption(pickerNamed(view.element, "Kind"), "Shared-expense group");
    buttonNamed(view.element, "Create workspace").click();
    await tick();
    assert.deepEqual(calls, [{ name: "Fictional flat", kind: "group", reportingCurrency: "EUR" }]);
  });
});

function accountsCtx() {
  const calls = { created: [], granted: [] };
  const joint = { id: "acc_joint", name: "Fictional joint", type: "checking", currency: "EUR", visibility: "private", access: "own", ownedBySelf: true, status: "open", capabilities: ["create"], balance: "10.00" };
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", reportingCurrency: "EUR" }],
    preferences: null,
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [joint] } },
    members: { workspaceId: "ws_1", status: "ready", error: null, data: { members: [
      { id: "m_alice", name: "Alice Fictional", self: true }, { id: "m_bob", name: "Bob Fictional" }, { id: "m_carol", name: "Carol Fictional" },
    ] } },
  };
  const api = {
    createAccount: async (ws, body) => { calls.created.push(body); return {}; },
    whoCanSee: async () => ({ people: [], notice: "Fictional notice.", grants: [] }),
    grant: async (ws, body) => { calls.granted.push(body); return {}; },
  };
  const store = { getState: () => state, actions: { write: async (fn) => { await fn("ws_1"); return { ok: true }; } } };
  return { ctx: { store, api }, state, calls };
}

describe("BT-004-05 accounts: Add account and Who can see this", () => {
  test("Type, Currency and Who can see it are pickers; the two short lists have no search box and types show their icon", () => {
    const { ctx } = accountsCtx();
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    buttonNamed(view.element, "Add account").click();
    const dialog = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(dialog), []);
    assert.deepEqual(pickerLabels(dialog), ["Type", "Currency", "Who can see it"]);
    assert.equal(spoken(pickerNamed(dialog, "Type")), "Type: Checking. Choose.");
    assert.equal(spoken(pickerNamed(dialog, "Currency")), "Currency: EUR. Search and choose.");
    assert.equal(spoken(pickerNamed(dialog, "Who can see it")), "Who can see it: Private — only you (you can share it later). Choose.");
    triggerFor(pickerNamed(dialog, "Type")).click();
    const rows = dom.body.querySelectorAll(".cmdpick__opt");
    assert.equal(rows.length, 10, "every account type is offered");
    for (const row of rows) {
      const mark = row.querySelector("svg");
      assert.ok(mark, "each type has its icon");
      assert.equal(mark.getAttribute("aria-hidden"), "true", "decorative: the name beside it says what it is");
      assert.ok(row.querySelector(".cmdpick__optlabel").textContent.length > 0);
    }
  });

  test("the account is created with what was chosen in the pickers", async () => {
    const { ctx, calls } = accountsCtx();
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    buttonNamed(view.element, "Add account").click();
    const dialog = dom.body.querySelector(".modal");
    dialog.querySelector("input").value = "Fictional savings";
    chooseOption(pickerNamed(dialog, "Type"), "Savings");
    chooseByKeyboard(pickerNamed(dialog, "Currency"), { type: "chf" });
    chooseOption(pickerNamed(dialog, "Who can see it"), "Shared — every workspace member per their role");
    buttonNamed(dialog, "Create account").click();
    await tick();
    assert.equal(calls.created.length, 1);
    assert.deepEqual({ name: calls.created[0].name, type: calls.created[0].type, currency: calls.created[0].currency, visibility: calls.created[0].visibility },
      { name: "Fictional savings", type: "savings", currency: "CHF", visibility: "shared" });
  });

  test("Who can see this: the member to share with is a searchable picker, and the grant goes to the member chosen", async () => {
    const { ctx, state, calls } = accountsCtx();
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    // BT-015: Who can see this is inside the row's compact actions menu — open it first.
    view.element.querySelector(".actionsmenu__toggle").click();
    buttonNamed(dom.body, "Who can see this").click();
    await tick();
    await tick();
    const dialog = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(dialog), []);
    const member = pickerNamed(dialog, "Member");
    assert.equal(spoken(member), "Member: Bob Fictional. Choose.");
    chooseByKeyboard(member, { type: "carol" });
    buttonNamed(dialog, "Share").click();
    await tick();
    assert.equal(calls.granted.length, 1);
    assert.equal(calls.granted[0].memberId, "m_carol");
  });
});

function merchantsCtx() {
  const calls = [];
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner" }],
    preferences: null,
    categories: ready({ categories: [
      { id: "cat_food", name: "Groceries", color: "#2563eb", icon: "cart" },
      { id: "cat_gift", name: "Gifts", color: "#16a34a", icon: null },
      { id: "cat_old", name: "Old hobby", color: "#9333ea", icon: null, archived: true },
    ] }),
    accounts: ready({ accounts: [
      { id: "acc_joint", name: "Fictional joint", access: "shared", icon: "bank" },
      { id: "acc_wallet", name: "Fictional wallet", access: "own", icon: "wallet" },
    ] }),
    payees: ready({ payees: [
      { id: "p_bakery", name: "Fictional Bakery", status: "active", visibility: "shared", stats: [], canEdit: true },
      { id: "p_video", name: "Fictional Video Store", status: "closed", visibility: "shared", stats: [], canEdit: true },
    ] }),
    bills: ready({ recurring: [
      // Already started (schedule.startDate in the past) — the common case: linking a merchant
      // should take effect TODAY, not on nextDue (financial/UX review fix, 2026-09-17).
      // A typed-but-unmatched merchant name (Bills → Merchant fix, 2026-09-18) — deliberately
      // DIFFERENT from the bill's own title, so a test that showed the title instead would fail.
      { id: "bill_netflix", name: "Fictional September streaming bill", payeeDraftName: "Fictional Netflix", kind: "expense", payeeId: null, ended: false, canEdit: true, revision: 2, nextDue: "2026-10-01", schedule: { startDate: "2026-01-01" } },
      { id: "bill_rent", name: "Fictional rent", kind: "expense", payeeId: "p_bakery", ended: false, canEdit: true, revision: 1, nextDue: "2026-10-01", schedule: { startDate: "2026-01-01" } },
      { id: "bill_xfer", name: "Fictional savings transfer", kind: "transfer", payeeId: null, ended: false, canEdit: true, revision: 1, nextDue: "2026-10-01", schedule: { startDate: "2026-01-01" } },
      { id: "bill_ended", name: "Fictional old gym", kind: "expense", payeeId: null, ended: true, canEdit: true, revision: 1, nextDue: null, schedule: { startDate: "2026-01-01" } },
      // Terry's exact repro: a bill scheduled to start NEXT MONTH, nextDue equal to that same
      // future start date. Linking a merchant here can't take effect any earlier than the bill's
      // own start (the server refuses it) — but must use that start date, not something later.
      { id: "bill_future", name: "Fictional Electric Repayment", payeeDraftName: "Fictional Electric Co", kind: "expense", payeeId: null, ended: false, canEdit: true, revision: 1, nextDue: "2099-01-15", schedule: { startDate: "2099-01-15" } },
      // Never typed anything (an older bill, or one saved before this feature existed): must never
      // guess the bill's own title as a merchant name.
      { id: "bill_unnamed", name: "Fictional Mystery Charge", kind: "expense", payeeId: null, ended: false, canEdit: true, revision: 1, nextDue: "2026-10-01", schedule: { startDate: "2026-01-01" } },
    ] }),
  };
  const billUpdates = [];
  const api = {
    createMerchant: async (ws, body) => { calls.push(body); return { payee: { id: "p_new", name: body.name } }; },
    updateBill: async (ws, body) => { billUpdates.push(body); return {}; },
  };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; },
      refreshPayees: async () => {}, refreshBills: async () => {},
    },
  };
  return { ctx: { store, api, navigate() {} }, state, calls, billUpdates };
}

describe("BT-004-05 merchants: the Show filter and the merchant editor", () => {
  test("Show is a short picker, and choosing Closed lists the closed merchants", () => {
    const { ctx, state } = merchantsCtx();
    const view = createMerchants(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    assert.deepEqual(nativeDropdowns(view.element), []);
    const show = pickerNamed(view.element, "Show");
    assert.equal(spoken(show), "Show: Active. Choose.");
    const table = () => view.element.querySelector("table").textContent;
    assert.match(table(), /Fictional Bakery/);
    assert.doesNotMatch(table(), /Fictional Video Store/);
    chooseOption(show, "Closed");
    assert.match(table(), /Fictional Video Store/);
    assert.doesNotMatch(table(), /Fictional Bakery/);
  });

  test("the editor's dropdowns are pickers with their marks; the default account list follows Sharing; the chosen values are saved", async () => {
    const { ctx, calls } = merchantsCtx();
    openMerchantEditor(ctx);
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(root), []);
    assert.deepEqual(pickerLabels(root), ["Sharing", "Type", "Default category", "Default account"]);
    assert.equal(spoken(pickerNamed(root, "Sharing")), "Sharing: Shared with the workspace. Choose.");
    assert.equal(spoken(pickerNamed(root, "Type")), "Type: Other. Search and choose.", "fourteen types: long enough to search");
    // A new merchant is not offered an archived category; a category shows its tinted icon or dot.
    // BT-025: category dropdowns are alphabetized ("Gifts" < "Groceries").
    triggerFor(pickerNamed(root, "Default category")).click();
    const catRows = dom.body.querySelectorAll(".cmdpick__opt");
    assert.deepEqual(catRows.map((r) => r.querySelector(".cmdpick__optlabel").textContent), ["None", "Gifts", "Groceries"]);
    assert.equal(catRows[1].querySelector(".swatch-dot").style.getPropertyValue("--swatch"), "#16a34a", "Gifts has no icon: the colour dot");
    const groceries = catRows[2].querySelector(".catlabel__icon");
    assert.ok(groceries, "Groceries has an icon");
    assert.equal(groceries.style.getPropertyValue("--swatch"), "#2563eb", "tinted with its colour");
    assert.equal(groceries.getAttribute("aria-hidden"), "true");
    assert.ok(catRows[0].querySelector(".catlabel__icon, .swatch-dot") === null, "None has no mark");
    // Chooses "Groceries" (now index 2, after "Gifts") — thematically fitting for "Fictional
    // Greengrocer" below, and what the saved-value assertion expects.
    catRows[2].dispatchEvent(new DomEvent("mousedown", { bubbles: true }));
    // Shared merchants may default only to shared accounts; making it private offers private ones too.
    const account = pickerNamed(root, "Default account");
    triggerFor(account).click();
    assert.deepEqual(dom.body.querySelectorAll(".cmdpick__opt").map((r) => r.querySelector(".cmdpick__optlabel").textContent), ["None", "Fictional joint"]);
    triggerFor(account).click();
    chooseOption(pickerNamed(root, "Sharing"), "Private to me");
    chooseOption(account, "Fictional wallet");
    // (The DOM double has no descendant combinator, so the two steps are taken separately.)
    assert.ok(triggerFor(account).querySelector(".cmdpick__badge").querySelector("svg"), "the chosen account's icon is on the trigger");
    chooseByKeyboard(pickerNamed(root, "Type"), { type: "groc" });
    root.querySelector("input").value = "Fictional Greengrocer";
    buttonNamed(root, "Add merchant").click();
    await tick();
    assert.equal(calls.length, 1);
    const { name, visibility, type, defaultCategoryId, defaultAccountId } = calls[0];
    assert.deepEqual({ name, visibility, type, defaultCategoryId, defaultAccountId },
      { name: "Fictional Greengrocer", visibility: "private", type: "grocery", defaultCategoryId: "cat_food", defaultAccountId: "acc_wallet" });
  });

  test("a shared merchant's Sharing picker is locked", () => {
    const { ctx } = merchantsCtx();
    openMerchantEditor(ctx, { id: "p_bakery", name: "Fictional Bakery", visibility: "shared", status: "active", revision: 1, history: [] });
    const root = dom.body.querySelector(".modal");
    assert.equal(triggerFor(pickerNamed(root, "Sharing")).disabled, true);
  });
});

describe("BT-014-11/Bills → Merchant fix (2026-09-18) 'Pending merchants' (Terry, 2026-09-17: \"add merchants for ones that are used in bills but not added there yet\")", () => {
  test("shows the TYPED merchant name, never the bill's own title; excludes transfers, ended and already-linked bills; 'Add merchant' pre-fills the typed name and links every bill under it", async () => {
    const { ctx, state, calls, billUpdates } = merchantsCtx();
    const view = createMerchants(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const section = view.element.querySelector("#payees-missing").closest(".card");
    const text = section.textContent;
    assert.match(text, /Fictional Netflix/, "the typed name is shown");
    assert.match(section.textContent, /On: Fictional September streaming bill/, "the associated bill is listed by its own title, separately");
    assert.doesNotMatch(text, /Fictional rent/, "already has a merchant");
    assert.doesNotMatch(text, /Fictional savings transfer/, "a transfer has no payee");
    assert.doesNotMatch(text, /Fictional old gym/, "ended bills don't need one");
    buttonNamed(section, "Add merchant").click();
    const root = dom.body.querySelector(".modal");
    assert.equal(root.querySelector("h2").textContent, "Add merchant", "creating, never editing");
    const nameInput = root.querySelector("input");
    assert.equal(nameInput.getAttribute("value"), "Fictional Netflix", "pre-filled from the TYPED name, not the bill title");
    // The DOM double doesn't reflect a value ATTRIBUTE into the live .value property the way a
    // real browser does (see app/test/accounteditor.test.js's own syncValues note) — set directly,
    // matching this exact dialog's other test above (line ~231).
    nameInput.value = "Fictional Netflix";
    buttonNamed(root, "Add merchant").click();
    await tick();
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "Fictional Netflix");
    assert.equal(billUpdates.length, 1);
    // Takes effect TODAY, not on nextDue (2026-10-01) — the bug fix (2026-09-17): the bill already
    // started (schedule.startDate is in the past), so there's no reason to delay the link. "Today"
    // is the SERVER's own UTC calendar day (`todayIsoUTC`, core/format.js), not the browser's local
    // one — a stale expectation here (this test previously asserted the browser-local `todayIso()`,
    // which `linkBillToMerchant` itself used before its own 2026-09-23 timezone fix) genuinely caught
    // this suite running for real, live, across that exact local-vs-UTC midnight boundary.
    assert.deepEqual(billUpdates[0], { recurringId: "bill_netflix", revision: 2, payeeId: "p_new", effectiveFrom: todayIsoUTC() });
  });

  test("a bill that hasn't started yet (Terry's exact repro): linking a merchant uses the bill's own start date, not something later — never silently invisible on the bill's current view once it starts", async () => {
    const { ctx, state, calls, billUpdates } = merchantsCtx();
    const view = createMerchants(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const section = view.element.querySelector("#payees-missing").closest(".card");
    assert.match(section.textContent, /Fictional Electric Co/);
    const row = [...section.querySelectorAll("li")].find((li) => li.textContent.includes("Fictional Electric Co"));
    buttonNamed(row, "Add merchant").click();
    const root = dom.body.querySelector(".modal");
    root.querySelector("input").value = "Fictional Electric Co";
    buttonNamed(root, "Add merchant").click();
    await tick();
    await tick();
    assert.equal(billUpdates.length, 1);
    assert.deepEqual(billUpdates[0], { recurringId: "bill_future", revision: 1, payeeId: "p_new", effectiveFrom: "2099-01-15" });
    // The bill leaves the list right away — even though (this mock never mutates state, matching a
    // bill whose own schedule hasn't started yet and so can never show a merchant as "current"
    // today) nothing about state.bills actually changed. Real-browser bug (2026-09-17): the list
    // kept re-offering an already-linked, not-yet-started bill forever without this.
    const cardAfter = view.element.querySelector("#payees-missing");
    const textAfter = cardAfter ? cardAfter.closest(".card").textContent : "";
    assert.doesNotMatch(textAfter, /Fictional Electric Co/, "does not keep re-offering a bill that was just linked");
    assert.match(textAfter, /Fictional Netflix/, "an untouched bill is still offered");
  });

  test("a bill with no typed name at all is shown separately, asking for correction rather than guessing its own title as a merchant", () => {
    const { ctx, state } = merchantsCtx();
    const view = createMerchants(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const card = view.element.querySelector("#payees-missing").closest(".card");
    assert.match(card.textContent, /Bills with no merchant name recorded/);
    assert.match(card.textContent, /Fictional Mystery Charge/, "the bill's own title IS shown here, but only as the bill, never presented as a merchant name");
    assert.equal([...card.querySelectorAll("button")].some((b) => b.textContent === "Add merchant" && b.closest("li").textContent.includes("Fictional Mystery Charge")), false, "no 'Add merchant' offered without a typed name to prefill");
  });

  test("two bills with the identical typed name are grouped into one pending entry", () => {
    const { ctx, state } = merchantsCtx();
    state.bills.data.recurring.push({ id: "bill_netflix2", name: "Fictional second streaming bill", payeeDraftName: "Fictional Netflix", kind: "expense", payeeId: null, ended: false, canEdit: true, revision: 1, nextDue: "2026-10-01", schedule: { startDate: "2026-01-01" } });
    const view = createMerchants(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const section = view.element.querySelector("#payees-missing").closest(".card");
    const matches = section.textContent.match(/Fictional Netflix/g) || [];
    assert.equal(matches.length, 1, "one pending entry, not two, for the same typed name");
    assert.match(section.textContent, /On: Fictional September streaming bill, Fictional second streaming bill/);
  });

  test("nothing shown when every bill already has a merchant, is a transfer, has ended, or was never offered", () => {
    const { ctx, state } = merchantsCtx();
    state.bills.data.recurring = state.bills.data.recurring.filter((b) => !["bill_netflix", "bill_future", "bill_unnamed"].includes(b.id));
    const view = createMerchants(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    assert.equal(view.element.querySelector("#payees-missing"), null);
  });
});

function settingsCtx({ locked = [] } = {}) {
  const saved = [];
  const sources = { themeMode: "default", themePalette: "default", displayCurrency: "default", dateFormat: "default", numberFormat: "default", defaultWorkspaceId: "default", balanceMasking: "default", categoryColors: "default", categoryIcons: "default" };
  for (const key of locked) sources[key] = "locked";
  const state = {
    selectedWorkspaceId: null,
    workspaces: [{ id: "ws_home", name: "Fictional household", role: "owner" }, { id: "ws_trip", name: "Fictional trip", role: "member" }],
    auth: { user: { name: "Alice Fictional", siteAdmin: false } },
    preferences: { effective: { dateFormat: "iso", numberFormat: "1,234.56", displayCurrency: "", defaultWorkspaceId: "", balanceMasking: false, themePalette: "midnight" }, sources },
  };
  const theme = { getTheme: () => "midnight", setTheme() {}, subscribe: () => () => {}, getMode: () => "light", getResolvedMode: () => "light", setMode() {} };
  const store = { getState: () => state, actions: { savePreferences: async (patch) => { saved.push(patch); return { ok: true }; }, init: async () => {} } };
  const api = { request: async () => ({ private: [] }) };
  return { ctx: { store, theme, api }, state, saved };
}

describe("BT-004-05 My settings: display preferences", () => {
  const panelKey = (key) => dom.body.querySelector(".cmdpick__panel").dispatchEvent(new DomEvent("keydown", { bubbles: true, key }));

  test("the four preferences are pickers; each explicit choice saves once, and Escape saves nothing (A11Y-002)", () => {
    const { ctx, state, saved } = settingsCtx();
    const view = createSettings(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    assert.deepEqual(nativeDropdowns(view.element), []);
    assert.deepEqual(pickerLabels(view.element), ["Display currency", "Date format", "Number format", "Default workspace"]);
    assert.equal(spoken(pickerNamed(view.element, "Display currency")), "Display currency: Account currency. Choose.");
    assert.equal(spoken(pickerNamed(view.element, "Date format")), "Date format: 2026-09-13. Choose.");
    assert.equal(spoken(pickerNamed(view.element, "Number format")), "Number format: 1,234.56. Choose.");
    assert.equal(spoken(pickerNamed(view.element, "Default workspace")), "Default workspace: First available. Choose.");
    const dateFormat = pickerNamed(view.element, "Date format");
    triggerFor(dateFormat).click();
    panelKey("ArrowDown");
    panelKey("Escape");
    assert.deepEqual(saved, [], "browsing and Escape save nothing");
    chooseByKeyboard(dateFormat, { keys: ["ArrowDown"] });
    assert.deepEqual(saved, [{ dateFormat: "dmy" }]);
    // Three workspaces: no search box since UX review U2, so the start of the name is typed, as in a
    // native list — the space inside "fictional t" is part of the type-ahead, not a choice.
    chooseByKeyboard(pickerNamed(view.element, "Default workspace"), { type: "fictional t" });
    assert.deepEqual(saved, [{ dateFormat: "dmy" }, { defaultWorkspaceId: "ws_trip" }]);
  });

  test("after a save rebuilds the card, focus is on the same preference's trigger, not lost to the page", () => {
    const { ctx, state } = settingsCtx();
    const view = createSettings(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const before = pickerNamed(view.element, "Date format");
    chooseByKeyboard(before, { keys: ["ArrowDown"] });
    assert.ok(document.activeElement === triggerFor(before), "the picker put focus back on its trigger");
    // The store answers with the saved preference; the card is rebuilt from it.
    state.preferences = { ...state.preferences, effective: { ...state.preferences.effective, dateFormat: "dmy" }, sources: { ...state.preferences.sources, dateFormat: "personal" } };
    view.update(state);
    const after = pickerNamed(view.element, "Date format");
    assert.ok(after !== before, "rebuilt");
    assert.equal(spoken(after), "Date format: 13/09/2026. Choose.");
    assert.ok(document.activeElement === triggerFor(after), "focus followed the preference to its new trigger");
  });

  test("a preference the site has locked has a disabled picker", () => {
    const { ctx, state } = settingsCtx({ locked: ["numberFormat"] });
    const view = createSettings(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    assert.equal(triggerFor(pickerNamed(view.element, "Number format")).disabled, true);
    assert.equal(triggerFor(pickerNamed(view.element, "Date format")).disabled, false);
  });
});

function workspaceCtx() {
  const MB = 1024 * 1024;
  const calls = { invites: [], patches: [], previews: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner" }],
    preferences: null,
    members: ready({ members: [
      { id: "m_alice", name: "Alice Fictional", role: "owner", self: true, email: "alice@example.com", allowanceBytes: 12 * MB, usedBytes: 1024 },
      { id: "m_bob", name: "Bob Fictional", role: "member", email: "bob@example.com", allowanceBytes: 4 * MB },
    ] }),
    categories: ready({ categories: [], palette: [] }),
    icons: ready({ typeIcons: {}, canEditTypeIcons: false, catalog: null }),
  };
  const api = {
    invite: async (ws, body) => { calls.invites.push(body); return { token: "fictional-token", accessPreview: { summary: "Fictional access summary." } }; },
    invitations: async () => ({ invitations: [] }),
    backups: async () => ({ archives: [{ archiveId: "arc_1", createdAt: "2026-09-13T10:00:00Z", reason: "manual", createdBySelf: true }], policy: "Fictional backup policy." }),
    audit: async () => ({ entries: [] }),
    request: async (name, opts = {}) => {
      if (name === "members" && opts.method === "PATCH") { calls.patches.push(opts.body); return {}; }
      if (name === "members") return { former: [] };
      if (name === "workspaces") return { workspace: { history: [], lifecycle: [] } };
      return {};
    },
    previewRestore: async (body) => {
      calls.previews.push(body);
      return { canExecute: true, expectedEtag: "etag-1", scope: { accounts: 1, transactions: 2 }, changes: { add: 0, update: 0, remove: 0 },
        excluded: { setAside: 0, conflictsSkipped: 0, deletedRestored: 0, otherMembersPrivateRecords: false }, nothingToRestore: false,
        totalsAfter: [], permissions: "Fictional permissions note.", warnings: [], blockers: [] };
    },
  };
  const store = { getState: () => state, actions: { write: async (fn) => { await fn("ws_1"); return { ok: true }; } } };
  return { ctx: { api, store }, state, calls };
}

async function openWorkspacePage() {
  const { ctx, state, calls } = workspaceCtx();
  const view = createWorkspace(ctx);
  dom.body.appendChild(view.element);
  view.update(state);
  for (let i = 0; i < 4; i += 1) await tick();
  return { view, state, calls };
}

describe("BT-004-05 workspace: invitations, members and restore", () => {
  test("invite: the role is a short picker, and the invitation carries the role chosen", async () => {
    const { view, calls } = await openWorkspacePage();
    const role = pickerNamed(view.element, "Role");
    assert.equal(spoken(role), "Role: Member. Choose.");
    assert.deepEqual(offeredOptions(role), ["Viewer", "Member", "Manager", "Owner"]);
    chooseOption(role, "Manager");
    view.element.querySelector('input[type="email"]').value = "dana@example.com";
    buttonNamed(view.element, "Create invitation").click();
    await tick();
    assert.deepEqual(calls.invites, [{ email: "dana@example.com", role: "manager" }]);
  });

  test("a member's role and storage allowance are pickers in the row, named for the member; each choice saves once and making an owner asks first", async () => {
    const { view, calls } = await openWorkspacePage();
    assert.deepEqual(nativeDropdowns(view.element), []);
    const role = pickerSpokenAs(view.element, "Role for Bob Fictional");
    const allowance = pickerSpokenAs(view.element, "Storage allowance for Bob Fictional");
    assert.equal(spoken(role), "Role for Bob Fictional: Member. Choose.");
    assert.equal(spoken(allowance), "Storage allowance for Bob Fictional: 4 MB. Choose.");
    chooseOption(allowance, "8 MB");
    await tick();
    assert.deepEqual(calls.patches, [{ memberId: "m_bob", allowanceMb: 8 }]);
    chooseOption(role, "Viewer");
    await tick();
    assert.deepEqual(calls.patches, [{ memberId: "m_bob", allowanceMb: 8 }, { memberId: "m_bob", role: "viewer" }]);
    chooseOption(role, "Owner");
    await tick();
    assert.equal(calls.patches.length, 2, "a promotion to owner waits for confirmation");
    assert.match(dom.body.querySelector(".modal").textContent, /Make Bob Fictional an owner\?/);
    assert.equal(spoken(role), "Role for Bob Fictional: Member. Choose.", "the current role is shown until it is confirmed");
  });

  test("after a change re-renders the members, focus is on the same member's same control", async () => {
    const { view, state } = await openWorkspacePage();
    // The allowance, not the role: the row has two pickers, and focus must return to the one used.
    const allowance = pickerSpokenAs(view.element, "Storage allowance for Bob Fictional");
    chooseByKeyboard(allowance, { keys: ["End"] });
    await tick();
    assert.ok(document.activeElement === triggerFor(allowance), "the picker gave focus back to its trigger");
    state.members = { ...state.members, data: { members: state.members.data.members.map((m) => (m.id === "m_bob" ? { ...m, allowanceBytes: 12 * 1024 * 1024 } : m)) } };
    view.update(state);
    const rebuilt = pickerSpokenAs(view.element, "Storage allowance for Bob Fictional");
    assert.ok(rebuilt !== allowance, "rebuilt");
    assert.equal(spoken(rebuilt), "Storage allowance for Bob Fictional: 12 MB. Choose.");
    assert.ok(document.activeElement === triggerFor(rebuilt), "focus followed the member's allowance to its new picker");
    assert.ok(document.activeElement !== triggerFor(pickerSpokenAs(view.element, "Role for Bob Fictional")), "not to the role beside it");
  });

  test("restore: what should happen is a short picker, and the preview asks for the mode chosen", async () => {
    const { view, calls } = await openWorkspacePage();
    view.element.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Restore from 2026-09-13 10:00").click();
    const dialog = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(dialog), []);
    const mode = pickerNamed(dialog, "What should happen");
    assert.equal(spoken(mode), "What should happen: Merge — add missing records, keep current ones. Choose.");
    const deletedRow = dialog.querySelector('input[type="checkbox"]').parentNode;
    chooseOption(mode, "Replace — roll my records back to this backup");
    assert.equal(deletedRow.hidden, true, "the merge-only option leaves with Merge");
    buttonNamed(dialog, "Preview").click();
    await tick();
    assert.deepEqual(calls.previews.map((b) => b.mode), ["replace"]);
  });
});
