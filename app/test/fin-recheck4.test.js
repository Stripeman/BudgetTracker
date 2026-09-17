// Financial recheck of 41494d1, FA-1: linking an account for the first time can backdate confirmed cash
// the person has not yet seen. The client shows the server's own warning and asks before retrying with
// confirmBackdated: true, mirroring confirmShare on account sharing. All names and amounts are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { openGroupExpense, openRecordPayment } from "../js/ui/views/group.js";
import { createView as createDashboard } from "../js/ui/views/dashboard.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const row = (ref, net) => ({ ref, net, netMinor: Math.round(Number(net) * 100), paid: "0.00", share: "0.00", paidOut: "0.00", received: "0.00",
  pendingIn: "0.00", pendingOut: "0.00", disputedIn: "0.00", disputedOut: "0.00", expenses: [] });

const STRANDED = [{ currency: "EUR", rows: [row("member:a", "0.00"), row("member:b", "0.00")], suggestions: [], direct: [] }];

// The server's response for a first link that would backdate confirmed cash (financial recheck FA-1).
const BACKDATE_ERROR = { code: "confirm_backdated", message: "Linking this account will add 1 cash entry totaling -150.00, because you have confirmed activity in this group with no account linked yet.", details: { count: 1, amount: "-150.00", amountMinor: -15000, currency: "EUR" } };

// A real try/catch write, like the store's own (app/js/core/store.js), so `err.code` and `err.details`
// survive to the caller exactly as the server sends them, not flattened to a message string.
function ctxWith({ accounts = [], expenses = [], settlements = [], myLedgers = [], createGroupExpense, settle } = {}) {
  const participants = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Flat", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "EUR", kind: "group", permissions: { canAdd: true, canManage: true, selfRef: "member:a", role: "owner" },
      participants, expenses, settlements, balances: STRANDED, myLedgers, basis: "Balances count confirmed payments only.",
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts, totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const api = {
    createGroupExpense: createGroupExpense || (async (ws, body, key) => { calls.push({ action: "create", body, key }); return { expense: {} }; }),
    groupAction: settle
      ? async (ws, action, body, key) => { calls.push({ action, body, key }); return settle(body); }
      : async (ws, action, body, key) => { calls.push({ action, body, key }); return {}; },
  };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn, refresh) => {
        try { const result = await fn("ws_1"); calls.refresh = refresh; return { ok: true, result }; }
        catch (err) { return { ok: false, error: err }; }
      },
      refreshGroup: async () => {}, refreshAccounts: async () => {}, refreshTransactions: async () => {}, refreshPayees: async () => {},
    },
  };
  return { ctx: { store, api, state }, state, calls };
}

const account = (id, name, currency = "EUR") => ({ id, name, currency, type: "cash", ownedBySelf: true, visibility: "private", capabilities: ["create", "view-transactions"] });
// The "also record on my own account" checkbox, found by its own label (there are other checkboxes
// earlier in the form: who paid, who shares).
const ledgerCheckbox = (dialog, text) => dialog.querySelectorAll("label").find((l) => l.textContent === text).parentNode.querySelector('input[type="checkbox"]');

