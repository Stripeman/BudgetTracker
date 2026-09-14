// BT-009 increment 1 review remediation in the browser code (financial review of f3ce009, finding 3;
// security review S2, S5, S6). Kept apart from group.test.js so the command-picker conversion of the
// Shared expenses view merges cleanly. All names and amounts are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView as createGroupView, openGroupExpense } from "../js/ui/views/group.js";
import { createView as createDashboard } from "../js/ui/views/dashboard.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const row = (ref, net) => ({ ref, net, netMinor: Math.round(Number(net) * 100), paid: "0.00", share: "0.00", paidOut: "0.00", received: "0.00",
  pendingIn: "0.00", pendingOut: "0.00", disputedIn: "0.00", disputedOut: "0.00", expenses: [] });

// A workspace now in USD where Bob still owes Alice (the viewer) EUR 45.00 from before the change.
function ctxWith(balances, { accounts = [], expenses = [], settlements = [], myLedgers = [] } = {}) {
  const participants = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Flat", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "USD", kind: "group", permissions: { canAdd: true, canManage: true, selfRef: "member:a", role: "owner" },
      participants, expenses, settlements, balances, myLedgers, basis: "Balances count confirmed payments only.",
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts, totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const api = {
    groupAction: async (ws, action, body, key) => { calls.push({ action, body, key }); return {}; },
    createGroupExpense: async (ws, body, key) => { calls.push({ action: "create", body, key }); return { expense: {} }; },
  };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn, refresh) => { const result = await fn("ws_1"); calls.refresh = refresh; return { ok: true, result }; },
      refreshGroup: async () => {}, refreshTransactions: async () => {}, refreshBills: async () => {}, refreshForecast: async () => {},
    },
  };
  return { ctx: { store, api, state }, state, calls };
}

const STRANDED = [
  { currency: "EUR", rows: [row("member:a", "45.00"), row("member:b", "-45.00")], suggestions: [{ from: "member:b", to: "member:a", amount: "45.00", amountMinor: 4500 }], direct: [{ from: "member:b", to: "member:a", amount: "45.00", amountMinor: 4500 }] },
  { currency: "USD", rows: [row("member:a", "0.00"), row("member:b", "0.00")], suggestions: [], direct: [] },
];

describe("finding 3: every currency with an open balance is shown and can be settled", () => {
  test("Shared expenses shows the EUR balance in a USD workspace and does not say everyone is settled up", async () => {
    const { ctx, state, calls } = ctxWith(STRANDED);
    const v = createGroupView(ctx);
    v.update(state);
    const captions = v.element.querySelectorAll("caption").map((c) => c.textContent);
    assert.ok(captions.some((t) => t.startsWith("Balances in EUR")), captions.join(" | "));
    const text = v.element.textContent;
    assert.doesNotMatch(text, /Everyone is settled up/);
    assert.match(text, /Bob pays you/);
    // Recording the suggested EUR payment sends EUR, not the reporting currency.
    const record = v.element.querySelectorAll("button").find((b) => (b.getAttribute("aria-label") || "").startsWith("Record payment of EUR 45.00"));
    assert.ok(record, "a Record payment button for the EUR balance");
    record.click();
    const dialog = document.body.querySelector(".modal");
    assert.match(dialog.textContent, /Amount \(EUR\)/);
    // The amount is preset through the input's value attribute, which a browser shows as its value; the
    // DOM double keeps .value separate, so it is copied over here as a browser would.
    const amount = dialog.querySelector('input[placeholder="0.00"]');
    assert.equal(amount.getAttribute("value"), "45.00");
    amount.value = amount.getAttribute("value");
    buttonNamed(dialog, "Record payment").click();
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "settle");
    assert.deepEqual([calls[0].body.from, calls[0].body.to, calls[0].body.amount, calls[0].body.currency], ["member:b", "member:a", "45.00", "EUR"]);
  });

  test("with every currency settled only the reporting currency's table is shown and everyone is settled up", () => {
    const settled = [{ ...STRANDED[0], rows: [row("member:a", "0.00"), row("member:b", "0.00")], suggestions: [], direct: [] }, STRANDED[1]];
    const { ctx, state } = ctxWith(settled);
    const v = createGroupView(ctx);
    v.update(state);
    const captions = v.element.querySelectorAll("caption").map((c) => c.textContent).filter((t) => t.startsWith("Balances in"));
    assert.deepEqual(captions.map((t) => t.slice(0, 15)), ["Balances in USD"]);
    assert.match(v.element.textContent, /Everyone is settled up/);
  });

  test("the dashboard shows the viewer's balance in every currency where it is not zero", () => {
    const { ctx, state } = ctxWith(STRANDED);
    const d = createDashboard(ctx);
    d.update(state);
    const text = d.element.textContent;
    assert.match(text, /You get back EUR 45\.00/);
    assert.doesNotMatch(text, /You are settled up/);
  });
});

