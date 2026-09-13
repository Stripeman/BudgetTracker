// Vendors the pinned Tiptap packages into ONE same-origin ES module the browser can load
// (BT-011-02). Adapted from TaskTracker scripts/build/vendor-tiptap.mjs (T: main a1ec150); see
// docs/reviews/2026-09-13-editor-archaeology.md.
//
// WHY. app/js is served exactly as written — there is no build step, and scripts/validate.cjs
// keeps it that way. Tiptap ships as ESM source meant to be bundled, so it is compiled ONCE, by this
// committed script, from exact pins, into app/js/vendor/tiptap/, which validate.cjs registers as the
// only exception. Nothing is fetched from a CDN at runtime.
//
// DIFFERENCES FROM TASKTRACKER (deliberate):
//   * A smaller entry: the notes editor uses StarterKit (paragraphs, headings, lists, quotes, rules,
//     hard breaks, bold, italic, underline, strike, links) and the task list. No tables, images,
//     fonts or colours, so @tiptap/extension-table and prosemirror-tables are not bundled.
//   * LICENCE NOTICES ARE KEPT. Every bundled package and its version, licence and copyright lines,
//     plus the MIT permission notice, go into the bundle's banner. The build fails if any bundled
//     package is not MIT-licensed, so a new dependency cannot slip in unnoticed.
//   * ASCII output (esbuild's default): non-ASCII characters are escaped, so the file contains no
//     raw invisible characters (validate.cjs rule 9) and diffs stay readable.
//
// Two files are produced: tiptap-bundle.js (the module) and tiptap.css (the stylesheet Tiptap would
// otherwise inject as an inline <style>, which this app's CSP forbids; construct every editor with
// injectCSS: false and load this file instead).
//
// RUN WITH:  npm run vendor:tiptap

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// This script lives in scripts/ (not scripts/build/, which .gitignore excludes as build output).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "app", "js", "vendor", "tiptap");
const OUT_JS = path.join(OUT_DIR, "tiptap-bundle.js");
const OUT_CSS = path.join(OUT_DIR, "tiptap.css");

// The packages named by the entry. Each must be pinned EXACTLY in the root package.json, and the
// installed version must match the pin, so the same commit always produces the same bytes.
const VENDORED = ["@tiptap/core", "@tiptap/pm", "@tiptap/starter-kit", "@tiptap/extension-list"];
const BUILDER = "esbuild";

const ENTRY = [
  'export * from "@tiptap/core";',
  'export { StarterKit } from "@tiptap/starter-kit";',
  'export { TaskList, TaskItem } from "@tiptap/extension-list";',
].join("\n");

const MIT_NOTICE = [
  "Permission is hereby granted, free of charge, to any person obtaining a copy of this software",
  'and associated documentation files (the "Software"), to deal in the Software without',
  "restriction, including without limitation the rights to use, copy, modify, merge, publish,",
  "distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the",
  "Software is furnished to do so, subject to the following conditions:",
  "",
  "The above copyright notice and this permission notice shall be included in all copies or",
  "substantial portions of the Software.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING',
  "BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND",
  "NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,",
  "DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.",
];

function fail(message) {
  process.stderr.write(`vendor-tiptap: ${message}\n`);
  process.exit(1);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function resolveVersions() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const versions = {};
  for (const name of [...VENDORED, BUILDER]) {
    const pin = declared[name];
    if (!pin) fail(`root package.json does not depend on ${name}`);
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pin)) fail(`${name} is pinned as "${pin}"; vendored dependencies must be exact`);
    const installedPath = path.join(ROOT, "node_modules", ...name.split("/"), "package.json");
    if (!fs.existsSync(installedPath)) fail(`${name} is not installed; run npm install first`);
    const installed = readJson(installedPath).version;
    if (installed !== pin) fail(`${name} is pinned at ${pin} but ${installed} is installed; run npm install first`);
    versions[name] = pin;
  }
  return versions;
}

// Every package whose code is inside the bundle, from esbuild's metafile, with its licence and
// copyright lines. Anything that is not MIT stops the build.
function bundledLicences(metafile) {
  const names = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const at = input.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const parts = input.slice(at + "node_modules/".length).split("/");
    names.add(parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
  return [...names].sort().map((name) => {
    const dir = path.join(ROOT, "node_modules", ...name.split("/"));
    const pkg = readJson(path.join(dir, "package.json"));
    const licence = typeof pkg.license === "string" ? pkg.license : (pkg.license && pkg.license.type) || "";
    if (licence !== "MIT") fail(`${name}@${pkg.version} is licensed "${licence || "unknown"}", not MIT; review it before vendoring`);
    const licenceFile = fs.readdirSync(dir).find((f) => /^(licen[cs]e)(\.(md|txt))?$/i.test(f));
    const text = licenceFile ? fs.readFileSync(path.join(dir, licenceFile), "utf8") : "";
    const copyright = [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^copyright\b/i.test(l)))];
    const author = typeof pkg.author === "string" ? pkg.author : pkg.author && pkg.author.name;
    return { name, version: pkg.version, licence, copyright: copyright.length ? copyright : [`Copyright (c) ${author || `the ${name} authors`}`] };
  });
}

