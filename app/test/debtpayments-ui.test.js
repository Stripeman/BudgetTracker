// BT-020-01/02 (Terry, 2026-09-19): a loan or debt payment bill defaults to a transfer, pays into a
// real credit-card/loan account only, keeps its lender/merchant association separately, and
// recording its occurrence offers an explicit, reviewed principal/interest/fee breakdown before
// saving. Fictional data only. Layout and screen-reader output are checked in a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { pickerNamed, chooseOption, triggerFor, offeredOptions } from "./pickerassert.js";
import { createView, openBillEditor } from "../js/ui/views/bills.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const fire = (node, type) => node.dispatchEvent(new DomEvent(type, { bubbles: true }));
const labelled = (root, text) => {
  const labels = root.querySelectorAll("label");
  const l = labels.find((x) => x.textContent === text);
  return l ? root.querySelector(`#${l.getAttribute("for")}`) : undefined;
};
// Whether a field is genuinely visible: its label exists AND no ancestor up to `root` is hidden —
// never a bare existence check, since a hidden field's label and control still exist in the DOM
// (only their container's `hidden` attribute changes). Returns a plain boolean, never a DOM node, so
// a failed assertion never tries to inspect a circular DOM structure.
const fieldVisible = (root, text) => {
  const control = labelled(root, text);
  if (!control) return false;
  let n = control;
  while (n && n !== root) {
    if (n.hidden) return false;
    n = n.parentNode;
  }
  return true;
};

function billsCtx() {
  const calls = { created: [], recorded: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household" }],
    preferences: null,
    accounts: ready({ accounts: [
      { id: "acc_checking", name: "Fictional checking", currency: "EUR", access: "own", status: "open", capabilities: ["create"], icon: "bank", liability: false },
      { id: "acc_savings", name: "Fictional savings", currency: "EUR", access: "own", status: "open", capabilities: ["create"], icon: "piggy-bank", liability: false },
      { id: "acc_card", name: "Fictional card", currency: "EUR", access: "own", status: "open", capabilities: ["create"], icon: "credit-card", liability: true },
      { id: "acc_loan", name: "Fictional loan", currency: "EUR", access: "own", status: "open", capabilities: ["create"], icon: "bank", liability: true },
    ] }),
    categories: ready({ categories: [] }),
    payees: ready({ payees: [] }),
    bills: ready({ recurring: [], summary: { overdue: 0, dueSoon: 0, next30Days: [] } }),
  };
  const api = {
    people: async () => ({ options: [] }),
    createBill: async (ws, body) => { calls.created.push(body); return {}; },
    billDraft: async (ws, id, occurrence) => ({ draft: calls.draftOverride || { amountIsEstimate: false, amount: "150.00", date: occurrence, categoryId: null, payeeId: null, payeeName: null, currency: "EUR", overdue: false, billType: "debt-payment", destinationBalance: "-1000.00" } }),
    billAction: async (ws, action, body) => { calls.recorded.push({ action, body }); return {}; },
  };
  const store = { getState: () => state, actions: { write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; }, refreshBills: async () => {} } };
  return { ctx: { store, api }, state, calls };
}

describe("BT-020-01 the bill editor: a loan or debt payment bill", () => {
  test("defaults to a transfer, labels its two accounts Pay from / Apply payment to, and only offers real debt accounts as the destination", async () => {
    const { ctx } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    chooseOption(pickerNamed(root, "Type"), "Loan or debt payment");
    assert.equal(pickerNamed(root, "Direction").value, "transfer", "direction follows the bill type, discoverably");
    assert.ok(labelled(root, "Pay from"), "the source account field is now labelled Pay from");
    assert.ok(labelled(root, "Apply payment to"), "the destination account field is now labelled Apply payment to");
    const offered = offeredOptions(pickerNamed(root, "Apply payment to"));
    assert.deepEqual(offered.sort(), ["Fictional card (EUR)", "Fictional loan (EUR)"].sort(), "only real debt accounts, never a plain asset account");
  });

  test("keeps the Merchant (lender) field even though it is a transfer; Category and Responsible person stay hidden", () => {
    const { ctx } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    chooseOption(pickerNamed(root, "Type"), "Loan or debt payment");
    assert.equal(fieldVisible(root, "Merchant"), true, "the lender association stays available, separately from the destination account");
    assert.equal(fieldVisible(root, "Category"), false);
    assert.equal(fieldVisible(root, "Responsible person"), false);
  });

  test("an ordinary transfer (a savings transfer, say) still hides the Merchant field, exactly as before", () => {
    const { ctx } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    chooseOption(pickerNamed(root, "Type"), "Savings transfer");
    assert.equal(pickerNamed(root, "Direction").value, "transfer");
    assert.equal(fieldVisible(root, "Merchant"), false, "a plain transfer has no merchant, unchanged");
  });

  test("submitting a new debt-payment bill sends toAccountId and, once chosen, keeps sending no category or responsible person", async () => {
    const { ctx, calls } = billsCtx();
    openBillEditor(ctx);
    const root = dom.body.querySelector(".modal");
    chooseOption(pickerNamed(root, "Type"), "Loan or debt payment");
    chooseOption(pickerNamed(root, "Apply payment to"), "Fictional card (EUR)");
    root.querySelector('input[maxlength="80"]').value = "Card payment";
    root.querySelector('input[inputmode="decimal"]').value = "150.00";
    buttonNamed(root, "Add bill").click();
    await tick();
    assert.equal(calls.created.length, 1);
    const body = calls.created[0];
    assert.equal(body.billType, "debt-payment");
    assert.equal(body.kind, "transfer");
    assert.equal(body.toAccountId, "acc_card");
    assert.equal(body.categoryId, undefined);
    assert.equal(body.responsibleRef, undefined);
  });
});

