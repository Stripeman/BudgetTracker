// BT-024 (Terry, 2026-09-23): "sort Account Types, Merchant types and Manage workspace categories
// alphabetically on My Settings. Also make the editable the same way you made the editable on the
// Workspace Categories & types page." Covers: the three personal-appearance sections (account
// type, category, merchant type) sort alphabetically among My Settings' groups; each uses the same
// compact one-line-row-with-expandable-editor idiom as the Workspace page's own row managers
// (createCategoryManager/createTypeManager); colour/icon saves and resets go to the correct
// preference key and never touch the workspace's own record. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/settings.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const groupToggle = (root, name) => root.querySelectorAll(".settings-group__toggle").find((b) => b.textContent === name);

const PALETTE = [{ id: "violet", label: "Violet", hex: "#8b5cf6" }, { id: "green", label: "Green", hex: "#16a34a" }];
const GROCERIES = { id: "cat_groceries", name: "Groceries", type: "expense", archived: false, color: "#16a34a", icon: "cart" };
const CHECKING = { id: "atype_sys_checking", name: "Checking", accountingClass: "checking", color: "#3b82f6", icon: "wallet", system: true, retired: false, usageCount: 1 };
const STORE_CARD = { id: "atype_custom_1", name: "Store card", accountingClass: "credit-card", color: "#8b5cf6", icon: null, system: false, retired: false, usageCount: 0 };
const RETAILER = { id: "mtype_sys_retailer", name: "Retailer", merchantClass: "retailer", color: "#3b82f6", icon: null, system: true, retired: false };

function baseState(overrides = {}) {
  const sources = {
    themeMode: "default", themePalette: "default", displayCurrency: "default", dateFormat: "default", numberFormat: "default",
    defaultWorkspaceId: "default", balanceMasking: "default",
    categoryColors: "default", categoryIcons: "default", accountTypeColors: "default", accountTypeIcons: "default",
    merchantTypeColors: "default", merchantTypeIcons: "default", stagingUrl: "default",
  };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  return {
    selectedWorkspaceId: "ws_1", workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner" }],
    layoutPreview: null, auth: { user: { name: "Alice Fictional", siteAdmin: false } },
    categories: ready({ categories: [GROCERIES], palette: PALETTE }),
    accountTypes: ready({ types: [CHECKING, STORE_CARD], palette: PALETTE }),
    merchantTypes: ready({ types: [RETAILER], palette: PALETTE }),
    icons: ready({ catalog: null }),
    preferences: {
      stored: {},
      effective: {
        dateFormat: "iso", numberFormat: "1,234.56", displayCurrency: "", defaultWorkspaceId: "", balanceMasking: false, themePalette: "midnight", stagingUrl: null,
        categoryColors: {}, categoryIcons: {}, accountTypeColors: {}, accountTypeIcons: {}, merchantTypeColors: {}, merchantTypeIcons: {},
      },
      sources,
    },
    ...overrides,
  };
}

function boot(state) {
  const theme = { getTheme: () => "midnight", setTheme() {}, subscribe: () => () => {}, getMode: () => "light", getResolvedMode: () => "light", setMode() {} };
  const calls = [];
  const store = {
    getState: () => state,
    actions: { savePreferences: async (patch) => { calls.push(patch); return { ok: true }; }, refreshPreferences: async () => ({ ok: true }), init: async () => {} },
  };
  const api = { request: async () => ({ private: [] }), siteSettings: async () => ({ settings: { defaults: {}, locked: [] }, admin: false }) };
  const view = createView({ store, theme, api });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view, calls };
}

