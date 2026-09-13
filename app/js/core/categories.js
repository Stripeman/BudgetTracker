// Category colours as the viewer sees them (BT-011-04): a colour from the viewer's own preferences
// wins over the workspace colour, which itself falls back to the category's default. The palette
// comes from the server with the categories, so the client never keeps its own copy.
import { sliceFor } from "./store.js";

// Icons follow the same order (BT-011-05): personal icon, then workspace icon, then the default.
export function categoryIndex(state) {
  const data = sliceFor(state, "categories").data;
  const effective = (state.preferences && state.preferences.effective) || {};
  const personal = effective.categoryColors || {};
  const personalIcons = effective.categoryIcons || {};
  const map = new Map();
  for (const c of (data && data.categories) || []) map.set(c.id, { ...c, shownColor: personal[c.id] || c.color, shownIcon: personalIcons[c.id] || c.icon || null });
  return map;
}

// Picker entries for a category: the palette, plus any custom colour already in use so the current
// value is always shown truthfully.
export function colourEntries(palette, ...inUse) {
  const entries = palette.map((p) => ({ id: p.hex, label: p.label, swatch: p.hex }));
  for (const hex of inUse) if (hex && !entries.some((e) => e.id === hex)) entries.push({ id: hex, label: "Custom", swatch: hex });
  return entries;
}
