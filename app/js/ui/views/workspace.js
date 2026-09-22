// Workspace administration: members and roles, invitations (with an access preview and a one-time
// link), backups and restores (preview first, errors in the modal, replace needs typed
// confirmation, last successful backup shown), and recent activity in plain language. Every
// control is presentation; the server enforces.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, field, input, pickerSelect, controlElement, button, badge, commitOnConfirm, categoryLabel } from "../components.js";
import { createSettingsForm, settingText } from "../settingsform.js";
import { createSettingsGroup } from "../settingsgroup.js";
import { trackUnsaved } from "../../core/unsaved.js";
import { createThemePicker } from "../themepicker.js";
import { colourEntries } from "../../core/categories.js";
import { openModal, confirmModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { messageFor } from "../../core/errors.js";
import { ACCOUNT_TYPE_LABELS, BILL_TYPE_LABELS, MERCHANT_TYPE_LABELS } from "../../core/format.js";
import { createIconPicker } from "../iconpicker.js";
import { builtInIconFor, withIcon } from "../icons.js";
import { managesSharedLists } from "../../core/workspacesettings.js";
import { openWorkspacePermanentDeleteDialog } from "../permanentdelete.js";
import { createLayoutPicker } from "./layoutpicker.js";
import { effectiveLayoutId, layoutAccentVars } from "../../core/layoutmeta.js";

// Icons for the workspace's types (BT-011-05): accounts, bills and merchants of a type show this icon
// unless one was chosen on the record itself.
const TYPE_GROUPS = [
  { kind: "account", title: "Account types", labels: ACCOUNT_TYPE_LABELS },
  { kind: "bill", title: "Bill types", labels: BILL_TYPE_LABELS },
  { kind: "merchant", title: "Merchant types", labels: MERCHANT_TYPE_LABELS },
];

const ROLES = [{ value: "viewer", label: "Viewer" }, { value: "member", label: "Member" }, { value: "manager", label: "Manager" }, { value: "owner", label: "Owner" }];
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));
// Storage allowances an owner may give a member (Terry, 2026-09-13), matching api/members/handler.js.
const ALLOWANCE_MB = [1, 2, 4, 8, 12];
const MB = 1024 * 1024;
const sizeLabel = (bytes) => (bytes >= MB ? `${Math.round((bytes / MB) * 10) / 10} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// Plain-language activity (UX-007). Unknown actions fall back to readable words.
const ACTIVITY = {
  "workspace.create": "created the workspace", "workspace.update": "changed workspace settings", "workspace.archive": "archived the workspace", "workspace.restore": "restored the workspace",
  "member.role": "changed a member's role", "member.remove": "removed a member", "member.leave": "left the workspace",
  "invitation.create": "invited someone", "invitation.revoke": "cancelled an invitation", "invitation.accept": "joined the workspace",
  "grant.create": "shared an account", "grant.revoke": "stopped sharing an account",
  "account.create": "added an account", "account.update": "changed an account", "account.delete": "deleted an account", "account.restore": "restored an account",
  "transaction.create": "added an entry", "transaction.update": "edited an entry", "transaction.delete": "deleted an entry", "transaction.restore": "restored an entry",
  "payee.create": "added a merchant", "payee.update": "changed a merchant", "payee.delete": "removed a merchant", "payee.archive": "closed a merchant", "payee.reopen": "reopened a merchant",
  "recurring.create": "added a bill", "recurring.update": "changed a bill", "recurring.record": "recorded a bill", "recurring.skip": "skipped a bill payment", "recurring.unskip": "undid a skipped bill payment",
  "recurring.pause": "paused a bill", "recurring.resume": "resumed a bill", "recurring.delete": "removed a bill",
  "budget.create": "added a budget", "budget.update": "changed a budget", "budget.delete": "archived a budget", "budget.restore": "restored a budget",
  "category.create": "added a category", "category.update": "changed a category", "workspace.type-icons": "changed the icons for account, bill or merchant types", "contact.create": "added a contact", "contact.update": "changed a contact", "contact.delete": "removed a contact",
  "backup.create": "created a backup", "workspace.restore-replace": "restored from a backup (replace)", "workspace.restore-merge": "restored from a backup (merge)", "workspace.restore-create": "created a workspace from a backup",
  // Shared expenses (BT-009).
  "group.expense.create": "added a shared expense", "group.expense.update": "corrected a shared expense", "group.expense.void": "voided a shared expense",
  "group.settlement.report": "recorded a payment", "group.settlement.confirm": "confirmed a payment", "group.settlement.dispute": "disputed a payment", "group.settlement.void": "voided a payment",
  "group.ledger.link": "recorded a shared expense on their own account", "group.ledger.unlink": "stopped recording a shared expense on their own account", "transaction.reverse": "reversed an entry",
};
const describe = (action) => ACTIVITY[action] || action.replace(/[.-]/g, " ");
// Workspace setting names and membership events in plain language (BT-001-05, audit B15/B16).
const WS_FIELDS = { name: "Name", "settings.reportingCurrency": "Reporting currency", "settings.budgetPeriod": "Budget period", "settings.weekStart": "Week start" };
const MEMBER_EVENTS = { removed: "removed", left: "left the workspace" };
const stamp = (iso) => iso.replace("T", " ").slice(0, 16);

// A setting's value in words now lives with the shared settings card (app/js/ui/settingsform.js).
export { settingText };

// Who changes workspace settings, said once (UX/accessibility review of eefd115, finding 6).
const INTRO_CHANGE = "These decide how everyone in this workspace works. Owners and managers change them; the ones marked “Owners only” can be changed by owners alone. Each one starts with how BudgetTracker has always worked. Privacy and safety rules are not settings: private accounts stay private, nothing is ever deleted and every change is kept.";
const INTRO_READ = "These decide how everyone in this workspace works. Owners and managers change them; you can see how it is set up and every change below.";

// Shared per-browser remembered-open storage for every collapsible section on this page (BT-019-04,
// BT-021): Category colours and icons, each "Add … type" creation form, and this page's own tab.
const WORKSPACE_GROUP_KEY = "settings.workspace.groups";

// BT-021 (Terry, 2026-09-22: "make categories and types easy to understand and manage... separate
// existing items from the action to add a new item... compact, consistently aligned rows with an
// expandable inline creation or editing form"). Account types, Category types and Merchant types
// (BT-019-01/02/03) are the SAME mechanism three times over — a name, an editable colour, an
// optional icon and one fixed underlying class — differing only in labels, wording and which API
// they call. One generic manager renders all three identically: a compact one-line row per type
// (name, colour, class, Built-in/Retired), with the full edit form (name, colour, icon, class,
// retire) tucked behind a native, keyboard-accessible <details> per row, and the creation form
// collapsed behind its own named toggle so the page does not show every control at once. Every
// field, help sentence, refresh key and API call below is copied verbatim from the three
// once-separate render functions this replaces — nothing about validation, permissions, wording or
// behaviour changed, only how densely it is shown.
function createTypeManager(ctx, cfg) {
  const { store, api } = ctx;
  const intro = el("p", { class: "field__help" });
  // The creation form is rebuilt fresh each render (exactly like the three functions this replaces
  // always did), mounted into this one stable box so the surrounding collapsible section — created
  // ONCE here — never needs to be recreated itself.
  const addBox = el("div", { class: "typeadd" });
  const addGroup = createSettingsGroup({ id: cfg.groupId, storageKey: WORKSPACE_GROUP_KEY, name: cfg.addGroupName, defaultOpen: false, nodes: [addBox] });
  // A non-editor gets no creation control AT ALL — not merely a hidden one (the same "must not
  // exist in the DOM for anyone else" rule this file already applies to Delete workspace) — so
  // `addSlot` only ever holds `addGroup.element` while `canEdit` is true.
  const addSlot = el("div");
  const listBox = el("div");
  const element = el("div", { class: "stack" }, [intro, addSlot, listBox]);

  const openRows = new Set();
  let sig = "";

  function buildRow(t, data) {
    const labelId = `${cfg.rowPrefix}-${t.id}`;
    const error = el("p", { class: "error-text small", role: "alert", hidden: true });
    let picker = null;
    const patchColour = async (color) => {
      const out = await store.actions.write((ws) => cfg.apiPatch(api, ws, { typeId: t.id, color }), cfg.patchRefresh);
      if (out.ok) { announce(`${t.name}: colour ${color ? "saved" : "reset to default"}.`); return; }
      if (picker) picker.select(t.color);
      error.textContent = messageFor(out.error);
      error.hidden = false;
    };
    picker = createThemePicker({
      value: t.color, entries: colourEntries(data.palette, t.color), labelledBy: labelId,
      listLabel: `Colours for ${t.name}`, namePrefix: `${t.name} colour`, onPick: (hex) => { void patchColour(hex); },
    });
    const chosenIcon = t.iconSource === "workspace" ? t.icon : null;
    const iconPick = createIconPicker({
      value: chosenIcon, inherited: t.defaultIcon, name: t.name, label: "Icon", tint: t.color,
      onPick: async (id) => {
        const out = await store.actions.write((ws) => cfg.apiPatch(api, ws, { typeId: t.id, icon: id || null }), cfg.patchRefresh);
        if (out.ok) { announce(`${t.name}: icon ${id ? "saved" : "reset to default"}.`); return; }
        iconPick.select(chosenIcon);
        error.textContent = messageFor(out.error);
        error.hidden = false;
      },
    });
    const nameInput = input({ maxlength: "60", value: t.name, autocomplete: "off" });
    const saveName = button("Save name", async () => {
      const value = nameInput.value.trim();
      if (!value || value === t.name) { nameInput.value = t.name; return; }
      const out = await store.actions.write((ws) => cfg.apiPatch(api, ws, { typeId: t.id, name: value }), cfg.patchRefresh);
      if (!out.ok) { nameInput.value = t.name; error.textContent = messageFor(out.error); error.hidden = false; return; }
      announce(`Renamed to ${value}.`);
    }, { small: true });
    let classControl;
    if (t.system || t.usageCount > 0) {
      classControl = el("span", { class: "muted small", text: cfg.classLabel(t[cfg.classField]) });
    } else {
      classControl = pickerSelect(data[cfg.classesKey].map((c) => ({ value: c, label: cfg.classLabel(c) })), t[cfg.classField], { "aria-label": `${cfg.classFieldLabel} for ${t.name}` }, { search: false });
      classControl.addEventListener("change", async () => {
        const out = await store.actions.write((ws) => cfg.apiPatch(api, ws, { typeId: t.id, [cfg.classField]: classControl.value }), [cfg.sliceKey]);
        if (!out.ok) { classControl.value = t[cfg.classField]; error.textContent = messageFor(out.error); error.hidden = false; }
        else announce(cfg.classChangedAnnounce(t.name, cfg.classLabel(classControl.value)));
      });
    }
    const retireBtn = t.system
      ? el("span", { class: "muted small", text: "Built-in — always available" })
      : button(t.retired ? "Reactivate" : "Retire", async () => {
        const out = await store.actions.write((ws) => cfg.apiPatch(api, ws, { typeId: t.id, retired: !t.retired }), [cfg.sliceKey]);
        if (!out.ok) { error.textContent = messageFor(out.error); error.hidden = false; return; }
        announce(t.retired ? cfg.reactivateAnnounce(t.name) : cfg.retireAnnounce(t.name));
      }, { small: true, variant: "ghost" });
    const summary = el("summary", {}, [
      el("h3", { class: "typerow__name" }, [categoryLabel(t.name, t.color, t.icon)]),
      badge(cfg.classLabel(t[cfg.classField]), "source"),
      t.system ? badge("Built-in", "source") : null,
      t.retired ? badge("Retired") : null,
      el("span", { class: "typerow__spacer" }),
      el("span", { class: "typerow__edit", "aria-hidden": "true", text: "Edit" }),
    ]);
    const details = el("details", { class: "typerow" }, [
      summary,
      el("div", { class: "catrow" }, [
        el("div", { class: "row" }, [field("Name", nameInput), saveName]),
        el("div", { class: "field" }, [el("p", { class: "field__label", id: labelId, text: "Colour" }), picker.element]),
        iconPick.element,
        field(cfg.classFieldLabel, classControl, {
          help: t.system ? cfg.systemHelp : t.usageCount > 0 ? cfg.lockedHelp(t.usageCount) : cfg.freeHelp,
        }),
        error,
        el("div", { class: "row catrow__meta" }, [
          badge(t.colorSource === "workspace" ? "Custom colour" : "Default colour", "source"),
          t.colorSource === "workspace" ? button("Reset colour", () => { void patchColour(null); }, { small: true, variant: "ghost", attrs: { "aria-label": `Reset to default: ${t.name} colour` } }) : null,
          badge(chosenIcon ? "Custom icon" : "Default icon", "source"),
          el("span", { class: "app__spacer" }), retireBtn,
        ]),
      ]),
    ]);
    if (openRows.has(t.id)) details.open = true;
    details.addEventListener("toggle", () => { if (details.open) openRows.add(t.id); else openRows.delete(t.id); });
    return details;
  }

  function render(state) {
    const data = sliceFor(state, cfg.sliceKey).data;
    if (!data) return;
    const selfMember = ((sliceFor(state, "members").data || {}).members || []).find((m) => m.self);
    const role = selfMember ? selfMember.role : "viewer";
    const canEdit = ["owner", "manager"].includes(role) || (role === "member" && managesSharedLists(state));
    const key = JSON.stringify([data.types, canEdit]);
    if (key === sig) return;
    sig = key;
    const types = data.types.slice().sort((a, b) => (a.system === b.system ? a.name.localeCompare(b.name) : a.system ? -1 : 1));
    intro.textContent = canEdit ? cfg.editableIntro : cfg.readonlyIntro;
    if (!canEdit) {
      mount(addSlot);
      mount(listBox, el("ul", { class: "stack" }, types.filter((t) => !t.retired).map((t) => el("li", { class: "row" }, [
        categoryLabel(t.name, t.color, t.icon), badge(cfg.classLabel(t[cfg.classField]), "source"), t.system ? badge("Built-in") : null,
      ]))));
      return;
    }
    mount(addSlot, addGroup.element);
    const newName = input({ maxlength: "60", placeholder: cfg.namePlaceholder, autocomplete: "off" });
    const newClass = pickerSelect(data[cfg.classesKey].map((c) => ({ value: c, label: cfg.classLabel(c) })), data[cfg.classesKey][0], {}, { search: false });
    const createError = el("p", { class: "error-text small", role: "alert", hidden: true });
    const createBtn = button(cfg.createSubmitLabel, async () => {
      createError.hidden = true;
      if (!newName.value.trim()) {
        newName.setAttribute("aria-invalid", "true");
        createError.textContent = "Give the type a name.";
        createError.hidden = false;
        newName.focus();
        return;
      }
      const out = await store.actions.write((ws) => cfg.apiCreate(api, ws, { name: newName.value.trim(), [cfg.classField]: newClass.value }), cfg.createRefresh);
      if (!out.ok) { createError.textContent = messageFor(out.error); createError.hidden = false; return; }
      announce(cfg.createdAnnounce(newName.value.trim()));
      newName.removeAttribute("aria-invalid");
      newName.value = "";
    }, { variant: "primary" });
    mount(addBox, el("div", { class: "form-grid" }, [field("New type name", newName), field(cfg.classFieldLabel, newClass), createBtn]), createError);
    mount(listBox, ...types.map((t) => buildRow(t, data)));
  }

  return { element, render };
}

// "Delete workspace" (Terry, 2026-09-14: "the workspace owner should be able to delete their own
// workspace(s)"). Underneath it stays the recoverable archive (BT-001-05: nothing is ever physically
// deleted) — the dialog says so and names where it comes back. Owners only; a site administrator never
// gets this, or any other access to the workspace's records (CLAUDE.md §3).
const DELETE_MESSAGE = "Everyone loses access and it disappears from your lists. Nothing is erased: you can bring it back from Deleted workspaces in My settings.";
function openDeleteDialog(ctx, workspace) {
  const { store, navigate } = ctx;
  const reason = input({ maxlength: "200" });
  reason.value = "No longer needed";
  const confirmName = input({ maxlength: "80", autocomplete: "off" });
  const formId = `delete-workspace-${workspace.id}`;
  const go = el("button", { type: "submit", class: "btn btn--danger", text: "Delete workspace", form: formId });
  const form = el("form", { class: "form-grid", novalidate: true, id: formId }, [
    field("Reason", reason),
    field(`Type ${workspace.name} to confirm`, confirmName),
  ]);
  const modal = openModal({
    title: `Delete ${workspace.name}?`,
    body: [el("p", { text: DELETE_MESSAGE }), form],
    actions: [button("Cancel", () => modal.close()), go],
  });
  async function submit() {
    modal.setError("");
    confirmName.removeAttribute("aria-invalid");
    confirmName.removeAttribute("aria-errormessage");
    if (confirmName.value !== workspace.name) {
      confirmName.setAttribute("aria-invalid", "true");
      confirmName.setAttribute("aria-errormessage", modal.errorId);
      modal.setError(`Type the workspace name, ${workspace.name}, to confirm.`);
      confirmName.focus();
      return;
    }
    modal.setBusy(true);
    const out = await store.actions.deleteWorkspace(workspace.id, reason.value.trim());
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    modal.close();
    announce(`${workspace.name} deleted. You can bring it back from Deleted workspaces in My settings.`);
    if (navigate) navigate("dashboard");
  }
  go.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  return modal;
}

export function createView(ctx) {
  const { api, store } = ctx;
  const wsId = store.getState().selectedWorkspaceId;
  const membersBox = el("div");
  const inviteBox = el("div");
  const backupsBox = el("div");
  const auditBox = el("div");
  const formerBox = el("div");
  const historyBox = el("div");
  const settingsBox = el("div", { class: "stack" });
  const layoutPicker = createLayoutPicker(ctx);
  const coloursBox = el("div", { class: "stack" });
  const typesBox = el("div", { class: "stack" });
  // BT-019-04 (Terry, 2026-09-19): the "Category colours and icons" panel made collapsible here
  // too, consistent with My Settings' own personal-override version of it (already collapsible via
  // this exact shared shell, BT-017). Every pick inside `coloursBox` already saves immediately
  // (no draft/unsaved state exists to lose — see the PATCH calls below), and this shell never
  // rebuilds `nodes`, only toggles their visibility, so an in-flight save or a validation error
  // already shown inline survives a collapse/reopen untouched. BT-021 (2026-09-22): now that this
  // lives on its own "Layout & colours" tab (already hidden until chosen) it starts CLOSED like every
  // other secondary section on this page, with a live count of workspace categories shown even
  // while collapsed; still remembered per browser, separately from My Settings' own groups.
  const groupColours = createSettingsGroup({ id: "ws-g-colours", storageKey: WORKSPACE_GROUP_KEY, name: "Category colours and icons", defaultOpen: false, nodes: [coloursBox] });
  // BT-021: Account/Category/Merchant types (BT-019-01/02/03) share one generic manager — see
  // `createTypeManager` above — configured once per kind with the exact wording, API calls and
  // refresh keys the three former render functions used.
  const accountTypeManager = createTypeManager(ctx, {
    sliceKey: "accountTypes", classesKey: "accountingClasses", classField: "accountingClass",
    classLabel: (c) => ACCOUNT_TYPE_LABELS[c] || c, classFieldLabel: "Accounting behaviour",
    namePlaceholder: "e.g. Store card", addGroupName: "Add account type", createSubmitLabel: "Save account type", groupId: "ws-add-atype", rowPrefix: "ws-atype",
    readonlyIntro: "Owners and managers create and edit account types here. Each one maps to one of BudgetTracker's underlying accounting behaviours, so renaming or recolouring it never changes a balance or any history.",
    editableIntro: "Each account type has a name, colour and optional icon and maps to one of BudgetTracker's underlying accounting behaviours. Renaming or recolouring never changes a balance, direction or history. A retired type stops appearing for new accounts but stays visible on any account that already uses it.",
    systemHelp: "A built-in type's own accounting behaviour never changes.",
    lockedHelp: (n) => `Used by ${n} account${n === 1 ? "" : "s"} already — locked so a change can never silently reinterpret their history. Create a new type instead.`,
    freeHelp: "Change freely until an account uses this type.",
    createdAnnounce: (name) => `${name} added as an account type.`,
    classChangedAnnounce: (name, label) => `${name} now behaves as ${label}.`,
    retireAnnounce: (name) => `${name} retired. It stays on any account that already uses it, but is no longer offered for new ones.`,
    reactivateAnnounce: (name) => `${name} is available for new accounts again.`,
    apiCreate: (api, ws, body) => api.createAccountType(ws, body), apiPatch: (api, ws, body) => api.patchAccountType(ws, body),
    createRefresh: ["accountTypes"], patchRefresh: ["accountTypes", "accounts"],
  });
  const categoryTypeManager = createTypeManager(ctx, {
    sliceKey: "categoryTypes", classesKey: "categoryClasses", classField: "categoryClass",
    classLabel: (c) => (c === "income" ? "Income" : "Expense"), classFieldLabel: "Expense or income",
    namePlaceholder: "e.g. Essential spending", addGroupName: "Add category type", createSubmitLabel: "Save category type", groupId: "ws-add-ctype", rowPrefix: "ws-ctype",
    readonlyIntro: "Owners and managers create and edit category types here. Each one maps to expense or income, so renaming or recolouring it never changes a calculation or any history.",
    editableIntro: "Each category type has a name, colour and optional icon and maps to expense or income. Renaming or recolouring never changes a calculation, budget or history. A retired type stops appearing for new categories but stays visible on any category that already uses it.",
    systemHelp: "A built-in type's own expense/income behaviour never changes.",
    lockedHelp: (n) => `Used by ${n} categor${n === 1 ? "y" : "ies"} already — locked so a change can never silently reinterpret their history. Create a new type instead.`,
    freeHelp: "Change freely until a category uses this type.",
    createdAnnounce: (name) => `${name} added as a category type.`,
    classChangedAnnounce: (name, label) => `${name} is now ${label.toLowerCase()}.`,
    retireAnnounce: (name) => `${name} retired. It stays on any category that already uses it, but is no longer offered for new ones.`,
    reactivateAnnounce: (name) => `${name} is available for new categories again.`,
    apiCreate: (api, ws, body) => api.createCategoryType(ws, body), apiPatch: (api, ws, body) => api.patchCategoryType(ws, body),
    createRefresh: ["categoryTypes"], patchRefresh: ["categoryTypes", "categories"],
  });
  const merchantTypeManager = createTypeManager(ctx, {
    sliceKey: "merchantTypes", classesKey: "merchantClasses", classField: "merchantClass",
    classLabel: (c) => MERCHANT_TYPE_LABELS[c] || c, classFieldLabel: "Merchant class",
    namePlaceholder: "e.g. Streaming service", addGroupName: "Add merchant type", createSubmitLabel: "Save merchant type", groupId: "ws-add-mtype", rowPrefix: "ws-mtype",
    readonlyIntro: "Owners and managers create and edit merchant types here. Renaming or recolouring one never changes any merchant's history.",
    editableIntro: "Each merchant type has a name, colour and optional icon. Renaming or recolouring never changes any merchant's history. A retired type stops appearing for new merchants but stays visible on any merchant that already uses it.",
    systemHelp: "A built-in type's own class never changes.",
    lockedHelp: (n) => `Used by ${n} merchant${n === 1 ? "" : "s"} already — locked so a change can never silently reinterpret their history. Create a new type instead.`,
    freeHelp: "Change freely until a merchant uses this type.",
    createdAnnounce: (name) => `${name} added as a merchant type.`,
    classChangedAnnounce: (name, label) => `${name} is now classed as ${label}.`,
    retireAnnounce: (name) => `${name} retired. It stays on any merchant that already uses it, but is no longer offered for new ones.`,
    reactivateAnnounce: (name) => `${name} is available for new merchants again.`,
    apiCreate: (api, ws, body) => api.createMerchantType(ws, body), apiPatch: (api, ws, body) => api.patchMerchantType(ws, body),
    createRefresh: ["merchantTypes"], patchRefresh: ["merchantTypes", "payees"],
  });
  // "Delete workspace" (owners only): a separate danger-style card at the bottom of the page, outside
  // the tabs, built only for an owner (finding: it must not exist in the DOM for anyone else).
  const deleteBox = el("div");

  // BT-021 (Terry, 2026-09-22): "the Layout panel takes up too much space... everything below that
  // needs a substantial organization and alignment pass". This page's ~14 sections are now grouped
  // into three real, same-page sub-tabs (the same visual idiom as the app's own site-admin sub-tabs,
  // `.app__nav--sub` in app/js/ui/shell.js, but genuine ARIA tabs — role="tablist"/"tab"/"tabpanel" —
  // since these toggle panels here rather than navigating to a new route): "General" (membership,
  // workspace settings, backups, activity — everything already reviewed as a good visual reference),
  // "Layout & colours" (Layout, category colours, type icons — Terry's own suggested grouping), and
  // "Categories & types" (the three managed-type lists, item 6's specific focus). Automatic
  // activation (arrow keys both move and select, matching the WAI-ARIA APG tabs pattern), Home/End,
  // and the choice is remembered per browser like every other preference on this page.
  const TABS = [
    { id: "general", label: "General" },
    // Named "Layout & colours" rather than a bare "Appearance": the Workspace settings card (on
    // General) already has its own settings-group literally named "Appearance" (the plain "Layout
    // theme" dropdown's group, api/_shared/workspace-settings.js) — a second, identically-named
    // control on the same page would be a genuine ambiguity, for assistive tech and automation alike.
    { id: "appearance", label: "Layout & colours" },
    { id: "types", label: "Categories & types" },
  ];
  function readTab() {
    try {
      const v = globalThis.localStorage ? globalThis.localStorage.getItem("bt.workspace.tab") : null;
      return TABS.some((t) => t.id === v) ? v : "general";
    } catch { return "general"; }
  }
  function writeTab(id) {
    try { if (globalThis.localStorage) globalThis.localStorage.setItem("bt.workspace.tab", id); } catch { /* not remembered */ }
  }
  // A link that names a setting (e.g. the Shared expenses "off" page) always lands on General, where
  // the Workspace settings card — and the field it focuses — actually lives, whatever tab was last
  // remembered; otherwise the focus this page already promises would land inside a hidden panel.
  let activeTab = (ctx.params && ctx.params.setting) ? "general" : readTab();
  const tabButtons = {};
  const panels = {};
  function selectTab(id) {
    activeTab = id;
    writeTab(id);
    for (const t of TABS) {
      const active = t.id === id;
      tabButtons[t.id].setAttribute("aria-selected", active ? "true" : "false");
      tabButtons[t.id].setAttribute("tabindex", active ? "0" : "-1");
      panels[t.id].hidden = !active;
    }
  }
  function focusTab(id) { selectTab(id); tabButtons[id].focus(); }
  const tabIds = TABS.map((t) => t.id);
  const tablist = el("div", { class: "tabbar", role: "tablist", "aria-label": "Workspace sections" },
    TABS.map((t) => {
      const b = el("button", {
        type: "button", class: "tabbar__tab", role: "tab", id: `wstab-${t.id}`, "aria-controls": `wspanel-${t.id}`,
        "aria-selected": t.id === activeTab ? "true" : "false", tabindex: t.id === activeTab ? "0" : "-1", text: t.label,
      });
      b.addEventListener("click", () => selectTab(t.id));
      b.addEventListener("keydown", (e) => {
        const i = tabIds.indexOf(t.id);
        if (e.key === "ArrowRight") { e.preventDefault(); focusTab(tabIds[(i + 1) % tabIds.length]); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); focusTab(tabIds[(i - 1 + tabIds.length) % tabIds.length]); }
        else if (e.key === "Home") { e.preventDefault(); focusTab(tabIds[0]); }
        else if (e.key === "End") { e.preventDefault(); focusTab(tabIds[tabIds.length - 1]); }
      });
      tabButtons[t.id] = b;
      return b;
    }));
  function panel(id, nodes) {
    const p = el("div", { class: "tabbar__panel", role: "tabpanel", id: `wspanel-${id}`, "aria-labelledby": `wstab-${id}`, tabindex: "0" }, nodes);
    // Set as a property, not an attrs entry (el() only ever sets `hidden` when it is truthy, since
    // a falsy attrs value is skipped like every other falsy attribute) — matches
    // settingsgroup.js's own `body.hidden = !initialOpen` for the identical reason.
    p.hidden = id !== activeTab;
    panels[id] = p;
    return p;
  }

  // "General": membership, the Workspace settings card (Terry's own visual reference, unchanged),
  // backups, activity and history — exactly as before, minus the sections moved below.
  const generalPanel = panel("general", [el("div", { class: "grid grid--two" }, [
    el("section", { class: "card", "aria-labelledby": "ws-members" }, [el("h2", { class: "card__title", id: "ws-members", text: "Members" }), membersBox]),
    el("section", { class: "card", "aria-labelledby": "ws-invite" }, [el("h2", { class: "card__title", id: "ws-invite", text: "Invite someone" }), inviteBox]),
    el("section", { class: "card card--full", "aria-labelledby": "ws-settings" }, [el("h2", { class: "card__title", id: "ws-settings", text: "Workspace settings" }), settingsBox]),
    el("section", { class: "card", "aria-labelledby": "ws-backups" }, [el("h2", { class: "card__title", id: "ws-backups", text: "Backups and restore" }), backupsBox]),
    el("section", { class: "card", "aria-labelledby": "ws-activity" }, [el("h2", { class: "card__title", id: "ws-activity", text: "Recent activity" }), auditBox]),
    el("section", { class: "card", "aria-labelledby": "ws-former" }, [el("h2", { class: "card__title", id: "ws-former", text: "Former members" }), formerBox]),
    el("section", { class: "card", "aria-labelledby": "ws-history" }, [el("h2", { class: "card__title", id: "ws-history", text: "Workspace changes" }), historyBox]),
  ])]);
  // "Layout & colours" (Terry's own suggested grouping): the real Layout Picker — a separate, richer control from
  // the plain "Layout theme" dropdown inside the Workspace settings card on General (which keeps
  // working; both change the same setting) — plus category colours/icons and type icons.
  const appearancePanel = panel("appearance", [el("div", { class: "stack" }, [
    el("section", { class: "card card--full", "aria-labelledby": "ws-layout" }, [el("h2", { class: "card__title", id: "ws-layout", text: "Layout" }), layoutPicker.element]),
    el("section", { class: "card card--full" }, [groupColours.element]),
    el("section", { class: "card", "aria-labelledby": "ws-types" }, [el("h2", { class: "card__title", id: "ws-types", text: "Icons for types" }), typesBox]),
  ])]);
  // "Categories & types" (item 6's specific focus): each manager already separates its compact
  // existing-items list from its own collapsed "+ Add …" creation form.
  const typesPanel = panel("types", [el("div", { class: "stack" }, [
    el("section", { class: "card card--full", "aria-labelledby": "ws-account-types" }, [el("h2", { class: "card__title", id: "ws-account-types", text: "Account types" }), accountTypeManager.element]),
    el("section", { class: "card card--full", "aria-labelledby": "ws-category-types" }, [el("h2", { class: "card__title", id: "ws-category-types", text: "Category types" }), categoryTypeManager.element]),
    el("section", { class: "card card--full", "aria-labelledby": "ws-merchant-types" }, [el("h2", { class: "card__title", id: "ws-merchant-types", text: "Merchant types" }), merchantTypeManager.element]),
  ])]);
  const pageBody = el("div", {}, [tablist, generalPanel, appearancePanel, typesPanel]);

  const bodyHost = el("div");
  const element = el("section", {}, [pageHead("Workspace"), bodyHost, deleteBox]);
  const classicArrangement = pageBody;
  const FLAGSHIP_IDS = new Set(["ledgerfly-forecast", "finexa-budget", "acru-overview"]);
  let mountedLayout = null;
  function arrangementFor(layoutId) {
    if (!FLAGSHIP_IDS.has(layoutId)) return classicArrangement;
    return el("div", { class: "dashflag", vars: layoutAccentVars(ctx.store.getState(), layoutId) }, [pageBody]);
  }

  const me = () => ((sliceFor(store.getState(), "members").data || {}).members || []).find((m) => m.self) || { role: "viewer" };

  // Workspace settings (Terry, 2026-09-14: "the user should be able to decide"), in the settings card
  // shared with the group settings (app/js/ui/settingsform.js; UX/accessibility review of eefd115).
  const form = createSettingsForm({
    id: "ws-set", storageKey: "bt.settingsGroups.workspace",
    // Leaving the page or closing the tab with unsaved changes asks first (finding 3).
    onDirtyChange: (dirty) => trackUnsaved("workspace-settings", "Workspace settings", dirty),
    onSave: async (changes, reason) => {
      const body = { settings: changes, ...(reason ? { reason } : {}) };
      const out = await store.actions.write((ws) => api.request("workspaces", { method: "PATCH", query: { id: ws }, body }), []);
      if (!out.ok) return { ok: false, error: out.error };
      // The app's copy of each workspace's setting values (the nav, defaults in forms) follows the change.
      if (store.actions.refreshWorkspaces) await store.actions.refreshWorkspaces();
      await loadInfo();
      return { ok: true, said: "Settings saved. Everyone in the workspace now works this way." };
    },
  });
  mount(settingsBox, form.element);

  async function loadInvites() {
    const role = me().role;
    if (role !== "owner" && role !== "manager") {
      mount(inviteBox, el("p", { class: "muted", text: "Owners and managers invite people. Ask one of them if someone should join." }));
      return;
    }
    const email = input({ type: "email", placeholder: "person@example.com", autocomplete: "off" });
    // The dropdowns on this page are TaskTracker's command picker (BT-004-05).
    const roleSel = pickerSelect(ROLES.filter((r) => role === "owner" || r.value !== "owner"), "member", {}, { search: false });
    // BT-009-15 (Terry's split-costs check, 2026-09-14): linking to an existing, not-already-joined
    // workspace contact, so the new member's shared-expense history continues from the contact's
    // once they accept — the contact record is kept, never rewritten (api/_shared/groups.js's
    // canonicalRef combines the two only in derived balances/history). Loaded fresh each time this
    // card renders, and again after sending an invitation, since a contact could join or be added
    // elsewhere between visits. Optional: an invitation with nothing chosen here behaves exactly as
    // before this feature existed.
    let joinableContacts = [];
    const NOT_LINKED = { value: "", label: "Not linked to a contact" };
    const contactSel = pickerSelect([NOT_LINKED], "", {}, { search: false });
    async function loadContactOptions() {
      try {
        const data = await api.request("contacts", { query: { workspaceId: wsId } });
        joinableContacts = (data.shared || []).filter((c) => !c.archived && !c.joinedMemberId);
        const wanted = contactSel.value;
        contactSel.replaceChildren(...[NOT_LINKED, ...joinableContacts.map((c) => ({ value: c.id, label: c.name }))].map((o) => el("option", { value: o.value, text: o.label })));
        contactSel.value = joinableContacts.some((c) => c.id === wanted) ? wanted : "";
      } catch { /* the picker just stays at "Not linked" — linking is optional, never required */ }
    }
    await loadContactOptions();
    const result = el("div", { "aria-live": "polite" });
    const pending = el("div");
    const send = button("Create invitation", async () => {
      mount(result);
      try {
        const out = await api.invite(wsId, { email: email.value, role: roleSel.value, ...(contactSel.value ? { contactId: contactSel.value } : {}) });
        const link = `${location.origin}/#/join?ws=${encodeURIComponent(wsId)}&token=${encodeURIComponent(out.token)}`;
        const linkField = input({ readonly: true, value: link });
        const linkedName = contactSel.value ? (joinableContacts.find((c) => c.id === contactSel.value) || {}).name : null;
        mount(result,
          el("p", { class: "notice", text: out.accessPreview.summary }),
          linkedName ? el("p", { class: "notice", text: `Once accepted, this continues ${linkedName}'s shared-expense history as the new member.` }) : null,
          field("Invitation link (shown once)", linkField, { help: "Share it only with that person. It works only for their Google account and expires in 7 days." }));
        linkField.select();
        await loadContactOptions();
        await renderPending();
      } catch (err) { mount(result, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
    }, { variant: "primary" });
    async function renderPending() {
      try {
        const data = await api.invitations(wsId);
        if (!data.invitations.length) { mount(pending, el("p", { class: "muted small", text: "No pending invitations." })); return; }
        const contactName = (id) => (joinableContacts.find((c) => c.id === id) || {}).name || null;
        mount(pending, el("ul", { class: "stack" }, data.invitations.map((i) => el("li", { class: "row" }, [
          el("span", { text: i.email }), badge(ROLE_LABEL[i.role] || i.role),
          i.contactId ? badge(`linking to ${contactName(i.contactId) || "a contact"}`, "source") : null,
          el("span", { class: "muted small", text: `until ${i.expiresAt.slice(0, 10)}` }),
          button("Cancel invitation", async () => {
            try { await api.request("invitations", { method: "DELETE", query: { workspaceId: wsId }, body: { invitationId: i.id } }); announce("Invitation cancelled."); await loadContactOptions(); await renderPending(); }
            catch (err) { mount(result, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
          }, { small: true, variant: "ghost" }),
        ]))));
      } catch (err) { mount(pending, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
    }
    mount(inviteBox, el("div", { class: "stack" }, [
      field("Email", email), field("Role", roleSel, { help: "No role can see members' private accounts." }),
      field("Link to an existing contact (optional)", contactSel, { help: "If this person already has a workspace contact, accepting continues that contact's shared-expense history as the new member." }),
      send, result, el("h3", { text: "Pending invitations" }), pending,
    ]));
    await renderPending();
  }

  async function loadBackups() {
    const role = me().role;
    if (role !== "owner" && role !== "manager") {
      mount(backupsBox, el("p", { class: "muted", text: "Owners and managers manage backups for this workspace." }));
      return;
    }
    const status = el("p", { class: "field__help", role: "status" });
    try {
      const data = await api.backups(wsId);
      const create = button("Create backup now", async () => {
        try { await api.createBackup(wsId); announce("Backup created."); await loadBackups(); } catch (err) { mount(status, el("span", { class: "error-text", text: messageFor(err) })); }
      }, { variant: "primary" });
      const last = data.archives[0];
      mount(backupsBox,
        el("p", { class: "small", text: last ? `Last backup: ${stamp(last.createdAt)} (${last.reason}).` : "No backups yet." }),
        el("p", { class: "field__help", text: data.policy }), create, status,
        el("ul", { class: "stack" }, data.archives.map((a) => el("li", { class: "row" }, [
          el("span", { text: stamp(a.createdAt) }), badge(a.reason), el("span", { class: "muted small", text: a.createdBySelf ? "You" : a.createdBy }),
          el("span", { class: "app__spacer" }), button("Restore…", () => openRestore(ctx, wsId, a), { small: true, attrs: { "aria-label": `Restore from ${stamp(a.createdAt)}` } }),
        ]))), restoreHistory());
    } catch (err) { mount(backupsBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
  }

  // Restores into this workspace and the records they set aside — kept, never deleted (BT-001-05
  // A7). The server shows only records the viewer could see; loaded when opened.
  const MODE_LABEL = { replace: "Replace", merge: "Merge" };
  const COLLECTION_LABEL = { transactions: "Entry", accounts: "Account", payees: "Merchant", categories: "Category", contacts: "Contact", recurring: "Bill", budgets: "Budget" };
  function restoreHistory() {
    const box = el("div");
    const details = el("details", { class: "more" }, [el("summary", { text: "Restore history and records set aside" }), box]);
    details.addEventListener("toggle", async () => {
      if (!details.open) return;
      mount(box, el("p", { class: "muted small", role: "status", text: "Loading…" }));
      try {
        const data = await api.restoreHistory(wsId);
        const describeRecord = (s) => (s.collection === "transactions" ? `${s.summary.date} ${s.summary.amount} ${s.summary.currency}` : s.summary.name || "");
        mount(box,
          data.restores.length ? el("ul", { class: "history-list small" }, data.restores.slice().reverse().map((r) => el("li", { text: `${stamp(r.at)} · ${r.by} · ${MODE_LABEL[r.mode] || r.mode}${r.setAside !== null ? ` · ${r.setAside} set aside` : ""}` })))
            : el("p", { class: "muted small", text: "No restores into this workspace yet." }),
          data.setAside.length ? el("ul", { class: "history-list small" }, data.setAside.slice().reverse().map((s) => el("li", {
            text: `${COLLECTION_LABEL[s.collection] || s.collection}: ${describeRecord(s)} — ${s.reason === "not-in-backup" ? "created after the backup" : "replaced by the backup's version"} (${stamp(s.at)}, ${s.by})`,
          }))) : null);
      } catch (err) { mount(box, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
    });
    return details;
  }

  async function loadAudit() {
    try {
      const data = await api.audit(wsId);
      if (!data.entries.length) { mount(auditBox, el("p", { class: "muted small", text: "No activity yet." })); return; }
      mount(auditBox, el("ul", { class: "stack small" }, data.entries.slice(0, 25).map((e) => el("li", {}, [
        el("span", { class: "muted", text: `${stamp(e.at)} · ` }), el("strong", { text: e.actorSelf ? "You" : e.actor }), ` ${describe(e.action)}`,
      ]))));
    } catch (err) { mount(auditBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
  }

  // Former members and every membership change, for owners and managers (audit B15, D6).
  const describeMember = (h) => {
    if (h.event === "role") return `role ${ROLE_LABEL[h.from] || h.from} → ${ROLE_LABEL[h.to] || h.to}`;
    if (h.event === "rejoined") return `rejoined as ${ROLE_LABEL[h.to] || h.to}`;
    if (h.event === "allowance") return h.from === undefined ? "storage allowance changed" : `storage allowance ${sizeLabel(h.from)} → ${sizeLabel(h.to)}`;
    return `${MEMBER_EVENTS[h.event] || h.event}${h.reason ? ` — ${h.reason}` : ""}`;
  };
  async function loadFormer() {
    const role = me().role;
    if (role !== "owner" && role !== "manager") { mount(formerBox, el("p", { class: "muted", text: "Owners and managers can see former members and membership history." })); return; }
    try {
      const data = await api.request("members", { query: { workspaceId: wsId, includeFormer: "1" } });
      mount(formerBox, data.former.length ? el("ul", { class: "stack" }, data.former.map((m) => el("li", {}, [
        el("div", { class: "row" }, [el("strong", { text: m.name }), badge(ROLE_LABEL[m.role] || m.role), m.removedAt ? el("span", { class: "muted small", text: `since ${stamp(m.removedAt)}` }) : null]),
        el("ul", { class: "history-list small" }, (m.history || []).slice().reverse().map((h) => el("li", { text: `${stamp(h.at)} · ${h.by}: ${describeMember(h)}` }))),
      ]))) : el("p", { class: "muted small", text: "Nobody has left this workspace." }));
    } catch (err) { mount(formerBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
  }

  // The workspace itself, read once: its settings and their history (everyone) and its full change
  // history (owners and managers).
  async function loadInfo() {
    try {
      const { workspace } = await api.request("workspaces", { query: { id: wsId } });
      renderSettings(workspace);
      renderHistory(workspace);
    } catch (err) {
      mount(settingsBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) }));
      mount(historyBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) }));
    }
  }

  // Changes to the workspace's name and settings, and its archive/restore log (audit B16). Settings are
  // named and valued as in the settings card.
  function renderHistory(workspace) {
    const role = me().role;
    if (role !== "owner" && role !== "manager") { mount(historyBox, el("p", { class: "muted", text: "Owners and managers can see the workspace's change history." })); return; }
    const list = workspace.settingsList || [];
    const settingOf = (fieldName) => (fieldName.startsWith("settings.") ? list.find((s) => s.key === fieldName.slice(9)) : null);
    const show = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
    const change = (c) => {
      const s = settingOf(c.field);
      return s ? `${s.label} ${settingText(s, c.from)} → ${settingText(s, c.to)}` : `${WS_FIELDS[c.field] || c.field} ${show(c.from)} → ${show(c.to)}`;
    };
    const items = [
      ...(workspace.history || []).map((h) => ({ at: h.at, text: `${h.by}: ${h.changes.map(change).join("; ")}${h.reason ? ` — ${h.reason}` : ""}` })),
      ...(workspace.lifecycle || []).map((h) => ({ at: h.at, text: `${h.by}: ${h.state === "archived" ? "archived the workspace" : "restored the workspace"}${h.reason ? ` — ${h.reason}` : ""}` })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    mount(historyBox, items.length ? el("ul", { class: "history-list small" }, items.map((i) => el("li", { text: `${stamp(i.at)} · ${i.text}` })))
      : el("p", { class: "muted small", text: "No changes to the workspace's name or settings yet." }));
  }

  // The settings and their history, from the one list; everyone reads the history (decision 6).
  function renderSettings(workspace) {
    const list = workspace.settingsList || [];
    const byKey = new Map(list.map((s) => [s.key, s]));
    const show = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
    const history = (workspace.settingsHistory || []).map((h) => ({
      when: stamp(h.at), by: h.by, reason: h.reason || "",
      text: (h.changes || []).map((c) => {
        const s = byKey.get(String(c.field).slice("settings.".length));
        return s ? `${s.label}: ${settingText(s, c.from)} → ${settingText(s, c.to)}` : `${WS_FIELDS[c.field] || c.field}: ${show(c.from)} → ${show(c.to)}`;
      }).join("; "),
    }));
    form.render({ settings: list, history, intro: list.some((s) => s.canChange) ? INTRO_CHANGE : INTRO_READ });
    // Opened from a link that names a setting (the Shared expenses "off" page, finding 9): focus on it,
    // with its group open, once.
    if (!linkedFocusDone && ctx.params && ctx.params.setting) linkedFocusDone = form.focusSetting(ctx.params.setting);
  }
  let linkedFocusDone = false;

  // Workspace category colours (BT-011-04): owners and managers choose them; everyone sees them.
  // Each member may still pick personal colours in My settings.
  let colourSig = "";
  function renderColours(state) {
    const data = sliceFor(state, "categories").data;
    if (!data || !sliceFor(state, "members").data) return;
    // Categories are a shared list (workspace setting "Who manages shared lists"); the server decides.
    const canEdit = ["owner", "manager"].includes(me().role) || (me().role === "member" && managesSharedLists(state));
    const cats = data.categories.filter((c) => !c.archived);
    const iconsData = sliceFor(state, "icons").data;
    const sig = JSON.stringify([cats.map((c) => [c.id, c.name, c.color, c.colorSource, c.icon, c.iconSource]), canEdit, iconsData ? iconsData.catalog : null]);
    if (sig === colourSig) return;
    colourSig = sig;
    // A useful summary even while collapsed (BT-021, Terry: "keep... useful summaries visible when
    // collapsed"): how many categories, and whether any already has a workspace-chosen colour/icon.
    const customCount = cats.filter((c) => c.colorSource === "workspace" || (c.iconSource === "workspace" && c.icon)).length;
    groupColours.setSummary(`${cats.length} categor${cats.length === 1 ? "y" : "ies"}${customCount ? `, ${customCount} customized` : ""}`);
    if (!canEdit) {
      mount(coloursBox, el("p", { class: "field__help", text: "Owners and managers choose these. You can pick your own colours and icons in My settings." }),
        el("ul", { class: "stack" }, cats.map((c) => el("li", {}, [categoryLabel(c.name, c.color, c.icon)]))));
      return;
    }
    // Focus returns to the same picker (colour or icon) of the same category after a save.
    const active = document.activeElement;
    const focused = active && coloursBox.contains(active) && active.closest ? active.closest("[data-category]") : null;
    const focusId = focused ? focused.dataset.category : null;
    const focusIndex = focused ? [...focused.querySelectorAll(".themepick__toggle")].indexOf(active) : -1;
    const rows = cats.map((c) => {
      const labelId = `ws-colour-${c.id}`;
      // A failed save puts the previous colour back and says so beside the picker (A11Y2-006).
      const error = el("p", { class: "error-text small", role: "alert", hidden: true });
      let picker = null;
      const patchColour = async (color) => {
        const out = await store.actions.write((ws) => api.request("categories", { method: "PATCH", query: { workspaceId: ws }, body: { categoryId: c.id, color } }), ["categories"]);
        if (out.ok) { announce(`${c.name}: colour ${color ? "saved" : "reset to default"}.`); return; }
        if (picker) picker.select(c.color);
        error.textContent = messageFor(out.error);
        error.hidden = false;
      };
      picker = createThemePicker({
        value: c.color, entries: colourEntries(data.palette, c.color), labelledBy: labelId,
        listLabel: `Colours for ${c.name}`, namePrefix: `${c.name} colour`, onPick: (hex) => { void patchColour(hex); },
      });
      // The category icon (BT-011-05): same rules as the colour; "Default" is the icon it was created with.
      const chosenIcon = c.iconSource === "workspace" ? c.icon : null;
      const iconPick = createIconPicker({
        value: chosenIcon, inherited: c.defaultIcon, name: c.name, label: "Icon", tint: c.color,
        onPick: async (id) => {
          const out = await store.actions.write((ws) => api.request("categories", { method: "PATCH", query: { workspaceId: ws }, body: { categoryId: c.id, icon: id || null } }), ["categories"]);
          if (out.ok) { announce(`${c.name}: icon ${id ? "saved" : "reset to default"}.`); return; }
          iconPick.select(chosenIcon);
          error.textContent = messageFor(out.error);
          error.hidden = false;
        },
      });
      // One compact row per category, named by a heading and grouped, so the list scans quickly
      // (UXI-3); the colour and icon pickers sit side by side on wide screens.
      return el("div", { class: "catrow", role: "group", "aria-labelledby": `${labelId}-name`, dataset: { category: c.id } }, [
        el("h3", { class: "catrow__name", id: `${labelId}-name` }, [categoryLabel(c.name, c.color, c.icon)]),
        el("div", { class: "field" }, [el("p", { class: "field__label", id: labelId, text: "Colour" }), picker.element]),
        iconPick.element, error,
        el("div", { class: "row catrow__meta" }, [badge(c.colorSource === "workspace" ? "Workspace colour" : "Default colour", "source"),
          c.colorSource === "workspace" ? button("Reset to default", () => { void patchColour(null); }, { small: true, variant: "ghost", attrs: { "aria-label": `Reset to default: ${c.name} colour` } }) : null,
          badge(chosenIcon ? "Workspace icon" : "Default icon", "source")]),
      ]);
    });
    mount(coloursBox, el("p", { class: "field__help", text: "Everyone in the workspace sees these colours and icons unless they pick their own in My settings. Colours are checked so they stay visible on light and dark backgrounds. Renaming or archiving a category keeps its colour and icon." }), ...rows);
    if (focusId) {
      const row = rows.find((r) => r.dataset.category === focusId);
      const toggles = row ? [...row.querySelectorAll(".themepick__toggle")] : [];
      const toggle = toggles[Math.max(0, focusIndex)];
      if (toggle) toggle.focus();
    }
  }

  // Icons for the workspace's account, bill and merchant types (BT-011-05). Owners and managers
  // choose; everyone else sees the result. Each group is collapsed so the card stays short.
  let typesSig = "";
  const openGroups = new Set();
  function renderTypes(state) {
    const data = sliceFor(state, "icons").data;
    if (!data) return;
    const typeIcons = data.typeIcons || {};
    const canEdit = !!data.canEditTypeIcons;
    const sig = JSON.stringify([typeIcons, canEdit, data.catalog]);
    if (sig === typesSig) return;
    typesSig = sig;
    const active = document.activeElement;
    const focusKey = active && typesBox.contains(active) && active.closest && active.closest("[data-type-key]") ? active.closest("[data-type-key]").dataset.typeKey : null;
    const groups = TYPE_GROUPS.map((g) => {
      const items = Object.entries(g.labels).map(([type, label]) => {
        const key = `${g.kind}.${type}`;
        const inherited = builtInIconFor(g.kind, type);
        if (!canEdit) return el("li", {}, [withIcon(typeIcons[key] || inherited, label)]);
        const error = el("p", { class: "error-text small", role: "alert", hidden: true });
        const pick = createIconPicker({
          value: typeIcons[key] || null, inherited, name: label, label: `${label} icon`,
          onPick: async (id) => {
            const out = await store.actions.write((ws) => api.updateTypeIcons(ws, { [key]: id || null }), ["icons", "accounts", "payees", "bills"]);
            if (out.ok) { announce(`${label}: icon ${id ? "saved" : "reset to default"}.`); return; }
            pick.select(typeIcons[key] || null);
            error.textContent = messageFor(out.error);
            error.hidden = false;
          },
        });
        return el("div", { dataset: { typeKey: key } }, [pick.element, error]);
      });
      const details = el("details", { class: "more" }, [el("summary", { text: g.title }), canEdit ? el("div", { class: "icon-grid icon-grid--wide" }, items) : el("ul", { class: "stack" }, items)]);
      if (openGroups.has(g.kind)) details.open = true;
      details.addEventListener("toggle", () => { if (details.open) openGroups.add(g.kind); else openGroups.delete(g.kind); });
      return details;
    });
    mount(typesBox, el("p", { class: "field__help", text: canEdit
      ? "Accounts, bills and merchants of each type show this icon unless someone chose one for the record itself."
      : "Owners and managers choose these. Accounts, bills and merchants of each type show this icon unless one was chosen for the record." }), ...groups);
    if (focusKey) {
      const toggle = typesBox.querySelector(`[data-type-key="${focusKey}"] .themepick__toggle`);
      if (toggle) toggle.focus();
    }
  }

  let loaded = false;
  let lastMembers = null;
  // Each member's role and allowance pickers, by member, so focus can follow a re-render.
  let memberControls = {};
  function update(state) {
    const ws = (state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId);
    const layoutId = effectiveLayoutId(state, ws);
    if (mountedLayout !== layoutId) { mount(bodyHost, arrangementFor(layoutId)); mountedLayout = layoutId; }
    renderColours(state);
    accountTypeManager.render(state);
    categoryTypeManager.render(state);
    merchantTypeManager.render(state);
    renderTypes(state);
    const members = sliceFor(state, "members");
    const s = stateView(members);
    if (s) { mount(membersBox, s); return; }
    const role = me().role;
    const owners = members.data.members.filter((m) => m.role === "owner").length;
    // A change re-renders the list; the member control that had focus gets it back on its new picker
    // instead of focus leaving the page with the old one (A11Y2-001's rule; BT-004-05).
    const active = document.activeElement;
    const focusKey = Object.keys(memberControls).find((k) => controlElement(memberControls[k]).contains(active)) || null;
    memberControls = {};
    mount(membersBox, el("ul", { class: "stack" }, members.data.members.map((m) => {
      const soleOwner = m.role === "owner" && owners <= 1;
      let roleControl;
      if (role === "owner" && !soleOwner) {
        // Commits only on an explicit choice (A11Y-002), and making someone an owner asks first.
        // Named by its aria-label ("Role for Bob"), since it sits in the row without a field label.
        roleControl = pickerSelect(ROLES, m.role, { "aria-label": `Role for ${m.name}` }, { search: false });
        memberControls[`${m.id}:role`] = roleControl;
        const change = async (value) => {
          const out = await store.actions.write((ws) => api.request("members", { method: "PATCH", query: { workspaceId: ws }, body: { memberId: m.id, role: value } }), ["members"]);
          if (!out.ok) { committer.reset(m.role); announce(messageFor(out.error)); } else announce(`${m.name} is now ${ROLE_LABEL[value]}.`);
          return out;
        };
        const committer = commitOnConfirm(roleControl, (value) => {
          if (value !== "owner") { void change(value); return; }
          // Show the current role until the promotion is confirmed; a confirmed change re-renders.
          committer.reset(m.role);
          confirmModal({
            title: `Make ${m.name} an owner?`, message: "Owners manage members, shared accounts and backups. Owners still cannot see anyone's private accounts.",
            confirmLabel: "Make owner", onConfirm: () => change(value),
          });
        });
      } else {
        // Read-only roles are text, not a greyed-out control that looks broken (UX-010).
        roleControl = el("span", { class: "badge", text: ROLE_LABEL[m.role] || m.role, title: soleOwner ? "A workspace always keeps at least one owner." : null });
      }
      // Owners set each member's storage allowance; only the member sees how much of it they use,
      // because that reflects their private records too (Terry, 2026-09-13; SEC-V3).
      let allowanceControl = null;
      if (role === "owner" && m.role !== "owner" && m.allowanceBytes) {
        const steps = ALLOWANCE_MB.map((v) => ({ value: String(v), label: `${v} MB` }));
        const current = m.allowanceBytes % MB === 0 && ALLOWANCE_MB.includes(m.allowanceBytes / MB) ? String(m.allowanceBytes / MB) : "";
        allowanceControl = pickerSelect(current ? steps : [{ value: "", label: sizeLabel(m.allowanceBytes) }, ...steps], current, { "aria-label": `Storage allowance for ${m.name}` }, { search: false });
        memberControls[`${m.id}:allowance`] = allowanceControl;
        const allowanceCommit = commitOnConfirm(allowanceControl, async (value) => {
          if (!value) return;
          const out = await store.actions.write((ws) => api.request("members", { method: "PATCH", query: { workspaceId: ws }, body: { memberId: m.id, allowanceMb: Number(value) } }), ["members"]);
          if (!out.ok) { allowanceCommit.reset(current); announce(messageFor(out.error)); } else announce(`${m.name} can now store up to ${value} MB in this workspace.`);
        });
      }
      const usage = m.self && m.usedBytes !== undefined && m.allowanceBytes
        ? el("span", { class: "muted small", text: `Your storage: ${sizeLabel(m.usedBytes)} of ${sizeLabel(m.allowanceBytes)}` }) : null;
      const canRemove = !soleOwner && (role === "owner" || m.self);
      const remove = canRemove ? button(m.self ? "Leave workspace" : "Remove", () => confirmModal({
        title: m.self ? "Leave this workspace?" : `Remove ${m.name}?`,
        message: m.self
          ? "You lose access to its shared accounts. Access you gave or received on private accounts ends. Your past entries keep your name."
          : "Their access, and any access they gave or received on private accounts, ends now. Their past entries keep their name.",
        confirmLabel: m.self ? "Leave" : "Remove", danger: true,
        onConfirm: () => store.actions.write((ws) => api.request("members", { method: "DELETE", query: { workspaceId: ws }, body: { memberId: m.id } }), ["members", "accounts"]),
      }), { small: true, variant: "danger" }) : null;
      return el("li", { class: "row" }, [
        el("strong", { text: m.name }), m.self ? badge("you") : null, m.email ? el("span", { class: "muted small", text: m.email }) : null,
        // BT-009-15: a member who was previously a contact — their shared-expense history from
        // before joining already continues into their own, combined balance; this just says so.
        m.joinedFromContactName ? el("span", { class: "muted small", text: `(was contact: ${m.joinedFromContactName})` }) : null,
        // A visible label: two unlabelled dropdowns side by side read as one choice (preview check, 2026-09-14).
        el("span", { class: "app__spacer" }), usage, allowanceControl ? el("label", { class: "row small" }, [el("span", { class: "muted", text: "Storage" }), controlElement(allowanceControl)]) : null, controlElement(roleControl), remove,
      ]);
    })));
    // An enhanced select's focus() lands on its trigger.
    if (focusKey && memberControls[focusKey]) memberControls[focusKey].focus();
    if (!loaded) { loaded = true; void loadInvites(); void loadBackups(); void loadAudit(); void loadInfo(); void layoutPicker.load(); }
    // A removal, role change or rejoin changes the members list; the former members reload with it.
    if (members.data !== lastMembers) { lastMembers = members.data; void loadFormer(); }
    renderDelete(state, role);
  }

  // "Delete workspace" (owners only). Built only when this person owns the current workspace, so the
  // card and its button do not exist in the DOM for anyone else (not merely hidden).
  let deleteSig = "";
  function renderDelete(state, role) {
    const workspace = (state.workspaces || []).find((w) => w.id === wsId);
    const owner = role === "owner" && !!workspace;
    const sig = JSON.stringify([owner, workspace ? workspace.name : null]);
    if (sig === deleteSig) return;
    deleteSig = sig;
    if (!owner) { mount(deleteBox); return; }
    mount(deleteBox,
      el("section", { class: "card card--danger", "aria-labelledby": "ws-delete" }, [
        el("h2", { class: "card__title", id: "ws-delete", text: "Delete workspace" }),
        el("p", { class: "field__help", text: "Everyone in this workspace loses access. It can be brought back from Deleted workspaces in My settings." }),
        button("Delete workspace…", () => { openDeleteDialog(ctx, workspace); }, { variant: "danger" }),
      ]),
      // BT-014-04: an UNMISTAKABLY distinct action from "Delete workspace" above — this one has no
      // undo, no "Bring back". Different heading, wording, icon and a stronger border/background
      // (flagged by the backend implementer as a terminology-confusion risk to avoid).
      el("section", { class: "card card--danger card--danger-permanent", "aria-labelledby": "ws-delete-permanent" }, [
        el("h2", { class: "card__title", id: "ws-delete-permanent" }, [withIcon("alert", "Permanently delete workspace (cannot be undone)")]),
        el("p", { class: "field__help", text: "This is not the recoverable action above. Once confirmed, this workspace and everything in it are gone for good — no \"Bring back\". You can take a backup first." }),
        button("Permanently delete workspace…", () => { openWorkspacePermanentDeleteDialog(ctx, { wsId: workspace.id, onDeleted: () => { if (ctx.navigate) ctx.navigate("dashboard"); } }); }, { variant: "danger" }),
      ]));
  }
  // Leaving the page (the shell asked first) forgets the card's unsaved mark.
  return { element, update, destroy: () => form.destroy() };
}

function openRestore(ctx, wsId, archive) {
  const mode = pickerSelect([
    { value: "merge", label: "Merge — add missing records, keep current ones" },
    { value: "create-new", label: "Create a new workspace from this backup" },
    { value: "replace", label: "Replace — roll my records back to this backup" },
  ], "merge", {}, { search: false });
  const summary = el("div", { "aria-live": "polite" });
  // Restore stays unavailable until a preview has shown what would change; say so instead of
  // leaving a disabled button unexplained (Terry's preview check, 2026-09-13).
  const previewFirst = () => mount(summary, el("p", { class: "field__help", id: "restore-preview-hint", text: "Choose what should happen, then select Preview. Restore becomes available once the preview has shown what will change." }));
  previewFirst();
  const confirmText = input({ placeholder: "Type REPLACE to confirm", hidden: true, "aria-label": "Type REPLACE to confirm" });
  // Merge can also bring back entries deleted since the backup; off unless chosen (Terry, 2026-09-13).
  const restoreDeleted = el("input", { type: "checkbox" });
  const restoreDeletedRow = el("label", { class: "row small" }, [restoreDeleted, el("span", { text: "Also bring back entries deleted since this backup" })]);
  const withOption = (body) => (mode.value === "merge" && restoreDeleted.checked ? { ...body, restoreDeleted: true } : body);
  let previewData = null;
  const key = newIdempotencyKey();
  const preview = button("Preview", async () => {
    modal.setError("");
    try {
      previewData = await ctx.api.previewRestore(withOption({ workspaceId: wsId, archiveId: archive.archiveId, mode: mode.value }));
      execute.disabled = !previewData.canExecute;
      confirmText.hidden = mode.value !== "replace";
      mount(summary,
        el("p", { class: "notice", text: `Preview only — nothing has changed. In your scope: ${previewData.scope.accounts} accounts, ${previewData.scope.transactions} entries. Changes: ${previewData.changes.add} added, ${previewData.changes.update} updated, ${previewData.changes.remove} taken out of the lists.${previewData.excluded.setAside ? ` ${previewData.excluded.setAside} current records are set aside and kept in the workspace history — nothing is deleted.` : ""}` }),
        // Merge only adds records that no longer exist. Nothing is ever deleted, so an entry edited or
        // deleted since the backup still exists and is kept as it is now; say so, and point to
        // Replace, which rolls those back (Terry's preview check, 2026-09-13).
        previewData.excluded.conflictsSkipped ? el("p", { class: "small", text: `${previewData.excluded.conflictsSkipped} ${previewData.excluded.conflictsSkipped === 1 ? "record differs" : "records differ"} from the backup (for example entries edited or deleted since). Merge keeps your current versions; to roll them back, deletions included, choose Replace.` }) : null,
        previewData.excluded.deletedRestored ? el("p", { class: "small", text: `${previewData.excluded.deletedRestored} deleted ${previewData.excluded.deletedRestored === 1 ? "entry is" : "entries are"} brought back, each keeping its history.` }) : null,
        previewData.nothingToRestore ? el("p", { class: "notice notice--warning", text: mode.value === "merge" ? "Nothing to merge: every record in this backup that you can restore still exists here, so Restore is not available. To undo edits or deletions made since the backup, choose Replace." : "Nothing to restore: what you can restore already matches this backup." }) : null,
        el("p", { class: "small", text: `Totals after: ${previewData.totalsAfter.map((t) => `${t.currency} ${t.amount}`).join(", ") || "none"}` }),
        previewData.excluded.otherMembersPrivateRecords ? el("p", { class: "small muted", text: "Other members' private records are outside your restore and stay as they are." }) : null,
        el("p", { class: "small muted", text: previewData.permissions }),
        ...previewData.warnings.map((w) => el("p", { class: "notice notice--warning", text: w })),
        ...previewData.blockers.map((b) => el("p", { class: "error-text", role: "alert", text: b })));
    } catch (err) { modal.setError(err); }
  });
  const execute = button("Restore", async () => {
    modal.setError("");
    if (!previewData) return;
    if (mode.value === "replace" && confirmText.value !== "REPLACE") { modal.setError("Type REPLACE to confirm replacing your records."); return; }
    modal.setBusy(true);
    try {
      const body = withOption({ workspaceId: wsId, archiveId: archive.archiveId, mode: mode.value });
      if (mode.value !== "create-new") body.expectedEtag = previewData.expectedEtag;
      if (mode.value === "replace") body.confirm = "REPLACE";
      const out = await ctx.api.executeRestore(body, key);
      modal.setBusy(false);
      announce("Restore completed.");
      modal.close();
      if (out.workspace) {
        const list = await ctx.api.workspaces();
        void list;
        await ctx.store.actions.init();
        await ctx.store.actions.selectWorkspace(out.workspace.id);
      } else await ctx.store.actions.selectWorkspace(wsId);
    } catch (err) {
      modal.setBusy(false);
      modal.setError(err.code === "stale_preview" ? "The workspace changed since the preview. Preview again, then restore." : err);
    }
  }, { variant: "danger", attrs: { disabled: true, "aria-describedby": "restore-preview-hint" } });
  // A styled hint on hover while Restore is unavailable (Terry, 2026-09-13).
  const executeTip = el("span", { class: "tip", "data-tip": "Select Preview first. Restore becomes available once the preview has shown what will change." }, [execute]);
  const resetPreview = () => { previewData = null; execute.disabled = true; previewFirst(); confirmText.hidden = true; };
  mode.addEventListener("change", () => { restoreDeletedRow.hidden = mode.value !== "merge"; resetPreview(); });
  restoreDeleted.addEventListener("change", resetPreview);
  const modal = openModal({
    title: `Restore from ${stamp(archive.createdAt)}`,
    body: [field("What should happen", mode), restoreDeletedRow, summary, confirmText],
    actions: [button("Cancel", () => modal.close()), preview, executeTip],
  });
}
