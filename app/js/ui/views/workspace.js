// Workspace administration: members and roles, invitations (with an access preview and a one-time
// link), shared contacts, backups and restores (preview first, errors in the modal, replace needs
// typed confirmation), and the audit history. Every control is presentation; the server enforces.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, field, input, select, button, badge } from "../components.js";
import { openModal, confirmModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";

const ROLES = [{ value: "viewer", label: "Viewer" }, { value: "member", label: "Member" }, { value: "manager", label: "Manager" }, { value: "owner", label: "Owner" }];

export function createView(ctx) {
  const { api, store } = ctx;
  const wsId = store.getState().selectedWorkspaceId;
  const membersBox = el("div");
  const inviteBox = el("div");
  const backupsBox = el("div");
  const auditBox = el("div");
  const element = el("section", {}, [
    pageHead("Workspace"),
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card" }, [el("h2", { class: "card__title", text: "Members" }), membersBox]),
      el("section", { class: "card" }, [el("h2", { class: "card__title", text: "Invite someone" }), inviteBox]),
      el("section", { class: "card" }, [el("h2", { class: "card__title", text: "Backups and restore" }), backupsBox]),
      el("section", { class: "card" }, [el("h2", { class: "card__title", text: "Recent activity" }), auditBox]),
    ]),
  ]);

  const me = () => ((sliceFor(store.getState(), "members").data || {}).members || []).find((m) => m.self) || { role: "viewer" };

  async function loadInvites() {
    const role = me().role;
    const email = input({ type: "email", placeholder: "person@example.com", autocomplete: "off" });
    const roleSel = select(ROLES.filter((r) => role === "owner" || r.value !== "owner"), "member");
    const result = el("div", { "aria-live": "polite" });
    const send = button("Create invitation", async () => {
      result.textContent = "";
      try {
        const out = await api.invite(wsId, { email: email.value, role: roleSel.value });
        const link = `${location.origin}/#/join?ws=${encodeURIComponent(wsId)}&token=${encodeURIComponent(out.token)}`;
        const linkField = input({ readonly: true, value: link, "aria-label": "Invitation link" });
        mount(result,
          el("p", { class: "notice", text: out.accessPreview.summary }),
          field("Invitation link (shown once)", linkField, { help: "Share it only with that person. It works only for their Google account and expires in 7 days." }));
        linkField.select();
        await renderPending();
      } catch (err) { mount(result, el("p", { class: "error-text", role: "alert", text: err.message })); }
    }, { variant: "primary" });
    const pending = el("div");
    async function renderPending() {
      try {
        const data = await api.invitations(wsId);
        mount(pending, el("ul", { class: "stack" }, data.invitations.map((i) => el("li", { class: "row" }, [
          el("span", { text: i.email }), badge(i.role), el("span", { class: "muted small", text: `until ${i.expiresAt.slice(0, 10)}` }),
          button("Revoke", async () => { await api.request("invitations", { method: "DELETE", query: { workspaceId: wsId }, body: { invitationId: i.id } }); await renderPending(); }, { small: true, variant: "ghost" }),
        ]))));
      } catch (err) { mount(pending); }
    }
    if (role === "owner" || role === "manager") {
      mount(inviteBox, el("div", { class: "stack" }, [field("Email", email), field("Role", roleSel, { help: "No role can see members' private accounts." }), send, result, el("h3", { text: "Pending" }), pending]));
      await renderPending();
    } else mount(inviteBox, el("p", { class: "muted", text: "Only owners and managers can invite people." }));
  }

  async function loadBackups() {
    const role = me().role;
    if (role !== "owner" && role !== "manager") {
      mount(backupsBox, el("p", { class: "muted", text: "Owners and managers manage backups. You can restore your own private accounts from a backup through an owner." }));
      return;
    }
    try {
      const data = await api.backups(wsId);
      const create = button("Create backup now", async () => {
        try { await api.createBackup(wsId); announce("Backup created."); await loadBackups(); } catch (err) { mount(status, el("span", { class: "error-text", text: err.message })); }
      }, { variant: "primary" });
      const status = el("p", { class: "field__help", role: "status" });
      mount(backupsBox, el("p", { class: "field__help", text: data.policy }), create, status,
        el("ul", { class: "stack" }, data.archives.map((a) => el("li", { class: "row" }, [
          el("span", { text: a.createdAt.replace("T", " ").slice(0, 16) }), badge(a.reason), el("span", { class: "muted small", text: a.createdBy }),
          el("span", { class: "app__spacer" }), button("Restore…", () => openRestore(ctx, wsId, a), { small: true }),
        ]))));
    } catch (err) { mount(backupsBox, el("p", { class: "error-text", role: "alert", text: err.message })); }
  }

  async function loadAudit() {
    try {
      const data = await api.audit(wsId);
      mount(auditBox, el("ul", { class: "stack small" }, data.entries.slice(0, 25).map((e) => el("li", {}, [
        el("span", { class: "muted", text: `${e.at.replace("T", " ").slice(0, 16)} · ` }), el("strong", { text: e.actorSelf ? "You" : e.actor }), ` ${e.action.replace(/[.-]/g, " ")}`,
      ]))));
    } catch (err) { mount(auditBox, el("p", { class: "error-text", text: err.message })); }
  }

  let loaded = false;
  function update(state) {
    const members = sliceFor(state, "members");
    const s = stateView(members);
    if (s) { mount(membersBox, s); return; }
    const role = me().role;
    mount(membersBox, el("ul", { class: "stack" }, members.data.members.map((m) => {
      const roleSel = select(ROLES, m.role, { "aria-label": `Role for ${m.name}`, disabled: role !== "owner" });
      roleSel.addEventListener("change", async () => {
        const out = await store.actions.write((ws) => api.request("members", { method: "PATCH", query: { workspaceId: ws }, body: { memberId: m.id, role: roleSel.value } }), ["members"]);
        if (!out.ok) { roleSel.value = m.role; announce(out.error.message); }
      });
      const remove = (role === "owner" || m.self) ? button(m.self ? "Leave" : "Remove", () => confirmModal({
        title: m.self ? "Leave this workspace?" : `Remove ${m.name}?`,
        message: "Their access and any access they gave or received on private accounts is revoked. Their past entries keep their attribution.",
        confirmLabel: m.self ? "Leave" : "Remove", danger: true,
        onConfirm: () => store.actions.write((ws) => api.request("members", { method: "DELETE", query: { workspaceId: ws }, body: { memberId: m.id } }), ["members", "accounts"]),
      }), { small: true, variant: "ghost" }) : null;
      return el("li", { class: "row" }, [el("strong", { text: m.name }), m.self ? badge("you") : null, m.email ? el("span", { class: "muted small", text: m.email }) : null, el("span", { class: "app__spacer" }), roleSel, remove]);
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
        el("p", { class: "notice", text: `Preview only — nothing has changed. In your scope: ${previewData.scope.accounts} accounts, ${previewData.scope.transactions} entries. Changes: +${previewData.changes.add} added, ${previewData.changes.update} updated, ${previewData.changes.remove} removed.` }),
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
        ctx.store.actions.selectWorkspace(out.workspace.id);
        void list;
      } else await ctx.store.actions.selectWorkspace(wsId);
    } catch (err) {
      modal.setBusy(false);
      modal.setError(err.code === "stale_preview" ? "The workspace changed since the preview. Preview again, then restore." : err);
    }
  }, { variant: "danger", attrs: { disabled: true } });
  mode.addEventListener("change", () => { previewData = null; execute.disabled = true; mount(summary); confirmText.hidden = true; });
  const modal = openModal({
    title: `Restore from ${archive.createdAt.slice(0, 16).replace("T", " ")}`,
    body: [field("What should happen", mode), summary, confirmText],
    actions: [button("Cancel", () => modal.close()), preview, execute],
  });
}
