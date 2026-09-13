// THE COMMAND PALETTE PICKER — type first, choose second. BT-004-04.
//
// Ported from TaskTracker app/js/ui/commandpicker.js (T: main fb24a41, 514 lines), so BudgetTracker's
// dropdowns look and behave like TaskTracker's (Terry, 2026-09-14: "why dont we do like we do on the
// tasktracker.. im all for consistency"). TaskTracker's reasoning, kept:
//
//   A native `<select>` cannot show a mark, cannot be searched and renders differently on every
//   platform. This replaces the LOOK and the INTERACTION while keeping the semantics.
//
//   THE NATIVE SELECT IS STILL THE STATE. It sits behind the trigger, hidden from sight but present,
//   holding the value: `read()` returns `select.value`, so there is exactly one answer to "what is
//   chosen"; anything that already sets the select keeps working, and the palette re-reads rather
//   than fighting it. So this is an enhancement over a working control, not a replacement for one.
//
//   SEARCH-FIRST, WHERE SEARCH IS WORTH IT. The panel opens focused on its own search box and filters
//   as you type. A short vocabulary (`search: false`) gets no box and type-ahead instead, exactly as a
//   native select has; above SEARCH_THRESHOLD options the box comes back regardless.
//
//   CSP-SAFE. A colour or a position reaches the document as a custom property through the CSSOM
//   (`vars`, `style.setProperty("--name")`), never as a style attribute. `el()` throws on one, and
//   `npm run validate` fails the build if any appears in app/js.
//
// BUDGETTRACKER ADAPTATIONS (docs/TASKTRACKER_REUSE.md, "Command picker"):
//   A1 The hidden select is taken out of the tab order and the accessibility tree (tabindex -1,
//      aria-hidden). TaskTracker left it focusable, so keyboard users met an invisible tab stop and
//      screen readers a second, unlabelled copy of the control. The trigger carries the name.
//   A2 The search box is a real combobox (role, aria-expanded, aria-controls, aria-autocomplete) and
//      aria-activedescendant names the active row's ID. TaskTracker set it on the listbox to the
//      option's VALUE, which is not an id, on an element that does not hold focus.
//   A3 The create action is a button OUTSIDE the listbox, pinned under the results so a long list
//      never scrolls it away (a listbox may only contain options). It answers `click`, so Enter and
//      Space work on it — TaskTracker's answered only `mousedown`, and Enter on it fell through to the
//      panel and chose the highlighted row instead. Its "+" is hidden from assistive technology, so
//      its name is the plain label. Focus returns to the trigger BEFORE the action runs, so a dialog
//      it opens gives focus back to the trigger when it closes.
import { el, clear } from "./dom.js";
import { computePlacement } from "../core/popover.js";
import { registerPopup } from "./popup.js";

let counter = 0;

// Above this many options, a field that asked for no search box gets one anyway.
const SEARCH_THRESHOLD = 12;

/**
 * @param {object} options
 * @param {HTMLSelectElement} options.select  the control that holds the value
 * @param {string} options.label              what is being chosen, used in accessible names
 * @param {string} [options.placeholder]      shown when nothing is chosen
 * @param {(value: string) => string|null} [options.colorOf]  a colour for an option (a swatch dot)
 * @param {boolean} [options.search]          whether to offer a search box. Default true.
 * @param {{label: string, onPick: (term: string) => void}} [options.create]
 *        an action pinned under the results — "+ New workspace".
 * @param {(value: string) => (Node|null)} [options.badgeOf]
 *        a small leading mark for an option, rendered before the label in the list and on the
 *        trigger. A NODE FACTORY: it must return a NEW element each call.
 * @param {(value: string) => (string|null)} [options.describeOf]
 *        the row's spoken name, when the visible label is not the whole fact ("Family — Manager").
 */
