// Small shared view helpers. Every list uses `stateView` so loading, error and empty are three
// different things: a failure is never shown as "nothing here".
import { el } from "./dom.js";
import { icon, directionOf, iconLabel, withIcon } from "./icons.js";
import { messageFor } from "../core/errors.js";
import { formatAmount, isNegative } from "../core/format.js";
import { Status } from "../core/store.js";
import { categoryIndex } from "../core/categories.js";
import { enhanceSelect, pickerOf, controlElement } from "./selectpicker.js";

export { controlElement };

let fieldCounter = 0;
export const uid = (prefix = "f") => `${prefix}-${++fieldCounter}`;

// A select with a command picker over it (BT-004-05) is labelled THROUGH ITS TRIGGER: the label's
// `for`, the spoken name and the help text all go to the button people use, and the field shows the
// picker. The select itself stays inside, holding the value.
export function field(label, control, { help, wide = false } = {}) {
  const picked = pickerOf(control);
  if (picked) picked.setLabel(label);
  const target = picked ? picked.trigger : control;
  if (!target.id) target.id = uid();
  const helpId = help ? `${target.id}-help` : null;
  // Set on the control; an enhanced select carries it over to its trigger.
  if (helpId) control.setAttribute("aria-describedby", helpId);
  return el("div", { class: ["field", wide ? "field--wide" : ""] }, [
    el("label", { class: "field__label", for: target.id, text: label }),
    picked ? picked.element : control,
    help ? el("p", { class: "field__help", id: helpId, text: help }) : null,
  ]);
}

export function input(attrs = {}) {
  return el("input", { class: "field__input", type: "text", ...attrs });
}

export function select(options, value, attrs = {}) {
  const node = el("select", { class: "field__input", ...attrs });
  for (const o of options) {
    const opt = el("option", { value: o.value, text: o.label });
    if (String(o.value) === String(value ?? "")) opt.selected = true;
    node.appendChild(opt);
  }
  if (value !== undefined && value !== null) node.value = String(value);
  return node;
}

// The same select, with TaskTracker's command picker over it (BT-004-05). It returns the SELECT, so
// the view keeps reading and setting it exactly as before; place it with `field()` or
// `controlElement()`. `picker` takes the adapter's options: a search box appears on its own above twelve
// options (`search: true` always asks for one; UX review U2), `placeholder` for a natural empty-field
// text (U6), `colorOf`/`badgeOf` for things that have a colour or an icon.
export function pickerSelect(options, value, attrs = {}, picker = {}) {
  const node = select(options, value, attrs);
  enhanceSelect(node, picker);
  return node;
}

// Marks for picker rows and triggers (BT-004-05): the same marks the rest of the app draws beside
// these names. A category shows its icon tinted with its colour, or its colour dot when it has no
// icon (BT-011-04/05, as `categoryLabel`); an account or merchant shows its own icon. Each call
// returns a NEW node (a row and the trigger cannot share one), decorative, because the name is always
// beside it. An id the list does not know gets no mark.
export function categoryBadges(state) {
  const index = categoryIndex(state);
  return (id) => {
    const c = index.get(id);
    if (!c) return null;
    if (c.shownIcon) return el("span", { class: "catlabel__icon", "aria-hidden": "true", vars: { "--swatch": c.shownColor || null } }, [icon(c.shownIcon)]);
    return c.shownColor ? el("span", { class: "swatch-dot", "aria-hidden": "true", vars: { "--swatch": c.shownColor } }) : null;
  };
}

export function iconBadges(records, fallback = null) {
  const byId = new Map((records || []).map((r) => [String(r.id), r.icon || fallback]));
  return (id) => (byId.get(String(id)) ? icon(byId.get(String(id))) : null);
}

export function button(label, onClick, { variant = "", small = false, attrs = {} } = {}) {
  return el("button", { type: "button", class: ["btn", variant ? `btn--${variant}` : "", small ? "btn--small" : ""], onClick, ...attrs, text: label });
}

export function badge(text, variant = "") {
  return el("span", { class: ["badge", variant ? `badge--${variant}` : ""], text });
}

