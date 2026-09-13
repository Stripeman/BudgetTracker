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

const SOURCE_LABELS = { personal: "Customized", site: "Inherited from site", locked: "Locked by site", default: "Default" };
export function sourceBadge(source) {
  return badge(SOURCE_LABELS[source] || source, "source");
}

export function visibilityBadge(visibility) {
  return visibility === "shared"
    ? badge("Shared with workspace", "shared")
    : badge("Private", "private");
}

export function money(decimal, currency, prefs, { masked } = {}) {
  const effective = (prefs && prefs.effective) || {};
  const hide = masked !== undefined ? masked : !!effective.balanceMasking;
  const text = formatAmount(decimal, currency, { numberFormat: effective.numberFormat, masked: hide });
  const node = el("span", { class: ["num", hide ? "money--masked" : isNegative(decimal) ? "money--out" : "money--in"], text });
  if (hide) node.setAttribute("aria-label", "Amount hidden (balance masking is on)");
  return node;
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
