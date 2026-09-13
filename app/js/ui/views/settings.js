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
import { createIconPicker } from "../iconpicker.js";
import { withIcon } from "../icons.js";

const MAX_ICON_BYTES = 8 * 1024;

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
  // Site administrators only (BT-011-05): the icon catalogue. It holds no financial data and gives
  // no access to any workspace.
  // Category colours and icons belong to a workspace, so the card is hidden without one.
  const colourCard = el("section", { class: "card", "aria-labelledby": "set-colours", hidden: true }, [
    el("h2", { class: "card__title", id: "set-colours", text: "Category colours and icons" }),
    el("p", { class: "field__help", text: "Your own colours and icons for this workspace's categories. They change only what you see; workspace colours and icons are managed on the Workspace page." }),
    colourBox,
  ]);
  const catalogBox = el("div", { class: "stack" });
  const catalogCard = el("section", { class: "card", "aria-labelledby": "set-icons", hidden: true }, [
    el("h2", { class: "card__title", id: "set-icons", text: "Icon catalogue (site)" }),
    el("p", { class: "field__help", text: "Icons offered to everyone on this site. Nothing is deleted: an icon you switch off or retire leaves the pickers but keeps showing wherever it is already used." }),
    catalogBox,
  ]);
  const element = el("section", {}, [
    pageHead("My settings"),
    el("p", { class: "muted small", text: "“Inherited” values follow the site default until you change them. “Customized” values are your own choice; use “Use inherited” to return to the default. “Locked by site” values are set by the site administrator." }),
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "set-appearance" }, [el("h2", { class: "card__title", id: "set-appearance", text: "Appearance" }), appearanceSource, dayNight.element, paletteField]),
      el("section", { class: "card", "aria-labelledby": "set-display" }, [el("h2", { class: "card__title", id: "set-display", text: "Display and privacy" }), prefBox, status]),
      el("section", { class: "card", "aria-labelledby": "set-contacts" }, [el("h2", { class: "card__title", id: "set-contacts", text: "Private contacts" }), el("p", { class: "field__help", text: "Only you can see these. Use them on your private records; use workspace contacts for shared ones." }), contactsBox]),
      colourCard,
      catalogCard,
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
    const personalIcons = prefs.effective.categoryIcons || {};
    const locked = prefs.sources.categoryColors === "locked";
    const iconsLocked = prefs.sources.categoryIcons === "locked";
    const cats = data.categories.filter((c) => !c.archived);
    const iconsData = sliceFor(state, "icons").data;
    const sig = JSON.stringify([cats.map((c) => [c.id, c.name, c.color, c.icon]), personal, personalIcons, locked, iconsLocked, iconsData ? iconsData.catalog : null]);
    if (sig === colourSig) return;
    colourSig = sig;
    const active = document.activeElement;
    const focused = active && colourBox.contains(active) && active.closest ? active.closest("[data-category]") : null;
    const focusId = focused ? focused.dataset.category : null;
    const focusIndex = focused ? [...focused.querySelectorAll(".themepick__toggle")].indexOf(active) : -1;
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
      // A personal icon (BT-011-05); "Default" is the workspace's icon for the category.
      const iconPick = createIconPicker({
        value: personalIcons[c.id] || null, inherited: c.icon, name: c.name, label: `${c.name} icon`,
        onPick: async (id) => {
          const next = { ...personalIcons };
          if (id) next[c.id] = id; else delete next[c.id];
          const out = await save({ categoryIcons: Object.keys(next).length ? next : null });
          if (!out.ok) { iconPick.select(personalIcons[c.id] || null); error.textContent = messageFor(out.error); error.hidden = false; }
        },
      });
      iconPick.picker.setDisabled(iconsLocked);
      return el("div", { class: "field", dataset: { category: c.id } }, [
        el("p", { class: "field__label", id: labelId, text: `${c.name} colour` }), picker.element, iconPick.element, error,
        el("div", { class: "row" }, [badge(personal[c.id] ? "Your colour" : "Workspace colour", "source"), reset, badge(personalIcons[c.id] ? "Your icon" : "Workspace icon", "source")]),
      ]);
    });
    mount(colourBox, ...rows);
    if (focusId) {
      const row = rows.find((r) => r.dataset.category === focusId);
      const toggles = row ? [...row.querySelectorAll(".themepick__toggle")] : [];
      const toggle = toggles[Math.max(0, focusIndex)];
      if (toggle) toggle.focus();
    }
  }

  // The site icon catalogue (BT-011-05). Custom icons are added only through the validated upload:
  // the browser checks type and size first, and the server checks type, size, dimensions and every
  // element and attribute before storing plain shape data.
  let catalogLoaded = false;
  async function loadCatalog() {
    let data;
    try { data = await ctx.api.icons(); } catch (err) { mount(catalogBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); return; }
    const cat = data.catalog;
    const after = async (message) => { announce(message); await store.actions.refreshIcons(); await loadCatalog(); };
    const note = el("p", { class: "field__help", role: "status" });
    const label = input({ maxlength: "40", autocomplete: "off" });
    const file = el("input", { type: "file", class: "field__input", accept: ".svg,image/svg+xml" });
    const add = button("Add icon", async () => {
      note.textContent = "";
      const f = file.files && file.files[0];
      if (!label.value.trim()) { note.textContent = "Give the icon a name."; label.focus(); return; }
      if (!f) { note.textContent = "Choose an SVG file."; file.focus(); return; }
      if (!(f.type === "image/svg+xml" || /\.svg$/i.test(f.name))) { note.textContent = "Only SVG files can be added."; file.focus(); return; }
      if (f.size > MAX_ICON_BYTES) { note.textContent = "The file is larger than 8 KB."; file.focus(); return; }
      try { await ctx.api.iconAction("upload", { label: label.value.trim(), svg: await f.text() }); await after("Icon added."); }
      catch (err) { note.textContent = messageFor(err); }
    }, { variant: "primary" });
    const upload = el("div", { class: "form-grid" }, [
      field("Icon name", label), field("SVG file", file, { help: "A square 24 × 24 drawing made only of paths and simple shapes, at most 8 KB. Colours in the file are ignored; icons take the colour of the text." }),
      el("div", { class: "field" }, [add]), note,
    ]);
    const custom = cat.custom.length ? el("ul", { class: "stack" }, cat.custom.map((c) => {
      const rename = input({ maxlength: "40", value: c.label, autocomplete: "off", "aria-label": `New name for ${c.label}` });
      return el("li", { class: "row" }, [
        withIcon(c.id, c.label), badge(c.status === "active" ? "Offered" : "Retired", c.status === "active" ? "source" : "closed"),
        el("span", { class: "app__spacer" }), rename,
        button("Rename", async () => { try { await ctx.api.renameIcon({ iconId: c.id, label: rename.value.trim() }); await after("Icon renamed."); } catch (err) { note.textContent = messageFor(err); } }, { small: true, attrs: { "aria-label": `Rename ${c.label}` } }),
        button(c.status === "active" ? "Retire" : "Offer again", async () => {
          try { await ctx.api.iconAction(c.status === "active" ? "retire" : "restore", { iconId: c.id }); await after(c.status === "active" ? `${c.label} retired.` : `${c.label} offered again.`); } catch (err) { note.textContent = messageFor(err); }
        }, { small: true, attrs: { "aria-label": `${c.status === "active" ? "Retire" : "Offer again"}: ${c.label}` } }),
      ]);
    })) : el("p", { class: "muted small", text: "No custom icons yet." });
    const builtIns = el("div", { class: "icon-grid" }, cat.builtIn.filter((i) => !i.system).map((i) => {
      const box = el("input", { type: "checkbox" });
      box.checked = i.enabled;
      box.addEventListener("change", async () => {
        try { await ctx.api.iconAction(box.checked ? "enable" : "disable", { iconId: i.id }); await after(`${i.label} ${box.checked ? "offered" : "switched off"}.`); }
        catch (err) { box.checked = !box.checked; note.textContent = messageFor(err); }
      });
      return el("label", { class: "field--inline" }, [box, withIcon(i.id, i.label)]);
    }));
    mount(catalogBox,
      el("h3", { text: "Add a custom icon" }), upload,
      el("h3", { text: "Custom icons" }), custom,
      el("details", { class: "more" }, [el("summary", { text: "Built-in icons offered in pickers" }), el("p", { class: "field__help", text: "The money-direction and fallback icons are used by the app itself and are always on." }), builtIns]));
  }

  let rendered = "";
  function update(state) {
    const prefs = state.preferences;
    if (!prefs) return;
    colourCard.hidden = !state.selectedWorkspaceId;
    renderColours(state);
    const siteAdmin = !!(state.auth && state.auth.user && state.auth.user.siteAdmin);
    catalogCard.hidden = !siteAdmin;
    if (siteAdmin && !catalogLoaded) { catalogLoaded = true; void loadCatalog(); }
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
