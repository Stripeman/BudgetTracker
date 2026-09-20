// BT-013-15 (Terry, 2026-09-20): "Colour-scheme customization through a cog" — a per-design
// appearance control on each of the three flagship Gallery designs (and, since the mechanism is
// concept-agnostic, available to every concept): coordinated presets (colorschemes.js, reusing
// verified accent pairs), custom light/dark accent colours via the platform's own accessible native
// colour input, and "Reset to design defaults". Saved ONLY in the caller's OWN personal preferences
// (`galleryDesignColors`, api/preferences/handler.js) — never a workspace setting, never visible to or
// changed for anyone else, never touching a real workspace's layout.
//
// Built on the SAME floating-overlay engine every other Gallery/app popover already uses
// (app/js/ui/overlay.js + popup.js) — never a normal-flow sibling that would push page content around
// — but unlike themepicker.js's single-select listbox, this panel holds several genuinely different
// controls (a preset picker, two colour inputs, a reset button), so it uses plain Tab order between
// real form controls rather than a roving-tabindex single-select list, closing on Escape, an outside
// click, or focus genuinely leaving the panel (a standard accessible popover pattern) — never trapping
// Tab the way a modal dialog does, since this is not a modal.
import { el } from "../dom.js";
import { field } from "../components.js";
import { icon, withIcon } from "../icons.js";
import { overlayHost, placePanel, followTrigger } from "../overlay.js";
import { registerPopup } from "../popup.js";
import { createThemePicker } from "../themepicker.js";
import { PRESETS, designDefaultEntry, presetById } from "./colorschemes.js";

let counter = 0;

/**
 * @param {object} opts
 * @param {object} opts.concept   the concept manifest (name, accentLight, accentDark)
 * @param {() => {light:string,dark:string,preset:string|null}|null} opts.getOverride  current stored override, or null
 * @param {(next: {light:string,dark:string,preset:string|null}) => Promise<{ok:boolean,error?:any}>} opts.onChange  persist a new override
 * @param {() => Promise<{ok:boolean,error?:any}>} opts.onReset  clear the override back to the design default
 */
export function createAppearanceCog({ concept, getOverride, onChange, onReset }) {
  const panelId = `gcog-panel-${++counter}`;
  const status = el("p", { class: "field__help gcog__status", role: "status" });
  const error = el("p", { class: "error-text small gcog__error", role: "alert", hidden: true });

  const toggle = el("button", {
    type: "button", class: "gcog__toggle", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-controls": panelId,
    "aria-label": `Customize colours for ${concept.name}`,
  }, [icon("cog")]);

  const def = designDefaultEntry(concept);
  function currentEntry() {
    const stored = getOverride();
    if (!stored) return def;
    return { id: stored.preset && presetById(stored.preset) ? stored.preset : "__default__", label: "Current", light: stored.light || def.light, dark: stored.dark || def.dark };
  }

  const presetPicker = createThemePicker({
    value: currentEntry().id,
    entries: [def, ...PRESETS].map((p) => ({ id: p.id, label: p.label, swatch: p.light })),
    listLabel: `Colour preset for ${concept.name}`,
    namePrefix: "Preset",
    onPick: (id) => {
      const entry = id === "__default__" ? def : presetById(id);
      if (!entry) return;
      void apply({ light: entry.light, dark: entry.dark, preset: id === "__default__" ? null : id });
    },
  });

  const lightInput = el("input", { type: "color", class: "gcog__swatch", value: currentEntry().light, "aria-label": `Custom accent colour for ${concept.name} in light mode` });
  const darkInput = el("input", { type: "color", class: "gcog__swatch", value: currentEntry().dark, "aria-label": `Custom accent colour for ${concept.name} in dark mode` });

  async function apply(next) {
    status.textContent = "Saving…";
    error.hidden = true;
    const before = currentEntry();
    const out = await onChange(next);
    if (out && out.ok === false) {
      status.textContent = "";
      error.textContent = out.error ? String(out.error.message || out.error) : "That colour combination could not be saved.";
      error.hidden = false;
      // Put the controls back exactly as they were (settings.js's own "a failed save reverts the
      // control" rule, BT-011-04) — never leave the panel showing a colour that was not actually saved.
      presetPicker.select(before.id);
      lightInput.value = before.light;
      darkInput.value = before.dark;
      return;
    }
    status.textContent = "Saved.";
    presetPicker.select(next.preset && presetById(next.preset) ? next.preset : "__default__");
    lightInput.value = next.light;
    darkInput.value = next.dark;
  }

  lightInput.addEventListener("change", () => { void apply({ light: lightInput.value, dark: darkInput.value, preset: null }); });
  darkInput.addEventListener("change", () => { void apply({ light: lightInput.value, dark: darkInput.value, preset: null }); });

  const resetBtn = el("button", { type: "button", class: "btn btn--ghost btn--small" }, ["Reset to design defaults"]);
  resetBtn.addEventListener("click", async () => {
    status.textContent = "Resetting…";
    error.hidden = true;
    const out = await onReset();
    if (out && out.ok === false) { status.textContent = ""; error.textContent = out.error ? String(out.error.message || out.error) : "Could not reset."; error.hidden = false; return; }
    status.textContent = "Reset to design defaults.";
    presetPicker.select("__default__");
    lightInput.value = def.light;
    darkInput.value = def.dark;
  });

  const panel = el("div", {
    id: panelId, class: "gcog__panel", role: "dialog", "aria-label": `Colours for ${concept.name}`, hidden: true, tabindex: "-1",
  }, [
    el("p", { class: "gcog__panel-title" }, [withIcon("cog", `${concept.name} colours`)]),
    el("div", { class: "field" }, [el("p", { class: "field__label" }, ["Preset"]), presetPicker.element]),
    el("div", { class: "gcog__customrow" }, [
      field("Light mode accent", lightInput),
      field("Dark mode accent", darkInput),
    ]),
    resetBtn,
    status, error,
  ]);

  const element = el("div", { class: "gcog" }, [toggle]);
  let open = false;
  let stopFollowing = null;
  function place() { placePanel({ trigger: toggle, panel }); }
  const dismissal = registerPopup({
    contains: (node) => element.contains(node) || panel.contains(node),
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
      panel.hidden = false;
      overlayHost(toggle).appendChild(panel);
      place();
      stopFollowing = followTrigger({ trigger: toggle, boundary: element, panel, isOpen: () => open, onReposition: place, onOutOfView: () => setOpen(false) });
      dismissal.opened();
      panel.focus();
    } else {
      if (stopFollowing) { stopFollowing(); stopFollowing = null; }
      panel.hidden = true;
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    }
  }
  toggle.addEventListener("click", () => setOpen(!open));
  toggle.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); toggle.focus(); } });
  // Plain Tab order flows through the panel's own real controls, never trapped the way a modal dialog
  // traps it. Dismissal on an outside PRESS (never on an internal focus move) is the shared registry
  // every floating panel in this app already uses (app/js/ui/popup.js — "FOCUS IS THE WRONG SIGNAL FOR
  // A POINTER... the right signal is the press itself, watched once at the document"), including
  // correctly keeping this panel open while its OWN nested preset picker is in use (the registry's own
  // anchor/contains chain already covers a popup opened from inside another). An earlier version of
  // this control ALSO closed on `focusout`, duplicating that same job with a second, focus-timing-based
  // mechanism — real end-to-end coverage of opening the nested preset picker found that the two
  // mechanisms did not compose reliably (a real, intermittent close-before-the-pick-registers race),
  // so the redundant, conflicting one was removed rather than patched further.

  return { element, isOpen: () => open, close: () => setOpen(false) };
}
