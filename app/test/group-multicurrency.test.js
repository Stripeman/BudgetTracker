// BT-009-13 frontend: the Add/correct shared-expense dialog's original-currency amount entry,
// exchange rate/source/date, and — the specific regression Terry found and asked to be fixed at
// its root — a correction that does not touch the amount must NEVER resubmit it at all, so an
// already-converted expense can never be silently converted a second time. All data is fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { openGroupExpense } from "../js/ui/views/group.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const type = (node, value) => { node.value = value; node.dispatchEvent(new DomEvent("input", { bubbles: true })); };
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const labelled = (root, text) => { const label = root.querySelectorAll("label").find((l) => l.textContent === text); return root.querySelector(`#${label.getAttribute("for")}`); };
const fieldInput = (root, labelText) => labelled(root, labelText);

function fakeCtx({ expenses = [] } = {}) {
  const creates = [];
  const updates = [];
  const people = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Trip", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: { currency: "EUR", permissions: { canAdd: true, selfRef: "member:a", role: "owner" }, participants: people, expenses, settlements: [], balances: [] } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
  };
  const api = {
    createGroupExpense: async (ws, body, key) => { creates.push(body); return { expense: {} }; },
    updateGroupExpense: async (ws, body) => { updates.push(body); return { expense: {} }; },
  };
  const store = {
    getState: () => state,
    actions: { write: async (fn, refresh) => { const result = await fn("ws_1"); return { ok: true, result }; }, refreshGroup: async () => {} },
  };
  return { ctx: { store, api }, creates, updates, state };
}

// A USD 100.00 expense converted to EUR 92.00 at 0.92, split equally between Alice and Bob.
const foreignExpense = (payers) => ({
  id: "exp_1", description: "Fictional hotel", date: "2026-09-10", categoryId: null, notes: "",
  currency: "EUR", amount: "92.00", amountMinor: 9200,
  original: { amount: "100.00", amountMinor: 10000, currency: "USD", rate: "0.92", rateSource: "manual", rateDate: "2026-09-10" },
  payers, split: { method: "equal", lines: [{ ref: "member:a" }, { ref: "member:b" }] },
  shares: [{ ref: "member:a", amount: "46.00" }, { ref: "member:b", amount: "46.00" }],
  revision: 1, canEdit: true, canVoid: true, myLedger: null, amendmentCount: 0,
});

