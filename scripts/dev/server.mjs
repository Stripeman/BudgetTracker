// BudgetTracker LOCAL development server — fictional data only.
//
//   npm run dev            (default http://127.0.0.1:4380)
//
// * Binds 127.0.0.1 only. Refuses ports used by another local application (4280, 7071,
//   10000–10002) and never stops or touches whatever holds them.
// * Refuses to start where Azure environment markers exist, so it can never serve real data.
// * Serves an allowlist of static files with the SAME security headers as staticwebapp.config.json.
// * Routes /api/<name> to the real handlers (api/_shared/routes.js) with file storage under the
//   ignored .local/ directory, and emulates Static Web Apps sign-in with FICTIONAL identities
//   chosen on a local page. This identity injection exists only here, never in the API.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveDataRoot } from "./dataroot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { invoke } = require(path.join(ROOT, "api/_shared/runtime.js"));
const { createFileStorage } = require(path.join(ROOT, "api/_shared/storage.js"));
const { ROUTES } = require(path.join(ROOT, "api/_shared/routes.js"));

const RESERVED_PORTS = new Set([4280, 7071, 10000, 10001, 10002]);
const PORT = Number(process.env.BT_DEV_PORT || 4380);
if (RESERVED_PORTS.has(PORT)) { console.error(`Port ${PORT} belongs to another local application. Choose another BT_DEV_PORT.`); process.exit(2); }
if (process.env.WEBSITE_SITE_NAME || process.env.WEBSITE_INSTANCE_ID) { console.error("Refusing to run: Azure environment markers are present."); process.exit(2); }

// BT_DEV_DATA_ROOT (optional, inside .local/ only) gives this server its own data, backups and key;
// unset, the paths are the usual .local/dev-data, .local/dev-backups and .local/dev-backup-key.
let dirs;
try { dirs = resolveDataRoot(process.env, ROOT); } catch (err) { console.error(err.message); process.exit(2); }
const { dataRoot: DATA_ROOT, dataDir: DATA_DIR, backupDir: BACKUP_DIR, keyFile: KEY_FILE } = dirs;
fs.mkdirSync(DATA_ROOT, { recursive: true });
if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, randomBytes(32).toString("base64"), { mode: 0o600 });

// Eve is an outsider: the seed never adds her to any workspace, so she proves what a signed-in
// stranger gets (not found). Dave is a site administrator by configuration, never by membership.
export const FICTIONAL_USERS = Object.freeze({
  alice: { userId: "dev-alice", email: "alice@example.com", name: "Alice Fictional" },
  bob: { userId: "dev-bob", email: "bob@example.com", name: "Bob Fictional" },
  carol: { userId: "dev-carol", email: "carol@example.com", name: "Carol Fictional" },
  dave: { userId: "dev-dave", email: "dave@example.com", name: "Dave Siteadmin" },
  eve: { userId: "dev-eve", email: "eve@example.com", name: "Eve Outsider" },
});

const env = {
  BT_ENVIRONMENT: "local", BT_LOCAL_DEV: "1", BT_SITE_ADMINS: "dave@example.com",
  BT_BACKUP_KEYS: `dev1:${fs.readFileSync(KEY_FILE, "utf8").trim()}`, BT_BACKUP_ACTIVE_KEY: "dev1",
};
const storage = createFileStorage(DATA_DIR);
const backupStorage = createFileStorage(BACKUP_DIR);
const swa = JSON.parse(fs.readFileSync(path.join(ROOT, "staticwebapp.config.json"), "utf8"));
const SECURITY_HEADERS = swa.globalHeaders || {};
const handlers = new Map(Object.keys(ROUTES).map((name) => [name, require(path.join(ROOT, "api", name, "handler.js"))]));

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
const STATIC_ALLOW = [/^\/index\.html$/, /^\/favicon\.svg$/, /^\/version\.json$/, /^\/app\/(js|styles)\/[A-Za-z0-9/_.-]+\.(js|css)$/];

function principalFor(name) {
  const u = FICTIONAL_USERS[name];
  if (!u) return null;
  return Buffer.from(JSON.stringify({ identityProvider: "google", userId: u.userId, userDetails: u.email, userRoles: ["anonymous", "authenticated"], claims: [{ typ: "name", val: u.name }] })).toString("base64");
}

function cookieUser(req) {
  const m = /(?:^|;\s*)bt_dev_user=([a-z]+)/.exec(req.headers.cookie || "");
  return m ? m[1] : null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function safeRedirect(target) {
  return typeof target === "string" && target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function loginPage(redirect) {
  const buttons = Object.entries(FICTIONAL_USERS).map(([key, u]) => `<p><button name="user" value="${key}" type="submit">${u.name} &lt;${u.email}&gt;</button></p>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local sign-in (fictional)</title></head><body>`
    + `<h1>Local development sign-in</h1><p>Fictional identities only. This page does not exist in any deployed environment.</p>`
    + `<form method="post" action="/.auth/dev-login"><input type="hidden" name="redirect" value="${redirect.replace(/"/g, "")}">${buttons}</form></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const started = Date.now();
  res.on("finish", () => console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`));
  try {
    if (url.pathname === "/.auth/login/google") return send(res, 200, loginPage(safeRedirect(url.searchParams.get("post_login_redirect_uri"))), { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    if (url.pathname.startsWith("/.auth/login/")) return send(res, 404, "Not found");
    if (url.pathname === "/.auth/dev-login" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const user = form.get("user");
      if (!FICTIONAL_USERS[user]) return send(res, 400, "Unknown fictional user");
      return send(res, 302, "", { Location: safeRedirect(form.get("redirect")), "Set-Cookie": `bt_dev_user=${user}; HttpOnly; SameSite=Strict; Path=/` });
    }
    if (url.pathname === "/.auth/logout") return send(res, 302, "", { Location: "/", "Set-Cookie": "bt_dev_user=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });

    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice(5).replace(/\/$/, "");
      const handler = handlers.get(name);
      if (!handler) return send(res, 404, JSON.stringify({ error: { code: "not_found", message: "Not found." } }), { "Content-Type": "application/json" });
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (k !== "x-ms-client-principal") headers[k] = v;
      const principal = principalFor(cookieUser(req));
      if (principal) headers["x-ms-client-principal"] = principal;
      let rawBody;
      try { rawBody = req.method === "GET" ? undefined : await readBody(req); } catch { return send(res, 413, JSON.stringify({ error: { code: "too_large", message: "Too large." } })); }
      const out = await invoke(handler, { method: req.method, headers, query: Object.fromEntries(url.searchParams), rawBody }, { storage, backupStorage, env, log: { error: (m) => console.error(m) } }, ROUTES[name].options || {});
      return send(res, out.status, out.body, out.headers);
    }

    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!STATIC_ALLOW.some((re) => re.test(file))) file = "/index.html";
    const full = path.join(ROOT, file);
    if (!full.startsWith(ROOT)) return send(res, 400, "Bad path");
    const bytes = await fs.promises.readFile(full);
    return send(res, 200, bytes, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
  } catch (err) {
    console.error(`dev server error: ${err && err.code ? err.code : "internal"}`);
    return send(res, 500, "Internal error");
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`BudgetTracker local (fictional data) at http://127.0.0.1:${PORT}/`));
