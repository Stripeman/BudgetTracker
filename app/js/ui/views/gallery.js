// BT-013 — the Design Gallery: Terry's 20-concept workspace-layout review (design brief,
// 2026-09-16). Site administrators only, both server-side (`GET/PATCH /api/design-gallery` is
// 401/403 for anyone else) and here: the page fetches and shows nothing unless the signed-in person
// is a site administrator, exactly the rule app/js/ui/views/analytics.js already established for
// BT-012-01's Usage page.
//
// HARD BOUNDARY: this page calls no workspace route and renders no real financial data. Every
// concept is rendered by app/js/ui/gallery/compose.js against the one shared fictional fixture set
// (./gallery/fixtures.js) — the same reusable component tree the real application pages use, never a
// static image and never a second, forked rendering path.
//
// Palette and appearance mode are switched with the EXISTING reused controls (BT-011-01/03:
// createDayNightControl, createThemePicker) — never reinvented — applied to the whole document, the
// same way the account menu already does; the Gallery just gives them a natural home while
// previewing.
import { el, mount, announce } from "../dom.js";
import { pageHead, field, pickerSelect, button, badge } from "../components.js";
import { createDayNightControl } from "../daynight.js";
import { createThemePicker } from "../themepicker.js";
import { renderConceptFrame, PAGE_LABEL } from "../gallery/compose.js";
import { createAppearanceCog } from "../gallery/appearancecog.js";
import { messageFor } from "../../core/errors.js";

const VIEWPORTS = [{ id: "desktop", label: "Desktop", width: "" }, { id: "tablet", label: "Tablet", width: "834px" }, { id: "mobile", label: "Mobile", width: "375px" }];
const CATALOG_STATUS_OPTIONS = [{ value: "review", label: "Under review" }, { value: "approved", label: "Approved" }, { value: "retired", label: "Retired" }];

function fidelityBadge(concept) {
  return badge(concept.fidelity === "flagship" ? "Flagship (hand-tuned beyond the shared template)" : "Standard (shared template)", concept.fidelity === "flagship" ? "source" : "");
}

