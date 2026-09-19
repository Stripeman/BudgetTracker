// BT-019-02 (Terry, 2026-09-19): the frontend half of workspace-scoped account TYPE definitions —
// a management card on the Workspace page (create, colour, icon, rename, retire) and the merged
// system+custom type picker in the Accounts page's Add/Edit dialogs, sending `accountTypeId` rather
// than the fixed `type` once the workspace's own types have loaded. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { chooseOption, triggerFor, pickerNamed } from "./pickerassert.js";
import { setCatalog } from "../js/ui/icons.js";
import { createView as createWorkspace } from "../js/ui/views/workspace.js";
import { createView as createAccounts } from "../js/ui/views/accounts.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const server = require("../../api/_shared/icons.js");

let dom;
beforeEach(() => { dom = installDom(); setCatalog(server.catalogView({ disabled: [], custom: [] })); });
afterEach(() => { setCatalog(null); dom.teardown(); });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i += 1) await tick(); };
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const fire = (node, type) => node.dispatchEvent(new DomEvent(type, { bubbles: true }));

const CHECKING = { id: "atype_sys_checking", name: "Checking", accountingClass: "checking", color: "#3b82f6", colorSource: "default", defaultColor: "#3b82f6", icon: "wallet", iconSource: "default", defaultIcon: "wallet", system: true, retired: false, inUse: true, usageCount: 1 };
const SAVINGS = { id: "atype_sys_savings", name: "Savings", accountingClass: "savings", color: "#16a34a", colorSource: "default", defaultColor: "#16a34a", icon: "piggy-bank", iconSource: "default", defaultIcon: "piggy-bank", system: true, retired: false, inUse: false, usageCount: 0 };
const STORE_CARD = { id: "atype_custom_1", name: "Store card", accountingClass: "credit-card", color: "#8b5cf6", colorSource: "workspace", defaultColor: "#8b5cf6", icon: null, iconSource: "default", defaultIcon: "credit-card", system: false, retired: false, inUse: false, usageCount: 0 };
const PALETTE = [{ id: "violet", label: "Violet", hex: "#8b5cf6" }, { id: "green", label: "Green", hex: "#16a34a" }];

function workspaceCtx({ role = "owner", types = [CHECKING, SAVINGS, STORE_CARD] } = {}) {
  const calls = { created: [], patched: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", role }],
    members: ready({ members: [{ id: "m_me", name: "Me Fictional", role, self: true }] }),
    categories: ready({ categories: [], palette: [] }), icons: ready({ typeIcons: {}, canEditTypeIcons: false, catalog: null }),
    accountTypes: ready({ types, accountingClasses: ["checking", "savings", "cash", "credit-card", "loan", "mortgage", "merchant-credit", "investment", "other-asset", "other-liability"], palette: PALETTE }),
  };
  const api = {
    invitations: async () => ({ invitations: [] }), backups: async () => ({ archives: [], policy: "" }), audit: async () => ({ entries: [] }),
    request: async (name) => {
      if (name === "workspaces") return { workspace: { history: [], lifecycle: [], settingsList: [], settingsHistory: [] } };
      if (name === "members") return { former: [] };
      return {};
    },
    createAccountType: async (ws, body) => { calls.created.push(body); return { type: { ...STORE_CARD, ...body, id: "atype_new" } }; },
    patchAccountType: async (ws, body) => { calls.patched.push(body); return { type: { ...STORE_CARD, ...body } }; },
  };
  const store = { getState: () => state, actions: {
    write: async (fn) => { try { await fn("ws_1"); return { ok: true }; } catch (error) { return { ok: false, error }; } },
    refreshWorkspaces: async () => ({ ok: true }),
  } };
  return { ctx: { api, store }, state, calls };
}

const accountTypesCard = (root) => root.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-account-types");

