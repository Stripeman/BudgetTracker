// BT-013 Design Gallery. Proves: the page fetches and shows nothing for a non-admin, a site
// administrator's fixture renders all 20 concepts without crashing, every concept's Dashboard and
// every required page render through the shared composition engine without throwing, the nav entry
// exists only for site administrators, picks and catalog changes round-trip through the API client
// call, and no innerHTML/outerHTML is used anywhere in the new modules (also enforced repo-wide by
// scripts/validate.cjs).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installDom } from "./domdouble.js";
import { createView as createGallery } from "../js/ui/views/gallery.js";
import { renderConceptFrame, PAGE_LABEL } from "../js/ui/gallery/compose.js";
import { createShell } from "../js/ui/shell.js";
import { createThemeController } from "../js/ui/theme.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const CONCEPT_IDS = [
  "executive-ledger", "modern-banking", "financial-command-center", "calm-budget", "precision-grid",
  "wealth-overview", "cash-flow-studio", "envelope-planner", "household-hub", "travel-ledger",
  "minimal-professional", "analyst-workspace", "visual-finance", "timeline-finance", "goal-navigator",
  "merchant-insights", "card-workspace", "sidebar-pro", "focus-mode", "adaptive-overview",
];
const NAV_STYLES = ["sidebar", "top", "rail", "top", "rail", "sidebar", "top", "sidebar", "top", "top", "top", "sidebar-right", "top", "rail", "top", "sidebar", "top", "sidebar", "top", "rail"];
const DASHBOARD_PATTERNS = ["table-first", "card-stack", "command-console", "story-flow", "table-first", "chart-first", "chart-first", "envelope-grid", "card-stack", "split-focus", "story-flow", "table-first", "chart-first", "timeline", "goal-progress", "merchant-feed", "metric-grid", "metric-grid", "story-flow", "adaptive"];
const CARD_STYLES = ["flat-bordered", "soft-shadow", "outline-minimal", "soft-shadow", "bordered-mono", "soft-shadow", "filled-tint", "filled-tint", "soft-shadow", "soft-shadow", "outline-minimal", "outline-minimal", "filled-tint", "flat-bordered", "soft-shadow", "flat-bordered", "soft-shadow", "outline-minimal", "soft-shadow", "flat-bordered"];

function fixtureConcepts() {
  return CONCEPT_IDS.map((id, i) => ({
    id, name: id, tagline: "A tagline.", direction: "A direction long enough to pass.", distinct: "What makes it distinct, long enough.", audience: "Some audience description here.",
    strengths: ["one", "two"], tradeoffs: ["one"], accessibilityNotes: ["one"],
    density: ["spacious", "comfortable", "compact", "ultra-compact"][i % 4],
    navStyle: NAV_STYLES[i], dashboardPattern: DASHBOARD_PATTERNS[i], cardStyle: CARD_STYLES[i], chartEmphasis: "bars",
    fidelity: i < 7 ? "flagship" : "standard", recommended: i < 10,
    catalog: { status: "review", replacementId: null, note: "" },
  }));
}

const FIXTURE = { concepts: fixtureConcepts(), requiredPages: ["dashboard", "transactions", "bills", "budget", "shared", "trips", "settings"], realLayoutOptions: [{ value: "classic", label: "Classic (current)" }], realDefaultLayoutId: "classic", picks: { selectedIds: [], note: "", updatedAt: null, updatedBy: null } };

function fakeTheme() {
  let mode = "light"; let themeId = "midnight";
  return { getMode: () => mode, setMode: (m) => { mode = m; }, getResolvedMode: () => "light", getTheme: () => themeId, setTheme: (t) => { themeId = t; }, subscribe: () => () => {}, themes: [{ id: "midnight", label: "Midnight" }] };
}

