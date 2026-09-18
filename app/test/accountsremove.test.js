// BT-006-05 Remove an account (Terry, 2026-09-14: "i just created the wrong one and now i cant remove
// it"). The Accounts page offers Remove to whoever may manage the account; the dialog says whether the
// account has entries, pre-fills a reason for an empty one and requires one otherwise; removed accounts
// are listed on request with Bring back. Fictional data; the texts are written out here, not taken
// from the view.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createView as createAccounts } from "../js/ui/views/accounts.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const labelled = (root, label) => root.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === label);
// BT-015: a row's actions are inside a compact "::" menu, closed by default (a floating overlay on
// document.body once open, never a child of the row itself) — open the row's own toggle by its
// record name before looking for one of its items by aria-label.
const openRowMenu = (root, rowText) => {
  const row = [...root.querySelectorAll("tr")].find((tr) => tr.textContent.includes(rowText));
  const toggle = row && row.querySelectorAll("button").find((b) => b.classList.contains("actionsmenu__toggle"));
  if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
  return row;
};
const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });

const EMPTY = { id: "acc_new", name: "Wrong wallet", type: "cash", currency: "EUR", visibility: "private", access: "own", ownedBySelf: true, status: "open", capabilities: ["create", "view-transactions"], hasEntries: false, balance: "0.00", revision: 1 };
const USED = { id: "acc_used", name: "Everyday", type: "checking", currency: "EUR", visibility: "private", access: "own", ownedBySelf: true, status: "open", capabilities: ["create", "view-transactions"], hasEntries: true, balance: "12.00", revision: 3 };
const JOINT = { id: "acc_joint", name: "Joint", type: "checking", currency: "EUR", visibility: "shared", access: "shared", ownedBySelf: false, status: "open", capabilities: ["create", "view-transactions"], hasEntries: true, balance: "90.00", revision: 1 };
const GRANTED = { id: "acc_g", name: "Alice Savings", type: "savings", currency: "EUR", visibility: "private", access: "granted", ownerName: "Alice", ownedBySelf: false, status: "open", capabilities: ["view-balances"], balance: "5.00", revision: 1 };
const GONE = { id: "acc_gone", name: "Old mistake", type: "cash", currency: "EUR", visibility: "private", access: "own", ownedBySelf: true, status: "open", capabilities: ["create", "view-transactions"], hasEntries: false, deletedAt: "2026-09-12T10:00:00.000Z", revision: 2 };
// A currently linked account (financial recheck of 41494d1, FA-2): the server returns groupLedgerLinked
// only to its own owner, and only while the link is active.
const LINKED = { id: "acc_linked", name: "Bob Wallet", type: "cash", currency: "EUR", visibility: "private", access: "own", ownedBySelf: true, status: "open", capabilities: ["create", "view-transactions"], hasEntries: true, groupLedgerLinked: true, balance: "40.00", revision: 2 };

function page({ role = "owner", accounts = [EMPTY, USED, JOINT, GRANTED], removedCount = 0, removeFails = null } = {}) {
  const calls = { removed: [], actions: [], listed: [] };
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", role, reportingCurrency: "EUR" }],
    accounts: ready({ accounts, removedCount, totals: [] }),
    members: ready({ members: [] }),
  };
  const api = {
    removeAccount: async (ws, body) => { calls.removed.push({ ws, body }); if (removeFails) throw Object.assign(new Error(removeFails), { message: removeFails }); return { account: { ...body, deletedAt: "2026-09-14T10:00:00.000Z" } }; },
    accountAction: async (ws, action, body) => { calls.actions.push({ ws, action, body }); return { account: {} }; },
    accounts: async (ws, extra) => { calls.listed.push({ ws, extra }); return { accounts: [...accounts, GONE], removedCount: 1, totals: [] }; },
  };
  const store = {
    getState: () => state,
    actions: { write: async (fn, refresh) => { calls.refresh = refresh; try { await fn("ws_1"); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; } } },
  };
  return { ctx: { store, api }, state, calls };
}

function open(options) {
  const p = page(options);
  const view = createAccounts(p.ctx);
  dom.body.appendChild(view.element);
  view.update(p.state);
  return { ...p, view };
}

