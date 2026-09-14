// Accounts: list with type, visibility and balance (only with view-balances), add account, and
// "Who can see this" with explicit grants for private accounts (owner only). The server decides
// everything; these controls only present what it allows.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, money, accessBadge, button, field, input, pickerSelect, badge, uid } from "../components.js";
import { openModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { messageFor } from "../../core/errors.js";
import { ACCOUNT_TYPE_LABELS, todayIso, formatDate } from "../../core/format.js";
import { icon, withIcon, defaultIconFor } from "../icons.js";
import { createIconPicker, iconChange } from "../iconpicker.js";
import { managesSharedLists } from "../../core/workspacesettings.js";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "CAD", "AUD", "NZD", "JPY", "SGD", "HKD", "INR", "ZAR"];
const GRANTABLE = [["view-balances", "See balance"], ["view-transactions", "See entries"], ["create", "Add entries"], ["edit", "Edit entries"], ["delete", "Delete entries"], ["comment", "Comment"], ["download-receipts", "Download receipts"], ["export", "Export"]];

// Who may edit, close or reopen: the owner of a private account; for a shared one whoever manages the
// workspace's shared lists (owners and managers, or members too when the workspace setting says so).
// Presentation only; the server decides.
const canManage = (a, sharedLists) => a.ownedBySelf || (a.visibility === "shared" && sharedLists);

export function createView(ctx) {
  const box = el("div");
  // Removed accounts (BT-006-05): counted by the server, listed only when asked for, and forgotten
  // when the workspace changes (a generation token discards an answer for an earlier request).
  const removed = { open: false, list: null, error: null, gen: 0, ws: null };
  const sectionId = uid("removed-accounts");
  const toggle = button("", () => {
    removed.open = !removed.open;
    removed.error = null;
    if (removed.open) loadRemoved(); else removed.gen += 1;
    renderRemoved();
  }, { small: true, attrs: { "aria-expanded": "false" } });
  const toggleBox = el("div");
  const listBox = el("div");
  const element = el("section", {}, [pageHead("Accounts", [button("Add account", () => openAddAccount(ctx), { variant: "primary" })]), el("div", { class: "stack" }, [box, toggleBox, listBox])]);
  let lastState = null;

  async function loadRemoved() {
    const ws = removed.ws;
    const mine = ++removed.gen;
    removed.list = null;
    renderRemoved();
    try {
      const data = await ctx.api.accounts(ws, { includeDeleted: "1" });
      if (mine !== removed.gen || ws !== removed.ws) return;
      removed.list = (data.accounts || []).filter((a) => a.deletedAt);
    } catch (err) {
      if (mine !== removed.gen || ws !== removed.ws) return;
      removed.list = [];
      removed.error = `Removed accounts could not be loaded. ${messageFor(err)}`;
    }
    renderRemoved();
  }

  async function bringBack(account) {
    removed.error = null;
    const out = await ctx.store.actions.write((ws) => ctx.api.accountAction(ws, "restore", { accountId: account.id }), ["accounts", "transactions"]);
    if (!out.ok) { removed.error = `${account.name} could not be brought back. ${typeof out.error === "string" ? out.error : messageFor(out.error)}`; renderRemoved(); return; }
    announce(`${account.name} is back in your accounts, with its history.`);
    toggle.focus();
    await loadRemoved();
  }

  function renderRemoved() {
    const state = lastState;
    const count = state ? ((sliceFor(state, "accounts").data || {}).removedCount || 0) : 0;
    if (!removed.open && !count) { mount(toggleBox); mount(listBox); return; }
    toggle.textContent = removed.open ? "Hide removed accounts" : `Show removed accounts (${count})`;
    toggle.setAttribute("aria-expanded", String(removed.open));
    mount(toggleBox, toggle);
    if (!removed.open) { toggle.removeAttribute("aria-controls"); mount(listBox); return; }
    toggle.setAttribute("aria-controls", sectionId);
    const prefs = state && state.preferences;
    const dateFormat = prefs && prefs.effective && prefs.effective.dateFormat;
    let body;
    if (removed.list === null) body = el("p", { role: "status", text: "Loading…" });
    else if (!removed.list.length) body = removed.error ? null : el("p", { class: "muted", text: "No removed accounts." });
    else {
      body = el("ul", { class: "stack" }, removed.list.map((a) => el("li", { class: "row" }, [
        withIcon(a.icon, el("strong", { text: a.name })),
        el("span", { class: "muted small", text: `${ACCOUNT_TYPE_LABELS[a.type] || a.type} · ${a.currency} · Removed ${formatDate(a.deletedAt, dateFormat)}` }),
        button("Bring back", () => bringBack(a), { small: true, attrs: { "aria-label": `Bring back ${a.name}` } }),
      ])));
    }
    mount(listBox, el("section", { id: sectionId, class: "card", "aria-labelledby": `${sectionId}-title` }, [
      el("h2", { class: "card__title", id: `${sectionId}-title`, text: "Removed accounts" }),
      el("p", { class: "muted small", text: "Removed accounts and their entries are kept, never erased. Bringing one back returns it to your lists and totals with its history." }),
      removed.error ? el("p", { class: "state state--error", role: "alert", text: removed.error }) : null,
      body,
    ]));
  }

  // After a removal: the removed list is read again if it is open, and focus goes to its toggle
  // (the row that held the Remove button is gone).
  function afterRemove() {
    if (removed.open) loadRemoved();
    if (toggle.parentNode) toggle.focus();
  }

  function update(state) {
    lastState = state;
    if (state.selectedWorkspaceId !== removed.ws) {
      removed.ws = state.selectedWorkspaceId;
      removed.open = false;
      removed.list = null;
      removed.error = null;
      removed.gen += 1;
    }
    const role = ((state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || {}).role;
    const sharedLists = managesSharedLists(state);
    const prefs = state.preferences;
    const accounts = sliceFor(state, "accounts");
    renderRemoved();
    const s = stateView(accounts, { empty: "No accounts yet. Add a bank account, card, cash wallet or loan.", isEmpty: (d) => !d.accounts.filter((a) => !a.deletedAt).length });
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
          canManage(a, sharedLists) ? button("Edit", () => openEditAccount(ctx, a), { small: true, attrs: { "aria-label": `Edit ${a.name}` } }) : null,
          canManage(a, sharedLists) ? button(a.status === "closed" ? "Reopen" : "Close", () => openLifecycle(ctx, a), { small: true, attrs: { "aria-label": `${a.status === "closed" ? "Reopen" : "Close"} ${a.name}` } }) : null,
          canManage(a, sharedLists) ? button("Remove", () => openRemove(ctx, a, afterRemove), { small: true, attrs: { "aria-label": `Remove ${a.name}` } }) : null,
        ])]),
      ]))),
    ])]));
  }
  return { element, update };
}

