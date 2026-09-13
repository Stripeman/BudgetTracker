// Shared expenses (BT-009): who paid, who shared, balances, suggested payments and the payments
// people report and confirm. A group needs no account (Terry, 2026-09-14): an expense records who
// paid and who shared, nothing more. Anyone who paid may ALSO record it on an account of their own;
// only they ever see which one.
//
// Money direction follows Terry's rule: an arrow shows only money coming in (up) or going out (down)
// for the person looking, never both ways. Everything is also said in words.
//
// Selects are kept simple (select() and commitOnConfirm) so they can move to TaskTracker's command
// picker later without changing behaviour.
import { el, mount, announce } from "../dom.js";
import { stateView, button, field, input, select, badge, amountText, commitOnConfirm, uid } from "../components.js";
import { openModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { evaluateAmount, isPlainAmount } from "../../core/calc.js";
import { formatAmount, formatDate, todayIso } from "../../core/format.js";
import { previewSplit, precisionOf, formatMinor, parseAmount } from "../../core/split.js";
import { icon, withIcon } from "../icons.js";
import { messageFor } from "../../core/errors.js";

export const METHOD_LABELS = Object.freeze({ equal: "Equally", amounts: "By amounts", percentages: "By percentages", shares: "By shares" });
const VALUE_LABELS = { amounts: "Amount for", percentages: "Percent for", shares: "Shares for" };
const VALUE_HINTS = { amounts: "0.00", percentages: "%", shares: "1" };
const STATUS_LABELS = { reported: "Reported", confirmed: "Confirmed", disputed: "Disputed" };
const EVENT_LABELS = { create: "Added", update: "Corrected", void: "Voided", reported: "Reported as paid", confirmed: "Confirmed as received", disputed: "Disputed" };
const FIELD_LABELS = { description: "Description", date: "Date", amountMinor: "Amount", categoryId: "Category", notes: "Notes", payers: "Paid by", split: "Split", shares: "Shares", status: "Status" };

const titled = (id, iconId, text) => el("h2", { class: "card__title", id }, [withIcon(iconId, text)]);
const groupData = (state) => sliceFor(state, "group").data || null;
const namesOf = (data) => new Map((data.participants || []).map((p) => [p.ref, p.name]));
const fmtFor = (state) => {
  const effective = ((state.preferences || {}).effective) || {};
  return (decimal, currency) => formatAmount(decimal, currency, { numberFormat: effective.numberFormat });
};
const isZero = (decimal) => /^-?0(\.0+)?$/.test(String(decimal || "0"));
const stampOf = (iso) => String(iso || "").replace("T", " ").slice(0, 16);
// The arrow for the person looking: in (up) or out (down), never both ways (Terry, 2026-09-13).
const arrow = (dir) => el("span", { class: `dir dir--${dir}` }, [icon(dir)]);

// Accounts where this person may record a shared expense or repayment: open, their right to add
// entries, and in the same currency.
export function ledgerAccounts(state, currency) {
  const data = sliceFor(state, "accounts").data;
  return ((data && data.accounts) || []).filter((a) => !a.deletedAt && a.status !== "closed" && a.capabilities.includes("create") && a.currency === currency);
}

// The balance of one person in words, with the arrow for money coming to them or going from them.
// `self` words it for the person looking ("get back", "owe"); `subject` puts a subject in front
// ("You get back EUR 217.66").
export function balanceLabel(row, currency, fmt, { self = false, subject = "" } = {}) {
  const lead = subject ? `${subject} ` : "";
  if (isZero(row.net)) return el("span", { class: "muted", text: subject ? `${lead}${self ? "are" : "is"} settled up` : "Settled up" });
  const gets = !String(row.net).startsWith("-");
  const amount = fmt(String(row.net).replace(/^-/, ""), currency);
  const verb = gets ? (self ? "get back" : "gets back") : (self ? "owe" : "owes");
  return el("span", { class: "amount-dir" }, [arrow(gets ? "money-in" : "money-out"), el("span", { text: `${lead}${verb} ${amount}` })]);
}

export function createView(ctx) {
  const actions = el("div", { class: "page-head__actions" });
  const intro = el("p", { class: "muted" });
  const needs = el("div");
  const balancesBox = el("div");
  const settleBox = el("div");
  const expensesBox = el("div");
  const paymentsBox = el("div");
  let mode = "suggested";
  const element = el("section", {}, [
    el("div", { class: "page-head" }, [el("h1", { text: "Shared expenses" }), actions]),
    intro,
    el("div", { class: "stack" }, [
      needs,
      // Full width: the balances table has seven columns (half width clipped the balance itself).
      el("section", { class: "card", "aria-labelledby": "grp-balances" }, [titled("grp-balances", "scale", "Balances"), balancesBox]),
      el("section", { class: "card", "aria-labelledby": "grp-settle" }, [titled("grp-settle", "users", "Settle up"), settleBox]),
      el("section", { class: "card", "aria-labelledby": "grp-expenses" }, [titled("grp-expenses", "receipt", "Expenses"), expensesBox]),
      el("section", { class: "card", "aria-labelledby": "grp-payments" }, [titled("grp-payments", "coins", "Payments"), paymentsBox]),
    ]),
  ]);
  void ctx.store.actions.refreshGroup();

  function update(state) {
    const slice = sliceFor(state, "group");
    const data = slice.data;
    const loading = stateView(slice);
    if (loading && !data) { mount(actions); mount(needs); mount(balancesBox, loading); mount(settleBox); mount(expensesBox); mount(paymentsBox); return; }
    const fmt = fmtFor(state);
    const names = namesOf(data);
    const me = data.permissions.selfRef;
    const nameOf = (ref) => (ref === me ? "You" : names.get(ref) || "Someone");
    const effective = ((state.preferences || {}).effective) || {};
    mount(actions, ...(data.permissions.canAdd ? [
      button("Add expense", () => openGroupExpense(ctx), { variant: "primary" }),
      button("Record a payment", () => openRecordPayment(ctx)),
    ] : [el("p", { class: "muted small", text: "You can see this group's expenses but not add or change them." })]));
    intro.textContent = "Record who paid and who shared. No bank account is needed; balances show who owes whom.";

    // Entries on the person's own account that no longer match what the group records.
    const review = [...data.expenses.map((e) => ["expense", e]), ...data.settlements.map((s) => ["settlement", s])].filter(([, r]) => r.myLedger && r.myLedger.needsReview && !r.myLedger.accountUnavailable);
    mount(needs, review.length ? el("section", { class: "notice notice--warning", "aria-labelledby": "grp-review" }, [
      titled("grp-review", "alert", "Your account needs updating"),
      el("ul", { class: "stack" }, review.map(([type, r]) => el("li", { class: "row" }, [
        el("span", { text: `${type === "expense" ? `“${r.description}”` : "A payment you received"} changed after you recorded it on ${r.myLedger.accountName}.` }),
        button("Update my account", () => void syncMine(ctx, type, r), { small: true, attrs: { "aria-label": `Update my account for ${type === "expense" ? r.description : "this payment"}` } }),
      ]))),
    ]) : null);

    const table = data.balances.find((b) => b.currency === data.currency) || data.balances[0];
    renderBalances(table, data, fmt, nameOf);
    renderSettle(table, data, fmt, nameOf, me);
    renderExpenses(data, fmt, nameOf, me, effective.dateFormat, state);
    renderPayments(data, fmt, nameOf, me, effective.dateFormat, state);
  }

  function renderBalances(table, data, fmt, nameOf) {
    const active = new Set(data.participants.filter((p) => p.active).map((p) => p.ref));
    const rows = table ? table.rows.filter((r) => active.has(r.ref) || !isZero(r.paid) || !isZero(r.share) || !isZero(r.net)) : [];
    if (!rows.length) { mount(balancesBox, el("div", { class: "state", text: "No one is in this group yet." })); return; }
    const c = table.currency;
    mount(balancesBox,
      el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards" }, [
        el("caption", { class: "sr-only", text: `Balances in ${c}. Paid minus share, plus payments made, minus payments received.` }),
        el("thead", {}, [el("tr", {}, ["Person", "Paid", "Share", "Paid back", "Received", "Balance", "Not counted yet"].map((h, i) => el("th", { scope: "col", class: i && i < 6 ? "num" : "", text: h })))]),
        el("tbody", {}, rows.map((r) => {
          const pending = [!isZero(r.pendingOut) ? `${fmt(r.pendingOut, c)} reported as paid` : null, !isZero(r.pendingIn) ? `${fmt(r.pendingIn, c)} reported to them` : null,
            !isZero(r.disputedOut) || !isZero(r.disputedIn) ? `${fmt(isZero(r.disputedOut) ? r.disputedIn : r.disputedOut, c)} disputed` : null].filter(Boolean);
          return el("tr", {}, [
            el("th", { scope: "row", "data-label": "Person" }, [
              el("span", { text: nameOf(r.ref) }),
              r.expenses.length ? el("details", { class: "breakdown-details" }, [
                el("summary", { class: "small", text: `Expenses behind this (${r.expenses.length})` }),
                el("ul", { class: "breakdown" }, r.expenses.map((x) => el("li", {}, [el("span", { text: `${x.date} ${x.description}` }), el("span", { class: "num", text: `paid ${fmt(x.paid, c)} · share ${fmt(x.share, c)}` })]))),
              ]) : null,
            ]),
            el("td", { "data-label": "Paid", class: "num" }, [amountText(r.paid, c)]),
            el("td", { "data-label": "Share", class: "num" }, [amountText(r.share, c)]),
            el("td", { "data-label": "Paid back", class: "num" }, [amountText(r.paidOut, c)]),
            el("td", { "data-label": "Received", class: "num" }, [amountText(r.received, c)]),
            el("td", { "data-label": "Balance", class: "num" }, [balanceLabel(r, c, fmt, { self: r.ref === data.permissions.selfRef })]),
            el("td", { "data-label": "Not counted yet", class: "small" }, [pending.length ? el("span", { class: "muted", text: pending.join("; ") }) : el("span", { class: "muted", text: "—" })]),
          ]);
        })),
      ])]),
      el("p", { class: "card__meta", text: "Balance = paid − share + payments made − payments received. Only confirmed payments count." }),
    );
  }

  function renderSettle(table, data, fmt, nameOf, me) {
    const c = table ? table.currency : data.currency;
    const toggle = (value, label) => el("button", { type: "button", class: "btn btn--small", "aria-pressed": mode === value ? "true" : "false", text: label, onClick: () => { mode = value; update(ctx.store.getState()); } });
    const list = table ? (mode === "suggested" ? table.suggestions : table.direct) : [];
    mount(settleBox,
      el("div", { class: "seg", role: "group", "aria-label": "How to settle" }, [toggle("suggested", "Fewest payments"), toggle("direct", "Keep who owes whom")]),
      el("p", { class: "muted small", text: mode === "suggested" ? "The fewest payments that settle everyone." : "Each person pays back the people who paid for them, without passing debts along." }),
      list.length ? el("ul", { class: "stack" }, list.map((s) => el("li", { class: "row" }, [
        s.from === me ? arrow("money-out") : s.to === me ? arrow("money-in") : null,
        el("span", { text: `${nameOf(s.from)} ${s.from === me ? "pay" : "pays"} ${s.to === me ? "you" : nameOf(s.to)}` }),
        el("span", { class: "app__spacer" }),
        amountText(s.amount, c),
        data.permissions.canAdd ? button("Record payment", () => openRecordPayment(ctx, { from: s.from, to: s.to, amount: s.amount }), { small: true, attrs: { "aria-label": `Record payment of ${fmt(s.amount, c)} from ${nameOf(s.from)} to ${nameOf(s.to)}` } }) : null,
      ]))) : el("div", { class: "state", text: "Everyone is settled up." }),
      el("p", { class: "card__meta", text: data.basis }),
    );
  }

  function renderExpenses(data, fmt, nameOf, me, dateFormat, state) {
    if (!data.expenses.length) {
      mount(expensesBox, el("div", { class: "state", text: data.permissions.canAdd ? "No shared expenses yet. Use “Add expense” to record one — no account is needed." : "No shared expenses yet." }));
      return;
    }
    const mineAccounts = ledgerAccounts(state, data.currency);
    mount(expensesBox, el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards" }, [
      el("caption", { class: "sr-only", text: `${data.expenses.length} shared expenses` }),
      el("thead", {}, [el("tr", {}, ["Date", "Expense", "Paid by", "Amount", "Your share", "Actions"].map((h) => el("th", { scope: "col", class: h === "Amount" || h === "Your share" ? "num" : "", text: h })))]),
      el("tbody", {}, data.expenses.map((e) => {
        const void_ = e.status === "void";
        const myShare = e.shares.find((s) => s.ref === me);
        const paidByMe = e.payers.some((p) => p.ref === me);
        return el("tr", { class: void_ ? "row--void" : "" }, [
          el("th", { scope: "row", "data-label": "Date", text: formatDate(e.date, dateFormat) }),
          el("td", { "data-label": "Expense" }, [
            el("span", { text: e.description }),
            void_ ? [" ", badge("Voided", "closed")] : null,
            void_ ? el("div", { class: "muted small", text: `Voided by ${e.voidedBy || "someone"}: ${e.voidReason}` }) : null,
            e.myLedger && !e.myLedger.accountUnavailable ? el("div", { class: "muted small", text: `Also on your account: ${e.myLedger.accountName}` }) : null,
          ].flat()),
          el("td", { "data-label": "Paid by", text: e.payers.map((p) => (e.payers.length > 1 ? `${nameOf(p.ref)} ${fmt(p.amount, e.currency)}` : nameOf(p.ref))).join(", ") }),
          el("td", { "data-label": "Amount", class: "num" }, [amountText(e.amount, e.currency)]),
          el("td", { "data-label": "Your share", class: "num" }, [myShare ? amountText(myShare.amount, e.currency) : el("span", { class: "muted", text: "—" })]),
          el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
            e.canEdit ? button("Edit", () => openGroupExpense(ctx, { expense: e }), { small: true, attrs: { "aria-label": `Edit ${e.description}` } }) : null,
            e.canVoid ? button("Void", () => openVoid(ctx, "expense", e), { small: true, variant: "danger", attrs: { "aria-label": `Void ${e.description}` } }) : null,
            !void_ && paidByMe && !e.myLedger && mineAccounts.length && data.permissions.canAdd ? button("Record on my account", () => openLedgerChoice(ctx, "expense", e), { small: true, attrs: { "aria-label": `Record ${e.description} on my account` } }) : null,
            e.amendmentCount || void_ ? button("History", () => void openHistory(ctx, "expense", e), { small: true, attrs: { "aria-label": `History of ${e.description}` } }) : null,
          ])]),
        ]);
      })),
    ])]));
  }

  function renderPayments(data, fmt, nameOf, me, dateFormat, state) {
    if (!data.settlements.length) { mount(paymentsBox, el("div", { class: "state", text: "No payments recorded yet. Recording one does not move money; it records what someone paid." })); return; }
    const mineAccounts = ledgerAccounts(state, data.currency);
    mount(paymentsBox, el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards" }, [
      el("caption", { class: "sr-only", text: `${data.settlements.length} payments` }),
      el("thead", {}, [el("tr", {}, ["Date", "Payment", "Amount", "Status", "Actions"].map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
      el("tbody", {}, data.settlements.map((s) => {
        const label = `${nameOf(s.from)} paid ${s.to === me ? "you" : nameOf(s.to)}`;
        const status = s.voided ? badge("Voided", "closed") : badge(STATUS_LABELS[s.status] || s.status, s.status === "disputed" ? "overdue" : "");
        const detail = s.voided ? `Voided: ${s.voidReason}` : s.status === "reported" ? `Waiting for ${s.to === me ? "you" : nameOf(s.to)} to confirm it arrived.` : s.status === "disputed" ? `Disputed: ${s.disputeReason}` : null;
        return el("tr", { class: s.voided ? "row--void" : "" }, [
          el("th", { scope: "row", "data-label": "Date", text: formatDate(s.date, dateFormat) }),
          el("td", { "data-label": "Payment" }, [el("span", { text: label }), s.method ? el("div", { class: "muted small", text: s.method }) : null]),
          el("td", { "data-label": "Amount", class: "num" }, [el("span", { class: "amount-dir" }, [s.from === me ? arrow("money-out") : s.to === me ? arrow("money-in") : null, amountText(s.amount, s.currency)])]),
          el("td", { "data-label": "Status" }, [status, detail ? el("div", { class: "muted small", text: detail }) : null,
            s.myLedger && !s.myLedger.accountUnavailable ? el("div", { class: "muted small", text: `Also on your account: ${s.myLedger.accountName}` }) : null]),
          el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
            s.canConfirm ? button("Confirm", () => openConfirm(ctx, s, nameOf), { small: true, variant: "primary", attrs: { "aria-label": `Confirm ${label}` } }) : null,
            s.canDispute ? button("Dispute", () => openDispute(ctx, s, nameOf), { small: true, attrs: { "aria-label": `Dispute ${label}` } }) : null,
            !s.voided && s.status === "confirmed" && s.to === me && !s.myLedger && mineAccounts.length && data.permissions.canAdd ? button("Record on my account", () => openLedgerChoice(ctx, "settlement", s), { small: true, attrs: { "aria-label": `Record ${label} on my account` } }) : null,
            s.canVoid ? button("Void", () => openVoid(ctx, "settlement", s), { small: true, variant: "danger", attrs: { "aria-label": `Void ${label}` } }) : null,
            button("History", () => void openHistory(ctx, "settlement", s), { small: true, attrs: { "aria-label": `History of ${label}` } }),
          ])]),
        ]);
      })),
    ])]));
  }

  return { element, update };
}

