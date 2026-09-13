// My settings: personal preferences only. Each value says whether it is inherited (from the site or
// the built-in default), customized by you, or locked by the site. Appearance uses THE SAME
// day/night control as the account menu — one control mounted twice, both writing through the same
// theme controller and preference, and both redrawn when the theme changes (A11Y-001).
// Selects save only on an explicit choice, never on each arrow key (A11Y-002).
import { el, mount, announce } from "../dom.js";
import { createDayNightControl } from "../daynight.js";
import { pageHead, field, select, sourceBadge, button, input, commitOnConfirm } from "../components.js";

const CURRENCIES = ["", "EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CAD", "AUD", "JPY"];

export function createView(ctx) {
  const { store, theme } = ctx;
  const status = el("p", { class: "field__help", role: "status" });
  const dayNight = createDayNightControl({ theme, onChange: (mode) => save({ themeMode: mode }) });
  const unsubscribe = theme.subscribe(() => dayNight.refresh());
  const appearanceSource = el("span");
  const prefBox = el("div", { class: "form-grid" });
  const contactsBox = el("div");
  const element = el("section", {}, [
    pageHead("My settings"),
    el("p", { class: "muted small", text: "“Inherited” values follow the site default until you change them. “Customized” values are your own choice; use “Use inherited” to return to the default. “Locked by site” values are set by the site administrator." }),
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "set-appearance" }, [el("h2", { class: "card__title", id: "set-appearance", text: "Appearance" }), appearanceSource, dayNight.element]),
      el("section", { class: "card", "aria-labelledby": "set-display" }, [el("h2", { class: "card__title", id: "set-display", text: "Display and privacy" }), prefBox, status]),
      el("section", { class: "card", "aria-labelledby": "set-contacts" }, [el("h2", { class: "card__title", id: "set-contacts", text: "Private contacts" }), el("p", { class: "field__help", text: "Only you can see these. Use them on your private records; use workspace contacts for shared ones." }), contactsBox]),
    ]),
  ]);

  async function save(patch) {
    status.textContent = "Saving…";
    const out = await store.actions.savePreferences(patch);
    status.textContent = out.ok ? "Saved." : (out.error && out.error.message) || "Could not save.";
    if (out.ok) announce("Preference saved.");
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
        try { await ctx.api.request("contacts", { method: "POST", body: { scope: "private", name: name.value } }); announce("Contact added."); await loadContacts(); } catch (err) { status.textContent = err.message; }
      }, { small: true });
      mount(contactsBox,
        data.private.length ? el("ul", { class: "stack" }, data.private.map((c) => el("li", { text: c.name }))) : el("p", { class: "muted small", text: "No private contacts yet." }),
        el("div", { class: "row" }, [field("New contact name", name), add]));
    } catch (err) { mount(contactsBox, el("p", { class: "error-text", role: "alert", text: err.message })); }
  }
  void loadContacts();

  let rendered = "";
  function update(state) {
    const prefs = state.preferences;
    if (!prefs) return;
    dayNight.setLocked(prefs.sources.themeMode === "locked");
    mount(appearanceSource, sourceBadge(prefs.sources.themeMode));
    const signature = JSON.stringify(prefs);
    if (signature === rendered) return;
    rendered = signature;
    const e = prefs.effective;
    const palette = select(theme.themes.map((t) => ({ value: t.id, label: t.label })), e.themePalette);
    const masking = el("input", { type: "checkbox" });
    masking.checked = !!e.balanceMasking;
    mount(prefBox,
      prefControl("Colour palette", "themePalette", palette, prefs, (v) => { theme.setTheme(v); return v; }),
      prefControl("Hide balances on screen", "balanceMasking", masking, prefs),
      prefControl("Display currency", "displayCurrency", select(CURRENCIES.map((c) => ({ value: c, label: c || "Account currency" })), e.displayCurrency || ""), prefs),
      prefControl("Date format", "dateFormat", select([{ value: "iso", label: "2026-09-13" }, { value: "dmy", label: "13/09/2026" }, { value: "mdy", label: "09/13/2026" }], e.dateFormat), prefs),
      prefControl("Number format", "numberFormat", select(["1,234.56", "1.234,56", "1 234,56"].map((v) => ({ value: v, label: v })), e.numberFormat), prefs),
      prefControl("Default workspace", "defaultWorkspaceId", select([{ value: "", label: "First available" }].concat(state.workspaces.map((w) => ({ value: w.id, label: w.name }))), e.defaultWorkspaceId || ""), prefs),
    );
  }
  return { element, update, destroy: unsubscribe };
}
