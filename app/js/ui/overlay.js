// THE FLOATING-PANEL ENGINE every dropdown in the app shares, so "opening or closing a dropdown
// must never move surrounding content" (Terry, 2026-09-18, screenshots of the Icon picker in Add
// Bill/Add Budget/Add Account/Add Merchant pushing every field below it down the page) is solved
// ONCE, here, never re-solved — or forgotten — per control.
//
// Extracted from commandpicker.js (BT-004-04/05), which already built this correctly for Category,
// Account, Status, Merchant, Workspace and every other command-picker field, so that
// themepicker.js's icon/theme/colour lists — which core/popover.js's own header comment already
// named as pre-existing, undocumented-nowhere-else debt ("the theme and icon pickers open in
// normal flow") — share the IDENTICAL positioning, viewport-flip, scroll-following and
// dialog-hosting behaviour, rather than a bespoke lookalike a future control could repeat the same
// mistake in.
//
// A PANEL NEVER LIVES WHERE IT VISUALLY APPEARS. It is appended to the nearest `[aria-modal="true"]`
// dialog (so a dialog's own Tab trap and `aria-modal` semantics still reach it) or to
// `document.body` otherwise, positioned `position: fixed` through the CSSOM only (`--pop-left`/
// `--pop-top`/`--pop-max-height`/`--pop-min-width` custom properties — CSP-safe, never a style
// attribute), and removed from the document the moment it closes. It is NEVER a normal-flow
// sibling of its trigger, so opening or closing it changes nothing else on the page.
import { computePlacement } from "../core/popover.js";

/** The dialog to host the panel in when the trigger is inside one (A8), else `document.body`. */
export function overlayHost(trigger) {
  const doc = trigger.ownerDocument;
  return (typeof trigger.closest === "function" && trigger.closest('[aria-modal="true"]')) || (doc && doc.body) || null;
}

/** A phone or tablet: its primary pointer is coarse — a searched list opens with focus on the
 * list instead of the search box, so no on-screen keyboard appears unasked (A15). */
export function coarsePointer(view) {
  return !!(view && typeof view.matchMedia === "function" && view.matchMedia("(pointer: coarse)").matches);
}

// The part of the window that can be seen: the visual viewport when the browser has one (an
// on-screen keyboard shrinks it, not the window), in the fixed layout's own coordinates.
export function viewportOf(view) {
  const width = view.innerWidth;
  const height = view.innerHeight;
  const vv = view.visualViewport;
  if (vv && vv.height > 0 && vv.width > 0) {
    return { width: Math.min(width, (vv.offsetLeft || 0) + vv.width), height: Math.min(height, (vv.offsetTop || 0) + vv.height) };
  }
  return { width, height };
}

