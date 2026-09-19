// Accounts: list with type, visibility and balance (only with view-balances), add account, and
// "Who can see this" with explicit grants for private accounts (owner only). The server decides
// everything; these controls only present what it allows.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, money, accessBadge, button, field, input, pickerSelect, badge, categoryLabel, uid } from "../components.js";
import { openModal } from "../modal.js";
import { openDeleteDialog } from "../permanentdelete.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { messageFor } from "../../core/errors.js";
import { ACCOUNT_TYPE_LABELS, todayIso, formatDate } from "../../core/format.js";
import { icon, withIcon, defaultIconFor } from "../icons.js";
import { createIconPicker, iconChange } from "../iconpicker.js";
import { managesSharedLists } from "../../core/workspacesettings.js";
import { createActionsMenu } from "../actionsmenu.js";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "CAD", "AUD", "NZD", "JPY", "SGD", "HKD", "INR", "ZAR"];
const GRANTABLE = [["view-balances", "See balance"], ["view-transactions", "See entries"], ["create", "Add entries"], ["edit", "Edit entries"], ["delete", "Delete entries"], ["comment", "Comment"], ["download-receipts", "Download receipts"], ["export", "Export"]];

// Terms are shown and edited only for account types that carry them (BT-006, `ledger.validateTerms`).
const CREDIT_TERM_TYPES = new Set(["credit-card", "merchant-credit"]);
const LOAN_TERM_TYPES = new Set(["loan", "mortgage", "other-liability"]);

// Type and currency may still be fixed while nothing has been recorded against the account yet
// (BT-014-08); once anything is, every entry, category rule and, for loans/credit cards, the terms
// below assume them, so they lock — shown read-only with this explanation.
const TYPE_CURRENCY_LOCKED = "This account already has activity recorded against it (an entry, a bill, a grant or a Shared-expenses link), so type and currency are locked — every entry and rule on it depends on them.";
const TYPE_CURRENCY_EDITABLE = "Nothing has been recorded against this account yet, so its type and currency can still be fixed if you picked the wrong one. Once anything is recorded, they lock.";
const OPENING_LOCKED = "This account has reconciled entries, so this is locked to keep reconciled statements correct.";

// The same shape `termsControls(...).collect()` produces, built directly from the account's data
// rather than by reading the controls back — so "did terms change" never depends on a browser
// having already reflected the fields' initial `value` attributes into their `.value` property.
function canonicalTerms(type, terms) {
  const t = terms || {};
  if (CREDIT_TERM_TYPES.has(type)) {
    return {
      creditLimit: t.creditLimit || undefined,
      statementDay: t.statementDay ? Number(t.statementDay) : undefined,
      dueDay: t.dueDay ? Number(t.dueDay) : undefined,
      minimumPayment: t.minimumPayment || undefined,
      apr: t.apr || undefined,
      promoApr: t.promoApr || undefined,
      promoEndDate: t.promoEndDate || undefined,
    };
  }
  if (LOAN_TERM_TYPES.has(type)) {
    return {
      principal: t.principal || undefined,
      interestRate: t.interestRate || undefined,
      termMonths: t.termMonths || undefined,
      payment: t.payment || undefined,
      paymentDay: t.paymentDay ? Number(t.paymentDay) : undefined,
      startDate: t.startDate || undefined,
    };
  }
  return null;
}