describe("BT-006-05 Remove on the Accounts page", () => {
  test("Remove is offered on the person's own accounts and, for an owner, on shared ones; never on an account shared with them", () => {
    const { view } = open();
    openRowMenu(view.element, "Wrong wallet");
    assert.ok(labelled(dom.body, "Remove Wrong wallet"));
    openRowMenu(view.element, "Everyday");
    assert.ok(labelled(dom.body, "Remove Everyday"));
    openRowMenu(view.element, "Joint");
    assert.ok(labelled(dom.body, "Remove Joint"), "owners manage shared lists");
    openRowMenu(view.element, "Alice Savings");
    assert.equal(labelled(dom.body, "Remove Alice Savings"), undefined, "someone else's account shared with me");
  });

  test("a plain member who does not manage shared lists gets no Remove on the shared account", () => {
    const { view } = open({ role: "member" });
    openRowMenu(view.element, "Joint");
    assert.equal(labelled(dom.body, "Remove Joint"), undefined);
    openRowMenu(view.element, "Wrong wallet");
    assert.ok(labelled(dom.body, "Remove Wrong wallet"), "their own private account");
  });

  test("an account with no entries: the dialog says so, the reason is pre-filled and Remove account sends it", async () => {
    const { view, calls } = open();
    openRowMenu(view.element, "Wrong wallet");
    labelled(dom.body, "Remove Wrong wallet").click();
    const dialog = dom.body.querySelector(".modal");
    assert.equal(dialog.querySelector("h2").textContent, "Remove Wrong wallet?");
    assert.match(dialog.textContent, /This account has no entries\. It will be removed from your lists\. You can bring it back from Removed accounts\./);
    const reason = dialog.querySelector("input");
    assert.equal(reason.value, "Created by mistake");
    assert.equal(buttonNamed(dialog, "Close instead"), undefined, "nothing to keep visible");
    const confirm = buttonNamed(dialog, "Remove account");
    assert.ok(confirm.classList.contains("btn--danger"));
    assert.ok(buttonNamed(dialog, "Cancel"));
    confirm.click();
    await tick();
    assert.deepEqual(calls.removed, [{ ws: "ws_1", body: { accountId: "acc_new", reason: "Created by mistake" } }]);
    assert.deepEqual(calls.refresh, ["accounts", "transactions"]);
    assert.equal(dom.body.querySelector(".modal"), null, "closed after removing");
  });

  test("an empty account whose reason was cleared is still removed with the pre-filled reason (the server keeps one)", async () => {
    const { view, calls } = open();
    openRowMenu(view.element, "Wrong wallet");
    labelled(dom.body, "Remove Wrong wallet").click();
    const dialog = dom.body.querySelector(".modal");
    dialog.querySelector("input").value = "  ";
    buttonNamed(dialog, "Remove account").click();
    await tick();
    assert.equal(calls.removed[0].body.reason, "Created by mistake");
  });

  test("an account with entries: the dialog explains that everything is kept, needs a reason and offers Close instead", async () => {
    const { view, calls } = open();
    openRowMenu(view.element, "Everyday");
    labelled(dom.body, "Remove Everyday").click();
    const dialog = dom.body.querySelector(".modal");
    assert.equal(dialog.querySelector("h2").textContent, "Remove Everyday?");
    assert.match(dialog.textContent, /This account has entries\./);
    assert.match(dialog.textContent, /you can bring it back from Removed accounts/);
    assert.match(dialog.textContent, /To stop using it but keep it visible, close it instead\./);
    const reason = dialog.querySelector("input");
    assert.equal(reason.value, "", "no reason is suggested for an account in use");
    buttonNamed(dialog, "Remove account").click();
    await tick();
    assert.deepEqual(calls.removed, [], "nothing sent without a reason");
    assert.equal(reason.getAttribute("aria-invalid"), "true");
    const error = dialog.querySelector(".modal__error");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /Give a reason for removing this account\./);
    reason.value = "Moved everything to Joint";
    buttonNamed(dialog, "Remove account").click();
    await tick();
    assert.deepEqual(calls.removed[0].body, { accountId: "acc_used", reason: "Moved everything to Joint" });
  });

  test("an account currently linked in Shared expenses: the dialog adds that it will be recorded elsewhere next time; one with entries but no active link does not say that", async () => {
    const { view } = open({ accounts: [EMPTY, USED, JOINT, GRANTED, LINKED] });
    openRowMenu(view.element, "Bob Wallet");
    labelled(dom.body, "Remove Bob Wallet").click();
    const dialog = dom.body.querySelector(".modal");
    assert.match(dialog.textContent, /This account has entries\./, "still the entries wording");
    assert.match(dialog.textContent, /This account is linked in Shared expenses\. If you record your part there again, it will be recorded on a different account\./);
    buttonNamed(dialog, "Cancel").click();
    await tick();
    openRowMenu(view.element, "Everyday");
    labelled(dom.body, "Remove Everyday").click();
    const other = dom.body.querySelector(".modal");
    assert.doesNotMatch(other.textContent, /linked in Shared expenses/);
  });

  test("Close instead opens the Close dialog for that account", () => {
    const { view } = open();
    openRowMenu(view.element, "Everyday");
    labelled(dom.body, "Remove Everyday").click();
    buttonNamed(dom.body.querySelector(".modal"), "Close instead").click();
    const dialogs = dom.body.querySelectorAll(".modal");
    assert.equal(dialogs.length, 1, "the Remove dialog is closed first");
    assert.equal(dialogs[0].querySelector("h2").textContent, "Close Everyday?");
  });

  test("a refusal from the server is shown inside the dialog, which stays open", async () => {
    const { view } = open({ removeFails: "Only the account owner (or a manager for shared accounts) can do that." });
    openRowMenu(view.element, "Wrong wallet");
    labelled(dom.body, "Remove Wrong wallet").click();
    const dialog = dom.body.querySelector(".modal");
    buttonNamed(dialog, "Remove account").click();
    await tick();
    assert.ok(dom.body.querySelector(".modal"), "still open");
    assert.match(dialog.querySelector(".modal__error").textContent, /Only the account owner/);
  });

  test("Escape closes the dialog without removing anything", async () => {
    const { view, calls } = open();
    openRowMenu(view.element, "Wrong wallet");
    labelled(dom.body, "Remove Wrong wallet").click();
    document.dispatchEvent(new DomEvent("keydown", { key: "Escape" }));
    await tick();
    assert.equal(dom.body.querySelector(".modal"), null);
    assert.deepEqual(calls.removed, []);
  });
});

