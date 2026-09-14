// BT-006-06 — editing an account (Terry, 2026-09-14: "i should be able to edit account entries
// too… i need to be able to change values in the fields like account opening balance, opening
// date and institution name and account number, icon and type and currency"). Every
// currently-editable field pre-fills and round-trips; opening balance/date are disabled once the
// account has a reconciled entry, with the server's own explanation, rather than only failing
// after Save; type and currency are shown read-only, never as editable controls, because every
// entry and rule on the account depends on them. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installDom } from "./domdouble.js";
import { setCatalog } from "../js/ui/icons.js";
import { createView as createAccounts } from "../js/ui/views/accounts.js";

const require = createRequire(import.meta.url);
const server = require("../../api/_shared/icons.js");

let dom;
beforeEach(() => { dom = installDom(); setCatalog(server.catalogView({ disabled: [], custom: [] })); });
afterEach(() => { setCatalog(null); dom.teardown(); });

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const labelled = (root, text) => {
  const lab = root.querySelectorAll("label").find((l) => l.textContent === text);
  return lab && root.querySelector(`#${lab.getAttribute("for")}`);
};
const helpFor = (root, text) => {
  const lab = root.querySelectorAll("label").find((l) => l.textContent === text);
  const control = root.querySelector(`#${lab.getAttribute("for")}`);
  const helpId = control.getAttribute("aria-describedby");
  return helpId ? root.querySelector(`#${helpId}`).textContent : "";
};
// The DOM double does not reflect value attributes (or a textarea's initial text) into `.value` as a
// browser does (see app/test/financialreview.test.js), so pre-filled values are set here — what a
// browser would already show — before a test types over them.
const syncValues = (root) => {
  for (const node of root.querySelectorAll("input")) if (node.hasAttribute("value")) node.value = node.getAttribute("value");
  for (const node of root.querySelectorAll("textarea")) node.value = node.textContent;
};

function account(overrides = {}) {
  return {
    id: "acc_card", name: "Fictional Card", type: "credit-card", currency: "EUR", visibility: "private",
    access: "own", ownedBySelf: true, status: "open", capabilities: ["view-balances", "view-transactions", "edit"],
    institution: "Fictional Bank", maskedNumber: "4242", openingBalance: "-250.00", openingDate: "2026-01-01",
    balance: "-180.00", notes: "Existing note.", icon: "credit-card", iconSource: "record", reconciledLocked: false, revision: 3,
    terms: { creditLimit: "2500.00", statementDay: "12", dueDay: "28", minimumPayment: "35.00", apr: "19.99", promoApr: "", promoEndDate: "" },
    ...overrides,
  };
}

function accountsCtx(accounts) {
  const calls = { updated: [] };
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", reportingCurrency: "EUR" }],
    preferences: null,
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts } },
    members: { workspaceId: "ws_1", status: "ready", error: null, data: { members: [{ id: "m_alice", name: "Alice Fictional", self: true }] } },
  };
  const api = { updateAccount: async (ws, body) => { calls.updated.push(body); return { account: accounts[0] }; } };
  const store = { getState: () => state, actions: { write: async (fn) => { await fn("ws_1"); return { ok: true }; } } };
  return { ctx: { store, api }, state, calls };
}

// Opens the Edit dialog with the DOM double's inputs already synced to their pre-filled values, as a
// browser would show them, so a test only has to change the field it cares about.
function openEdit(accounts) {
  const { ctx, calls } = accountsCtx(accounts);
  const view = createAccounts(ctx);
  dom.body.appendChild(view.element);
  view.update(ctx.store.getState());
  buttonNamed(view.element, "Edit").click();
  const dialog = dom.body.querySelector(".modal");
  syncValues(dialog);
  return { dialog, calls };
}