// The terms controls for a loan or credit-card account: the same fields `ledger.validateTerms`
// accepts, pre-filled from the account's current terms. The server replaces the whole `terms`
// object on any change, so `collect()` always returns every field, not only the one that changed.
function termsControls(type, terms) {
  const t = terms || {};
  if (CREDIT_TERM_TYPES.has(type)) {
    const creditLimit = input({ inputmode: "decimal", placeholder: "0.00", value: t.creditLimit || "" });
    const statementDay = input({ type: "number", min: "1", max: "31", inputmode: "numeric", value: t.statementDay || "" });
    const dueDay = input({ type: "number", min: "1", max: "31", inputmode: "numeric", value: t.dueDay || "" });
    const minimumPayment = input({ inputmode: "decimal", placeholder: "0.00", value: t.minimumPayment || "" });
    const apr = input({ inputmode: "decimal", placeholder: "e.g. 19.99", value: t.apr || "" });
    const promoApr = input({ inputmode: "decimal", placeholder: "e.g. 0.00", value: t.promoApr || "" });
    const promoEndDate = input({ type: "date", value: t.promoEndDate || "" });
    return {
      legend: "Credit terms",
      fields: [
        field("Credit limit", creditLimit), field("Statement day", statementDay), field("Due day", dueDay),
        field("Minimum payment", minimumPayment), field("APR", apr), field("Promotional APR", promoApr),
        field("Promotion end date", promoEndDate),
      ],
      collect: () => ({
        creditLimit: creditLimit.value.trim() || undefined,
        statementDay: statementDay.value.trim() ? Number(statementDay.value.trim()) : undefined,
        dueDay: dueDay.value.trim() ? Number(dueDay.value.trim()) : undefined,
        minimumPayment: minimumPayment.value.trim() || undefined,
        apr: apr.value.trim() || undefined,
        promoApr: promoApr.value.trim() || undefined,
        promoEndDate: promoEndDate.value || undefined,
      }),
    };
  }
  if (LOAN_TERM_TYPES.has(type)) {
    const principal = input({ inputmode: "decimal", placeholder: "0.00", value: t.principal || "" });
    const interestRate = input({ inputmode: "decimal", placeholder: "e.g. 4.5", value: t.interestRate || "" });
    const termMonths = input({ type: "number", min: "1", max: "600", inputmode: "numeric", value: t.termMonths || "" });
    const payment = input({ inputmode: "decimal", placeholder: "0.00", value: t.payment || "" });
    const paymentDay = input({ type: "number", min: "1", max: "31", inputmode: "numeric", value: t.paymentDay || "" });
    const startDate = input({ type: "date", value: t.startDate || "" });
    return {
      legend: "Loan terms",
      fields: [
        field("Principal", principal), field("Interest rate", interestRate), field("Term (months)", termMonths),
        field("Payment", payment), field("Payment day", paymentDay), field("Start date", startDate),
      ],
      collect: () => ({
        principal: principal.value.trim() || undefined,
        interestRate: interestRate.value.trim() || undefined,
        termMonths: termMonths.value.trim() ? Number(termMonths.value.trim()) : undefined,
        payment: payment.value.trim() || undefined,
        paymentDay: paymentDay.value.trim() ? Number(paymentDay.value.trim()) : undefined,
        startDate: startDate.value || undefined,
      }),
    };
  }
  return null;
}

// Who may edit, close or reopen: the owner of a private account; for a shared one whoever manages the
// workspace's shared lists (owners and managers, or members too when the workspace setting says so).
// Presentation only; the server decides.
const canManage = (a, sharedLists) => a.ownedBySelf || (a.visibility === "shared" && sharedLists);

