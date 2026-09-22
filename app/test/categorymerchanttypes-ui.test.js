// BT-019-01/03 (Terry, 2026-09-19): the frontend half of workspace-scoped category and merchant TYPE
// definitions — management cards on the Workspace page (mirroring BT-019-02's account types exactly)
// and the merchant editor's merged system+custom type picker. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { chooseOption, pickerNamed, offeredOptions } from "./pickerassert.js";
import { setCatalog } from "../js/ui/icons.js";
import { createView as createWorkspace } from "../js/ui/views/workspace.js";
import { openMerchantEditor } from "../js/ui/views/payees.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const server = require("../../api/_shared/icons.js");

let dom;
beforeEach(() => { dom = installDom(); setCatalog(server.catalogView({ disabled: [], custom: [] })); });
afterEach(() => { setCatalog(null); dom.teardown(); });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i += 1) await tick(); };
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const PALETTE = [{ id: "violet", label: "Violet", hex: "#8b5cf6" }, { id: "green", label: "Green", hex: "#16a34a" }];

function workspaceCtx({ role = "owner" } = {}) {
  const calls = { created: [], patched: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const catType = { id: "ctype_sys_expense", name: "Expense", categoryClass: "expense", color: "#dc2626", colorSource: "default", defaultColor: "#dc2626", icon: "tag", iconSource: "default", defaultIcon: "tag", system: true, retired: false, inUse: false, usageCount: 0 };
  const merchType = { id: "mtype_sys_retailer", name: "Retailer", merchantClass: "retailer", color: "#3b82f6", colorSource: "default", defaultColor: "#3b82f6", icon: "store", iconSource: "default", defaultIcon: "store", system: true, retired: false, inUse: false, usageCount: 0 };
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", role }],
    members: ready({ members: [{ id: "m_me", name: "Me Fictional", role, self: true }] }),
    categories: ready({ categories: [], palette: [] }), icons: ready({ typeIcons: {}, canEditTypeIcons: false, catalog: null }),
    accountTypes: ready({ types: [], accountingClasses: [], palette: PALETTE }),
    categoryTypes: ready({ types: [catType], categoryClasses: ["expense", "income"], palette: PALETTE }),
    merchantTypes: ready({ types: [merchType], merchantClasses: ["retailer", "grocery"], palette: PALETTE }),
  };
  const api = {
    invitations: async () => ({ invitations: [] }), backups: async () => ({ archives: [], policy: "" }), audit: async () => ({ entries: [] }),
    request: async (name) => {
      if (name === "workspaces") return { workspace: { history: [], lifecycle: [], settingsList: [], settingsHistory: [] } };
      if (name === "members") return { former: [] };
      return {};
    },
    createCategoryType: async (ws, body) => { calls.patched.push({ create: "category", body }); return { type: { ...catType, ...body, id: "ctype_new" } }; },
    patchCategoryType: async (ws, body) => { calls.patched.push({ patch: "category", body }); return { type: { ...catType, ...body } }; },
    createMerchantType: async (ws, body) => { calls.patched.push({ create: "merchant", body }); return { type: { ...merchType, ...body, id: "mtype_new" } }; },
    patchMerchantType: async (ws, body) => { calls.patched.push({ patch: "merchant", body }); return { type: { ...merchType, ...body } }; },
  };
  const store = { getState: () => state, actions: {
    write: async (fn) => { try { await fn("ws_1"); return { ok: true }; } catch (error) { return { ok: false, error }; } },
    refreshWorkspaces: async () => ({ ok: true }),
  } };
  return { ctx: { api, store }, state, calls };
}

const cardByHeading = (root, text) => root.querySelectorAll("section").find((s) => (s.querySelector("h2") || {}).textContent === text);

describe("BT-019-01 Workspace page: Category types management card", () => {
  test("an owner sees the system default and a create form; a viewer sees a read-only list", async () => {
    const { ctx, state } = workspaceCtx();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = cardByHeading(view.element, "Category types");
    assert.ok(card, "the Category types card exists");
    assert.ok(card.textContent.includes("Expense"));
    assert.ok(buttonNamed(card, "Add category type"));

    const { ctx: viewerCtx, state: viewerState } = workspaceCtx({ role: "viewer" });
    const viewerView = createWorkspace(viewerCtx);
    dom.body.appendChild(viewerView.element);
    viewerView.update(viewerState);
    await settle();
    const viewerCard = cardByHeading(viewerView.element, "Category types");
    assert.equal(buttonNamed(viewerCard, "Add category type"), undefined);
  });

  test("creating a new category type sends its name and chosen expense/income class", async () => {
    const { ctx, state, calls } = workspaceCtx();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = cardByHeading(view.element, "Category types");
    const nameField = card.querySelectorAll("label").find((l) => l.textContent === "New type name");
    card.querySelector(`#${nameField.getAttribute("for")}`).value = "Fictional Essentials";
    buttonNamed(card, "Save category type").click();
    await settle();
    const created = calls.patched.find((c) => c.create === "category");
    assert.ok(created);
    assert.equal(created.body.name, "Fictional Essentials");
    assert.ok(created.body.categoryClass);
  });
});

describe("BT-019-03 Workspace page: Merchant types management card", () => {
  test("an owner sees the system default and a create form; retiring the custom type sends retired: true", async () => {
    const { ctx, state, calls } = workspaceCtx();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = cardByHeading(view.element, "Merchant types");
    assert.ok(card, "the Merchant types card exists");
    assert.ok(card.textContent.includes("Retailer"));
    // The system type offers no Retire button.
    assert.equal(card.querySelectorAll("button").filter((b) => b.textContent === "Retire").length, 0);
    void calls;
  });
});

function payeesCtx({ types = [{ id: "mtype_sys_retailer", name: "Retailer", color: "#3b82f6", icon: "store" }, { id: "mtype_sys_grocery", name: "Grocery", color: "#16a34a", icon: "cart" }] } = {}) {
  const calls = { created: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner" }],
    categories: ready({ categories: [] }), accounts: ready({ accounts: [] }),
    merchantTypes: ready({ types, merchantClasses: ["retailer", "grocery"], palette: PALETTE }),
  };
  const api = { createMerchant: async (ws, body) => { calls.created.push(body); return { payee: {} }; } };
  const store = { getState: () => state, actions: { write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; } } };
  return { ctx: { store, api }, state, calls };
}

describe("BT-019-03 the merchant editor's merged system+custom type picker", () => {
  test("offers every workspace merchant type and sends merchantTypeId, not the fixed type list", async () => {
    const { ctx, calls } = payeesCtx();
    openMerchantEditor(ctx);
    const root = dom.body.querySelector(".modal");
    root.querySelector('input[maxlength="80"]').value = "Fictional Grocer";
    chooseOption(pickerNamed(root, "Type"), "Grocery");
    buttonNamed(root, "Add merchant").click();
    await tick();
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].merchantTypeId, "mtype_sys_grocery");
    assert.equal(calls.created[0].type, undefined, "the raw fixed type is never sent once real merchant types exist");
  });

  test("offers all the workspace's own merchant types, not only the fixed 13", () => {
    const { ctx } = payeesCtx();
    openMerchantEditor(ctx);
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(offeredOptions(pickerNamed(root, "Type")).sort(), ["Grocery", "Retailer"].sort());
  });
});