describe("FA-1: a first link that would backdate confirmed cash asks before it happens", () => {
  test("creating a shared expense with 'also record my part' refused as confirm_backdated: the person sees the server's own warning and can link anyway", async () => {
    let attempt = 0;
    const createGroupExpense = async (ws, body) => {
      attempt += 1;
      if (attempt === 1) { assert.equal(body.confirmBackdated, undefined); const err = new Error(BACKDATE_ERROR.message); Object.assign(err, BACKDATE_ERROR); throw err; }
      assert.equal(body.confirmBackdated, true);
      return { expense: {} };
    };
    const { ctx, state } = ctxWith({ accounts: [account("acc_w", "Bob Wallet")], createGroupExpense });
    const dialog = openGroupExpense(ctx).element;
    dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]').value = "Fictional hotel";
    dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]').value = "10.00";
    ledgerCheckbox(dialog, "Also record my part on my own account").click();
    buttonNamed(dialog, "Save expense").click();
    await tick(); await tick();
    // A second dialog appears with the server's exact warning, on top of the first (still open).
    const modals = dom.body.querySelectorAll(".modal");
    assert.equal(modals.length, 2, "the original dialog and the warning dialog");
    const warn = modals[1];
    assert.equal(warn.querySelector("h2").textContent, "Link this account");
    assert.match(warn.textContent, /1 cash entry totaling -150\.00/);
    assert.ok(buttonNamed(warn, "Cancel"));
    buttonNamed(warn, "Link anyway").click();
    await tick(); await tick();
    assert.equal(dom.body.querySelectorAll(".modal").length, 0, "both dialogs close once the retry succeeds");
    assert.equal(attempt, 2);
  });

  test("declining the warning leaves the original dialog open with nothing changed", async () => {
    let attempt = 0;
    const createGroupExpense = async () => { attempt += 1; const err = new Error(BACKDATE_ERROR.message); Object.assign(err, BACKDATE_ERROR); throw err; };
    const { ctx } = ctxWith({ accounts: [account("acc_w", "Bob Wallet")], createGroupExpense });
    const dialog = openGroupExpense(ctx).element;
    dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]').value = "Fictional hotel";
    dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]').value = "10.00";
    ledgerCheckbox(dialog, "Also record my part on my own account").click();
    buttonNamed(dialog, "Save expense").click();
    await tick(); await tick();
    const warn = dom.body.querySelectorAll(".modal")[1];
    buttonNamed(warn, "Cancel").click();
    await tick();
    assert.equal(dom.body.querySelectorAll(".modal").length, 1, "only the original dialog remains, open");
    assert.equal(dialog.querySelector(".modal__error") ? dialog.querySelector(".modal__error").hidden : true, true, "no spurious error shown");
    assert.equal(attempt, 1, "never retried");
  });

  test("recording a reported payment on one's own account goes through the same warn-and-retry, via the settle action", async () => {
    let attempt = 0;
    const settle = (body) => {
      attempt += 1;
      if (attempt === 1) { assert.equal(body.confirmBackdated, undefined); const err = new Error(BACKDATE_ERROR.message); Object.assign(err, BACKDATE_ERROR); throw err; }
      assert.equal(body.confirmBackdated, true);
      return { settlement: {} };
    };
    const { ctx } = ctxWith({ accounts: [account("acc_w", "Bob Wallet")], settle });
    // Alice is the receiver (to), so the dialog offers "Also record it on my account as a repayment".
    const dialog = openRecordPayment(ctx, { from: "member:b", to: "member:a", amount: "150.00" }).element;
    // The DOM double keeps a preset `value` attribute separate from the live `.value`; a browser shows
    // its value, so it is copied over here as one would appear.
    const amountInput = dialog.querySelector('input[placeholder="0.00"]');
    amountInput.value = amountInput.getAttribute("value");
    ledgerCheckbox(dialog, "Also record it on my account as a repayment").click();
    buttonNamed(dialog, "Record payment").click();
    await tick(); await tick();
    const warn = dom.body.querySelectorAll(".modal")[1];
    assert.match(warn.textContent, /1 cash entry totaling -150\.00/);
    buttonNamed(warn, "Link anyway").click();
    await tick(); await tick();
    assert.equal(attempt, 2);
    assert.equal(dom.body.querySelectorAll(".modal").length, 0);
  });
});

// FA-3 (financial recheck of 41494d1): if a shared expense is corrected while the viewer's own linked
// account cannot be written to (for example it is closed), their part is left needing review and,
// until now, nothing said so beyond the Shared expenses page itself. The Dashboard now shows it too.
function dashboardCtx({ myLedgers = [] } = {}) {
  const participants = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Flat", kind: "group", role: "member" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "EUR", kind: "group", permissions: { canAdd: true, canManage: false, selfRef: "member:a", role: "member" },
      participants, expenses: [], settlements: [], balances: STRANDED, myLedgers, basis: "Balances count confirmed payments only.",
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const store = { getState: () => state, actions: { refreshTransactions: async () => {}, refreshBills: async () => {}, refreshForecast: async () => {}, refreshGroup: async () => {}, refreshWeekActivity: async () => {}, refreshMonthActivity: async () => {} } };
  return { ctx: { store, api: {}, state }, state };
}

describe("FA-3: the Dashboard says when Shared expenses needs the viewer's attention", () => {
  test("with a linked currency needing review, the Dashboard adds it to Needs attention, linking to Shared expenses", () => {
    const { ctx, state } = dashboardCtx({ myLedgers: [{ currency: "EUR", accountId: "acc_w", accountName: "Bob Wallet", accountUnavailable: false, needsAccount: false, since: "2026-01-01T00:00:00.000Z", reviewCount: 1 }] });
    const d = createDashboard(ctx);
    d.update(state);
    const section = d.element.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "dash-alerts");
    assert.ok(section, "the Needs attention section is shown");
    assert.match(section.textContent, /Shared expenses needs your attention/);
    const link = section.querySelectorAll("a").find((a) => a.getAttribute("href") === "#/group");
    assert.ok(link, "links to Shared expenses");
  });

  test("with every linked currency up to date, nothing is said", () => {
    const { ctx, state } = dashboardCtx({ myLedgers: [{ currency: "EUR", accountId: "acc_w", accountName: "Bob Wallet", accountUnavailable: false, needsAccount: false, since: "2026-01-01T00:00:00.000Z", reviewCount: 0 }] });
    const d = createDashboard(ctx);
    d.update(state);
    assert.doesNotMatch(d.element.textContent, /Shared expenses needs your attention/);
  });

  test("with no group ledger link at all, nothing is said (there is nothing of the viewer's to review)", () => {
    const { ctx, state } = dashboardCtx({ myLedgers: [] });
    const d = createDashboard(ctx);
    d.update(state);
    assert.doesNotMatch(d.element.textContent, /Shared expenses needs your attention/);
  });
});
