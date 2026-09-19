// BT-020-03/04 (Terry, 2026-09-19): manual interest, fees, payments/credits and balance corrections
// on a debt (liability) account — offered only there, via the canonical transactions API, never a
// parallel payment system. Interest, fee and balance-correction entries require a reason, asked for
// up front; a payment or credit does not, matching every ordinary transfer/refund elsewhere. All
// data is fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createView as createAccounts } from "../js/ui/views/accounts.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const labelled = (root, text) => {
  const l = root.querySelectorAll("label").find((x) => x.textContent === text);
  return l && root.querySelector(`#${l.getAttribute("for")}`);
};
// Whether a field is genuinely visible: no ancestor up to `root` is hidden. A plain boolean, never a
// DOM node, so a failed assertion never tries to inspect a circular DOM structure.
const fieldVisible = (root, text) => {
  let n = labelled(root, text);
  if (!n) return false;
  while (n && n !== root) {
    if (n.hidden) return false;
    n = n.parentNode;
  }
  return true;
};

function card(overrides = {}) {
  return {
    id: "acc_card", name: "Fictional Card", type: "credit-card", currency: "EUR", visibility: "private",
    access: "own", ownedBySelf: true, status: "open", capabilities: ["view-balances", "view-transactions", "create", "edit"],
    balance: "-250.00", liability: true, icon: "credit-card", revision: 1,
    ...overrides,
  };
}
function checking(overrides = {}) {
  return {
    id: "acc_checking", name: "Fictional Checking", type: "checking", currency: "EUR", visibility: "private",
    access: "own", ownedBySelf: true, status: "open", capabilities: ["view-balances", "view-transactions", "create", "edit"],
    balance: "1000.00", liability: false, icon: "bank", revision: 1,
    ...overrides,
  };
}

function accountsCtx(accounts) {
  const calls = { created: [] };
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", reportingCurrency: "EUR" }],
    preferences: null,
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts } },
    members: { workspaceId: "ws_1", status: "ready", error: null, data: { members: [{ id: "m_alice", name: "Alice Fictional", self: true }] } },
  };
  const api = { createTransaction: async (ws, body) => { calls.created.push(body); return { transactions: [{}] }; } };
  const store = { getState: () => state, actions: { write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; } } };
  return { ctx: { store, api }, state, calls };
}

function openRowMenu(view, name) {
  const row = [...view.element.querySelectorAll("tr")].find((tr) => tr.textContent.includes(name));
  row.querySelector(".actionsmenu__toggle").click();
}

describe("BT-020-03/04 Accounts page: manual debt entries are offered only on a debt (liability) account", () => {
  test("a credit card offers Add interest charge, Add fee, Record payment or credit and Correct balance; an ordinary checking account offers none of them", () => {
    const { ctx, state } = accountsCtx([card(), checking()]);
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    openRowMenu(view, "Fictional Card");
    for (const label of ["Add interest charge", "Add fee", "Record payment or credit", "Correct balance"]) {
      assert.ok(buttonNamed(dom.body, label), `${label} is offered on the debt account`);
    }
    // Close the card's menu, then check the checking account's own menu offers none of these.
    dom.body.querySelector(".actionsmenu__toggle[aria-expanded='true']").click();
    openRowMenu(view, "Fictional Checking");
    for (const label of ["Add interest charge", "Add fee", "Record payment or credit", "Correct balance"]) {
      assert.equal(buttonNamed(dom.body, label), undefined, `${label} is never offered on an ordinary asset account`);
    }
  });
});

describe("BT-020-03 Add interest charge / Add fee: a reason is required, kept with the entry", () => {
  test("Add interest charge refuses to save with no reason; with one, records kind 'interest' with the reason as notes", async () => {
    const { ctx, state, calls } = accountsCtx([card()]);
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    openRowMenu(view, "Fictional Card");
    buttonNamed(dom.body, "Add interest charge").click();
    const dialog = dom.body.querySelector(".modal");
    labelled(dialog, "Amount (EUR)").value = "30.00";
    buttonNamed(dialog, "Add interest charge").click();
    await tick();
    assert.equal(calls.created.length, 0, "refused: no reason yet");
    labelled(dialog, "Reason").value = "September statement interest";
    buttonNamed(dialog, "Add interest charge").click();
    await tick();
    assert.equal(calls.created.length, 1);
    assert.deepEqual({ accountId: calls.created[0].accountId, kind: calls.created[0].kind, amount: calls.created[0].amount, notes: calls.created[0].notes },
      { accountId: "acc_card", kind: "interest", amount: "30.00", notes: "September statement interest" });
  });

  test("Add fee behaves the same way, with kind 'fee'", async () => {
    const { ctx, state, calls } = accountsCtx([card()]);
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    openRowMenu(view, "Fictional Card");
    buttonNamed(dom.body, "Add fee").click();
    const dialog = dom.body.querySelector(".modal");
    labelled(dialog, "Amount (EUR)").value = "5.00";
    labelled(dialog, "Reason").value = "Late payment fee";
    buttonNamed(dialog, "Add fee").click();
    await tick();
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].kind, "fee");
  });
});

