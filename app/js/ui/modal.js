// Accessible modal dialog: role="dialog" + aria-modal, labelled by its heading, focus moves in and
// is trapped, Escape closes, focus returns to the opener, and the page behind it is made inert so
// assistive technology cannot wander out of it (A11Y-006). Errors are shown INSIDE the modal (the
// brief requires in-modal errors with a retry path). A click on the backdrop does not close it, so
// a half-entered entry is never lost to a stray click.
import { el } from "./dom.js";
import { messageFor } from "../core/errors.js";
import { uid } from "./components.js";
import { closeDetachedPopups } from "./popup.js";

const FOCUSABLE = "button, [href], input, select, textarea, summary, [tabindex]";

// Escape belongs to an open list inside the dialog first — the merchant combobox, a command picker's
// panel (BT-004-05; it floats on the body, and a list without a search box holds the keyboard itself),
// or a theme, colour or icon picker (its options or its toggle) — so the dialog, and what was typed,
// stays open; the next Escape closes the dialog (UXI-1).
export function escapeBelongsToControl(target) {
  if (!target || !target.getAttribute) return false;
  if (target.getAttribute("role") === "combobox" && target.getAttribute("aria-expanded") === "true") return true;
  // A command picker's panel is in the document only while it is open.
  if (target.closest && target.closest(".cmdpick__panel")) return true;
  // The picker's toggle states whether its list is open (aria-expanded), in every DOM.
  const pick = target.closest ? target.closest(".themepick") : null;
  const toggle = pick ? pick.querySelector(".themepick__toggle") : null;
  return !!toggle && toggle.getAttribute("aria-expanded") === "true";
}

export function openModal({ title, body, actions = [], onClose = () => {} }) {
  const opener = document.activeElement;
  const openerKey = opener && opener.getAttribute ? (opener.getAttribute("aria-label") || opener.textContent || "") : "";
  const titleId = uid("modal-title");
  const errorId = uid("modal-error");
  const error = el("div", { class: "modal__error", id: errorId, role: "alert", hidden: true });
  // "Close dialog", not "Close": a dialog's own action may be called "Close" (UX2-010).
  const closeBtn = el("button", { type: "button", class: "modal__close", "aria-label": "Close dialog", text: "×" });
  const dialog = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId }, [
    el("div", { class: "modal__head" }, [el("h2", { id: titleId, text: title }), closeBtn]),
    el("div", { class: "modal__body" }, [].concat(body)),
    error,
    el("div", { class: "modal__foot" }, actions),
  ]);
  const backdrop = el("div", { class: "modal-backdrop" }, [dialog]);
  const app = document.getElementById("app");
  const wasInert = app ? app.inert : false;
  // The skip link lives outside #app, so it is made inert separately (retest of A11Y-006).
  const skip = typeof document.querySelector === "function" ? document.querySelector(".skip-link") : null;
  const skipWasInert = skip ? skip.inert : false;
  let closed = false;
  let busyFocus = null;

  function close() {
    if (closed) return;
    closed = true;
    if (backdrop.remove) backdrop.remove(); else if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    // A command picker opened from this dialog floats on the body; it closes with the dialog.
    closeDetachedPopups();
    if (app) app.inert = wasInert;
    if (skip) skip.inert = skipWasInert;
    document.removeEventListener("keydown", onKey, true);
    restoreFocus();
    onClose();
  }

  // Focus returns to the control that opened the dialog. A successful action usually re-renders the
  // view and replaces that control; then the control with the same name in the new view gets focus,
  // or failing that the main region — never the page body (A11Y2-001).
  function attached(node) {
    for (let n = node; n; n = n.parentNode) if (n === document.body) return true;
    return false;
  }
  function restoreFocus() {
    let target = opener && attached(opener) ? opener : null;
    if (!target && openerKey) {
      target = Array.from(document.querySelectorAll("button, a")).find((n) => (n.getAttribute("aria-label") || n.textContent || "") === openerKey && attached(n)) || null;
    }
    if (!target) target = document.getElementById("main");
    if (target && typeof target.focus === "function") target.focus();
  }

  // Excludes controls inside a hidden ancestor, not only hidden controls themselves, and the inside of
  // an open command-picker panel: it lives in the dialog (so aria-modal never hides it) but is part of
  // its trigger, and it handles Tab itself.
  const inPanel = (n) => !!(n && n.closest && n.closest(".cmdpick__panel"));
  function focusables() {
    return Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((n) => !n.disabled && n.getAttribute("tabindex") !== "-1" && !(n.closest && n.closest("[hidden]")) && !inPanel(n));
  }

  function onKey(event) {
    // An open list is dismissed first; the next Escape closes the dialog.
    if (event.key === "Escape" && escapeBelongsToControl(event.target)) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    // Tab at an open panel's edge closes it and continues from its trigger (commandpicker.js A6).
    if (inPanel(event.target)) return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(backdrop);
  if (app) app.inert = true;
  if (skip) skip.inert = true;
  const first = focusables().find((n) => n !== closeBtn) || closeBtn;
  first.focus();

  return {
    element: dialog,
    close,
    setError(err) {
      const text = typeof err === "string" ? err : messageFor(err);
      error.textContent = text || "";
      error.hidden = !text;
    },
    errorId,
    // Disabling the focused button would drop focus to the page; remember it and put it back
    // when the operation finishes (A11Y-018).
    setBusy(busy) {
      if (busy) busyFocus = dialog.contains(document.activeElement) ? document.activeElement : null;
      for (const b of dialog.querySelectorAll(".modal__foot button")) b.disabled = !!busy;
      dialog.setAttribute("aria-busy", busy ? "true" : "false");
      if (!busy && busyFocus && !closed) { busyFocus.focus(); busyFocus = null; }
    },
  };
}

export function confirmModal({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  const confirm = el("button", { type: "button", class: ["btn", danger ? "btn--danger" : "btn--primary"], text: confirmLabel });
  const cancel = el("button", { type: "button", class: "btn", text: "Cancel" });
  const modal = openModal({ title, body: [el("p", { text: message })], actions: [cancel, confirm] });
  cancel.addEventListener("click", () => modal.close());
  confirm.addEventListener("click", async () => {
    modal.setBusy(true);
    modal.setError("");
    const out = await onConfirm();
    modal.setBusy(false);
    if (out && out.ok === false) modal.setError(out.error);
    else modal.close();
  });
  return modal;
}
