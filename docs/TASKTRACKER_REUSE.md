# TaskTracker reuse inventory — BT-004-01

Read-only inspection. TaskTracker is never modified; no credentials, local settings, runtime data or
history are copied. These are source findings unless a test or browser run is named.

## Source selection — corrected 2026-09-13

Two local checkouts exist and they differ materially:

| Checkout | Committed `main` | Notes |
|---|---|---|
| `Z:\repos\TaskTracker` | `40ced2a`, 2026-08-26, `1.0.0-beta.240` | **Stale.** The first inventory (Codex) and Claude's first pass used it. |
| `T:\repos\TaskTracker` | `a1ec150`, 2026-09-12, `1.0.0-beta.416` | **Canonical for reuse.** The working tree is on `fix/attachments-and-accounts` with 22 uncommitted files (beta.418); those are not treated as canonical. |

The earlier conclusions that TaskTracker has no Tiptap editor and no moon/sun selector were wrong:
both exist in current `main`. Terry corrected this with a screenshot of the Appearance control.

TaskTracker is under active development in a separate session. Its working tree, branches and
uncommitted files belong to that session and can change at any moment.

**Rule.** Before citing TaskTracker, compare both checkouts' committed `main` revision and date. Read
the freshest one with `git show main:<path>` and record the revision. Uncommitted working-tree files
are never canonical evidence. Never fetch, switch or otherwise write to either checkout.

## Appearance control (moon/sun day/night switch) — BT-011-01

Canonical at `T:` `main` `a1ec150`, introduced in `a3389c2` (RF-20260909-25, 2026-09-10).
TaskTracker's constraint: *"Do not create a second theme state model. Reuse the existing canonical
appearance preference."*

| Aspect | Canonical source and behavior |
|---|---|
| Component | `app/js/ui/daynight.js`: `createDayNightControl({ theme, onChange })` returns `{ element, refresh }`. It owns no state and redraws from `theme` every time. |
| State model | `app/js/ui/theme.js`: `createThemeController({ root, storage, media, defaultMode, defaultTheme })`. Exports `MODES = ["system", "light", "dark"]`, `DEFAULT_MODE = "system"`, `getMode`/`setMode`/`getResolvedMode`/`subscribe`. It writes `data-mode`, `data-theme` and `data-color-scheme` on `<html>`. It re-applies on a `prefers-color-scheme` change while the mode is `system`. `localStorage` keys `tt.mode`/`tt.theme` are only a first-paint cache. |
| Mapping | "Use device setting" ticked = `system`. Clearing it sets the mode the device currently resolves to, so the screen does not change. The switch toggles `light` ↔ `dark` (day = Light, night = Dark). |
| Persistence | The shell wrapper's `onChange` calls `store.actions.setThemeMode(mode)`, which persists to the account's preference document (`/api/preferences`, `themeMode`). The server's `userprefs.effectiveThemeMode()` computes the default on read and never stores it. `main.js` applies `preferences.themeMode` and `themePalette` after boot. `index.html` ships `data-mode` for the first paint. |
| Accessibility | A real `<button role="switch">` (Enter and Space work natively). `aria-checked` reflects dark. `aria-label` reads "Appearance: Light" or "Appearance: Dark" (the state, not a bare word). `aria-describedby` points to the note. While following the device, the switch stays visible with `aria-disabled="true"`, refuses the press, and explains in words: "Your device is currently asking for dark. Clear the box above to choose for yourself." Sun, moon, stars, cloud and the Light/Dark end words are `aria-hidden` decoration. The checkbox has a real `<label for>`. `:focus-visible` shows an accent outline. |
| Motion | A cross-fade between two marks already in the DOM, plus knob travel. `prefers-reduced-motion: reduce` removes all transitions. |
| CSS | `app/styles/components.css`, `.daynight` block. The switch is 4rem × 1.75rem. Sky gradients are fixed rather than palette-driven, so day always reads as day. There are `.daynight--dark` and `.daynight--following` modifiers (the latter at opacity 0.6 with a not-allowed cursor). The note is hidden when empty. |
| Placement | The "Appearance" group of the account menu. The menu is instance-cached so the control survives being used, with no shell re-render on change. The My Settings theme card still uses a `<select>` (Match my device / Light / Dark), which is a TaskTracker inconsistency. |
| Tests | `app/test/accountappearance.test.js`: all three states reachable and named; writes go through the same controller; refuses while following, with words; `role="switch"`, `aria-checked` and classes; Sign out preserved. `app/test/themepreference.test.js`: account-level persistence, immediate apply, survives a workspace switch. `app/test/shellthemesync.test.js`: no duplicate header control returns. `api/test/preferences.test.js`: per-user document, and a site admin cannot read another person's preferences. `scripts/dev/verify-daynight.mjs`: real Edge over CDP, 21 checks. |

