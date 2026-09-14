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
    group: (id) => request("group", { query: ws(id) }),
    groupHistory: (id, params) => request("group", { query: { ...ws(id), action: "history", ...params } }),
    createGroupExpense: (id, body, key) => request("group", { method: "POST", query: ws(id), body, idempotencyKey: key }),
    updateGroupExpense: (id, body) => request("group", { method: "PATCH", query: ws(id), body }),
    groupAction: (id, action, body, key) => request("group", { method: "POST", query: { ...ws(id), action }, body, idempotencyKey: key }),
    categories: (id) => request("categories", { query: ws(id) }),
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
  };
}
