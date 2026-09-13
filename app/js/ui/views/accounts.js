// Accounts: list with type, visibility and balance (only with view-balances), add account, and
// "Who can see this" with explicit grants for private accounts (owner only). The server decides
// everything; these controls only present what it allows.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, money, visibilityBadge, button, field, input, select, badge } from "../components.js";
import { openModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { ACCOUNT_TYPE_LABELS, todayIso } from "../../core/format.js";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "CAD", "AUD", "NZD", "JPY", "SGD", "HKD", "INR", "ZAR"];
const GRANTABLE = [["view-balances", "See balance"], ["view-transactions", "See entries"], ["create", "Add entries"], ["edit", "Edit entries"], ["delete", "Delete entries"], ["comment", "Comment"], ["download-receipts", "Download receipts"], ["export", "Export"]];

export function createView(ctx) {
  const box = el("div");
  const element = el("section", {}, [pageHead("Accounts", [button("Add account", () => openAddAccount(ctx), { variant: "primary" })]), box]);
  function update(state) {
    const prefs = state.preferences;
    const accounts = sliceFor(state, "accounts");
    const s = stateView(accounts, { empty: "No accounts yet. Add a bank account, card, cash wallet or loan.", isEmpty: (d) => !d.accounts.length });
    if (s) { mount(box, s); return; }
    mount(box, el("div", { class: "table-wrap" }, [el("table", { class: "table" }, [
      el("thead", {}, [el("tr", {}, ["Account", "Type", "Visibility", "Balance", ""].map((h) => el("th", { scope: "col", class: h === "Balance" ? "num" : "", text: h })))]),
      el("tbody", {}, accounts.data.accounts.filter((a) => !a.deletedAt).map((a) => el("tr", {}, [
        el("td", {}, [el("strong", { text: a.name }), a.institution ? el("div", { class: "muted small", text: `${a.institution}${a.maskedNumber ? ` ·· ${a.maskedNumber}` : ""}` }) : null]),
        el("td", { text: `${ACCOUNT_TYPE_LABELS[a.type] || a.type} · ${a.currency}` }),
        el("td", {}, [visibilityBadge(a.visibility), a.ownedBySelf ? el("span", { class: "muted small", text: " yours" }) : null]),
        el("td", { class: "num" }, [a.balance !== undefined ? money(a.balance, a.currency, prefs) : el("span", { class: "muted small", text: "Not shared with you" })]),
        el("td", {}, [button("Who can see this", () => openWhoCanSee(ctx, a), { small: true })]),
      ]))),
    ])]));
  }
  return { element, update };
}

function openAddAccount(ctx) {
  const key = newIdempotencyKey();
  const name = input({ required: true, maxlength: "80" });
  const type = select(Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label })), "checking");
  const currency = select(CURRENCIES.map((c) => ({ value: c, label: c })), (ctx.store.getState().workspaces.find((w) => w.id === ctx.store.getState().selectedWorkspaceId) || {}).reportingCurrency || "EUR");
  const visibility = select([{ value: "private", label: "Private — only you (you can share it later)" }, { value: "shared", label: "Shared — every workspace member per their role" }], "private");
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
    const out = await ctx.store.actions.write((ws) => ctx.api.createAccount(ws, body, key), ["accounts"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Account created.");
    modal.close();
  }, { variant: "primary" });
  const modal = openModal({
    title: "Add account",
    body: [el("div", { class: "form-grid" }, [
      field("Name", name), field("Type", type), field("Currency", currency),
      field("Visibility", visibility, { wide: true, help: "New accounts are private by default. Workspace owners cannot see private accounts." }),
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
    const memberSel = select(members.map((m) => ({ value: m.id, label: m.name })), (members[0] || {}).id);
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