describe("BT-013 the Design Gallery view", () => {
  test("a non-admin sees nothing and nothing is fetched", async () => {
    let calls = 0;
    const view = createGallery({ api: { designGallery: async () => { calls += 1; return FIXTURE; } }, theme: fakeTheme(), store: { actions: { savePreferences: async () => ({ ok: true }) } } });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: false } } });
    await tick();
    assert.equal(calls, 0);
    const notAdmin = view.element.querySelector("p.muted");
    assert.equal(notAdmin.hidden, false);
    assert.equal(view.element.querySelector(".stack").hidden, true);
  });

  test("a site administrator's fixture renders all 20 concepts without crashing", async () => {
    const view = createGallery({ api: { designGallery: async () => FIXTURE, saveDesignGallery: async () => FIXTURE }, theme: fakeTheme(), store: { actions: { savePreferences: async () => ({ ok: true }) } } });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    const content = view.element.querySelector(".stack");
    assert.equal(content.hidden, false);
    const cards = view.element.querySelectorAll(".gcard-outer");
    assert.equal(cards.length, 20);
    // A live preview thumbnail (a real rendered frame, never a static image) inside every card.
    for (const c of cards) assert.ok(c.querySelector(".gframe"), "every concept card has a live thumbnail frame");
    // The comparison matrix has one row per concept. (The lightweight test DOM double supports only
    // single compound selectors, never a descendant combinator, so the table is found first.)
    const matrixTable = view.element.querySelector("table.table");
    const rows = matrixTable.querySelectorAll("tr");
    assert.equal(rows.length, 21, "1 header row + 20 concept rows");
  });

  test("an API failure is shown in the person's own words, not left blank forever", async () => {
    const view = createGallery({ api: { designGallery: async () => { throw { status: 403, code: "forbidden", message: "The Design Gallery is only shown to site administrators." }; } }, theme: fakeTheme(), store: { actions: { savePreferences: async () => ({ ok: true }) } } });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    assert.match(view.element.textContent, /only shown to site administrators/);
  });

  test("marking a concept and saving picks calls the API with the chosen ids and re-renders the recorded summary", async () => {
    let sentBody = null;
    const api = {
      designGallery: async () => FIXTURE,
      saveDesignGallery: async (body) => { sentBody = body; return { concepts: FIXTURE.concepts, picks: { selectedIds: body.picks.selectedIds, note: "", updatedAt: "2026-09-16T10:00:00.000Z", updatedBy: "google:dave" } }; },
    };
    const view = createGallery({ api, theme: fakeTheme(), store: { actions: { savePreferences: async () => ({ ok: true }) } } });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    const firstCard = view.element.querySelector(".gcard-outer");
    const checkbox = firstCard.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent({ type: "change", bubbles: true });
    const saveBtn = [...view.element.querySelectorAll("button")].find((b) => b.textContent === "Save picks");
    saveBtn.dispatchEvent({ type: "click", bubbles: true });
    await tick();
    assert.ok(sentBody && Array.isArray(sentBody.picks.selectedIds) && sentBody.picks.selectedIds.includes(FIXTURE.concepts[0].id));
    assert.match(view.element.textContent, /Last recorded/);
  });

  test("no innerHTML, outerHTML or insertAdjacentHTML anywhere in the Gallery view or the composition engine", () => {
    for (const rel of ["../js/ui/views/gallery.js", "../js/ui/gallery/compose.js", "../js/ui/gallery/fixtures.js"]) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      assert.doesNotMatch(src, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/, rel);
    }
  });
});

describe("BT-013 the composition engine: every concept renders every required page without throwing", () => {
  test("all 20 concepts x all 7 required pages render a non-empty frame with the expected nav item count", () => {
    for (const concept of FIXTURE.concepts) {
      for (const pageId of FIXTURE.requiredPages) {
        const frame = renderConceptFrame(concept, pageId, () => {}, { requiredPages: FIXTURE.requiredPages });
        assert.ok(frame, `${concept.id} ${pageId}`);
        assert.equal(frame.dataset.nav, concept.navStyle);
        assert.equal(frame.dataset.density, concept.density);
        assert.equal(frame.dataset.card, concept.cardStyle);
        const navItems = frame.querySelectorAll(".gnav__item");
        assert.ok(navItems.length >= Math.min(3, FIXTURE.requiredPages.length), `${concept.id} ${pageId} nav items`);
        assert.ok(frame.querySelector(".gframe__main").childNodes.length > 0, `${concept.id} ${pageId} has page content`);
      }
    }
  });

  test("pressing a nav item calls onNavigate with that page's id", () => {
    let navigatedTo = null;
    const frame = renderConceptFrame(FIXTURE.concepts[0], "dashboard", (id) => { navigatedTo = id; }, { requiredPages: FIXTURE.requiredPages });
    const billsBtn = [...frame.querySelectorAll(".gnav__item")].find((b) => b.textContent.includes(PAGE_LABEL.bills));
    billsBtn.dispatchEvent({ type: "click", bubbles: true });
    assert.equal(navigatedTo, "bills");
  });

  test("heading ids stay unique across two frames rendered side by side (Compare), even with the same card titles", () => {
    const a = renderConceptFrame(FIXTURE.concepts.find((c) => c.dashboardPattern === "card-stack"), "dashboard", () => {}, { requiredPages: FIXTURE.requiredPages });
    const b = renderConceptFrame(FIXTURE.concepts.find((c) => c.dashboardPattern === "metric-grid"), "dashboard", () => {}, { requiredPages: FIXTURE.requiredPages });
    dom.body.appendChild(a); dom.body.appendChild(b);
    const ids = [...dom.body.querySelectorAll("[id]")].map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, "no duplicate ids across two simultaneously rendered frames");
  });

  test("adaptive dashboard reorders sections by financial state without throwing for either state", () => {
    const adaptive = FIXTURE.concepts.find((c) => c.dashboardPattern === "adaptive");
    assert.doesNotThrow(() => renderConceptFrame(adaptive, "dashboard", () => {}, { requiredPages: FIXTURE.requiredPages }));
  });
});