describe("S5 and S6: how a payment's confirmation is shown", () => {
  const payment = (extra) => ({ id: "gst_1", from: "member:b", to: "member:a", amount: "20.00", amountMinor: 2000, currency: "USD", date: "2026-09-12", method: "",
    notes: "", status: "confirmed", voided: false, voidReason: "", disputeReason: "", confirmedByReporter: false, withdrawn: false,
    canConfirm: false, canDispute: false, canVoid: false, revision: 2, ...extra });

  test("a confirmation by the person who reported the payment is said so", () => {
    const { ctx, state } = ctxWith(STRANDED, { settlements: [payment({ confirmedByReporter: true })] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /Confirmed by the person who reported it\./);
  });

  test("a withdrawn confirmation says so with its reason, not only that it was voided", () => {
    const { ctx, state } = ctxWith(STRANDED, { settlements: [payment({ voided: true, withdrawn: true, voidReason: "The transfer bounced" })] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /Confirmation withdrawn: The transfer bounced/);
  });
});

describe("Group settings card and who confirmed (Terry, 2026-09-14)", () => {
  const SETTINGS = { settings: [
    { key: "anyoneConfirms", type: "boolean", label: "Anyone in the group can confirm payments", explanation: "When this is on, anyone in the group can mark a payment as confirmed.", value: true, default: true },
    { key: "ownedEntries", type: "choice", label: "Owed-to-others and repayment entries", explanation: "These entries keep your own account in step with a shared group.", value: "shared-only", default: "shared-only",
      options: [{ value: "shared-only", label: "Created by Shared expenses only" }, { value: "manual", label: "Also allow entering them by hand" }] },
  ], history: [{ at: "2026-09-14T08:00:00.000Z", by: "Frank Fictional", key: "anyoneConfirms", label: "Anyone in the group can confirm payments", from: false, to: true, reason: "Family group" }] };
  const cardOf = (root) => root.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "grp-settings");
  const payment = (extra) => ({ id: "gst_1", from: "member:b", to: "member:a", amount: "20.00", amountMinor: 2000, currency: "USD", date: "2026-09-12", method: "",
    notes: "", status: "confirmed", voided: false, voidReason: "", disputeReason: "", confirmedByReporter: false, withdrawn: false, confirmation: null,
    canConfirm: false, canDispute: false, canVoid: false, revision: 2, ...extra });

  test("owners and managers see every setting with its explanation and history, and save only what changed", async () => {
    const { ctx, state, calls } = ctxWith(STRANDED);
    state.group.data.groupSettings = SETTINGS;
    const v = createGroupView(ctx);
    v.update(state);
    const card = cardOf(v.element);
    assert.equal(card.hidden, false);
    for (const text of [/Anyone in the group can confirm payments/, /When this is on, anyone in the group can mark a payment as confirmed\./, /Owed-to-others and repayment entries/,
      /Created by Shared expenses only/, /Also allow entering them by hand/, /Frank Fictional/, /Family group/]) assert.match(card.textContent, text);
    // On/off is a picker, as in the workspace settings card (eefd115).
    const onOff = card.querySelectorAll("select").find((s) => s.querySelectorAll("option").map((o) => o.textContent).join() === "On,Off");
    assert.equal(onOff.value, "true");
    onOff.value = "false";
    buttonNamed(card, "Save settings").click();
    await tick();
    assert.deepEqual(calls.map((c) => [c.action, c.body]), [["settings", { changes: { anyoneConfirms: false } }]]);
  });

  test("an option's own explanation is shown with its setting (financial recheck N-4)", () => {
    const { ctx, state } = ctxWith(STRANDED);
    state.group.data.groupSettings = { history: [], settings: [
      { key: "settleDisputes", type: "choice", label: "Who can settle a disputed payment", explanation: "A disputed payment counts once someone allowed here confirms it.", value: "receiver", default: "receiver",
        options: [{ value: "receiver", label: "The person who received it" }, { value: "confirmers", label: "Anyone who can confirm payments", explanation: "This includes the person who paid." }] },
    ] };
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(cardOf(v.element).textContent, /“Anyone who can confirm payments”: This includes the person who paid\./);
  });

  test("owners and managers set each person's right to confirm payments; saving sends only what changed", async () => {
    const { ctx, state, calls } = ctxWith(STRANDED);
    state.group.data.groupSettings = { ...SETTINGS, members: [
      { memberId: "mem_bob", name: "Bob Fictional", role: "member", override: "inherit", effective: true },
      { memberId: "mem_carol", name: "Carol Fictional", role: "viewer", override: "no", effective: false },
    ] };
    const v = createGroupView(ctx);
    v.update(state);
    const card = cardOf(v.element);
    assert.match(card.textContent, /Can confirm payments/);
    const pickerFor = (name) => card.querySelectorAll("select").find((s) => s.getAttribute("aria-label") === `Can confirm payments: ${name}`);
    const bob = pickerFor("Bob Fictional");
    assert.deepEqual(bob.querySelectorAll("option").map((o) => o.textContent), ["Use the group setting", "Yes", "No"]);
    assert.deepEqual([bob.value, pickerFor("Carol Fictional").value], ["inherit", "no"]);
    bob.value = "no";
    buttonNamed(card, "Save settings").click();
    await tick();
    assert.deepEqual(calls.map((c) => [c.action, c.body]), [["settings", { changes: { confirmOverrides: { mem_bob: "no" } } }]]);
  });

  test("'Settings saved' is said only for what the server kept; anything it did not keep is named (security recheck M1)", async () => {
    const members = [
      { memberId: "mem_bob", name: "Bob Fictional", role: "member", override: "inherit", effective: true },
      { memberId: "mem_eve", name: "Eve Outsider", role: "member", override: "inherit", effective: true },
    ];
    const said = () => (document.getElementById("a11y-live") || { textContent: "" }).textContent;
    for (const [keptBob, expected] of [["no", /^Settings saved\./], ["inherit", /^Not everything was saved: Can confirm payments: Bob Fictional\./]]) {
      const { ctx, state, calls } = ctxWith(STRANDED);
      state.group.data.groupSettings = { ...SETTINGS, members };
      // The server's answer: Eve's No is kept; Bob's is kept only in the first case.
      ctx.api.groupAction = async (ws, action, body) => { calls.push({ action, body }); return { groupSettings: { ...SETTINGS, members: [{ ...members[0], override: keptBob }, { ...members[1], override: "no" }] } }; };
      const v = createGroupView(ctx);
      v.update(state);
      const card = cardOf(v.element);
      const picker = (name) => card.querySelectorAll("select").find((s) => s.getAttribute("aria-label") === `Can confirm payments: ${name}`);
      picker("Bob Fictional").value = "no";
      picker("Eve Outsider").value = "no";
      buttonNamed(card, "Save settings").click();
      await tick(); await tick();
      assert.deepEqual(calls.map((c) => c.body), [{ changes: { confirmOverrides: { mem_bob: "no", mem_eve: "no" } } }], "both in one request");
      assert.match(said(), expected);
      v.element.remove && v.element.remove();
    }
  });

  test("someone who is not a manager is told their own right to confirm payments", () => {
    for (const [mine, text] of [[{ override: "no", effective: false }, /You can confirm payments made to you\./], [{ override: "inherit", effective: true }, /You can confirm any reported payment in this group\./]]) {
      const { ctx, state } = ctxWith(STRANDED);
      state.group.data.groupSettings = { ...SETTINGS, mine };
      state.group.data.permissions = { ...state.group.data.permissions, canManage: false, role: "member" };
      const v = createGroupView(ctx);
      v.update(state);
      assert.match(v.element.textContent, text);
    }
  });

  test("members and viewers see the card read-only, like the workspace settings card: values in words, the history, no controls (UX review of eefd115, decision 11)", () => {
    for (const role of ["member", "viewer"]) {
      const { ctx, state } = ctxWith(STRANDED);
      state.group.data.groupSettings = SETTINGS;
      state.group.data.permissions = { ...state.group.data.permissions, canManage: false, canAdd: role !== "viewer", role };
      const v = createGroupView(ctx);
      v.update(state);
      const card = cardOf(v.element);
      assert.equal(card.hidden, false, role);
      assert.equal(card.querySelectorAll("select").length + card.querySelectorAll("input").length, 0, role);
      assert.equal(buttonNamed(card, "Save settings"), undefined, role);
      assert.deepEqual(card.querySelectorAll("dd.settings-dl__value").map((d) => d.textContent), ["On", "Created by Shared expenses only"], role);
      assert.match(card.textContent, /Owners and managers change them; you can see how it is set up and every change below\./, role);
      assert.match(card.textContent, /Anyone in the group can confirm payments: Off → On/, role);
      assert.match(card.textContent, /Reason: Family group/, role);
    }
  });

  test("the two cards save the same way: the Save label, reason field and saved line are the workspace card's", async () => {
    const { ctx, state } = ctxWith(STRANDED);
    state.group.data.groupSettings = SETTINGS;
    const v = createGroupView(ctx);
    v.update(state);
    const card = cardOf(v.element);
    assert.ok(card.querySelectorAll("label").some((l) => l.textContent === "Reason for the change (optional)"));
    assert.ok(buttonNamed(card, "Undo changes"));
    card.querySelectorAll("select").find((s) => s.querySelectorAll("option").map((o) => o.textContent).join() === "On,Off").value = "false";
    buttonNamed(card, "Save settings").click();
    await tick(); await tick();
    assert.equal(cardOf(v.element).querySelector('[role="status"]').textContent, "Settings saved. Everyone in the group now works this way.");
  });

  test("a payment confirmed over its receiver's dispute says so and who did it (financial recheck F1)", () => {
    const { ctx, state } = ctxWith(STRANDED, { settlements: [
      payment({ confirmedOverDispute: true, disputeReason: "Never arrived", confirmation: { by: "Alice Fictional", relation: "receiver" } }),
    ] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /Confirmed over a dispute by Alice Fictional\./);
  });

  test("a payment confirmed by the person who paid it, or by someone for its receiver, says who", () => {
    const { ctx, state } = ctxWith(STRANDED, { settlements: [
      payment({ confirmation: { by: "Bob Fictional", relation: "payer" } }),
      payment({ id: "gst_2", from: "member:a", to: "member:b", confirmation: { by: "Frank Fictional", relation: "other" } }),
    ] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /Confirmed by Bob Fictional, who paid it\./);
    assert.match(v.element.textContent, /Confirmed by Frank Fictional for Bob\./);
  });
});

describe("Settings b and e: the group's defaults, each person's own, and the preferred balance view", () => {
  const withSettings = (state, values) => {
    state.group.data.groupSettings = { history: [], settings: Object.entries(values).map(([key, value]) => ({ key, type: "choice", label: key, explanation: "x", value, default: value, options: [] })) };
  };
  const boxes = (dialog) => dialog.querySelectorAll("input").filter((i) => i.getAttribute("class") === "split-row__box");
  const methodOf = (dialog) => dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.textContent === "By shares"));

  test("a new expense starts from the group's defaults: nobody paid, only me sharing, split by shares", () => {
    const { ctx, state } = ctxWith(STRANDED);
    withSettings(state, { splitMethod: "shares", splitWho: "me", paidBy: "nobody" });
    const dialog = openGroupExpense(ctx).element;
    const [payAlice, payBob, shareAlice, shareBob] = boxes(dialog);
    assert.deepEqual([payAlice.checked, payBob.checked, shareAlice.checked, shareBob.checked], [false, false, true, false]);
    assert.equal(methodOf(dialog).value, "shares");
  });

  test("the person's own defaults take the place of the group's", () => {
    const { ctx, state } = ctxWith(STRANDED);
    withSettings(state, { splitMethod: "shares", splitWho: "me", paidBy: "nobody" });
    state.preferences = { effective: { groupSplitMethod: "equal", groupSplitWho: "everyone", groupPaidBy: "me" } };
    const dialog = openGroupExpense(ctx).element;
    const [payAlice, payBob, shareAlice, shareBob] = boxes(dialog);
    assert.deepEqual([payAlice.checked, payBob.checked, shareAlice.checked, shareBob.checked], [true, false, true, true]);
    assert.equal(methodOf(dialog).value, "equal");
  });

  test("'Your own defaults' saves only what changed, as personal preferences", async () => {
    const { ctx, state } = ctxWith(STRANDED);
    const saved = [];
    ctx.store.actions.savePreferences = async (patch) => { saved.push(patch); };
    state.preferences = { effective: { groupSplitMethod: "shares" } };
    const v = createGroupView(ctx);
    v.update(state);
    const card = v.element.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "grp-mine");
    assert.equal(card.hidden, false);
    const selects = card.querySelectorAll("select");
    assert.deepEqual(selects.map((s) => s.value), ["shares", "", "", ""]);
    selects[0].value = "";
    selects[1].value = "me";
    selects[3].value = "direct";
    buttonNamed(card, "Save my defaults").click();
    await tick();
    assert.deepEqual(saved, [{ groupSplitMethod: null, groupSplitWho: "me", groupBalanceView: "direct" }]);
  });

  test("someone who prefers 'Keep who owes whom' sees that view first", () => {
    const { ctx, state } = ctxWith(STRANDED);
    state.preferences = { effective: { groupBalanceView: "direct" } };
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /Each person pays back the people who paid for them/);
    assert.doesNotMatch(v.element.textContent, /The fewest payments that settle everyone/);
  });
});

