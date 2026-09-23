// BT-004-05 — the Bills view's dropdowns are TaskTracker's command picker: the bill editor (type,
// direction, account, destination, amount kind, how often, unit, category, responsible person) and the
// review-and-record dialog (category, status). A value the view sets from code — the direction that
// follows the bill type, the people loaded after the dialog opens — shows in the pickers; locked
// fields have disabled triggers; what is chosen through the pickers is what is saved. Fictional data
// only. Layout and screen-reader output are checked in a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, chooseOption, chooseByKeyboard, offeredOptions, triggerFor } from "./pickerassert.js";
import { createView, openBillEditor } from "../js/ui/views/bills.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
import { spokenOf } from "./pickerassert.js";
// What a screen reader announces: the field's name, the value and how to use it (a11y review finding 6).
const spoken = (select) => spokenOf(triggerFor(select));
const ancestorWith = (node, cls) => { let n = node; while (n && !(n.classList && n.classList.contains(cls))) n = n.parentNode; return n; };

const RENT = {
  id: "bill_rent", name: "Fictional rent", billType: "housing", kind: "expense", accountId: "acc_joint", accountName: "Fictional joint",
  amount: "950.00", currency: "EUR", amountType: "fixed", schedule: { freq: "monthly", interval: 1, startDate: "2026-01-01" },
  reminderDays: 3, categoryId: null, payeeId: null, iconSource: null, icon: "home", nextDue: "2026-09-01", revision: 1, responsible: null,
  overdue: ["2026-09-01"], reminders: [], canRecord: true, canEdit: true, inactiveReason: null, ended: false, pausedNow: false,
  versions: [], skips: [], pauses: [], history: [],
};

function billsCtx() {
  const calls = { created: [], recorded: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household" }],
    preferences: null,
    accounts: ready({ accounts: [
      { id: "acc_joint", name: "Fictional joint", currency: "EUR", access: "shared", status: "open", capabilities: ["create"], icon: "bank" },
      { id: "acc_savings", name: "Fictional savings", currency: "EUR", access: "own", status: "open", capabilities: ["create"], icon: "piggy-bank" },
    ] }),
    categories: ready({ categories: [{ id: "cat_home", name: "Housing", color: "#2563eb", icon: "home" }, { id: "cat_pay", name: "Salary", color: "#16a34a", icon: null }] }),
    payees: ready({ payees: [] }),
    bills: ready({ recurring: [RENT], summary: { overdue: 1, dueSoon: 0, next30Days: [] } }),
  };
  const api = {
    people: async () => ({ options: [
      { ref: "member:m_bob", label: "Bob Fictional", type: "member" },
      { ref: "contact:c_dana", label: "Dana Fictional", type: "contact", typeLabel: "Contact" },
    ] }),
    createBill: async (ws, body) => { calls.created.push(body); return {}; },
    updateBill: async (ws, body) => { calls.updated = calls.updated || []; calls.updated.push(body); return {}; },
    billDraft: async () => ({ draft: { amountIsEstimate: false, amount: "950.00", date: "2026-09-01", categoryId: null, payeeId: null, payeeName: null, currency: "EUR", overdue: true } }),
    billAction: async (ws, action, body) => { calls.recorded.push({ action, body }); return {}; },
    createAccount: async (ws, body) => {
      calls.accountsCreated = calls.accountsCreated || [];
      calls.accountsCreated.push(body);
      const account = { id: "acc_new", name: body.name, type: body.type, currency: body.currency, visibility: body.visibility, access: "own", status: "open", capabilities: ["create"], icon: null };
      return { account };
    },
  };
  const store = { getState: () => state, actions: { write: async (fn, refresh) => { const result = await fn("ws_1"); if (refresh && refresh.includes("accounts")) state.accounts = ready({ accounts: [...state.accounts.data.accounts] }); return { ok: true, result }; }, refreshBills: async () => {} } };
  return { ctx: { store, api }, state, calls };
}

describe("BT-004-05 bills: an empty field reads naturally (UX review U6)", () => {
  test("a new bill's empty To account says “Choose an account…”, not “Choose to account…”", () => {
    const { ctx } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    const to = pickerNamed(root, "To account");
    assert.equal(to.value, "", "nothing chosen yet");
    assert.equal(triggerFor(to).querySelector(".cmdpick__value").textContent, "Choose an account…");
  });
});

