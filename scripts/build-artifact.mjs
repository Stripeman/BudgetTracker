// Builds the deployable artifact from an ALLOWLIST (TaskTracker's lesson: publishing the
// repository root once risked exposing tooling and configuration). A file is published because it
// is named here, never because it exists in the repository.
//
//   node scripts/build-artifact.mjs            -> .local/artifact/site and .local/artifact/api
//
// The API gets production dependencies installed from its lockfile (npm ci --omit=dev) and never
// includes tests. The site gets index.html, favicon, version.json, staticwebapp.config.json and
// app/js + app/styles (never app/test). Output is under the ignored .local/ directory.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".local", "artifact");
const SITE = path.join(OUT, "site");
const API = path.join(OUT, "api");

const SITE_FILES = ["index.html", "favicon.svg", "version.json", "staticwebapp.config.json"];
const SITE_DIRS = ["app/js", "app/styles"];
const API_FILES = ["host.json", "package.json", "package-lock.json", "version.json"];
const API_DIRS = ["_shared"];

// Only files Git tracks are published: an ignored or untracked file inside an allowlisted folder
// (for example under app/js) would otherwise ship without being in the recorded commit, and the
// clean-tree checks do not see ignored files (security retest SEC-U5).
const tracked = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString("utf8").split("\0").filter(Boolean));
const untracked = [];
function copyFile(src, dest) {
  const rel = path.relative(ROOT, src).split(path.sep).join("/");
  if (!tracked.has(rel)) untracked.push(rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
function copyDir(src, dest, filter = () => true) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d, filter); else if (filter(s)) copyFile(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const f of SITE_FILES) copyFile(path.join(ROOT, f), path.join(SITE, f));
for (const d of SITE_DIRS) copyDir(path.join(ROOT, d), path.join(SITE, d), (f) => /\.(js|css)$/.test(f));

const { ROUTES } = await import(pathToFileURL(path.join(ROOT, "api", "_shared", "routes.js")).href);
for (const f of API_FILES) copyFile(path.join(ROOT, "api", f), path.join(API, f));
for (const d of API_DIRS) copyDir(path.join(ROOT, "api", d), path.join(API, d), (f) => f.endsWith(".js"));
for (const name of Object.keys(ROUTES)) {
  for (const f of ["function.json", "index.js", "handler.js"]) copyFile(path.join(ROOT, "api", name, f), path.join(API, name, f));
}
if (untracked.length) { console.error(`artifact would include files Git does not track: ${untracked.join(", ")}`); process.exit(1); }
// The commit the artifact is built from, read by api/_shared/version.js, so the running API reports
// the code it actually runs rather than a setting (release readiness D2).
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString("utf8").trim();
if (!/^[0-9a-f]{40}$/.test(commit)) { console.error("could not read the commit to stamp into the artifact"); process.exit(1); }
fs.writeFileSync(path.join(API, "build.json"), `${JSON.stringify({ commit })}\n`);
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: API, stdio: "inherit", shell: process.platform === "win32" });

// Refuse to publish anything that looks like a test, secret or local data.
const forbidden = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); } else forbidden.push(p); } };
walk(OUT);
const bad = forbidden.filter((p) => /[\\/](test|tests)[\\/]|\.test\.|\.env|local\.settings\.json|\.pem$|\.key$|dev-data|\.md$/i.test(path.relative(OUT, p)));
if (bad.length) { console.error(`artifact contains forbidden files: ${bad.map((p) => path.relative(OUT, p)).join(", ")}`); process.exit(1); }
const count = forbidden.length;
console.log(`artifact ok: ${count} files (excluding node_modules) in ${path.relative(ROOT, OUT)}`);