// Positions a floating tooltip box in the VIEWPORT, via getBoundingClientRect, rather than a CSS
// `position: absolute` box tied to a positioned ancestor (bug fix, 2026-09-17 — Terry: "The tool
// tip on 'All bills > record next' is clipped.. you would have seen this had you tested it on
// localhost" — exactly right, this was never opened in a real browser before shipping). The
// original CSS-only approach broke inside `.table-wrap` (`overflow-x: auto`), which per the CSS
// spec forces `overflow-y` to `auto` too, clipping a box that tried to render above a row near the
// container's own top edge. Preferring above the trigger, flipping below when there isn't room,
// clamped horizontally to the viewport, and repositioned on scroll/resize while shown — the box
// lives on `document.body`, outside every ancestor's clipping.
function placeFloatingTip(box, trigger) {
  // No layout geometry in this environment (a DOM double in tests, or any host missing these,
  // including `window` itself not existing outside a real browser) — the box still exists (and is
  // still reachable via aria-describedby) but isn't positioned.
  if (typeof trigger.getBoundingClientRect !== "function" || typeof window === "undefined") return;
  const r = trigger.getBoundingClientRect();
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;
  const margin = 8;
  const bw = box.offsetWidth || 0;
  const bh = box.offsetHeight || 0;
  let top = r.top - bh - margin;
  if (top < margin) top = Math.min(r.bottom + margin, vh - bh - margin);
  let left = r.right - bw;
  left = Math.max(margin, Math.min(left, vw - bw - margin));
  box.style.top = `${Math.max(margin, top)}px`;
  box.style.left = `${left}px`;
}

// Wraps an already-enabled control with a plain-language explanation, shown on hover/focus and to
// screen readers via `aria-describedby` (Terry, 2026-09-17: "add nice tool tips" for an action
// whose name alone wasn't clear — "Record next"). `id` must be unique on the page; the wrapped
// control must accept `aria-describedby` (every `button()` does). The floating box itself is
// `aria-hidden` — the description is announced through `aria-describedby`, never twice.
export function infoTip(node, text, id) {
  node.setAttribute("aria-describedby", [node.getAttribute("aria-describedby"), id].filter(Boolean).join(" "));
  let box = null;
  const reposition = () => { if (box) placeFloatingTip(box, node); };
  const show = () => {
    if (box || !text) return;
    box = el("div", { class: "floating-tip", "aria-hidden": "true", text });
    document.body.appendChild(box);
    placeFloatingTip(box, node);
    if (typeof window !== "undefined") {
      window.addEventListener("scroll", reposition, { capture: true, passive: true });
      window.addEventListener("resize", reposition, { passive: true });
    }
  };
  const hide = () => {
    if (!box) return;
    if (box.remove) box.remove(); else if (box.parentNode) box.parentNode.removeChild(box);
    box = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
    }
  };
  node.addEventListener("mouseenter", show);
  node.addEventListener("mouseleave", hide);
  node.addEventListener("focus", show);
  node.addEventListener("blur", hide);
  return el("span", { class: "tip-anchor" }, [node, el("span", { class: "sr-only", id, text })]);
}