describe("BT-006-06 editing an account", () => {
  test("every currently-editable field pre-fills from the account", () => {
    const { dialog } = openEdit([account()]);
    assert.equal(labelled(dialog, "Name").getAttribute("value"), "Fictional Card");
    assert.equal(labelled(dialog, "Institution").getAttribute("value"), "Fictional Bank");
    assert.equal(labelled(dialog, "Account number").getAttribute("value"), "4242");
    assert.equal(labelled(dialog, "Opening balance").getAttribute("value"), "-250.00");
    assert.equal(labelled(dialog, "Opening date").getAttribute("value"), "2026-01-01");
    assert.equal(labelled(dialog, "Notes").textContent, "Existing note.");
  });

  test("type and currency are shown read-only, never an editable control, with the locked explanation", () => {
    const { dialog } = openEdit([account()]);
    const type = labelled(dialog, "Type");
    const currency = labelled(dialog, "Currency");
    assert.equal(type.getAttribute("value"), "Credit card");
    assert.equal(currency.getAttribute("value"), "EUR");
    assert.ok(type.hasAttribute("readonly"), "type cannot be typed into");
    assert.ok(currency.hasAttribute("readonly"), "currency cannot be typed into");
    assert.equal(dialog.querySelectorAll("select").length, 0, "no dropdown offers another type or currency");
    assert.match(helpFor(dialog, "Type"), /can't be changed/);
    assert.match(helpFor(dialog, "Currency"), /can't be changed/);
  });

  test("changing name, institution, account number, opening balance/date and notes sends exactly those fields", async () => {
    const { dialog, calls } = openEdit([account()]);
    labelled(dialog, "Name").value = "Renamed card";
    labelled(dialog, "Institution").value = "Another Bank";
    labelled(dialog, "Account number").value = "9999";
    labelled(dialog, "Opening balance").value = "-300.00";
    labelled(dialog, "Opening date").value = "2026-02-01";
    labelled(dialog, "Notes").value = "Updated note.";
    buttonNamed(dialog, "Save changes").click();
    await tick();
    assert.equal(calls.updated.length, 1);
    assert.deepEqual(calls.updated[0], {
      accountId: "acc_card", revision: 3,
      name: "Renamed card", institution: "Another Bank", maskedNumber: "9999",
      openingBalance: "-300.00", openingDate: "2026-02-01", notes: "Updated note.",
    });
  });

  test("nothing changed announces and never calls the API", async () => {
    const { dialog, calls } = openEdit([account()]);
    buttonNamed(dialog, "Save changes").click();
    await tick();
    assert.equal(calls.updated.length, 0);
  });

  test("a reason is optional and sent only when given", async () => {
    const { dialog, calls } = openEdit([account()]);
    labelled(dialog, "Name").value = "Renamed";
    labelled(dialog, "Reason for this change").value = "  Corrected the name  ";
    buttonNamed(dialog, "Save changes").click();
    await tick();
    assert.equal(calls.updated[0].reason, "Corrected the name");
  });

  test("opening balance and date are disabled once the account has a reconciled entry, with the server's own explanation, and are never sent", async () => {
    const { dialog, calls } = openEdit([account({ reconciledLocked: true })]);
    const opening = labelled(dialog, "Opening balance");
    const openingDate = labelled(dialog, "Opening date");
    assert.ok(opening.hasAttribute("disabled"));
    assert.ok(openingDate.hasAttribute("disabled"));
    assert.match(helpFor(dialog, "Opening balance"), /reconciled entries/);
    assert.match(helpFor(dialog, "Opening date"), /reconciled entries/);
    // Even if a value is forced past the disabled control, the locked fields are never submitted.
    opening.value = "-999.00";
    openingDate.value = "2020-01-01";
    labelled(dialog, "Name").value = "Renamed";
    buttonNamed(dialog, "Save changes").click();
    await tick();
    assert.deepEqual(Object.keys(calls.updated[0]).sort(), ["accountId", "name", "revision"]);
  });

  test("credit terms pre-fill and round-trip as one object", async () => {
    const { dialog, calls } = openEdit([account()]);
    assert.equal(labelled(dialog, "Credit limit").getAttribute("value"), "2500.00");
    assert.equal(labelled(dialog, "Statement day").getAttribute("value"), "12");
    assert.equal(labelled(dialog, "Due day").getAttribute("value"), "28");
    assert.equal(labelled(dialog, "Minimum payment").getAttribute("value"), "35.00");
    assert.equal(labelled(dialog, "APR").getAttribute("value"), "19.99");
    labelled(dialog, "Credit limit").value = "3000.00";
    labelled(dialog, "APR").value = "15.50";
    buttonNamed(dialog, "Save changes").click();
    await tick();
    assert.deepEqual(calls.updated[0].terms, {
      creditLimit: "3000.00", statementDay: 12, dueDay: 28, minimumPayment: "35.00", apr: "15.50", promoApr: undefined, promoEndDate: undefined,
    });
  });

  test("loan terms show for a loan account and credit terms do not", async () => {
    const { dialog, calls } = openEdit([account({
      id: "acc_loan", type: "loan", terms: { principal: "20000.00", interestRate: "4.50", termMonths: 60, payment: "375.00", paymentDay: "1", startDate: "2025-01-01" },
    })]);
    assert.equal(labelled(dialog, "Principal").getAttribute("value"), "20000.00");
    assert.equal(labelled(dialog, "Interest rate").getAttribute("value"), "4.50");
    assert.equal(labelled(dialog, "Term (months)").getAttribute("value"), "60");
    assert.equal(labelled(dialog, "Credit limit"), undefined, "a loan has no credit-card terms");
    labelled(dialog, "Payment").value = "400.00";
    buttonNamed(dialog, "Save changes").click();
    await tick();
    assert.equal(calls.updated[0].terms.payment, "400.00");
  });

  test("an account type with no terms shows no terms section and never sends one", async () => {
    const { dialog, calls } = openEdit([account({ id: "acc_chk", type: "checking", terms: {} })]);
    assert.equal(labelled(dialog, "Credit limit"), undefined);
    assert.equal(labelled(dialog, "Principal"), undefined);
    labelled(dialog, "Name").value = "Renamed checking";
    buttonNamed(dialog, "Save changes").click();
    await tick();
    assert.ok(!("terms" in calls.updated[0]));
  });

  test("changing the icon sends it", async () => {
    const { dialog, calls } = openEdit([account()]);
    const options = dialog.querySelectorAll('[role="option"]');
    const wallet = options.find((o) => o.dataset.theme === "wallet");
    assert.ok(wallet, "the wallet icon is offered");
    wallet.click();
    buttonNamed(dialog, "Save changes").click();
    await tick();
    assert.equal(calls.updated[0].icon, "wallet");
  });
});
