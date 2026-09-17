// BT-012-01 site usage (Terry 2026-09-14: "usage statistics ... should use nice graphics"). Proves:
// the view fetches and renders nothing for a non-admin, renders a fictional fixture without
// crashing for a site administrator (with every chart figure also given as real text), and that the
// shell's nav shows "Usage" only for a site administrator — never for anyone else, and never without
// one. Layout, contrast and real screen-reader output are checked in a real browser, not here.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installDom } from "./domdouble.js";
import { createView as createAnalytics, barChart, lineChart } from "../js/ui/views/analytics.js";
import { createShell } from "../js/ui/shell.js";
import { createThemeController } from "../js/ui/theme.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const FIXTURE = {
  totals: { users: 3, activeThisWeek: 3, workspaces: 2 },
  signInsPerDay: [{ date: "2026-09-01", count: 1 }, { date: "2026-09-02", count: 2 }],
  newUsersPerDay: [{ date: "2026-09-01", count: 1 }, { date: "2026-09-02", count: 2 }],
  workspacesByKindStatus: { "household:active": 1, "personal:archived": 1 },
  users: [
    { subject: "google:g-bob", createdAt: "2026-09-02T09:00:00.000Z", lastActiveAt: "2026-09-02T09:00:00.000Z" },
    { subject: "google:g-alice", createdAt: "2026-09-01T09:00:00.000Z", lastActiveAt: "2026-09-01T09:00:00.000Z" },
  ],
  usersTruncated: false,
};

describe("BT-012-01 the Usage view", () => {
  test("a non-admin sees nothing and nothing is fetched", async () => {
    let calls = 0;
    const view = createAnalytics({ api: { analytics: async () => { calls += 1; return FIXTURE; } } });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: false } } });
    await tick();
    assert.equal(calls, 0);
    const notAdmin = view.element.querySelector("p.muted");
    assert.equal(notAdmin.hidden, false);
    assert.equal(view.element.querySelector(".stack").hidden, true);
  });

  test("a site administrator's fixture renders without crashing, with every chart figure also given as text", async () => {
    const view = createAnalytics({ api: { analytics: async () => FIXTURE } });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    const content = view.element.querySelector(".stack");
    assert.equal(content.hidden, false);
    assert.equal(view.element.querySelector("p.muted").hidden, true);
    // Stats row: total users, active this week, workspaces.
    const values = [...view.element.querySelectorAll(".card__value")].map((n) => n.textContent);
    assert.deepEqual(values, ["3", "3", "2"]);
    // Both charts drew SVG shapes (decorative), and a visually hidden table gives the same numbers
    // as real text, the same rule as the app's other decorative meters.
    const line = view.element.querySelector("svg.chart--line");
    const bars = view.element.querySelector("svg.chart--bars");
    assert.ok(line && line.getAttribute("aria-hidden") === "true");
    assert.ok(bars && bars.getAttribute("aria-hidden") === "true");
    assert.ok(line.querySelector("polyline"));
    assert.ok(bars.querySelectorAll("rect").length === 2);
    const tables = view.element.querySelectorAll("table.sr-only");
    assert.equal(tables.length, 2);
    const barFigures = [...tables[1].querySelectorAll("td")].map((n) => n.textContent);
    assert.deepEqual(barFigures, ["1", "2"]);
    // Workspace counts by kind and status, and the people list (subject, first seen, last active —
    // never a name or email, which nothing shows a site administrator today).
    assert.match(view.element.textContent, /Household, active/);
    assert.match(view.element.textContent, /Personal, archived/);
    assert.match(view.element.textContent, /google:g-bob/);
    assert.doesNotMatch(view.element.textContent, /Bob Fictional|bob@example\.com/);
  });

  test("an API failure is shown in the person's own words, not left blank forever", async () => {
    const view = createAnalytics({ api: { analytics: async () => { throw { status: 403, code: "forbidden", message: "Only site administrators can see site usage." }; } } });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    assert.match(view.element.textContent, /Only site administrators can see site usage\./);
  });

  test("the chart primitives draw from an empty fixture without dividing by zero or crashing", () => {
    assert.doesNotThrow(() => lineChart([]));
    assert.doesNotThrow(() => barChart([]));
    assert.doesNotThrow(() => lineChart([{ date: "2026-09-01", count: 0 }]));
  });

  test("no innerHTML, outerHTML or insertAdjacentHTML anywhere in the view (also enforced repo-wide by scripts/validate.cjs)", () => {
    const src = readFileSync(fileURLToPath(new URL("../js/ui/views/analytics.js", import.meta.url)), "utf8");
    assert.doesNotMatch(src, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/);
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
  const shell = createShell({ mountPoint, store, router, theme, api: { analytics: async () => FIXTURE } });
  shell.render();
  return { mountPoint, header: mountPoint.querySelector(".app__header"), nav: mountPoint.querySelector(".app__nav") };
}

describe("BT-012-01 the nav entry: site administrators only", () => {
  test("no 'Usage' entry for a signed-in person who is not a site administrator", () => {
    const store = recordingStore();
    const { nav } = boot(store);
    const links = [...nav.querySelectorAll("a")].map((a) => a.textContent);
    assert.ok(!links.includes("Usage"), links.join(", "));
  });

  test("'Usage' appears in the nav for a site administrator, and links to #/analytics", () => {
    const store = recordingStore({ auth: { status: "ready", user: { name: "Dave Siteadmin", siteAdmin: true } } });
    const { nav } = boot(store);
    const usage = [...nav.querySelectorAll("a")].find((a) => a.textContent === "Usage");
    assert.ok(usage, "Usage link is present");
    assert.equal(usage.getAttribute("href"), "#/analytics");
  });

  test("a non-admin who opens #/analytics directly gets no content and no nav entry, not a crash", () => {
    const store = recordingStore();
    const { mountPoint, nav } = boot(store, "analytics");
    const links = [...nav.querySelectorAll("a")].map((a) => a.textContent);
    assert.ok(!links.includes("Usage"));
    assert.match(mountPoint.querySelector("main").textContent, /only shown to site administrators/);
  });

  // Regression (found in real-browser testing, BT-004-06): a site administrator is usually not a
  // member of anything (site administration is configuration, never membership), so with zero
  // workspaces the onboarding screen shows and the SECTION nav is never populated — exactly the
  // reason "My settings" lives in the account menu instead. "Usage" must too, or a pure site
  // administrator would have no way to reach it at all.
  test("a site administrator with no workspace (onboarding) can still reach Usage, from the account menu", () => {
    const store = recordingStore({ workspaces: [], selectedWorkspaceId: null, auth: { status: "ready", user: { name: "Dave Siteadmin", siteAdmin: true } } });
    const { mountPoint } = boot(store);
    assert.match(mountPoint.querySelector("main").textContent, /Create a workspace|workspace/i, "onboarding is indeed showing");
    const usage = mountPoint.querySelector('a[href="#/analytics"]');
    assert.ok(usage, "a Usage link exists somewhere in the header, even during onboarding");
    assert.equal(usage.textContent, "Usage");
  });

  test("a non-admin with no workspace has no Usage entry anywhere, including the account menu", () => {
    const store = recordingStore({ workspaces: [], selectedWorkspaceId: null });
    const { mountPoint } = boot(store);
    assert.equal(mountPoint.querySelector('a[href="#/analytics"]'), null);
  });
});
