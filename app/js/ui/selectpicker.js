// EVERY DROPDOWN IS THE COMMAND PICKER. BT-004-05.
//
// Terry, 2026-09-14: "use the same component. and any drop down that possible to use, can use that
// too" and "i want all my apps to have the same look and feel". The header's workspace picker (step 1,
// BT-004-04) already uses TaskTracker's command picker (./commandpicker.js). This adapter puts the same
// picker over any other native <select> in a view, without the view having to change how it works.
//
// THE SELECT STAYS THE STATE, AND THE VIEWS KEEP TALKING TO IT. Views set `select.value`, fill the
// select with new options, disable, hide, describe or mark it invalid, and focus it. A picker that only
// read the select when it was built would drift from all of that. So the adapter intercepts exactly
// those operations ON THIS ONE SELECT — the `value`, `selectedIndex`, `disabled` and `hidden`
// properties and the attribute and child-list methods — lets each happen as before, and then brings
// the trigger back in step. A MutationObserver, where the browser has one, catches the rest (an
// option's own text or disabled state). Nothing is changed on the prototype; other selects are
// untouched.
//
// WHAT IS CARRIED OVER TO THE TRIGGER:
//   disabled   the trigger is disabled and an open panel closes (a form that is saving, a locked field)
//   hidden     the whole control is hidden
//   aria-describedby, aria-invalid, aria-errormessage   hints and errors describe what people use
//   focus()    focusing the select focuses the trigger (the planning line "Add a category" does)
// The trigger's name comes from the field label (components.js `field()` calls `setLabel`), or from
// the select's own aria-label when it is placed without a field (a member's role in a list row).
//
// CHANGE SEMANTICS ARE A NATIVE SELECT'S: a choice fires `input` then `change` once; choosing the
// current value, moving through the list and Escape fire nothing (commandpicker.js A5), so
// `commitOnConfirm` and every `change` listener behave as before.
//
// It decides nothing about access or money: it presents the options the view put in the select.
import { createCommandPicker } from "./commandpicker.js";

const handles = new WeakMap();

// The hints, errors and required mark a view sets on the select are read from it by the command picker
// on every refresh (a11y review finding 6), so the adapter only has to notice the change.
const PROPERTIES = ["value", "selectedIndex", "disabled", "hidden", "required"];
const METHODS = ["setAttribute", "removeAttribute", "toggleAttribute", "appendChild", "append", "prepend", "replaceChildren", "removeChild", "insertBefore"];

/** The picker over this select, or null when it is a plain select. */
export function pickerOf(select) {
  return (select && handles.get(select)) || null;
}

/** What to put in the page for a control: its picker when it has one, otherwise the control itself. */
export function controlElement(control) {
  const handle = pickerOf(control);
  return handle ? handle.element : control;
}

/**
 * @param {HTMLSelectElement} select       the select the view built and keeps using
 * @param {object} [options]
 * @param {string} [options.label]         the spoken name; `field()` replaces it with the field label
 * @param {boolean} [options.search]       a search box (default true; long lists get one regardless)
 * @param {string} [options.placeholder]
 * @param {Function} [options.colorOf]     value → colour, for things that have one (a category)
 * @param {Function} [options.badgeOf]     value → a NEW leading node each call (an icon)
 * @param {Function} [options.describeOf]  value → the row's spoken name when the label is not all of it
 * @param {object} [options.create]        a pinned create action ({ label, onPick(term) })
 * @param {boolean} [options.allowCustom]  A16 (commandpicker.js) — typed text nothing matches
 *        becomes the value itself, never requiring a real option to exist first.
 */
// `search` defaults to "auto": a search box only above the command picker's threshold of twelve options,
// so a short data list opens like a native list with no on-screen keyboard (UX review U2). `true`
// always offers one.
export function enhanceSelect(select, { label = null, search = "auto", placeholder = "", colorOf = null, badgeOf = null, describeOf = null, create = null, allowCustom = false } = {}) {
  if (!select || select.tagName !== "SELECT") throw new Error("enhanceSelect needs a select element.");
  const existing = handles.get(select);
  if (existing) return existing;

  const picker = createCommandPicker({
    select,
    label: label || select.getAttribute("aria-label") || "Choose",
    placeholder,
    colorOf,
    badgeOf,
    describeOf,
    create,
    allowCustom,
    search,
  });
  const element = picker.element;
  const trigger = element.querySelector(".cmdpick__trigger");

  // Never re-entered: a sync writes only to the trigger and the wrapper, never to the select.
  let syncing = false;
  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const off = !!select.disabled;
      trigger.disabled = off;
      if (off) picker.close();
      element.hidden = !!(select.hidden || select.hasAttribute("hidden"));
      // Hints, errors and the required mark are read from the select by the picker (commandpicker A13).
      picker.refresh();
    } finally {
      syncing = false;
    }
  }

  for (const name of PROPERTIES) interceptProperty(select, name, sync);
  for (const name of METHODS) interceptMethod(select, name, sync);
  Object.defineProperty(select, "focus", { configurable: true, writable: true, value: (opts) => trigger.focus(opts) });
  const Observer = typeof globalThis.MutationObserver === "function" ? globalThis.MutationObserver : null;
  if (Observer) new Observer(() => sync()).observe(select, { subtree: true, childList: true, attributes: true, characterData: true });

  const handle = {
    element,
    trigger,
    select,
    picker,
    refresh: sync,
    setLabel: (text) => picker.setLabel(text),
    focus: () => trigger.focus(),
  };
  handles.set(select, handle);
  sync();
  return handle;
}

// An own property on this select that does what the original did, then syncs. The original is an
// accessor on the prototype in a browser, and a plain value in the test double.
function interceptProperty(node, name, after) {
  let owner = node;
  let desc = null;
  while (owner && !(desc = Object.getOwnPropertyDescriptor(owner, name))) owner = Object.getPrototypeOf(owner);
  if (desc && desc.configurable === false) return;
  if (desc && (desc.get || desc.set)) {
    Object.defineProperty(node, name, {
      configurable: true,
      enumerable: true,
      get() { return desc.get ? desc.get.call(this) : undefined; },
      set(value) {
        if (desc.set) desc.set.call(this, value);
        after();
      },
    });
    return;
  }
  let stored = desc ? desc.value : undefined;
  Object.defineProperty(node, name, {
    configurable: true,
    enumerable: true,
    get: () => stored,
    set(value) {
      stored = value;
      after();
    },
  });
}

function interceptMethod(node, name, after) {
  const original = node[name];
  if (typeof original !== "function") return;
  Object.defineProperty(node, name, {
    configurable: true,
    writable: true,
    value: function intercepted(...args) {
      const out = original.apply(this, args);
      after();
      return out;
    },
  });
}
