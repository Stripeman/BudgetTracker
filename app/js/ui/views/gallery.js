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

  function conceptById(id) { return (data.concepts || []).find((c) => c.id === id) || null; }

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
      renderConceptFrame(concept, previewPage, (id) => { previewPage = id; renderPreview(); }, { requiredPages }),
    ]);
    if (!compareId || compareId === selectedId) { mount(previewBox, primary); return; }
    const other = conceptById(compareId);
    if (!other) { mount(previewBox, primary); return; }
    const secondary = el("div", { class: "gpreview-frame-wrap", vars: { "--gframe-width": frameWidthVar() || null } }, [
      el("h3", { class: "gpreview-label" }, [`${other.name} — ${PAGE_LABEL[previewPage] || previewPage}`]),
      renderConceptFrame(other, previewPage, (id) => { previewPage = id; renderPreview(); }, { requiredPages }),
    ]);
    mount(previewBox, el("div", { class: "gcompare" }, [primary, secondary]));
  }

  function renderMatrix() {
    mount(matrixBox, el("table", { class: "table", "aria-label": "Comparison matrix of all 15 concepts" }, [
      el("thead", {}, [el("tr", {}, ["Concept", "Audience", "Density", "Navigation", "Dashboard", "Transactions", "Bills", "Budget", "Accounts", "Settings", "Fidelity", "Recommended", "Status"].map((h) => el("th", { text: h })))]),
      el("tbody", {}, (data.concepts || []).map((c) => el("tr", {}, [
        el("td", { "data-label": "Concept" }, [el("strong", { text: c.name })]),
        el("td", { "data-label": "Audience", text: c.audience }),
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
    const thumbWrap = el("div", { class: "gthumb", "aria-hidden": "true" }, [renderConceptFrame(concept, "dashboard", () => {}, { requiredPages: data.requiredPages || [] })]);
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
      el("h3", { class: "card__title", text: concept.name }),
      el("p", { class: "muted small", text: concept.tagline }),
      el("p", { class: "small" }, [el("strong", { text: "Intended audience: " }), concept.audience]),
      el("p", { class: "small" }, [el("strong", { text: "Direction: " }), concept.direction]),
      el("div", { class: "row" }, [fidelityBadge(concept), concept.recommended ? badge("Recommended", "shared") : null, badge(CATALOG_STATUS_OPTIONS.find((o) => o.value === concept.catalog.status).label)]),
      details,
      el("div", { class: "row" }, [check, el("label", { for: `pick-${concept.id}`, text: "Mark for implementation" })]),
      el("div", { class: "row" }, [
        button("Preview this concept", () => { selectedId = concept.id; renderGrid(); renderPreview(); }, { small: true, variant: selectedId === concept.id ? "primary" : "" }),
        button(compareId === concept.id ? "Remove from compare" : "Compare with current preview", () => { compareId = compareId === concept.id ? null : concept.id; renderPreview(); }, { small: true }),
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
    if (isAdmin && !loaded) { loaded = true; void load(); }
  }

  return { element, update };
}
