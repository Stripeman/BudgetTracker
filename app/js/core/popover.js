// Ported from TaskTracker app/js/core/popover.js (T: main fb24a41), unchanged in behaviour. BudgetTracker
// had no shared placement arithmetic: the theme and icon pickers open in normal flow. The command
// picker (app/js/ui/commandpicker.js) opens over the page and needs it. Pure and DOM-free, as
// scripts/validate.cjs requires of app/js/core.
//
// WHERE A POPOVER GOES — the arithmetic, with no DOM in sight.
//
// WHY THIS IS ITS OWN MODULE. Several controls open a panel over the page. Each one of them has the
// same four problems — stay on screen, flip when there is no room below, never grow taller than the
// space available, and never be clipped by whatever is scrolling around it. Solved once, each
// solution is the same; solved three times, two of them are subtly wrong and only one of them has
// tests.
//
// IT IS PURE, AND IT LIVES IN core/ FOR THAT REASON. It is handed rectangles and returns
// coordinates. No element, no document, no measurement — so every case that matters can be
// exercised directly rather than hoped for in a harness that has no layout engine at all.
//
// THE RULES, in order:
//
//   1. BELOW THE ANCHOR IF IT FITS. That is where people look, and it keeps the anchor and
//      its list reading as one thing.
//   2. ABOVE IF IT DOES NOT, and there is more room up there.
//   3. WHICHEVER SIDE HAS MORE ROOM if neither fits, with the panel's height CAPPED to that
//      room so it scrolls inside itself instead of overflowing the viewport.
//   4. NEVER OFF THE LEFT OR RIGHT EDGE. Aligned to the anchor's start, pulled back when that
//      would push it past the far edge, and never pushed before the near margin.
//   5. A PANEL MAY ASK TO SPAN THE COLUMN when neither side has enough room. Opt-in, and only as
//      a last resort: a panel that FITS on one side still goes there.
//
// THE HEIGHT CAP IS THE PART THAT IS EASY TO FORGET. Flipping a panel that is taller than the
// screen just moves the unreachable part from the bottom to the top.

// Nothing is ever placed closer than this to the viewport edge.
const MARGIN = 8;
// The gap between the anchor and its panel.
const GAP = 4;
// A panel shorter than this is not worth showing; below it, scrolling is the answer.
const MIN_HEIGHT = 96;

/**
 * @param {object} input
 * @param {{top,bottom,left,right,width,height}} input.anchor   the control's rectangle
 * @param {{width,height}} input.panel                          the panel's natural size
 * @param {{width,height}} input.viewport
 * @returns {{top:number,left:number,maxHeight:number,placement:"below"|"above"|"span"}}
 */
export function computePlacement({ anchor, panel, viewport, gap = GAP, margin = MARGIN, spanViewport = false } = {}) {
  const view = { width: num(viewport?.width, 0), height: num(viewport?.height, 0) };
  const a = {
    top: num(anchor?.top, 0),
    bottom: num(anchor?.bottom, num(anchor?.top, 0) + num(anchor?.height, 0)),
    left: num(anchor?.left, 0),
    right: num(anchor?.right, num(anchor?.left, 0) + num(anchor?.width, 0)),
  };
  const wanted = { width: num(panel?.width, 0), height: num(panel?.height, 0) };

  // How much room there is on each side, once the margin is respected.
  const below = view.height - a.bottom - gap - margin;
  const above = a.top - gap - margin;

  // Below when it fits. Above when it does not and there is genuinely more room there —
  // "does not fit below" alone is not a reason to flip into somewhere even smaller.
  const fitsBelow = wanted.height <= below;
  const placement = fitsBelow || below >= above ? "below" : "above";

  const room = Math.max(MIN_HEIGHT, placement === "below" ? below : above);
  // CAPPED TO THE ROOM AVAILABLE. A panel taller than its side of the screen scrolls inside
  // itself; flipping it would only move the unreachable part from one end to the other.
  const sideHeight = Math.max(MIN_HEIGHT, Math.min(wanted.height || room, room));

  // RULE 5 — SPAN THE COLUMN, when asked and when neither side is enough. The height is the
  // viewport's, never a fixed figure; centred on the anchor, then clamped inside the margins.
  const spanRoom = Math.max(MIN_HEIGHT, view.height - 2 * margin);
  const spans = spanViewport && (wanted.height || 0) > Math.max(below, above);
  const maxHeight = spans ? Math.min(wanted.height || spanRoom, spanRoom) : sideHeight;

  let top;
  if (spans) {
    // The anchor's own height comes from its edges: `a` is normalised to top/bottom/left/right
    // above, and reading a `height` it does not carry produced NaN in TaskTracker once.
    const centred = a.top + (a.bottom - a.top) / 2 - maxHeight / 2;
    const lowest = Math.max(margin, view.height - margin - maxHeight);
    top = Math.min(Math.max(margin, centred), lowest);
  } else {
    top = placement === "below" ? a.bottom + gap : Math.max(margin, a.top - gap - maxHeight);
  }

  // Aligned to the anchor's start, pulled back from the far edge, never before the near one.
  const overflowRight = a.left + wanted.width - (view.width - margin);
  const left = Math.max(margin, overflowRight > 0 ? a.left - overflowRight : a.left);

  return {
    top: Math.round(top),
    left: Math.round(left),
    maxHeight: Math.round(maxHeight),
    // "span" is a third placement, not a variant of the other two.
    placement: spans ? "span" : placement,
  };
}

function num(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export const POPOVER_MARGIN = MARGIN;
export const POPOVER_GAP = GAP;
export const POPOVER_MIN_HEIGHT = MIN_HEIGHT;
