// BT-004-05 — the Bills view's dropdowns are TaskTracker's command picker: the bill editor (type,
// direction, account, destination, amount kind, how often, unit, category, responsible person) and the
// review-and-record dialog (category, status). A value the view sets from code — the direction that
// follows the bill type, the people loaded after the dialog opens — shows in the pickers; locked
// fields have disabled triggers; what is chosen through the pickers is what is saved. Fictional data
// only. Layout and screen-reader output are checked in a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, chooseOption, chooseByKeyboard, offeredOptions, triggerFor } from "./pickerassert.js";
import { createView, openBillEditor } from "../js/ui/views/bills.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const spoken = (select) => triggerFor(select).getAttribute("aria-label");
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
    billDraft: async () => ({ draft: { amountIsEstimate: false, amount: "950.00", date: "2026-09-01", categoryId: null, payeeId: null, payeeName: null, currency: "EUR", overdue: true } }),
    billAction: async (ws, action, body) => { calls.recorded.push({ action, body }); return {}; },
  };
  const store = { getState: () => state, actions: { write: async (fn) => { await fn("ws_1"); return { ok: true }; }, refreshBills: async () => {} } };
  return { ctx: { store, api }, state, calls };
}

describe("BT-004-05 bills: the bill editor", () => {
  test("every dropdown is a picker; the short lists have no search box; people load into Responsible person", async () => {
    const { ctx } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(root), []);
    assert.deepEqual(pickerLabels(root), ["Type", "Direction", "Account", "To account", "Amount is", "Repeats", "Unit", "Category", "Responsible person"]);
    assert.equal(spoken(pickerNamed(root, "Type")), "Type: Rent or mortgage. Choose.");
    assert.equal(spoken(pickerNamed(root, "Direction")), "Direction: Money out. Choose.");
    assert.equal(spoken(pickerNamed(root, "Account")), "Account: Fictional joint (EUR). Search and choose.");
    assert.equal(spoken(pickerNamed(root, "Amount is")), "Amount is: Always the same. Choose.");
    assert.equal(spoken(pickerNamed(root, "Repeats")), "Repeats: Monthly. Choose.");
    assert.equal(spoken(pickerNamed(root, "Unit")), "Unit: months. Choose.");
    assert.equal(spoken(pickerNamed(root, "Category")), "Category: Uncategorized. Search and choose.");
    assert.equal(spoken(pickerNamed(root, "Responsible person")), "Responsible person: Nobody in particular. Search and choose.");
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

describe("BT-004-05 bills: review and record", () => {
  test("Category and Status are pickers, and the payment is recorded with what was chosen", async () => {
    const { ctx, state, calls } = billsCtx();
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    view.element.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Review and record Fictional rent, due 2026-09-01").click();
    await tick();
    await tick();
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(root), []);
    assert.deepEqual(pickerLabels(root), ["Category", "Status"]);
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