const REFRESH = ["group", "accounts", "transactions"];

async function syncMine(ctx, type, rec) {
  const out = await ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "ledger", type === "expense" ? { expenseId: rec.id } : { settlementId: rec.id }), REFRESH);
  announce(out.ok ? "Your account now matches." : messageFor(out.error));
}

// ---- Add or correct an expense -------------------------------------------------------------------
// Everyone who can take part is listed once under "Paid by" and once under "Shared by", with a
// checkbox each. A live preview shows each share and any rounding adjustment, and every problem is
// said inside the dialog before anything is sent.
export function openGroupExpense(ctx, { expense = null } = {}) {
  const state = ctx.store.getState();
  const data = groupData(state);
  if (!data) { announce("Shared expenses are still loading. Try again in a moment."); void ctx.store.actions.refreshGroup(); return null; }
  const editing = !!expense;
  const currency = editing ? expense.currency : data.currency;
  const me = data.permissions.selfRef;
  const fmt = fmtFor(state);
  const money = (minor) => fmt(formatMinor(minor, currency), currency);
  // People who can be chosen now, plus (when correcting) anyone already on the expense.
  const onExpense = new Set(editing ? [...expense.payers.map((p) => p.ref), ...expense.shares.map((s) => s.ref)] : []);
  const people = data.participants.filter((p) => p.active || onExpense.has(p.ref));
  const label = (p) => `${p.name}${p.self ? " (you)" : ""}`;
  const key = newIdempotencyKey();
  let last = null;

  const description = input({ maxlength: "120", autocomplete: "off", required: true, placeholder: "For example: Dinner at the harbour", value: editing ? expense.description : "" });
  const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00 or 12.50+3.20", value: editing ? expense.amount : "" });
  const amountHelp = el("p", { class: "field__help", "aria-live": "polite" });
  const date = input({ type: "date", value: editing ? expense.date : todayIso() });
  const categories = ((sliceFor(state, "categories").data || {}).categories || []).filter((c) => (!c.archived && c.type !== "income") || (editing && c.id === expense.categoryId));
  const category = select([{ value: "", label: "No category" }].concat(categories.map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name }))), editing ? expense.categoryId || "" : "");
  const notes = el("textarea", { class: "field__input", maxlength: "2000", text: editing ? expense.notes : "" });
  const reason = input({ maxlength: "200", autocomplete: "off", placeholder: "Why is this being corrected?" });

  // Paid by.
  const paid = new Map(editing ? expense.payers.map((p) => [p.ref, expense.payers.length > 1 ? p.amount : ""]) : [[me, ""]]);
  const payerRows = people.map((p) => {
    const box = el("input", { type: "checkbox", id: uid("payer"), class: "split-row__box" });
    box.checked = paid.has(p.ref);
    const amt = input({ inputmode: "decimal", autocomplete: "off", "aria-label": `Amount paid by ${p.name}`, placeholder: "0.00", value: paid.get(p.ref) || "" });
    return { p, box, amt, row: el("div", { class: "split-row" }, [box, el("label", { for: box.id, text: label(p) }), amt]) };
  });
  const payersNote = el("p", { class: "field__help" });

  // Shared by.
  const values = new Map(editing ? expense.split.lines.map((l) => [l.ref, l.value === null || l.value === undefined ? "" : String(l.value)]) : []);
  const method = select(Object.entries(METHOD_LABELS).map(([value, text]) => ({ value, label: text })), editing ? expense.split.method : "equal");
  const splitRows = people.map((p) => {
    const box = el("input", { type: "checkbox", id: uid("share"), class: "split-row__box" });
    box.checked = editing ? values.has(p.ref) : !!p.active;
    const val = input({ inputmode: "decimal", autocomplete: "off", value: values.get(p.ref) || "" });
    const out = el("span", { class: "num split-row__share" });
    return { p, box, val, out, row: el("div", { class: "split-row" }, [box, el("label", { for: box.id, text: label(p) }), val, out]) };
  });
  const everyone = button("Everyone", () => { for (const r of splitRows) r.box.checked = r.p.active || r.box.checked; refresh(); }, { small: true, attrs: { "aria-label": "Share with everyone" } });
  const preview = el("div", { class: "split-preview", "aria-live": "polite" });
  const problems = el("ul", { class: "split-problems error-text", "aria-live": "polite" });

  // Optionally also on the person's own account (never when correcting; that has its own action).
  const mine = editing ? [] : ledgerAccounts(state, currency);
  const ledgerBox = el("input", { type: "checkbox", id: `${key}-ledger` });
  const ledgerAccount = select(mine.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), (mine[0] || {}).id);
  const ledgerField = el("fieldset", { class: "plain-fieldset field--wide" }, [
    el("legend", { class: "field__label", text: "Your own account (optional)" }),
    el("div", { class: "field--inline" }, [ledgerBox, el("label", { for: ledgerBox.id, text: "Also record what I paid on my account" })]),
    field("Account", ledgerAccount),
    el("p", { class: "field__help", text: "What you paid is taken from this account: your share as spending, the rest as money you lent, which the others owe you back. Only you see which account." }),
  ]);

  function computedAmount() {
    const raw = amount.value.trim();
    if (!raw) return "";
    if (isPlainAmount(raw)) return raw;
    return evaluateAmount(raw, precisionOf(currency)) || "";
  }
  function snapshot() {
    return {
      amount: computedAmount(), currency, method: method.value,
      payers: payerRows.filter((r) => r.box.checked).map((r) => ({ ref: r.p.ref, name: r.p.name, amount: r.amt.value })),
      lines: splitRows.filter((r) => r.box.checked).map((r) => ({ ref: r.p.ref, name: r.p.name, value: r.val.value })),
    };
  }
  function refresh() {
    const m = method.value;
    const payersChosen = payerRows.filter((r) => r.box.checked);
    const several = payersChosen.length > 1;
    for (const r of payerRows) r.amt.hidden = !(several && r.box.checked);
    payersNote.textContent = several ? "Enter what each of them paid; together it must be the full amount." : payersChosen.length === 1 ? `${label(payersChosen[0].p)} paid the full amount.` : "";
    for (const r of splitRows) {
      r.val.hidden = m === "equal" || !r.box.checked;
      r.val.setAttribute("aria-label", `${VALUE_LABELS[m] || "Value for"} ${r.p.name}`);
      r.val.setAttribute("placeholder", VALUE_HINTS[m] || "");
    }
    const raw = amount.value.trim();
    const calc = raw && !isPlainAmount(raw) ? evaluateAmount(raw, precisionOf(currency)) : null;
    amountHelp.textContent = raw && !isPlainAmount(raw) ? (calc ? `= ${calc} ${currency}` : "Not a valid calculation") : "";
    const pv = previewSplit(snapshot());
    last = pv;
    const shareOf = new Map(pv.shares.map((s) => [s.ref, s]));
    for (const r of splitRows) {
      const s = r.box.checked ? shareOf.get(r.p.ref) : null;
      r.out.textContent = s ? `${money(s.amountMinor)}${s.adjustmentMinor ? " (rounded up)" : ""}` : "";
    }
    const adjusted = pv.shares.filter((s) => s.adjustmentMinor);
    const who = (refs) => refs.map((ref) => { const p = people.find((x) => x.ref === ref); return p ? p.name : "someone"; }).join(", ");
    let text = "";
    if (pv.shares.length && adjusted.length) text = `Rounding: ${who(adjusted.map((s) => s.ref))} ${adjusted.length === 1 ? "gets" : "each get"} ${money(1)} more, so the shares add up to exactly ${money(pv.totalMinor)}.`;
    else if (pv.shares.length) text = `The shares add up to exactly ${money(pv.totalMinor)}.`;
    else if (m === "amounts" && pv.totalMinor && pv.leftMinor) text = pv.leftMinor > 0 ? `${money(pv.leftMinor)} still to share out.` : `${money(-pv.leftMinor)} more than the expense.`;
    mount(preview, text ? el("p", { class: "field__help", text }) : null);
    mount(problems, ...pv.errors.map((t) => el("li", { text: t })));
    const iPay = payerRows.some((r) => r.p.ref === me && r.box.checked);
    ledgerField.hidden = !(mine.length && iPay);
    ledgerAccount.disabled = !ledgerBox.checked;
  }
  commitOnConfirm(method, () => refresh());
  for (const node of [amount, ...payerRows.map((r) => r.amt), ...splitRows.map((r) => r.val)]) node.addEventListener("input", refresh);
  for (const node of [...payerRows.map((r) => r.box), ...splitRows.map((r) => r.box), ledgerBox]) node.addEventListener("change", refresh);

  const formId = `${key}-form`;
  const save = el("button", { type: "submit", class: "btn btn--primary", text: editing ? "Save correction" : "Save expense", form: formId });
  const form = el("form", { class: "form-grid", novalidate: true, id: formId }, [
    field("Description", description, { wide: true }),
    el("div", { class: "field" }, [el("label", { class: "field__label", for: amount.id || (amount.id = `${key}-amount`), text: `Amount (${currency})` }), amount, amountHelp]),
    field("Date", date),
    field("Category", category),
    el("fieldset", { class: "plain-fieldset field--wide" }, [el("legend", { class: "field__label", text: "Paid by" }), el("div", { class: "split-list" }, payerRows.map((r) => r.row)), payersNote]),
    el("fieldset", { class: "plain-fieldset field--wide" }, [
      el("legend", { class: "field__label", text: "Shared by" }),
      el("div", { class: "row" }, [field("Split", method), everyone]),
      el("div", { class: "split-list" }, splitRows.map((r) => r.row)),
      preview, problems,
    ]),
    editing ? null : ledgerField,
    el("details", { class: "more" }, [el("summary", { text: "Notes" }), field("Notes", notes, { wide: true })]),
    editing ? field("Reason for this correction", reason, { wide: true, help: "Required. It is kept with the expense's history, with the values before and after." }) : null,
  ]);
  const modal = openModal({ title: editing ? "Correct shared expense" : "Add shared expense", body: [form], actions: [button("Cancel", () => modal.close()), save] });
  refresh();

  const mark = (node) => { node.setAttribute("aria-invalid", "true"); node.setAttribute("aria-errormessage", modal.errorId); };
  async function submit() {
    modal.setError("");
    for (const node of [description, amount, reason]) node.removeAttribute("aria-invalid");
    refresh();
    if (!description.value.trim()) { mark(description); modal.setError("Describe the expense, for example “Dinner at the harbour”."); description.focus(); return; }
    if (!last.ok) {
      if (last.totalMinor === null) { mark(amount); amount.focus(); }
      modal.setError(last.errors[0]);
      return;
    }
    if (editing && !reason.value.trim()) { mark(reason); modal.setError("Give a reason for this correction."); reason.focus(); return; }
    const snap = snapshot();
    const lineBody = (l) => {
      if (snap.method === "equal") return { ref: l.ref };
      if (snap.method === "shares") return { ref: l.ref, value: Number(String(l.value).trim()) };
      if (snap.method === "percentages") return { ref: l.ref, value: String(l.value).trim() };
      return { ref: l.ref, value: formatMinor(parseAmount(l.value, currency), currency) };
    };
    const body = {
      description: description.value.trim(), date: date.value, amount: formatMinor(last.totalMinor, currency), notes: notes.value,
      payers: last.payers.length === 1 ? [{ ref: last.payers[0].ref }] : last.payers.map((p) => ({ ref: p.ref, amount: formatMinor(p.amountMinor, currency) })),
      split: { method: snap.method, lines: snap.lines.map(lineBody) },
    };
    if (editing) body.categoryId = category.value || null;
    else if (category.value) body.categoryId = category.value;
    const withLedger = !editing && !ledgerField.hidden && ledgerBox.checked && ledgerAccount.value;
    if (withLedger) body.ledger = { accountId: ledgerAccount.value };
    modal.setBusy(true);
    const out = editing
      ? await ctx.store.actions.write((ws) => ctx.api.updateGroupExpense(ws, { expenseId: expense.id, revision: expense.revision, reason: reason.value.trim(), ...body }), REFRESH)
      : await ctx.store.actions.write((ws) => ctx.api.createGroupExpense(ws, body, key), withLedger ? REFRESH : ["group"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(editing ? "Correction saved. The earlier values stay in the history." : "Shared expense added.");
    modal.close();
  }
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  return modal;
}

// ---- Payments ------------------------------------------------------------------------------------
// Recording a payment never moves money: it records that someone says they paid. The receiver
// confirms it (a manager or owner for a contact); someone recording money they received themselves
// is the confirmation.
export function openRecordPayment(ctx, { from = null, to = null, amount: preset = "" } = {}) {
  const state = ctx.store.getState();
  const data = groupData(state);
  if (!data) { announce("Shared expenses are still loading. Try again in a moment."); void ctx.store.actions.refreshGroup(); return null; }
  const me = data.permissions.selfRef;
  const people = data.participants.filter((p) => p.active);
  const options = people.map((p) => ({ value: p.ref, label: `${p.name}${p.self ? " (you)" : ""}${p.type === "contact" ? " · contact" : ""}` }));
  const key = newIdempotencyKey();
  const fromSel = select(options, from || me);
  const toSel = select(options, to || (people.find((p) => p.ref !== (from || me)) || {}).ref);
  const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00", value: preset });
  const date = input({ type: "date", value: todayIso() });
  const methodText = input({ maxlength: "60", autocomplete: "off", placeholder: "Cash, bank transfer…" });
  const mine = ledgerAccounts(state, data.currency);
  const ledgerBox = el("input", { type: "checkbox", id: `${key}-ledger` });
  const ledgerAccount = select(mine.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), (mine[0] || {}).id);
  const ledgerField = el("div", { class: "field--wide stack" }, [
    el("div", { class: "field--inline" }, [ledgerBox, el("label", { for: ledgerBox.id, text: "Also record it on my account as a repayment" })]),
    field("Account", ledgerAccount, { help: "A repayment clears money you lent. It is not counted as income or spending. Only you see which account." }),
  ]);
  const note = el("p", { class: "field__help field--wide" });
  const sync = () => {
    const receiving = toSel.value === me;
    note.textContent = receiving ? "You are recording money you received, so it counts as confirmed." : "This does not move any money. It counts once the person who received it confirms it.";
    ledgerField.hidden = !(receiving && mine.length);
    ledgerAccount.disabled = !ledgerBox.checked;
  };
  commitOnConfirm(fromSel, sync);
  commitOnConfirm(toSel, sync);
  ledgerBox.addEventListener("change", sync);
  const formId = `${key}-form`;
  const save = el("button", { type: "submit", class: "btn btn--primary", text: "Record payment", form: formId });
  const form = el("form", { class: "form-grid", novalidate: true, id: formId }, [
    field("From", fromSel), field("To", toSel), field(`Amount (${data.currency})`, amount), field("Date", date),
    field("How it was paid (optional)", methodText, { wide: true }), note, ledgerField,
  ]);
  const modal = openModal({ title: "Record a payment", body: [form], actions: [button("Cancel", () => modal.close()), save] });
  sync();
  async function submit() {
    modal.setError("");
    amount.removeAttribute("aria-invalid");
    const raw = amount.value.trim();
    const value = isPlainAmount(raw) ? raw : evaluateAmount(raw, precisionOf(data.currency));
    const minor = value ? parseAmount(value, data.currency) : null;
    if (!minor) { amount.setAttribute("aria-invalid", "true"); amount.setAttribute("aria-errormessage", modal.errorId); modal.setError("Enter the amount paid, more than zero."); amount.focus(); return; }
    if (fromSel.value === toSel.value) { modal.setError("A payment needs two different people."); return; }
    const body = { from: fromSel.value, to: toSel.value, amount: formatMinor(minor, data.currency), date: date.value };
    if (methodText.value.trim()) body.method = methodText.value.trim();
    const withLedger = !ledgerField.hidden && ledgerBox.checked && ledgerAccount.value;
    if (withLedger) body.ledger = { accountId: ledgerAccount.value };
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "settle", body, key), withLedger ? REFRESH : ["group"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(body.to === me ? "Payment recorded and confirmed." : "Payment recorded. It counts once it is confirmed.");
    modal.close();
  }
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  return modal;
}

