// Financial-accuracy review (FIN-R1, R2, R9, R11, R14): the interface never offers what the server
// now refuses, and says why. Locked reversal fields, the pair-delete note, bills that cannot take
// payments, transfers in the 30-day card and backdated plan changes. Real browser rendering and
// screen-reader output are not covered here.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { reversalLock, linkedDeleteNote, openQuickEntry } from "../js/ui/views/transactions.js";
import { inactiveText, next30Meta } from "../js/ui/views/bills.js";
import { backdateProblem } from "../js/ui/views/planning.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("FIN-R1/R2 reversal pairs in the transaction views", () => {
  test("both halves of a reversal explain the lock; other entries have none", () => {
    assert.match(reversalLock({ reversedBy: "txn_r" }), /has been reversed/);
    assert.match(reversalLock({ links: { reverses: "txn_o" } }), /is a reversal/);
    assert.equal(reversalLock({ links: {} }), null);
    assert.match(linkedDeleteNote({ reversedBy: "txn_r" }), /reversal is deleted with it/);
    assert.match(linkedDeleteNote({ links: { reverses: "txn_o" } }), /entry it reverses is deleted with it/);
    assert.equal(linkedDeleteNote({ links: {} }), null);
  });

  test("editing a reversed entry locks amount, category, date, type and merchant and sends only the note", async () => {
    const ws = "ws_1";
    const account = { id: "acc_1", name: "Joint", currency: "EUR", access: "shared", capabilities: ["create"], status: "open" };
    const state = {
      selectedWorkspaceId: ws,
      accounts: { workspaceId: ws, data: { accounts: [account] } },
      categories: { workspaceId: ws, data: { categories: [{ id: "cat_g", name: "Groceries" }] } },
      payees: { workspaceId: ws, data: { payees: [] } },
    };
    const sent = [];
    const ctx = {
      store: { getState: () => state, actions: { write: async (fn) => { await fn(ws); return { ok: true }; } } },
      api: { updateTransaction: async (id, body) => { sent.push(body); return {}; } },
    };
    const transaction = {
      id: "txn_o", revision: 2, accountId: "acc_1", kind: "expense", amount: "-100.00", currency: "EUR", date: "2026-09-12",
      categoryId: "cat_g", payeeId: null, tags: [], notes: "", status: "pending", reversedBy: "txn_r", links: {},
    };
    openQuickEntry(ctx, { transaction });
    const dialog = document.body.querySelector(".modal") || document.body;
    const note = dialog.querySelector(".reversal-lock");
    assert.ok(note, "the lock is explained in the form");
    const inputs = dialog.querySelectorAll("input");
    const amount = inputs.find((i) => i.getAttribute("inputmode") === "decimal" && i.getAttribute("value") === "100.00");
    const date = inputs.find((i) => i.getAttribute("type") === "date" && i.getAttribute("value") === "2026-09-12");
    const selects = dialog.querySelectorAll("select");
    const kind = selects.find((s) => s.querySelectorAll("option").some((o) => o.getAttribute("value") === "refund"));
    const category = selects.find((s) => s.querySelectorAll("option").some((o) => o.getAttribute("value") === "cat_g"));
    const status = selects.find((s) => s.querySelectorAll("option").some((o) => o.getAttribute("value") === "reconciled"));
    assert.equal(amount.disabled, true, "amount");
    assert.equal(date.disabled, true, "date");
    assert.equal(kind.disabled, true, "type");
    assert.equal(category.disabled, true, "category");
    assert.equal(status.disabled, false, "status stays editable");
    // The DOM double does not reflect value attributes or selected options into .value as a browser
    // does, so the values a browser would show are set here.
    Object.assign(amount, { value: "100.00" });
    Object.assign(date, { value: "2026-09-12" });
    Object.assign(kind, { value: "expense" });
    Object.assign(category, { value: "cat_g" });
    Object.assign(status, { value: "pending" });
    const notes = dialog.querySelector("textarea");
    notes.value = "Charged twice";
    const save = dialog.querySelectorAll("button").find((b) => b.textContent === "Save changes");
    save.click();
    await tick();
    assert.deepEqual(sent, [{ transactionId: "txn_o", revision: 2, notes: "Charged twice" }]);
  });
});

describe("FIN-R9/R11 bills page", () => {
  test("a bill that cannot take payments says why and what to do", () => {
    assert.match(inactiveText({ inactiveReason: "account_closed", accountName: "Joint" }), /^Joint is closed.*Reopen the account or end the bill\.$/);
    assert.match(inactiveText({ inactiveReason: "destination_closed", toAccountName: "Savings" }), /^Savings is closed/);
    assert.match(inactiveText({ inactiveReason: "destination_missing" }), /removed/);
    assert.equal(inactiveText({ inactiveReason: null }), null);
  });

  test("transfers between your own accounts are mentioned apart from money in and out", () => {
    const fmt = (v, c) => `${c} ${v}`;
    assert.equal(next30Meta({ currency: "EUR", transfers: "500.00" }, fmt), "Bills and income due in the next 30 days. Transfers between your own accounts: EUR 500.00.");
    assert.equal(next30Meta({ currency: "EUR", transfers: "0.00" }, fmt), "Bills and income due in the next 30 days.");
    assert.equal(next30Meta({ currency: "JPY", transfers: "0" }, fmt), "Bills and income due in the next 30 days.");
  });
});

describe("FIN-R14 backdated plan changes", () => {
  test("a date before the current period needs the confirmation; the current period or later does not", () => {
    assert.match(backdateProblem("2026-08-01", "2026-09-01", false), /finished/);
    assert.equal(backdateProblem("2026-08-01", "2026-09-01", true), null);
    assert.equal(backdateProblem("2026-09-01", "2026-09-01", false), null);
    assert.equal(backdateProblem("2026-10-01", "2026-09-01", false), null);
    assert.equal(backdateProblem("", "2026-09-01", false), null, "no date means the current period");
  });
});