// BT-019-02: the workspace's account TYPE definitions (name, colour, optional icon), each mapped to
// one of the fixed accounting classes — offered here instead of the plain fixed list whenever the
// workspace's own types have loaded, so a custom type is a real, pickable choice everywhere an
// account's type is chosen. `keepId` (a currently-assigned type, even a retired one) is always kept
// in the list so a picker never silently drops the account's own current choice. Falls back to
// `null` when the slice has not loaded yet (or a caller's test stub omits it entirely), so every
// existing caller keeps working exactly as it always has with the fixed `ACCOUNT_TYPE_LABELS` list.
function accountTypeChoices(state, keepId = null) {
  const data = sliceFor(state, "accountTypes").data;
  if (!data) return null;
  return data.types.filter((t) => !t.retired || t.id === keepId)
    .sort((a, b) => (a.system === b.system ? a.name.localeCompare(b.name) : a.system ? -1 : 1));
}
// A coloured/iconed leading mark for a type picker's options and its trigger (categoryLabel's own
// mark, so a type reads exactly the same here as everywhere else it is shown).
function accountTypeBadges(types) {
  const byId = new Map((types || []).map((t) => [t.id, t]));
  return (id) => {
    const t = byId.get(id);
    if (!t) return null;
    return t.icon
      ? el("span", { class: "catlabel__icon", "aria-hidden": "true", vars: { "--swatch": t.color || null } }, [icon(t.icon)])
      : (t.color ? el("span", { class: "swatch-dot", "aria-hidden": "true", vars: { "--swatch": t.color } }) : null);
  };
}

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
        el("td", { "data-label": "Type" }, [
          a.accountType ? categoryLabel(a.accountType.name, a.accountType.color, a.accountType.icon) : el("span", { text: ACCOUNT_TYPE_LABELS[a.type] || a.type }),
          el("span", { class: "muted small", text: ` · ${a.currency}` }),
        ]),
        el("td", { "data-label": "Who can see it" }, [accessBadge(a)]),
        el("td", { "data-label": "Balance", class: "num" }, [a.balance !== undefined ? money(a.balance, a.currency, prefs) : el("span", { class: "muted small", text: "Not shared with you" })]),
        // BT-015 compact record actions menu (Terry, 2026-09-18): one "::" trigger per row, right-
        // aligned, replacing a row of separate buttons. Exact preserved order: Edit, Close (or
        // Reopen), Who can see this, Remove, Delete permanently — same permission checks, same
        // handlers, same confirmations, unchanged.
        el("td", { "data-label": "" }, [createActionsMenu({
          label: `Actions for ${a.name}`,
          items: [
            canManage(a, sharedLists) ? { text: "Edit", onClick: () => openEditAccount(ctx, a), attrs: { "aria-label": `Edit ${a.name}` } } : null,
            canManage(a, sharedLists) ? { text: a.status === "closed" ? "Reopen" : "Close", onClick: () => openLifecycle(ctx, a), attrs: { "aria-label": `${a.status === "closed" ? "Reopen" : "Close"} ${a.name}` } } : null,
            // BT-020-03/04 (Terry, 2026-09-19): manual interest, fees, payments/credits and balance
            // corrections on a debt (liability) account — the same canonical transactions API every
            // other entry uses, never a parallel payment system. Offered only where the account is
            // actually a debt account and the person may add entries to it.
            a.liability && a.capabilities.includes("create") ? { text: "Add interest charge", onClick: () => openDebtCharge(ctx, a, "interest"), attrs: { "aria-label": `Add interest charge to ${a.name}` } } : null,
            a.liability && a.capabilities.includes("create") ? { text: "Add fee", onClick: () => openDebtCharge(ctx, a, "fee"), attrs: { "aria-label": `Add fee to ${a.name}` } } : null,
            a.liability && a.capabilities.includes("create") ? { text: "Record payment or credit", onClick: () => openDebtPaymentOrCredit(ctx, a, accounts.data.accounts), attrs: { "aria-label": `Record a payment or credit on ${a.name}` } } : null,
            a.liability && a.capabilities.includes("create") ? { text: "Correct balance", onClick: () => openBalanceCorrection(ctx, a), attrs: { "aria-label": `Correct the balance of ${a.name}` } } : null,
            { text: "Who can see this", onClick: () => openWhoCanSee(ctx, a), attrs: { "aria-label": `Who can see ${a.name}` } },
            canManage(a, sharedLists) ? { text: "Remove", onClick: () => openRemove(ctx, a, afterRemove), attrs: { "aria-label": `Remove ${a.name}` } } : null,
            canManage(a, sharedLists) ? { text: "Delete permanently", danger: true, onClick: () => openPermanentDelete(ctx, a, state.selectedWorkspaceId, afterRemove), attrs: { "aria-label": `Permanently delete ${a.name}` } } : null,
          ],
        }).element]),
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
// Financial recheck of 41494d1, FA-2: a currently linked account keeps recording after it is removed
// (Shared expenses does not know), so the next time the person records their part there it lands on a
// different account instead — said explicitly, in addition to the usual entries wording.
const GROUP_LINKED_TEXT = "This account is linked in Shared expenses. If you record your part there again, it will be recorded on a different account.";

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
      account.groupLedgerLinked ? el("p", { text: GROUP_LINKED_TEXT }) : null,
      el("div", { class: "form-grid" }, [field("Reason", reason, { wide: true, help: empty ? "Kept with the account's history. Change it if you like." : "Required. It is kept with the account's history." })]),
    ],
    actions: [button("Cancel", () => modal.close()), closeInstead, confirm].filter(Boolean),
  });
}