describe("BT-004-05 bills: the bill editor", () => {
  test("every dropdown is a picker; the short lists have no search box; people load into Responsible person", async () => {
    const { ctx } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(root), []);
    assert.deepEqual(pickerLabels(root), ["Type", "Direction", "Account", "To account", "Amount is", "Repeats", "Unit", "Merchant", "Category", "Responsible person"]);
    assert.equal(spoken(pickerNamed(root, "Type")), "Type: Rent or mortgage. Choose.");
    assert.equal(spoken(pickerNamed(root, "Direction")), "Direction: Money out. Choose.");
    assert.equal(spoken(pickerNamed(root, "Account")), "Account: Fictional joint (EUR). Choose.");
    assert.equal(spoken(pickerNamed(root, "Amount is")), "Amount is: Always the same. Choose.");
    assert.equal(spoken(pickerNamed(root, "Repeats")), "Repeats: Monthly. Choose.");
    assert.equal(spoken(pickerNamed(root, "Unit")), "Unit: months. Choose.");
    // Merchant is now the SAME command picker as Category — the exact consistency Terry asked for
    // (2026-09-18: "what i did ask for was the drop down to look like that of the category field").
    assert.equal(spoken(pickerNamed(root, "Merchant")), "Merchant: Choose a merchant…. Search and choose.");
    assert.equal(spoken(pickerNamed(root, "Category")), "Category: Uncategorized. Choose.");
    assert.equal(spoken(pickerNamed(root, "Responsible person")), "Responsible person: Nobody in particular. Choose.");
    await tick();
    assert.deepEqual(offeredOptions(pickerNamed(root, "Responsible person")), ["Nobody in particular", "Bob Fictional (workspace member)", "Dana Fictional (contact)"], "the people loaded after the dialog opened are offered");
    triggerFor(pickerNamed(root, "Type")).click();
    const typeRows = dom.body.querySelectorAll(".cmdpick__opt");
    assert.equal(typeRows.length, 9);
    assert.ok(typeRows.every((r) => r.querySelector("svg")), "each bill type shows its icon");
  });

  test("the direction set from the bill type shows in its picker; the chosen schedule, person and category are saved", async () => {
    const { ctx, calls } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    await tick();
    chooseOption(pickerNamed(root, "Type"), "Payroll or income");
    assert.equal(spoken(pickerNamed(root, "Direction")), "Direction: Money in. Choose.", "set from code by the type, and shown");
    const unit = pickerNamed(root, "Unit");
    assert.ok(ancestorWith(triggerFor(unit), "form-grid").hasAttribute("hidden"), "the custom schedule starts hidden");
    chooseOption(pickerNamed(root, "Repeats"), "Custom…");
    assert.equal(ancestorWith(triggerFor(unit), "form-grid").hidden, false, "Custom… shows it");
    chooseOption(unit, "weeks");
    root.querySelector('input[type="number"]').value = "2";
    chooseByKeyboard(pickerNamed(root, "Responsible person"), { type: "dana" });
    chooseOption(pickerNamed(root, "Category"), "Salary");
    root.querySelector('input[maxlength="80"]').value = "Fictional salary";
    root.querySelector('input[inputmode="decimal"]').value = "2500.00";
    buttonNamed(root, "Add bill").click();
    await tick();
    assert.equal(calls.created.length, 1);
    const { billType, kind, accountId, schedule, responsibleRef, categoryId, amountType } = calls.created[0];
    assert.deepEqual({ billType, kind, accountId, freq: schedule.freq, interval: schedule.interval, responsibleRef, categoryId, amountType },
      { billType: "income", kind: "income", accountId: "acc_joint", freq: "weekly", interval: 2, responsibleRef: "contact:c_dana", categoryId: "cat_pay", amountType: "fixed" });
  });

  test("editing a bill locks Direction, Account and Repeats; the rest stay open", () => {
    const { ctx } = billsCtx();
    openBillEditor(ctx, RENT);
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(root), []);
    assert.equal(triggerFor(pickerNamed(root, "Direction")).disabled, true);
    assert.equal(triggerFor(pickerNamed(root, "Account")).disabled, true);
    assert.equal(triggerFor(pickerNamed(root, "Type")).disabled, false);
    assert.equal(triggerFor(pickerNamed(root, "Category")).disabled, false);
  });
});

