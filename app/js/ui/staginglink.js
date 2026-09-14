// BT-011-06 — THE STAGING LINK (Terry, 2026-09-14: "include … a link to staging!! so i can get to
// it", "make it a field that can be updated", "make the link in the users drop down profile menu
// actually. but be sure it can be edited and looks good"). "Staging" is the preview environment.
//
// The address is the personal preference `stagingUrl`: each person sets it, or inherits the site
// default, and the site can lock it. It is never written in the repository (the repository is
// public). The server validates it; the browser checks it again (core/links.js) before it becomes a
// link, which opens in a new tab with no opener and no referrer.
//
// The account-menu entry is BUILT ONCE and refreshed in place, like the rest of the menu
// (RF-20260909-25). The editor is the app's modal: errors shown inside it, Save and Cancel, Escape,
// and focus back on the control that opened it.
import { el, announce } from "./dom.js";
import { openModal } from "./modal.js";
import { field, input } from "./components.js";
import { icon } from "./icons.js";
import { stagingHref, stagingHost, trimAddress, STAGING_MAX } from "../core/links.js";

export const STAGING_LINK_NAME = "Open staging site in a new tab";
export const STAGING_EDIT_NAME = "Edit staging link";
export const STAGING_ADD_TEXT = "Add staging link…";
const REL = "noopener noreferrer";
const INVALID = "Enter a web address starting with https://, without spaces, a user name, a password or hidden characters.";

// What the store says about the link: the checked address (or null), where it comes from, and
// whether the site has locked it.
export function stagingState(state) {
  const p = state && state.preferences;
  const raw = p && p.effective ? p.effective.stagingUrl : null;
  const source = (p && p.sources && p.sources.stagingUrl) || "default";
  return { href: stagingHref(raw), source, locked: source === "locked", personal: source === "personal" };
}

// A link that opens the staging site in a new tab, with the external-link cue after its text.
// `href` must already have passed stagingHref.
export function stagingAnchor({ className, text = "Staging site" }) {
  return el("a", { class: className, target: "_blank", rel: REL, "aria-label": STAGING_LINK_NAME }, [
    el("span", { class: "menu__text", text }), icon("external"),
  ]);
}

export function setAnchorHref(anchor, href) {
  if (href) { anchor.setAttribute("href", href); anchor.setAttribute("title", href); }
  else { anchor.removeAttribute("href"); anchor.removeAttribute("title"); }
}

// The editor. `save(value)` returns { ok } or { ok: false, error }; value null removes the address.
// `canRemove` offers "Remove" when there is an address of one's own to remove.
export function openStagingEditor({ title = "Staging link", label = "Staging site address", current = "", canRemove = false, help, save, onSaved = () => {} }) {
  const box = input({ type: "url", inputmode: "url", autocomplete: "url", spellcheck: "false", maxlength: String(STAGING_MAX), placeholder: "https://" });
  box.value = current || "";
  const saveBtn = el("button", { type: "button", class: "btn btn--primary", text: "Save" });
  const cancel = el("button", { type: "button", class: "btn", text: "Cancel" });
  const remove = canRemove ? el("button", { type: "button", class: "btn btn--ghost", text: "Remove link" }) : null;
  const modal = openModal({
    title,
    body: [field(label, box, { help: help || "The address of your staging (preview) site. It opens in a new tab from the account menu." })],
    actions: [remove, cancel, saveBtn].filter(Boolean),
  });
  const showError = (err) => {
    modal.setError(err);
    box.setAttribute("aria-invalid", "true");
    box.setAttribute("aria-errormessage", modal.errorId);
    box.focus();
  };
  async function commit(value) {
    modal.setBusy(true);
    modal.setError("");
    box.removeAttribute("aria-invalid");
    box.removeAttribute("aria-errormessage");
    const out = await save(value);
    modal.setBusy(false);
    if (out && out.ok === false) { showError(out.error || "The staging link could not be saved. Nothing was changed."); return; }
    modal.close();
    announce(value === null ? "Staging link removed." : "Staging link saved.");
    onSaved(value);
  }
  function submit() {
    const value = trimAddress(box.value);
    if (!value) {
      if (canRemove) { void commit(null); return; }
      showError("Enter the address of your staging site, starting with https://.");
      return;
    }
    // The same rule as the server, so an obvious mistake is explained without a round trip.
    if (!stagingHref(value)) { showError(INVALID); return; }
    void commit(value);
  }
  saveBtn.addEventListener("click", submit);
  cancel.addEventListener("click", () => modal.close());
  if (remove) remove.addEventListener("click", () => { void commit(null); });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  return { modal, input: box };
}

// The personal editor, from the store: it starts from the address in use and saves the preference.
export function openPersonalStagingEditor({ store }) {
  const s = stagingState(store.getState());
  return openStagingEditor({
    current: s.href || "",
    canRemove: s.personal,
    help: s.source === "site"
      ? "The site's staging link is used until you set your own. Your own address opens in a new tab from the account menu."
      : "The address of your staging (preview) site. It opens in a new tab from the account menu.",
    save: (value) => store.actions.savePreferences({ stagingUrl: value }),
  });
}

// The account-menu entry: "Staging site" (a link like the menu's other items) with "Edit" beside
// it, or "Add staging link…" when there is no address. Locked by the site: the link still opens but
// cannot be edited, and without an address the entry is hidden.
export function createStagingMenuEntry({ getState, onEdit }) {
  const link = stagingAnchor({ className: "menu__item menu__link" });
  const edit = el("button", { type: "button", class: "menu__edit", "aria-label": STAGING_EDIT_NAME, text: "Edit", onClick: onEdit });
  const add = el("button", { type: "button", class: "menu__item menu__add", text: STAGING_ADD_TEXT, onClick: onEdit });
  const element = el("div", { class: "menu__group menu__staging" }, [el("div", { class: "menu__row" }, [link, edit]), add]);
  function refresh() {
    const s = stagingState(getState());
    setAnchorHref(link, s.href);
    link.hidden = !s.href;
    edit.hidden = !s.href || s.locked;
    add.hidden = !!s.href || s.locked;
    element.hidden = !s.href && s.locked;
  }
  refresh();
  return { element, refresh, link, edit, add, host: () => stagingHost(stagingState(getState()).href) };
}