// Whether any of the trigger is still visible: inside the viewport and inside every ancestor
// (between `boundary` and the document root) that clips its own content, such as a dialog body
// with `overflow: auto`.
export function triggerVisible(trigger, boundary) {
  const doc = trigger.ownerDocument;
  const view = doc && doc.defaultView;
  if (!view || typeof trigger.getBoundingClientRect !== "function") return true;
  const r = trigger.getBoundingClientRect();
  const vp = viewportOf(view);
  let top = 0;
  let left = 0;
  let bottom = vp.height;
  let right = vp.width;
  if (typeof view.getComputedStyle === "function") {
    for (let n = boundary && boundary.parentNode; n && n !== doc.body && n !== doc.documentElement && typeof n.getBoundingClientRect === "function"; n = n.parentNode) {
      const style = view.getComputedStyle(n);
      if (!style || !/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
      const b = n.getBoundingClientRect();
      top = Math.max(top, b.top);
      left = Math.max(left, b.left);
      bottom = Math.min(bottom, b.bottom);
      right = Math.min(right, b.right);
    }
  }
  return r.bottom > top && r.top < bottom && r.right > left && r.left < right;
}

// Placed against the viewport, outside whatever is scrolling — below the trigger if it fits,
// above if it does not, and capped/scrolled inside itself as a last resort (core/popover.js's
// `computePlacement`). `minUseful` (A11) is the least height worth showing before the panel spans
// the viewport instead of being clipped down to a sliver.
export function placePanel({ trigger, panel, minUseful = 0, spanViewport = false }) {
  const doc = trigger.ownerDocument;
  const view = doc && doc.defaultView;
  if (!view || typeof trigger.getBoundingClientRect !== "function") return null;
  panel.style.removeProperty("--pop-max-height");
  // At least as wide as the trigger, set before measuring, so a long option in a wide field is
  // never cut short by a narrower panel (A6).
  panel.style.setProperty("--pop-min-width", `${Math.round(trigger.getBoundingClientRect().width)}px`);
  const natural = panel.getBoundingClientRect();
  const at = computePlacement({
    anchor: trigger.getBoundingClientRect(),
    panel: natural,
    viewport: viewportOf(view),
    minUseful,
    spanViewport,
  });
  if (!at) return null;
  panel.style.setProperty("--pop-left", `${Math.round(at.left)}px`);
  panel.style.setProperty("--pop-top", `${Math.round(at.top)}px`);
  // Capped only when it does not fit — rounding a height that already fits could cut a fraction
  // of a pixel and give a short list a scrollbar it does not need.
  if (at.maxHeight < natural.height - 0.5) panel.style.setProperty("--pop-max-height", `${Math.floor(at.maxHeight)}px`);
  return at;
}

// A11 — the least height worth showing: everything in the panel that is not its own scrolling
// list, plus about `minRows` rows of it.
export function usefulHeight({ panel, list, rowSelector, minRows = 2.5 }) {
  if (!panel || typeof panel.getBoundingClientRect !== "function") return 0;
  const panelHeight = panel.getBoundingClientRect().height || 0;
  const listHeight = list && typeof list.getBoundingClientRect === "function" ? list.getBoundingClientRect().height || 0 : 0;
  const chrome = Math.max(0, panelHeight - listHeight);
  const content = list && typeof list.scrollHeight === "number" && list.scrollHeight > 0 ? list.scrollHeight : listHeight;
  const row = list && rowSelector && typeof list.querySelector === "function" ? list.querySelector(rowSelector) : null;
  const rowHeight = row && typeof row.getBoundingClientRect === "function" ? row.getBoundingClientRect().height || 0 : 0;
  return Math.ceil(chrome + (rowHeight > 0 ? Math.min(content, rowHeight * minRows) : content));
}

// A12 — THE PANEL FOLLOWS ITS TRIGGER. Fixed to the viewport, so when the page or a dialog body
// scrolls, the window resizes, or an on-screen keyboard shrinks the visual viewport, it is placed
// again against where the trigger is now; when the trigger has scrolled out of sight, `onOutOfView`
// closes it without moving focus, rather than leaving a panel floating over nothing. Returns a
// `stop()` that removes every listener it added.
export function followTrigger({ trigger, boundary, panel, isOpen, onReposition, onOutOfView }) {
  const doc = trigger.ownerDocument;
  const view = doc && doc.defaultView;
  const onMove = (event) => {
    if (!isOpen()) return;
    const from = event && event.target;
    // The panel's own scrolling (its list) moves nothing.
    if (from && from !== doc && typeof from.getAttribute === "function" && panel.contains(from)) return;
    if (!triggerVisible(trigger, boundary)) { onOutOfView(); return; }
    onReposition();
  };
  const vv = view && view.visualViewport;
  if (doc && typeof doc.addEventListener === "function") doc.addEventListener("scroll", onMove, true);
  if (view && typeof view.addEventListener === "function") view.addEventListener("resize", onMove);
  if (vv && typeof vv.addEventListener === "function") {
    vv.addEventListener("resize", onMove);
    vv.addEventListener("scroll", onMove);
  }
  return function stop() {
    if (doc && typeof doc.removeEventListener === "function") doc.removeEventListener("scroll", onMove, true);
    if (view && typeof view.removeEventListener === "function") view.removeEventListener("resize", onMove);
    if (vv && typeof vv.removeEventListener === "function") {
      vv.removeEventListener("resize", onMove);
      vv.removeEventListener("scroll", onMove);
    }
  };
}
