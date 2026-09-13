// Workspace administration: members and roles, invitations (with an access preview and a one-time
// link), backups and restores (preview first, errors in the modal, replace needs typed
// confirmation, last successful backup shown), and recent activity in plain language. Every
// control is presentation; the server enforces.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, field, input, select, button, badge, commitOnConfirm, categoryLabel } from "../components.js";
import { createThemePicker } from "../themepicker.js";
import { colourEntries } from "../../core/categories.js";
import { openModal, confirmModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { messageFor } from "../../core/errors.js";
import { ACCOUNT_TYPE_LABELS, BILL_TYPE_LABELS, MERCHANT_TYPE_LABELS } from "../../core/format.js";
import { createIconPicker } from "../iconpicker.js";
import { builtInIconFor, withIcon } from "../icons.js";

// Icons for the workspace's types (BT-011-05): accounts, bills and merchants of a type show this icon
// unless one was chosen on the record itself.
const TYPE_GROUPS = [
  { kind: "account", title: "Account types", labels: ACCOUNT_TYPE_LABELS },
  { kind: "bill", title: "Bill types", labels: BILL_TYPE_LABELS },
  { kind: "merchant", title: "Merchant types", labels: MERCHANT_TYPE_LABELS },
];

const ROLES = [{ value: "viewer", label: "Viewer" }, { value: "member", label: "Member" }, { value: "manager", label: "Manager" }, { value: "owner", label: "Owner" }];
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

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
  "budget.create": "added a budget", "budget.update": "changed a budget", "budget.delete": "removed a budget",
  "category.create": "added a category", "category.update": "changed a category", "workspace.type-icons": "changed the icons for account, bill or merchant types", "contact.create": "added a contact", "contact.update": "changed a contact", "contact.delete": "removed a contact",
  "backup.create": "created a backup", "workspace.restore-replace": "restored from a backup (replace)", "workspace.restore-merge": "restored from a backup (merge)", "workspace.restore-create": "created a workspace from a backup",
};
const describe = (action) => ACTIVITY[action] || action.replace(/[.-]/g, " ");
const stamp = (iso) => iso.replace("T", " ").slice(0, 16);

