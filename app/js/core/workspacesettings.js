// The selected workspace's settings as the app applies them (Terry, 2026-09-14). The server sends each
// workspace's current values in its summary (`settingValues`) and enforces every rule itself; these
// helpers only decide what the interface offers. A missing value means today's behaviour.

export function workspaceOf(state) {
  return ((state && state.workspaces) || []).find((w) => w.id === state.selectedWorkspaceId) || null;
}

export function settingValuesOf(state) {
  const ws = workspaceOf(state);
  return (ws && ws.settingValues) || {};
}

// Shared expenses (BT-009) for this workspace: off when the site administrator turned the module off;
// otherwise the workspace setting; without one, today's rule by kind (groups, trips and households).
const SHARED_BY_DEFAULT = ["group", "trip", "household"];
export function sharedExpensesOn(ws, site) {
  if (site && site.modules && site.modules.sharedExpenses === false) return false;
  if (!ws) return false;
  const v = ws.settingValues && typeof ws.settingValues.sharedExpenses === "boolean" ? ws.settingValues.sharedExpenses : null;
  return v === null ? SHARED_BY_DEFAULT.includes(ws.kind) : v;
}

// "Who manages shared lists": managers and owners, or members too when the workspace says so; never viewers.
export function managesSharedLists(state) {
  const ws = workspaceOf(state);
  const role = ws && ws.role;
  if (role === "owner" || role === "manager") return true;
  return role === "member" && settingValuesOf(state).sharedListManagers === "members";
}