// BT-014-04: permanent deletion, distinct from Remove above (which is recoverable). Reuses the one
// impact-review / double-confirmation dialog every record type shares.
function openPermanentDelete(ctx, account, wsId, onDeleted = () => {}) {
  openDeleteDialog(ctx, {
    title: `Permanently delete ${account.name}?`,
    wsIdForExport: wsId,
    fetchImpact: async () => (await ctx.api.permanentDeleteImpact("accounts", { workspaceId: wsId }, { accountId: account.id })).impact,
    execute: async (impact, typedConfirmation) => {
      const out = await ctx.store.actions.write(
        (ws) => ctx.api.permanentDeleteExecute("accounts", { workspaceId: ws }, { accountId: account.id, impactToken: impact.token, typedConfirmation }),
        ["accounts", "transactions", "bills", "group"],
      );
      if (!out.ok) throw out.error;
    },
    onDeleted,
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

// BT-020-03/04 (Terry, 2026-09-19): manual interest, fees, payments/credits and balance corrections
// on a debt (liability) account — the canonical transactions API (kind 'interest'/'fee'/'transfer'/
// 'refund'/'adjustment'), never a parallel payment system. A reason is required for an interest
// charge, a fee or a balance correction (enforced server-side; asked for here up front so it is
// never discovered only after Save).
const centsOfDecimal = (text) => { const n = Number.parseFloat(String(text || "0").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const decimalOfCents = (c) => (c / 100).toFixed(2);

function openDebtCharge(ctx, account, kind) {
  const label = kind === "interest" ? "interest charge" : "fee";
  const amount = input({ inputmode: "decimal", placeholder: "0.00", autocomplete: "off" });
  const date = input({ type: "date" });
  date.value = todayIso();
  const reason = input({ maxlength: "200", autocomplete: "off" });
  const confirm = button(`Add ${label}`, async () => {
    modal.setError("");
    if (!amount.value.trim()) { invalid(amount, `Enter the ${label} amount.`); return; }
    if (!reason.value.trim()) { invalid(reason, `Give a reason for this ${label}. It is kept with the entry's history.`); return; }
    modal.setBusy(true);
    const out = await ctx.store.actions.write(
      (ws) => ctx.api.createTransaction(ws, { accountId: account.id, kind, amount: amount.value.trim(), date: date.value, notes: reason.value.trim() }),
      ["accounts", "transactions"],
    );
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(`${label[0].toUpperCase()}${label.slice(1)} added to ${account.name}.`);
    modal.close();
  }, { variant: "primary" });
  const modal = openModal({
    title: `Add ${label} to ${account.name}`,
    body: [
      el("p", { text: `This increases what is owed on ${account.name}. It is dated, audited and kept in its history — never a silent change.` }),
      el("div", { class: "form-grid" }, [
        field(`Amount (${account.currency})`, amount), field("Date", date),
        field("Reason", reason, { wide: true, help: "Required. It is kept with the entry's history." }),
      ]),
    ],
    actions: [button("Cancel", () => modal.close()), confirm],
  });
  const invalid = (control, message) => { control.setAttribute("aria-invalid", "true"); control.setAttribute("aria-errormessage", modal.errorId); modal.setError(message); control.focus(); };
}

// "Record payments and credits" (Terry): a payment is a transfer from a funding account into this
// debt account (reduces what is owed); a credit is money returned directly to it (a refund, e.g. a
// merchant credit) — never conflated, and neither one requires a reason (unlike interest/fee/
// correction), matching every other ordinary transfer or refund elsewhere in the app.
function openDebtPaymentOrCredit(ctx, account, allAccounts) {
  const others = allAccounts.filter((a) => a.id !== account.id && a.currency === account.currency && a.status !== "closed" && a.capabilities.includes("create"));
  const mode = pickerSelect([
    { value: "payment", label: "Payment — from another account" },
    { value: "credit", label: "Credit — money returned directly to this account" },
  ], "payment", {}, { search: false });
  const fromAccount = pickerSelect(others.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), (others[0] || {}).id, {}, { placeholder: "Choose an account…" });
  const amount = input({ inputmode: "decimal", placeholder: "0.00", autocomplete: "off" });
  const date = input({ type: "date" });
  date.value = todayIso();
  const fromBox = el("div", { class: "form-grid" }, [field("Pay from", fromAccount)]);
  const syncMode = () => { fromBox.hidden = mode.value !== "payment"; };
  syncMode();
  mode.addEventListener("change", syncMode);
  const confirm = button("Save", async () => {
    modal.setError("");
    if (!amount.value.trim()) { invalid(amount, "Enter the amount."); return; }
    if (mode.value === "payment" && !fromAccount.value) { modal.setError("Choose the account this payment comes from."); return; }
    const body = mode.value === "payment"
      ? { accountId: fromAccount.value, kind: "transfer", amount: amount.value.trim(), date: date.value, transfer: { toAccountId: account.id } }
      : { accountId: account.id, kind: "refund", amount: amount.value.trim(), date: date.value };
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.createTransaction(ws, body), ["accounts", "transactions"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(`${mode.value === "payment" ? "Payment" : "Credit"} recorded on ${account.name}.`);
    modal.close();
  }, { variant: "primary" });
  const modal = openModal({
    title: `Record a payment or credit on ${account.name}`,
    body: [el("div", { class: "form-grid" }, [
      field("Kind", mode), fromBox,
      field(`Amount (${account.currency})`, amount), field("Date", date),
    ])],
    actions: [button("Cancel", () => modal.close()), confirm],
  });
  const invalid = (control, message) => { control.setAttribute("aria-invalid", "true"); control.setAttribute("aria-errormessage", modal.errorId); modal.setError(message); control.focus(); };
}

// BT-020-04: enter the desired balance, see the calculated adjustment and its accounting treatment,
// then confirm — never a silent overwrite of the balance, and never a rewrite of any entry already
// recorded (the correction is always a brand-new, separate 'adjustment' entry).
function openBalanceCorrection(ctx, account) {
  const desired = input({ inputmode: "decimal", placeholder: "0.00", autocomplete: "off" });
  desired.value = account.balance || "0.00";
  const reason = input({ maxlength: "200", autocomplete: "off" });
  const preview = el("p", { class: "field__help", role: "status" });
  const currentCents = centsOfDecimal(account.balance);
  const renderPreview = () => {
    const target = centsOfDecimal(desired.value);
    const delta = target - currentCents;
    if (delta === 0) { preview.textContent = `No change: ${account.name} is already at ${account.balance} ${account.currency}.`; return; }
    const direction = delta > 0 ? "increases" : "decreases";
    preview.textContent = `${account.name}: ${account.balance} → ${decimalOfCents(target)} ${account.currency}. This ${direction} the balance by ${decimalOfCents(Math.abs(delta))} ${account.currency}, recorded as one audited adjustment entry — nothing already recorded is changed.`;
  };
  desired.addEventListener("input", renderPreview);
  renderPreview();
  const confirm = button("Correct balance", async () => {
    modal.setError("");
    if (!desired.value.trim()) { invalid(desired, "Enter the desired balance."); return; }
    const delta = centsOfDecimal(desired.value) - currentCents;
    if (delta === 0) { announce("Nothing changed."); modal.close(); return; }
    if (!reason.value.trim()) { invalid(reason, "Give a reason for this correction. It is kept with the entry's history."); return; }
    modal.setBusy(true);
    const out = await ctx.store.actions.write(
      (ws) => ctx.api.createTransaction(ws, { accountId: account.id, kind: "adjustment", amount: decimalOfCents(delta), date: todayIso(), notes: reason.value.trim() }),
      ["accounts", "transactions"],
    );
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(`${account.name}'s balance corrected.`);
    modal.close();
  }, { variant: "primary" });
  const modal = openModal({
    title: `Correct the balance of ${account.name}`,
    body: [
      el("p", { text: `Current balance: ${account.balance} ${account.currency}.` }),
      el("div", { class: "form-grid" }, [
        field(`Desired balance (${account.currency})`, desired),
        field("Reason", reason, { wide: true, help: "Required. It is kept with the entry's history." }),
      ]),
      preview,
    ],
    actions: [button("Cancel", () => modal.close()), confirm],
  });
  const invalid = (control, message) => { control.setAttribute("aria-invalid", "true"); control.setAttribute("aria-errormessage", modal.errorId); modal.setError(message); control.focus(); };
}

// Every currently-editable field (BT-006): name, institution, account number, opening balance and
// date (locked once the account has a reconciled entry), icon, notes, and — for loans and credit
// cards — the terms. Type and currency are editable too, but only while nothing has been recorded
// against the account yet (Terry, 2026-09-17: "to minimize deleting... edit account type,
// currency") — the same boundary as account deletion eligibility (BT-006-05, `account.hasEntries`
// already returned by the API); once anything is recorded they lock, since every entry and rule on
// the account depends on them. Every change is kept in the account's history with the reason
// (BT-011-05, BT-001-05).
function openEditAccount(ctx, account) {
  const locked = !!account.reconciledLocked;
  const typeCurrencyEditable = account.hasEntries === false;
  const name = input({ required: true, maxlength: "80", value: account.name, autocomplete: "off" });
  // BT-019-02: the workspace's own account types (system and custom, name/colour/icon) are offered
  // once loaded; the account's own current type record — even a retired one — always stays a valid
  // choice so the picker never silently drops it. `typeChoices` null means the slice has not loaded
  // (or, in a test double, does not exist at all): the fixed accounting-class list is offered
  // exactly as it always has been, `type` sent exactly as before — nothing about that path changes.
  const typeChoices = typeCurrencyEditable ? accountTypeChoices(ctx.store.getState(), account.accountTypeId) : null;
  const currentTypeId = account.accountTypeId || (typeChoices ? (typeChoices.find((t) => t.system && t.accountingClass === account.type) || {}).id : null);
  const typePick = !typeCurrencyEditable ? null
    : typeChoices
      ? pickerSelect(typeChoices.map((t) => ({ value: t.id, label: t.name })), currentTypeId || typeChoices[0].id, {}, { search: false, badgeOf: accountTypeBadges(typeChoices) })
      : pickerSelect(Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label })), account.type, {}, { search: false, badgeOf: (v) => icon(defaultIconFor("account", v)) });
  // The accounting class implied by whatever is currently picked — what terms/icon defaults and the
  // "did the underlying behaviour change" checks below actually depend on, never the raw picker value
  // once that value is a type id rather than a class.
  const classOf = new Map((typeChoices || []).map((t) => [t.id, t.accountingClass]));
  const pickedClass = () => (!typePick ? account.type : typeChoices ? (classOf.get(typePick.value) || account.type) : typePick.value);
  const currencyPick = typeCurrencyEditable ? pickerSelect(CURRENCIES.map((c) => ({ value: c, label: c })), account.currency) : null;
  const institution = input({ maxlength: "80", value: account.institution || "", autocomplete: "off" });
  const last = input({ inputmode: "numeric", maxlength: "4", placeholder: "Last 2–4 digits only", value: account.maskedNumber || "", autocomplete: "off" });
  const opening = input({ inputmode: "decimal", placeholder: "0.00", value: account.openingBalance || "", disabled: locked });
  const openingDate = input({ type: "date", value: account.openingDate || "", disabled: locked });
  const notes = el("textarea", { class: "field__input", maxlength: "5000", text: account.notes || "" });
  const chosen = account.iconSource === "record" ? account.icon : null;
  const iconPick = createIconPicker({ value: chosen, inherited: chosen ? defaultIconFor("account", account.type) : account.icon, name: account.name });
  const reason = input({ maxlength: "200", placeholder: "Optional", autocomplete: "off" });
  // Terms are type-specific (credit limit, APR, ...): if the type picker changes, the terms shown
  // must follow the NEWLY chosen type's accounting class, not the account's original one, or the
  // form would offer fields the server would refuse (and drop any it no longer recognises) for the
  // class about to be saved. Rebuilt in place whenever the type selection changes.
  const termsBox = el("div");
  let terms = termsControls(pickedClass(), account.terms);
  let initialTerms = terms ? JSON.stringify(canonicalTerms(account.type, account.terms)) : null;
  const renderTerms = () => {
    mount(termsBox, terms ? el("fieldset", { class: "form-grid budget-line field--wide" }, [el("legend", { class: "field__label", text: terms.legend }), ...terms.fields]) : null);
  };
  if (typePick) {
    typePick.addEventListener("change", () => {
      // A class change (this session's own case) clears terms server-side too — the form mirrors
      // that rather than offering stale, possibly-invalid fields for the new class.
      const cls = pickedClass();
      terms = cls === account.type ? termsControls(account.type, account.terms) : termsControls(cls, null);
      initialTerms = cls === account.type && terms ? JSON.stringify(canonicalTerms(account.type, account.terms)) : (terms ? JSON.stringify(terms.collect()) : null);
      renderTerms();
    });
  }
  renderTerms();
  const save = button("Save changes", async () => {
    modal.setError("");
    if (!name.value.trim()) { name.setAttribute("aria-invalid", "true"); name.setAttribute("aria-errormessage", modal.errorId); modal.setError("Give the account a name."); name.focus(); return; }
    const body = { accountId: account.id, revision: account.revision };
    if (name.value.trim() !== account.name) body.name = name.value.trim();
    const classChanged = !!typePick && pickedClass() !== account.type;
    if (typePick) {
      if (typeChoices) { if (typePick.value !== currentTypeId) body.accountTypeId = typePick.value; }
      else if (typePick.value !== account.type) body.type = typePick.value;
    }
    if (currencyPick && currencyPick.value !== account.currency) body.currency = currencyPick.value;
    if (institution.value.trim() !== (account.institution || "")) body.institution = institution.value.trim();
    if (last.value.trim() !== (account.maskedNumber || "")) body.maskedNumber = last.value.trim();
    if (!locked && opening.value.trim() !== (account.openingBalance || "")) body.openingBalance = opening.value.trim() || "0";
    if (!locked && openingDate.value !== (account.openingDate || "")) body.openingDate = openingDate.value;
    if (notes.value !== (account.notes || "")) body.notes = notes.value;
    const icon = iconChange(chosen, iconPick.getValue());
    if (icon !== undefined) body.icon = icon;
    // Terms are sent explicitly only when the underlying accounting class is NOT also changing (a
    // class change already clears/reapplies terms server-side); when it is, and the user configured
    // new terms for the new class in this same save, those are sent too.
    if (terms && (classChanged || (() => { const current = JSON.stringify(terms.collect()); return current !== initialTerms; })())) {
      body.terms = terms.collect();
    }
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
    body: [el("div", { class: "form-grid" }, [
      field("Name", name),
      typePick
        ? field("Type", typePick, { help: TYPE_CURRENCY_EDITABLE })
        : field("Type", input({ readonly: true, value: (account.accountType && account.accountType.name) || ACCOUNT_TYPE_LABELS[account.type] || account.type }), { help: TYPE_CURRENCY_LOCKED }),
      currencyPick
        ? field("Currency", currencyPick, { help: TYPE_CURRENCY_EDITABLE })
        : field("Currency", input({ readonly: true, value: account.currency }), { help: TYPE_CURRENCY_LOCKED }),
      field("Institution", institution),
      field("Account number", last, { help: "Never store a full account or card number." }),
      field("Opening balance", opening, { help: locked ? OPENING_LOCKED : "Loans and other debts: enter the amount owed as a negative number, e.g. -20000.00." }),
      field("Opening date", openingDate, locked ? { help: OPENING_LOCKED } : {}),
      iconPick.element,
      field("Notes", notes, { wide: true }),
      termsBox,
      field("Reason for this change", reason, { wide: true }),
    ])],
    actions: [button("Cancel", () => modal.close()), save],
  });
}

function openAddAccount(ctx) {
  const key = newIdempotencyKey();
  const name = input({ required: true, maxlength: "80" });
  // The dropdowns are TaskTracker's command picker (BT-004-05). Each type shows the icon an account
  // of that type gets by default (BT-011-05), beside its name. BT-019-02: the workspace's own
  // account types (system and custom) are offered once loaded — see accountTypeChoices' own comment
  // for the exact, test-preserving fallback to the fixed list when they are not.
  const typeChoices = accountTypeChoices(ctx.store.getState());
  const classOf = new Map((typeChoices || []).map((t) => [t.id, t.accountingClass]));
  const pickedClass = (value) => (typeChoices ? (classOf.get(value) || "checking") : value);
  const type = typeChoices
    ? pickerSelect(typeChoices.map((t) => ({ value: t.id, label: t.name })), (typeChoices.find((t) => t.accountingClass === "checking") || typeChoices[0]).id, {}, { search: false, badgeOf: accountTypeBadges(typeChoices) })
    : pickerSelect(Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label })), "checking", {}, { search: false, badgeOf: (v) => icon(defaultIconFor("account", v)) });
  // The "Default" icon follows the chosen type's accounting class (BT-011-05).
  const iconBox = el("div");
  let iconPick = null;
  const makeIconPicker = (value = null) => { iconPick = createIconPicker({ value, inherited: defaultIconFor("account", pickedClass(type.value)), name: "New account" }); mount(iconBox, iconPick.element); };
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
    const body = { name: name.value, currency: currency.value, visibility: visibility.value, openingDate: openingDate.value };
    if (typeChoices) body.accountTypeId = type.value; else body.type = type.value;
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

