// BT-011-05 icon picker: THE SAME control as the theme and colour pickers (BT-011-03, a TaskTracker
// port) with icon entries — a compact toggle showing the current icon and its name, opening a
// scrollable listbox. Not a plain browser select: an <option> cannot reliably show an icon.
//
// The first entry is always "Default (…)" — the icon the record inherits from its type or the
// workspace — and picking it resets the record (the value is "" and callers send `icon: null`).
// Icons that were switched off or retired are not offered, except the one the record already has,
// which is shown truthfully as "no longer offered".
import { el } from "./dom.js";
import { createThemePicker } from "./themepicker.js";
import { iconEntries } from "./icons.js";

let counter = 0;

/**
 * @param {object} o
 * @param {string|null} o.value    the icon chosen on the record, or null when it inherits
 * @param {string} o.inherited     the icon it inherits
 * @param {string} o.name          what the icon is for, used in the accessible names
 * @param {(id: string) => void} [o.onPick]   "" means "use the default"
 */
export function createIconPicker({ value = null, inherited, name, label = "Icon", onPick }) {
  const labelId = `iconpick-${++counter}`;
  const picker = createThemePicker({
    value: value || "", entries: iconEntries({ current: value, inherited }), labelledBy: labelId,
    listLabel: `Icons for ${name}`, namePrefix: `${name} icon`, onPick,
  });
  const element = el("div", { class: "field" }, [el("p", { class: "field__label", id: labelId, text: label }), picker.element]);
  return { element, picker, getValue: () => picker.getValue() || null, select: (id) => picker.select(id || "") };
}

// What a form sends: nothing when unchanged, otherwise the chosen id or null to reset.
export function iconChange(before, after) {
  return (before || null) === (after || null) ? undefined : after || null;
}
