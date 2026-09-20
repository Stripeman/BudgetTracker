// BT-013-15 (2026-09-20, Terry): "Colour-scheme customization through a cog" — coordinated preset
// colour schemes for the Design Gallery's own per-design appearance cog. Seven of the eight pairs
// below are reused verbatim from an existing concept's own `accentLight`/`accentDark` in
// api/_shared/layouts.js, already independently verified (app/test/gallerypatterns.test.js) at >=3:1
// non-text contrast against the real light surface (#ffffff) and dark surface (#141a24)
// respectively; "Slate" is the one genuinely new pair, added for a neutral option none of the 15
// concepts' own identities already covers. EVERY entry — reused or new — is checked again directly
// against the real contrast function in app/test/gallerycolorschemes.test.js, never assumed from
// where its hex values came from.
export const PRESETS = Object.freeze([
  { id: "navy", label: "Navy", light: "#1a2a7a", dark: "#8fa0f5" },
  { id: "purple", label: "Purple", light: "#6a1a9e", dark: "#c98ef0" },
  { id: "green", label: "Green", light: "#4a7a0a", dark: "#a3e85a" },
  { id: "rose", label: "Rose", light: "#7a0a2d", dark: "#e8477a" },
  { id: "amber", label: "Amber", light: "#7a3d0a", dark: "#e89a3d" },
  { id: "teal", label: "Teal", light: "#0a6a7a", dark: "#3dd6e8" },
  { id: "indigo", label: "Indigo", light: "#5c2d7a", dark: "#c277e8" },
  { id: "slate", label: "Slate", light: "#374151", dark: "#cbd5e1" },
]);

export function presetById(id) { return PRESETS.find((p) => p.id === id) || null; }

// The design's own built-in colours are always the first, pinned "Design default" choice — never
// itself one of the swap-in-place presets above, so resetting is always one unambiguous click away.
export function designDefaultEntry(concept) {
  return { id: "__default__", label: "Design default", light: concept.accentLight, dark: concept.accentDark };
}
