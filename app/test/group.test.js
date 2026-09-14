// BT-009 shared expenses in the browser code: the dialog's allocation preview is the server's own
// calculation (a generated mirror test against api/_shared/groups.js), the Add expense dialog shows
// each share, the rounding adjustment and every problem inside the dialog before anything is sent,
// the nav offers Shared expenses by workspace kind, and a group without accounts is led to Shared
// expenses instead of "add an account". All names are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installDom, DomEvent } from "./domdouble.js";
import * as split from "../js/core/split.js";
import { navRoutes } from "../js/core/router.js";
import { openGroupExpense, balanceLabel } from "../js/ui/views/group.js";
import { addEntriesBlocked } from "../js/ui/views/transactions.js";
import { createView as createDashboard } from "../js/ui/views/dashboard.js";
import { formatAmount } from "../js/core/format.js";

const require = createRequire(import.meta.url);
const groups = require("../../api/_shared/groups.js");

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const type = (node, value) => { node.value = value; node.dispatchEvent(new DomEvent("input", { bubbles: true })); };
const choose = (node, value) => { node.value = value; node.dispatchEvent(new DomEvent("change", { bubbles: true })); };
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);

describe("BT-009-02 the dialog's allocation is the server's allocation", () => {
  test("computeShares matches api/_shared/groups.js on generated cases of every method", () => {
    let seed = 11;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 2000; run += 1) {
      const total = 1 + rnd(10000000);
      const count = 1 + rnd(8);
      const refs = Array.from({ length: count }, (_, i) => `member:m${i}`);
      const method = ["equal", "shares", "percentages", "amounts"][rnd(4)];
      let lines;
      if (method === "equal") lines = refs.map((ref) => ({ ref, value: null }));
      else if (method === "shares") lines = refs.map((ref) => ({ ref, value: 1 + rnd(20) }));
      else {
        // A random partition of 100% (in 0.0001 % units) or of the total, every part positive.
        const whole = method === "percentages" ? split.HUNDRED_PERCENT : total;
        if (whole < count) continue;
        const cuts = new Set();
        while (cuts.size < count - 1) cuts.add(1 + rnd(whole - 1));
        const edges = [0, ...[...cuts].sort((a, b) => a - b), whole];
        const parts = edges.slice(1).map((e, i) => e - edges[i]);
        lines = refs.map((ref, i) => ({ ref, value: method === "percentages" ? split.percentText(parts[i]) : parts[i] }));
      }
      const s = { method, lines };
      assert.deepEqual(split.computeShares(total, s), groups.computeShares(total, s), `run ${run} ${method}`);
    }
  });

  test("the preview refuses what the server refuses, in the same words", () => {
    const lines = [{ ref: "member:a", name: "Alice", value: "50" }, { ref: "member:b", name: "Bob", value: "40" }];
    const pv = split.previewSplit({ amount: "100.00", currency: "EUR", method: "percentages", lines, payers: [{ ref: "member:a", name: "Alice", amount: "" }] });
    assert.equal(pv.ok, false);
    let serverMessage = null;
    try { groups.normalizeSplit({ method: "percentages", lines: lines.map(({ ref, value }) => ({ ref, value })) }, 10000, "EUR", (r) => r); } catch (e) { serverMessage = e.message; }
    assert.deepEqual(pv.errors, [serverMessage]);
    const amounts = split.previewSplit({ amount: "100.00", currency: "EUR", method: "amounts", lines: [{ ref: "member:a", name: "Alice", value: "60.00" }, { ref: "member:b", name: "Bob", value: "30.00" }], payers: [{ ref: "member:a", name: "Alice", amount: "" }] });
    assert.deepEqual(amounts.errors, ["The amounts add up to 90.00 but the expense is 100.00."]);
    assert.equal(amounts.leftMinor, 1000);
    const payers = split.previewSplit({ amount: "120.00", currency: "EUR", method: "equal", lines: [{ ref: "member:a", name: "Alice" }], payers: [{ ref: "member:a", name: "Alice", amount: "80.00" }, { ref: "member:b", name: "Bob", amount: "30.00" }] });
    assert.deepEqual(payers.errors, ["The amounts paid add up to 110.00 but the expense is 120.00."]);
    assert.equal(split.previewSplit({ amount: "100.001", currency: "EUR", method: "equal", lines, payers: [] }).errors[0], "Enter the amount, for example 12.50 or 10+2.50.");
    assert.equal(split.parseAmount("1500", "JPY"), 1500);
    assert.equal(split.parseAmount("15.5", "JPY"), null, "no decimals in yen");
  });
});

function fakeCtx({ accounts = [], participants } = {}) {
  const calls = [];
  const people = participants || [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
    { ref: "contact:d", name: "Dana", type: "contact", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Dinner Club", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: { currency: "EUR", permissions: { canAdd: true, selfRef: "member:a", role: "owner" }, participants: people, expenses: [], settlements: [], balances: [] } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts, totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
  };
  const api = {
    createGroupExpense: async (ws, body, key) => { calls.push({ ws, body, key }); return { expense: {} }; },
  };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn, refresh) => { const result = await fn("ws_1"); calls.refresh = refresh; return { ok: true, result }; },
      refreshGroup: async () => {}, refreshTransactions: async () => {}, refreshBills: async () => {}, refreshForecast: async () => {},
    },
  };
  return { ctx: { store, api, state }, calls, state };
}