function openConfirm(ctx, s, nameOf) {
  const state = ctx.store.getState();
  const data = groupData(state);
  const me = data.permissions.selfRef;
  const fmt = fmtFor(state);
  const receiving = s.to === me;
  const mine = receiving ? ledgerAccounts(state, s.currency) : [];
  const ledgerBox = el("input", { type: "checkbox", id: uid("ledger") });
  const ledgerAccount = select(mine.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), (mine[0] || {}).id);
  ledgerAccount.disabled = true;
  ledgerBox.addEventListener("change", () => { ledgerAccount.disabled = !ledgerBox.checked; });
  const confirm = button("Confirm", () => void go(), { variant: "primary" });
  const modal = openModal({
    title: "Confirm payment",
    body: [
      el("p", { text: receiving ? `Confirm that you received ${fmt(s.amount, s.currency)} from ${nameOf(s.from)}?` : `Confirm that ${nameOf(s.to)} received ${fmt(s.amount, s.currency)} from ${nameOf(s.from)}?` }),
      mine.length ? el("div", { class: "stack" }, [
        el("div", { class: "field--inline" }, [ledgerBox, el("label", { for: ledgerBox.id, text: "Also record it on my account as a repayment" })]),
        field("Account", ledgerAccount, { help: "A repayment clears money you lent. It is not counted as income or spending." }),
      ]) : null,
    ],
    actions: [button("Cancel", () => modal.close()), confirm],
  });
  async function go() {
    modal.setError("");
    const body = { settlementId: s.id, revision: s.revision };
    if (ledgerBox.checked && ledgerAccount.value) body.ledger = { accountId: ledgerAccount.value };
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "confirm", body), body.ledger ? REFRESH : ["group"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Payment confirmed.");
    modal.close();
  }
}