export function createView(ctx) {
  const { api, store } = ctx;
  const wsId = store.getState().selectedWorkspaceId;
  const membersBox = el("div");
  const inviteBox = el("div");
  const backupsBox = el("div");
  const auditBox = el("div");
  const coloursBox = el("div", { class: "stack" });
  const typesBox = el("div", { class: "stack" });
  const element = el("section", {}, [
    pageHead("Workspace"),
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "ws-members" }, [el("h2", { class: "card__title", id: "ws-members", text: "Members" }), membersBox]),
      el("section", { class: "card", "aria-labelledby": "ws-invite" }, [el("h2", { class: "card__title", id: "ws-invite", text: "Invite someone" }), inviteBox]),
      el("section", { class: "card", "aria-labelledby": "ws-backups" }, [el("h2", { class: "card__title", id: "ws-backups", text: "Backups and restore" }), backupsBox]),
      el("section", { class: "card", "aria-labelledby": "ws-activity" }, [el("h2", { class: "card__title", id: "ws-activity", text: "Recent activity" }), auditBox]),
      el("section", { class: "card", "aria-labelledby": "ws-colours" }, [el("h2", { class: "card__title", id: "ws-colours", text: "Category colours and icons" }), coloursBox]),
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
    const roleSel = select(ROLES.filter((r) => role === "owner" || r.value !== "owner"), "member");
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
          el("span", { text: stamp(a.createdAt) }), badge(a.reason), el("span", { class: "muted small", text: a.createdBy }),
          el("span", { class: "app__spacer" }), button("Restore…", () => openRestore(ctx, wsId, a), { small: true, attrs: { "aria-label": `Restore from ${stamp(a.createdAt)}` } }),
        ]))));
    } catch (err) { mount(backupsBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
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

  // Workspace category colours (BT-011-04): owners and managers choose them; everyone sees them.
  // Each member may still pick personal colours in My settings.
  let colourSig = "";
  function renderColours(state) {
    const data = sliceFor(state, "categories").data;
    if (!data || !sliceFor(state, "members").data) return;
    const canEdit = ["owner", "manager"].includes(me().role);
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
        value: chosenIcon, inherited: c.defaultIcon, name: c.name, label: `${c.name} icon`,
        onPick: async (id) => {
          const out = await store.actions.write((ws) => api.request("categories", { method: "PATCH", query: { workspaceId: ws }, body: { categoryId: c.id, icon: id || null } }), ["categories"]);
          if (out.ok) { announce(`${c.name}: icon ${id ? "saved" : "reset to default"}.`); return; }
          iconPick.select(chosenIcon);
          error.textContent = messageFor(out.error);
          error.hidden = false;
        },
      });
      return el("div", { class: "field", dataset: { category: c.id } }, [
        el("p", { class: "field__label", id: labelId, text: `${c.name} colour` }), picker.element, iconPick.element, error,
        el("div", { class: "row" }, [badge(c.colorSource === "workspace" ? "Workspace colour" : "Default colour", "source"),
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
          value: typeIcons[key] || null, inherited, name: label, label,
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
      const details = el("details", { class: "more" }, [el("summary", { text: g.title }), canEdit ? el("div", { class: "icon-grid" }, items) : el("ul", { class: "stack" }, items)]);
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
  function update(state) {
    renderColours(state);
    renderTypes(state);
    const members = sliceFor(state, "members");
    const s = stateView(members);
    if (s) { mount(membersBox, s); return; }
    const role = me().role;
    const owners = members.data.members.filter((m) => m.role === "owner").length;
    mount(membersBox, el("ul", { class: "stack" }, members.data.members.map((m) => {
      const soleOwner = m.role === "owner" && owners <= 1;
      let roleControl;
      if (role === "owner" && !soleOwner) {
        // Commits only on an explicit choice (A11Y-002), and making someone an owner asks first.
        roleControl = select(ROLES, m.role, { "aria-label": `Role for ${m.name}` });
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
        el("span", { class: "app__spacer" }), roleControl, remove,
      ]);
    })));
    if (!loaded) { loaded = true; void loadInvites(); void loadBackups(); void loadAudit(); }
  }
  return { element, update };
}

function openRestore(ctx, wsId, archive) {
  const mode = select([
    { value: "merge", label: "Merge — add missing records, keep current ones" },
    { value: "create-new", label: "Create a new workspace from this backup" },
    { value: "replace", label: "Replace — roll my records back to this backup" },
  ], "merge");
  const summary = el("div", { "aria-live": "polite" });
  const confirmText = input({ placeholder: "Type REPLACE to confirm", hidden: true, "aria-label": "Type REPLACE to confirm" });
  let previewData = null;
  const key = newIdempotencyKey();
  const preview = button("Preview", async () => {
    modal.setError("");
    try {
      previewData = await ctx.api.previewRestore({ workspaceId: wsId, archiveId: archive.archiveId, mode: mode.value });
      execute.disabled = !previewData.canExecute;
      confirmText.hidden = mode.value !== "replace";
      mount(summary,
        el("p", { class: "notice", text: `Preview only — nothing has changed. In your scope: ${previewData.scope.accounts} accounts, ${previewData.scope.transactions} entries. Changes: ${previewData.changes.add} added, ${previewData.changes.update} updated, ${previewData.changes.remove} removed.` }),
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
      const body = { workspaceId: wsId, archiveId: archive.archiveId, mode: mode.value };
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
  }, { variant: "danger", attrs: { disabled: true } });
  mode.addEventListener("change", () => { previewData = null; execute.disabled = true; mount(summary); confirmText.hidden = true; });
  const modal = openModal({
    title: `Restore from ${stamp(archive.createdAt)}`,
    body: [field("What should happen", mode), summary, confirmText],
    actions: [button("Cancel", () => modal.close()), preview, execute],
  });
}