describe("F2: a part left on an account that is no longer one's own", () => {
  test("the notice gives the server's reason and, with no account to record on, offers to choose one instead of updating", () => {
    const expense = { id: "gex_1", description: "Fictional pizza", date: "2026-09-12", currency: "USD", amount: "40.00", amountMinor: 4000, payers: [], shares: [], split: { method: "equal", lines: [] },
      voided: false, canEdit: false, canVoid: false, revision: 1, history: [],
      myLedger: { accountId: null, accountName: null, accountUnavailable: false, needsReview: true, formerAccount: { reason: "shared", name: "Bob Wallet", left: false },
        note: "Your part was recorded on Bob Wallet, which is now shared. Choose a private account of yours to record it there.", entries: [] } };
    const { ctx, state } = ctxWith(STRANDED, { expenses: [expense] });
    const v = createGroupView(ctx);
    v.update(state);
    const text = v.element.textContent;
    assert.match(text, /Your part was recorded on Bob Wallet, which is now shared\./);
    assert.ok(buttonNamed(v.element, "Choose my account"), "offers to choose an account");
    assert.equal(buttonNamed(v.element, "Update my account"), undefined, "no update without an account");
  });
});

describe("S2 and finding 2: the own-account choice", () => {
  const OWN = { id: "acc_own", name: "Alice Cash", currency: "USD", status: "open", visibility: "private", ownedBySelf: true, capabilities: ["create", "view-transactions"] };
  const JOINT = { id: "acc_joint", name: "Joint", currency: "USD", status: "open", visibility: "shared", ownedBySelf: false, capabilities: ["create", "view-transactions"] };
  const GRANTED = { id: "acc_granted", name: "Bob Card", currency: "USD", status: "open", visibility: "private", ownedBySelf: false, capabilities: ["create", "view-transactions"] };
  const ownFieldset = (dialog) => dialog.querySelectorAll("fieldset").find((f) => f.querySelector("legend") && f.querySelector("legend").textContent === "Your own account (optional)");
  const choiceLabel = (dialog) => dialog.querySelectorAll("label").find((l) => l.textContent === "Also record my part on my own account");

  test("only the viewer's own private accounts are offered, never a shared or granted one", () => {
    const { ctx } = ctxWith(STRANDED, { accounts: [JOINT, OWN, GRANTED] });
    const dialog = openGroupExpense(ctx).element;
    const fs = ownFieldset(dialog);
    assert.equal(fs.hidden, false, "Alice pays and shares by default");
    assert.deepEqual(fs.querySelector("select").querySelectorAll("option").map((o) => o.textContent), ["Alice Cash (USD)"]);
  });

  test("without an own private account the dialog says how to add one, and offers no account", () => {
    const { ctx } = ctxWith(STRANDED, { accounts: [JOINT, GRANTED] });
    const dialog = openGroupExpense(ctx).element;
    const fs = ownFieldset(dialog);
    assert.equal(fs.hidden, false);
    assert.match(fs.textContent, /Add a private account of your own on the Accounts page to record this there\./);
    assert.equal(choiceLabel(dialog).parentNode.parentNode.hidden, true, "no checkbox or account list");
  });

  test("once the viewer's part is recorded on an account, the dialog says where and offers no second choice", async () => {
    const { ctx, calls } = ctxWith(STRANDED, { accounts: [OWN], myLedgers: [{ currency: "USD", accountId: OWN.id, accountName: "Alice Cash", accountUnavailable: false, reviewCount: 0 }] });
    const dialog = openGroupExpense(ctx).element;
    const fs = ownFieldset(dialog);
    assert.match(fs.textContent, /Your part is recorded on Alice Cash, with your other shared expenses in USD\./);
    assert.equal(choiceLabel(dialog).parentNode.parentNode.hidden, true);
    dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]').value = "Fictional lunch";
    dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]').value = "30.00";
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(calls[0].body.ledger, undefined, "the server follows the existing link");
    // The viewer's own account changes too, so it is re-read.
    assert.deepEqual(calls.refresh, ["group", "accounts", "transactions"]);
  });
});