**BudgetTracker adaptation (required, not optional).** Port `daynight.js`, its CSS block and the
theme controller faithfully: the same DOM structure, classes, ARIA, copy text, device mapping,
refusal-with-explanation and reduced-motion behavior. Deliberate adaptations:

- Storage keys become `bt.mode` and `bt.theme`. `localStorage` stays a first-paint cache; the
  account preference is canonical.
- Persistence goes through BudgetTracker's own per-user preference API. It is never readable by
  site administrators.
- The brief requires a **site default plus a saved personal preference**, with inherited,
  customized or locked status shown. TaskTracker stores a site `defaultMode` but never applies it.
  BudgetTracker resolves `personal ?? site default ?? system` and labels the source.
- The same component is mounted in both the account menu and personal settings. This follows
  TaskTracker's own "one control, mounted twice" principle for its palette picker and avoids the
  inconsistency of a `<select>` in settings.
- Port the test contract above as BudgetTracker tests. The real-browser verifier is re-created
  without TaskTracker's default personal email address or its ports.

The palette picker (`app/js/ui/themepicker.js`, swatches drawn through the CSSOM because of the
CSP) is reusable if palettes are offered.

## Theme picker (colour-aware palette picker) — BT-011-03

- **Canonical source:** `T:` `main` `a1ec150`, `app/js/ui/themepicker.js` (`createThemePicker`, RF-20260904-14, the only commit is `bfe3483`), CSS `app/styles/components.css` 8039–8049 (`.menu__swatch`) and 8063–8108 (`.themepick*`), tests `app/test/accountappearance.test.js` 202–272 and `themepreference.test.js` 123–231. Read with `git show main:<path>` only; the TaskTracker working tree was not touched.
- **What it is:** a toggle button showing the current palette's colour circle and name (`aria-haspopup="listbox"`, `aria-expanded`, `aria-label="Theme: <name>"`) that opens an in-flow `role="listbox"` of `<button role="option">` rows, each with its circle; selection matched by id; swatch colours set through the CSSOM (`--menu-swatch`), never a style attribute.
- **Ported:** `app/js/ui/themepicker.js` and the CSS block verbatim in substance, with TaskTracker's reasoning comments; mounted in the account menu (replacing the native select) and in My settings, where the palette moved into the Appearance card beside the day/night control as in TaskTracker.
- **Documented adaptations** (TaskTracker's picker has no keyboard handling beyond native buttons, which BudgetTracker's accessibility reviews do not accept): opening focuses the current option and scrolls it into view; ArrowUp/ArrowDown/Home/End move; Escape closes, returns focus to the toggle and does not close a surrounding menu; Tab and an outside pointer press close; a pick returns focus to the toggle; with an external label the accessible name is "<label> <current palette>"; `setDisabled` closes the list and represents a site lock (TaskTracker has no lock concept); a visible focus outline on options.
- **Tests:** `app/test/themepicker.test.js` ports TaskTracker's contract assertions and adds the adaptations.
- **Palettes:** BudgetTracker has 8 of TaskTracker's 21 palettes (same ids, labels and swatches); adding the other 13 needs their light-mode contrast overrides and is tracked under BT-011-03.