export function createView(ctx) {
  const { api } = ctx;
  const notAdmin = el("p", { class: "muted", text: "The Design Gallery is only shown to site administrators." });
  const status = el("p", { class: "field__help", role: "status" });
  const toolbar = el("div", { class: "gtoolbar" });
  const gridBox = el("div", { class: "ggallery-grid" });
  const previewBox = el("div", { class: "gpreview-pane" });
  const matrixBox = el("div", { class: "table-wrap" });
  const picksStatus = el("p", { class: "field__help", role: "status" });
  const picksBox = el("div");

  const content = el("div", { class: "stack", hidden: true }, [
    el("p", { class: "field__help", text: "Fifteen layout-theme concepts for review, built from fictional data only. Nothing here is visible to, or ever computed from, any real workspace. Palette and appearance mode use the same controls as the rest of the app; layout theme itself is a separate, workspace-level setting (Workspace → Layout theme) not changed from here." }),
    toolbar,
    el("section", { class: "card", "aria-labelledby": "gallery-preview" }, [
      el("h2", { class: "card__title", id: "gallery-preview", text: "Preview" }),
      previewBox,
    ]),
    el("section", { class: "card card--full", "aria-labelledby": "gallery-concepts" }, [
      el("h2", { class: "card__title", id: "gallery-concepts", text: "All 15 concepts" }),
      gridBox,
    ]),
    el("section", { class: "card card--full", "aria-labelledby": "gallery-picks" }, [
      el("h2", { class: "card__title", id: "gallery-picks", text: "Concepts selected for implementation" }),
      el("p", { class: "field__help", text: "Tick a concept below and Save here to record it. Recorded picks are audited (who, when) the same way every other administrative change in BudgetTracker is." }),
      picksBox, picksStatus,
    ]),
    el("section", { class: "card card--full", "aria-labelledby": "gallery-matrix" }, [
      el("h2", { class: "card__title", id: "gallery-matrix", text: "Comparison matrix" }),
      matrixBox,
    ]),
  ]);
  const element = el("section", {}, [pageHead("Design Gallery"), notAdmin, status, content]);

  let data = null; // last GET /api/design-gallery response
  let loaded = false;
  let selectedId = null;
  let compareId = null;
  let viewport = "desktop";
  let previewPage = "dashboard";
  const pendingPicks = new Set();
  // BT-013-15: the signed-in administrator's OWN personal colour overrides, kept in sync with the
  // app's own preferences state (never a workspace setting) — see `overrideFor`/`saveOverride` below.
  let designColors = {};
  // BT-013-15: "let me open each concept as a full-size experience" — a fixed, full-viewport takeover
  // portaled to the body, independent of the small capped preview pane above. `null` when closed.
  let liveId = null;
  let livePage = "dashboard";
  let liveViewport = "desktop";
  let liveHost = null;

  function conceptById(id) { return (data.concepts || []).find((c) => c.id === id) || null; }

  // ---- BT-013-15: per-design colour customization, saved only in the caller's own preferences ------
  function overrideFor(id) {
    const stored = designColors[id];
    return stored ? { light: stored.light || null, dark: stored.dark || null, preset: stored.preset || null } : null;
  }
  // Live-paints every currently-rendered copy of a concept's frame (thumbnail, inline preview,
  // full-size) directly, without rebuilding any DOM — so an open appearance panel is never closed out
  // from under the person still using it, and every place the concept is shown updates together.
  function paintOverride(id, entry) {
    const concept = conceptById(id);
    if (!concept) return;
    const light = (entry && entry.light) || concept.accentLight;
    const dark = (entry && entry.dark) || concept.accentDark;
    document.querySelectorAll(`.gframe[data-concept="${id}"]`).forEach((f) => {
      f.style.setProperty("--g-accent-light", light);
      f.style.setProperty("--g-accent-dark", dark);
    });
  }
  async function saveOverride(id, next) {
    const merged = { ...designColors, [id]: next };
    const out = await ctx.store.actions.savePreferences({ galleryDesignColors: merged });
    if (out.ok) { designColors = merged; paintOverride(id, next); }
    return out;
  }
  async function resetOverride(id) {
    const merged = { ...designColors };
    delete merged[id];
    const out = await ctx.store.actions.savePreferences({ galleryDesignColors: Object.keys(merged).length ? merged : null });
    if (out.ok) { designColors = merged; paintOverride(id, null); }
    return out;
  }
  function makeCog(concept) {
    return createAppearanceCog({
      concept,
      getOverride: () => overrideFor(concept.id),
      onChange: (next) => saveOverride(concept.id, next),
      onReset: () => resetOverride(concept.id),
    });
  }

  // ---- BT-013-15: the full-size standalone preview -----------------------------------------------
  // The same "make the rest of the page inert and restore focus to the opener" technique
  // app/js/ui/modal.js already uses for a real dialog — this is a full-viewport takeover of
  // equivalent weight (it fully covers and blocks the real application shell), so it earns the same
  // keyboard/screen-reader guarantees: nothing behind it stays reachable by Tab while it is open.
  let liveOpener = null;
  let liveAppWasInert = false;
  let liveBodyOverflow = "";
  function onFullscreenKey(e) {
    if (e.key === "Escape") { e.preventDefault(); closeFullscreen(); }
  }
  function closeFullscreen() {
    if (!liveHost) { liveId = null; return; }
    liveId = null;
    liveHost.remove();
    liveHost = null;
    document.removeEventListener("keydown", onFullscreenKey, true);
    const app = document.getElementById("app");
    if (app) app.inert = liveAppWasInert;
    document.body.style.overflow = liveBodyOverflow;
    if (liveOpener && document.body.contains(liveOpener) && typeof liveOpener.focus === "function") liveOpener.focus();
    liveOpener = null;
  }
  function renderFullscreen() {
    if (!liveHost) return;
    const concept = conceptById(liveId);
    if (!concept) { closeFullscreen(); return; }
    const requiredPages = data.requiredPages || [];
    const pagePicker = pickerSelect(requiredPages.map((p) => ({ value: p, label: PAGE_LABEL[p] || p })), livePage, {});
    pagePicker.addEventListener("change", () => { livePage = pagePicker.value; renderFullscreen(); });
    const viewportPicker = pickerSelect(VIEWPORTS.map((v) => ({ value: v.id, label: v.label })), liveViewport, {});
    viewportPicker.addEventListener("change", () => { liveViewport = viewportPicker.value; renderFullscreen(); });
    const dayNight = createDayNightControl({ theme: ctx.theme, onChange: (mode) => { void ctx.store.actions.savePreferences({ themeMode: mode }); } });
    const cog = makeCog(concept);
    const exit = button("← Exit full-size", () => { closeFullscreen(); }, { small: true, attrs: { "aria-label": "Exit full-size preview, back to the Design Gallery" } });
    const bar = el("div", { class: "gfullscreen__bar" }, [
      exit,
      el("strong", { text: concept.name }),
      field("Page", pagePicker), field("Viewport", viewportPicker),
      el("span", { class: "app__spacer" }),
      cog.element, dayNight.element,
    ]);
    const body = el("div", { class: "gfullscreen__body", dataset: { viewport: liveViewport } }, [
      renderConceptFrame(concept, livePage, (id) => { livePage = id; renderFullscreen(); }, { requiredPages, colorOverride: overrideFor(concept.id) }),
    ]);
    mount(liveHost, el("div", { class: "gfullscreen", role: "dialog", "aria-modal": "true", "aria-label": `${concept.name} full-size preview` }, [bar, body]));
  }
  function openFullscreen(id) {
    liveId = id;
    livePage = previewPage;
    liveOpener = document.activeElement;
    const app = document.getElementById("app");
    liveAppWasInert = app ? app.inert : false;
    if (app) app.inert = true;
    // Locks the real page's own scroll while the takeover is open, so its background scrollbar (which
    // would otherwise still show through and shave a scrollbar's width off an `inset: 0` fixed overlay
    // — real, measured browser behaviour, not a hypothetical) never appears, and the full-size preview
    // genuinely spans the whole viewport. Restored exactly in `closeFullscreen`.
    liveBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onFullscreenKey, true);
    liveHost = el("div", { class: "gfullscreen-host" });
    document.body.appendChild(liveHost);
    renderFullscreen();
    const exitBtn = liveHost.querySelector(".gfullscreen__bar button");
    if (exitBtn) exitBtn.focus();
  }

  function renderToolbar() {
    // The EXISTING reused controls (BT-011-01/03), applied globally exactly as the account menu
    // already does — never a second appearance/palette mechanism invented for the Gallery.
    const dayNight = createDayNightControl({ theme: ctx.theme, onChange: (mode) => { void ctx.store.actions.savePreferences({ themeMode: mode }); } });
    const palette = createThemePicker({
      value: ctx.theme.getTheme(), id: "gallery-palette", labelledBy: "gallery-palette-label",
      onPick: (v) => { ctx.theme.setTheme(v); void ctx.store.actions.savePreferences({ themePalette: v }); },
    });
    const viewportPicker = pickerSelect(VIEWPORTS.map((v) => ({ value: v.id, label: v.label })), viewport, {});
    viewportPicker.addEventListener("change", () => { viewport = viewportPicker.value; renderPreview(); });
    const pagePicker = pickerSelect((data.requiredPages || []).map((p) => ({ value: p, label: PAGE_LABEL[p] || p })), previewPage, {});
    pagePicker.addEventListener("change", () => { previewPage = pagePicker.value; renderPreview(); });
    mount(toolbar,
      el("div", { class: "field" }, [el("p", { class: "field__label", id: "gallery-palette-label", text: "Colour palette" }), palette.element]),
      el("div", { class: "field" }, [el("p", { class: "field__label", text: "Appearance" }), dayNight.element]),
      field("Preview viewport", viewportPicker),
      field("Preview page", pagePicker));
  }

  function frameWidthVar() { return (VIEWPORTS.find((v) => v.id === viewport) || VIEWPORTS[0]).width; }

  function renderPreview() {
    if (!selectedId) { mount(previewBox, el("p", { class: "muted small", text: "Choose a concept below to preview it." })); return; }
    const concept = conceptById(selectedId);
    if (!concept) { mount(previewBox); return; }
    const requiredPages = data.requiredPages || [];
    const primary = el("div", { class: "gpreview-frame-wrap", vars: { "--gframe-width": frameWidthVar() || null } }, [
      el("h3", { class: "gpreview-label" }, [`${concept.name} — ${PAGE_LABEL[previewPage] || previewPage}`]),
      renderConceptFrame(concept, previewPage, (id) => { previewPage = id; renderPreview(); }, { requiredPages, colorOverride: overrideFor(concept.id) }),
    ]);
    if (!compareId || compareId === selectedId) { mount(previewBox, primary); return; }
    const other = conceptById(compareId);
    if (!other) { mount(previewBox, primary); return; }
    const secondary = el("div", { class: "gpreview-frame-wrap", vars: { "--gframe-width": frameWidthVar() || null } }, [
      el("h3", { class: "gpreview-label" }, [`${other.name} — ${PAGE_LABEL[previewPage] || previewPage}`]),
      renderConceptFrame(other, previewPage, (id) => { previewPage = id; renderPreview(); }, { requiredPages, colorOverride: overrideFor(other.id) }),
    ]);
    mount(previewBox, el("div", { class: "gcompare" }, [primary, secondary]));
  }

  function renderMatrix() {
    // `gmatrix-table` (BT-013-12, 2026-09-20): a stable, unique marker class. Several concepts' own
    // bespoke Dashboard content now legitimately includes other `table.table` elements inside each
    // card's live preview thumbnail (rendered earlier in the DOM than this comparison matrix), so a
    // bare `table.table` selector could match the wrong one — this class makes the real matrix table
    // unambiguous regardless of what any single concept's own dashboard renders.
    mount(matrixBox, el("table", { class: "table gmatrix-table", "aria-label": "Comparison matrix of all 15 concepts" }, [
      el("thead", {}, [el("tr", {}, ["Concept", "Audience", "Typography", "Charts", "Density", "Navigation", "Dashboard", "Transactions", "Bills", "Budget", "Accounts", "Settings", "Fidelity", "Recommended", "Status"].map((h) => el("th", { text: h })))]),
      el("tbody", {}, (data.concepts || []).map((c) => el("tr", {}, [
        el("td", { "data-label": "Concept" }, [el("strong", { text: c.name })]),
        el("td", { "data-label": "Audience", text: c.audience }),
        // Typography and chart family (Terry, 2026-09-18: "deliberate typography… graphics, metrics").
        el("td", { "data-label": "Typography", text: c.typeVoice }),
        el("td", { "data-label": "Charts", text: c.chartEmphasis }),
        el("td", { "data-label": "Density", text: c.density }),
        el("td", { "data-label": "Navigation", text: c.navStyle }),
        el("td", { "data-label": "Dashboard", text: c.dashboardPattern }),
        // Secondary-page composition (review, 2026-09-18): each of these differs meaningfully per
        // concept now, never one shared template for all 15 — see api/_shared/layouts.js.
        el("td", { "data-label": "Transactions", text: c.transactionsPattern }),
        el("td", { "data-label": "Bills", text: c.billsPattern }),
        el("td", { "data-label": "Budget", text: c.budgetPattern }),
        el("td", { "data-label": "Accounts", text: c.accountsPattern }),
        el("td", { "data-label": "Settings", text: c.settingsPattern }),
        el("td", { "data-label": "Fidelity" }, [fidelityBadge(c)]),
        el("td", { "data-label": "Recommended", text: c.recommended ? "Yes" : "" }),
        el("td", { "data-label": "Status" }, [badge(CATALOG_STATUS_OPTIONS.find((o) => o.value === c.catalog.status).label)]),
      ]))),
    ]));
  }

  function renderPicksControls() {
    const summary = data.picks.updatedAt
      ? `Last recorded ${String(data.picks.updatedAt).replace("T", " ").slice(0, 16)} UTC by ${data.picks.updatedBy}.`
      : "Nothing recorded yet.";
    mount(picksBox,
      el("p", { class: "small muted", text: summary }),
      button("Save picks", () => { void savePicks(); }, { variant: "primary" }));
  }

  async function savePicks() {
    picksStatus.textContent = "Saving…";
    try {
      const out = await api.saveDesignGallery({ picks: { selectedIds: [...pendingPicks] } });
      data.picks = out.picks;
      data.concepts = out.concepts;
      picksStatus.textContent = `Saved. ${out.picks.selectedIds.length} concept${out.picks.selectedIds.length === 1 ? "" : "s"} recorded.`;
      announce(picksStatus.textContent);
      renderPicksControls(); renderMatrix(); renderGrid();
    } catch (err) {
      picksStatus.textContent = messageFor(err);
    }
  }

  async function setCatalogStatus(id, patch) {
    try {
      const out = await api.saveDesignGallery({ catalog: { [id]: patch } });
      data.concepts = out.concepts;
      renderGrid(); renderMatrix(); renderPreview();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  function conceptCard(concept) {
    const thumbWrap = el("div", { class: "gthumb", "aria-hidden": "true" }, [renderConceptFrame(concept, "dashboard", () => {}, { requiredPages: data.requiredPages || [], colorOverride: overrideFor(concept.id) })]);
    const check = el("input", { type: "checkbox", id: `pick-${concept.id}` });
    check.checked = pendingPicks.has(concept.id);
    check.addEventListener("change", () => { if (check.checked) pendingPicks.add(concept.id); else pendingPicks.delete(concept.id); });

    const details = el("details", {}, [
      el("summary", { text: "Strengths, tradeoffs and accessibility notes" }),
      el("p", {}, [el("strong", { text: "Strengths: " }), concept.strengths.join(" ")]),
      el("p", {}, [el("strong", { text: "Tradeoffs: " }), concept.tradeoffs.join(" ")]),
      el("p", {}, [el("strong", { text: "Accessibility notes: " }), concept.accessibilityNotes.join(" ")]),
      el("p", {}, [el("strong", { text: "What's genuinely distinct: " }), concept.distinct]),
    ]);

    const statusPicker = pickerSelect(CATALOG_STATUS_OPTIONS, concept.catalog.status, {});
    const replacementInput = el("input", { class: "field__input", type: "text", placeholder: "Replacement concept id (if retiring)", value: concept.catalog.replacementId || "" });
    const noteInput = el("input", { class: "field__input", type: "text", placeholder: "Note (required if retiring with no replacement)", value: concept.catalog.note || "" });
    const catalogError = el("p", { class: "error-text small", role: "alert", hidden: true });
    const applyCatalog = button("Apply", async () => {
      const out = await setCatalogStatus(concept.id, { status: statusPicker.value, replacementId: replacementInput.value || null, note: noteInput.value || "" });
      if (!out.ok) { catalogError.textContent = messageFor(out.error); catalogError.hidden = false; } else { catalogError.hidden = true; }
    }, { small: true });

    return el("article", { class: "gcard-outer card", dataset: { concept: concept.id } }, [
      thumbWrap,
      el("div", { class: "row" }, [el("h3", { class: "card__title", text: concept.name }), el("span", { class: "app__spacer" }), makeCog(concept).element]),
      el("p", { class: "muted small", text: concept.tagline }),
      el("p", { class: "small" }, [el("strong", { text: "Intended audience: " }), concept.audience]),
      el("p", { class: "small" }, [el("strong", { text: "Direction: " }), concept.direction]),
      el("div", { class: "row" }, [fidelityBadge(concept), concept.recommended ? badge("Recommended", "shared") : null, badge(CATALOG_STATUS_OPTIONS.find((o) => o.value === concept.catalog.status).label)]),
      details,
      el("div", { class: "row" }, [check, el("label", { for: `pick-${concept.id}`, text: "Mark for implementation" })]),
      el("div", { class: "row" }, [
        button("Preview this concept", () => { selectedId = concept.id; renderGrid(); renderPreview(); }, { small: true, variant: selectedId === concept.id ? "primary" : "" }),
        button(compareId === concept.id ? "Remove from compare" : "Compare with current preview", () => { compareId = compareId === concept.id ? null : concept.id; renderPreview(); }, { small: true }),
        button("Open full-size", () => { openFullscreen(concept.id); }, { small: true, attrs: { "aria-label": `Open ${concept.name} as a full-size experience` } }),
      ]),
      el("details", {}, [
        el("summary", { text: "Site-admin catalog controls" }),
        field("Status", statusPicker),
        field("Replacement (needed when retiring without a note)", replacementInput),
        field("Note", noteInput),
        applyCatalog, catalogError,
      ]),
    ]);
  }

  function renderGrid() {
    mount(gridBox, ...data.concepts.map(conceptCard));
  }

  async function load() {
    status.textContent = "Loading…";
    try {
      data = await api.designGallery();
      pendingPicks.clear();
      for (const id of data.picks.selectedIds) pendingPicks.add(id);
      selectedId = data.concepts.find((c) => c.recommended) ? data.concepts.find((c) => c.recommended).id : data.concepts[0].id;
      status.textContent = "";
      renderToolbar(); renderGrid(); renderPreview(); renderMatrix(); renderPicksControls();
    } catch (err) {
      status.textContent = "";
      mount(gridBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) }));
    }
  }

  function update(state) {
    const isAdmin = !!(state.auth && state.auth.user && state.auth.user.siteAdmin);
    notAdmin.hidden = isAdmin;
    content.hidden = !isAdmin;
    if (!isAdmin && liveId) closeFullscreen();
    // BT-013-15: the caller's own personal colour overrides, read from the same preferences state
    // every other personal preference (theme, category colours) already flows through — never a
    // second, separate storage mechanism.
    designColors = (state.preferences && state.preferences.effective && state.preferences.effective.galleryDesignColors) || {};
    if (isAdmin && !loaded) { loaded = true; void load(); }
  }

  return { element, update };
}
