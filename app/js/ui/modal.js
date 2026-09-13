// Accessible modal dialog: role="dialog" + aria-modal, labelled by its heading, focus moves in and
// is trapped, Escape closes, focus returns to the opener, and the page behind it is made inert so
// assistive technology cannot wander out of it (A11Y-006). Errors are shown INSIDE the modal (the
// brief requires in-modal errors with a retry path). A click on the backdrop does not close it, so
// a half-entered entry is never lost to a stray click.
import { el } from "./dom.js";
import { messageFor } from "../core/errors.js";
import { uid } from "./components.js";

const FOCUSABLE = "button, [href], input, select, textarea, summary, [tabindex]";

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

  // Excludes controls inside a hidden ancestor, not only hidden controls themselves.
  function focusables() {
    return Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((n) => !n.disabled && n.getAttribute("tabindex") !== "-1" && !(n.closest && n.closest("[hidden]")));
  }

  function onKey(event) {
    // An open combobox list is dismissed first; the next Escape closes the dialog (merchant picker).
    const t = event.target;
    if (event.key === "Escape" && t && t.getAttribute && t.getAttribute("role") === "combobox" && t.getAttribute("aria-expanded") === "true") return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
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