// An accessible POPOVER for explanatory content that includes something INTERACTIVE — a real link
// or button — which a plain tooltip must never hold (review, 2026-09-18: "Interactive content
// belongs in an accessible popover, not a tooltip containing inaccessible links"). Unlike
// `infoTip()` above (which wraps a control that is already the primary action), this is its OWN
// small "?" trigger beside a label, so opening it never also fires an unrelated action. Opens on
// click AND on focus+Enter/Space (a real button, so touch and keyboard both just work); closes on
// Escape (returning focus to the trigger), on an outside click, or when focus leaves both the
// trigger and the panel. `content` is one or more DOM nodes (a paragraph, a link, a button).
export function createHelpPopover({ label, content, id = uid("help") }) {
  const trigger = el("button", {
    type: "button", class: "popover__trigger", "aria-expanded": "false", "aria-controls": id,
    "aria-label": label || "More information", text: "?",
  });
  let panel = null;
  const reposition = () => { if (panel) placeFloatingTip(panel, trigger); };
  function onDocClick(e) {
    if (panel && e.target !== trigger && !trigger.contains(e.target) && !panel.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === "Escape" && panel) { e.preventDefault(); close(); trigger.focus(); }
  }
  function onFocusOut(e) {
    // Closes only once focus has actually left both the trigger and the panel (not on every
    // internal focus change while tabbing between the panel's own controls).
    const next = e.relatedTarget;
    if (panel && next !== trigger && !(next && panel.contains(next))) close();
  }
  function open() {
    if (panel) return;
    panel = el("div", { class: "popover__panel", id, role: "group", "aria-label": label || "More information" }, [].concat(content));
    document.body.appendChild(panel);
    trigger.setAttribute("aria-expanded", "true");
    reposition();
    document.addEventListener("mousedown", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
    panel.addEventListener("focusout", onFocusOut);
    if (typeof window !== "undefined") {
      window.addEventListener("scroll", reposition, { capture: true, passive: true });
      window.addEventListener("resize", reposition, { passive: true });
    }
    const focusable = panel.querySelector("a[href], button, input, select, textarea, [tabindex]");
    if (focusable && typeof focusable.focus === "function") focusable.focus();
  }
  function close() {
    if (!panel) return;
    // Real-browser bug fix (2026-09-18): the panel holds real, focused content, so removing it
    // fires a synchronous focusout that re-enters this same close() through onFocusOut BEFORE the
    // line below would have nulled `panel` — the reentrant call then tried to remove the same node
    // a second time ("NotFoundError: the node to be removed is no longer a child of this node").
    // Capturing the node and nulling `panel` FIRST makes the reentrant call's own `if (!panel)
    // return;` guard fire instead, exactly like it does for every other close path.
    const node = panel;
    panel = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    if (typeof window !== "undefined") {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
    }
    if (node.remove) node.remove(); else if (node.parentNode) node.parentNode.removeChild(node);
  }
  trigger.addEventListener("click", () => { if (panel) close(); else open(); });
  return el("span", { class: "popover-anchor" }, [trigger]);
}

// Three states, as the brief asks (UX-009): a value you chose, a value inherited from the site or
// the built-in default, or a value the site has locked.
const SOURCE_LABELS = { personal: "Customized", site: "Inherited", default: "Inherited", locked: "Locked by site" };
export function sourceBadge(source) {
  return badge(SOURCE_LABELS[source] || source, "source");
}

export function visibilityBadge(visibility) {
  return visibility === "shared"
    ? badge("Shared with workspace", "shared")
    : badge("Private", "private");
}

// Who an account belongs to, from the viewer's side (UX-002): "Private · yours", "Shared", or
// "Private · Alice's · shared with you".
export function accessBadge(account) {
  if (account.access === "shared") return badge("Shared with workspace", "shared");
  if (account.access === "granted") return badge(`Private · ${account.ownerName}'s · shared with you`, "private");
  return badge("Private · yours", "private");
}

export function money(decimal, currency, prefs, { masked } = {}) {
  const effective = (prefs && prefs.effective) || {};
  const hide = masked !== undefined ? masked : !!effective.balanceMasking;
  const text = formatAmount(decimal, currency, { numberFormat: effective.numberFormat, masked: hide });
  if (!hide) return el("span", { class: ["num", isNegative(decimal) ? "money--out" : "money--in"], text });
  // Masked amounts are explained in real (visually hidden) text; aria-label on a plain span is
  // ignored by many screen readers (A11Y-019).
  return el("span", { class: "num money--masked" }, [el("span", { "aria-hidden": "true", text }), el("span", { class: "sr-only", text: `${currency} amount hidden (balance masking is on)` })]);
}

// A category with its colour (BT-011-04) and icon (BT-011-05). Colour is never the only signal: the
// name is always beside it, and the dot or icon is hidden from assistive technology. With an icon,
// the icon itself carries the colour (every palette colour has at least 3:1 contrast on every
// surface), so there is no separate dot. The colour reaches CSS through the CSSOM, never a style
// attribute.
export function categoryLabel(name, color, iconId = null) {
  if (iconId) {
    return el("span", { class: "catlabel" }, [
      el("span", { class: "catlabel__icon", "aria-hidden": "true", vars: { "--swatch": color || null } }, [icon(iconId)]),
      el("span", { text: name }),
    ]);
  }
  return el("span", { class: "catlabel" }, [
    color ? el("span", { class: "swatch-dot", "aria-hidden": "true", vars: { "--swatch": color } }) : null,
    el("span", { text: name }),
  ]);
}

// Money direction (BT-011-05): in, out, transfer, refund or reversal, beside the amount. In, out
// and transfer are already said by the sign and the row; a refund or reversal is not, so it is
// also named in text for assistive technology (UXI-4).
export function amountWithDirection(t, prefs) {
  const dir = directionOf(t);
  return el("span", { class: "amount-dir" }, [
    el("span", { class: `dir dir--${dir}` }, [icon(dir)]),
    dir === "reversal" ? el("span", { class: "sr-only", text: `${iconLabel(dir)}: ` }) : null,
    money(t.amount, t.currency, prefs, { masked: false }),
  ]);
}

// A transfer leg names where the money went or came from, with that account's icon — no two-way
// arrow (Terry, 2026-09-13). An account the viewer cannot see is "another account".
export function transferLabel(t, accountsById) {
  const other = accountsById.get(t.counterpartAccountId);
  const minor = t.amountMinor !== undefined ? t.amountMinor : Number(String(t.amount || "0").replace(/[^0-9.-]/g, ""));
  return withIcon(other && other.icon ? other.icon : "bank", `Transfer ${minor < 0 ? "to" : "from"} ${other ? other.name : "another account"}`);
}

// A plain figure (a planned amount, spending total or similar magnitude) that is neither money in
// nor money out, so it is not coloured as either; `alert` marks a shortfall.
export function amountText(decimal, currency, prefs, { alert = false } = {}) {
  const effective = (prefs && prefs.effective) || {};
  return el("span", { class: ["num", alert ? "money--alert" : ""], text: formatAmount(decimal, currency, { numberFormat: effective.numberFormat }) });
}

// Selects that move the person somewhere or save something commit only on an explicit choice —
// a pointer pick, Enter, or leaving the control — never on each arrow key (WCAG 3.2.2, A11Y-002).
export function commitOnConfirm(selectEl, onCommit) {
  let last = selectEl.value;
  let browsing = false;
  const commit = () => { browsing = false; if (selectEl.value !== last) { last = selectEl.value; onCommit(selectEl.value); } };
  selectEl.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key) || (e.key.length === 1 && !e.ctrlKey && !e.metaKey)) browsing = true;
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { selectEl.value = last; browsing = false; }
  });
  selectEl.addEventListener("pointerdown", () => { browsing = false; });
  selectEl.addEventListener("change", () => { if (!browsing) commit(); });
  selectEl.addEventListener("blur", commit);
  return { reset(value) { last = value; selectEl.value = value; } };
}

export function stateView(slice, { empty = "Nothing here yet.", isEmpty = () => false } = {}) {
  if (!slice || slice.status === Status.LOADING || slice.status === Status.IDLE) {
    return el("div", { class: "state", role: "status", text: "Loading…" });
  }
  if (slice.status === Status.ERROR) {
    return el("div", { class: "state state--error", role: "alert" }, [
      el("strong", { text: "This could not be loaded. " }),
      el("span", { text: messageFor(slice.error) }),
    ]);
  }
  if (isEmpty(slice.data)) return el("div", { class: "state", text: empty });
  return null;
}

export function pageHead(title, actions = []) {
  return el("div", { class: "page-head" }, [el("h1", { text: title }), el("div", { class: "page-head__actions" }, actions)]);
}

export function initials(name, email) {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0] || "?")[0] + ((parts[1] || "")[0] || "")).toUpperCase();
}
