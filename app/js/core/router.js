// Hash routing: deep links work on Static Web Apps without server rewrites, and the router is
// DOM-free apart from the injected location adapter.

import { sharedExpensesOn } from "./workspacesettings.js";

// `feature` shows a section only while that feature is on for the workspace. Shared expenses (BT-009)
// follow the workspace setting (Terry, 2026-09-14), bounded by the site's module switch; without a
// setting, today's rule by kind: groups, trips and households, where couples and housemates split costs
// too, and not personal workspaces. When it is off the page says so and the server refuses its routes.
export const ROUTES = Object.freeze([
  { id: "dashboard", path: "/dashboard", label: "Dashboard", icon: "home" },
  { id: "group", path: "/group", label: "Shared expenses", feature: "sharedExpenses", icon: "users" },
  { id: "transactions", path: "/transactions", label: "Transactions", icon: "receipt" },
  { id: "bills", path: "/bills", label: "Bills", icon: "calendar" },
  { id: "planning", path: "/planning", label: "Planning", icon: "chart-line" },
  { id: "accounts", path: "/accounts", label: "Accounts", icon: "bank" },
  { id: "payees", path: "/payees", label: "Merchants", icon: "store" },
  { id: "workspace", path: "/workspace", label: "Workspace", icon: "building" },
  { id: "settings", path: "/settings", label: "My settings", icon: "user" },
  { id: "join", path: "/join", label: "Join", hidden: true },
  // Site usage (BT-012-01): site administrators only. Not a workspace section, so it is left out of
  // navRoutes() (like "join") and added to the nav directly by the shell, only for site admins.
  { id: "analytics", path: "/analytics", label: "Usage", hidden: true, icon: "chart-pie" },
  // Design Gallery (BT-013): site administrators only, for the same reason as Usage above — not a
  // workspace section, added to the nav directly by the shell, only for site admins.
  { id: "gallery", path: "/gallery", label: "Design Gallery", hidden: true, icon: "target" },
  // Site-admin workspace directory and administrative permanent deletion (BT-014-03/04): site
  // administrators only, extending the same small site-admin surface as Usage and Design Gallery
  // above rather than a new nav paradigm (Terry's own instruction). Never financial content.
  { id: "admin-workspaces", path: "/admin-workspaces", label: "Workspaces", hidden: true, icon: "briefcase" },
  // Account-request approval (BT-014-17): site administrators only, the fourth Site Settings
  // sub-tab alongside Workspaces/Design Gallery/Usage above.
  { id: "account-requests", path: "/account-requests", label: "Account requests", hidden: true, icon: "user" },
]);

// The sections shown in the nav for this workspace (a workspace summary, or just its kind) and site.
export function navRoutes(workspace, site) {
  const ws = typeof workspace === "string" ? { kind: workspace } : workspace || null;
  return ROUTES.filter((r) => !r.hidden && (r.feature !== "sharedExpenses" || sharedExpensesOn(ws, site)));
}

export function parseHash(hash) {
  const raw = String(hash || "").replace(/^#/, "") || "/dashboard";
  const [path, qs = ""] = raw.split("?");
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  return { id: route.id, params: Object.fromEntries(new URLSearchParams(qs)) };
}

export function buildHash(id, params = {}) {
  const route = ROUTES.find((r) => r.id === id) || ROUTES[0];
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
  return `#${route.path}${qs ? `?${qs}` : ""}`;
}

// A guard (the shell's unsaved-changes question, UX/accessibility review of eefd115, finding 3) is asked
// before the page is left within the app. When it says no, the address is put back and nobody is told of
// a change; the browser's report of that put-back is ignored.
export function createRouter(win = globalThis) {
  const listeners = new Set();
  let current = parseHash(win.location.hash);
  let currentHash = win.location.hash;
  let guard = null;
  let restoring = null;
  const onChange = () => {
    const hash = win.location.hash;
    if (restoring !== null) { const was = restoring; restoring = null; if (hash === was) return; }
    if (guard && hash !== currentHash && !guard(hash)) { restoring = currentHash; win.location.hash = currentHash; return; }
    currentHash = hash;
    current = parseHash(hash);
    for (const l of listeners) l(current);
  };
  return {
    current: () => current,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    navigate(id, params) { win.location.hash = buildHash(id, params); },
    setGuard(fn) { guard = fn; },
    // Goes to an address the person has chosen to go to (after the guard's question).
    go(hash) { win.location.hash = hash; },
    start() { win.addEventListener("hashchange", onChange); onChange(); },
  };
}
