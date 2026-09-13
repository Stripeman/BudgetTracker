// Transactions: filters (merchant, account, category, amount, date, status, text), the merchant-
// style summary (gross, refunds and net reported separately), the table, and quick entry.
//
// QUICK ENTRY AUTOFILL (BT-006): choosing a known payee asks the server for a suggestion based only
// on entries the person may see. Suggested values fill ONLY fields the person has not touched, each
// is labelled with its reason, all stay editable, and nothing is saved until the person saves.
// Each open of the form has one Idempotency-Key, so a double click or retry cannot create two.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, money, button, field, input, select, badge } from "../components.js";
import { openModal, confirmModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { evaluateAmount, isPlainAmount } from "../../core/calc.js";
import { formatDate, todayIso, KIND_LABELS } from "../../core/format.js";

const PRECISION = { JPY: 0, KRW: 0, ISK: 0, CLP: 0, VND: 0, BHD: 3, KWD: 3, JOD: 3, OMR: 3, TND: 3 };
const precisionOf = (c) => (c in PRECISION ? PRECISION[c] : 2);

export function createView(ctx) {
  const filters = { ...ctx.params };
  const filterBar = el("div", { class: "filters", role: "search", "aria-label": "Filter entries" });
  const summary = el("div", { class: "summary", "aria-live": "polite" });
  const tableBox = el("div");
  const element = el("section", {}, [
    pageHead("Transactions", [button("Add entry", () => openQuickEntry(ctx), { variant: "primary" })]),
    filterBar, summary, tableBox,
  ]);
  let debounce = null;
  const apply = () => { void ctx.store.actions.refreshTransactions(filters); };
  apply();

  function filterControl(label, key, control) {
    control.value = filters[key] || "";
    const handler = () => {
      filters[key] = control.value || undefined;
      clearTimeout(debounce);
      debounce = setTimeout(apply, key === "q" || key === "min" || key === "max" ? 350 : 0);
    };
    control.addEventListener(control.tagName === "SELECT" ? "change" : "input", handler);
    return field(label, control);
  }

  function renderFilters(state) {
    if (filterBar.childNodes.length) return;
    const accounts = sliceFor(state, "accounts").data;
    const categories = sliceFor(state, "categories").data;
    const payees = sliceFor(state, "payees").data;
    if (!accounts || !categories || !payees) return;
    const any = [{ value: "", label: "Any" }];
    mount(filterBar,
      filterControl("Search", "q", input({ type: "search", placeholder: "Payee, note or tag" })),
      filterControl("Merchant", "payeeId", select(any.concat(payees.payees.map((p) => ({ value: p.id, label: p.name }))))),
      filterControl("Account", "accountId", select(any.concat(accounts.accounts.map((a) => ({ value: a.id, label: a.name }))))),
      filterControl("Category", "categoryId", select(any.concat(categories.categories.map((c) => ({ value: c.id, label: c.name }))))),
      filterControl("From", "from", input({ type: "date" })),
      filterControl("To", "to", input({ type: "date" })),
      filterControl("Min amount", "min", input({ inputmode: "decimal", placeholder: "0.00" })),
      filterControl("Max amount", "max", input({ inputmode: "decimal" })),
      filterControl("Status", "status", select(any.concat([{ value: "pending", label: "Pending" }, { value: "cleared", label: "Cleared" }, { value: "reconciled", label: "Reconciled" }]))),
    );
  }

  function update(state) {
    renderFilters(state);
    const prefs = state.preferences;
    const txns = sliceFor(state, "transactions");
    const categories = new Map(((sliceFor(state, "categories").data || {}).categories || []).map((c) => [c.id, c.name]));
    const s = stateView(txns, { empty: "No entries match these filters.", isEmpty: (d) => !d.transactions.length });
    if (txns.data) {
      mount(summary, ...txns.data.summary.map((x) => el("span", {}, [
        `${x.currency}: spent `, el("strong", { text: x.gross }), " · refunds ", el("strong", { text: x.refunds }), " · net ", el("strong", { text: x.net }),
        x.income !== "0" && !/^0\.?0*$/.test(x.income) ? el("span", { text: ` · income ${x.income}` }) : null,
        ` (${x.count})`,
      ])));
    } else mount(summary);
    if (s) { mount(tableBox, s); return; }
    const rows = txns.data.transactions.map((t) => el("tr", {}, [
      el("td", { text: formatDate(t.date, prefs && prefs.effective && prefs.effective.dateFormat) }),
      el("td", {}, [el("span", { text: t.payeeName || (t.kind === "transfer" ? "Transfer" : "—") }), t.tags.length ? el("div", { class: "muted small", text: t.tags.join(", ") }) : null]),
      el("td", { text: t.accountName }),
      el("td", { text: t.splits.length ? "Split" : categories.get(t.categoryId) || (t.kind === "transfer" ? "—" : "Uncategorized") }),
      el("td", { class: "num" }, [money(t.amount, t.currency, prefs, { masked: false })]),
      el("td", {}, [badge(t.status), t.kind !== "expense" ? el("div", { class: "muted small", text: KIND_LABELS[t.kind] || t.kind }) : null]),
      el("td", {}, [
        t.canEdit ? button("Edit", () => openQuickEntry(ctx, { transaction: t }), { small: true }) : null,
        t.canDelete ? button("Delete", () => confirmModal({
          title: "Delete entry?", message: "The entry is removed from balances and lists. It can be restored from the audit history.", confirmLabel: "Delete", danger: true,
          onConfirm: () => ctx.store.actions.write((ws) => ctx.api.deleteTransaction(ws, { transactionId: t.id, revision: t.revision })),
        }), { small: true, variant: "ghost" }) : null,
      ]),
    ]));
    mount(tableBox, el("div", { class: "table-wrap" }, [el("table", { class: "table" }, [
      el("caption", { class: "sr-only", text: `${txns.data.total} entries` }),
      el("thead", {}, [el("tr", {}, ["Date", "Payee", "Account", "Category", "Amount", "Status", "Actions"].map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
      el("tbody", {}, rows),
    ])]));
  }
  return { element, update };
}

export function openQuickEntry(ctx, { transaction } = {}) {
  const state = ctx.store.getState();
  const accounts = ((sliceFor(state, "accounts").data || {}).accounts || []).filter((a) => !a.deletedAt && a.capabilities.includes("create"));
  const categories = ((sliceFor(state, "categories").data || {}).categories || []).filter((c) => !c.archived);
  const payees = ((sliceFor(state, "payees").data || {}).payees || []);
  const editing = !!transaction;
  const isTransfer = editing && transaction.kind === "transfer";
  const key = newIdempotencyKey();
  const touched = new Set();
  const hints = {};

  const kind = select(Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })), editing ? transaction.kind : "expense", { disabled: isTransfer });
  const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00 or 12.50+3.20", value: editing ? transaction.amount.replace(/^-/, "") : "" });
  const amountPreview = el("p", { class: "field__help", "aria-live": "polite" });
  const date = input({ type: "date", value: editing ? transaction.date : todayIso() });
  const account = select(accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), editing ? transaction.accountId : (accounts[0] || {}).id, { disabled: editing });
  const payeeList = el("datalist", { id: `payees-${key}` }, payees.map((p) => el("option", { value: p.name })));
  const payee = input({ list: `payees-${key}`, autocomplete: "off", value: editing ? transaction.payeeName : "", disabled: isTransfer });
  const category = select([{ value: "", label: "Uncategorized" }].concat(categories.map((c) => ({ value: c.id, label: c.name }))), editing ? transaction.categoryId || "" : "", { disabled: isTransfer });
  const toAccount = select(accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), "");
  const toAmount = input({ inputmode: "decimal", placeholder: "Received amount (other currency)" });
  const rate = input({ inputmode: "decimal", placeholder: "Or exchange rate" });
  const tags = input({ placeholder: "Comma separated", value: editing ? transaction.tags.join(", ") : "" });
  const notes = el("textarea", { class: "field__input", maxlength: "5000", text: editing ? transaction.notes : "" });
  const status = select([{ value: "pending", label: "Pending" }, { value: "cleared", label: "Cleared" }].concat(editing ? [{ value: "reconciled", label: "Reconciled" }] : []), editing ? transaction.status : "pending");
  for (const [name, control] of Object.entries({ kind, amount, date, account, payee, category, tags })) {
    control.addEventListener("input", () => touched.add(name));
    control.addEventListener("change", () => touched.add(name));
  }

  // Each suggestion hint sits directly under its own field and is referenced by that control's
  // aria-describedby while visible, so a screen reader announces why the value was suggested.
  const hintFor = (name) => { hints[name] = el("span", { class: "suggestion", id: `${key}-hint-${name}`, hidden: true }); return hints[name]; };
  const withHint = (label, name, control) => el("div", { class: "field" }, [field(label, control), hintFor(name)]);
  const transferBox = el("div", { class: "form-grid field--wide", hidden: kind.value !== "transfer" || editing }, [
    field("To account", toAccount), field("Received amount", toAmount, { help: "Only for transfers between currencies." }), field("Rate", rate),
  ]);
  kind.addEventListener("change", () => { transferBox.hidden = kind.value !== "transfer"; });

  function currentCurrency() { const a = accounts.find((x) => x.id === account.value); return a ? a.currency : "EUR"; }
  function computedAmount() {
    const raw = amount.value.trim();
    if (!raw) return null;
    if (isPlainAmount(raw)) return raw;
    return evaluateAmount(raw, precisionOf(currentCurrency()));
  }
  amount.addEventListener("input", () => {
    const raw = amount.value.trim();
    const value = computedAmount();
    amountPreview.textContent = raw && !isPlainAmount(raw) ? (value ? `= ${value} ${currentCurrency()}` : "Not a valid calculation") : "";
  });

  payee.addEventListener("change", async () => {
    const match = payees.find((p) => p.name.toLowerCase() === payee.value.trim().toLowerCase());
    for (const h of Object.values(hints)) h.hidden = true;
    if (!match || editing) return;
    try {
      const { suggestion } = await ctx.api.suggest(state.selectedWorkspaceId, match.id);
      const applyHint = (name, control, value, reason) => {
        if (value === null || value === undefined || touched.has(name) || !hints[name]) return;
        control.value = value;
        hints[name].replaceChildren
          ? hints[name].replaceChildren(el("span", { class: "suggestion__mark", text: "Suggested" }), el("span", { text: ` — ${reason}` }))
          : (hints[name].textContent = `Suggested — ${reason}`);
        hints[name].hidden = false;
        const described = new Set((control.getAttribute("aria-describedby") || "").split(" ").filter(Boolean));
        described.add(hints[name].id);
        control.setAttribute("aria-describedby", [...described].join(" "));
      };
      if (suggestion.accountId && accounts.some((a) => a.id === suggestion.accountId)) applyHint("account", account, suggestion.accountId, suggestion.accountReason);
      applyHint("category", category, suggestion.categoryId, suggestion.categoryReason);
      applyHint("amount", amount, suggestion.amount, suggestion.amountReason);
      if (suggestion.tags.length) applyHint("tags", tags, suggestion.tags.join(", "), "From your most recent entry.");
      announce("Suggestions filled from your earlier entries. Every field stays editable.");
    } catch (err) { /* a suggestion is optional; entry still works without it */ }
  });

  const save = el("button", { type: "submit", class: "btn btn--primary", text: editing ? "Save changes" : "Save entry" });
  const cancel = button("Cancel", () => modal.close());
  const form = el("form", { class: "form-grid", novalidate: true }, [
    field("Kind", kind),
    el("div", { class: "field" }, [field("Amount", amount), amountPreview, hintFor("amount")]),
    field("Date", date),
    withHint("Payee", "payee", payee), payeeList,
    withHint("Account", "account", account),
    withHint("Category", "category", category),
    transferBox,
    withHint("Tags", "tags", tags), field("Status", status),
    field("Notes", notes, { wide: true }),
  ]);
  const modal = openModal({ title: editing ? "Edit entry" : "New entry", body: [form, el("p", { class: "field__help", text: "Suggestions use only entries you are allowed to see and are never saved until you save." })], actions: [cancel, save] });
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });

  async function submit() {
    modal.setError("");
    const value = computedAmount();
    if (!value) { modal.setError("Enter an amount, for example 12.50 or 10+2.50."); amount.focus(); return; }
    const tagList = tags.value.split(",").map((t) => t.trim()).filter(Boolean);
    modal.setBusy(true);
    const out = await ctx.store.actions.write(async (ws) => {
      if (editing) {
        const body = { transactionId: transaction.id, revision: transaction.revision, amount: value, date: date.value, notes: notes.value, tags: tagList, status: status.value };
        if (!isTransfer) Object.assign(body, { kind: kind.value, categoryId: category.value || null, payeeName: payee.value });
        return ctx.api.updateTransaction(ws, body);
      }
      const body = { accountId: account.value, kind: kind.value, amount: value, date: date.value, notes: notes.value, tags: tagList, status: status.value };
      if (kind.value === "transfer") {
        body.transfer = { toAccountId: toAccount.value };
        if (toAmount.value.trim()) body.transfer.toAmount = toAmount.value.trim();
        else if (rate.value.trim()) body.transfer.rate = rate.value.trim();
      } else {
        if (payee.value.trim()) body.payeeName = payee.value.trim();
        if (category.value) body.categoryId = category.value;
      }
      return ctx.api.createTransaction(ws, body, key);
    });
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(editing ? "Entry saved." : "Entry added.");
    modal.close();
  }
}