describe("BT-006-05 Removed accounts", () => {
  test("no link when nothing was removed", () => {
    const { view } = open({ removedCount: 0 });
    assert.equal(view.element.querySelectorAll("button").find((b) => b.textContent.startsWith("Show removed accounts")), undefined);
  });

  test("Show removed accounts (1) lists the removed account with Bring back, which restores it", async () => {
    const { view, calls, state } = open({ removedCount: 1 });
    const toggle = buttonNamed(view.element, "Show removed accounts (1)");
    assert.ok(toggle);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    toggle.click();
    await tick();
    await tick();
    assert.deepEqual(calls.listed, [{ ws: "ws_1", extra: { includeDeleted: "1" } }]);
    const section = view.element.querySelectorAll("section").find((s) => s.querySelector("h2") && s.querySelector("h2").textContent === "Removed accounts");
    assert.ok(section, "a Removed accounts section");
    assert.match(section.textContent, /Old mistake/);
    assert.match(section.textContent, /Removed 2026-09-12/);
    assert.doesNotMatch(section.textContent, /Wrong wallet/, "accounts still in use are not listed there");
    assert.equal(buttonNamed(view.element, "Hide removed accounts").getAttribute("aria-expanded"), "true");
    labelled(section, "Bring back Old mistake").click();
    await tick();
    await tick();
    assert.deepEqual(calls.actions, [{ ws: "ws_1", action: "restore", body: { accountId: "acc_gone" } }]);
    assert.equal(calls.listed.length, 2, "the removed list is read again");
    view.update(state);
    assert.ok(view.element.querySelectorAll("section").find((s) => s.querySelector("h2") && s.querySelector("h2").textContent === "Removed accounts"), "stays open across a re-render");
  });

  test("with every account removed the page still offers the removed ones", () => {
    const { view } = open({ accounts: [], removedCount: 2 });
    assert.match(view.element.textContent, /No accounts yet/);
    assert.ok(buttonNamed(view.element, "Show removed accounts (2)"));
  });
});
