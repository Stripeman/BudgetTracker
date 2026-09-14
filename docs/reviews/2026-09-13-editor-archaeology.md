# Tiptap editor archaeology for BT-011-02 (2026-09-13)

Read-only study of TaskTracker `T:` `main` `a1ec150` (the freshest; `Z:` `main` is `40ced2a`, 2026-08-26), using `git show` and `git ls-tree` only. Neither working tree was touched. Line references are to TaskTracker `main`.

## Findings

- **Stored format.** ProseMirror JSON only, in an envelope `{format:"tiptap", v:1, doc}` (`app/js/ui/editor/format.js`, `schema.js`). No HTML is stored. A string is legacy text, an object a document; an unchanged legacy string is saved back byte-identical (`createTiptapEditor.js`).
- **Rendering.** `render.js` builds DOM nodes from a whitelist through `el()`; no `innerHTML`, `getHTML` or `generateHTML` in TaskTracker's own modules. Links are re-checked when drawn; unknown nodes draw nothing.
- **Client hardening.** The schema is a type allow-list; `harden()` and `ATTRIBUTE_PARSERS` throw on any attribute without a reader; links allow only `http:`, `https:`, `mailto:` (`safeLinkHref`); pasted images are dropped. Colours, fonts, sizes and alignment are closed sets written as classes, never style attributes.
- **Server.** `api/_shared/prosetext.js` `validateStructured` checks closed node, mark and attribute sets, link safety, bounds (depth 100, 20,000 nodes, 1 MiB). Gaps BudgetTracker must close: no parent→child content model, extra keys and undeclared attributes stored verbatim, text nodes not checked (control characters, emptiness), raw `href` stored, duplicate marks unchecked, limits loose for notes.
- **CSP.** `injectCSS: false`; `scripts/build/vendor-tiptap.mjs` extracts Tiptap's CSS to `tiptap.css`, linked first in `index.html`. Compatible with BudgetTracker's `style-src 'self'`. The bundle itself writes styles through the CSSOM (allowed).
- **Bundle and licences.** esbuild 0.28.2 ESM bundle of `@tiptap/*` 3.30.5 (exact pins checked against installed versions): 457,095 bytes (~144 kB gzip). All packages are MIT, but the build uses `legalComments: "none"`, which strips the notices — BudgetTracker must keep them (`legalComments: "eof"` or a notices file).
- **Validator conflict.** The vendored bundle contains `innerHTML` (clipboard parsing into an inert document, copy serialisation), `.style.cssText` and a `style:` template; BudgetTracker's `scripts/validate.cjs` would reject it. TaskTracker solves this with a registered-bundle exemption (banner, pins, generator present, no `setAttribute("style"`).
- **Toolbar.** Simple (10 controls), Advanced (adds strike, indent, headings, quote, code, alignment, font, size, colours, table, image) and custom arrangements `[{id, controls}]`; the schema does not depend on the mode, so hiding buttons never loses content (but Simple does not stop input rules such as `# `).
- **Not reusable:** `legacy.js`, `prosetext.js` and `prosetable.js` (TaskTracker's own markup grammar); `attachmentImage` (needs an authorised per-workspace resolver); `editorlegacy`, `editorsurfaces`, `editorparity` tests. The DOM-heavy editor tests need TaskTracker's 1,500-line test harness.

## Decision (defaults, adjustable)

Reuse the vendoring approach and adapted copies of `format`, `plaintext`, `schema` (with `harden`), `render`, `createTiptapEditor`, `toolbar`, `arrangement` and `editorsettings`. Start with a reduced, closed set for notes: nodes doc, paragraph, text, hardBreak, heading (1–3), bulletList, orderedList, listItem, taskList, taskItem, blockquote, horizontalRule; marks bold, italic, underline, strike, link. Leave out tables, images, fonts and colours for now (closed sets can be added later without breaking stored notes). Exclude the table extension from the bundle.

## Plan

1. Server validator `api/_shared/richtext.js` (envelope and version; per-node allowed keys and closed attributes; content-model table; marks only on text, no duplicates; non-empty text without control characters; `href` equal to its cleaned form, ≤ 2,048 characters; the field's plain-text limit; depth ≈ 12, ≤ 5,000 nodes, ≤ 64 KiB; refuse, never silently strip), failing tests first, plus `fields.richText()`.
2. Wire it into each notes field with plain-text projection for search, audit and backups; unchanged plain strings stay byte-identical (no migration).
3. Vendor script with the reduced entry and licence notices, exact devDependency pins, a registered-bundle exemption in `scripts/validate.cjs`, the CSS linked first, the artifact allowlist.
4. Shared client core (schema, hardening, plain text) and a mirror test importing it from the server tests.
5. Renderer through `el()`; editor factory and toolbar; settings; surfaces one at a time, then real-browser, security and UX reviews.
