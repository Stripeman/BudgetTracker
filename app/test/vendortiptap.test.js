// BT-011-02 the vendored Tiptap bundle: self-contained, built from the exact pins in package.json,
// carrying its licence notices, exporting what the notes editor needs, with the extracted CSS.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const DIR = new URL("../js/vendor/tiptap/", import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const read = (name) => fs.readFileSync(new URL(name, DIR), "utf8");

test("BT-011-02 the vendored bundle is pinned, licensed and self-contained", () => {
  const source = read("tiptap-bundle.js");
  assert.match(source, /GENERATED FILE/);
  assert.match(source, /npm run vendor:tiptap/);
  for (const name of ["@tiptap/core", "@tiptap/pm", "@tiptap/starter-kit", "@tiptap/extension-list", "esbuild"]) {
    const pin = pkg.devDependencies[name];
    assert.match(pin, /^\d+\.\d+\.\d+$/, `${name} is pinned exactly`);
    assert.ok(source.includes(`${name}@${pin}`), `built from ${name}@${pin}`);
  }
  assert.match(source, /Permission is hereby granted, free of charge/, "the MIT notice ships with the code");
  assert.match(source, /prosemirror-model@\d/, "bundled dependencies are listed with their licences");
  assert.doesNotMatch(source, /extension-table|prosemirror-tables/, "tables are not bundled");
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.doesNotMatch(stripped, /(?:^|\s)(?:import|export)[^;]*?from\s+["'][^"'./][^"']*["']/, "no bare imports survive");
  // Typographic characters legitimately survive inside Tiptap's own regular expressions (its
  // horizontal-rule and link input rules), which esbuild does not escape. What must never appear is
  // a raw control or invisible character (validate.cjs rule 9); the banner itself is plain ASCII.
  const invisible = new RegExp(`[${String.fromCharCode(0xfeff, 0xa0, 0x2028, 0x2029, 0x200b)}]`);
  assert.doesNotMatch(source, /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/, "no raw control characters");
  assert.doesNotMatch(source, invisible, "no raw invisible characters");
  assert.equal(/[^\t\n\r\x20-\x7E]/.test(source.slice(0, source.indexOf("*/"))), false, "the banner is plain ASCII");
});

test("BT-011-02 the bundle exports the editor, StarterKit and the task list; the CSS is extracted", async () => {
  const mod = await import(new URL("tiptap-bundle.js", DIR).href);
  for (const name of ["Editor", "StarterKit", "TaskList", "TaskItem", "getSchema"]) assert.ok(mod[name], `exports ${name}`);
  const css = read("tiptap.css");
  assert.match(css, /GENERATED FILE/);
  assert.match(css, /\.ProseMirror/);
});
