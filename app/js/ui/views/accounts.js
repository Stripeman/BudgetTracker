// Accounts: list with type, visibility and balance (only with view-balances), add account, and
// "Who can see this" with explicit grants for private accounts (owner only). The server decides
// everything; these controls only present what it allows.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, money, accessBadge, button, field, input, pickerSelect, badge } from "../components.js";
import { openModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { ACCOUNT_TYPE_LABELS, todayIso } from "../../core/format.js";
import { icon, withIcon, defaultIconFor } from "../icons.js";
import { createIconPicker, iconChange } from "../iconpicker.js";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "CAD", "AUD", "NZD", "JPY", "SGD", "HKD", "INR", "ZAR"];
const GRANTABLE = [["view-balances", "See balance"], ["view-transactions", "See entries"], ["create", "Add entries"], ["edit", "Edit entries"], ["delete", "Delete entries"], ["comment", "Comment"], ["download-receipts", "Download receipts"], ["export", "Export"]];

// Who may close or reopen: the owner of a private account, or an owner or manager for a shared one.
// Presentation only; the server decides.
const canManage = (a, role) => a.ownedBySelf || (a.visibility === "shared" && (role === "owner" || role === "manager"));

export function createView(ctx) {
  const box = el("div");
  const element = el("section", {}, [pageHead("Accounts", [button("Add account", () => openAddAccount(ctx), { variant: "primary" })]), box]);
  function update(state) {
    const role = ((state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || {}).role;
    const prefs = state.preferences;
    const accounts = sliceFor(state, "accounts");
    const s = stateView(accounts, { empty: "No accounts yet. Add a bank account, card, cash wallet or loan.", isEmpty: (d) => !d.accounts.length });
    if (s) { mount(box, s); return; }
    mount(box, el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": "Accounts" }, [
      el("thead", {}, [el("tr", {}, ["Account", "Type", "Who can see it", "Balance", "Actions"].map((h) => el("th", { scope: "col", class: h === "Balance" ? "num" : "", text: h })))]),
      el("tbody", {}, accounts.data.accounts.filter((a) => !a.deletedAt).map((a) => el("tr", {}, [
        el("th", { scope: "row", "data-label": "Account" }, [
          withIcon(a.icon, el("strong", { text: a.name })), a.status === "closed" ? " " : null, a.status === "closed" ? badge("Closed", "closed") : null,
          a.institution ? el("div", { class: "muted small", text: `${a.institution}${a.maskedNumber ? ` ·· ${a.maskedNumber}` : ""}` }) : null,
        ]),
        el("td", { "data-label": "Type", text: `${ACCOUNT_TYPE_LABELS[a.type] || a.type} · ${a.currency}` }),
        el("td", { "data-label": "Who can see it" }, [accessBadge(a)]),
        el("td", { "data-label": "Balance", class: "num" }, [a.balance !== undefined ? money(a.balance, a.currency, prefs) : el("span", { class: "muted small", text: "Not shared with you" })]),
        el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
          button("Who can see this", () => openWhoCanSee(ctx, a), { small: true, attrs: { "aria-label": `Who can see ${a.name}` } }),
          canManage(a, role) ? button("Edit", () => openEditAccount(ctx, a), { small: true, attrs: { "aria-label": `Edit ${a.name}` } }) : null,
          canManage(a, role) ? button(a.status === "closed" ? "Reopen" : "Close", () => openLifecycle(ctx, a), { small: true, attrs: { "aria-label": `${a.status === "closed" ? "Reopen" : "Close"} ${a.name}` } }) : null,
        ])]),
      ]))),
    ])]));
  }
  return { element, update };
}