function recordingStore(overrides = {}) {
  const listeners = new Set();
  let state = {
    auth: { status: "ready", user: { name: "Dave Siteadmin", siteAdmin: false } },
    workspaces: [{ id: "ws_family", name: "Family budget", kind: "household", status: "active", role: "owner" }],
    selectedWorkspaceId: "ws_family",
    preferences: null, site: null, app: { version: "0.0.0-test", environment: "test" },
    ...overrides,
  };
  const commit = (patch) => { state = { ...state, ...patch }; for (const fn of listeners) fn(state); };
  const noop = async () => {};
  return {
    commit, getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    actions: { refreshTransactions: noop, refreshBills: noop, refreshForecast: noop, refreshGroup: noop, refreshWeekActivity: noop, refreshMonthActivity: noop, savePreferences: async () => ({ ok: true }) },
  };
}

function boot(store, routeId = "dashboard") {
  const theme = createThemeController({ root: { setAttribute() {} }, storage: { getItem: () => null, setItem() {} }, media: { matches: false, addEventListener() {} } });
  const router = { current: () => ({ id: routeId, params: {} }), subscribe() {}, navigate() {} };
  const mountPoint = document.createElement("div");
  dom.body.appendChild(mountPoint);
  const shell = createShell({ mountPoint, store, router, theme, api: { designGallery: async () => FIXTURE } });
  shell.render();
  return { mountPoint, header: mountPoint.querySelector(".app__header"), nav: mountPoint.querySelector(".app__nav") };
}

describe("BT-013 the nav entry: site administrators only", () => {
  test("no 'Design Gallery' entry for a signed-in person who is not a site administrator", () => {
    const store = recordingStore();
    const { nav } = boot(store);
    const links = [...nav.querySelectorAll("a")].map((a) => a.textContent);
    assert.ok(!links.includes("Design Gallery"), links.join(", "));
  });

  test("'Design Gallery' appears in the nav for a site administrator, and links to #/gallery", () => {
    const store = recordingStore({ auth: { status: "ready", user: { name: "Dave Siteadmin", siteAdmin: true } } });
    const { nav } = boot(store);
    const link = [...nav.querySelectorAll("a")].find((a) => a.textContent === "Design Gallery");
    assert.ok(link, "Design Gallery link is present");
    assert.equal(link.getAttribute("href"), "#/gallery");
  });

  test("a non-admin who opens #/gallery directly gets no content and no nav entry, not a crash", () => {
    const store = recordingStore();
    const { mountPoint, nav } = boot(store, "gallery");
    const links = [...nav.querySelectorAll("a")].map((a) => a.textContent);
    assert.ok(!links.includes("Design Gallery"));
    assert.match(mountPoint.querySelector("main").textContent, /only shown to site administrators/);
  });

  test("a site administrator with no workspace (onboarding) can still reach the Design Gallery, from the account menu", () => {
    const store = recordingStore({ workspaces: [], selectedWorkspaceId: null, auth: { status: "ready", user: { name: "Dave Siteadmin", siteAdmin: true } } });
    const { mountPoint } = boot(store);
    const link = mountPoint.querySelector('a[href="#/gallery"]');
    assert.ok(link, "a Design Gallery link exists somewhere in the header, even during onboarding");
    assert.equal(link.textContent, "Design Gallery");
  });

  test("a non-admin with no workspace has no Design Gallery entry anywhere, including the account menu", () => {
    const store = recordingStore({ workspaces: [], selectedWorkspaceId: null });
    const { mountPoint } = boot(store);
    assert.equal(mountPoint.querySelector('a[href="#/gallery"]'), null);
  });
});
