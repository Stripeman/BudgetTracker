// BT-013-16 — the four real, selectable workspace layouts, as the client needs to know them: a
// stable id, display name and accent-colour identity, used by real pages (Dashboard first) to pick
// which renderer to draw and, for the three flagship designs, which accent colours to apply absent a
// personal or workspace-default override. Mirrors api/_shared/layouts.js's REAL_LAYOUT_OPTIONS and
// each concept's own accentLight/accentDark exactly — kept equal by app/test/layoutmeta.test.js,
// the same "client and server agree by test, not by trust" pattern app/js/ui/icons.js already uses
// for its own BUILT_IN ids. Classic has no accent identity of its own (it uses the application's
// existing theme picker instead), so it carries none here.
export const REAL_LAYOUTS = Object.freeze([
  { id: "classic", name: "Classic (current)", accentLight: null, accentDark: null },
  { id: "ledgerfly-forecast", name: "Executive Forecast", accentLight: "#1a2a7a", accentDark: "#8fa0f5" },
  { id: "finexa-budget", name: "Budget Workspace", accentLight: "#6a1a9e", accentDark: "#c98ef0" },
  { id: "acru-overview", name: "Financial Overview", accentLight: "#4a7a0a", accentDark: "#a3e85a" },
]);

export const REAL_LAYOUT_IDS = Object.freeze(REAL_LAYOUTS.map((l) => l.id));

export function layoutMeta(id) {
  return REAL_LAYOUTS.find((l) => l.id === id) || REAL_LAYOUTS[0];
}

// The workspace's real, applied layout (`settingValues.layoutId`, already resolved on every
// workspace summary — no new fetch), UNLESS a full-size Preview (BT-013-16) is currently overriding
// it for this browser only. Every real page should read the layout to render through this one
// function, never `ws.settingValues.layoutId` directly, so a preview reaches every page uniformly
// the moment that page adopts a layout-aware renderer.
export function effectiveLayoutId(state, ws) {
  if (state && state.layoutPreview) return state.layoutPreview.layoutId;
  return (ws && ws.settingValues && ws.settingValues.layoutId) || "classic";
}

// Every real, layout-aware page's accent-colour resolution (BT-013-16 item 4): the caller's OWN
// personal override (the same `galleryDesignColors` preference the appearance cog already writes to,
// api/preferences/handler.js) else the layout's own built-in identity — as CSS custom properties
// (`--flag-light`/`--flag-dark`), resolved for light/dark by app/styles/components.css's
// `[data-color-scheme]` rule. One function so every page applies the SAME colour, never a
// per-page reimplementation. The workspace-DEFAULT colour scheme is not read here yet (disclosed in
// PROJECT_STATE.md); when it is, this is the one place that needs to change.
export function layoutAccentVars(state, layoutId) {
  const meta = layoutMeta(layoutId);
  const personal = state && state.preferences && state.preferences.effective && state.preferences.effective.galleryDesignColors && state.preferences.effective.galleryDesignColors[layoutId];
  return { "--flag-light": (personal && personal.light) || meta.accentLight, "--flag-dark": (personal && personal.dark) || meta.accentDark };
}
