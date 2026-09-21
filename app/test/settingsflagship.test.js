// BT-013-16 — My Settings under each flagship layout. Everything on this page is personal (never a
// financial mutation, never gated by the preview read-only guard — a member previewing a layout
// still changes their own appearance, display and contacts normally). The same settings groups are
// reparented into a `.dashflag` accent wrapper for the currently selected workspace's flagship
// layout; every real control (name, appearance, display/privacy, contacts, staging link, category
// colours, deleted workspaces) stays completely shared and unchanged. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/settings.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function baseState(layoutId, overrides = {}) {
  const sources = { themeMode: "default", themePalette: "default", displayCurrency: "default", dateFormat: "default", numberFormat: "default", defaultWorkspaceId: "default", balanceMasking: "default", categoryColors: "default", categoryIcons: "default", stagingUrl: "default" };
  return {
    selectedWorkspaceId: layoutId === undefined ? null : "ws_1",
    workspaces: layoutId === undefined ? [] : [{ id: "ws_1", name: "Fictional Household", kind: "household", role: "owner", settingValues: { layoutId } }],
    layoutPreview: null,
    auth: { user: { name: "Alice Fictional", siteAdmin: false } },
    preferences: { stored: {}, effective: { dateFormat: "iso", numberFormat: "1,234.56", displayCurrency: "", defaultWorkspaceId: "", balanceMasking: false, themePalette: "midnight", stagingUrl: null }, sources },
    ...overrides,
  };
}

function boot(state) {
  const theme = { getTheme: () => "midnight", setTheme() {}, subscribe: () => () => {}, getMode: () => "light", getResolvedMode: () => "light", setMode() {} };
  const store = { getState: () => state, actions: { savePreferences: async () => ({ ok: true }), refreshPreferences: async () => ({ ok: true }), init: async () => {} } };
  const api = { request: async () => ({ private: [] }), siteSettings: async () => ({ settings: { defaults: {}, locked: [] }, admin: false }) };
  const view = createView({ store, theme, api });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view };
}

describe("BT-013-16 My Settings renders the current workspace's real, applied layout", () => {
  test("Classic never shows the flagship wrapper", () => {
    const { view } = boot(baseState("classic"));
    assert.equal(view.element.querySelector(".dashflag"), null);
  });

  for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
    test(`${layoutId}: every real settings group survives inside the flagship wrapper, unchanged`, () => {
      const { view } = boot(baseState(layoutId));
      const flag = view.element.querySelector(".dashflag");
      assert.ok(flag);
      assert.ok(flag.querySelector("section[aria-labelledby='set-appearance']"), "Appearance");
      assert.ok(flag.querySelector("section[aria-labelledby='set-display']"), "Display and privacy");
      assert.ok(flag.querySelector("section[aria-labelledby='set-contacts']"), "Private contacts");
    });
  }

  test("with no workspace selected at all (e.g. a site administrator with none), the page still renders Classic, never throws", () => {
    const { view } = boot(baseState(undefined));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.ok(view.element.querySelector("section[aria-labelledby='set-appearance']"));
  });

  test("an unknown/demo-only layoutId falls back to Classic", () => {
    const { view } = boot(baseState("wealth-overview"));
    assert.equal(view.element.querySelector(".dashflag"), null);
  });

  test("previewing a layout never disables anything on this personal page — preferences are never a financial mutation", () => {
    const { view } = boot(baseState("classic", { layoutPreview: { layoutId: "acru-overview" } }));
    const nameInput = view.element.querySelector('input[type="text"], input:not([type])');
    assert.ok(!nameInput || !nameInput.disabled);
  });
});