// Removing (BT-006-05; Terry, 2026-09-14: "i just created the wrong one and now i cant remove it") is
// never erasing (BT-001-05): the account leaves lists, pickers and totals, keeps its history and comes
// back with Bring back. An account with nothing recorded against it gets a ready-made reason; one with
// entries needs a reason and offers closing instead. The server decides who may; it requires a reason,
// so an empty account whose reason was cleared is still sent with the ready-made one.
const MISTAKE = "Created by mistake";
const HAS_ENTRIES_TEXT = "This account has entries. Removing it takes it out of your account lists, pickers and totals, but nothing is erased: its entries are kept and can still be found under Transactions, and you can bring it back from Removed accounts. To stop using it but keep it visible, close it instead.";

function openRemove(ctx, account, onRemoved = () => {}) {
  // When the server did not say (it tells only people who can see the entries), the stricter dialog.
  const empty = account.hasEntries === false;
  const reason = input({ maxlength: "200", autocomplete: "off" });
  reason.value = empty ? MISTAKE : "";
  const confirm = button("Remove account", async () => {
    modal.setError("");
    reason.removeAttribute("aria-invalid");
    const text = reason.value.trim() || (empty ? MISTAKE : "");
    if (!text) {
      reason.setAttribute("aria-invalid", "true");
      reason.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Give a reason for removing this account. It is kept with the account's history.");
      reason.focus();
      return;
    }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.removeAccount(ws, { accountId: account.id, reason: text }), ["accounts", "transactions"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(`${account.name} removed. You can bring it back from Removed accounts.`);
    modal.close();
    onRemoved();
  }, { variant: "danger" });
  const closeInstead = !empty && account.status !== "closed" ? button("Close instead", () => { modal.close(); openLifecycle(ctx, account); }) : null;
  const modal = openModal({
    title: `Remove ${account.name}?`,
    body: [
      el("p", { text: empty ? "This account has no entries. It will be removed from your lists. You can bring it back from Removed accounts." : HAS_ENTRIES_TEXT }),
      el("div", { class: "form-grid" }, [field("Reason", reason, { wide: true, help: empty ? "Kept with the account's history. Change it if you like." : "Required. It is kept with the account's history." })]),
    ],
    actions: [button("Cancel", () => modal.close()), closeInstead, confirm].filter(Boolean),
  });
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
      field("Who can see it", visibility, { wide: true, help: "New accounts are private by default. Workspace owners cannot see private accounts. Shared accounts are created by whoever manages shared lists (owners and managers, unless Workspace settings say members too)." }),
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
    const memberSel = pickerSelect(members.map((m) => ({ value: m.id, label: m.name })), (members[0] || {}).id, {}, { placeholder: "Choose a member…" });
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