function openDispute(ctx, s, nameOf) {
  const fmt = fmtFor(ctx.store.getState());
  const reason = input({ maxlength: "200", autocomplete: "off" });
  const modal = openModal({
    title: "Dispute payment",
    body: [el("p", { text: `Say why the ${fmt(s.amount, s.currency)} from ${nameOf(s.from)} is not right. It stays listed as disputed and is not counted until you confirm it.` }), field("Reason", reason, { help: "Required. Everyone in the group can read it." })],
    actions: [button("Cancel", () => modal.close()), button("Dispute", () => void go(), { variant: "primary" })],
  });
  async function go() {
    modal.setError("");
    if (!reason.value.trim()) { reason.setAttribute("aria-invalid", "true"); reason.setAttribute("aria-errormessage", modal.errorId); modal.setError("Say why you are disputing it."); reason.focus(); return; }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "dispute", { settlementId: s.id, revision: s.revision, reason: reason.value.trim() }), ["group"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Payment disputed.");
    modal.close();
  }
}

function openVoid(ctx, type, rec) {
  const reason = input({ maxlength: "200", autocomplete: "off" });
  const what = type === "expense" ? `“${rec.description}”` : "this payment";
  const modal = openModal({
    title: type === "expense" ? "Void shared expense?" : "Void payment?",
    body: [
      el("p", { text: `Voiding ${what} takes it out of the balances. It is never erased: it stays listed as voided, with your reason, in the history.` }),
      rec.myLedger ? el("p", { text: "The entries you recorded on your own account are reversed at the same time; the originals stay in that account's history." }) : null,
      field("Reason", reason, { help: "Required." }),
    ],
    actions: [button("Cancel", () => modal.close()), button("Void", () => void go(), { variant: "danger" })],
  });
  async function go() {
    modal.setError("");
    if (!reason.value.trim()) { reason.setAttribute("aria-invalid", "true"); reason.setAttribute("aria-errormessage", modal.errorId); modal.setError("Give a reason for voiding it."); reason.focus(); return; }
    modal.setBusy(true);
    const body = { [type === "expense" ? "expenseId" : "settlementId"]: rec.id, revision: rec.revision, reason: reason.value.trim() };
    const out = await ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "void", body), REFRESH);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Voided. It stays in the history.");
    modal.close();
  }
}

