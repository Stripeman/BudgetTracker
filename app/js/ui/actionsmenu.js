// BT-015 — THE COMPACT RECORD ACTIONS MENU (Terry, 2026-09-18: "Reduce clutter, particularly on
// mobile, by moving record actions into a menu right-aligned on the same row as the record's
// title/name... Use a four-dot icon arranged in two rows and two columns, visually like '::'... Use
// one consistent shared component across these screens."). Built entirely on the SAME shared overlay
// engine (app/js/ui/overlay.js) and popup registry (popup.js) the BT-004-08 dropdown-overlay fix
// already proved: the menu panel is a `position: fixed` floating overlay, portaled to the nearest
// dialog or the body only while open, so opening it can never shift surrounding content or resize a
// form — the exact defect class Terry's screenshots showed for dropdowns applies equally to a row's
// worth of buttons crammed into a table cell, and this is the one fix for both.
//
// The ARIA menu-button pattern (role="menu"/"menuitem", roving tabindex, arrow keys, Home/End,
// Escape closes the menu before any parent dialog, Tab closes), following the exact structural
// precedent already reviewed and shipped in themepicker.js's listbox: state held here, never read
// back off the element; a click outside or a rival popup closes it (registerPopup); Escape on the
// toggle or inside the menu closes only the menu.
//
// An item may be `{ text, onClick, danger, disabled, attrs }` (the common case) or `{ node }` — a
// fully custom, already-built element (for example Bills' "Record next", wrapped by components.js
// `infoTip()`, which returns a WRAPPER span holding the real button plus its off-screen description —
// that tooltip keeps working unchanged inside the menu, since it only depends on the button's own
// hover/focus, not its ancestry). `node` may be the operable element itself or a wrapper around it
// (the innermost `button`/`[tabindex]` descendant is found automatically and is what actually gets
// the menu role, the roving tabindex stop and keyboard focus — the wrapper only carries the menu
// item's visual classes, so its own layout, e.g. `infoTip`'s off-screen description or a `.tip`
// hover box, keeps working unchanged).
// `null`/`false` entries are skipped, so a view's own permission checks (`canEdit ? {...} : null`)
// read exactly as they already do throughout the codebase.
import { el } from "./dom.js";
import { icon } from "./icons.js";
import { overlayHost, placePanel, usefulHeight, followTrigger } from "./overlay.js";
import { registerPopup } from "./popup.js";

let counter = 0;

export function createActionsMenu({ label, items }) {
  const filtered = (items || []).filter(Boolean);
  // No available action at all (a viewer with no rights on this particular record) — never a dead
  // "::" affordance that opens to nothing; the same "offer nothing" behaviour every individual
  // permission-gated button already had before this menu replaced them.
  if (!filtered.length) return { element: el("div", { class: "actionsmenu" }), isOpen: () => false, close: () => {} };
  const menuId = `actionsmenu-${++counter}`;
  const toggle = el("button", {
    class: "actionsmenu__toggle", type: "button",
    "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": menuId, "aria-label": label,
  }, [icon("more")]);

  const menuItems = []; // the OPERABLE element per item (gets role/tabindex/focus/disabled checks)
  const plainNodes = new Set();
  let prevDanger = false;
  const mountNodes = filtered.map((item) => {
    let mount, operable;
    if (item.node) {
      mount = item.node;
      // The operable control: the node itself if it IS one, or its innermost button/[tabindex]
      // descendant if it is a wrapper (infoTip's anchor span, the disabled-Move `.tip` span).
      operable = (mount.matches && mount.matches("button, [tabindex]")) ? mount : (mount.querySelector && mount.querySelector("button, [tabindex]")) || mount;
      // `plain`: not itself operable (for example a disabled control with only a hover/focus
      // explanation, Transactions' "Move" when the server's own rule refuses it for this entry) —
      // shown for context, never given a menu role or a roving tabindex stop.
      if (!item.plain) { operable.setAttribute("role", "menuitem"); operable.setAttribute("tabindex", "-1"); }
      else { operable.setAttribute("role", "presentation"); plainNodes.add(operable); }
    } else {
      operable = el("button", {
        type: "button", role: "menuitem", tabindex: "-1",
        disabled: item.disabled || null, ...(item.attrs || {}),
        onClick: item.onClick,
      }, [item.text]);
      mount = operable;
    }
    mount.classList.add("actionsmenu__item");
    if (item.danger) mount.classList.add("actionsmenu__item--danger");
    // Destructive actions are visually separated from the rest, not merely coloured (Terry: "Separate
    // destructive actions visually and identify them clearly").
    if (item.danger && !prevDanger) mount.classList.add("actionsmenu__item--separated");
    prevDanger = !!item.danger;
    menuItems.push(operable);
    return mount;
  });

  const menu = el("div", { class: "actionsmenu__panel", id: menuId, role: "menu", "aria-label": label, hidden: true }, mountNodes);

  // The toggle stays put; the menu is a FLOATING OVERLAY, appended to the nearest dialog or the body
  // only while open — opening or closing it changes nothing else on the page.
  const element = el("div", { class: "actionsmenu" }, [toggle]);
  let open = false;
  let stopFollowing = null;
  function place() {
    placePanel({ trigger: toggle, panel: menu, minUseful: usefulHeight({ panel: menu, list: menu, rowSelector: ".actionsmenu__item" }) });
  }
  const dismissal = registerPopup({
    contains: (node) => element.contains(node) || menu.contains(node),
    close: () => setOpen(false),
    isOpen: () => open,
    ownerDocument: () => element.ownerDocument,
    anchor: () => element,
  });
  function setOpen(next) {
    const wasOpen = open;
    open = !!next;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open === wasOpen) return;
    if (open) {
      menu.hidden = false;
      overlayHost(toggle).appendChild(menu);
      place();
      stopFollowing = followTrigger({
        trigger: toggle, boundary: element, panel: menu, isOpen: () => open,
        onReposition: place,
        onOutOfView: () => setOpen(false),
      });
      dismissal.opened();
    } else {
      if (stopFollowing) { stopFollowing(); stopFollowing = null; }
      menu.hidden = true;
      if (menu.parentNode) menu.parentNode.removeChild(menu);
    }
  }
  const enabled = () => menuItems.filter((n) => !n.disabled && !plainNodes.has(n));
  function focusItem(index) {
    const list = enabled();
    if (!list.length) return;
    const node = list[Math.max(0, Math.min(list.length - 1, index))];
    node.focus();
    if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
  }
  const enabledIndexOf = (node) => enabled().indexOf(node);

  toggle.addEventListener("click", () => { setOpen(!open); if (open) focusItem(0); });
  // Escape on the toggle of an open menu closes the menu only (matches the theme/command picker).
  // Arrow keys on the closed toggle open it, landing on the first or last item (native menu-button
  // convention).
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); focusItem(0); }
    else if (e.key === "ArrowUp" && !open) { e.preventDefault(); setOpen(true); focusItem(enabled().length - 1); }
  });
  menu.addEventListener("keydown", (e) => {
    const at = enabledIndexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusItem(at + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(at - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(enabled().length - 1); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); toggle.focus(); }
    else if (e.key === "Tab") setOpen(false);
  });
  // Any activation inside the menu (a real click, or Enter/Space on a menuitem button — which the
  // browser turns into a click) closes the menu and returns focus to the toggle, AFTER the item's own
  // onClick has already run (click bubbles from the button up to this listener).
  menu.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest(".actionsmenu__item")) { setOpen(false); toggle.focus(); }
  });

  return { element, isOpen: () => open, close: () => setOpen(false) };
}
