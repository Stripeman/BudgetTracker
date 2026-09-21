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
    budgets: emptySlice(null), forecast: emptySlice(null), icons: emptySlice(null), group: emptySlice(null), monthActivity: emptySlice(null), weekActivity: emptySlice(null),
    // BT-019-02/01/03: workspace-scoped account/category/merchant type definitions (name, colour, optional icon).
    accountTypes: emptySlice(null), categoryTypes: emptySlice(null), merchantTypes: emptySlice(null),
    // BT-009-21: which shared-expense event's own scoped view is currently open, or null for the
    // combined (all-events) view — ambient like `selectedWorkspaceId`, so every existing
    // `write(fn, REFRESH)` call site's plain `refreshGroup()` automatically re-fetches whichever
    // scope the person is actually looking at, with no per-call-site change needed.
    groupEventFilter: null,
    // BT-013-16: the real Layout Picker's temporary, client-only preview — never persisted, never
    // sent to the server except through the one explicit "Apply" action. `null` when not previewing;
    // otherwise `{ layoutId }`. Ambient like `selectedWorkspaceId`/`groupEventFilter`: reset
    // synchronously on a workspace switch (below) so a preview never survives into a different
    // workspace, and checked by `actions.write` (SEC: "disable financial mutations" while previewing).
    layoutPreview: null,
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
        // A deleted (archived) workspace is never opened by default — an owner sees it only to bring it
        // back (Terry, 2026-09-14: "Delete workspace"); it stays out of the picker and out of onboarding.
        const openable = me.workspaces.filter((w) => w.status !== "archived");
        const preferred = me.preferences && me.preferences.effective && me.preferences.effective.defaultWorkspaceId;
        const first = openable.find((w) => w.id === preferred) || openable.find((w) => w.status === "active") || openable[0];
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
        selectedWorkspaceId: id, groupEventFilter: null, layoutPreview: null,
        accounts: emptySlice(id), transactions: emptySlice(id), payees: emptySlice(id), categories: emptySlice(id), members: emptySlice(id), bills: emptySlice(id),
        budgets: emptySlice(id), forecast: emptySlice(id), icons: emptySlice(id), group: emptySlice(id), monthActivity: emptySlice(id), weekActivity: emptySlice(id),
        accountTypes: emptySlice(id), categoryTypes: emptySlice(id), merchantTypes: emptySlice(id),
      });
      await Promise.all([actions.refreshAccounts(), actions.refreshCategories(), actions.refreshPayees(), actions.refreshMembers(), actions.refreshIcons(), actions.refreshAccountTypes(), actions.refreshCategoryTypes(), actions.refreshMerchantTypes()]);
    },

    refreshAccounts: () => loadSlice("accounts", (id) => api.accounts(id)),
    refreshCategories: () => loadSlice("categories", (id) => api.categories(id)),
    refreshAccountTypes: () => loadSlice("accountTypes", (id) => api.accountTypes(id)),
    refreshCategoryTypes: () => loadSlice("categoryTypes", (id) => api.categoryTypes(id)),
    refreshMerchantTypes: () => loadSlice("merchantTypes", (id) => api.merchantTypes(id)),
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
    // Two separate slices from `transactions` above and from each other (Dashboard, BT-014-14):
    // "Recent entries" needs the true most-recent entries regardless of date (`limit`, no date
    // filter); the weekly income/expense recap needs this week's own date-ranged summary; the
    // spending-by-category donut needs this month's own (a shorter week range would make the
    // breakdown mostly empty). Sharing one slice would make whichever refresh ran last silently
    // overwrite an earlier one's filtered results.
    refreshWeekActivity: (filters = {}) => loadSlice("weekActivity", (id) => api.transactions(id, filters)),
    refreshMonthActivity: (filters = {}) => loadSlice("monthActivity", (id) => api.transactions(id, filters)),
    refreshBills: () => loadSlice("bills", (id) => api.bills(id)),
    refreshBudgets: () => loadSlice("budgets", (id) => api.budgets(id)),
    // Shared expenses and settlement (BT-009): expenses, payments and derived balances.
    // BT-009-21: reads the ambient `groupEventFilter` automatically, so every existing
    // `write(fn, REFRESH)` call site's plain `refreshGroup()` (no args, unchanged) re-fetches
    // whichever event's scoped view the person actually has open, or the combined view when none.
    refreshGroup: () => loadSlice("group", (id) => api.group(id, state.groupEventFilter ? { eventId: state.groupEventFilter } : {})),
    // Switches between the combined view (`null`) and one event's own scoped view; a real store
    // action (not view-local state) so it survives exactly like `selectedWorkspaceId` does across
    // every refresh this page or its dialogs trigger.
    async setGroupEventFilter(eventId) {
      commit({ groupEventFilter: eventId || null });
      await actions.refreshGroup();
    },
    // The last forecast parameters are kept, so a refresh after a write keeps the chosen horizon.
    refreshForecast: (params) => { if (params) lastForecast = params; return loadSlice("forecast", (id) => api.forecast(id, lastForecast)); },

    // Re-reads the workspace list (names, roles and each workspace's setting values) after a change such
    // as a workspace setting, without resetting the selected workspace's data.
    async refreshWorkspaces() {
      try {
        const list = await api.workspaces();
        commit({ workspaces: list.workspaces });
        return { ok: true };
      } catch (err) {
        handleAuthLoss(err);
        return { ok: false, error: err };
      }
    },

    async createWorkspace(body, key) {
      const out = await api.createWorkspace(body, key);
      const list = await api.workspaces();
      commit({ workspaces: list.workspaces });
      await actions.selectWorkspace(out.workspace.id);
      return out.workspace;
    },

    // "Delete workspace" (owners only; Terry, 2026-09-14): the recoverable archive underneath. Everyone
    // in it loses access at once. If the deleted workspace was open, the synchronous reset and generation
    // guard (as in selectWorkspace) switch to another open workspace, or to onboarding with none left, in
    // the SAME commit as the new workspace list, so nothing from the deleted workspace can render again.
    async deleteWorkspace(id, reason) {
      try {
        await api.deleteWorkspace(id, reason ? { reason } : {});
        const list = await api.workspaces();
        if (state.selectedWorkspaceId === id) {
          generation += 1;
          const openable = list.workspaces.filter((w) => w.status !== "archived" && w.id !== id);
          const preferred = state.preferences && state.preferences.effective && state.preferences.effective.defaultWorkspaceId;
          const next = openable.find((w) => w.id === preferred) || openable[0] || null;
          const nextId = next ? next.id : null;
          commit({
            workspaces: list.workspaces, selectedWorkspaceId: nextId, groupEventFilter: null,
            accounts: emptySlice(nextId), transactions: emptySlice(nextId), payees: emptySlice(nextId), categories: emptySlice(nextId), members: emptySlice(nextId), bills: emptySlice(nextId),
            budgets: emptySlice(nextId), forecast: emptySlice(nextId), icons: emptySlice(nextId), group: emptySlice(nextId), monthActivity: emptySlice(nextId), weekActivity: emptySlice(nextId),
            accountTypes: emptySlice(nextId), categoryTypes: emptySlice(nextId), merchantTypes: emptySlice(nextId),
          });
          if (nextId) await Promise.all([actions.refreshAccounts(), actions.refreshCategories(), actions.refreshPayees(), actions.refreshMembers(), actions.refreshIcons(), actions.refreshAccountTypes(), actions.refreshCategoryTypes(), actions.refreshMerchantTypes()]);
        } else {
          commit({ workspaces: list.workspaces });
        }
        return { ok: true };
      } catch (err) {
        handleAuthLoss(err);
        return { ok: false, error: err };
      }
    },

    // BT-014-02/04: PERMANENT whole-workspace deletion (owner only) — an explicit, unmistakably
    // distinct action from "Delete workspace" (the recoverable archive) above. No undo, no "Bring
    // back". Same synchronous reset and generation guard as deleteWorkspace, so nothing from the
    // wiped workspace can render again once this resolves.
    async permanentlyDeleteWorkspace(id, impactToken, typedConfirmation) {
      try {
        await api.permanentDeleteExecute("workspaces", { id }, { impactToken, typedConfirmation });
        const list = await api.workspaces();
        if (state.selectedWorkspaceId === id) {
          generation += 1;
          const openable = list.workspaces.filter((w) => w.status !== "archived" && w.id !== id);
          const preferred = state.preferences && state.preferences.effective && state.preferences.effective.defaultWorkspaceId;
          const next = openable.find((w) => w.id === preferred) || openable[0] || null;
          const nextId = next ? next.id : null;
          commit({
            workspaces: list.workspaces, selectedWorkspaceId: nextId, groupEventFilter: null,
            accounts: emptySlice(nextId), transactions: emptySlice(nextId), payees: emptySlice(nextId), categories: emptySlice(nextId), members: emptySlice(nextId), bills: emptySlice(nextId),
            budgets: emptySlice(nextId), forecast: emptySlice(nextId), icons: emptySlice(nextId), group: emptySlice(nextId), monthActivity: emptySlice(nextId), weekActivity: emptySlice(nextId),
            accountTypes: emptySlice(nextId), categoryTypes: emptySlice(nextId), merchantTypes: emptySlice(nextId),
          });
          if (nextId) await Promise.all([actions.refreshAccounts(), actions.refreshCategories(), actions.refreshPayees(), actions.refreshMembers(), actions.refreshIcons(), actions.refreshAccountTypes(), actions.refreshCategoryTypes(), actions.refreshMerchantTypes()]);
        } else {
          commit({ workspaces: list.workspaces });
        }
        return { ok: true };
      } catch (err) {
        handleAuthLoss(err);
        return { ok: false, error: err };
      }
    },

    // "Bring back" (My settings, "Deleted workspaces"). Re-reads the list; with no workspace open
    // (everyone's workspaces were deleted) the one just brought back is opened.
    async restoreWorkspace(id, reason) {
      try {
        await api.restoreWorkspace(id, reason ? { reason } : {});
        const list = await api.workspaces();
        commit({ workspaces: list.workspaces });
        if (!state.selectedWorkspaceId) await actions.selectWorkspace(id);
        return { ok: true };
      } catch (err) {
        handleAuthLoss(err);
        return { ok: false, error: err };
      }
    },

    // Every write re-reads the affected slices afterwards; the server is the source of truth.
    // BT-013-16: while a layout preview is active, every write is refused client-side UNLESS the
    // caller explicitly marks itself `allowDuringPreview` — the layout-management actions
    // (Apply/hide/restore/colours) that are the whole point of a preview, never a financial one. This
    // is a genuine safety net, not merely a UI nicety: it refuses ANY mutation on ANY page reachable
    // while previewing, including pages this feature has not touched yet, without needing every
    // button on every page to remember to check preview state itself.
    async write(fn, refresh = ["accounts", "transactions", "payees"], { allowDuringPreview = false } = {}) {
      if (state.layoutPreview && !allowDuringPreview) {
        return { ok: false, error: new ApiError({ kind: ErrorKind.FORBIDDEN, code: "preview_read_only", message: "This is a read-only layout preview. Exit preview to make changes." }) };
      }
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

    // Re-reads the effective preferences after a change made elsewhere, such as a site default
    // (the staging link, BT-011-06), without re-initialising the app or changing the workspace.
    async refreshPreferences() {
      try {
        commit({ preferences: await api.preferences() });
        return { ok: true };
      } catch (err) {
        handleAuthLoss(err);
        return { ok: false, error: err };
      }
    },

    // BT-013-16: the real Layout Picker's full-size Preview — an ephemeral, client-only override of
    // which layout the CURRENT browser renders for the workspace already selected. Never a server
    // write, never seen by another member, restored to the real applied layout on exit simply by
    // clearing this (there is nothing saved to roll back). Real pages read the effective layout via
    // `app/js/core/layoutmeta.js` `effectiveLayoutId(state, ws)`.
    previewLayout(layoutId) { commit({ layoutPreview: { layoutId } }); },
    exitLayoutPreview() { commit({ layoutPreview: null }); },
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
