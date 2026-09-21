// THE ONLY PLACE `fetch` IS CALLED (checked by scripts/validate.cjs).
//
// Every state-changing request carries `X-BT-Request: 1` (the server's CSRF defence) and, where
// the operation creates something, an `Idempotency-Key` so a double click or a retry after a lost
// response cannot create two records. Responses are never cached.
import { ApiError, ErrorKind, classify } from "./errors.js";

export const AUTH = Object.freeze({
  login: (redirect = "/") => `/.auth/login/google?post_login_redirect_uri=${encodeURIComponent(redirect)}`,
  logout: "/.auth/logout?post_logout_redirect_uri=/",
});

export function newIdempotencyKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `k-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function createApiClient({ fetchImpl = globalThis.fetch.bind(globalThis), base = "/api" } = {}) {
  async function request(path, { method = "GET", query, body, idempotencyKey, signal } = {}) {
    const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString()}` : "";
    const headers = { Accept: "application/json" };
    if (method !== "GET") { headers["Content-Type"] = "application/json"; headers["X-BT-Request"] = "1"; }
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let res;
    try {
      res = await fetchImpl(`${base}/${path}${qs === "?" ? "" : qs}`, {
        method, headers, credentials: "same-origin", cache: "no-store", signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      throw new ApiError({ kind: ErrorKind.NETWORK, message: "" });
    }
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (!res.ok) {
      const err = (data && data.error) || {};
      throw new ApiError({ kind: classify(res.status, err.code), status: res.status, code: err.code || "", message: err.message || "", details: err.details });
    }
    return data;
  }

  const ws = (workspaceId) => ({ workspaceId });
  return {
    request,
    me: () => request("me"),
    updateMe: (body) => request("me", { method: "PATCH", body }),
    // The provider's display name, which only the browser can read (/.auth/me); used to SUGGEST a
    // name in My settings, never sent to the API on its own. Empty when unavailable (local dev).
    providerName: async () => {
      try {
        const res = await fetch("/.auth/me", { credentials: "same-origin" });
        if (!res.ok) return "";
        const data = await res.json();
        const claims = data && data.clientPrincipal && Array.isArray(data.clientPrincipal.claims) ? data.clientPrincipal.claims : [];
        const claim = claims.find((c) => c && c.typ === "name" && typeof c.val === "string");
        return claim ? claim.val.slice(0, 80) : "";
      } catch { return ""; }
    },
    siteSettings: () => request("site-settings"),
    workspaces: () => request("workspaces"),
    createWorkspace: (body, key) => request("workspaces", { method: "POST", body, idempotencyKey: key }),
    // "Delete workspace" (Terry, 2026-09-14): the server's recoverable archive, shown under that name.
    deleteWorkspace: (id, body) => request("workspaces", { method: "DELETE", query: { id }, body }),
    restoreWorkspace: (id, body) => request("workspaces", { method: "POST", query: { id, action: "restore" }, body }),
    accounts: (id, extra = {}) => request("accounts", { query: { ...ws(id), ...extra } }),
    createAccount: (id, body, key) => request("accounts", { method: "POST", query: ws(id), body, idempotencyKey: key }),
    updateAccount: (id, body) => request("accounts", { method: "PATCH", query: ws(id), body }),
    accountAction: (id, action, body) => request("accounts", { method: "POST", query: { ...ws(id), action }, body }),
    // Removes from lists; never erased, reason required, brought back with accountAction "restore" (BT-006-05).
    removeAccount: (id, body) => request("accounts", { method: "DELETE", query: ws(id), body }),
    transactions: (id, filters = {}) => request("transactions", { query: { ...ws(id), ...filters } }),
    createTransaction: (id, body, key) => request("transactions", { method: "POST", query: ws(id), body, idempotencyKey: key }),
    updateTransaction: (id, body) => request("transactions", { method: "PATCH", query: ws(id), body }),
    deleteTransaction: (id, body) => request("transactions", { method: "DELETE", query: ws(id), body }),
    reverseTransaction: (id, body, key) => request("transactions", { method: "POST", query: { ...ws(id), action: "reverse" }, body, idempotencyKey: key }),
    moveTransaction: (id, body) => request("transactions", { method: "POST", query: { ...ws(id), action: "move" }, body }),
    transactionHistory: (id, transactionId) => request("transactions", { query: { ...ws(id), action: "history", transactionId } }),
    payees: (id, extra = {}) => request("payees", { query: { ...ws(id), ...extra } }),
    suggest: (id, payeeId) => request("payees", { query: { ...ws(id), action: "suggest", payeeId } }),
    checkMerchant: (id, name, visibility) => request("payees", { query: { ...ws(id), action: "check", name, visibility } }),
    createMerchant: (id, body) => request("payees", { method: "POST", query: ws(id), body }),
    updateMerchant: (id, body) => request("payees", { method: "PATCH", query: ws(id), body }),
    merchantAction: (id, action, body) => request("payees", { method: "POST", query: { ...ws(id), action }, body }),
    bills: (id) => request("recurring", { query: ws(id) }),
    billDraft: (id, recurringId, occurrence) => request("recurring", { query: { ...ws(id), action: "draft", recurringId, occurrence } }),
    createBill: (id, body, key) => request("recurring", { method: "POST", query: ws(id), body, idempotencyKey: key }),
    updateBill: (id, body) => request("recurring", { method: "PATCH", query: ws(id), body }),
    billAction: (id, action, body, key) => request("recurring", { method: "POST", query: { ...ws(id), action }, body, idempotencyKey: key }),
    budgets: (id, extra = {}) => request("budgets", { query: { ...ws(id), ...extra } }),
    archiveBudget: (id, body) => request("budgets", { method: "DELETE", query: ws(id), body }),
    restoreBudget: (id, body) => request("budgets", { method: "POST", query: { ...ws(id), action: "restore" }, body }),
    createBudget: (id, body) => request("budgets", { method: "POST", query: ws(id), body }),
    updateBudget: (id, body) => request("budgets", { method: "PATCH", query: ws(id), body }),
    forecast: (id, params = {}) => request("forecast", { query: { ...ws(id), ...params } }),
    scenario: (id, body) => request("forecast", { method: "POST", query: { ...ws(id), action: "scenario" }, body }),
    group: (id, params = {}) => request("group", { query: { ...ws(id), ...params } }),
    groupHistory: (id, params) => request("group", { query: { ...ws(id), action: "history", ...params } }),
    createGroupExpense: (id, body, key) => request("group", { method: "POST", query: ws(id), body, idempotencyKey: key }),
    updateGroupExpense: (id, body) => request("group", { method: "PATCH", query: ws(id), body }),
    groupAction: (id, action, body, key) => request("group", { method: "POST", query: { ...ws(id), action }, body, idempotencyKey: key }),
    // BT-009-20/21: the event directory, creating a named event, and its lifecycle transitions.
    groupEvents: (id) => request("group", { query: { ...ws(id), action: "events" } }),
    createGroupEvent: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "create-event" }, body }),
    groupEventStatus: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "event-status" }, body }),
    // BT-009-25: saved split presets — who is typically in a recurring split, and in what
    // proportion.
    createSplitPreset: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "create-split-preset" }, body }),
    deleteSplitPreset: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "delete-split-preset" }, body }),
    // BT-009-25: settlement units (couples/families) — a display/suggestion-only grouping, never a
    // financial record.
    createSettlementUnit: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "create-unit" }, body }),
    deleteSettlementUnit: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "delete-unit" }, body }),
    // BT-009-25: linked refunds — the original expense is never edited; a refund is its own record.
    createRefund: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "create-refund" }, body }),
    voidRefund: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "void-refund" }, body }),
    // BT-009-25: shared income/prepaid contributions/deposits — a fully separate report, never a
    // real income/expense transaction and never netted against the ordinary Shared-expenses balance.
    // BT-009-26: insights — derived read-only summaries, same authority as balances.
    groupInsights: (id, eventId) => request("group", { query: { ...ws(id), action: "insights", ...(eventId ? { eventId } : {}) } }),
    createContribution: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "create-contribution" }, body }),
    applyContribution: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "apply-contribution" }, body }),
    returnContribution: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "return-contribution" }, body }),
    // BT-009-26: in-app payment reminders/requests — never an email/SMS/push (no delivery provider
    // is configured); they move no money and never change a balance themselves.
    createPaymentRequest: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "create-payment-request" }, body }),
    dismissPaymentRequest: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "dismiss-payment-request" }, body }),
    cancelPaymentRequest: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "cancel-payment-request" }, body }),
    // BT-009-26: Splitwise import — a CSV export from Splitwise itself, never a live API/credential
    // dependency. Preview never mutates anything; only confirm-import creates real records.
    previewSplitwiseImport: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "preview-import" }, body }),
    confirmSplitwiseImport: (id, body) => request("group", { method: "POST", query: { ...ws(id), action: "confirm-import" }, body }),
    categories: (id) => request("categories", { query: ws(id) }),
    // BT-019-02: workspace-scoped account TYPE definitions (name, colour, optional icon), each
    // mapped to one of the fixed accounting classes — presentation only, never itself a balance rule.
    accountTypes: (id) => request("account-types", { query: ws(id) }),
    createAccountType: (id, body) => request("account-types", { method: "POST", query: ws(id), body }),
    patchAccountType: (id, body) => request("account-types", { method: "PATCH", query: ws(id), body }),
    // BT-019-01: the same pattern for category types (mapped to expense/income).
    categoryTypes: (id) => request("category-types", { query: ws(id) }),
    createCategoryType: (id, body) => request("category-types", { method: "POST", query: ws(id), body }),
    patchCategoryType: (id, body) => request("category-types", { method: "PATCH", query: ws(id), body }),
    // BT-019-03: the same pattern for merchant types (mapped to the fixed merchant classes).
    merchantTypes: (id) => request("merchant-types", { query: ws(id) }),
    createMerchantType: (id, body) => request("merchant-types", { method: "POST", query: ws(id), body }),
    patchMerchantType: (id, body) => request("merchant-types", { method: "PATCH", query: ws(id), body }),
    icons: (id, catalogEtag) => request("icons", { query: id ? { ...ws(id), catalogEtag } : undefined }),
    updateTypeIcons: (id, typeIcons) => request("icons", { method: "PATCH", query: ws(id), body: { typeIcons } }),
    iconAction: (action, body) => request("icons", { method: "POST", query: { action }, body }),
    renameIcon: (body) => request("icons", { method: "PATCH", body }),
    members: (id) => request("members", { query: ws(id) }),
    people: (id, field) => request("people", { query: { ...ws(id), field } }),
    invitations: (id) => request("invitations", { query: ws(id) }),
    invite: (id, body) => request("invitations", { method: "POST", query: ws(id), body }),
    previewInvitation: (body) => request("invitations", { method: "POST", query: { action: "preview" }, body }),
    acceptInvitation: (body) => request("invitations", { method: "POST", query: { action: "accept" }, body }),
    whoCanSee: (id, accountId) => request("grants", { query: { ...ws(id), accountId } }),
    grant: (id, body) => request("grants", { method: "POST", query: ws(id), body }),
    revokeGrant: (id, body) => request("grants", { method: "DELETE", query: ws(id), body }),
    audit: (id) => request("audit", { query: ws(id) }),
    backups: (id) => request("backups", { query: ws(id) }),
    createBackup: (id) => request("backups", { method: "POST", query: ws(id), body: {} }),
    restoreHistory: (id) => request("backups", { query: { ...ws(id), action: "history" } }),
    previewRestore: (body) => request("restore", { method: "POST", query: { action: "preview" }, body }),
    executeRestore: (body, key) => request("restore", { method: "POST", query: { action: "execute" }, body, idempotencyKey: key }),
    preferences: () => request("preferences"),
    savePreferences: (body) => request("preferences", { method: "PUT", body }),
    // Site usage (BT-012-01): site administrators only. Never financial data.
    analytics: () => request("analytics"),
    // Design Gallery (BT-013): site administrators only. Never financial data; never a real
    // workspace's data.
    designGallery: () => request("design-gallery"),
    saveDesignGallery: (body) => request("design-gallery", { method: "PATCH", body }),
    // BT-013-16: the real, per-workspace Layout Picker. Members only; no financial data ever flows
    // through this route. `patchWorkspaceLayout` covers hide/restore/colors/publish-personal-colors —
    // applying a layout itself stays `saveWorkspaceSettings({ layoutId })` below, the one existing,
    // already-audited mechanism, never duplicated here.
    workspaceLayouts: (id) => request("workspace-layouts", { query: ws(id) }),
    patchWorkspaceLayout: (id, body) => request("workspace-layouts", { method: "PATCH", query: ws(id), body }),
    // BT-013-16: the site-wide layout catalogue (retire/reinstate + usage counts). Site admin only.
    siteLayouts: () => request("site-layouts"),
    siteLayoutAction: (action, layoutId) => request("site-layouts", { method: "POST", query: { action }, body: { layoutId } }),
    // BT-014 permanent deletion: one pair of generic calls reused by every record type (accounts,
    // transactions, payees, categories, recurring, budgets, contacts — each its own `route` and
    // idField in the body), the owner's whole-workspace route (`route: "workspaces"`, `query: {
    // id }`) and the site administrator's route (`route: "analytics"`, `query: { workspaceId }`).
    // See app/js/ui/permanentdelete.js, the one reusable impact/confirm dialog that calls these.
    permanentDeleteImpact: (route, query, body) => request(route, { method: "POST", query: { ...query, action: "delete-impact" }, body }),
    permanentDeleteExecute: (route, query, body) => request(route, { method: "POST", query: { ...query, action: "delete-permanent" }, body }),
    // The authorized Shared-expenses download offered before a deletion/disconnection that would
    // affect it (BT-014 Part A). Read-only; never itself deletes or disconnects anything.
    // BT-009-23: an optional eventId scopes the export to one event; omitted, every event combined.
    sharedExport: (id, format, eventId) => request("group", { query: { ...ws(id), action: "export", format, ...(eventId ? { eventId } : {}) } }),
    // Site-admin workspace directory (BT-014-03): operational metadata only, never financial content.
    workspaceDirectory: () => request("analytics", { query: { action: "directory" } }),
    // Site-wide operational settings, site-admin only to change (BT-014-17 adds accountRequestsEnabled).
    saveSiteSettings: (body) => request("site-settings", { method: "PUT", body }),
    // The account-request approval queue (BT-014-17): site-admin only. Unlike the workspace
    // directory, showing a real email/name here is the point — an approval queue is meaningless
    // without knowing who is asking.
    pendingAccounts: () => request("analytics", { query: { action: "pending-users" } }),
    approveAccount: (subject) => request("analytics", { method: "POST", query: { action: "approve-user" }, body: { subject } }),
    rejectAccount: (subject) => request("analytics", { method: "POST", query: { action: "reject-user" }, body: { subject } }),
  };
}