describe("BT-009-13 the shared-expense dialog: original-currency entry and the correction contract", () => {
  test("a description-only correction on a foreign-currency expense never resubmits the amount, currency or rate at all — the fix for the double-conversion regression", async () => {
    const { ctx, updates } = fakeCtx();
    const expense = foreignExpense([{ ref: "member:a", amount: "92.00" }]);
    const dialog = openGroupExpense(ctx, { expense }).element;
    // The amount field starts from the ORIGINAL currency figure, never the converted one.
    assert.equal(fieldInput(dialog, "Amount (USD)").value, "100.00");
    type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Fictional hotel (corrected name)");
    type(dialog.querySelector('input[placeholder="Why is this being corrected?"]'), "Fixed a typo in the name");
    buttonNamed(dialog, "Save correction").click();
    await tick();
    assert.equal(updates.length, 1);
    const body = updates[0];
    assert.equal(body.description, "Fictional hotel (corrected name)");
    for (const key of ["amount", "currency", "rate", "rateSource", "rateDate"]) {
      assert.equal(key in body, false, `${key} must not be resubmitted when nothing about the money changed`);
    }
  });

  test("changing the amount on a foreign-currency expense resubmits it in its OWN original currency, reusing the stored rate, and converts correctly (not double-converted)", async () => {
    const { ctx, updates } = fakeCtx();
    const expense = foreignExpense([{ ref: "member:a", amount: "92.00" }]);
    const dialog = openGroupExpense(ctx, { expense }).element;
    type(fieldInput(dialog, "Amount (USD)"), "110.00");
    type(dialog.querySelector('input[placeholder="Why is this being corrected?"]'), "Actually paid 110");
    buttonNamed(dialog, "Save correction").click();
    await tick();
    assert.equal(updates.length, 1);
    const body = updates[0];
    assert.equal(body.amount, "110.00", "sent in USD, the expense's own currency — never re-interpreted as EUR");
    assert.equal(body.rate, "0.92", "the stored rate is reused when not explicitly changed");
    assert.equal("currency" in body, false, "the currency itself is never resent on a correction — it can never change");
    // A single payer needs no explicit amount — the server fills in the full (converted) total,
    // 110.00 USD at 0.92 = 101.20 EUR.
    assert.deepEqual(body.payers, [{ ref: "member:a" }]);
  });

  test("a description-only correction with MULTIPLE payers still validates and saves — the amount is pinned to the record's own stored total, not recomputed", async () => {
    const { ctx, updates } = fakeCtx();
    const expense = foreignExpense([{ ref: "member:a", amount: "46.00" }, { ref: "member:b", amount: "46.00" }]);
    const dialog = openGroupExpense(ctx, { expense }).element;
    type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Fictional hotel, corrected");
    type(dialog.querySelector('input[placeholder="Why is this being corrected?"]'), "Fixed the name");
    assert.equal(dialog.querySelector(".modal__error").textContent, "", "no validation error is shown before saving");
    buttonNamed(dialog, "Save correction").click();
    await tick();
    assert.equal(updates.length, 1, "the correction saved — the payer amounts still add up to the unchanged total");
    assert.deepEqual(updates[0].payers.map((p) => p.amount), ["46.00", "46.00"]);
    assert.equal("amount" in updates[0], false);
  });

  test("a plain (non-foreign) expense's correction is unaffected: changing only the description still omits amount, and changing the amount still sends it in the reporting currency", async () => {
    const { ctx, updates } = fakeCtx();
    const plain = { id: "exp_2", description: "Fictional groceries", date: "2026-09-11", categoryId: null, notes: "",
      currency: "EUR", amount: "40.00", amountMinor: 4000, original: null,
      payers: [{ ref: "member:a", amount: "40.00" }], split: { method: "equal", lines: [{ ref: "member:a" }, { ref: "member:b" }] },
      shares: [{ ref: "member:a", amount: "20.00" }, { ref: "member:b", amount: "20.00" }],
      revision: 1, canEdit: true, canVoid: true, myLedger: null, amendmentCount: 0 };
    const dialog = openGroupExpense(ctx, { expense: plain }).element;
    assert.equal(fieldInput(dialog, "Amount (EUR)").value, "40.00");
    type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Fictional groceries, corrected");
    type(dialog.querySelector('input[placeholder="Why is this being corrected?"]'), "Fixed the name");
    buttonNamed(dialog, "Save correction").click();
    await tick();
    assert.equal(updates.length, 1);
    assert.equal("amount" in updates[0], false, "an unrelated correction never resubmits the amount, even for a plain expense");

    dom.teardown();
    dom = installDom();
    const second = fakeCtx();
    const dialog2 = openGroupExpense(second.ctx, { expense: plain }).element;
    type(fieldInput(dialog2, "Amount (EUR)"), "45.00");
    type(dialog2.querySelector('input[placeholder="Why is this being corrected?"]'), "Actually 45");
    buttonNamed(dialog2, "Save correction").click();
    await tick();
    assert.equal(second.updates.length, 1);
    assert.equal(second.updates[0].amount, "45.00");
    assert.equal("currency" in second.updates[0], false);
  });

  test("a new expense entered in a foreign currency sends the original amount, currency, rate, source and date, with payer/split amounts in the reporting currency", async () => {
    const { ctx, creates } = fakeCtx();
    const dialog = openGroupExpense(ctx).element;
    type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Fictional souvenirs");
    // The Currency control is TaskTracker's command picker (BT-004-05) over a native select that
    // "stays the state" (selectpicker.js) — found by its own options, since its label points at
    // the picker's trigger, not the hidden select itself.
    const currencySelect = dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.value === "USD"));
    currencySelect.value = "USD";
    currencySelect.dispatchEvent(new DomEvent("change", { bubbles: true }));
    type(fieldInput(dialog, "Amount (USD)"), "50.00");
    type(dialog.querySelector('input[placeholder="e.g. 0.92"]'), "0.90");
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(creates.length, 1);
    const body = creates[0];
    assert.equal(body.amount, "50.00");
    assert.equal(body.currency, "USD");
    assert.equal(body.rate, "0.90");
    assert.equal(body.rateSource, "manual");
    // 50.00 USD at 0.90 = 45.00 EUR, the single payer's implicit amount.
    assert.deepEqual(body.payers, [{ ref: "member:a" }]);
  });
});
