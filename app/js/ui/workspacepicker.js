// CHOOSING A WORKSPACE, WITH THE CONTROL TASKTRACKER USES FOR CHOOSING THINGS. BT-004-04.
//
// Adapted from TaskTracker app/js/ui/workspacepicker.js (T: main fb24a41, RF-20260909-02): a thin
// wrapper over the command picker (./commandpicker.js). Terry, 2026-09-14: "why dont we do like we do
// on the tasktracker.. im all for consistency". It replaces the header's plain `<select>` and the
// separate "New workspace" button beside it with one control: a trigger showing the current workspace
// and a role badge, a searchable list, and a pinned "+ New workspace".
//
// THE NATIVE `<select>` IS THE STATE. The command picker enhances a real select rather than replacing
// it, so there is one answer to "which workspace is chosen".
//
// IT DECIDES NOTHING ABOUT ACCESS. The list is exactly what `/api/workspaces` returned for this
// person (`workspace-model.summary`: id, name, status and THEIR role); search filters that list in
// the browser and never asks the server for more. Every mark is READ from `role`; nothing here
// computes, widens or narrows what anybody may do. Choosing still goes through
// `store.actions.selectWorkspace`, which owns the synchronous reset and the generation guard.
//
// TWO LETTERS, NOT FOUR. TaskTracker marks O (owner), M (member), G (guest: a public workspace the
// person is not a member of) and S (reached through site-admin elevation). BudgetTracker has neither
// of the last two: there are no public or guest workspaces, and site administration grants NO access
// to any workspace (CLAUDE.md §3). Every workspace in the list is one the person is an active member
// of, so the marks are O (you own it) and M (any other role), and G and S are deliberately not ported.
import { el } from "./dom.js";
import { createCommandPicker } from "./commandpicker.js";

const ROLE_LABELS = { owner: "Owner", manager: "Manager", member: "Member", viewer: "Viewer" };
const ROLE_HINTS = {
  owner: "You own this workspace",
  manager: "You are a manager of this workspace",
  member: "You are a member of this workspace",
  viewer: "You can view this workspace",
};

/**
 * WHAT THIS PERSON IS TO THIS WORKSPACE, AS ONE LETTER AND THE EXACT ROLE IN WORDS.
 *
 *   O  you own it
 *   M  you are a member with any other role (manager, member or viewer)
 *
 * The letter is never the only information: `label` names the exact role, and it is what assistive
 * technology hears.
 */
export function workspaceMarkerFor(workspace) {
  const role = workspace && typeof workspace.role === "string" ? workspace.role : "";
  const label = ROLE_LABELS[role] || "Member";
  const hint = ROLE_HINTS[role] || ROLE_HINTS.member;
  return role === "owner" ? { letter: "O", label, hint } : { letter: "M", label, hint };
}

// Archived workspaces stay in the list (switching back to one is how it is restored) and are
// marked in their visible name, so search, sight and speech all see it.
export function workspaceLabel(workspace) {
  const name = String((workspace && workspace.name) || "Untitled workspace");
  return workspace && workspace.status === "archived" ? `${name} (archived)` : name;
}

// The outlined square badge. `role="img"` with an `aria-label`, so a screen reader hears "Manager"
// rather than the letter M.
function markerBadge(marker) {
  return el("span", {
    class: `workspaces__marker workspaces__marker--${marker.letter.toLowerCase()} people__badge`,
    text: marker.letter,
    title: marker.hint,
    role: "img",
    "aria-label": marker.label,
  });
}

/**
 * The workspace chooser: a hidden `<select>` holding the value, enhanced by the command picker.
 * Built ONCE and refreshed in place with `update()`, so a store commit never rebuilds it under
 * somebody mid-interaction (the shell's account-menu rule).
 *
 * @param {object}   options
 * @param {Array}    options.workspaces   the authorized list, exactly as the store holds it
 * @param {string}   [options.selectedId] the current workspace id
 * @param {Function} options.onSelect     called with the chosen workspace id
 * @param {Function} [options.onCreate]   offered as the pinned create action; given the search text
 * @param {Function} [options.announce]   live-region announcer
 */
export function createWorkspacePicker({
  workspaces = [],
  selectedId = null,
  onSelect = () => {},
  onCreate = null,
  announce = () => {},
} = {}) {
  // THE SELECT IS THE STATE. Present and in the document; the command picker hides it from sight.
  const select = el("select", { id: "workspace-picker", "aria-label": "Workspace" });
  select.dataset.field = "workspace";
  let byId = new Map();
  let signature = "";
  let currentId = null;

  function fill(list, current) {
    const next = JSON.stringify(list.map((w) => [w.id, w.name, w.status, w.role]));
    if (next !== signature) {
      signature = next;
      byId = new Map(list.map((w) => [String(w.id || ""), w]));
      while (select.firstChild) select.removeChild(select.firstChild);
      for (const w of list) select.appendChild(el("option", { value: String(w.id || ""), text: workspaceLabel(w) }));
    }
    select.value = current ? String(current) : "";
    currentId = select.value || null;
  }
  fill(workspaces, selectedId);

  const picker = createCommandPicker({
    select,
    label: "Workspace",
    placeholder: "Choose workspace…",
    // A NEW NODE EVERY CALL: the same element cannot be in the trigger and in a row at once.
    badgeOf: (value) => {
      const workspace = byId.get(String(value));
      return workspace ? markerBadge(workspaceMarkerFor(workspace)) : null;
    },
    // THE NAME AND THE EXACT ROLE, SPELLED OUT: "Family budget — Manager".
    describeOf: (value) => {
      const workspace = byId.get(String(value));
      return workspace ? `${workspaceLabel(workspace)} — ${workspaceMarkerFor(workspace).label}` : null;
    },
    create: onCreate ? { label: "New workspace", onPick: (term) => onCreate(term) } : null,
  });

  select.addEventListener("change", () => {
    const id = select.value || null;
    // CHOOSING THE WORKSPACE YOU ARE IN CHANGES NOTHING. The palette reports every pick, and switching
    // resets and reloads every slice; the old select committed only a different value too.
    if (!id || id === currentId) return;
    currentId = id;
    const workspace = byId.get(id);
    announce(`Switched to ${workspace ? workspaceLabel(workspace) : "the workspace"}`);
    onSelect(id);
  });

  // The visible label names the TRIGGER, the control people use; clicking it opens the palette.
  const triggerId = picker.element.querySelector(".cmdpick__trigger").id;
  const element = el("div", { class: "picker picker--workspace" }, [
    el("label", { class: "picker__label", for: triggerId, text: "Workspace" }),
    picker.element,
  ]);

  return {
    element,
    picker,
    /** Refresh in place from the store: the list and the chosen workspace. */
    update({ workspaces: list = [], selectedId: current = null } = {}) {
      fill(list, current);
      picker.refresh();
    },
    // THE SHELL'S GUARANTEE (TaskTracker RF-20260908-31): a re-render never takes focus from
    // somebody mid-interaction. The focused element is a button, and focusing it opens nothing.
    hasFocus() {
      const doc = element.ownerDocument;
      return !!(doc && element.contains(doc.activeElement));
    },
    restoreFocus() {
      try { picker.focus(); } catch (e) { /* a detached control cannot take focus */ }
    },
    destroy() {
      picker.destroy();
    },
  };
}
