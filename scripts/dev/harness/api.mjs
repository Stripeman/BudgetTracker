// A direct API client per fictional user, for arranging data and for firing PARALLEL requests.
// It sends what the app's own client (app/js/core/api.js) sends: the bt_dev_user cookie the local
// dev server turns into a fictional signed-in principal, `X-BT-Request: 1` on every state-changing
// request (the CSRF defence) and an `Idempotency-Key` where one is given. Loopback only.
import { randomBytes } from "node:crypto";
import { assertAllowedPort } from "./guards.mjs";

// Same shape as app/js/core/api.js newIdempotencyKey(): "k-" and 32 hex digits.
export const newIdempotencyKey = () => `k-${randomBytes(16).toString("hex")}`;

export function apiClient(base, user) {
  const m = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(base);
  if (!m) throw new Error("The harness API client only talks to its own loopback dev server.");
  assertAllowedPort(Number(m[1]));
  if (!/^[a-z]+$/.test(user)) throw new Error(`Unknown fictional user ${user}.`);

  async function request(route, { method = "GET", query, body, idempotencyKey, csrf = true } = {}) {
    const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString() : "";
    const headers = { Accept: "application/json", Cookie: `bt_dev_user=${user}` };
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      if (csrf) headers["X-BT-Request"] = "1";
    }
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await fetch(`${base}/api/${route}${qs ? `?${qs}` : ""}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const error = data && data.error ? data.error : null;
    return { status: res.status, ok: res.ok, data, text, code: error ? error.code : null, message: error ? error.message : null };
  }

  // For arranging: any refusal stops the scenario with the status and code.
  async function ok(route, options = {}) {
    const r = await request(route, options);
    if (!r.ok) throw new Error(`${user} ${options.method || "GET"} /api/${route} answered ${r.status} ${r.code || ""} ${r.message || ""}`.trim());
    return r.data;
  }

  return { user, request, ok };
}
