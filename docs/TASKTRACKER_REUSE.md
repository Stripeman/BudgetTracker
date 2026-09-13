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

## Rich text editor (Tiptap) — BT-011-02

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
