// Hash routing: deep links work on Static Web Apps without server rewrites, and the router is
// DOM-free apart from the injected location adapter.

export const ROUTES = Object.freeze([
  { id: "dashboard", path: "/dashboard", label: "Dashboard" },
  { id: "transactions", path: "/transactions", label: "Transactions" },
  { id: "bills", path: "/bills", label: "Bills" },
  { id: "planning", path: "/planning", label: "Planning" },
  { id: "accounts", path: "/accounts", label: "Accounts" },
  { id: "payees", path: "/payees", label: "Merchants" },
  { id: "workspace", path: "/workspace", label: "Workspace" },
  { id: "settings", path: "/settings", label: "My settings" },
  { id: "join", path: "/join", label: "Join", hidden: true },
]);

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

export function createRouter(win = globalThis) {
  const listeners = new Set();
  let current = parseHash(win.location.hash);
  const onChange = () => { current = parseHash(win.location.hash); for (const l of listeners) l(current); };
  return {
    current: () => current,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    navigate(id, params) { win.location.hash = buildHash(id, params); },
    start() { win.addEventListener("hashchange", onChange); onChange(); },
  };
}