// A minimal, self-contained "quick add account" form (BT-014-09, Terry, 2026-09-17: "I should be
// able to add an account from the add bill modal > Account, same same type and features that drop
// down as when I select workspaces") — the same "+ New X" pinned action already used by the
// workspace picker (`enhanceSelect`'s `create` option, `app/js/ui/selectpicker.js`), reused for
// account pickers wherever it makes sense to add one without losing what's already been typed
// elsewhere in the surrounding form. Just the essentials (name, type, currency, visibility) — full
// details (institution, account number, opening balance/date) can be filled in afterward from the
// Accounts page; this exists to unblock "I need an account that doesn't exist yet" mid-flow, not to
// replace the full Add Account form. Returns a DOM node ready to mount; `onCreated(account)` fires
// with the server's own account view on success, `onCancel()` if the person backs out.
export function quickAddAccountForm(ctx, { name: initialName = "", onCreated, onCancel }) {
  const key = newIdempotencyKey();
  const name = input({ required: true, maxlength: "80", value: initialName, autocomplete: "off" });
  // BT-019-02: same merged system+custom type list as the full Add Account form, with the same
  // test-preserving fallback to the fixed list when the workspace's own types have not loaded.
  const typeChoices = accountTypeChoices(ctx.store.getState());
  const type = typeChoices
    ? pickerSelect(typeChoices.map((t) => ({ value: t.id, label: t.name })), (typeChoices.find((t) => t.accountingClass === "checking") || typeChoices[0]).id, {}, { search: false, badgeOf: accountTypeBadges(typeChoices) })
    : pickerSelect(Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label })), "checking", {}, { search: false, badgeOf: (v) => icon(defaultIconFor("account", v)) });
  const currency = pickerSelect(CURRENCIES.map((c) => ({ value: c, label: c })), (ctx.store.getState().workspaces.find((w) => w.id === ctx.store.getState().selectedWorkspaceId) || {}).reportingCurrency || "EUR");
  const visibility = pickerSelect([{ value: "private", label: "Private — only you (you can share it later)" }, { value: "shared", label: "Shared — every workspace member per their role" }], "private", {}, { search: false });
  const errorBox = el("p", { class: "state state--error", role: "alert", hidden: true });
  const create = button("Create account", async () => {
    errorBox.hidden = true;
    if (!name.value.trim()) {
      name.setAttribute("aria-invalid", "true");
      errorBox.textContent = "Give the account a name.";
      errorBox.hidden = false;
      name.focus();
      return;
    }
    create.disabled = true;
    cancel.disabled = true;
    const body = { name: name.value.trim(), currency: currency.value, visibility: visibility.value };
    if (typeChoices) body.accountTypeId = type.value; else body.type = type.value;
    const out = await ctx.store.actions.write((ws) => ctx.api.createAccount(ws, body, key), ["accounts"]);
    create.disabled = false;
    cancel.disabled = false;
    if (!out.ok) { errorBox.textContent = messageFor(out.error); errorBox.hidden = false; return; }
    announce(`Account “${out.result.account.name}” created.`);
    onCreated(out.result.account);
  }, { variant: "primary" });
  const cancel = button("Cancel", () => onCancel());
  return el("div", { class: "stack" }, [
    el("div", { class: "form-grid" }, [
      field("Name", name), field("Type", type), field("Currency", currency),
      field("Who can see it", visibility, { wide: true }),
    ]),
    errorBox,
    el("div", { class: "row" }, [cancel, create]),
  ]);
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
