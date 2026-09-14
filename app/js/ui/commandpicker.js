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
//   Step 2 (BT-004-05, every dropdown in the app goes through app/js/ui/selectpicker.js):
//   A4 `setLabel()`: the field that hosts the picker names it, so the label, the trigger, the panel,
//      its list and its search box always use the same words.
//   A5 Native parity for views: choosing what is already chosen closes the panel and fires nothing,
//      and a real choice fires `input` then `change`, as a native select does.
//   A6 Nothing is cut off and nothing is a dead end: the panel is at least as wide as its trigger
//      (`--pop-min-width`), an empty list says "Nothing to choose from.", a list without a search box
//      is spoken as "Choose." rather than "Search and choose.", and Tab or Shift+Tab at the panel's
//      edge closes it and continues from the trigger, so a dialog's own Tab order carries on.
//   A7 `close()` is public, so a control that is disabled from outside can close its panel.
//   Accessibility and UX review fixes (2026-09-14, reviews of be25017; docs/TASKTRACKER_REUSE.md):
//   A8 Inside an aria-modal dialog the panel is appended to the dialog, not the body, so assistive
//      technology that honours aria-modal can still reach its options; the dialog's Tab trap leaves
//      Tab inside the panel to the panel (modal.js).
//   A9 A press outside that lands on something that cannot take focus returns focus to the trigger
//      (never <body>); a press on the field's own label is not outside the picker.
//   A10 A polite status region in the panel announces result counts and empty lists.
//   A11 A panel that would be too short to read on either side spans the viewport (popover.js rule 6).
//   A12 While open, the panel follows its trigger on scroll, resize and visual-viewport resize, and
//       closes (focus back on the trigger) when the trigger scrolls out of sight.
import { el, clear } from "./dom.js";
import { computePlacement } from "../core/popover.js";
import { registerPopup } from "./popup.js";

let counter = 0;

// What a press can move focus to on purpose: a control, or anything in the Tab order. A container that
// takes focus only programmatically (<main tabindex=-1>, a list with tabindex -1) is not a control.
const CONTROLS = ["button", "input", "select", "textarea", "a[href]", "summary", "[contenteditable]", "[tabindex]"];
function landsOnControl(node) {
  for (let n = node; n && typeof n.matches === "function"; n = n.parentNode) {
    if (CONTROLS.some((selector) => n.matches(selector))) return n.getAttribute("tabindex") !== "-1" && !n.disabled;
  }
  return false;
}

// Above this many options, a field that asked for no search box gets one anyway.
const SEARCH_THRESHOLD = 12;

