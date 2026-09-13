// BT-004-05 — every dropdown in the views is TaskTracker's command picker (Terry, 2026-09-14: "use the
// same component. and any drop down that possible to use, can use that too"). For each converted view:
// no plain native dropdown is left, each picker is labelled by its field, short fixed lists have no
// search box, and a choice made THROUGH THE PICKER is exactly what the view submits. Fictional data
// only. Layout, contrast and real screen-reader output are checked in a real browser, not here.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, chooseOption, chooseByKeyboard, triggerFor } from "./pickerassert.js";
import { openNewWorkspace, createOnboarding } from "../js/ui/views/landing.js";
import { createView as createAccounts } from "../js/ui/views/accounts.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const spoken = (select) => triggerFor(select).getAttribute("aria-label");

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
    buttonNamed(view.element, "Who can see this").click();
    await tick();
    await tick();
    const dialog = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(dialog), []);
    const member = pickerNamed(dialog, "Member");
    assert.equal(spoken(member), "Member: Bob Fictional. Search and choose.");
    chooseByKeyboard(member, { type: "carol" });
    buttonNamed(dialog, "Share").click();
    await tick();
    assert.equal(calls.granted.length, 1);
    assert.equal(calls.granted[0].memberId, "m_carol");
  });
});
