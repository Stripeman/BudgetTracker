// Helpers for the BT-004-05 view tests: every dropdown in a view or dialog is TaskTracker's command
// picker, labelled through its trigger, and choosing through the picker is what the view submits.
// Works on the DOM double (app/test/domdouble.js); layout is checked in a real browser.
import { DomEvent } from "./domdouble.js";
import { pickerOf } from "../js/ui/selectpicker.js";

export const triggerFor = (select) => pickerOf(select).trigger;

// Selects inside `root` that are still plain native dropdowns, DESCRIBED BY THEIR OPTIONS rather than
// returned as nodes: a failing assert that is handed DOM-double nodes serialises the whole cyclic
// document and hangs instead of failing.
export function nativeDropdowns(root) {
  return root.querySelectorAll("select").filter((s) => !pickerOf(s))
    .map((s) => `select [${s.querySelectorAll("option").map((o) => o.textContent).join(", ")}]`);
}

// The visible label text of every picker inside `root`, in document order: the <label for> that points
// at its trigger, or its spoken name when it is placed without a field (a row in a list).
export function pickerLabels(root) {
  const labels = root.querySelectorAll("label");
  return root.querySelectorAll("select").filter((s) => pickerOf(s)).map((s) => {
    const trigger = triggerFor(s);
    const label = labels.find((l) => l.getAttribute("for") === trigger.id);
    return label ? label.textContent : `(aria) ${trigger.getAttribute("aria-label")}`;
  });
}

// What a screen reader announces for a picker's trigger, written "<name>: <value>. <how to use it>" —
// the words the trigger once carried in one aria-label. Since the accessibility review (finding 6) the
// trigger is a combobox and they are three separate things, each checked here from the DOM: the name is
// the <label for> pointing at the trigger (or its own aria-label when it has no visible label), the value
// is its visually hidden spoken text, and the instructions are the element its description points to.
export function spokenOf(trigger) {
  let root = trigger;
  while (root.parentNode) root = root.parentNode;
  const label = root.querySelectorAll("label").find((l) => l.getAttribute("for") === trigger.id);
  const name = label ? label.textContent : trigger.getAttribute("aria-label");
  const spoken = trigger.querySelector(".cmdpick__spoken");
  const howId = `${trigger.id}-how`;
  const how = root.querySelectorAll(`#${howId}`)[0];
  const described = String(trigger.getAttribute("aria-describedby") || "").split(/\s+/);
  return `${name}: ${spoken ? spoken.textContent : ""}. ${how && described.includes(howId) ? how.textContent : ""}`;
}

// The select whose picker is labelled `text` inside `root`.
export function pickerNamed(root, text) {
  const labels = root.querySelectorAll("label");
  const hit = root.querySelectorAll("select").find((s) => {
    const handle = pickerOf(s);
    if (!handle) return false;
    const label = labels.find((l) => l.getAttribute("for") === handle.trigger.id);
    return label && label.textContent === text;
  });
  if (!hit) throw new Error(`no picker labelled ${JSON.stringify(text)}; have ${JSON.stringify(pickerLabels(root))}`);
  return hit;
}

// The select whose picker's spoken name starts with `prefix` — for a picker placed in a list row
// without a field label (named by its own aria-label, "Role for Bob Fictional").
export function pickerSpokenAs(root, prefix) {
  const hit = root.querySelectorAll("select").find((s) => pickerOf(s) && spokenOf(pickerOf(s).trigger).startsWith(prefix));
  if (!hit) throw new Error(`no picker spoken as ${JSON.stringify(prefix)}; have ${JSON.stringify(pickerLabels(root))}`);
  return hit;
}

const panel = (doc) => doc.body.querySelector(".cmdpick__panel");

// Opens the picker, presses the row whose visible name is `optionLabel` (as a pointer would) and
// returns the rows that were offered.
export function chooseOption(select, optionLabel) {
  const doc = select.ownerDocument;
  triggerFor(select).click();
  const rows = doc.body.querySelectorAll(".cmdpick__opt");
  const offered = rows.map((r) => r.querySelector(".cmdpick__optlabel").textContent);
  const row = rows.find((r) => r.querySelector(".cmdpick__optlabel").textContent === optionLabel);
  if (!row) throw new Error(`no option ${JSON.stringify(optionLabel)}; offered ${JSON.stringify(offered)}`);
  row.dispatchEvent(new DomEvent("mousedown", { bubbles: true }));
  return offered;
}

// Opens the picker and returns the offered rows' names, then closes it again with Escape.
export function offeredOptions(select) {
  const doc = select.ownerDocument;
  triggerFor(select).click();
  const offered = doc.body.querySelectorAll(".cmdpick__opt").map((r) => r.querySelector(".cmdpick__optlabel").textContent);
  const open = panel(doc);
  if (open) open.dispatchEvent(new DomEvent("keydown", { bubbles: true, key: "Escape" }));
  return offered;
}

// Keyboard: opens with Enter on the trigger, types into the search box when there is one (or presses
// the keys as type-ahead when there is not), then Enter.
export function chooseByKeyboard(select, { type = null, keys = [] } = {}) {
  const doc = select.ownerDocument;
  const press = (node, key) => node.dispatchEvent(new DomEvent("keydown", { bubbles: true, key }));
  press(triggerFor(select), "Enter");
  const open = panel(doc);
  if (type !== null) {
    const box = open.querySelector(".cmdpick__search");
    box.value = type;
    box.dispatchEvent(new DomEvent("input", { bubbles: true }));
  }
  for (const key of keys) press(open, key);
  press(open, "Enter");
}
