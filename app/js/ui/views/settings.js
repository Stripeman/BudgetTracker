// My settings: personal preferences only. Each value says whether it is inherited (from the site or
// the built-in default), customized by you, or locked by the site. Appearance uses THE SAME
// day/night control as the account menu — one control mounted twice, both writing through the same
// theme controller and preference, and both redrawn when the theme changes (A11Y-001).
// Selects save only on an explicit choice, never on each arrow key (A11Y-002). They are TaskTracker's
// command picker (BT-004-05), and a save that rebuilds the card keeps focus on the same preference.
import { el, mount, announce } from "../dom.js";
import { createDayNightControl } from "../daynight.js";
import { createThemePicker } from "../themepicker.js";
import { pageHead, field, pickerSelect, sourceBadge, button, input, commitOnConfirm, badge, categoryLabel } from "../components.js";
import { sliceFor } from "../../core/store.js";
import { colourEntries } from "../../core/categories.js";
import { messageFor } from "../../core/errors.js";
import { createIconPicker } from "../iconpicker.js";
import { withIcon } from "../icons.js";
import { stagingState, stagingAnchor, setAnchorHref, openStagingEditor, openPersonalStagingEditor, isLocal, STAGING_ADD_TEXT } from "../staginglink.js";
import { stagingHref, stagingHost } from "../../core/links.js";
import { createSettingsGroup } from "../settingsgroup.js";
import { effectiveLayoutId, layoutAccentVars } from "../../core/layoutmeta.js";
import { ACCOUNT_TYPE_LABELS, MERCHANT_TYPE_LABELS } from "../../core/format.js";

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
  // "Deleted workspaces" (owners only; Terry, 2026-09-14): the server already returns a deleted
  // (archived) workspace only to its owners, so this needs no extra check of its own. Hidden until this
  // person has ever had one to show, so the card does not flash empty and then appear.
  const deletedBox = el("div", { class: "stack" });
  const deletedStatus = el("p", { class: "field__help", role: "status", tabindex: "-1" });
  const deletedCard = el("section", { class: "card card--full", "aria-labelledby": "set-deleted", hidden: true }, [
    el("h2", { class: "card__title", id: "set-deleted", text: "Deleted workspaces" }),
    el("p", { class: "field__help", text: "Workspaces you deleted. Nothing in them was erased; bring one back to give everyone who was in it their access again." }),
    deletedStatus, deletedBox,
  ]);
  // Site administrators only (BT-011-05): the icon catalogue. It holds no financial data and gives
  // no access to any workspace.
  // BT-022 (Terry, 2026-09-22): renamed and clarified so this is never mistaken for the place
  // categories are actually CREATED (that lives on the Workspace page's own Categories & types
  // tab; this card only ever overrides how EXISTING categories look, for you alone). The heading
  // deliberately does not repeat the outer group's own name (Terry: "I see 'Category colours &
  // icons,' followed by another 'Category colours and icons' heading" — the exact duplication this
  // closes). Category colours and icons belong to a workspace, so the card is hidden without one.
  const manageCategoriesBtn = button("Manage workspace categories", () => { if (ctx.navigate) ctx.navigate("workspace", { tab: "types" }); }, { small: true, variant: "ghost" });
  const colourCard = el("section", { class: "card card--full", "aria-labelledby": "set-colours", hidden: true }, [
    el("h2", { class: "card__title", id: "set-colours", text: "Your overrides for this workspace" }),
    el("p", { class: "field__help", text: "Your own colours and icons for this workspace's existing categories. They change only what you see — never anyone else's view, and never the workspace's own colours and icons." }),
    el("p", { class: "field__help", text: "Anyone may set these personal overrides, whatever their role. To create a new category, rename one, or change what everyone sees, use Manage workspace categories below (owners and managers)." }),
    el("div", { class: "row" }, [manageCategoriesBtn]),
    colourBox,
  ]);
  // BT-024 (Terry, 2026-09-23): the same personal-appearance idea as categories above, for the
  // other two workspace-scoped type registries (BT-019-02/03) — never a place account/merchant
  // types are created (that stays on the Workspace page), only how EXISTING ones look, for you
  // alone.
  const accountTypeColourBox = el("div", { class: "stack" });
  const manageAccountTypesBtn = button("Manage workspace account types", () => { if (ctx.navigate) ctx.navigate("workspace", { tab: "types" }); }, { small: true, variant: "ghost" });
  const accountTypeColourCard = el("section", { class: "card card--full", "aria-labelledby": "set-atype-colours", hidden: true }, [
    el("h2", { class: "card__title", id: "set-atype-colours", text: "Your overrides for this workspace" }),
    el("p", { class: "field__help", text: "Your own colours and icons for this workspace's existing account types. They change only what you see — never anyone else's view, and never the workspace's own colours and icons." }),
    el("p", { class: "field__help", text: "Anyone may set these personal overrides, whatever their role. To create a new account type, rename one, or change what everyone sees, use Manage workspace account types below (owners and managers)." }),
    el("div", { class: "row" }, [manageAccountTypesBtn]),
    accountTypeColourBox,
  ]);
  const merchantTypeColourBox = el("div", { class: "stack" });
  const manageMerchantTypesBtn = button("Manage workspace merchant types", () => { if (ctx.navigate) ctx.navigate("workspace", { tab: "types" }); }, { small: true, variant: "ghost" });
  const merchantTypeColourCard = el("section", { class: "card card--full", "aria-labelledby": "set-mtype-colours", hidden: true }, [
    el("h2", { class: "card__title", id: "set-mtype-colours", text: "Your overrides for this workspace" }),
    el("p", { class: "field__help", text: "Your own colours and icons for this workspace's existing merchant types. They change only what you see — never anyone else's view, and never the workspace's own colours and icons." }),
    el("p", { class: "field__help", text: "Anyone may set these personal overrides, whatever their role. To create a new merchant type, rename one, or change what everyone sees, use Manage workspace merchant types below (owners and managers)." }),
    el("div", { class: "row" }, [manageMerchantTypesBtn]),
    merchantTypeColourBox,
  ]);
  const catalogBox = el("div", { class: "stack" });
  const catalogCard = el("section", { class: "card card--full", "aria-labelledby": "set-icons", hidden: true }, [
    el("h2", { class: "card__title", id: "set-icons", text: "Icon catalogue (site)" }),
    el("p", { class: "field__help", text: "Icons offered to everyone on this site. Nothing is deleted: an icon you switch off or retire leaves the pickers but keeps showing wherever it is already used." }),
    catalogBox,
  ]);
  // The name other members see (Terry's preview check, 2026-09-14): the API never receives the
  // provider's name, so it is set here; the Google name is suggested while none is set.
  const nameInput = input({ maxlength: "80", autocomplete: "name" });
  const nameStatus = el("p", { class: "field__help", role: "status" });
  let nameTouched = false;
  let suggested = false;
  nameInput.addEventListener("input", () => { nameTouched = true; });
  const saveName = button("Save name", async () => {
    const value = nameInput.value.trim();
    if (!value) { nameStatus.textContent = "Enter the name other members should see."; nameInput.focus(); return; }
    nameStatus.textContent = "Saving…";
    try {
      await ctx.api.updateMe({ name: value });
      nameTouched = false;
      nameStatus.textContent = "Saved.";
      announce("Name saved.");
      await store.actions.init();
    } catch (err) { nameStatus.textContent = messageFor(err); }
  }, { variant: "primary" });
  const nameCard = el("section", { class: "card", "aria-labelledby": "set-name" }, [
    el("h2", { class: "card__title", id: "set-name", text: "Your name" }),
    field("Name shown to other members", nameInput),
    el("p", { class: "field__help", text: "Other members of your workspaces see this name. Owners and managers also see your email address." }),
    el("div", { class: "row" }, [saveName]),
    nameStatus,
  ]);
  // The staging link (BT-011-06): the same preference and the same editor as the account menu, so it
  // is findable here with the other personal settings. Built once and refreshed in place.
  const stagingLink = stagingAnchor({ className: "staging__link" });
  const stagingHostText = el("span", { class: "muted small staging__host" });
  const stagingNone = el("p", { class: "muted small staging__none" });
  const stagingSource = el("span");
  let stagingSourceShown = "";
  const stagingEdit = button("Edit staging link", () => openPersonalStagingEditor({ store }), { small: true });
  const stagingReset = button("Use inherited", () => save({ stagingUrl: null }), { small: true, variant: "ghost", attrs: { "aria-label": "Use the inherited staging link" } });
  // Under a site lock one's own saved address no longer applies, but it can still be cleared
  // (security review of d363eff, finding 2).
  const stagingClear = button("Clear my saved address", () => save({ stagingUrl: null }), { small: true, variant: "ghost" });
  const localNow = () => isLocal(store.getState());
  // Site administrators only: the address everyone inherits, and the lock. The default reaches only
  // site administrators and active workspace members, never visitors who are not signed in.
  let siteStaging = { loaded: false, loading: false, value: null, error: "", locked: [] };
  const siteStagingText = el("span", { class: "small staging__host" });
  const siteStagingEdit = button("Edit site staging link", () => openSiteStagingEditor(), { small: true });
  const siteLockBox = el("input", { type: "checkbox" });
  // Locking with no site link leaves everyone without one: said before it is done (review 2).
  const siteLockWarning = el("p", { class: "field__help staging__warning", role: "status" });
  siteLockWarning.hidden = true;
  siteLockBox.addEventListener("change", async () => {
    const others = siteStaging.locked.filter((k) => k !== "stagingUrl");
    const locked = siteLockBox.checked ? [...others, "stagingUrl"] : others;
    try {
      await ctx.api.request("site-settings", { method: "PUT", body: { locked } });
      announce(siteLockBox.checked ? "The staging link is locked for everyone." : "The staging link is no longer locked.");
      await loadSiteStaging();
      await store.actions.refreshPreferences();
    } catch (err) {
      siteLockBox.checked = !siteLockBox.checked;
      siteLockWarning.textContent = messageFor(err);
      siteLockWarning.hidden = false;
    }
  });
  const siteStagingRow = el("div", { class: "stack staging__site" }, [
    el("h3", { class: "staging__heading", text: "Site default (site administrators)" }),
    el("p", { class: "field__help", text: "Everyone who has not set their own staging link gets this one. Only site administrators and members of a workspace receive it; visitors who are not signed in never do." }),
    el("div", { class: "row" }, [siteStagingText, siteStagingEdit]),
    el("label", { class: "field--inline field__label staging__lock" }, [siteLockBox, "Lock: everyone uses the site's staging link"]),
    siteLockWarning,
  ]);
  siteStagingRow.hidden = true;
  const stagingCard = el("section", { class: "card card--full", "aria-labelledby": "set-staging" }, [
    el("h2", { class: "card__title", id: "set-staging", text: "Staging link" }),
    el("p", { class: "field__help", text: "Your staging (preview) site. It opens in a new tab from the account menu. Only https addresses are accepted, and http to 127.0.0.1 or localhost while running locally." }),
    el("div", { class: "staging__current" }, [stagingLink, stagingHostText, stagingNone]),
    el("div", { class: "row" }, [stagingSource, stagingEdit, stagingReset, stagingClear]),
    siteStagingRow,
  ]);
  async function loadSiteStaging() {
    siteStaging = { ...siteStaging, loading: true };
    try {
      const data = await ctx.api.siteSettings();
      const settings = (data && data.settings) || {};
      const defaults = settings.defaults || {};
      siteStaging = { loaded: true, loading: false, value: stagingHref(defaults.stagingUrl, { local: localNow() }), error: "", locked: Array.isArray(settings.locked) ? settings.locked : [] };
    } catch (err) { siteStaging = { ...siteStaging, loaded: true, loading: false, value: null, error: messageFor(err) }; }
    siteStagingText.textContent = siteStaging.error || (siteStaging.value ? stagingHost(siteStaging.value) : "None set");
    siteStagingEdit.textContent = siteStaging.value ? "Edit site staging link" : "Add site staging link…";
    siteLockBox.checked = siteStaging.locked.includes("stagingUrl");
    siteLockWarning.textContent = "No site staging link is set, so locking it leaves everyone without a staging link.";
    siteLockWarning.hidden = !!siteStaging.value;
  }
  function openSiteStagingEditor() {
    openStagingEditor({
      title: "Site staging link", label: "Staging site address for everyone", current: siteStaging.value || "", canRemove: !!siteStaging.value, local: localNow(),
      help: "Everyone who has not set their own staging link gets this one. Visitors who are not signed in never see it.",
      save: async (value) => {
        try { await ctx.api.request("site-settings", { method: "PUT", body: { defaults: { stagingUrl: value } } }); return { ok: true }; }
        catch (error) { return { ok: false, error }; }
      },
      onSaved: async () => { await loadSiteStaging(); await store.actions.refreshPreferences(); },
    });
  }
  function renderStaging(state) {
    const s = stagingState(state);
    const resetHadFocus = document.activeElement === stagingReset || document.activeElement === stagingClear;
    setAnchorHref(stagingLink, s.href);
    stagingLink.hidden = !s.href;
    stagingHostText.textContent = s.href ? stagingHost(s.href) : "";
    stagingHostText.hidden = !s.href;
    stagingNone.textContent = s.locked ? "Set by the site: none" : "No staging link yet.";
    stagingNone.hidden = !!s.href;
    if (stagingSourceShown !== s.source) { stagingSourceShown = s.source; mount(stagingSource, sourceBadge(s.source)); }
    stagingEdit.textContent = s.href ? "Edit staging link" : STAGING_ADD_TEXT;
    stagingEdit.hidden = s.locked;
    stagingReset.hidden = !s.personal;
    stagingClear.hidden = !(s.locked && s.storedOwn);
    // "Use inherited" and "Clear my saved address" leave once used; focus moves to the editor button
    // instead of the page.
    if (resetHadFocus && stagingReset.hidden && stagingClear.hidden && !stagingEdit.hidden) stagingEdit.focus();
    const siteAdmin = !!(state.auth && state.auth.user && state.auth.user.siteAdmin);
    siteStagingRow.hidden = !siteAdmin;
    if (siteAdmin && !siteStaging.loaded && !siteStaging.loading) void loadSiteStaging();
  }

  // Task-oriented, collapsible sections (BT-017; Terry, 2026-09-18: "cluttered and chaotic... not
  // simply another column added to the current arrangement") using the SAME disclosure shell as
  // Workspace Settings (settingsgroup.js / settingsform.js), so both pages look and behave the
  // same. No existing card's own behaviour changes — each keeps updating itself exactly as before;
  // this only changes how the cards are grouped and shown/collapsed. Only the genuinely advanced,
  // rarely-needed group (category colours and icons, mostly for site administrators and people
  // customizing beyond the workspace default) starts collapsed; every other group — including ones
  // that only appear sometimes, such as Deleted workspaces — starts open exactly like today, so
  // nothing that used to be immediately visible now needs an extra click to find. Whichever way a
  // person leaves a group is remembered in this browser afterwards.
  const appearanceCard = el("section", { class: "card", "aria-labelledby": "set-appearance" }, [el("h2", { class: "card__title", id: "set-appearance", text: "Appearance" }), appearanceSource, dayNight.element, paletteField]);
  const displayCard = el("section", { class: "card", "aria-labelledby": "set-display" }, [el("h2", { class: "card__title", id: "set-display", text: "Display and privacy" }), prefBox, status]);
  const contactsCard = el("section", { class: "card", "aria-labelledby": "set-contacts" }, [el("h2", { class: "card__title", id: "set-contacts", text: "Private contacts" }), el("p", { class: "field__help", text: "Only you can see these. Use them on your private records; use workspace contacts for shared ones." }), contactsBox]);

  const GROUP_KEY = "settings.mysettings.groups";
  const groupProfile = createSettingsGroup({ id: "set-g-profile", storageKey: GROUP_KEY, name: "Profile & appearance", defaultOpen: true, nodes: [nameCard, appearanceCard] });
  const groupDisplay = createSettingsGroup({ id: "set-g-display", storageKey: GROUP_KEY, name: "Display, privacy & contacts", defaultOpen: true, nodes: [displayCard, contactsCard] });
  const groupLinks = createSettingsGroup({ id: "set-g-links", storageKey: GROUP_KEY, name: "Staging link", defaultOpen: true, nodes: [stagingCard] });
  // BT-022: renamed from "Category colours & icons" — unambiguously personal, never a place
  // categories are created (see colourCard's own clarified heading/text above).
  const groupColours = createSettingsGroup({ id: "set-g-colours", storageKey: GROUP_KEY, name: "My category appearance", defaultOpen: false, hidden: true, nodes: [colourCard, catalogCard] });
  // BT-024 (Terry, 2026-09-23): parity with categories above, for account and merchant types. Named
  // and, immediately below, ORDERED to sort alphabetically with "My category appearance": account
  // (a) < category (c) < merchant (m).
  const groupAccountTypeColours = createSettingsGroup({ id: "set-g-atype-colours", storageKey: GROUP_KEY, name: "My account type appearance", defaultOpen: false, hidden: true, nodes: [accountTypeColourCard] });
  const groupMerchantTypeColours = createSettingsGroup({ id: "set-g-mtype-colours", storageKey: GROUP_KEY, name: "My merchant type appearance", defaultOpen: false, hidden: true, nodes: [merchantTypeColourCard] });
  const groupDeleted = createSettingsGroup({ id: "set-g-deleted", storageKey: GROUP_KEY, name: "Deleted workspaces", defaultOpen: true, hidden: true, nodes: [deletedCard] });

  // BT-013-16: everything on this page is personal (never a financial mutation, never gated by the
  // preview read-only guard — a member previewing a layout still changes their own appearance,
  // display and contacts normally). The same groups are reparented into a `.dashflag` accent
  // wrapper for the currently selected workspace's flagship layout, matching the minimal, low-risk
  // pattern already used for Shared expenses, given this page is a real settings surface too.
  const introBlock = el("div", {}, [
    // A personal-vs-workspace distinction (BT-017), stated as plainly and symmetrically as
    // Workspace Settings' own "These decide how everyone in this workspace works": everything on
    // this page is personal to the signed-in person, never shared with or changed by anyone else in
    // a workspace, no matter how many workspaces they belong to.
    el("p", { class: "muted small", text: "These apply only to you, everywhere you sign in — not to anyone else in any of your workspaces. To change something for everyone in a workspace, go to that workspace's own Workspace page." }),
    el("p", { class: "muted small", text: "“Inherited” values follow the site default until you change them. “Customized” values are your own choice; use “Use inherited” to return to the default. “Locked by site” values are set by the site administrator." }),
  ]);
  const bodyHost = el("div");
  const element = el("section", {}, [pageHead("My settings"), bodyHost]);
  const classicArrangement = el("div", {}, [introBlock, groupProfile.element, groupDisplay.element, groupLinks.element, groupAccountTypeColours.element, groupColours.element, groupMerchantTypeColours.element, groupDeleted.element]);
  const FLAGSHIP_IDS = new Set(["ledgerfly-forecast", "finexa-budget", "acru-overview"]);
  let mountedLayout = null;
  function arrangementFor(layoutId) {
    if (!FLAGSHIP_IDS.has(layoutId)) return classicArrangement;
    return el("div", { class: "dashflag", vars: layoutAccentVars(ctx.store.getState(), layoutId) }, [
      introBlock, groupProfile.element, groupDisplay.element, groupLinks.element, groupAccountTypeColours.element, groupColours.element, groupMerchantTypeColours.element, groupDeleted.element,
    ]);
  }

  async function save(patch) {
    status.textContent = "Saving…";
    const out = await store.actions.savePreferences(patch);
    status.textContent = out.ok ? "Saved." : out.error ? messageFor(out.error) : "Could not save.";
    if (out.ok) announce("Preference saved.");
    return out;
  }

  // Each preference's control in the card, by key, so focus can follow a rebuild.
  let prefControls = {};
  // The preference whose row holds focus: its row is the child of prefBox around the focused element.
  function focusedPref() {
    const active = document.activeElement;
    if (!active || !prefBox.contains(active)) return null;
    let node = active;
    while (node && node.parentNode !== prefBox) node = node.parentNode;
    return node && node.dataset ? node.dataset.pref || null : null;
  }

  function prefControl(label, key, control, prefs, toValue = (v) => v || null) {
    prefControls[key] = control;
    const locked = prefs.sources[key] === "locked";
    control.disabled = locked;
    if (control.type === "checkbox") control.addEventListener("change", () => save({ [key]: control.checked }));
    else commitOnConfirm(control, (value) => save({ [key]: toValue(value) }));
    const reset = prefs.sources[key] === "personal" ? button("Use inherited", () => save({ [key]: null }), { small: true, variant: "ghost", attrs: { "aria-label": `Use the inherited ${label.toLowerCase()}` } }) : null;
    const labelled = control.type === "checkbox"
      ? el("label", { class: "field--inline field__label" }, [control, label])
      : field(label, control);
    return el("div", { class: "field", dataset: { pref: key } }, [labelled, el("div", { class: "row" }, [sourceBadge(prefs.sources[key]), reset])]);
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

  // BT-024 (Terry, 2026-09-23): "make the editable the same way you made the editable on the
  // workspace categories & types page" — the same compact one-line-row-with-expandable-editor idiom
  // `createCategoryManager`/`createTypeManager` (app/js/ui/views/workspace.js) already use, applied
  // here to a PERSONAL override list rather than a workspace-managed one. Deliberately narrower than
  // those: colour and icon only — no name, class, retire or delete controls, since this is never the
  // place a category/type is created or changed for everyone (that stays on the Workspace page).
  const appearanceOpenRows = new Set();
  function appearanceRow({ id, name, workspaceColor, workspaceIcon, personalColor, personalIcon, palette, locked, iconsLocked, badges = [], onColor, onIcon }) {
    const labelId = `set-appear-${id}`;
    const rowKey = `${labelId}`;
    const error = el("p", { class: "error-text small", role: "alert", hidden: true });
    const shown = personalColor || workspaceColor;
    // A failed save puts the previous colour back and says so beside the picker (A11Y2-006).
    const picker = createThemePicker({
      value: shown, entries: colourEntries(palette, workspaceColor, personalColor),
      labelledBy: labelId, listLabel: `Colours for ${name}`, namePrefix: `${name} colour`,
      onPick: async (hex) => {
        const out = await onColor(hex);
        if (!out.ok) { picker.select(shown); error.textContent = messageFor(out.error); error.hidden = false; }
      },
    });
    picker.setDisabled(locked);
    const reset = personalColor && !locked ? button("Use workspace colour", () => { void onColor(null); }, { small: true, variant: "ghost", attrs: { "aria-label": `Use workspace colour for ${name}` } }) : null;
    // A personal icon (BT-011-05); "Default" is the workspace's own icon.
    const iconPick = createIconPicker({
      value: personalIcon || null, inherited: workspaceIcon, name, label: "Icon", tint: shown,
      onPick: async (iconId) => {
        const out = await onIcon(iconId || null);
        if (!out.ok) { iconPick.select(personalIcon || null); error.textContent = messageFor(out.error); error.hidden = false; }
      },
    });
    iconPick.picker.setDisabled(iconsLocked);
    const summary = el("summary", {}, [
      el("h3", { class: "typerow__name" }, [categoryLabel(name, shown, personalIcon || workspaceIcon)]),
      ...badges,
      el("span", { class: "typerow__spacer" }),
      el("span", { class: "typerow__edit", "aria-hidden": "true", text: "Edit" }),
    ]);
    const details = el("details", { class: "typerow" }, [
      summary,
      el("div", { class: "catrow" }, [
        el("div", { class: "field" }, [el("p", { class: "field__label", id: labelId, text: "Colour" }), picker.element]),
        iconPick.element, error,
        el("div", { class: "row catrow__meta" }, [
          badge(personalColor ? "Your colour" : "Workspace colour", "source"), reset,
          badge(personalIcon ? "Your icon" : "Workspace icon", "source"),
        ]),
      ]),
    ]);
    if (appearanceOpenRows.has(rowKey)) details.open = true;
    details.addEventListener("toggle", () => { if (details.open) appearanceOpenRows.add(rowKey); else appearanceOpenRows.delete(rowKey); });
    return details;
  }

  // Personal category colours/icons (BT-011-04/05). Rebuilt only when the categories or colours
  // change; the compact rows themselves (not individual field focus) survive a rebuild via
  // `appearanceOpenRows`, exactly like the Workspace page's own row managers.
  let colourSig = "";
  function renderColours(state) {
    const data = sliceFor(state, "categories").data;
    const prefs = state.preferences;
    if (!data || !prefs) return;
    const personal = prefs.effective.categoryColors || {};
    const personalIcons = prefs.effective.categoryIcons || {};
    const locked = prefs.sources.categoryColors === "locked";
    const iconsLocked = prefs.sources.categoryIcons === "locked";
    const cats = data.categories.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name));
    const iconsData = sliceFor(state, "icons").data;
    const sig = JSON.stringify([cats.map((c) => [c.id, c.name, c.color, c.icon, c.type]), personal, personalIcons, locked, iconsLocked, iconsData ? iconsData.catalog : null]);
    if (sig === colourSig) return;
    colourSig = sig;
    const rows = cats.map((c) => appearanceRow({
      id: c.id, name: c.name, workspaceColor: c.color, workspaceIcon: c.icon,
      personalColor: personal[c.id], personalIcon: personalIcons[c.id], palette: data.palette, locked, iconsLocked,
      badges: [badge(c.type === "income" ? "Income" : "Expense", "source")],
      onColor: (hex) => { const next = { ...personal }; if (hex) next[c.id] = hex; else delete next[c.id]; return save({ categoryColors: Object.keys(next).length ? next : null }); },
      onIcon: (id) => { const next = { ...personalIcons }; if (id) next[c.id] = id; else delete next[c.id]; return save({ categoryIcons: Object.keys(next).length ? next : null }); },
    }));
    mount(colourBox, ...rows);
  }

  // Personal account type colours/icons (BT-024): same mechanism as categories, for BT-019-02's
  // workspace-scoped account types.
  let accountTypeColourSig = "";
  function renderAccountTypeColours(state) {
    const data = sliceFor(state, "accountTypes").data;
    const prefs = state.preferences;
    if (!data || !prefs) return;
    const personal = prefs.effective.accountTypeColors || {};
    const personalIcons = prefs.effective.accountTypeIcons || {};
    const locked = prefs.sources.accountTypeColors === "locked";
    const iconsLocked = prefs.sources.accountTypeIcons === "locked";
    const types = data.types.filter((t) => !t.retired).sort((a, b) => (a.system === b.system ? a.name.localeCompare(b.name) : a.system ? -1 : 1));
    const sig = JSON.stringify([types.map((t) => [t.id, t.name, t.color, t.icon, t.accountingClass, t.system]), personal, personalIcons, locked, iconsLocked]);
    if (sig === accountTypeColourSig) return;
    accountTypeColourSig = sig;
    const rows = types.map((t) => appearanceRow({
      id: t.id, name: t.name, workspaceColor: t.color, workspaceIcon: t.icon,
      personalColor: personal[t.id], personalIcon: personalIcons[t.id], palette: data.palette, locked, iconsLocked,
      badges: [badge(ACCOUNT_TYPE_LABELS[t.accountingClass] || t.accountingClass, "source"), t.system ? badge("Built-in", "source") : null],
      onColor: (hex) => { const next = { ...personal }; if (hex) next[t.id] = hex; else delete next[t.id]; return save({ accountTypeColors: Object.keys(next).length ? next : null }); },
      onIcon: (id) => { const next = { ...personalIcons }; if (id) next[t.id] = id; else delete next[t.id]; return save({ accountTypeIcons: Object.keys(next).length ? next : null }); },
    }));
    mount(accountTypeColourBox, ...rows);
  }

  // Personal merchant type colours/icons (BT-024): same mechanism, for BT-019-03's workspace-scoped
  // merchant types.
  let merchantTypeColourSig = "";
  function renderMerchantTypeColours(state) {
    const data = sliceFor(state, "merchantTypes").data;
    const prefs = state.preferences;
    if (!data || !prefs) return;
    const personal = prefs.effective.merchantTypeColors || {};
    const personalIcons = prefs.effective.merchantTypeIcons || {};
    const locked = prefs.sources.merchantTypeColors === "locked";
    const iconsLocked = prefs.sources.merchantTypeIcons === "locked";
    const types = data.types.filter((t) => !t.retired).sort((a, b) => (a.system === b.system ? a.name.localeCompare(b.name) : a.system ? -1 : 1));
    const sig = JSON.stringify([types.map((t) => [t.id, t.name, t.color, t.icon, t.merchantClass, t.system]), personal, personalIcons, locked, iconsLocked]);
    if (sig === merchantTypeColourSig) return;
    merchantTypeColourSig = sig;
    const rows = types.map((t) => appearanceRow({
      id: t.id, name: t.name, workspaceColor: t.color, workspaceIcon: t.icon,
      personalColor: personal[t.id], personalIcon: personalIcons[t.id], palette: data.palette, locked, iconsLocked,
      badges: [badge(MERCHANT_TYPE_LABELS[t.merchantClass] || t.merchantClass, "source"), t.system ? badge("Built-in", "source") : null],
      onColor: (hex) => { const next = { ...personal }; if (hex) next[t.id] = hex; else delete next[t.id]; return save({ merchantTypeColors: Object.keys(next).length ? next : null }); },
      onIcon: (id) => { const next = { ...personalIcons }; if (id) next[t.id] = id; else delete next[t.id]; return save({ merchantTypeIcons: Object.keys(next).length ? next : null }); },
    }));
    mount(merchantTypeColourBox, ...rows);
  }

  // The site icon catalogue (BT-011-05). Custom icons are added only through the validated upload:
  // the browser checks type and size first, and the server checks type, size, dimensions and every
  // element and attribute before storing plain shape data.
  let catalogLoaded = false;
  let builtInsOpen = false;
  // After each change the card is rebuilt and focus returns to the same control, found by a
  // stable key, rather than falling to the page (UXI-5).
  async function loadCatalog(focusKey = null) {
    let data;
    try { data = await ctx.api.icons(); } catch (err) { mount(catalogBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); return; }
    const cat = data.catalog;
    const after = async (message, key) => { announce(message); await store.actions.refreshIcons(); await loadCatalog(key); };
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
      try { await ctx.api.iconAction("upload", { label: label.value.trim(), svg: await f.text() }); await after("Icon added.", "upload"); }
      catch (err) { note.textContent = messageFor(err); }
    }, { variant: "primary", attrs: { "data-focus-key": "upload" } });
    const upload = el("div", { class: "form-grid" }, [
      field("Icon name", label), field("SVG file", file, { help: "A square 24 × 24 drawing made only of paths and simple shapes, at most 8 KB. Colours in the file are ignored; icons take the colour of the text." }),
      el("div", { class: "field" }, [add]), note,
    ]);
    const custom = cat.custom.length ? el("ul", { class: "stack" }, cat.custom.map((c) => {
      const rename = input({ maxlength: "40", value: c.label, autocomplete: "off", "aria-label": `New name for ${c.label}` });
      return el("li", { class: "row" }, [
        withIcon(c.id, c.label), badge(c.status === "active" ? "Offered" : "Retired", c.status === "active" ? "source" : "closed"),
        el("span", { class: "app__spacer" }), el("label", { class: "field--inline small" }, ["Name ", rename]),
        button("Rename", async () => { try { await ctx.api.renameIcon({ iconId: c.id, label: rename.value.trim() }); await after("Icon renamed.", `rn-${c.id}`); } catch (err) { note.textContent = messageFor(err); } }, { small: true, attrs: { "aria-label": `Rename ${c.label}`, "data-focus-key": `rn-${c.id}` } }),
        button(c.status === "active" ? "Retire" : "Offer again", async () => {
          try { await ctx.api.iconAction(c.status === "active" ? "retire" : "restore", { iconId: c.id }); await after(c.status === "active" ? `${c.label} retired.` : `${c.label} offered again.`, `rt-${c.id}`); } catch (err) { note.textContent = messageFor(err); }
        }, { small: true, attrs: { "aria-label": `${c.status === "active" ? "Retire" : "Offer again"}: ${c.label}`, "data-focus-key": `rt-${c.id}` } }),
      ]);
    })) : el("p", { class: "muted small", text: "No custom icons yet." });
    // The checkboxes form one named group (UXI-5).
    const builtIns = el("fieldset", { class: "plain-fieldset" }, [
      el("legend", { class: "sr-only", text: "Built-in icons offered in pickers" }),
      el("div", { class: "icon-grid" }, cat.builtIn.filter((i) => !i.system).map((i) => {
        const box = el("input", { type: "checkbox", "data-focus-key": `bi-${i.id}` });
        box.checked = i.enabled;
        box.addEventListener("change", async () => {
          try { await ctx.api.iconAction(box.checked ? "enable" : "disable", { iconId: i.id }); await after(`${i.label} ${box.checked ? "offered" : "switched off"}.`, `bi-${i.id}`); }
          catch (err) { box.checked = !box.checked; note.textContent = messageFor(err); }
        });
        return el("label", { class: "field--inline" }, [box, withIcon(i.id, i.label)]);
      })),
    ]);
    const details = el("details", { class: "more" }, [el("summary", { text: "Built-in icons offered in pickers" }), el("p", { class: "field__help", text: "The money-direction and fallback icons are used by the app itself and are always on." }), builtIns]);
    details.open = builtInsOpen;
    details.addEventListener("toggle", () => { builtInsOpen = details.open; });
    mount(catalogBox,
      el("h3", { text: "Add a custom icon" }), upload,
      el("h3", { text: "Custom icons" }), custom,
      details);
    if (focusKey) {
      const target = catalogBox.querySelector(`[data-focus-key="${focusKey}"]`);
      if (target) target.focus();
    }
  }

  // "Deleted workspaces": rendered on every update() (not gated behind the preferences-signature
  // cache below), since it depends on state.workspaces, not on preferences.
  let deletedShown = false;
  let deletedSig = "";
  function renderDeleted(state) {
    const deleted = (state.workspaces || []).filter((w) => w.status === "archived");
    if (deleted.length) deletedShown = true;
    deletedCard.hidden = !deletedShown;
    if (!deletedShown) return;
    const sig = JSON.stringify(deleted.map((w) => [w.id, w.name, w.archivedAt]));
    if (sig === deletedSig) return;
    deletedSig = sig;
    mount(deletedBox, deleted.length
      ? el("ul", { class: "stack" }, deleted.map((w) => {
          const err = el("p", { class: "error-text small", role: "alert", hidden: true });
          const restore = button("Bring back", async () => {
            err.hidden = true; err.textContent = "";
            const out = await store.actions.restoreWorkspace(w.id);
            if (out.ok) {
              deletedStatus.textContent = `${w.name} is back. Everyone who was in it has their access again; choose it in the workspace picker.`;
              deletedStatus.focus();
            } else {
              err.textContent = messageFor(out.error);
              err.hidden = false;
            }
          }, { small: true, attrs: { "aria-label": `Bring back ${w.name}` } });
          return el("li", { class: "row" }, [el("strong", { text: w.name }), el("span", { class: "muted small", text: `Deleted ${(w.archivedAt || "").slice(0, 10)}` }), restore, err]);
        }))
      : el("p", { class: "muted small", text: "No deleted workspaces." }));
  }

  let rendered = "";
  function update(state) {
    const ws = (state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId);
    const layoutId = effectiveLayoutId(state, ws);
    if (mountedLayout !== layoutId) { mount(bodyHost, arrangementFor(layoutId)); mountedLayout = layoutId; }
    // Show the saved name, or suggest the Google one once, without overwriting what is being typed.
    if (!nameTouched && document.activeElement !== nameInput) {
      const current = state.auth && state.auth.user ? state.auth.user.name || "" : "";
      if (current) nameInput.value = current;
      else if (!suggested && ctx.api && ctx.api.providerName) {
        suggested = true;
        void ctx.api.providerName().then((n) => {
          if (n && !nameTouched && !nameInput.value) { nameInput.value = n; nameStatus.textContent = "Suggested from your Google account. Select Save name to use it."; }
        });
      }
    }
    renderDeleted(state);
    groupDeleted.setHidden(deletedCard.hidden);
    const prefs = state.preferences;
    if (!prefs) return;
    renderStaging(state);
    colourCard.hidden = !state.selectedWorkspaceId;
    renderColours(state);
    accountTypeColourCard.hidden = !state.selectedWorkspaceId;
    renderAccountTypeColours(state);
    groupAccountTypeColours.setHidden(accountTypeColourCard.hidden);
    merchantTypeColourCard.hidden = !state.selectedWorkspaceId;
    renderMerchantTypeColours(state);
    groupMerchantTypeColours.setHidden(merchantTypeColourCard.hidden);
    const siteAdmin = !!(state.auth && state.auth.user && state.auth.user.siteAdmin);
    catalogCard.hidden = !siteAdmin;
    groupColours.setHidden(colourCard.hidden && catalogCard.hidden);
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
    // A save rebuilds the card; the preference that had focus gets it back on its new control, rather
    // than focus leaving the page with the old one (A11Y2-001's rule; BT-004-05).
    const focusedKey = focusedPref();
    prefControls = {};
    const masking = el("input", { type: "checkbox" });
    masking.checked = !!e.balanceMasking;
    mount(prefBox,
      prefControl("Hide balances on screen", "balanceMasking", masking, prefs),
      prefControl("Display currency", "displayCurrency", pickerSelect(CURRENCIES.map((c) => ({ value: c, label: c || "Account currency" })), e.displayCurrency || ""), prefs),
      prefControl("Date format", "dateFormat", pickerSelect([{ value: "iso", label: "2026-09-13" }, { value: "dmy", label: "13/09/2026" }, { value: "mdy", label: "09/13/2026" }], e.dateFormat, {}, { search: false }), prefs),
      prefControl("Number format", "numberFormat", pickerSelect(["1,234.56", "1.234,56", "1 234,56"].map((v) => ({ value: v, label: v })), e.numberFormat, {}, { search: false }), prefs),
      prefControl("Default workspace", "defaultWorkspaceId", pickerSelect([{ value: "", label: "First available" }].concat(state.workspaces.filter((w) => w.status !== "archived").map((w) => ({ value: w.id, label: w.name }))), e.defaultWorkspaceId || ""), prefs),
    );
    // An enhanced select's focus() lands on its trigger.
    if (focusedKey && prefControls[focusedKey]) prefControls[focusedKey].focus();
  }
  return { element, update, destroy: unsubscribe };
}