// Closing keeps the account, its balance and its history; it only stops new entries and bills.
function openLifecycle(ctx, account) {
  const closing = account.status !== "closed";
  const reason = input({ maxlength: "200", autocomplete: "off" });
  const closedOn = input({ type: "date" });
  closedOn.value = todayIso();
  const confirm = button(closing ? "Close account" : "Reopen account", async () => {
    modal.setError("");
    if (closing && !reason.value.trim()) {
      reason.setAttribute("aria-invalid", "true");
      reason.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Give a reason for closing this account.");
      reason.focus();
      return;
    }
    const body = { accountId: account.id, revision: account.revision };
    if (reason.value.trim()) body.reason = reason.value.trim();
    if (closing && closedOn.value) body.closedOn = closedOn.value;
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.accountAction(ws, closing ? "close" : "reopen", body), ["accounts"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(closing ? `${account.name} closed. Its history stays.` : `${account.name} reopened.`);
    modal.close();
  }, { variant: "primary" });
  const modal = openModal({
    title: closing ? `Close ${account.name}?` : `Reopen ${account.name}?`,
    body: [
      el("p", { text: closing
        ? "No new entries or bills can be added to it. Its balance, entries and history stay exactly as they are, and you can reopen it later."
        : "New entries and bills can be added to it again. Its history is unchanged." }),
      el("div", { class: "form-grid" }, [
        field("Reason", reason, { help: closing ? "Required. It is kept with the account's history." : "Optional." }),
        closing ? field("Date closed", closedOn) : null,
      ]),
    ],
    actions: [button("Cancel", () => modal.close()), confirm],
  });
}

// Name and icon (BT-011-05). Every change is kept in the account's history with the reason.
function openEditAccount(ctx, account) {
  const name = input({ required: true, maxlength: "80", value: account.name, autocomplete: "off" });
  const chosen = account.iconSource === "record" ? account.icon : null;
  const iconPick = createIconPicker({ value: chosen, inherited: chosen ? defaultIconFor("account", account.type) : account.icon, name: account.name });
  const reason = input({ maxlength: "200", placeholder: "Optional", autocomplete: "off" });
  const save = button("Save changes", async () => {
    modal.setError("");
    if (!name.value.trim()) { name.setAttribute("aria-invalid", "true"); name.setAttribute("aria-errormessage", modal.errorId); modal.setError("Give the account a name."); name.focus(); return; }
    const body = { accountId: account.id, revision: account.revision };
    if (name.value.trim() !== account.name) body.name = name.value.trim();
    const icon = iconChange(chosen, iconPick.getValue());
    if (icon !== undefined) body.icon = icon;
    if (Object.keys(body).length === 2) { announce("Nothing changed."); modal.close(); return; }
    if (reason.value.trim()) body.reason = reason.value.trim();
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.updateAccount(ws, body), ["accounts"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Account saved.");
    modal.close();
  }, { variant: "primary" });
  const modal = openModal({
    title: `Edit ${account.name}`,
    body: [el("div", { class: "form-grid" }, [field("Name", name), iconPick.element, field("Reason for this change", reason, { wide: true })])],
    actions: [button("Cancel", () => modal.close()), save],
  });
}

function openAddAccount(ctx) {
  const key = newIdempotencyKey();
  const name = input({ required: true, maxlength: "80" });
  // The dropdowns are TaskTracker's command picker (BT-004-05). Each type shows the icon an account
  // of that type gets by default (BT-011-05), beside its name.
  const type = pickerSelect(Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label })), "checking", {}, { search: false, badgeOf: (v) => icon(defaultIconFor("account", v)) });
  // The "Default" icon follows the chosen type (BT-011-05).
  const iconBox = el("div");
  let iconPick = null;
  const makeIconPicker = (value = null) => { iconPick = createIconPicker({ value, inherited: defaultIconFor("account", type.value), name: "New account" }); mount(iconBox, iconPick.element); };
  makeIconPicker();
  type.addEventListener("change", () => makeIconPicker(iconPick.getValue()));
  const currency = pickerSelect(CURRENCIES.map((c) => ({ value: c, label: c })), (ctx.store.getState().workspaces.find((w) => w.id === ctx.store.getState().selectedWorkspaceId) || {}).reportingCurrency || "EUR");
  const visibility = pickerSelect([{ value: "private", label: "Private — only you (you can share it later)" }, { value: "shared", label: "Shared — every workspace member per their role" }], "private", {}, { search: false });
  const opening = input({ inputmode: "decimal", placeholder: "0.00" });
  const openingDate = input({ type: "date", value: todayIso() });
  const institution = input({ maxlength: "80" });
  const last = input({ inputmode: "numeric", maxlength: "4", placeholder: "Last 2–4 digits only" });
  const save = button("Create account", async () => {
    modal.setError("");
    modal.setBusy(true);
    const body = { name: name.value, type: type.value, currency: currency.value, visibility: visibility.value, openingDate: openingDate.value };
    if (opening.value.trim()) body.openingBalance = opening.value.trim();
    if (institution.value.trim()) body.institution = institution.value.trim();
    if (last.value.trim()) body.maskedNumber = last.value.trim();
    if (iconPick.getValue()) body.icon = iconPick.getValue();
    const out = await ctx.store.actions.write((ws) => ctx.api.createAccount(ws, body, key), ["accounts"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Account created.");
    modal.close();
  }, { variant: "primary" });
  const modal = openModal({
    title: "Add account",
    body: [el("div", { class: "form-grid" }, [
      field("Name", name), field("Type", type), iconBox, field("Currency", currency),
      field("Who can see it", visibility, { wide: true, help: "New accounts are private by default. Workspace owners cannot see private accounts. Only owners and managers can create shared accounts." }),
      field("Opening balance", opening, { help: "Loans and other debts: enter the amount owed as a negative number, e.g. -20000.00." }),
      field("Opening date", openingDate), field("Institution", institution), field("Account number", last, { help: "Never store a full account or card number." }),
    ])],
    actions: [button("Cancel", () => modal.close()), save],
  });
}

async function openWhoCanSee(ctx, account) {
  const wsId = ctx.store.getState().selectedWorkspaceId;
  const list = el("div", { role: "status", text: "Loading…" });
  const grantBox = el("div");
  const modal = openModal({ title: `Who can see “${account.name}”`, body: [list, grantBox], actions: [button("Close", () => modal.close())] });

  async function load() {
    try {
      const data = await ctx.api.whoCanSee(wsId, account.id);
      mount(list,
        el("ul", { class: "stack" }, data.people.map((p) => el("li", { class: "row" }, [
          el("strong", { text: p.member.name }), p.member.self ? badge("you") : null,
          badge(p.source === "owner" ? "Owner" : p.source === "grant" ? "Granted" : `Role: ${p.source.replace("role:", "")}`),
          el("span", { class: "muted small", text: p.capabilities.join(", ") }),
        ]))),
        el("p", { class: "notice notice--warning", text: data.notice }));
      if (data.grants) renderGrants(data);
    } catch (err) { modal.setError(err); mount(list); }
  }

  async function renderGrants(data) {
    const members = ((ctx.store.getState().members.data || {}).members || []).filter((m) => !m.self);
    const active = data.grants.filter((g) => !g.revokedAt);
    // People are searched, as in TaskTracker's people pickers (BT-004-05).
    const memberSel = pickerSelect(members.map((m) => ({ value: m.id, label: m.name })), (members[0] || {}).id);
    const boxes = GRANTABLE.map(([value, label]) => { const c = el("input", { type: "checkbox", value }); if (value === "view-balances" || value === "view-transactions") c.checked = true; return el("label", { class: "field--inline" }, [c, label]); });
    const expires = input({ type: "date" });
    const grant = button("Share", async () => {
      modal.setError("");
      const capabilities = boxes.map((b) => b.querySelector("input")).filter((c) => c.checked).map((c) => c.value);
      const body = { accountId: account.id, memberId: memberSel.value, capabilities };
      if (expires.value) body.expiresAt = `${expires.value}T23:59:59Z`;
      try { await ctx.api.grant(wsId, body); announce("Access granted."); await load(); } catch (err) { modal.setError(err); }
    }, { variant: "primary" });
    mount(grantBox,
      el("h3", { text: "Explicit access" }),
      el("ul", { class: "stack" }, active.map((g) => el("li", { class: "row" }, [
        el("span", { text: (members.find((m) => m.id === g.memberId) || { name: "Member" }).name }),
        el("span", { class: "muted small", text: `${g.capabilities.join(", ")}${g.expiresAt ? ` · until ${g.expiresAt.slice(0, 10)}` : ""}` }),
        button("Revoke", async () => { try { await ctx.api.revokeGrant(wsId, { grantId: g.id }); announce("Access revoked."); await load(); } catch (err) { modal.setError(err); } }, { small: true, variant: "danger" }),
      ]))),
      account.visibility === "private" && members.length ? el("div", { class: "stack" }, [
        field("Member", memberSel), el("fieldset", { class: "stack" }, [el("legend", { class: "field__label", text: "They may" }), ...boxes]),
        field("Access ends (optional)", expires), grant,
      ]) : null);
  }
  await load();
}
