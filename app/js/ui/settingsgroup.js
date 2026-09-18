// A small, shared collapsible section for settings pages, using the SAME markup, classes and
// open/closed remembering behaviour as the workspace/shared-expenses settings form
// (settingsform.js) so My Settings and Workspace Settings look and behave the same (BT-017,
// Terry, 2026-09-18: "cluttered and chaotic... not simply another column added to the current
// arrangement"). This module holds only the generic disclosure shell; each page supplies its own
// content nodes (existing cards, controls, whatever it already builds), so no working card is
// rewritten to adopt it.
import { el } from "./dom.js";
import { uid } from "./components.js";

// Which groups are open, remembered in this browser only; a browser that refuses storage simply
// forgets (private windows, full storage) — identical to settingsform.js's own readOpen/writeOpen.
function readOpen(key) {
  try {
    const raw = globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function writeOpen(key, value) {
  try { if (globalThis.localStorage) globalThis.localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered */ }
}

// `createSettingsGroup({ id, storageKey, name, defaultOpen, nodes, hidden })`: a named, collapsible
// section. `nodes` are mounted once, in order, and never re-created by this module — callers keep
// updating their own cards in place exactly as before. `setHidden(bool)` hides the whole section
// (used when every card inside it is currently hidden, so an empty collapsible header never
// shows); `hidden: true` starts the section hidden so it never flashes empty before the first
// real render decides whether it has anything to show (matches the existing "Deleted workspaces"
// card's own rationale).
export function createSettingsGroup({ id, storageKey, name, defaultOpen = false, nodes = [], hidden = false }) {
  const bodyId = uid(`${id}-group`);
  const body = el("div", { class: "settings-group__body", id: bodyId }, nodes);
  const toggle = el("button", { type: "button", class: "settings-group__toggle", "aria-controls": bodyId, text: name });
  const open = readOpen(storageKey);
  const initialOpen = Object.prototype.hasOwnProperty.call(open, name) ? open[name] === true : defaultOpen;
  body.hidden = !initialOpen;
  toggle.setAttribute("aria-expanded", initialOpen ? "true" : "false");
  toggle.addEventListener("click", () => {
    const next = body.hidden;
    body.hidden = !next;
    toggle.setAttribute("aria-expanded", next ? "true" : "false");
    const now = readOpen(storageKey);
    now[name] = next;
    writeOpen(storageKey, now);
  });
  const element = el("section", { class: "settings-group", hidden: !!hidden }, [el("h3", { class: "settings-group__title" }, [toggle]), body]);
  return {
    element,
    setHidden(next) { element.hidden = !!next; },
  };
}