describe("BT-020-03 Record payment or credit", () => {
  test("a payment sends a transfer from the chosen account into this debt account; the account picker is offered", async () => {
    const { ctx, state, calls } = accountsCtx([card(), checking()]);
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    openRowMenu(view, "Fictional Card");
    buttonNamed(dom.body, "Record payment or credit").click();
    const dialog = dom.body.querySelector(".modal");
    assert.ok(labelled(dialog, "Pay from"), "a payment offers the source account");
    labelled(dialog, "Amount (EUR)").value = "100.00";
    buttonNamed(dialog, "Save").click();
    await tick();
    assert.equal(calls.created.length, 1);
    assert.deepEqual(calls.created[0], { accountId: "acc_checking", kind: "transfer", amount: "100.00", date: calls.created[0].date, transfer: { toAccountId: "acc_card" } });
  });

  test("a credit sends a refund directly on this debt account, with no source account needed", async () => {
    const { ctx, state, calls } = accountsCtx([card(), checking()]);
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    openRowMenu(view, "Fictional Card");
    buttonNamed(dom.body, "Record payment or credit").click();
    const dialog = dom.body.querySelector(".modal");
    const mode = dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.textContent.includes("Credit")));
    mode.value = "credit";
    mode.dispatchEvent(new DomEvent("change", { bubbles: true }));
    assert.equal(fieldVisible(dialog, "Pay from"), false, "no source account needed for a credit");
    labelled(dialog, "Amount (EUR)").value = "20.00";
    buttonNamed(dialog, "Save").click();
    await tick();
    assert.equal(calls.created.length, 1);
    assert.deepEqual(calls.created[0], { accountId: "acc_card", kind: "refund", amount: "20.00", date: calls.created[0].date });
  });
});

describe("BT-020-04 Correct balance: a calculated adjustment, shown before confirming, never a silent overwrite", () => {
  test("shows the calculated delta before confirming, refuses with no reason, then records a single audited 'adjustment' entry", async () => {
    const { ctx, state, calls } = accountsCtx([card()]);
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    openRowMenu(view, "Fictional Card");
    buttonNamed(dom.body, "Correct balance").click();
    const dialog = dom.body.querySelector(".modal");
    const desired = labelled(dialog, "Desired balance (EUR)");
    desired.value = "-300.00";
    desired.dispatchEvent(new DomEvent("input", { bubbles: true }));
    const preview = dialog.querySelectorAll("p").find((p) => /decreases the balance by/.test(p.textContent));
    assert.ok(preview, "the calculated adjustment and its treatment are shown before confirming");
    assert.match(preview.textContent, /50\.00 EUR/);
    buttonNamed(dialog, "Correct balance").click();
    await tick();
    assert.equal(calls.created.length, 0, "refused: no reason yet");
    labelled(dialog, "Reason").value = "Corrected to match the statement";
    buttonNamed(dialog, "Correct balance").click();
    await tick();
    assert.equal(calls.created.length, 1);
    assert.deepEqual({ accountId: calls.created[0].accountId, kind: calls.created[0].kind, amount: calls.created[0].amount, notes: calls.created[0].notes },
      { accountId: "acc_card", kind: "adjustment", amount: "-50.00", notes: "Corrected to match the statement" });
  });

  test("no change announces and never calls the API", async () => {
    const { ctx, state, calls } = accountsCtx([card()]);
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    openRowMenu(view, "Fictional Card");
    buttonNamed(dom.body, "Correct balance").click();
    const dialog = dom.body.querySelector(".modal");
    buttonNamed(dialog, "Correct balance").click();
    await tick();
    assert.equal(calls.created.length, 0);
  });
});
