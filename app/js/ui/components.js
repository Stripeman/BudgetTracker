// Small shared view helpers. Every list uses `stateView` so loading, error and empty are three
// different things: a failure is never shown as "nothing here".
import { el } from "./dom.js";
import { messageFor } from "../core/errors.js";
import { formatAmount, isNegative } from "../core/format.js";
import { Status } from "../core/store.js";

let fieldCounter = 0;
export const uid = (prefix = "f") => `${prefix}-${++fieldCounter}`;

export function field(label, control, { help, wide = false } = {}) {
  if (!control.id) control.id = uid();
  const helpId = help ? `${control.id}-help` : null;
  if (helpId) control.setAttribute("aria-describedby", helpId);
  return el("div", { class: ["field", wide ? "field--wide" : ""] }, [
    el("label", { class: "field__label", for: control.id, text: label }),
    control,
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

export function button(label, onClick, { variant = "", small = false, attrs = {} } = {}) {
  return el("button", { type: "button", class: ["btn", variant ? `btn--${variant}` : "", small ? "btn--small" : ""], onClick, ...attrs, text: label });
}

export function badge(text, variant = "") {
  return el("span", { class: ["badge", variant ? `badge--${variant}` : ""], text });
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