describe("BT-019-02 Workspace page: Account types management card", () => {
  test("an owner sees every system and custom type, each with a name, a colour picker and an icon picker, and a form to add a new one", async () => {
    const { ctx, state } = workspaceCtx();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = accountTypesCard(view.element);
    assert.ok(card, "the Account types card exists");
    const heading3s = card.querySelectorAll("h3").map((h) => h.textContent);
    assert.ok(heading3s.some((t) => t.includes("Checking")));
    assert.ok(heading3s.some((t) => t.includes("Savings")));
    assert.ok(heading3s.some((t) => t.includes("Store card")));
    // A colour picker and an icon picker per row (the same picker component used for categories).
    assert.ok(card.querySelectorAll(".themepick__toggle").length >= 6, "at least colour+icon per row");
    assert.ok(buttonNamed(card, "Add account type"), "a create form is offered");
  });

  test("a viewer sees a plain, read-only list — no picker, no create form", async () => {
    const { ctx, state } = workspaceCtx({ role: "viewer" });
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = accountTypesCard(view.element);
    assert.equal(card.querySelectorAll(".themepick__toggle").length, 0);
    assert.equal(buttonNamed(card, "Add account type"), undefined);
    assert.ok(card.textContent.includes("Store card"));
  });

  test("creating a new custom type sends its name and chosen accounting behaviour", async () => {
    const { ctx, state, calls } = workspaceCtx();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = accountTypesCard(view.element);
    const nameField = card.querySelectorAll("label").find((l) => l.textContent === "New type name");
    card.querySelector(`#${nameField.getAttribute("for")}`).value = "Fictional Wallet";
    buttonNamed(card, "Add account type").click();
    await settle();
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].name, "Fictional Wallet");
    assert.ok(calls.created[0].accountingClass);
  });

  test("a built-in type cannot be retired — no Retire button on it — but a custom type's Retire button sends retired: true", async () => {
    const { ctx, state, calls } = workspaceCtx();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = accountTypesCard(view.element);
    const retireButtons = card.querySelectorAll("button").filter((b) => b.textContent === "Retire");
    assert.equal(retireButtons.length, 1, "only the one custom, non-retired type offers Retire");
    retireButtons[0].click();
    await settle();
    assert.equal(calls.patched.length, 1);
    assert.equal(calls.patched[0].retired, true);
  });

  test("recolouring a custom type sends its new colour, chosen through the same colour picker categories use", async () => {
    const { ctx, state, calls } = workspaceCtx();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = accountTypesCard(view.element);
    const storeRow = card.querySelectorAll(".catrow").find((r) => r.textContent.includes("Store card"));
    const toggle = storeRow.querySelector(".themepick__toggle");
    toggle.click();
    const options = dom.body.querySelectorAll('[role="option"]');
    const green = options.find((o) => o.textContent.includes("Green"));
    assert.ok(green, "the palette is offered from the account-types response");
    green.click();
    await settle();
    assert.equal(calls.patched.length, 1);
    assert.equal(calls.patched[0].color, "#16a34a");
  });
});

function accountsCtx({ types = [CHECKING, SAVINGS, STORE_CARD] } = {}) {
  const calls = { created: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const joint = { id: "acc_joint", name: "Fictional joint", type: "checking", accountTypeId: "atype_sys_checking", accountType: { id: "atype_sys_checking", name: "Checking", color: "#3b82f6", icon: "wallet" }, currency: "EUR", visibility: "private", access: "own", ownedBySelf: true, status: "open", capabilities: ["create"], balance: "10.00" };
  const legacy = { id: "acc_legacy", name: "Fictional legacy cash", type: "cash", accountTypeId: null, accountType: null, currency: "EUR", visibility: "private", access: "own", ownedBySelf: true, status: "open", capabilities: ["create"], balance: "5.00" };
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", reportingCurrency: "EUR" }],
    accounts: ready({ accounts: [joint, legacy] }),
    members: ready({ members: [{ id: "m_alice", name: "Alice Fictional", self: true }] }),
    accountTypes: ready({ types, accountingClasses: ["checking", "savings", "cash", "credit-card", "loan", "mortgage", "merchant-credit", "investment", "other-asset", "other-liability"], palette: PALETTE }),
  };
  const api = { createAccount: async (ws, body) => { calls.created.push(body); return { account: joint }; }, whoCanSee: async () => ({ people: [], notice: "", grants: [] }) };
  const store = { getState: () => state, actions: { write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; } } };
  return { ctx: { store, api }, state, calls };
}

describe("BT-019-02 Accounts page: the merged system+custom type picker", () => {
  test("Add account offers every workspace account type (system and custom) and sends accountTypeId, not the fixed type list", async () => {
    const { ctx, calls } = accountsCtx();
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    buttonNamed(view.element, "Add account").click();
    const dialog = dom.body.querySelector(".modal");
    dialog.querySelector("input").value = "Fictional store account";
    chooseOption(pickerNamed(dialog, "Type"), "Store card");
    buttonNamed(dialog, "Create account").click();
    await tick();
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].accountTypeId, "atype_custom_1");
    assert.equal(calls.created[0].type, undefined, "the raw fixed type is never sent once real account types exist");
  });

  test("the accounts list shows a resolved account type's own colour and icon; a legacy account with no accountTypeId still shows its plain fixed-type label", async () => {
    const { ctx, state } = accountsCtx();
    const view = createAccounts(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const rows = view.element.querySelector("tbody").querySelectorAll("tr");
    const jointRow = rows.find((r) => r.textContent.includes("Fictional joint"));
    const legacyRow = rows.find((r) => r.textContent.includes("legacy"));
    assert.ok(jointRow.querySelector(".catlabel"), "the joint account shows its resolved account type as a coloured/iconed label");
    assert.ok(jointRow.textContent.includes("Checking"));
    assert.ok(legacyRow.textContent.includes("Cash"), "a legacy account with no accountTypeId still shows the plain fixed-type label");
  });
});
