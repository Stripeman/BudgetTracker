// BT-011-03 — THE THEME PICKER, ported from TaskTracker app/js/ui/themepicker.js (T: main a1ec150,
// RF-20260904-14): a compact toggle showing the current palette's colour circle and name, opening a
// scrollable listbox of palettes, each with its own circle. TaskTracker's reasoning, kept verbatim:
//
//   An `<option>` cannot reliably carry a colour swatch. Browsers render option content
//   inconsistently and several ignore styling on it outright, so the circle would be present in the
//   markup and invisible on screen for some people — which is the same as not building it.
//   It is a `listbox` with `option` children, which is what it actually is, so what is announced
//   matches what is drawn.
//
//   STATE IS HELD HERE, NEVER READ BACK OFF THE ELEMENT: `hidden` is a reflected property in a
//   browser and plain `undefined` in a lightweight test DOM.
//
// DOCUMENTED ADAPTATIONS for BudgetTracker (TaskTracker's picker relies on native buttons only; the
// accessibility reviews of this app require more — see docs/TASKTRACKER_REUSE.md):
//   * opening moves focus to the selected option and scrolls it into view;
//   * ArrowDown/ArrowUp/Home/End move between options; Escape closes and returns focus to the
//     toggle without closing a surrounding menu; Tab closes; a click outside closes;
//   * after a pick, focus returns to the toggle (it would otherwise fall to <body>);
//   * with an external label the accessible name still includes the current palette;
//   * `setDisabled` also closes the list and is used for a site-locked setting.
// Swatch colours go through the CSSOM (`vars`), never a style attribute, so the CSP holds.
import { el } from "./dom.js";
import { THEMES } from "./theme.js";
import { icon } from "./icons.js";

let counter = 0;

// The circle for a palette or colour, or the icon for an icon entry (BT-011-05). Both are
// decoration: the name beside them is what is announced.
const glyph = (entry) => (entry.icon
  ? el("span", { class: "themepick__icon", "aria-hidden": "true", vars: { "--swatch": entry.tint || null } }, [icon(entry.icon)])
  : el("span", { class: "menu__swatch", "aria-hidden": "true", vars: { "--menu-swatch": entry.swatch } }));

// `entries` defaults to the application themes. The category colour picker (BT-011-04) and the icon
// picker (BT-011-05) reuse the same visual pattern with their own entries, so expense colours and
// icons stay independent of the app theme. An entry carries either `swatch` or `icon`.
export function createThemePicker({ value, onPick, id = null, labelledBy = null, describedBy = null, listLabel = "Colour palette", entries = THEMES, namePrefix = "Theme" } = {}) {
  const listId = `themepick-${++counter}`;
  const nameId = `${listId}-name`;
  const entryOf = (themeId) => entries.find((t) => t.id === themeId) || entries[0];
  let current = entryOf(value);

  const toggleSwatch = el("span", { class: "themepick__glyph" }, [glyph(current)]);
  const toggleLabel = el("span", { class: "themepick__name", id: nameId, text: current.label });
  const toggle = el("button", {
    class: "themepick__toggle",
    id: id || null,
    type: "button",
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "aria-controls": listId,
    // NAMES THE CURRENT VALUE, not merely the control (TaskTracker). With an external label the name
    // is "<label> <current palette>" (adaptation: TaskTracker's labelled mode dropped the value).
    "aria-label": labelledBy ? null : `${namePrefix}: ${current.label}`,
    "aria-labelledby": labelledBy ? `${labelledBy} ${nameId}` : null,
    "aria-describedby": describedBy || null,
  }, [toggleSwatch, toggleLabel, el("span", { class: "themepick__caret", "aria-hidden": "true", text: "▾" })]);

  const options = [];
  const list = el("div", { class: "themepick__list", id: listId, role: "listbox", "aria-label": listLabel, hidden: true }, entries.map((entry) => {
    const option = el("button", {
      class: ["themepick__option", entry.id === current.id ? "themepick__option--current" : ""].filter(Boolean).join(" "),
      type: "button",
      role: "option",
      tabindex: "-1",
      dataset: { theme: entry.id },
      "aria-selected": entry.id === current.id ? "true" : "false",
      onClick: () => {
        select(entry.id);
        setOpen(false);
        toggle.focus();
        if (typeof onPick === "function") onPick(entry.id);
      },
    }, [
      glyph(entry),
      el("span", { class: "themepick__name", text: entry.label }),
    ]);
    options.push(option);
    return option;
  }));

  function select(themeId) {
    current = entryOf(themeId);
    toggleSwatch.replaceChildren(glyph(current));
    toggleLabel.textContent = current.label;
    if (!labelledBy) toggle.setAttribute("aria-label", `${namePrefix}: ${current.label}`);
    // MATCHED BY ID, never by label text (TaskTracker).
    for (const option of options) {
      const isIt = option.dataset.theme === current.id;
      option.setAttribute("aria-selected", isIt ? "true" : "false");
      option.classList.toggle("themepick__option--current", isIt);
    }
  }

  const element = el("div", { class: "themepick" }, [toggle, list]);
  let open = false;
  const onOutside = (e) => { if (open && !element.contains(e.target)) setOpen(false); };
  function setOpen(next) {
    open = !!next;
    list.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (typeof document.addEventListener === "function") {
      if (open) document.addEventListener("pointerdown", onOutside, true);
      else document.removeEventListener("pointerdown", onOutside, true);
    }
  }
  function focusOption(index) {
    const option = options[Math.max(0, Math.min(options.length - 1, index))];
    option.focus();
    if (typeof option.scrollIntoView === "function") option.scrollIntoView({ block: "nearest" });
  }
  toggle.addEventListener("click", () => {
    setOpen(!open);
    if (open) focusOption(options.findIndex((o) => o.dataset.theme === current.id));
  });
  // Escape on the toggle of an open list closes the list only (UXI-1).
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  });
  list.addEventListener("keydown", (e) => {
    const at = options.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusOption(at + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusOption(at - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusOption(0); }
    else if (e.key === "End") { e.preventDefault(); focusOption(options.length - 1); }
    // Long lists (the icon picker has over fifty entries): a page at a time, and type-ahead to the
    // next entry whose name starts with the typed letter (UXI-2, the listbox pattern).
    else if (e.key === "PageDown") { e.preventDefault(); focusOption(at + 5); }
    else if (e.key === "PageUp") { e.preventDefault(); focusOption(at - 5); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); toggle.focus(); }
    else if (e.key === "Tab") setOpen(false);
    else if (typeof e.key === "string" && e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ch = e.key.toLowerCase();
      const n = options.length;
      for (let i = 1; i <= n; i += 1) {
        const index = (at + i + n) % n;
        if (entries[index].label.toLowerCase().startsWith(ch)) { e.preventDefault(); focusOption(index); break; }
      }
    }
  });

  return {
    element,
    select,
    getValue: () => current.id,
    isOpen: () => open,
    setDisabled(disabled) {
      toggle.disabled = !!disabled;
      for (const option of options) option.disabled = !!disabled;
      if (disabled) setOpen(false);
    },
  };
}