export function createCommandPicker({ select, label = "Choose", placeholder = "", colorOf = null, badgeOf = null, describeOf = null, create = null, search: wantSearch = true } = {}) {
  if (!select) throw new Error("createCommandPicker needs the select that holds the value.");

  const id = `cmdpick-${++counter}`;
  const listId = `${id}-list`;
  let open = false;
  let active = 0;
  // A LIST, NOT A SLOT: several callers may listen.
  const listeners = [];
  const notify = () => {
    for (const fn of listeners) if (typeof fn === "function") fn();
  };

  // THE SELECT STAYS IN THE DOCUMENT. Hidden from sight, not from the form (A1: nor a tab stop).
  select.classList.add("cmdpick__native");
  select.setAttribute("tabindex", "-1");
  select.setAttribute("aria-hidden", "true");

  // querySelectorAll, NOT `select.options`: an HTMLOptionsCollection is not declared iterable, and a
  // snapshot of option ELEMENTS works everywhere, the test double included.
  function countOptions() {
    return select.querySelectorAll("option").length;
  }

  const swatch = el("span", { class: "cmdpick__swatch", "aria-hidden": "true" });
  // Where the caller's mark sits on the closed trigger; empty and hidden when there is none.
  const badgeSlot = el("span", { class: "cmdpick__badge", hidden: true });
  const valueText = el("span", { class: "cmdpick__value" });
  const trigger = el("button", {
    class: "cmdpick__trigger",
    type: "button",
    id,
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    onClick: () => (open ? close() : show()),
  }, [swatch, badgeSlot, valueText, el("span", { class: "cmdpick__hint", "aria-hidden": "true", text: hintGlyph() })]);

  // A MAGNIFIER PROMISES SEARCH; a chevron promises a list.
  function hintGlyph() {
    return wantSearch !== false || countOptions() > SEARCH_THRESHOLD ? "⌕" : "▾";
  }

  // Decided once, at construction, so a panel never gains or loses a row under somebody's cursor.
  const searchable = wantSearch !== false || countOptions() > SEARCH_THRESHOLD;

  const search = el("input", {
    type: "text",
    class: "cmdpick__search",
    // A2 — the box that holds focus while the list is browsed is a combobox for that list.
    role: "combobox",
    "aria-expanded": "true",
    "aria-autocomplete": "list",
    "aria-label": `Search ${label.toLowerCase()}`,
    "aria-controls": listId,
    autocomplete: "off",
    spellcheck: "false",
    placeholder: `Search ${label.toLowerCase()}…`,
  });

  // The list needs a keyboard home when there is no search box to hold focus.
  const list = el("div", {
    class: "cmdpick__list",
    id: listId,
    role: "listbox",
    "aria-label": label,
    ...(searchable ? {} : { tabindex: "-1" }),
  });
  const keyHolder = searchable ? search : list;

  // A3 — pinned under the results, outside the listbox.
  const createLabel = el("span", { class: "cmdpick__createlabel" });
  const createButton = create
    ? el("button", { class: "cmdpick__create", type: "button" }, [el("span", { class: "cmdpick__plus", "aria-hidden": "true", text: "+" }), createLabel])
    : null;

  const panel = el("div", { class: ["cmdpick__panel", searchable ? "" : "cmdpick__panel--nosearch"], role: "dialog", "aria-label": label }, [
    searchable
      ? el("div", { class: "cmdpick__searchrow" }, [
          el("span", { class: "cmdpick__icon", "aria-hidden": "true", text: "⌕" }),
          search,
          el("kbd", { class: "cmdpick__kbd", "aria-hidden": "true", text: "esc" }),
        ])
      : null,
    list,
    createButton,
    // The hints are for sighted keyboard users; the roles already tell a screen reader the keys.
    el("div", { class: "cmdpick__foot", "aria-hidden": "true" }, [
      el("span", {}, [el("kbd", { class: "cmdpick__kbd", text: "↑↓" }), el("span", { text: " move" })]),
      el("span", {}, [el("kbd", { class: "cmdpick__kbd", text: "↵" }), el("span", { text: " choose" })]),
      searchable ? null : el("span", {}, [el("kbd", { class: "cmdpick__kbd", text: "esc" }), el("span", { text: " close" })]),
    ].filter(Boolean)),
  ].filter(Boolean));
  panel.setAttribute("hidden", "");

  const element = el("div", { class: "cmdpick" }, [trigger, select]);

  // THE SHARED DISMISSAL CONTRACT (ui/popup.js). The trigger counts as inside, or clicking it would
  // close and immediately re-open the panel.
  const dismissal = registerPopup({
    contains: (node) => element.contains(node) || panel.contains(node),
    close: () => close({ restoreFocus: false }),
    isOpen: () => open,
    ownerDocument: () => element.ownerDocument,
    anchor: () => element,
  });

  // ---- what is on offer ---------------------------------------------------

  const options = () =>
    Array.from(select.querySelectorAll("option")).map((o) => ({
      value: o.getAttribute("value") ?? o.value ?? "",
      label: o.textContent,
      disabled: !!o.disabled,
    }));

  const chosen = () => options().find((o) => o.value === select.value) || null;

  function paintTrigger() {
    const hit = chosen();
    const colour = hit && colorOf ? colorOf(hit.value) : null;
    // Rebuilt rather than moved: `badgeOf` returns a new node each call.
    clear(badgeSlot);
    const mark = hit && badgeOf ? badgeOf(hit.value) : null;
    if (mark) badgeSlot.appendChild(mark);
    badgeSlot.hidden = !mark;
    valueText.textContent = hit && hit.label ? hit.label : placeholder || `Choose ${label.toLowerCase()}…`;
    element.classList.toggle("cmdpick--empty", !hit || !hit.value);
    element.classList.toggle("cmdpick--swatched", !!colour);
    if (colour) element.style.setProperty("--swatch", colour);
    else element.style.removeProperty("--swatch");
    // The spoken value is the full description when there is one ("Family — Manager"), so the
    // closed control never says less than the open list.
    const spoken = hit && describeOf ? describeOf(hit.value) || valueText.textContent : valueText.textContent;
    trigger.setAttribute("aria-label", `${label}: ${spoken}. Search and choose.`);
  }

  // AN OPTION THAT CANNOT BE CHOSEN IS STILL SHOWN, with its reason in its label.
  function matches() {
    const term = search.value.trim().toLowerCase();
    const all = options();
    if (!term) return all;
    return all.filter((o) => o.label.toLowerCase().includes(term));
  }

  // Where the keyboard is allowed to land. Disabled rows are readable and skippable, never targets.
  function step(found, from, direction) {
    for (let i = from + direction; i >= 0 && i < found.length; i += direction) {
      if (!found[i].disabled) return i;
    }
    return from;
  }

  function firstSelectable(found) {
    const index = found.findIndex((o) => !o.disabled);
    return index < 0 ? 0 : index;
  }

  function lastSelectable(found) {
    for (let i = found.length - 1; i >= 0; i -= 1) if (!found[i].disabled) return i;
    return Math.max(0, found.length - 1);
  }

  const rowId = (index) => `${id}-opt-${index}`;

  function paintList() {
    clear(list);
    const found = matches();
    active = Math.min(active, Math.max(0, found.length - 1));

    if (!found.length) {
      list.appendChild(el("p", { class: "cmdpick__none", role: "presentation", text: `Nothing matches “${search.value.trim()}”.` }));
    }

    found.forEach((option, index) => {
      const colour = colorOf ? colorOf(option.value) : null;
      const row = el("div", {
        id: rowId(index),
        class: [
          "cmdpick__opt",
          index === active && !option.disabled ? "cmdpick__opt--active" : "",
          option.value === select.value ? "cmdpick__opt--on" : "",
          option.disabled ? "cmdpick__opt--off" : "",
          colour ? "cmdpick__opt--swatched" : "",
        ],
        role: "option",
        "aria-selected": option.value === select.value ? "true" : "false",
        "aria-label": describeOf ? describeOf(option.value) : null,
        // aria-disabled, not `disabled`: a listbox option must stay READABLE while unchoosable.
        "aria-disabled": option.disabled ? "true" : null,
        vars: colour ? { "--swatch": colour } : null,
        dataset: { value: option.value },
      }, [
        colour ? el("span", { class: "cmdpick__dot", "aria-hidden": "true" }) : null,
        badgeOf ? badgeOf(option.value) : null,
        el("span", { class: "cmdpick__optlabel", text: option.label }),
        option.value === select.value ? el("span", { class: "cmdpick__tick", "aria-hidden": "true", text: "✓" }) : null,
      ].filter(Boolean));
      row.addEventListener("mousedown", (event) => {
        // mousedown, not click: the search box loses focus first otherwise and the panel
        // closes out from under the pointer.
        event.preventDefault();
        if (option.disabled) return;
        pick(option.value);
      });
      row.addEventListener("mousemove", () => {
        if (option.disabled) return;
        active = index;
        markActive();
      });
      list.appendChild(row);
    });

    if (createButton) {
      const term = search.value.trim();
      createLabel.textContent = term ? `${create.label} “${term}”` : create.label;
    }
    markActive({ scroll: false });
  }

  function markActive({ scroll = true } = {}) {
    const rows = Array.from(list.querySelectorAll(".cmdpick__opt"));
    rows.forEach((row, index) => row.classList.toggle("cmdpick__opt--active", index === active && !row.classList.contains("cmdpick__opt--off")));
    const current = rows[active];
    if (current && scroll && typeof current.scrollIntoView === "function") current.scrollIntoView({ block: "nearest" });
    // A2 — the id of the row, on the element that holds focus.
    if (current && !current.classList.contains("cmdpick__opt--off")) keyHolder.setAttribute("aria-activedescendant", current.id);
    else keyHolder.removeAttribute("aria-activedescendant");
  }

  function pick(value) {
    // THE LAST WORD ON WHETHER THIS IS ALLOWED.
    const option = options().find((o) => o.value === value);
    if (!option || option.disabled) return;
    select.value = value;
    // The select is the state, so telling it it changed is telling everything that listens.
    select.dispatchEvent(new Event("change", { bubbles: true }));
    paintTrigger();
    close();
    notify();
  }

  function runCreate() {
    if (!create) return;
    const term = search.value.trim();
    // A3 — focus goes back to the trigger first, so whatever the action opens returns it there.
    close();
    create.onPick(term);
  }

  // ---- opening and closing ------------------------------------------------

  function show() {
    if (select.disabled) return;
    const doc = element.ownerDocument;
    if (!doc || !doc.body || !doc.body.contains(trigger)) return;
    open = true;
    doc.body.appendChild(panel);
    panel.removeAttribute("hidden");
    trigger.setAttribute("aria-expanded", "true");
    search.value = "";
    const found = matches();
    const current = found.findIndex((o) => o.value === select.value && !o.disabled);
    active = current >= 0 ? current : firstSelectable(found);
    paintList();
    place();
    keyHolder.focus();
    dismissal.opened();
  }

  function close({ restoreFocus = true } = {}) {
    if (!open) return;
    open = false;
    panel.setAttribute("hidden", "");
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    trigger.setAttribute("aria-expanded", "false");
    const doc = element.ownerDocument;
    if (restoreFocus && doc && doc.body && doc.body.contains(trigger)) trigger.focus();
  }

  // Placed against the viewport, outside whatever is scrolling. The position reaches CSS as two
  // custom properties through the CSSOM — never a style attribute (CSP).
  function place() {
    const doc = element.ownerDocument;
    const view = doc && doc.defaultView;
    if (!view || typeof trigger.getBoundingClientRect !== "function") return;
    panel.style.removeProperty("--pop-max-height");
    const natural = panel.getBoundingClientRect();
    const at = computePlacement({
      anchor: trigger.getBoundingClientRect(),
      panel: natural,
      viewport: { width: view.innerWidth, height: view.innerHeight },
    });
    if (!at) return;
    panel.style.setProperty("--pop-left", `${Math.round(at.left)}px`);
    panel.style.setProperty("--pop-top", `${Math.round(at.top)}px`);
    // CAPPED ONLY WHEN IT DOES NOT FIT (adaptation: TaskTracker sets no cap). `maxHeight` is rounded,
    // so capping a panel that fits could cut a fraction of a pixel and give a one-row list a
    // scrollbar — seen in headless Edge before this rule.
    if (at.maxHeight < natural.height - 0.5) panel.style.setProperty("--pop-max-height", `${Math.floor(at.maxHeight)}px`);
  }

  // ---- keyboard -----------------------------------------------------------

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      show();
    }
  });

  if (createButton) {
    createButton.addEventListener("mousedown", (event) => event.preventDefault());
    createButton.addEventListener("click", (event) => {
      event.preventDefault();
      runCreate();
    });
  }

  panel.addEventListener("keydown", (event) => {
    const found = matches();
    if (event.key === "Escape") {
      event.preventDefault();
      // Stopped here so Escape closes the palette rather than a dialog around it.
      event.stopPropagation();
      close();
      return;
    }
    // A3 — the create button's own keys are its own: Enter and Space activate it natively.
    if (createButton && event.target === createButton) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        keyHolder.focus();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = step(found, active, 1);
      markActive();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = step(found, active, -1);
      markActive();
    } else if (event.key === "Home") {
      event.preventDefault();
      active = firstSelectable(found);
      markActive();
    } else if (event.key === "End") {
      event.preventDefault();
      active = lastSelectable(found);
      markActive();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (found[active] && !found[active].disabled) pick(found[active].value);
    } else if (!searchable && isTypeAhead(event)) {
      // WHAT A NATIVE SELECT DOES: a letter MOVES to the next option starting with it.
      event.preventDefault();
      const at = typeAhead(found, event.key, active);
      if (at >= 0) {
        active = at;
        markActive();
      }
    }
  });

  function isTypeAhead(event) {
    return (
      typeof event.key === "string" &&
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    );
  }

  // FROM THE ONE AFTER THE CURRENT ROW, wrapping, so repeating a letter cycles.
  function typeAhead(found, key, from) {
    const letter = key.toLowerCase();
    for (let offset = 1; offset <= found.length; offset += 1) {
      const index = (from + offset + found.length) % found.length;
      const option = found[index];
      if (!option || option.disabled) continue;
      if (String(option.label || "").trim().toLowerCase().startsWith(letter)) return index;
    }
    return -1;
  }

  search.addEventListener("input", () => {
    const found = matches();
    active = firstSelectable(found);
    paintList();
  });

  // TABBING OUT, not clicking out — the pointer is the registry's job. Focus that went NOWHERE is a
  // press on inert text, not somebody leaving.
  panel.addEventListener("focusout", (event) => {
    if (!open) return;
    const to = event.relatedTarget;
    if (!to) return;
    if (panel.contains(to) || element.contains(to)) return;
    close({ restoreFocus: false });
  });

  // Anything that changes the select from outside is reflected rather than fought.
  select.addEventListener("change", paintTrigger);

  paintTrigger();

  return {
    element,
    read: () => select.value,
    isOpen: () => open,
    setDisabled(disabled) {
      select.disabled = !!disabled;
      trigger.disabled = !!disabled;
      if (disabled) close({ restoreFocus: false });
    },
    focus: () => trigger.focus(),
    refresh() {
      paintTrigger();
      if (open) paintList();
    },
    destroy: () => {
      close({ restoreFocus: false });
      dismissal.destroy();
    },
    onChange(fn) {
      listeners.push(fn);
    },
  };
}