// Bug fix (2026-09-23, Terry's exact repro: "why am i not able to edit this bill and assign a
// merchant. i edit it and save but its not updated" — an already-started bill, due weeks in the
// future). The "Changes to ... take effect from" field defaulted to the bill's own `nextDue`
// (almost always in the future), so the server genuinely saved a new term version, but
// `termsAt` (api/_shared/bills.js) never selected it — invisible until that future date, which
// looks exactly like "nothing was saved". Same bug BT-014-13 already fixed once for the Merchants
// page's own "Add as merchant" quick-link; this is the general bill editor every other term change
// goes through, which that earlier fix missed.
describe("Bug fix (2026-09-23): a bill's own term changes (category, merchant, amount, responsible person) take effect today, not on its next due date", () => {
  const EFFECTIVE_LABEL = "Changes to amount, merchant, category or responsible person take effect from";
  const effectiveFromInput = (root) => {
    const label = root.querySelectorAll("label").find((l) => l.textContent === EFFECTIVE_LABEL);
    return root.querySelector(`#${label.getAttribute("for")}`);
  };

  test("an already-started, overdue-but-future-due bill defaults 'take effect from' to TODAY, not its next due date, and a category change is sent effective today", async () => {
    const future = { ...RENT, id: "bill_electric", name: "Fictional Electric Repayment", billType: "utilities", nextDue: "2099-01-15", schedule: { freq: "monthly", interval: 1, startDate: "2026-01-01" } };
    const { ctx, state, calls } = billsCtx();
    state.bills = { workspaceId: "ws_1", status: "ready", error: null, data: { recurring: [future], summary: { overdue: 0, dueSoon: 0, next30Days: [] } } };
    openBillEditor(ctx, future);
    const root = dom.body.querySelector(".modal");
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(effectiveFromInput(root).value, today, "defaults to today, never the far-future next due date");
    chooseOption(pickerNamed(root, "Category"), "Housing");
    buttonNamed(root, "Save changes").click();
    await tick();
    assert.equal(calls.updated.length, 1);
    assert.equal(calls.updated[0].categoryId, "cat_home");
    assert.equal(calls.updated[0].effectiveFrom, today, "the change is submitted effective today, so it actually shows up immediately");
  });

  test("a bill that has not started yet defaults 'take effect from' to its own start date (the earliest the server allows), never today or its next due date", () => {
    const notStarted = { ...RENT, id: "bill_future_start", name: "Fictional future bill", nextDue: "2099-06-01", schedule: { freq: "monthly", interval: 1, startDate: "2099-01-15" } };
    const { ctx } = billsCtx();
    openBillEditor(ctx, notStarted);
    const root = dom.body.querySelector(".modal");
    assert.equal(effectiveFromInput(root).value, "2099-01-15");
  });

  test("a brand NEW bill's own hidden effective-from concept (not shown as a field) never blocks creation", () => {
    const { ctx, calls } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    // The field only appears when editing; a new bill has nothing to phase in.
    assert.equal(root.querySelectorAll("label").find((l) => l.textContent === EFFECTIVE_LABEL), undefined);
    root.querySelector('input[maxlength="80"]').value = "Fictional water bill";
    root.querySelector('input[inputmode="decimal"]').value = "40.00";
    buttonNamed(root, "Add bill").click();
    assert.equal(calls.created.length, 1);
  });
});

describe("BT-014-10/12 'Record next' has a plain-language tooltip that doesn't get clipped (Terry, 2026-09-17: \"i dont know what that means\"; then \"the tool tip ... is clipped\")", () => {
  test("explains itself to a screen reader via aria-describedby, distinct from its own accessible name", () => {
    const { ctx, state } = billsCtx();
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    // BT-015: Record next is inside the row's compact actions menu — open it first (a floating
    // overlay on document.body once open, never a child of view.element).
    view.element.querySelector(".actionsmenu__toggle").click();
    const recordNext = dom.body.querySelectorAll("button").find((b) => b.textContent === "Record next");
    assert.ok(recordNext, "the All bills table row has a Record next button");
    assert.ok(recordNext.closest(".tip-anchor"), "wrapped, not styled directly (the floating box lives elsewhere)");
    const describedById = recordNext.getAttribute("aria-describedby");
    assert.ok(describedById, "linked to a description for screen readers, not hover-only");
    const hidden = dom.body.querySelector(`#${describedById}`);
    assert.ok(hidden && hidden.classList.contains("sr-only"), "the same text is available off-screen");
    assert.match(hidden.textContent, /review.*record.*(entry|payment)/i);
    // Still keeps its own accessible name distinct from the description (name != description).
    assert.equal(recordNext.getAttribute("aria-label"), "Record next: Fictional rent");
  });

  test("the floating tooltip is a real, separately-positioned box on the body — not a CSS box tied to the table's own scrolling container, which is what clipped it (bug fix, 2026-09-17)", () => {
    const { ctx, state } = billsCtx();
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    view.element.querySelector(".actionsmenu__toggle").click();
    const recordNext = dom.body.querySelectorAll("button").find((b) => b.textContent === "Record next");
    const describedById = recordNext.getAttribute("aria-describedby");
    const expectedText = dom.body.querySelector(`#${describedById}`).textContent;
    assert.equal(dom.body.querySelectorAll(".floating-tip").length, 0, "nothing shown before hover/focus");
    recordNext.dispatchEvent(new DomEvent("focus", {}));
    const tips = dom.body.querySelectorAll(".floating-tip");
    assert.equal(tips.length, 1);
    assert.equal(tips[0].textContent, expectedText, "the same text hover/focus and screen readers both get");
    assert.equal(tips[0].getAttribute("aria-hidden"), "true", "announced once, through aria-describedby, never twice");
    // A direct child of body — not nested inside the table/table-wrap that clipped the old version.
    assert.equal(tips[0].parentNode, dom.body);
    recordNext.dispatchEvent(new DomEvent("blur", {}));
    assert.equal(dom.body.querySelectorAll(".floating-tip").length, 0, "removed once focus leaves");
  });
});

