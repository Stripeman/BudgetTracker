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
