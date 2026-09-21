// BT-013-16 — the real workspace Layout Picker (app/js/ui/views/layoutpicker.js). Cards render from
// the real /api/workspace-layouts response; Apply reuses the existing workspaces settings PATCH;
// hide/restore and colours call the new /api/workspace-layouts PATCH actions. The appearance cog's
// own internal popover mechanics are exercised in real-browser e2e, not this lightweight DOM double —
// here only its presence and accessible name are checked. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createLayoutPicker } from "../js/ui/views/layoutpicker.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i += 1) await tick(); };

const LEDGERFLY = { id: "ledgerfly-forecast", name: "Executive Forecast", tagline: "t", accentLight: "#1a4d7a", accentDark: "#5aa3e8", system: false, colorable: true };
const FINEXA = { id: "finexa-budget", name: "Budget Workspace", tagline: "t", accentLight: "#6a1a9e", accentDark: "#c98ef0", system: false, colorable: true };
const ACRU = { id: "acru-overview", name: "Financial Overview", tagline: "t", accentLight: "#4a7a0a", accentDark: "#a3e85a", system: false, colorable: true };
const CLASSIC = { id: "classic", name: "Classic (current)", system: true, colorable: false };

function layouts({ currentId = "classic", canApply = true, canManage = true, hiddenIds = [], retiredIds = [] } = {}) {
  const base = [CLASSIC, LEDGERFLY, FINEXA, ACRU];
  return base.map((l) => ({
    ...l, current: l.id === currentId, hidden: hiddenIds.includes(l.id), retired: retiredIds.includes(l.id),
    selectable: l.system || !retiredIds.includes(l.id), workspaceColors: null, personalColors: null,
  }));
}
const DEMO = [{ id: "executive-ledger", name: "Ledger Command", tagline: "A running strip of the figures that matter." }];

function page(overrides = {}) {
  const calls = { patchWorkspace: [], patchLayout: [], preferences: [], refreshed: 0 };
  let current = overrides.currentId || "classic";
  const state = { selectedWorkspaceId: "ws_1" };
  const api = {
    workspaceLayouts: async () => ({ workspaceId: "ws_1", currentLayoutId: current, canApply: overrides.canApply !== false, canManage: overrides.canManage !== false, layouts: layouts({ ...overrides, currentId: current }), demoLayouts: DEMO }),
    patchWorkspaceLayout: async (id, body) => {
      calls.patchLayout.push(body);
      if (overrides.refuseLayout) throw Object.assign(new Error(overrides.refuseLayout), { kind: "client", message: overrides.refuseLayout });
      if (body.action === "hide") return { hiddenLayouts: [body.layoutId] };
      if (body.action === "restore") return { hiddenLayouts: [] };
      return { layoutColors: {} };
    },
    request: async (name, opts = {}) => {
      if (name === "workspaces" && opts.method === "PATCH") {
        calls.patchWorkspace.push(opts.body);
        if (overrides.refuseApply) throw Object.assign(new Error(overrides.refuseApply), { kind: "client", message: overrides.refuseApply });
        current = opts.body.settings.layoutId;
        return { workspace: {} };
      }
      return {};
    },
  };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn) => { try { const result = await fn("ws_1"); return { ok: true, result }; } catch (error) { return { ok: false, error }; } },
      refreshWorkspaces: async () => { calls.refreshed += 1; return { ok: true }; },
      savePreferences: async (body) => { calls.preferences.push(body); return { ok: true }; },
    },
  };
  return { ctx: { api, store }, calls };
}

async function open(overrides) {
  const { ctx, calls } = page(overrides);
  const picker = createLayoutPicker(ctx);
  dom.body.appendChild(picker.element);
  await picker.load();
  await settle();
  return { picker, calls, root: picker.element };
}

const cardsOf = (root) => root.querySelectorAll("article.layoutpicker-card").filter((c) => !c.classList.contains("layoutpicker-card--demo"));
const cardNamed = (root, name) => cardsOf(root).find((c) => c.querySelector("h3").textContent === name);
const buttonNamed = (card, text) => card.querySelectorAll("button").find((b) => b.textContent === text);
const badgesOf = (card) => card.querySelectorAll(".badge").map((b) => b.textContent);