function openLedgerChoice(ctx, type, rec) {
  const state = ctx.store.getState();
  const mine = ledgerAccounts(state, rec.currency);
  const account = select(mine.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), (mine[0] || {}).id);
  const modal = openModal({
    title: "Record on my account",
    body: [
      el("p", { text: type === "expense" ? "What you paid is taken from this account: your share as spending, the rest as money you lent. Only you see which account." : "The payment is added to this account as a repayment, which clears money you lent. It is not income." }),
      field("Account", account),
    ],
    actions: [button("Cancel", () => modal.close()), button("Record", () => void go(), { variant: "primary" })],
  });
  async function go() {
    modal.setError("");
    modal.setBusy(true);
    const body = { [type === "expense" ? "expenseId" : "settlementId"]: rec.id, accountId: account.value };
    const out = await ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "ledger", body), REFRESH);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Recorded on your account.");
    modal.close();
  }
}

async function openHistory(ctx, type, rec) {
  const state = ctx.store.getState();
  const data = groupData(state) || { participants: [] };
  const names = namesOf(data);
  const cats = new Map((((sliceFor(state, "categories").data || {}).categories) || []).map((c) => [c.id, c.name]));
  const show = (fieldName, v) => {
    if (v === null || v === undefined || v === "") return "—";
    if (fieldName === "categoryId") return cats.get(v) || "a category";
    if (fieldName === "payers" || fieldName === "shares") return v.map((x) => `${names.get(x.ref) || "someone"} ${x.amount}`).join(", ");
    if (fieldName === "split") return `${METHOD_LABELS[v.method] || v.method}: ${v.lines.map((l) => `${names.get(l.ref) || "someone"}${l.value === null || l.value === undefined ? "" : ` ${l.value}${v.method === "percentages" ? "%" : ""}`}`).join(", ")}`;
    return String(v);
  };
  const body = el("div", { "aria-live": "polite" }, [el("p", { class: "muted", text: "Loading…" })]);
  const modal = openModal({ title: type === "expense" ? `History of ${rec.description}` : "History of this payment", body: [body], actions: [button("Close", () => modal.close())] });
  try {
    const h = await ctx.api.groupHistory(state.selectedWorkspaceId, type === "expense" ? { expenseId: rec.id } : { settlementId: rec.id });
    mount(body,
      el("ul", { class: "history-list" }, h.history.slice().reverse().map((x) => el("li", {}, [
        el("div", { class: "muted small", text: `${stampOf(x.at)} · ${x.by}` }),
        el("div", { text: EVENT_LABELS[x.event] || x.event }),
        x.reason ? el("div", { class: "muted small", text: `Reason: ${x.reason}` }) : null,
      ]))),
      h.amendments.length ? el("h3", { class: "section-title", text: "Corrections" }) : null,
      h.amendments.length ? el("ul", { class: "history-list" }, h.amendments.slice().reverse().map((a) => el("li", {}, [
        el("div", { class: "muted small", text: `${stampOf(a.at)} · ${a.by}` }),
        el("div", { text: a.changes.map((c) => `${FIELD_LABELS[c.field] || c.field}: ${show(c.field, c.from)} → ${show(c.field, c.to)}`).join("; ") }),
        a.reason ? el("div", { class: "muted small", text: `Reason: ${a.reason}` }) : null,
      ]))) : null,
    );
  } catch (err) {
    mount(body);
    modal.setError(err);
  }
}
