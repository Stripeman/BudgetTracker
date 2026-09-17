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

// Wraps an already-enabled control with a plain-language explanation, shown on hover/focus (the
// `.tip--info` CSS modifier) and to screen readers via `aria-describedby` (Terry, 2026-09-17: "add
// nice tool tips" for an action whose name alone wasn't clear — "Record next"). `id` must be
// unique on the page; the wrapped control must accept `aria-describedby` (every `button()` does).
export function infoTip(node, text, id) {
  node.setAttribute("aria-describedby", [node.getAttribute("aria-describedby"), id].filter(Boolean).join(" "));
  return el("span", { class: "tip tip--info", "data-tip": text }, [node, el("span", { class: "sr-only", id, text })]);
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