const shareTexts = (dialog) => dialog.querySelectorAll(".split-row__share").map((n) => n.textContent);
// The own-account checkbox, found through its visible label.
const ledgerBoxOf = (dialog) => {
  const label = dialog.querySelectorAll("label").find((l) => l.textContent === "Also record my part on my own account");
  return dialog.querySelector(`#${label.getAttribute("for")}`);
};
const shareRow = (dialog, name) => dialog.querySelectorAll(".split-row").find((r) => r.querySelector(".split-row__share") && r.querySelector("label").textContent.startsWith(name));

describe("BT-009-10 Add shared expense dialog", () => {
  test("a live preview shows 33.34 / 33.33 / 33.33 and names who gets the rounding cent", () => {
    const { ctx } = fakeCtx();
    const dialog = openGroupExpense(ctx).element;
    type(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "100");
    assert.deepEqual(shareTexts(dialog), ["EUR 33.34 (rounded up)", "EUR 33.33", "EUR 33.33"]);
    assert.equal(dialog.querySelector(".split-preview").textContent, "Rounding: Alice gets EUR 0.01 more, so the shares add up to exactly EUR 100.00.");
    assert.equal(dialog.querySelector(".split-problems").textContent, "");
    // The inline calculator works here too.
    type(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "90+30");
    assert.deepEqual(shareTexts(dialog), ["EUR 40.00", "EUR 40.00", "EUR 40.00"]);
    assert.match(dialog.textContent, /= 120\.00 EUR/);
    assert.equal(dialog.querySelector(".split-preview").textContent, "The shares add up to exactly EUR 120.00.");
  });

  test("percentages that do not make 100% are explained in the dialog and nothing is sent", async () => {
    const { ctx, calls } = fakeCtx();
    const dialog = openGroupExpense(ctx).element;
    type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Fictional museum");
    type(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "100.00");
    choose(dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.textContent === "By percentages")), "percentages");
    shareRow(dialog, "Dana").querySelector('input[type="checkbox"]').click();
    type(dialog.querySelector('input[aria-label="Percent for Alice"]'), "50");
    type(dialog.querySelector('input[aria-label="Percent for Bob"]'), "40");
    assert.equal(dialog.querySelector(".split-problems").textContent, "The percentages add up to 90%. They must add up to exactly 100%.");
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(calls.length, 0);
    assert.equal(dialog.querySelector(".modal__error").textContent, "The percentages add up to 90%. They must add up to exactly 100%.");
    type(dialog.querySelector('input[aria-label="Percent for Bob"]'), "50");
    assert.deepEqual(shareTexts(dialog), ["EUR 50.00", "EUR 50.00", ""]);
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.split, { method: "percentages", lines: [{ ref: "member:a", value: "50" }, { ref: "member:b", value: "50" }] });
  });

  test("an empty description is refused in the dialog; a valid expense is sent exactly once with one key", async () => {
    const { ctx, calls } = fakeCtx();
    const modal = openGroupExpense(ctx);
    const dialog = modal.element;
    type(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "100");
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(calls.length, 0);
    const description = dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]');
    assert.equal(description.getAttribute("aria-invalid"), "true");
    assert.match(dialog.querySelector(".modal__error").textContent, /Describe the expense/);
    type(description, "  Dinner at the harbour ");
    dialog.querySelector('input[type="date"]').value = "2026-09-12";
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, {
      description: "Dinner at the harbour", date: "2026-09-12", amount: "100.00", notes: "",
      payers: [{ ref: "member:a" }],
      split: { method: "equal", lines: [{ ref: "member:a" }, { ref: "member:b" }, { ref: "contact:d" }] },
    });
    assert.match(calls[0].key, /^k-[0-9a-f]{32}$/);
    assert.deepEqual(calls.refresh, ["group"], "no account involved, so only the group is re-read");
    assert.equal(document.body.querySelector(".modal"), null, "closed");
  });

  test("several payers must add up; the own-account choice appears only for a payer with an account in that currency", async () => {
    const { ctx, calls } = fakeCtx({ accounts: [
      { id: "acc_cash", name: "Alice Cash", currency: "EUR", status: "open", visibility: "private", ownedBySelf: true, capabilities: ["create"] },
      { id: "acc_usd", name: "Alice Dollars", currency: "USD", status: "open", visibility: "private", ownedBySelf: true, capabilities: ["create"] },
    ] });
    const dialog = openGroupExpense(ctx).element;
    type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Cabin");
    type(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "120.00");
    const ledgerBox = ledgerBoxOf(dialog);
    const ledgerField = ledgerBox.closest("fieldset");
    assert.equal(ledgerField.hidden, false, "Alice pays and has a EUR account");
    const accountSelect = ledgerField.querySelector("select");
    assert.deepEqual(accountSelect.querySelectorAll("option").map((o) => o.textContent), ["Alice Cash (EUR)"], "only accounts in the expense currency");
    // Bob pays too.
    const payerRows = dialog.querySelectorAll(".split-row").filter((r) => !r.querySelector(".split-row__share"));
    payerRows[1].querySelector('input[type="checkbox"]').click();
    type(dialog.querySelector('input[aria-label="Amount paid by Alice"]'), "80.00");
    type(dialog.querySelector('input[aria-label="Amount paid by Bob"]'), "30.00");
    assert.equal(dialog.querySelector(".split-problems").textContent, "The amounts paid add up to 110.00 but the expense is 120.00.");
    type(dialog.querySelector('input[aria-label="Amount paid by Bob"]'), "40.00");
    assert.equal(dialog.querySelector(".split-problems").textContent, "");
    ledgerBox.click();
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.deepEqual(calls[0].body.payers, [{ ref: "member:a", amount: "80.00" }, { ref: "member:b", amount: "40.00" }]);
    assert.deepEqual(calls[0].body.ledger, { accountId: "acc_cash" });
    assert.deepEqual(calls.refresh, ["group", "accounts", "transactions"]);
    // Anyone who shares records their share (Terry, 2026-09-14): Alice sharing without paying keeps the
    // choice; neither paying nor sharing hides it.
    const again = openGroupExpense(ctx).element;
    const firstPayer = again.querySelectorAll(".split-row").filter((r) => !r.querySelector(".split-row__share"))[0];
    firstPayer.querySelector('input[type="checkbox"]').click();
    assert.equal(ledgerBoxOf(again).closest("fieldset").hidden, false, "Alice still shares");
    shareRow(again, "Alice").querySelector('input[type="checkbox"]').click();
    assert.equal(ledgerBoxOf(again).closest("fieldset").hidden, true);
  });
});