describe("BT-024 My Settings: personal appearance sections sort alphabetically and use the same expandable-row editor as the Workspace page", () => {
  test("the three personal-appearance groups appear in alphabetical order among My Settings' sections", () => {
    const { view } = boot(baseState());
    const names = view.element.querySelectorAll(".settings-group__toggle").map((b) => b.textContent);
    const appearance = names.filter((n) => n === "My account type appearance" || n === "My category appearance" || n === "My merchant type appearance");
    assert.deepEqual(appearance, ["My account type appearance", "My category appearance", "My merchant type appearance"]);
  });

  test("without a selected workspace, none of the three personal-appearance sections show (nothing to override)", () => {
    const { view } = boot(baseState({ selectedWorkspaceId: null, workspaces: [] }));
    for (const name of ["My account type appearance", "My category appearance", "My merchant type appearance"]) {
      const toggle = groupToggle(view.element, name);
      const section = toggle ? toggle.closest(".settings-group") : null;
      assert.ok(!section || section.hidden, `${name} should be hidden with no workspace selected`);
    }
  });

  test("category appearance: a compact, collapsed row per category (the same idiom as the Workspace page's own row managers), expanding it reveals the colour/icon editor, and picking a colour saves categoryColors", async () => {
    const { view, calls } = boot(baseState());
    const card = view.element.querySelector('[aria-labelledby="set-colours"]');
    const row = card.querySelectorAll(".typerow").find((r) => r.querySelector("summary").textContent.includes("Groceries"));
    assert.ok(row, "Groceries has its own compact expandable row");
    assert.ok(!row.open, "collapsed by default, not a permanently expanded wall of fields");
    row.querySelector("summary").click();
    const body = row.querySelector(".catrow");
    const toggle = body.querySelector(".themepick__toggle");
    toggle.click();
    const violet = dom.body.querySelectorAll('[role="option"]').find((o) => o.textContent.includes("Violet"));
    assert.ok(violet, "the real workspace palette is offered");
    violet.click();
    await Promise.resolve();
    assert.deepEqual(calls.at(-1), { categoryColors: { [GROCERIES.id]: "#8b5cf6" } });
  });

  test("account type appearance: a built-in type and a custom type each get their own compact row; picking a colour on the custom one saves accountTypeColors, never the workspace's own record", async () => {
    const { view, calls } = boot(baseState());
    const card = view.element.querySelector('[aria-labelledby="set-atype-colours"]');
    assert.ok(card.querySelectorAll(".typerow").find((r) => r.querySelector("summary").textContent.includes("Checking")), "the built-in type has its own row too");
    const row = card.querySelectorAll(".typerow").find((r) => r.querySelector("summary").textContent.includes("Store card"));
    assert.ok(row);
    row.querySelector("summary").click();
    const toggle = row.querySelector(".catrow").querySelector(".themepick__toggle");
    toggle.click();
    const green = dom.body.querySelectorAll('[role="option"]').find((o) => o.textContent.includes("Green"));
    green.click();
    await Promise.resolve();
    assert.deepEqual(calls.at(-1), { accountTypeColors: { [STORE_CARD.id]: "#16a34a" } });
  });

  test("account type appearance: resetting an already-set personal colour clears just that entry (sends null once it is the only one)", async () => {
    const state = baseState({ preferences: { stored: {}, effective: { dateFormat: "iso", numberFormat: "1,234.56", displayCurrency: "", defaultWorkspaceId: "", balanceMasking: false, themePalette: "midnight", stagingUrl: null, categoryColors: {}, categoryIcons: {}, accountTypeColors: { [STORE_CARD.id]: "#8b5cf6" }, accountTypeIcons: {}, merchantTypeColors: {}, merchantTypeIcons: {} }, sources: baseState().preferences.sources } });
    const { view, calls } = boot(state);
    const card = view.element.querySelector('[aria-labelledby="set-atype-colours"]');
    const row = card.querySelectorAll(".typerow").find((r) => r.querySelector("summary").textContent.includes("Store card"));
    row.querySelector("summary").click();
    const reset = buttonNamed(row, "Use workspace colour");
    assert.ok(reset, "a personal colour offers resetting back to the workspace's own");
    reset.click();
    await Promise.resolve();
    assert.deepEqual(calls.at(-1), { accountTypeColors: null });
  });

  test("merchant type appearance: a compact row exists for the workspace's merchant type, with the same picker components", () => {
    const { view } = boot(baseState());
    const card = view.element.querySelector('[aria-labelledby="set-mtype-colours"]');
    assert.ok(card, "the merchant type appearance card exists");
    const row = card.querySelectorAll(".typerow").find((r) => r.querySelector("summary").textContent.includes("Retailer"));
    assert.ok(row, "Retailer has its own compact row");
    row.querySelector("summary").click();
    assert.ok(row.querySelector(".catrow").querySelector(".themepick__toggle"), "the same colour picker component is used");
  });

  test("each personal-appearance card links to where the record is actually created or renamed for everyone", () => {
    const { view } = boot(baseState());
    assert.ok(buttonNamed(view.element, "Manage workspace categories"));
    assert.ok(buttonNamed(view.element, "Manage workspace account types"));
    assert.ok(buttonNamed(view.element, "Manage workspace merchant types"));
  });
});