describe("BT-013-16 the real Layout Picker", () => {
  test("renders the four real layouts plus the demo-only concepts; the current layout is clearly marked", async () => {
    const { root } = await open();
    const cards = cardsOf(root);
    assert.deepEqual(cards.map((c) => c.querySelector("h3").textContent), ["Classic (current)", "Executive Forecast", "Budget Workspace", "Financial Overview"]);
    assert.ok(badgesOf(cardNamed(root, "Classic (current)")).includes("Currently applied"));
    assert.ok(!badgesOf(cardNamed(root, "Executive Forecast")).includes("Currently applied"));
    const demo = root.querySelectorAll("article.layoutpicker-card--demo");
    assert.equal(demo.length, 1);
    assert.equal(demo[0].querySelector("h3").textContent, "Ledger Command");
    assert.ok(demo[0].textContent.includes("Demo only"));
    // The demo card offers no Apply/Preview/Remove controls at all — never a premature Apply.
    assert.equal(demo[0].querySelectorAll("button").length, 0);
  });

  test("Apply reuses the existing workspace settings PATCH, refreshes and shows the new current layout", async () => {
    const { root, calls } = await open();
    const card = cardNamed(root, "Executive Forecast");
    const apply = buttonNamed(card, "Apply to workspace");
    assert.ok(apply && !apply.disabled);
    apply.click();
    await settle();
    assert.deepEqual(calls.patchWorkspace, [{ settings: { layoutId: "ledgerfly-forecast" } }]);
    assert.equal(calls.refreshed, 1);
    assert.ok(badgesOf(cardNamed(root, "Executive Forecast")).includes("Currently applied"));
    assert.ok(!badgesOf(cardNamed(root, "Classic (current)")).includes("Currently applied"));
  });

  test("a member (canApply/canManage false) sees Apply and management actions disabled, never hidden entirely", async () => {
    const { root, calls } = await open({ canApply: false, canManage: false });
    const card = cardNamed(root, "Budget Workspace");
    const apply = buttonNamed(card, "Apply to workspace");
    assert.ok(apply.disabled);
    apply.click();
    await settle();
    assert.equal(calls.patchWorkspace.length, 0, "a disabled button never fires the action");
    assert.equal(buttonNamed(card, "Remove from this workspace's choices"), undefined, "only owners/managers get the management action at all");
  });

  test("a retired layout cannot be newly applied, but Classic (system) is never offered a Remove action", async () => {
    const { root } = await open({ retiredIds: ["finexa-budget"] });
    const retiredCard = cardNamed(root, "Budget Workspace");
    assert.ok(badgesOf(retiredCard).includes("Retired by the site administrator"));
    assert.ok(buttonNamed(retiredCard, "Apply to workspace").disabled);
    const classicCard = cardNamed(root, "Classic (current)");
    assert.equal(buttonNamed(classicCard, "Remove from this workspace's choices"), undefined);
  });

  test("hide removes a layout from this workspace's choices; restore brings it back; both call the real PATCH action", async () => {
    const { root, calls } = await open();
    const card = cardNamed(root, "Financial Overview");
    buttonNamed(card, "Remove from this workspace's choices").click();
    await settle();
    assert.deepEqual(calls.patchLayout.at(-1), { action: "hide", layoutId: "acru-overview" });
  });

  test("a failed apply shows the server's message and never marks the layout current", async () => {
    const { root, calls } = await open({ refuseApply: "This layout has been retired by the site administrator and cannot be newly applied." });
    const card = cardNamed(root, "Executive Forecast");
    buttonNamed(card, "Apply to workspace").click();
    await settle();
    const error = root.querySelectorAll(".error-text").find((e) => e.getAttribute("role") === "alert");
    assert.ok(error && error.textContent.includes("retired"));
    assert.ok(!badgesOf(cardNamed(root, "Executive Forecast")).includes("Currently applied"));
    void calls;
  });

  test("Preview is present, as the card spec asks, but honestly disabled until the takeover is built", async () => {
    const { root } = await open();
    const card = cardNamed(root, "Executive Forecast");
    const preview = buttonNamed(card, "Preview");
    assert.ok(preview);
    assert.ok(preview.disabled);
  });

  test("each colorable layout gets an accessible appearance cog for the caller's own colours; Classic (no accent identity) gets none", async () => {
    const { root } = await open();
    const forecastCard = cardNamed(root, "Executive Forecast");
    const cog = forecastCard.querySelectorAll(".gcog__toggle").find((b) => b.getAttribute("aria-label") === "Customize colours for Executive Forecast — my colours");
    assert.ok(cog, "the personal colour cog is present and accessibly named");
    // A manager also gets a second cog for the workspace default, plus the explicit publish action.
    assert.ok(forecastCard.querySelectorAll(".gcog__toggle").find((b) => b.getAttribute("aria-label") === "Customize colours for Executive Forecast — workspace default"));
    assert.ok(buttonNamed(forecastCard, "Use my colours as the workspace default"));
    const classicCard = cardNamed(root, "Classic (current)");
    assert.equal(classicCard.querySelectorAll(".gcog__toggle").length, 0, "Classic has no Gallery accent identity to customize");
  });

  test("a member (not a manager) never sees the workspace-default cog or the publish action, only their own", async () => {
    const { root } = await open({ canManage: false });
    const card = cardNamed(root, "Financial Overview");
    assert.equal(card.querySelectorAll(".gcog__toggle").length, 1, "only the personal cog");
    assert.equal(buttonNamed(card, "Use my colours as the workspace default"), undefined);
  });
});