describe("BT-009-10 navigation and empty states by workspace kind", () => {
  test("Shared expenses is in the nav for groups, trips and households, not personal workspaces", () => {
    const ids = (kind) => navRoutes(kind).map((r) => r.id);
    for (const kind of ["group", "trip", "household"]) assert.ok(ids(kind).includes("group"), kind);
    assert.ok(!ids("personal").includes("group"));
    assert.equal(ids("group")[1], "group", "right after the dashboard");
    assert.ok(!ids("group").includes("join"));
    assert.equal(navRoutes("group").find((r) => r.id === "group").label, "Shared expenses");
  });

  test("a group without accounts is led to Shared expenses, not told to add an account", () => {
    const state = { selectedWorkspaceId: "ws_1", workspaces: [{ id: "ws_1", kind: "group", role: "owner" }], accounts: { workspaceId: "ws_1", status: "ready", data: { accounts: [] } } };
    const note = addEntriesBlocked(state);
    assert.match(note.textContent, /Shared expenses need no account/);
    assert.equal(note.querySelector("a").getAttribute("href"), "#/group");
    // Bills still need an account, and a household still says so.
    assert.match(addEntriesBlocked(state, "bills").textContent, /Add an account first/);
    assert.match(addEntriesBlocked({ ...state, workspaces: [{ id: "ws_1", kind: "household", role: "owner" }] }).textContent, /Add an account first/);
  });

  test("the dashboard of a group without accounts offers Add shared expense and shows the person's balance", () => {
    const { ctx, state } = fakeCtx();
    state.transactions = { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } };
    state.payees = { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } };
    state.group.data.balances = [{ currency: "EUR", rows: [{ ref: "member:a", net: "225.00" }], suggestions: [], direct: [] }];
    const view = createDashboard(ctx);
    view.update(state);
    const text = view.element.textContent;
    assert.ok(buttonNamed(view.element, "Add shared expense"), "primary action");
    assert.doesNotMatch(text, /Add an account first/);
    assert.match(text, /none are needed to share expenses/);
    assert.match(text, /Your balance in this group/);
    assert.match(text, /You get back EUR 225\.00/);
    assert.match(text, /Shared expenses are listed on Shared expenses/);
    assert.doesNotMatch(text, /Use “Add expense”/);
  });

  test("a balance says in words who gets money back or owes it, with an in or out arrow, never both ways", () => {
    const fmt = (v, c) => formatAmount(v, c);
    const gets = balanceLabel({ net: "225.00" }, "EUR", fmt);
    assert.equal(gets.textContent, "gets back EUR 225.00");
    assert.equal(gets.querySelector("svg").getAttribute("data-icon"), "money-in");
    const owes = balanceLabel({ net: "-75.00" }, "EUR", fmt);
    assert.equal(owes.textContent, "owes EUR 75.00");
    assert.equal(owes.querySelector("svg").getAttribute("data-icon"), "money-out");
    assert.equal(balanceLabel({ net: "0.00" }, "EUR", fmt).textContent, "Settled up");
    assert.equal(balanceLabel({ net: "-75.00" }, "EUR", fmt, { self: true, subject: "You" }).textContent, "You owe EUR 75.00");
    assert.equal(balanceLabel({ net: "0.00" }, "EUR", fmt, { self: true, subject: "You" }).textContent, "You are settled up");
  });
});