describe("BT-020-02 recording a debt-payment occurrence: an explicit, reviewed principal/interest/fee breakdown", () => {
  const DEBT_BILL = {
    id: "bill_card", name: "Fictional card payment", billType: "debt-payment", kind: "transfer", accountId: "acc_checking", accountName: "Fictional checking",
    toAccountId: "acc_card", toAccountName: "Fictional card", amount: "150.00", currency: "EUR", amountType: "fixed",
    schedule: { freq: "monthly", interval: 1, startDate: "2026-09-01" }, reminderDays: 3, nextDue: "2026-09-20", revision: 1,
    overdue: ["2026-09-20"], reminders: [], canRecord: true, canEdit: true, inactiveReason: null, ended: false, pausedNow: false, versions: [], skips: [], pauses: [], history: [],
  };

  function openRecordDialog() {
    const { ctx, state, calls } = billsCtx();
    state.bills = { workspaceId: "ws_1", status: "ready", error: null, data: { recurring: [DEBT_BILL], summary: { overdue: 0, dueSoon: 0, next30Days: [] } } };
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    view.element.querySelectorAll("button").find((b) => (b.getAttribute("aria-label") || "").startsWith("Review and record")).click();
    return { ctx, calls };
  }

  test("offers an interest and a fee field, with a live preview of the effect on the debt account", async () => {
    openRecordDialog();
    await tick();
    await tick();
    const root = dom.body.querySelector(".modal");
    // The interest and fee breakdown inputs share the "0.00" placeholder; identify them via their
    // own field labels instead.
    const interestField = root.querySelectorAll("label").find((l) => /interest not already/.test(l.textContent));
    const feeField = root.querySelectorAll("label").find((l) => /a fee not already/.test(l.textContent));
    assert.ok(interestField, "an interest breakdown field is offered");
    assert.ok(feeField, "a fee breakdown field is offered");
    const interestInput = root.querySelector(`#${interestField.getAttribute("for")}`);
    interestInput.value = "30.00";
    fire(interestInput, "input");
    const preview = root.querySelectorAll("p").find((p) => /reduces the balance owed/.test(p.textContent));
    assert.ok(preview, "a live allocation preview is shown");
    assert.match(preview.textContent, /120\.00 reduces the balance owed/);
    assert.match(preview.textContent, /30\.00 recorded as interest/);
    assert.match(preview.textContent, /-1000\.00 → -880\.00/, "the destination balance preview follows the entered breakdown");
  });

  test("recording sends interestAmount/feeAmount only when entered", async () => {
    const { calls } = openRecordDialog();
    await tick();
    await tick();
    const root = dom.body.querySelector(".modal");
    const interestField = root.querySelectorAll("label").find((l) => /interest not already/.test(l.textContent));
    root.querySelector(`#${interestField.getAttribute("for")}`).value = "30.00";
    buttonNamed(root, "Record payment").click();
    await tick();
    assert.equal(calls.recorded.length, 1);
    assert.equal(calls.recorded[0].body.interestAmount, "30.00");
    assert.equal(calls.recorded[0].body.feeAmount, undefined);
  });

  test("a plain (non-debt-payment) transfer bill's record dialog offers no breakdown fields", async () => {
    const { ctx, state } = billsCtx();
    const plain = { ...DEBT_BILL, id: "bill_savings", billType: "savings", name: "Fictional savings transfer" };
    state.bills = { workspaceId: "ws_1", status: "ready", error: null, data: { recurring: [plain], summary: { overdue: 0, dueSoon: 0, next30Days: [] } } };
    ctx.api.billDraft = async () => ({ draft: { amountIsEstimate: false, amount: "150.00", date: "2026-09-20", categoryId: null, payeeId: null, payeeName: null, currency: "EUR", overdue: false, billType: "savings", destinationBalance: null } });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    view.element.querySelectorAll("button").find((b) => (b.getAttribute("aria-label") || "").startsWith("Review and record")).click();
    await tick();
    await tick();
    const root = dom.body.querySelector(".modal");
    assert.equal(root.querySelectorAll("label").filter((l) => /interest not already|a fee not already/.test(l.textContent)).length, 0);
  });
});
