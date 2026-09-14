// THE canonical client state (pattern from TaskTracker app/js/core/store.js).
//
// * One state object, deep-frozen on every commit, so a view that mutates shared data throws at
//   the point of the bug instead of corrupting another view.
// * Views read state and call actions; they never fetch for themselves (api.js is the only fetch).
// * WORKSPACE ISOLATION, three layers: a synchronous reset of workspace data on switch, a
//   generation token that discards responses for an abandoned workspace, and every workspace
//   slice records the workspaceId it belongs to (selectors refuse a slice for another workspace).
// * Writes post, then re-read authoritative data. A 409 re-reads and reports a conflict rather
//   than overwriting.
import { ApiError, ErrorKind } from "./errors.js";

export const Status = Object.freeze({ IDLE: "idle", LOADING: "loading", READY: "ready", ERROR: "error" });

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value) || Object.isFrozen(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

const emptySlice = (workspaceId) => ({ workspaceId, status: Status.IDLE, error: null });

export function initialState() {
  return {
    auth: { status: Status.LOADING, user: null },
    app: null, site: null, preferences: null,
    workspaces: [], selectedWorkspaceId: null,
    accounts: emptySlice(null), transactions: emptySlice(null), payees: emptySlice(null),
    categories: emptySlice(null), members: emptySlice(null), bills: emptySlice(null),
    budgets: emptySlice(null), forecast: emptySlice(null), icons: emptySlice(null), group: emptySlice(null),
  };
}

export function createStore({ api }) {
  let state = deepFreeze(initialState());
  let generation = 0;
  let lastForecast = { horizon: "90" };
  let lastCatalog = null;
  const listeners = new Set();

  function commit(patch) {
    state = deepFreeze({ ...state, ...patch });
    for (const l of listeners) l(state);
    return state;
  }

  const handleAuthLoss = (err) => {
    if (err instanceof ApiError && err.kind === ErrorKind.UNAUTHENTICATED) commit({ auth: { status: Status.READY, user: null } });
  };

  // Loads one workspace slice under the current generation. A response for a workspace the person
  // has since left is discarded rather than rendered.
  async function loadSlice(name, fetcher) {
    const wsId = state.selectedWorkspaceId;
    const token = generation;
    if (!wsId) return;
    commit({ [name]: { ...emptySlice(wsId), status: Status.LOADING, data: state[name].workspaceId === wsId ? state[name].data : undefined } });
    try {
      const data = await fetcher(wsId);
      if (token !== generation || state.selectedWorkspaceId !== wsId) return;
      commit({ [name]: { workspaceId: wsId, status: Status.READY, error: null, data } });
    } catch (err) {
      if (token !== generation || state.selectedWorkspaceId !== wsId) return;
      handleAuthLoss(err);
      commit({ [name]: { workspaceId: wsId, status: Status.ERROR, error: err, data: undefined } });
    }
  }

  const actions = {
    async init() {
      try {
        const me = await api.me();
        commit({
          auth: { status: Status.READY, user: me.user }, app: me.app, site: me.site, preferences: me.preferences,
          workspaces: me.workspaces,
        });
        const preferred = me.preferences && me.preferences.effective && me.preferences.effective.defaultWorkspaceId;
        const first = me.workspaces.find((w) => w.id === preferred) || me.workspaces.find((w) => w.status === "active") || me.workspaces[0];
        if (first) await actions.selectWorkspace(first.id);
      } catch (err) {
        if (err instanceof ApiError && err.kind === ErrorKind.UNAUTHENTICATED) commit({ auth: { status: Status.READY, user: null } });
        else commit({ auth: { status: Status.ERROR, user: null, error: err } });
      }
    },

    async selectWorkspace(id) {
      generation += 1;
      // Synchronous reset BEFORE any await, so nothing from the previous workspace can render.
      commit({
        selectedWorkspaceId: id,
        accounts: emptySlice(id), transactions: emptySlice(id), payees: emptySlice(id), categories: emptySlice(id), members: emptySlice(id), bills: emptySlice(id),
        budgets: emptySlice(id), forecast: emptySlice(id), icons: emptySlice(id), group: emptySlice(id),
      });
      await Promise.all([actions.refreshAccounts(), actions.refreshCategories(), actions.refreshPayees(), actions.refreshMembers(), actions.refreshIcons()]);
    },

    refreshAccounts: () => loadSlice("accounts", (id) => api.accounts(id)),
    refreshCategories: () => loadSlice("categories", (id) => api.categories(id)),
    refreshPayees: () => loadSlice("payees", (id) => api.payees(id)),
    refreshMembers: () => loadSlice("members", (id) => api.members(id)),
    // The icon catalogue with this workspace's type icons (BT-011-05). The last catalogue is kept and
    // its version sent back, so an unchanged catalogue is not downloaded again (SEC-I4).
    refreshIcons: () => loadSlice("icons", async (id) => {
      const res = await api.icons(id, lastCatalog ? lastCatalog.etag : undefined);
      if (res.catalog === null && lastCatalog && lastCatalog.etag === res.catalogEtag) return { ...res, catalog: lastCatalog.catalog };
      lastCatalog = { etag: res.catalogEtag, catalog: res.catalog };
      return res;
    }),
    refreshTransactions: (filters = {}) => loadSlice("transactions", (id) => api.transactions(id, filters)),
    refreshBills: () => loadSlice("bills", (id) => api.bills(id)),
    refreshBudgets: () => loadSlice("budgets", (id) => api.budgets(id)),
    // Shared expenses and settlement (BT-009): expenses, payments and derived balances.
    refreshGroup: () => loadSlice("group", (id) => api.group(id)),
    // The last forecast parameters are kept, so a refresh after a write keeps the chosen horizon.
    refreshForecast: (params) => { if (params) lastForecast = params; return loadSlice("forecast", (id) => api.forecast(id, lastForecast)); },

    async createWorkspace(body, key) {
      const out = await api.createWorkspace(body, key);
      const list = await api.workspaces();
      commit({ workspaces: list.workspaces });
      await actions.selectWorkspace(out.workspace.id);
      return out.workspace;
    },

    // Every write re-reads the affected slices afterwards; the server is the source of truth.
    async write(fn, refresh = ["accounts", "transactions", "payees"]) {
      const wsId = state.selectedWorkspaceId;
      try {
        const result = await fn(wsId);
        await Promise.all(refresh.map((name) => actions[`refresh${name[0].toUpperCase()}${name.slice(1)}`]()));
        return { ok: true, result };
      } catch (err) {
        handleAuthLoss(err);
        if (err instanceof ApiError && err.kind === ErrorKind.CONFLICT) {
          await Promise.all(refresh.map((name) => actions[`refresh${name[0].toUpperCase()}${name.slice(1)}`]()));
        }
        return { ok: false, error: err };
      }
    },

    async savePreferences(patch) {
      try {
        const prefs = await api.savePreferences(patch);
        commit({ preferences: prefs });
        return { ok: true };
      } catch (err) {
        handleAuthLoss(err);
        return { ok: false, error: err };
      }
    },
  };

  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    actions,
  };
}

// Selector guard: a slice is only usable for the workspace it belongs to.
export function sliceFor(state, name) {
  const slice = state[name];
  if (!slice || slice.workspaceId !== state.selectedWorkspaceId) return { status: Status.LOADING };
  return slice;
}
