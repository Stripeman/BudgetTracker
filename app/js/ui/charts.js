// Shared, accessible chart primitives for the real app's Dashboard (BT-014-14). Same rule as
// analytics.js's bar/line charts (BT-012-01): no charting library (the CSP allows only the existing
// script allowlist) — small inline SVG, hand-drawn with `svgEl`, decorative only (`aria-hidden`).
// Every figure is also given as real text: a visible legend (name and amount, never colour alone)
// and a visually hidden table beside the chart, so the numbers reach anyone the drawing does not.
//
// `stroke`/`fill` here are plain SVG presentation attributes, set the same way icon() already sets
// `stroke: "currentColor"` — never a `style=""` attribute (the CSP rule `el()` enforces is about
// that attribute specifically, not SVG geometry/paint attributes).
import { el, svgEl } from "./dom.js";

// `segments`: [{ label, amountText, color }] with a non-negative `value` already derived from a
// server-computed decimal amount (never summed from raw money here — money is never added in
// binary floating point, only server-side in exact integer minor units).
export function donutChart(segments, { size = 160, thickness = 26 } = {}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const svg = svgEl("svg", { class: "chart chart--donut", viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true", focusable: "false" });
  svg.appendChild(svgEl("circle", { class: "chart__donut-track", cx: c, cy: c, r, fill: "none", "stroke-width": thickness }));
  // Segments start at 12 o'clock and run clockwise: one rotated group, rather than a per-segment
  // transform, since every segment shares the same center.
  const g = svgEl("g", { transform: `rotate(-90 ${c} ${c})` });
  let offset = 0;
  for (const s of segments) {
    const value = Math.max(0, s.value);
    if (total <= 0 || value <= 0) continue;
    const len = (value / total) * circumference;
    g.appendChild(svgEl("circle", {
      class: "chart__donut-seg", cx: c, cy: c, r, fill: "none", stroke: s.color || "currentColor",
      "stroke-width": thickness, "stroke-dasharray": `${len} ${circumference - len}`, "stroke-dashoffset": String(-offset),
    }));
    offset += len;
  }
  svg.appendChild(g);
  return svg;
}

// The same figures as real text (analytics.js's `figureTable`, generalised for money rows instead
// of date/count rows).
export function moneyFigureTable(rows, caption, columnLabel = "Amount") {
  return el("table", { class: "sr-only" }, [
    el("caption", { text: caption }),
    el("thead", {}, [el("tr", {}, [el("th", { scope: "col", text: "Category" }), el("th", { scope: "col", text: columnLabel })])]),
    el("tbody", {}, rows.map((r) => el("tr", {}, [el("th", { scope: "row", text: r.label }), el("td", { text: r.amountText })]))),
  ]);
}

// A visible legend beneath the chart: colour is never the only signal, so every entry names itself
// and its amount in real text, with the colour swatch marked aria-hidden.
export function chartLegend(rows) {
  return el("ul", { class: "chart__legend" }, rows.map((r) => el("li", {}, [
    el("span", { class: "swatch-dot", "aria-hidden": "true", vars: { "--swatch": r.color || null } }),
    el("span", { text: r.label }),
    el("span", { class: "app__spacer" }),
    el("span", { class: "muted small", text: r.amountText }),
  ])));
}