describe("Bills → Merchant regression (Terry, 2026-09-18): a typed-but-unlinked merchant name must never go blank", () => {
  // Before this fix, both the All-bills list row and the "Terms over time" history table only ever
  // read `payeeName` — so a bill with a real linked merchant showed it fine, but a bill that only
  // ever had a TYPED, unmatched name (no merchant record exists for it yet, `payeeDraftName`) showed
  // nothing at all in either place, even though the bill editor's own Merchant field already showed
  // it correctly. The name must still be shown; it must never be recovered/guessed from the bill's
  // own title.
  const DRAFT_BILL = {
    ...RENT, id: "bill_draft", name: "Fictional September internet", payeeId: null, payeeName: "",
    payeeDraftName: "Fictional Northstar Fiber",
    versions: [{ effectiveFrom: "2026-01-01", amount: "60.00", amountType: "fixed", categoryId: null, payeeId: null, payeeName: "", payeeDraftName: "Fictional Northstar Fiber", responsible: null }],
  };

  function draftCtx() {
    const { ctx, state } = billsCtx();
    state.bills = { workspaceId: "ws_1", status: "ready", error: null, data: { recurring: [DRAFT_BILL], summary: { overdue: 0, dueSoon: 0, next30Days: [] } } };
    return { ctx, state };
  }

  test("the All-bills list row shows the typed merchant name, never the bill's own title, and never blank", () => {
    const { ctx, state } = draftCtx();
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    // Scoped to the "All bills" table specifically (has a Schedule cell) — this fixture is also
    // overdue, so it legitimately appears a second time in the separate "Needs attention" table,
    // which never shows a merchant column at all and would otherwise be found first.
    const row = [...view.element.querySelectorAll("tr")].find((tr) => tr.textContent.includes("Fictional September internet") && tr.querySelector('td[data-label="Schedule"]'));
    assert.ok(row, "the bill's own row exists");
    assert.match(row.textContent, /Fictional Northstar Fiber/, "the typed name is shown");
  });

  test("'Terms over time' shows the typed merchant name for a version with no linked merchant, not an em dash", () => {
    const { ctx, state } = draftCtx();
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    // BT-015: History is inside the row's compact actions menu — open it first.
    view.element.querySelector(".actionsmenu__toggle").click();
    buttonNamed(dom.body, "History").click();
    const root = dom.body.querySelector(".modal");
    const merchantCell = root.querySelector('td[data-label="Merchant"]');
    assert.ok(merchantCell, "the Terms over time table has a Merchant cell");
    assert.equal(merchantCell.textContent, "Fictional Northstar Fiber");
  });

  test("once a real merchant is linked (payeeName set, payeeDraftName cleared), the real name is shown, not the draft", () => {
    const { ctx, state } = billsCtx();
    const linked = { ...RENT, id: "bill_linked", name: "Fictional September internet", payeeId: "p_1", payeeName: "Fictional Northstar Fiber", payeeDraftName: "" };
    state.bills = { workspaceId: "ws_1", status: "ready", error: null, data: { recurring: [linked], summary: { overdue: 0, dueSoon: 0, next30Days: [] } } };
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const row = [...view.element.querySelectorAll("tr")].find((tr) => tr.textContent.includes("Fictional September internet") && tr.querySelector('td[data-label="Schedule"]'));
    assert.match(row.textContent, /Fictional Northstar Fiber/);
  });

  test("a bill with neither a linked merchant nor a typed name shows no merchant line at all (nothing guessed from its own title)", () => {
    const { ctx, state } = billsCtx();
    const bare = { ...RENT, id: "bill_bare", name: "Fictional mystery charge", payeeId: null, payeeName: "", payeeDraftName: "" };
    state.bills = { workspaceId: "ws_1", status: "ready", error: null, data: { recurring: [bare], summary: { overdue: 0, dueSoon: 0, next30Days: [] } } };
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const row = [...view.element.querySelectorAll("tr")].find((tr) => tr.textContent.includes("Fictional mystery charge") && tr.querySelector('td[data-label="Schedule"]'));
    assert.doesNotMatch(row.textContent, /Fictional Northstar Fiber/);
  });
});

