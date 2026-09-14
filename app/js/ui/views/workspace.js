// Workspace administration: members and roles, invitations (with an access preview and a one-time
// link), backups and restores (preview first, errors in the modal, replace needs typed
// confirmation, last successful backup shown), and recent activity in plain language. Every
// control is presentation; the server enforces.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, field, input, pickerSelect, controlElement, button, badge, commitOnConfirm, categoryLabel, uid } from "../components.js";
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

// A workspace setting's value in words (Terry, 2026-09-14): On/Off, the chosen option's label, a number,
// or the chosen kinds. An unknown value is shown as it is.
export function settingText(s, v) {
  if (s.type === "boolean") return v === true ? "On" : v === false ? "Off" : String(v);
  if (s.type === "integer") return String(v);
  const labelOf = (x) => { const o = (s.options || []).find((y) => y.value === x); return o ? o.label : String(x); };
  if (s.type === "set") return Array.isArray(v) && v.length ? v.map(labelOf).join(", ") : "None";
  return labelOf(v);
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
  const coloursBox = el("div", { class: "stack" });
  const typesBox = el("div", { class: "stack" });
  const element = el("section", {}, [
    pageHead("Workspace"),
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "ws-members" }, [el("h2", { class: "card__title", id: "ws-members", text: "Members" }), membersBox]),
      el("section", { class: "card", "aria-labelledby": "ws-invite" }, [el("h2", { class: "card__title", id: "ws-invite", text: "Invite someone" }), inviteBox]),
      el("section", { class: "card card--full", "aria-labelledby": "ws-settings" }, [el("h2", { class: "card__title", id: "ws-settings", text: "Workspace settings" }), settingsBox]),
      el("section", { class: "card", "aria-labelledby": "ws-backups" }, [el("h2", { class: "card__title", id: "ws-backups", text: "Backups and restore" }), backupsBox]),
      el("section", { class: "card", "aria-labelledby": "ws-activity" }, [el("h2", { class: "card__title", id: "ws-activity", text: "Recent activity" }), auditBox]),
      el("section", { class: "card", "aria-labelledby": "ws-former" }, [el("h2", { class: "card__title", id: "ws-former", text: "Former members" }), formerBox]),
      el("section", { class: "card", "aria-labelledby": "ws-history" }, [el("h2", { class: "card__title", id: "ws-history", text: "Workspace changes" }), historyBox]),
      el("section", { class: "card card--full", "aria-labelledby": "ws-colours" }, [el("h2", { class: "card__title", id: "ws-colours", text: "Category colours and icons" }), coloursBox]),
      el("section", { class: "card", "aria-labelledby": "ws-types" }, [el("h2", { class: "card__title", id: "ws-types", text: "Icons for types" }), typesBox]),
    ]),
  ]);

  const me = () => ((sliceFor(store.getState(), "members").data || {}).members || []).find((m) => m.self) || { role: "viewer" };

  async function loadInvites() {
    const role = me().role;
    if (role !== "owner" && role !== "manager") {
      mount(inviteBox, el("p", { class: "muted", text: "Owners and managers invite people. Ask one of them if someone should join." }));
      return;
    }
    const email = input({ type: "email", placeholder: "person@example.com", autocomplete: "off" });
    // The dropdowns on this page are TaskTracker's command picker (BT-004-05).
    const roleSel = pickerSelect(ROLES.filter((r) => role === "owner" || r.value !== "owner"), "member", {}, { search: false });
    const result = el("div", { "aria-live": "polite" });
    const pending = el("div");
    const send = button("Create invitation", async () => {
      mount(result);
      try {
        const out = await api.invite(wsId, { email: email.value, role: roleSel.value });
        const link = `${location.origin}/#/join?ws=${encodeURIComponent(wsId)}&token=${encodeURIComponent(out.token)}`;
        const linkField = input({ readonly: true, value: link });
        mount(result,
          el("p", { class: "notice", text: out.accessPreview.summary }),
          field("Invitation link (shown once)", linkField, { help: "Share it only with that person. It works only for their Google account and expires in 7 days." }));
        linkField.select();
        await renderPending();
      } catch (err) { mount(result, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
    }, { variant: "primary" });
    async function renderPending() {
      try {
        const data = await api.invitations(wsId);
        if (!data.invitations.length) { mount(pending, el("p", { class: "muted small", text: "No pending invitations." })); return; }
        mount(pending, el("ul", { class: "stack" }, data.invitations.map((i) => el("li", { class: "row" }, [
          el("span", { text: i.email }), badge(ROLE_LABEL[i.role] || i.role), el("span", { class: "muted small", text: `until ${i.expiresAt.slice(0, 10)}` }),
          button("Cancel invitation", async () => {
            try { await api.request("invitations", { method: "DELETE", query: { workspaceId: wsId }, body: { invitationId: i.id } }); announce("Invitation cancelled."); await renderPending(); }
            catch (err) { mount(result, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
          }, { small: true, variant: "ghost" }),
        ]))));
      } catch (err) { mount(pending, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
    }
    mount(inviteBox, el("div", { class: "stack" }, [field("Email", email), field("Role", roleSel, { help: "No role can see members' private accounts." }), send, result, el("h3", { text: "Pending invitations" }), pending]));
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

  // The workspace itself, read once: its settings (everyone) and its change history (owners and
  // managers). `saved` re-renders after a save with focus back on Save and the result beside it.
  async function loadInfo({ saved = false } = {}) {
    try {
      const { workspace } = await api.request("workspaces", { query: { id: wsId } });
      renderSettings(workspace, { saved });
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

  // Workspace settings (Terry, 2026-09-14: "the user should be able to decide"): every setting from the
  // server's one list, grouped, each with its plain explanation. Dropdowns are the command picker
  // (BT-004-05); a list of kinds is a set of checkboxes. The server decides who may change what; a
  // setting this person may not change is shown as text with who can. Save sends only what changed.
  function settingControl(s) {
    const who = s.changedBy === "owner" ? "Only owners change this." : "Owners and managers change this.";
    // Shared expenses switched off for the whole site stay off here, whatever the workspace says.
    const siteNote = s.offForSite ? " The site administrator has turned this off for the whole site, so it stays off here for now." : "";
    if (!s.canChange) {
      return { s, read: () => s.value, node: el("div", { class: "field field--wide" }, [
        el("p", { class: "field__label", text: s.label }),
        el("p", { text: settingText(s, s.value) }),
        el("p", { class: "field__help", text: `${s.explanation}${siteNote} ${who}` }),
      ]) };
    }
    if (s.type === "set") {
      const boxes = (s.options || []).map((o) => { const box = el("input", { type: "checkbox", id: uid("wset") }); box.checked = Array.isArray(s.value) && s.value.includes(o.value); return [o, box]; });
      return { s, read: () => boxes.filter(([, b]) => b.checked).map(([o]) => o.value), node: el("fieldset", { class: "plain-fieldset field--wide" }, [
        el("legend", { class: "field__label", text: s.label }),
        ...boxes.map(([o, b]) => el("div", { class: "field--inline" }, [b, el("label", { for: b.id, text: o.label })])),
        el("p", { class: "field__help", text: s.explanation }),
      ]) };
    }
    const options = s.type === "boolean" ? [{ value: "true", label: "On" }, { value: "false", label: "Off" }]
      : s.type === "integer" ? Array.from({ length: s.max - s.min + 1 }, (_, i) => ({ value: String(s.min + i), label: String(s.min + i) }))
        : (s.options || []).map((o) => ({ value: String(o.value), label: o.label }));
    const pick = pickerSelect(options, String(s.value));
    const read = () => (s.type === "boolean" ? pick.value === "true"
      : s.type === "integer" ? Number(pick.value)
        : ((s.options || []).find((o) => String(o.value) === pick.value) || { value: s.value }).value);
    return { s, read, node: field(s.label, pick, { help: `${s.explanation}${siteNote}`, wide: true }) };
  }

  function renderSettings(workspace, { saved = false } = {}) {
    const list = workspace.settingsList || [];
    if (!list.length) { mount(settingsBox, el("p", { class: "muted", text: "There are no workspace settings to show." })); return; }
    const controls = list.map(settingControl);
    const groups = [];
    for (const c of controls) {
      let g = groups.find((x) => x.name === c.s.group);
      if (!g) { g = { name: c.s.group, items: [] }; groups.push(g); }
      g.items.push(c.node);
    }
    const changeable = controls.some((c) => c.s.canChange);
    const reason = input({ maxlength: "200", placeholder: "Optional", autocomplete: "off" });
    const status = el("p", { class: "field__help", role: "status", text: saved ? "Saved. Everyone in the workspace now works this way." : "" });
    const save = button("Save workspace settings", async () => {
      const changes = Object.fromEntries(controls.filter((c) => c.s.canChange && JSON.stringify(c.read()) !== JSON.stringify(c.s.value)).map((c) => [c.s.key, c.read()]));
      if (!Object.keys(changes).length) { status.textContent = "Nothing changed."; announce("Nothing changed."); return; }
      const body = { settings: changes, ...(reason.value.trim() ? { reason: reason.value.trim() } : {}) };
      const out = await store.actions.write((ws) => api.request("workspaces", { method: "PATCH", query: { id: ws }, body }), []);
      if (!out.ok) { status.textContent = messageFor(out.error); announce(messageFor(out.error)); return; }
      announce("Workspace settings saved.");
      // The app's copy of each workspace's setting values (the nav, defaults in forms) follows the change.
      if (store.actions.refreshWorkspaces) await store.actions.refreshWorkspaces();
      await loadInfo({ saved: true });
    }, { variant: "primary" });
    mount(settingsBox,
      el("p", { class: "field__help", text: changeable
        ? "These decide how everyone in this workspace works. Each one starts with how BudgetTracker has always worked. Privacy and safety rules are not settings: private accounts stay private, nothing is ever deleted and every change is kept."
        : "These decide how everyone in this workspace works. You can see how it is set up; owners and managers change it." }),
      ...groups.flatMap((g) => [el("h3", { class: "section-title", text: g.name }), el("div", { class: "form-grid" }, g.items)]),
      changeable ? el("div", { class: "form-grid" }, [field("Reason for the change (optional)", reason, { help: "Kept with the change under Workspace changes.", wide: true })]) : null,
      changeable ? el("div", { class: "row" }, [save]) : null,
      changeable ? status : null);
    if (saved) save.focus();
  }

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
    renderColours(state);
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
        // A visible label: two unlabelled dropdowns side by side read as one choice (preview check, 2026-09-14).
        el("span", { class: "app__spacer" }), usage, allowanceControl ? el("label", { class: "row small" }, [el("span", { class: "muted", text: "Storage" }), controlElement(allowanceControl)]) : null, controlElement(roleControl), remove,
      ]);
    })));
    // An enhanced select's focus() lands on its trigger.
    if (focusKey && memberControls[focusKey]) memberControls[focusKey].focus();
    if (!loaded) { loaded = true; void loadInvites(); void loadBackups(); void loadAudit(); void loadInfo(); }
    // A removal, role change or rejoin changes the members list; the former members reload with it.
    if (members.data !== lastMembers) { lastMembers = members.data; void loadFormer(); }
  }
  return { element, update };
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