## Contextual icons — BT-011-05

- **Archaeology** (`T:` `main` `a1ec150`, read with `git show` only): TaskTracker has no icon registry or icon set. `app/js/ui/dom.js` has `icon(name, { size })` with a single `filter-off` entry; its conventions are a 24 × 24 viewBox, `stroke="currentColor"`, `fill="none"`, stroke width 1.8, round caps and joins, `aria-hidden="true"`, `focusable="false"`, sized in `em`. CSS has `.btn--icon` (2.25rem square) and `.icon { display: block }`. No third-party icon set and no icon licence file.
- **Reused:** those conventions and the element-by-element `createElementNS` construction (`app/js/ui/icons.js`), and the theme-picker pattern for the icon picker (`app/js/ui/iconpicker.js`).
- **Adaptations:** an unknown id draws a fallback icon instead of throwing (records can outlive a catalogue entry); an icon may take an accessible name (`role="img"`) when it stands alone; the id list is shared with the server catalogue and checked by a test; custom icons are validated shape data, never markup.
- **Not copied:** brand logos, Unicode glyph maps, hard-coded colours, the throw on unknown names, and TaskTracker's paste/drop SVG handling, which is not a sanitizer. The artwork is original simple geometry.

## Command picker and workspace picker — BT-004-04

Terry, 2026-09-14: *"why dont we do like we do on the tasktracker.. im all for consistency"* — the
header's workspace dropdown with a pinned "+ New workspace".

- **Canonical source:** `T:` `main` `fb24a41` (read with `git show main:<path>` only; the `T:` and `Z:`
  working trees were not touched): `app/js/ui/workspacepicker.js`, `app/js/ui/commandpicker.js` (514
  lines), `app/js/core/popover.js`, `app/js/ui/popup.js`, the `cmdpick*`, `people__badge` and
  `workspaces__marker` rules in `app/styles/components.css`, `.picker`/`.picker__label` in
  `app/styles/layout.css`, and tests `commandpicker`, `popupdismiss`, `shellprojectpicker` and the
  workspace-selector part of `profilenewworkspace`.
- **Dependency mapping:**

  | TaskTracker dependency | BudgetTracker | Decision |
  |---|---|---|
  | `ui/dom.js` `el`, `clear` | `app/js/ui/dom.js` has both, same contract (`el` refuses `style`, `vars` through the CSSOM) | Reused |
  | `core/popover.js` `computePlacement` | None (theme, icon and merchant pickers open in normal flow) | Ported unchanged to `app/js/core/popover.js` (pure, DOM-free) |
  | `ui/popup.js` `registerPopup` | None (each BudgetTracker picker dismisses itself) | Ported unchanged to `app/js/ui/popup.js`; the command picker is its only member so far |
  | `core/people.js` `workspaceRelationship` | `workspace-model.summary` already gives the caller's `role` and `status` | Not ported; the marker reads `role` |
  | Live-region `announce` | `app/js/ui/dom.js` `announce` | Reused ("Switched to …") |
  | "New workspace" flow | `openNewWorkspace({ store })` in `app/js/ui/views/landing.js` | Reused; gained an optional `name` pre-fill from the search text |
  | Escape inside dialogs | `escapeBelongsToControl` in `app/js/ui/modal.js` | Not needed in the header; the search box is `role="combobox"` with `aria-expanded="true"`, which that helper already honours |
  | `components.js` `select`, `commitOnConfirm`, `button` | Present | No longer used by the header; the palette commits only on Enter or a pointer pick, which keeps A11Y-002 |
  | Themepicker/iconpicker positioning | In-flow list, colours via `vars` | Same CSP approach: the panel is `position: fixed` and placed through `--pop-top`/`--pop-left`/`--pop-max-height` set with `style.setProperty` (validate rule 8 allows it; no style attribute) |