describe("BT-004-05 bills: review and record", () => {
  test("Merchant, Category and Status are pickers, and the payment is recorded with what was chosen", async () => {
    const { ctx, state, calls } = billsCtx();
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    view.element.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Review and record Fictional rent, due 2026-09-01").click();
    await tick();
    await tick();
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(root), []);
    assert.deepEqual(pickerLabels(root), ["Merchant", "Category", "Status"]);
    assert.equal(spoken(pickerNamed(root, "Status")), "Status: Pending. Choose.");
    chooseOption(pickerNamed(root, "Category"), "Housing");
    chooseOption(pickerNamed(root, "Status"), "Cleared");
    buttonNamed(root, "Record payment").click();
    await tick();
    assert.equal(calls.recorded.length, 1);
    assert.equal(calls.recorded[0].action, "record");
    assert.deepEqual({ status: calls.recorded[0].body.status, categoryId: calls.recorded[0].body.categoryId }, { status: "cleared", categoryId: "cat_home" });
  });
});

const panel = () => dom.body.querySelector(".cmdpick__panel");

describe("BT-014-09 + New account, from the bill editor's Account picker", () => {
  test("is pinned in the Account picker on a new bill, swaps the form in place without losing what was already typed, and selects the new account once created", async () => {
    const { ctx, calls } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    // Something already typed elsewhere in the bill, to prove it survives the round trip.
    root.querySelector("form").querySelector("input").value = "Fictional gym";
    const accountSelect = pickerNamed(root, "Account");
    triggerFor(accountSelect).click();
    const createButton = panel().querySelector(".cmdpick__create");
    assert.equal(createButton.querySelector(".cmdpick__createlabel").textContent, "New account");
    createButton.click();
    assert.equal(dom.body.querySelectorAll(".modal").length, 1, "still one dialog, not a second stacked one");
    assert.ok(root.querySelector("form") == null, "the bill form is swapped out while adding an account");
    const nameField = root.querySelectorAll("input")[0];
    nameField.value = "Fictional new wallet";
    const typeSelect = root.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.textContent === "Cash"));
    typeSelect.value = "cash";
    buttonNamed(root, "Create account").click();
    await tick();
    await tick();
    assert.equal(calls.accountsCreated.length, 1);
    assert.equal(calls.accountsCreated[0].name, "Fictional new wallet");
    assert.equal(calls.accountsCreated[0].type, "cash");
    // The bill form is back, with the earlier name still there, and the new account selected.
    assert.equal(root.querySelector("form").querySelector("input").value, "Fictional gym");
    assert.equal(pickerNamed(root, "Account").value, "acc_new");
  });

  test("cancelling the quick-add restores the bill form untouched, and nothing was created", () => {
    const { ctx, calls } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    const accountSelect = pickerNamed(root, "Account");
    triggerFor(accountSelect).click();
    panel().querySelector(".cmdpick__create").click();
    buttonNamed(root, "Cancel").click();
    assert.ok(root.querySelector("form"), "the bill form is back");
    assert.equal(pickerNamed(root, "Account").value, "acc_joint", "unchanged");
    assert.equal(calls.accountsCreated, undefined);
  });

  test("is not reachable when editing an existing bill (its account picker is disabled)", () => {
    const { ctx } = billsCtx();
    openBillEditor(ctx, RENT);
    const root = dom.body.querySelector(".modal");
    assert.equal(triggerFor(pickerNamed(root, "Account")).disabled, true);
  });
});