const safeComment = (s) => String(s).replace(/\*\//g, "* /").replace(/[^\x20-\x7E]/g, "?");

function banner(versions, licences) {
  return [
    "/*",
    " * GENERATED FILE - DO NOT EDIT BY HAND.",
    " *",
    " * Regenerate with:  npm run vendor:tiptap",
    " * Generator:        scripts/vendor-tiptap.mjs",
    " *",
    " * Built from these exact, pinned versions:",
    ...[...VENDORED, BUILDER].map((name) => ` *   ${name}@${versions[name]}`),
    " *",
    " * Construct every Editor with injectCSS: false and load tiptap.css instead; the default",
    " * injection is an inline <style> block and this application's CSP forbids one.",
    " *",
    " * THIRD-PARTY NOTICES. This file contains code from the following packages, each under the MIT",
    " * licence reproduced below:",
    ...licences.flatMap((l) => [` *   ${l.name}@${l.version} (${l.licence})`, ...l.copyright.map((c) => ` *     ${safeComment(c)}`)]),
    " *",
    ...MIT_NOTICE.map((line) => (line ? ` * ${line}` : " *")),
    " */",
  ].join("\n");
}

// A surviving bare import would load in Node and fail in the browser, so it is checked here first.
function assertNoBareSpecifiers(code) {
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const leaked = [...stripped.matchAll(/(?:^|\s)(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  if (leaked.length) fail(`the bundle still imports ${leaked.map((s) => JSON.stringify(s)).join(", ")}; it is not self-contained`);
}

// The stylesheet Tiptap would have injected, captured by calling its own injection path against a
// stub document (no editor is created). Throws rather than writing an empty file if Tiptap changes.
async function extractInjectedCss(bundlePath) {
  const { Editor } = await import(pathToFileURL(bundlePath).href);
  if (!Editor || typeof Editor.prototype.injectCSS !== "function") fail("@tiptap/core no longer exposes Editor.prototype.injectCSS");
  let captured = null;
  const hadDocument = "document" in globalThis;
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, set innerHTML(value) { captured = value; } }),
    getElementsByTagName: () => [{ appendChild() {} }],
  };
  try {
    Editor.prototype.injectCSS.call({ options: { injectCSS: true, injectNonce: undefined } });
  } finally {
    if (!hadDocument) delete globalThis.document;
  }
  if (typeof captured !== "string" || !captured.includes(".ProseMirror")) fail("no stylesheet was captured from Editor.prototype.injectCSS");
  return captured;
}

async function main() {
  const versions = resolveVersions();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const probe = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: "tiptap-entry.js", loader: "js" },
    bundle: true, format: "esm", platform: "browser", target: ["es2022"], minify: true, metafile: true, write: false,
  });
  const licences = bundledLicences(probe.metafile);
  const result = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: "tiptap-entry.js", loader: "js" },
    bundle: true, format: "esm", platform: "browser", target: ["es2022"], minify: true,
    legalComments: "eof", sourcemap: false, banner: { js: banner(versions, licences) }, write: false,
  });
  const code = result.outputFiles[0].text.replace(/\r\n/g, "\n");
  assertNoBareSpecifiers(code);
  fs.writeFileSync(OUT_JS, code, "utf8");

  const css = await extractInjectedCss(OUT_JS);
  const cssHeader = [
    "/* GENERATED FILE - DO NOT EDIT BY HAND. Regenerate with: npm run vendor:tiptap",
    ` * The CSS @tiptap/core@${versions["@tiptap/core"]} would inject into a <style> element at runtime,`,
    " * served as a same-origin stylesheet because this application's CSP is style-src 'self'.",
    " * Load this and construct editors with injectCSS: false. MIT licence: see tiptap-bundle.js. */",
    "",
  ].join("\n");
  fs.writeFileSync(OUT_CSS, `${cssHeader}${css.replace(/\r\n/g, "\n")}\n`, "utf8");

  const kb = (file) => `${(fs.statSync(file).size / 1024).toFixed(1)} kB`;
  process.stdout.write([
    `vendor-tiptap: ${[...VENDORED, BUILDER].map((n) => `${n}@${versions[n]}`).join(", ")}`,
    `  ${licences.length} bundled packages, all MIT`,
    `  app/js/vendor/tiptap/tiptap-bundle.js  ${kb(OUT_JS)}`,
    `  app/js/vendor/tiptap/tiptap.css        ${kb(OUT_CSS)}`,
    "",
  ].join("\n"));
}

main().catch((error) => fail(error && error.stack ? error.stack : String(error)));
