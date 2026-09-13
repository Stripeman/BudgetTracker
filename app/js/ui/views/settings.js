// My settings: personal preferences only. Each value says whether it is inherited (from the site or
// the built-in default), customized by you, or locked by the site. Appearance uses THE SAME
// day/night control as the account menu — one control mounted twice, both writing through the same
// theme controller and preference, and both redrawn when the theme changes (A11Y-001).
// Selects save only on an explicit choice, never on each arrow key (A11Y-002).
import { el, mount, announce } from "../dom.js";
import { createDayNightControl } from "../daynight.js";
import { createThemePicker } from "../themepicker.js";
import { pageHead, field, select, sourceBadge, button, input, commitOnConfirm, badge } from "../components.js";
import { sliceFor } from "../../core/store.js";
import { colourEntries } from "../../core/categories.js";
import { messageFor } from "../../core/errors.js";

const CURRENCIES = ["", "EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CAD", "AUD", "JPY"];

export function createView(ctx) {
  const { store, theme } = ctx;
  const status = el("p", { class: "field__help", role: "status" });
  const dayNight = createDayNightControl({ theme, onChange: (mode) => save({ themeMode: mode }) });
  const unsubscribe = theme.subscribe(() => dayNight.refresh());
  const appearanceSource = el("span");
  // THE SAME palette picker as the account menu (BT-011-03), grouped with the day/night control
  // under Appearance as in TaskTracker. Built once and kept in sync, so a save never replaces the
  // control under the person's focus.
  // A failed save puts the previous palette back instead of keeping an unsaved one (A11Y2-006).
  const palettePicker = createThemePicker({
    value: theme.getTheme(), labelledBy: "set-palette-label",
    onPick: async (v) => {
      const prev = theme.getTheme();
      theme.setTheme(v);
      const out = await save({ themePalette: v });
      if (!out.ok) { theme.setTheme(prev); palettePicker.select(prev); announce(`The palette could not be saved. ${messageFor(out.error)}`); }
    },
  });
  const paletteSource = el("div", { class: "row" });
  const paletteField = el("div", { class: "field" }, [el("p", { class: "field__label", id: "set-palette-label", text: "Colour palette" }), palettePicker.element, paletteSource]);
  const prefBox = el("div", { class: "form-grid" });
  const contactsBox = el("div");
  const colourBox = el("div", { class: "stack" });
  const element = el("section", {}, [
    pageHead("My settings"),
    el("p", { class: "muted small", text: "“Inherited” values follow the site default until you change them. “Customized” values are your own choice; use “Use inherited” to return to the default. “Locked by site” values are set by the site administrator." }),
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "set-appearance" }, [el("h2", { class: "card__title", id: "set-appearance", text: "Appearance" }), appearanceSource, dayNight.element, paletteField]),
      el("section", { class: "card", "aria-labelledby": "set-display" }, [el("h2", { class: "card__title", id: "set-display", text: "Display and privacy" }), prefBox, status]),
      el("section", { class: "card", "aria-labelledby": "set-contacts" }, [el("h2", { class: "card__title", id: "set-contacts", text: "Private contacts" }), el("p", { class: "field__help", text: "Only you can see these. Use them on your private records; use workspace contacts for shared ones." }), contactsBox]),
      el("section", { class: "card", "aria-labelledby": "set-colours" }, [
        el("h2", { class: "card__title", id: "set-colours", text: "Category colours" }),
        el("p", { class: "field__help", text: "Your own colours for this workspace's categories. They change only what you see; workspace colours are managed on the Workspace page." }),
        colourBox,
      ]),
    ]),
  ]);

  async function save(patch) {
    status.textContent = "Saving…";
    const out = await store.actions.savePreferences(patch);
    status.textContent = out.ok ? "Saved." : out.error ? messageFor(out.error) : "Could not save.";
    if (out.ok) announce("Preference saved.");
    return out;
  }

  function prefControl(label, key, control, prefs, toValue = (v) => v || null) {
    const locked = prefs.sources[key] === "locked";
    control.disabled = locked;
    if (control.type === "checkbox") control.addEventListener("change", () => save({ [key]: control.checked }));
    else commitOnConfirm(control, (value) => save({ [key]: toValue(value) }));
    const reset = prefs.sources[key] === "personal" ? button("Use inherited", () => save({ [key]: null }), { small: true, variant: "ghost", attrs: { "aria-label": `Use the inherited ${label.toLowerCase()}` } }) : null;
    const labelled = control.type === "checkbox"
      ? el("label", { class: "field--inline field__label" }, [control, label])
      : field(label, control);
    return el("div", { class: "field" }, [labelled, el("div", { class: "row" }, [sourceBadge(prefs.sources[key]), reset])]);
  }

  async function loadContacts() {
    try {
      const data = await ctx.api.request("contacts");
      const name = input({ maxlength: "80", autocomplete: "off" });
      const add = button("Add contact", async () => {
        try { await ctx.api.request("contacts", { method: "POST", body: { scope: "private", name: name.value } }); announce("Contact added."); await loadContacts(); } catch (err) { status.textContent = messageFor(err); }
      }, { small: true });
      mount(contactsBox,
        data.private.length ? el("ul", { class: "stack" }, data.private.map((c) => el("li", { text: c.name }))) : el("p", { class: "muted small", text: "No private contacts yet." }),
        el("div", { class: "row" }, [field("New contact name", name), add]));
    } catch (err) { mount(contactsBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
  }
  void loadContacts();

  // Personal category colours (BT-011-04), with the same swatch picker as the theme. Rebuilt only
  // when the categories or colours change, and focus returns to the picker that was in use.
  let colourSig = "";
  function renderColours(state) {
    const data = sliceFor(state, "categories").data;
    const prefs = state.preferences;
    if (!data || !prefs) return;
    const personal = prefs.effective.categoryColors || {};
    const locked = prefs.sources.categoryColors === "locked";
    const cats = data.categories.filter((c) => !c.archived);
    const sig = JSON.stringify([cats.map((c) => [c.id, c.name, c.color]), personal, locked]);
    if (sig === colourSig) return;
    colourSig = sig;
    const active = document.activeElement;
    const focused = active && colourBox.contains(active) && active.closest ? active.closest("[data-category]") : null;
    const focusId = focused ? focused.dataset.category : null;
    const rows = cats.map((c) => {
      const labelId = `set-colour-${c.id}`;
      // A failed save puts the previous colour back and says so beside the picker (A11Y2-006).
      const error = el("p", { class: "error-text small", role: "alert", hidden: true });
      const picker = createThemePicker({
        value: personal[c.id] || c.color, entries: colourEntries(data.palette, c.color, personal[c.id]),
        labelledBy: labelId, listLabel: `Colours for ${c.name}`, namePrefix: `${c.name} colour`,
        onPick: async (hex) => {
          const out = await save({ categoryColors: { ...personal, [c.id]: hex } });
          if (!out.ok) { picker.select(personal[c.id] || c.color); error.textContent = messageFor(out.error); error.hidden = false; }
        },
      });
      picker.setDisabled(locked);
      const reset = personal[c.id] && !locked ? button("Use workspace colour", () => {
        const next = { ...personal };
        delete next[c.id];
        void save({ categoryColors: Object.keys(next).length ? next : null });
      }, { small: true, variant: "ghost", attrs: { "aria-label": `Use workspace colour for ${c.name}` } }) : null;
      return el("div", { class: "field", dataset: { category: c.id } }, [
        el("p", { class: "field__label", id: labelId, text: c.name }), picker.element, error,
        el("div", { class: "row" }, [badge(personal[c.id] ? "Your colour" : "Workspace colour", "source"), reset]),
      ]);
    });
    mount(colourBox, ...rows);
    if (focusId) {
      const row = rows.find((r) => r.dataset.category === focusId);
      const toggle = row && row.querySelector(".themepick__toggle");
      if (toggle) toggle.focus();
    }
  }

  let rendered = "";
  function update(state) {
    const prefs = state.preferences;
    if (!prefs) return;
    renderColours(state);
    dayNight.setLocked(prefs.sources.themeMode === "locked");
    mount(appearanceSource, sourceBadge(prefs.sources.themeMode));
    const paletteLocked = prefs.sources.themePalette === "locked";
    palettePicker.setDisabled(paletteLocked);
    if (prefs.effective.themePalette && palettePicker.getValue() !== prefs.effective.themePalette) palettePicker.select(prefs.effective.themePalette);
    mount(paletteSource, sourceBadge(prefs.sources.themePalette), prefs.sources.themePalette === "personal"
      ? button("Use inherited", () => save({ themePalette: null }), { small: true, variant: "ghost", attrs: { "aria-label": "Use inherited colour palette" } }) : null);
    const signature = JSON.stringify(prefs);
    if (signature === rendered) return;
    rendered = signature;
    const e = prefs.effective;
    const masking = el("input", { type: "checkbox" });
    masking.checked = !!e.balanceMasking;
    mount(prefBox,
      prefControl("Hide balances on screen", "balanceMasking", masking, prefs),
      prefControl("Display currency", "displayCurrency", select(CURRENCIES.map((c) => ({ value: c, label: c || "Account currency" })), e.displayCurrency || ""), prefs),
      prefControl("Date format", "dateFormat", select([{ value: "iso", label: "2026-09-13" }, { value: "dmy", label: "13/09/2026" }, { value: "mdy", label: "09/13/2026" }], e.dateFormat), prefs),
      prefControl("Number format", "numberFormat", select(["1,234.56", "1.234,56", "1 234,56"].map((v) => ({ value: v, label: v })), e.numberFormat), prefs),
      prefControl("Default workspace", "defaultWorkspaceId", select([{ value: "", label: "First available" }].concat(state.workspaces.map((w) => ({ value: w.id, label: w.name }))), e.defaultWorkspaceId || ""), prefs),
    );
  }
  return { element, update, destroy: unsubscribe };
}