// How long typing must pause before the result count is spoken (A10).
const ANNOUNCE_DELAY = 400;

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
export function createCommandPicker({ select, label = "Choose", placeholder = "", colorOf = null, badgeOf = null, describeOf = null, create = null, search: wantSearch = true, labelVisible = false } = {}) {
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
  // Where the caller's mark sits on the closed trigger; empty and hidden when there is none. Hidden from
  // assistive technology as well (A13): what it means is in the spoken value ("Family budget — Owner").
  const badgeSlot = el("span", { class: "cmdpick__badge", hidden: true, "aria-hidden": "true" });
  // A13 — the value is drawn once and read once: sighted people see `valueText`, a screen reader hears
  // `spoken`, which is the full value (the description when there is one).
  const valueText = el("span", { class: "cmdpick__value", "aria-hidden": "true" });
  const spoken = el("span", { class: "cmdpick__spoken sr-only" });
  // A13 — how to use it is a description of the control, never part of its name.
  const howId = `${id}-how`;
  const how = el("span", { id: howId, hidden: true });
  const panelId = `${id}-panel`;
  const trigger = el("button", {
    class: "cmdpick__trigger",
    type: "button",
    id,
    // A13 — A SELECT-ONLY COMBOBOX, the ARIA pattern for a custom select: named by its field's label,
    // its value in its text, required and invalid supported (a button carries neither), and a popup
    // it controls. TaskTracker's trigger is a plain button whose name held the value and instructions.
    role: "combobox",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    "aria-controls": panelId,
    onClick: () => (open ? close() : show()),
  }, [swatch, badgeSlot, valueText, spoken, el("span", { class: "cmdpick__hint", "aria-hidden": "true", text: hintGlyph() })]);

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

  // A10 — WHAT A SEARCH FOUND IS SPOKEN. A screen reader hears nothing when rows appear or vanish, and
  // "Nothing matches" inside the listbox is ignored. A polite status region in the panel (outside the
  // listbox) says "3 results" or "Nothing matches “x”." once typing pauses.
  const status = el("div", { class: "cmdpick__status sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });

  const panel = el("div", { class: ["cmdpick__panel", searchable ? "" : "cmdpick__panel--nosearch"], id: panelId, role: "dialog", "aria-label": label }, [
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
    status,
  ].filter(Boolean));
  panel.setAttribute("hidden", "");

  const element = el("div", { class: "cmdpick" }, [trigger, select, how]);

  // THE SHARED DISMISSAL CONTRACT (ui/popup.js). The trigger counts as inside, or clicking it would
  // close and immediately re-open the panel — and so does the field's own label (A9), whose click is
  // the trigger's click.
  const ownLabel = (node) => !!(node && typeof node.closest === "function" && trigger.id && node.closest(`label[for="${trigger.id}"]`));
  const dismissal = registerPopup({
    contains: (node) => element.contains(node) || panel.contains(node) || ownLabel(node),
    close: (why) => dismiss(why),
    isOpen: () => open,
    ownerDocument: () => element.ownerDocument,
    anchor: () => element,
  });

  // A9 — A PRESS OUTSIDE NEVER LEAVES FOCUS ON THE PAGE. A press on another control moves focus there,
  // as before. A press on something that cannot take focus (a dialog title, the backdrop, text inside
  // <main tabindex=-1>) would drop it to <body>, outside any dialog, so focus goes back to the trigger —
  // after the press's own default action, and only if nothing real took focus meanwhile.
  function dismiss(why) {
    const doc = element.ownerDocument;
    const heldFocus = !!(doc && panel.contains(doc.activeElement));
    close({ restoreFocus: false });
    const target = why && why.target;
    if (!heldFocus || !target || landsOnControl(target)) return;
    setTimeout(() => {
      if (open || trigger.disabled || !doc.body || !doc.body.contains(trigger)) return;
      const now = doc.activeElement;
      if (now && now !== doc.body && now !== doc.documentElement && landsOnControl(now)) return;
      trigger.focus({ preventScroll: true });
    }, 0);
  }

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
    spoken.textContent = hit && describeOf ? describeOf(hit.value) || valueText.textContent : valueText.textContent;
    // A13 — the field names the combobox: its visible <label for>, or `label` when there is none.
    if (labelVisible) trigger.removeAttribute("aria-label");
    else trigger.setAttribute("aria-label", label);
    // A6 — a list without a search box is not described as searchable.
    how.textContent = searchable ? "Search and choose." : "Choose.";
    describeFromSelect();
  }

  // A13 — REQUIRED, INVALID AND THE ERROR TEXT COME FROM THE SELECT, the state views write to (a button
  // supports none of them; a combobox supports all three). The error text is described only while the
  // field is marked invalid: after the field's own help, before how to use it.
  function describeFromSelect() {
    const required = select.required === true || select.hasAttribute("required") || select.getAttribute("aria-required") === "true";
    if (required) trigger.setAttribute("aria-required", "true");
    else trigger.removeAttribute("aria-required");
    const invalid = select.getAttribute("aria-invalid");
    const isInvalid = !!invalid && invalid !== "false";
    if (isInvalid) trigger.setAttribute("aria-invalid", invalid);
    else trigger.removeAttribute("aria-invalid");
    const errorId = select.getAttribute("aria-errormessage");
    if (errorId) trigger.setAttribute("aria-errormessage", errorId);
    else trigger.removeAttribute("aria-errormessage");
    const ids = String(select.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    if (isInvalid && errorId && !ids.includes(errorId)) ids.push(errorId);
    ids.push(howId);
    trigger.setAttribute("aria-describedby", ids.join(" "));
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
      // A6 — a list with nothing in it says so, rather than "Nothing matches “”".
      const term = search.value.trim();
      list.appendChild(el("p", { class: "cmdpick__none", role: "presentation", text: term ? `Nothing matches “${term}”.` : "Nothing to choose from." }));
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
    // A5 — CHOOSING WHAT IS ALREADY CHOSEN CHANGES NOTHING, and a native select reports nothing.
    if (value === select.value) {
      close();
      return;
    }
    select.value = value;
    // The select is the state, so telling it it changed is telling everything that listens —
    // `input` then `change`, the order a native select fires them in (A5).
    select.dispatchEvent(new Event("input", { bubbles: true }));
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
    // A8 — INSIDE A MODAL DIALOG, THE PANEL LIVES IN THE DIALOG. `aria-modal` tells assistive technology
    // that nothing outside the dialog exists, so a panel on the body could be unreachable there
    // (VoiceOver/Safari). It stays `position: fixed`, so where it sits in the tree does not move it.
    // Outside a dialog it floats on the body, as in TaskTracker.
    const host = (typeof trigger.closest === "function" && trigger.closest('[aria-modal="true"]')) || doc.body;
    host.appendChild(panel);
    panel.removeAttribute("hidden");
    trigger.setAttribute("aria-expanded", "true");
    search.value = "";
    const found = matches();
    const current = found.findIndex((o) => o.value === select.value && !o.disabled);
    active = current >= 0 ? current : firstSelectable(found);
    paintList();
    // A10 — silent when there is something to choose; an empty list says so.
    stopAnnouncing();
    if (!found.length) announceSoon();
    place();
    follow();
    keyHolder.focus();
    dismissal.opened();
  }

  function close({ restoreFocus = true, preventScroll = false } = {}) {
    if (!open) return;
    open = false;
    stopAnnouncing();
    stopFollowing();
    panel.setAttribute("hidden", "");
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    trigger.setAttribute("aria-expanded", "false");
    const doc = element.ownerDocument;
    if (restoreFocus && doc && doc.body && doc.body.contains(trigger)) trigger.focus(preventScroll ? { preventScroll: true } : undefined);
  }

  // A12 — THE PANEL FOLLOWS ITS TRIGGER. It is fixed to the viewport, so when the page or a dialog body
  // scrolls, the window is resized or the on-screen keyboard shrinks the visual viewport, it is placed
  // again against where the trigger is now. When the trigger has scrolled out of sight (out of the
  // window, or out of the visible part of a scrolling ancestor), the list closes and focus goes back to
  // the trigger without scrolling it into view (UX review U1).
  let unfollow = null;
  function follow() {
    stopFollowing();
    const doc = element.ownerDocument;
    const view = doc && doc.defaultView;
    const onMove = (event) => {
      if (!open) return;
      const from = event && event.target;
      // The list's own scrolling moves nothing.
      if (from && from !== doc && typeof from.getAttribute === "function" && panel.contains(from)) return;
      if (!triggerVisible()) {
        close({ preventScroll: true });
        return;
      }
      place();
    };
    const vv = view && view.visualViewport;
    if (doc && typeof doc.addEventListener === "function") doc.addEventListener("scroll", onMove, true);
    if (view && typeof view.addEventListener === "function") view.addEventListener("resize", onMove);
    if (vv && typeof vv.addEventListener === "function") {
      vv.addEventListener("resize", onMove);
      vv.addEventListener("scroll", onMove);
    }
    unfollow = () => {
      if (doc && typeof doc.removeEventListener === "function") doc.removeEventListener("scroll", onMove, true);
      if (view && typeof view.removeEventListener === "function") view.removeEventListener("resize", onMove);
      if (vv && typeof vv.removeEventListener === "function") {
        vv.removeEventListener("resize", onMove);
        vv.removeEventListener("scroll", onMove);
      }
    };
  }
  function stopFollowing() {
    if (unfollow) unfollow();
    unfollow = null;
  }

  // Whether any of the trigger is still visible: inside the viewport and inside every ancestor that
  // clips its content (a dialog body with overflow:auto).
  function triggerVisible() {
    const doc = element.ownerDocument;
    const view = doc && doc.defaultView;
    if (!view || typeof trigger.getBoundingClientRect !== "function") return true;
    const r = trigger.getBoundingClientRect();
    const vp = viewportOf(view);
    let top = 0;
    let left = 0;
    let bottom = vp.height;
    let right = vp.width;
    if (typeof view.getComputedStyle === "function") {
      for (let n = element.parentNode; n && n !== doc.body && n !== doc.documentElement && typeof n.getBoundingClientRect === "function"; n = n.parentNode) {
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

  // The part of the window that can be seen: the visual viewport when the browser has one (an on-screen
  // keyboard shrinks it, not the window), in the fixed layout's coordinates.
  function viewportOf(view) {
    const width = view.innerWidth;
    const height = view.innerHeight;
    const vv = view.visualViewport;
    if (vv && vv.height > 0 && vv.width > 0) {
      return { width: Math.min(width, (vv.offsetLeft || 0) + vv.width), height: Math.min(height, (vv.offsetTop || 0) + vv.height) };
    }
    return { width, height };
  }

  // A11 — the least height worth showing: everything in the panel that is not the list (search row,
  // create button, key hints) plus about two and a half rows, or the whole list when it is shorter.
  function usefulHeight(panelHeight) {
    if (typeof list.getBoundingClientRect !== "function") return 0;
    const listHeight = list.getBoundingClientRect().height || 0;
    const chrome = Math.max(0, (panelHeight || 0) - listHeight);
    const content = typeof list.scrollHeight === "number" && list.scrollHeight > 0 ? list.scrollHeight : listHeight;
    const row = list.querySelector(".cmdpick__opt");
    const rowHeight = row && typeof row.getBoundingClientRect === "function" ? row.getBoundingClientRect().height || 0 : 0;
    return Math.ceil(chrome + (rowHeight > 0 ? Math.min(content, rowHeight * 2.5) : content));
  }

  // Placed against the viewport, outside whatever is scrolling. The position reaches CSS as two
  // custom properties through the CSSOM — never a style attribute (CSP).
  function place() {
    const doc = element.ownerDocument;
    const view = doc && doc.defaultView;
    if (!view || typeof trigger.getBoundingClientRect !== "function") return;
    panel.style.removeProperty("--pop-max-height");
    // A6 — AT LEAST AS WIDE AS THE TRIGGER, set before measuring, so a long option in a wide field
    // is never cut short by a narrower panel.
    panel.style.setProperty("--pop-min-width", `${Math.round(trigger.getBoundingClientRect().width)}px`);
    const natural = panel.getBoundingClientRect();
    const at = computePlacement({
      anchor: trigger.getBoundingClientRect(),
      panel: natural,
      viewport: viewportOf(view),
      // A11 — never a panel too short to read: below this it spans the viewport (popover.js rule 6).
      minUseful: usefulHeight(natural.height),
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
    // A6 — TAB AT THE PANEL'S EDGE LEAVES IT as if the panel sat right after its trigger: it closes,
    // focus goes back to the trigger, and the browser's own Tab (not prevented) moves on from there.
    // The panel floats on the body, outside any dialog, so a dialog's focus trap never sees it; this
    // is what keeps the dialog's Tab order going. Inside the panel, Tab moves as usual.
    if (event.key === "Tab") {
      const last = createButton || keyHolder;
      if ((event.shiftKey && event.target === keyHolder) || (!event.shiftKey && event.target === last)) close();
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
    announceSoon();
  });

  // A10 — debounced, so a screen reader hears the count for what was typed, not for every letter.
  let announceTimer = null;
  function resultsText() {
    const found = matches();
    const term = search.value.trim();
    if (!found.length) return term ? `Nothing matches “${term}”.` : "Nothing to choose from.";
    return `${found.length} ${found.length === 1 ? "result" : "results"}`;
  }
  function announceSoon() {
    clearTimeout(announceTimer);
    status.textContent = "";
    announceTimer = setTimeout(() => {
      announceTimer = null;
      if (open) status.textContent = resultsText();
    }, ANNOUNCE_DELAY);
  }
  function stopAnnouncing() {
    clearTimeout(announceTimer);
    announceTimer = null;
    status.textContent = "";
  }

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
    // A7 — closes the panel without moving focus and without changing the value.
    close: () => close({ restoreFocus: false }),
    refresh() {
      paintTrigger();
      if (open) paintList();
    },
    // A4 — the field that hosts the picker names it; every accessible name follows. `visible` (the
    // default, as components.js field() puts a <label for> beside it) means that label is the
    // trigger's name, so the trigger carries no aria-label of its own (A13).
    setLabel(text, { visible = true } = {}) {
      if (!text) return;
      label = String(text);
      labelVisible = !!visible;
      search.setAttribute("aria-label", `Search ${label.toLowerCase()}`);
      search.setAttribute("placeholder", `Search ${label.toLowerCase()}…`);
      list.setAttribute("aria-label", label);
      panel.setAttribute("aria-label", label);
      paintTrigger();
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