- **Ported:** `app/js/ui/commandpicker.js` and `app/js/ui/workspacepicker.js`, the CSS blocks, and the
  tests (`app/test/commandpicker.test.js`, `popupdismiss.test.js`, `workspacepicker.test.js`,
  `shellworkspacepicker.test.js`). The header picker is built once and refreshed in place, like the
  account menu, with TaskTracker's `hasFocus`/`restoreFocus` guard kept.
- **Deliberate deviations:**
  - **Marks O and M only.** O = you own it; M = any other role (manager, member, viewer), with the exact
    role as the accessible name and in the row's spoken name ("Family budget — Manager"). TaskTracker's
    G (guest) and S (site-admin elevation) are not ported: BudgetTracker has no public or guest
    workspaces, and site administration grants no workspace access.
  - **A1** the hidden select is `tabindex="-1"` and `aria-hidden` (TaskTracker's is an invisible tab stop).
  - **A2** the search box is a real combobox and `aria-activedescendant` names the active row's **id**
    (TaskTracker set it to the option value, on the listbox, which does not hold focus).
  - **A3** "+ New workspace" is a button pinned outside the listbox that works from the keyboard
    (TaskTracker's answered only `mousedown`; Enter on it chose the highlighted row). Focus returns to the
    trigger before the dialog opens, so the dialog gives it back there.
  - The keyboard hints in the footer are `aria-hidden` (the roles already convey them); hint, footer and
    unavailable text use `--text-muted` for 4.5:1; the active row also gets the combobox outline; the
    panel sits above the modal backdrop.
  - Archived workspaces keep " (archived)" in their visible and spoken names, as the old select did.
  - The separate "New workspace" button beside the picker (added in `7b6d1c2`) is removed; "New
    workspace…" stays in the account menu, as TaskTracker keeps it in its profile menu.
- **Test double:** `app/test/domdouble.js` gained `style.removeProperty`, `append`, event `target` and
  `relatedTarget`, platform `Event` objects, and document listeners that run only through
  `document.dispatchEvent` (so existing components that listen on the document behave as before).

### Step 2 — every other dropdown (BT-004-05)

Terry, 2026-09-14: *"use the same component. and any drop down that possible to use, can use that
too"* and *"i want all my apps to have the same look and feel"*.

- **TaskTracker's approach (`T:` `main` `fb24a41`):** opt-in field by field — `modal.js` wraps a
  field's select with `createCommandPicker` when the field says `picker: "command"`, and
  `addableselect.js` does the same for Project and Category. Its note: turning the palette on for every
  select at once broke 227 tests in dialogs nobody had asked to change.
- **BudgetTracker:** one adapter, `app/js/ui/selectpicker.js`, used through `components.js`
  `pickerSelect()`; converted deliberately, one view per commit, each with tests that choose through
  the picker and check what the view submits. BudgetTracker's views build selects directly and keep
  talking to them (set `value`, replace options, disable, describe, mark invalid, focus), so the
  adapter keeps the picker in step with all of that on the one select it wraps; TaskTracker's
  palette re-reads only when told to (`refresh()`).
- **Further command-picker adaptations** (`commandpicker.js`): A4 `setLabel()` so the field label names
  the trigger, panel, list and search box; A5 native change semantics (no events on re-choosing;
  `input` then `change`); A6 the panel is at least as wide as its trigger, an empty list says "Nothing
  to choose from.", a list without search is spoken "Choose.", Tab or Shift+Tab at the panel's edge
  closes it and continues from the trigger (the panel floats on the body, outside any dialog's focus
  trap); A7 a public `close()`.
- **`popup.js`:** a popup whose control left the page while open is closed as it is pruned
  (`closeDetachedPopups()`), so a re-rendered view or a closed dialog never strands a panel.
  **`modal.js`:** Escape inside an open panel belongs to the panel (a list without a search box holds
  the keyboard itself), and closing a dialog closes a panel opened from it.
- **CSS:** option names wrap instead of being cut off; a disabled trigger in a field looks like a
  disabled input; pickers placed in a list row keep a usable width; account, merchant and type icons
  are muted as in `.iconlabel`, category icons keep their colour.
- **Kept as they are:** the colour-aware theme picker and the category-colour pickers (BT-011-03/04),
  the icon picker (BT-011-05), the merchant combobox (BT-007-01) and the day/night control
  (BT-011-01) — none of them is a select. No plain native select replaces any of them.
- **Left native:** none. After step 2 the only select created outside the views is the header
  workspace picker's, enhanced in step 1.

### Accessibility and UX review fixes (BT-004-07, reviews of be25017, 2026-09-14)

Branch `fix/picker-a11y`. The look is TaskTracker's: the same classes, trigger, panel, rows, marks
and colours. What changed is behaviour and semantics, plus three small look fixes (U4, U5 and the
key hints on short screens). Each item says whether it would apply equally to TaskTracker's picker
(`T:` `main` `fb24a41`), so it can be ported there later. TaskTracker was not modified.

| Fix | BudgetTracker (deviation from TaskTracker) | Applies to TaskTracker? |
|---|---|---|
| A8 (a11y 4) | Inside an `aria-modal` dialog the panel is appended to the dialog, not the body (still `position: fixed`). The dialog's Tab trap leaves Tab inside an open panel to the panel (`modal.js`) | Yes, wherever its picker opens in a modal dialog |
| A9 (a11y 2) | A press outside that lands on something that cannot take focus (a dialog title, the backdrop, text inside `<main tabindex=-1>`) returns focus to the trigger after the press's default action, and only if the panel held focus. A press on another control still moves focus there. The field's own label counts as inside. `popup.js` passes the pressed target to `close()` and still never moves focus itself | Yes |
| A10 (a11y 3) | A visually hidden polite status region in the panel says "3 results", "1 result" or "Nothing matches “x”." once typing pauses (400 ms), and "Nothing to choose from." for an empty list | Yes |
| A11 (a11y 1) | `core/popover.js` rule 6: a caller's `minUseful` height (the search row and about 2.5 rows). When neither side has that much room, the panel spans the viewport height. The key hints are hidden on screens under 30rem high. The CSS fallback cap is `none`, not `70vh` | Yes (the same popover, CSS and 70vh fallback) |
| A12 (a11y 5, U1) | While open, the panel is placed again on scroll (capture), window resize and visual-viewport resize or scroll; the list's own scroll is ignored. It closes, with focus on the trigger (`preventScroll`), when the trigger leaves the viewport or a clipping ancestor | Yes |
| A13 (a11y 6) | The trigger is `role="combobox"` (a `<button>`), named by its field's `<label for>` (or its own `aria-label` when it has none), with its value in a visually hidden span. Instructions ("Search and choose." / "Choose.") are a hidden element referenced by `aria-describedby`, after the field's help and, while invalid, the error text. `aria-required`, `aria-invalid` and `aria-errormessage` are read from the select; `aria-controls` names the panel. TaskTracker's trigger is a plain button whose `aria-label` holds field, value and instructions. The header workspace picker keeps `aria-label="Workspace"`, because its visible label is drawn in capitals and a name computed from it reads "WORKSPACE" (seen in Edge's accessibility tree) | Yes; its header label has the same `text-transform` |
| A14 (a11y 7, U3) | ArrowUp and Alt+arrows open from the closed trigger. A letter on the closed trigger opens it and searches or type-aheads. Type-ahead takes several letters (500 ms window). PageUp/PageDown move ten options. Space chooses in a list without a search box. Home/End in the search box stay with the text | Yes |
| A15 (U2) | The adapter's default is `search: "auto"`: a box only above twelve options, decided at each open, so a list filled later gets one when long. `search: true` forces one (the header workspace picker). On a coarse pointer a searched list opens with focus on the list, so no on-screen keyboard appears unasked; typing moves to the box | The coarse-pointer rule, yes. TaskTracker already chooses `search: false` field by field; the automatic default is a BudgetTracker choice |
| Placement flicker (found by `npm run e2e`) | `.cmdpick__panel { transition-property: none }`. `base.css`'s reduced-motion rule gives every element a 0.01 ms transition, which starts on the next frame, so the panel, first styled at its 50 % fallback while being measured, was drawn for one frame mid-screen and then jumped | Yes, if its base CSS has the same reduced-motion rule |
| U4 | Inside a `.field`, the icon, theme and colour pickers' toggle uses the command-picker trigger's height, padding, text size, border, surface and small caret. `.field__label` has no margin (the icon picker's label is a `<p>`) | Only if TaskTracker puts its theme picker in form rows (it has no icon picker) |
| U5 | A disabled trigger hides its ⌕/▾ hint (`visibility: hidden`) | Yes |
| U6 | Natural placeholders on fields that can be empty ("Choose an account…"), instead of the label-built "Choose to account…" | Yes in principle (same fallback) |
| U7 | `focusFirst()` skips `.cmdpick__native` and `aria-hidden` subtrees, and uses `Array.from` (a browser's NodeList has no `find`; the first version crashed every view in Edge and was caught before push) | TaskTracker's hidden select is a tab stop, not `tabindex -1`, so the same bug needs checking there |

Test double: `app/test/domdouble.js` gained `insertBefore()`. The harness session
(`scripts/dev/harness/session.mjs`) gained PageUp/PageDown and the accessibility tree's value,
description, invalid and required. Its dropdown scenario (`scripts/dev/e2e/dropdown.mjs`) checks the
fixes with real input.

## Rich text editor (Tiptap) — BT-011-02

Detailed archaeology, gaps and the reduced schema and plan: `docs/reviews/2026-09-13-editor-archaeology.md` (2026-09-13, `T:` `main` `a1ec150`). Key points: ProseMirror JSON in a versioned envelope, never HTML; rendering through `el()`; the vendored bundle needs a registered-bundle exemption in `scripts/validate.cjs`; keep the MIT notices (TaskTracker's build strips them); BudgetTracker's server validator must be stricter (content model, undeclared keys, text checks, canonical `href`, tight limits).

Canonical at `T:` `main`:

- **Engine and bundle.** Tiptap 3.30.5 (`@tiptap/core`, `starter-kit`, `extension-heading`,
  `extension-list`, `extension-table`, `pm`) is bundled with esbuild 0.28.2 by `npm run vendor:tiptap`
  (`scripts/build/vendor-tiptap.mjs`). The output is `app/js/vendor/tiptap/tiptap-bundle.js` and
  `tiptap.css`.
- **CSP.** Editors are created with `injectCSS: false`, and the extracted CSS is linked first in
  `index.html`.
- **Modules.** `app/js/ui/editor/` (`createTiptapEditor`, `toolbar`, `schema`, `render`, `legacy`,
  `plaintext`, `preview`, `format`, `arrangement`, plus extensions for colour, font, size,
  alignment and attachment images) and `app/js/core/editorsettings.js`.
- **Tests.** `editorparity`, `editorparse`, `editorlegacy` and `richtexteditorsettings`.
- **Governance.** `.claude/agents/rich-text-editor-architect.md` and the `rich-text-editor` skill,
  with references for the editor contract, security and paste handling, and a verification matrix.

**Decision.** Reuse the vendoring approach and the editor modules after archaeology at
implementation time. Preserve Simple, Advanced and customizable toolbar groups: hiding buttons must
never destroy content. BudgetTracker additionally requires server-side rich-text validation and
sanitization; confirm what TaskTracker's security-and-paste reference covers before relying on it.

## Deployment: thin interface over a shared engine — BT-003-05 (2026-09-16)

Read-only via `git -C T:/repos/TaskTracker show main:<path>`. TaskTracker's `deploy.ps1` only
parses arguments and, for production, collects the typed confirmation; every gating rule (gate
ordering, environment resolution, secret handling, the health check, the receipt) lives in a Node
engine under `scripts/deploy/engine/` (`cli.js`, `operations.js`, `environments.js`,
`gateevidence.js`, and others), so `deploy.ps1` and a direct `node scripts/deploy/cli.js` call
enforce identical rules. Adapted for BudgetTracker as `scripts/deploy/deploy.ps1` (thin wrapper,
~70 lines) delegating to a single `scripts/deploy/engine.mjs` (not TaskTracker's multi-file
`engine/` package — BudgetTracker's deployment surface is far smaller: one app, two environments,
no CI deploy path, no Setup Wizard, no `--ci` mode). Deliberately NOT reused: TaskTracker's
`--skip-tests`/`--skip-live-check` flags and its `--ci` token-authenticated mode (Terry's brief
requires the complete gate on every deploy, with nothing to weaken it), and its guided browser
Setup Wizard (out of scope). **Deliberately not copied** (see "Do not copy" below): TaskTracker's
`deploy.ps1` currently suspends its own interactive production confirmation prompt "for the beta
development phase" ("Interactive confirmation is suspended for the beta phase"); BudgetTracker's
typed confirmation is never suspended. Full comparison and path inventory:
`docs/DEPLOYMENT.md`, "Deployment path inventory and TaskTracker comparison".

## Other seams (re-verified against `T:` `main` `a1ec150` unless noted)

| Area | Current source | Adaptation decision |
|---|---|---|
| Stack | Browser ES modules with no application build step; Azure Functions v3/CommonJS; `@azure/storage-blob`; SWA CLI; esbuild only for vendoring | Preserve the approach and pin dependencies after compatibility checks |
| Persistence | `api/_shared/blob.js`: ETag read-modify-write with retry and `expectedEtag`; `read()` still returns the fallback on invalid JSON | Reuse the ETag and retry pattern; **refuse** corrupt documents; add idempotency keys and single-document atomic linked writes |
| Authorization | `api/_shared/auth.js` `memberRole()` still elevates site admins to owner; `requireMember` returns not-found for non-members | Reject elevation. Keep the principal parsing, the not-found-for-non-members rule and immediate revocation by rereading configuration |
| Restore | `api/_shared/restorePlan.js` compares archived and live membership; `api/_shared/archiveImport.js` still defaults a missing `active` to `true` | BudgetTracker strips archived grants and requires reauthorization; replace is atomic with a pre-restore recovery point |
| Frontend core | `core/api.js` (the only `fetch`), `errors.js` (`ApiError` kinds, never render an error as empty), `store.js` (deep-frozen commits, workspace generation token, slice ownership), `router.js` (hash routes), `ui/dom.js` (`el()` refuses `style`; no `innerHTML`) | Reuse the patterns; CSP forbids inline script and style |
| Attachments, people picker, settings, local runtime | Recorded from `Z:` beta.240 (`attachments.js` 5 MB with a MIME allowlist; `peoplepicker.js` stable keys with M/C badges; `userprefs.js` effective-on-read defaults; Azurite/Functions/SWA) | **Re-verify against `T:` `main` before reuse** (pending) |

## Do not copy

- Site-admin elevation to financial access.
- Best-effort financial audit.
- Invalid-JSON fallback.
- Archived-member reactivation.
- Permanent deletion without safeguards.
- Historical deployment exceptions and stale infrastructure facts.
- Forged-identity seed scripts and browser seeders run against non-local sessions.
- Personal email defaults in dev verifiers (for example `verify-daynight.mjs`).
- TaskTracker ports and storage.

TaskTracker deployment behavior never authorizes BudgetTracker Production operations.
