// Transactions: collapsible filters with an active count and "Clear filters", the merchant-style
// summary (spent, refunds and net reported separately), the table (card rows on narrow screens),
// and quick entry.
//
// QUICK ENTRY AUTOFILL (BT-006): choosing a known merchant asks the server for a suggestion based
// only on entries the person may see. Suggested values fill ONLY fields the person has not
// touched, each carries its reason (linked with aria-describedby), the hint disappears as soon as
// the person edits that field, and nothing is saved until the person saves. Each open of the form
// has one Idempotency-Key, so a double click or a retry cannot create two entries.
//
// MERCHANTS (BT-007-01) are chosen from the managed directory with a searchable picker — never
// typed as free text. A new merchant can be created inline without losing the form; closed
// merchants are not offered, but an entry keeps the merchant it already has. Edits send only the
// fields that changed, and an entry keeps its category even if that category has been archived.
import { el, mount, announce } from "../dom.js";
import { stateView, money, button, field, input, select, badge, categoryLabel } from "../components.js";
import { categoryIndex } from "../../core/categories.js";
import { openModal } from "../modal.js";
import { createMerchantPicker } from "../merchantpicker.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { messageFor } from "../../core/errors.js";
import { evaluateAmount, isPlainAmount } from "../../core/calc.js";
import { formatDate, formatAmount, todayIso, KIND_LABELS, MERCHANT_TYPE_LABELS } from "../../core/format.js";
import { withIcon } from "../icons.js";
import { amountWithDirection, transferLabel } from "../components.js";

export { amountWithDirection };

const PRECISION = { JPY: 0, KRW: 0, ISK: 0, CLP: 0, VND: 0, BHD: 3, KWD: 3, JOD: 3, OMR: 3, TND: 3 };
const precisionOf = (c) => (c in PRECISION ? PRECISION[c] : 2);
const STATUS_LABELS = { pending: "Pending", cleared: "Cleared", reconciled: "Reconciled" };

// A reversal and the entry it reverses keep their financial details for good (FIN-R1): only notes,
// tags and status can change, so the edit form locks the rest and says why. The server enforces it.
export function reversalLock(t) {
  if (t.reversedBy) return "This entry has been reversed, so its amount, date, type, category and merchant can no longer change. To correct it, add a new entry.";
  if (t.links && t.links.reverses) return "This is a reversal, so its amount, date, type, category and merchant always match the entry it reverses. To correct it, add a new entry.";
  return null;
}

// A reversal and its original are deleted together (FIN-R2), so the dialog says so.
export function linkedDeleteNote(t) {
  if (t.reversedBy) return "Its reversal is deleted with it, so the two keep cancelling out.";
  if (t.links && t.links.reverses) return "The entry it reverses is deleted with it, so the two keep cancelling out.";
  return null;
}

// True when at least one visible account accepts new entries from this person (UX-001).
export function canAddEntries(state) {
  const data = sliceFor(state, "accounts").data;
  return !!(data && data.accounts.some((a) => !a.deletedAt && a.status !== "closed" && a.capabilities.includes("create")));
}

// Why entries cannot be added here, said plainly and with the way forward (Terry's preview check,
// 2026-09-14: a new workspace with no accounts told its owner "You can view this workspace but not
// add entries"). Only a viewer is told they can only view.
export function addEntriesBlocked(state, what = "entries") {
  const ws = (state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId);
  const data = sliceFor(state, "accounts").data;
  if (!ws || !data) return null;
  if (ws.role === "viewer") return el("p", { class: "muted small", text: `You can view this workspace but not add ${what}.` });
  const open = data.accounts.filter((a) => !a.deletedAt && a.status !== "closed");
  const text = open.length
    ? `None of the open accounts here lets you add ${what}. Add your own account first.`
    : `Add an account first: ${what} are recorded against an account.`;
  return el("p", { class: "muted small" }, [`${text} `, el("a", { href: "#/accounts", text: "Go to Accounts" })]);
}

export function createView(ctx) {
  const filters = { ...ctx.params };
  const filterGrid = el("div", { class: "filters" });
  const filterSummary = el("summary");
  const filterBox = el("details", { class: "filters-box" }, [filterSummary, filterGrid]);
  const summary = el("div", { class: "summary", "aria-live": "polite" });
  const tableBox = el("div");
  const actions = el("div", { class: "page-head__actions" });
  const element = el("section", {}, [el("div", { class: "page-head" }, [el("h1", { text: "Transactions" }), actions]), filterBox, summary, tableBox]);
  let debounce = null;
  const controls = {};
  const activeCount = () => Object.values(filters).filter((v) => v !== undefined && v !== "").length;
  const apply = () => {
    filterSummary.replaceChildren(withIcon("filter", activeCount() ? `Filters (${activeCount()} active)` : "Filters"));
    void ctx.store.actions.refreshTransactions(filters);
  };
  if (activeCount()) filterBox.open = true;
  apply();

  function filterControl(label, key, control) {
    control.value = filters[key] || "";
    controls[key] = control;
    const handler = () => {
      filters[key] = control.value || undefined;
      clearTimeout(debounce);
      debounce = setTimeout(apply, key === "q" || key === "min" || key === "max" ? 350 : 0);
    };
    control.addEventListener(control.tagName === "SELECT" ? "change" : "input", handler);
    return field(label, control);
  }

  function renderFilters(state) {
    if (filterGrid.childNodes.length) return;
    const accounts = sliceFor(state, "accounts").data;
    const categories = sliceFor(state, "categories").data;
    const payees = sliceFor(state, "payees").data;
    if (!accounts || !categories || !payees) return;
    const any = [{ value: "", label: "Any" }];
    const clear = button("Clear filters", () => {
      for (const [key, control] of Object.entries(controls)) { control.value = ""; filters[key] = undefined; }
      apply();
      announce("Filters cleared.");
    }, { small: true });
    // History filters keep closed merchants and archived categories, labelled, so their history
    // stays reachable (BT-001-05).
    mount(filterGrid,
      filterControl("Search", "q", input({ type: "search", placeholder: "Merchant, note or tag" })),
      filterControl("Merchant", "payeeId", select(any.concat(payees.payees.map((p) => ({ value: p.id, label: p.status === "closed" ? `${p.name} (closed)` : p.name }))))),
      filterControl("Account", "accountId", select(any.concat(accounts.accounts.map((a) => ({ value: a.id, label: a.name }))))),
      filterControl("Category", "categoryId", select(any.concat(categories.categories.map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name }))))),
      filterControl("From", "from", input({ type: "date" })),
      filterControl("To", "to", input({ type: "date" })),
      filterControl("Min amount", "min", input({ inputmode: "decimal", placeholder: "0.00" })),
      filterControl("Max amount", "max", input({ inputmode: "decimal" })),
      filterControl("Status", "status", select(any.concat(Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))))),
      el("div", { class: "filters__actions" }, [clear]),
    );
  }

  function update(state) {
    renderFilters(state);
    mount(actions, canAddEntries(state)
      ? button("Add expense", () => openQuickEntry(ctx), { variant: "primary" })
      : addEntriesBlocked(state));
    const prefs = state.preferences;
    const effective = (prefs && prefs.effective) || {};
    const txns = sliceFor(state, "transactions");
    const categories = categoryIndex(state);
    const s = stateView(txns, { empty: "No entries match these filters.", isEmpty: (d) => !d.transactions.length });
    const fmt = (v, c) => formatAmount(v, c, { numberFormat: effective.numberFormat });
    if (txns.data) {
      mount(summary, ...txns.data.summary.map((x) => el("span", {}, [
        "Spent ", el("strong", { text: fmt(x.gross, x.currency) }), " · refunds ", el("strong", { text: fmt(x.refunds, x.currency) }),
        " · net ", el("strong", { text: fmt(x.net, x.currency) }),
        /^0(\.0+)?$/.test(x.income) ? null : el("span", { text: ` · income ${fmt(x.income, x.currency)}` }),
        ` (${x.count} ${x.count === 1 ? "entry" : "entries"})`,
      ])));
    } else mount(summary);
    if (s) { mount(tableBox, s); return; }
    // Merchant and account icons come from the records themselves (BT-011-05).
    const merchantIcons = new Map(((sliceFor(state, "payees").data || {}).payees || []).map((p) => [p.id, p.icon || "store"]));
    const accountsById = new Map(((sliceFor(state, "accounts").data || {}).accounts || []).map((a) => [a.id, a]));
    const accountIcons = new Map([...accountsById].map(([id, a]) => [id, a.icon]));
    const merchantCell = (t) => {
      if (t.payeeName) return withIcon(merchantIcons.get(t.payeeId) || "store", t.payeeName);
      if (t.kind === "transfer") return transferLabel(t, accountsById);
      return el("span", { text: "—" });
    };
    const rows = txns.data.transactions.map((t) => el("tr", {}, [
      el("th", { scope: "row", "data-label": "Date", text: formatDate(t.date, effective.dateFormat) }),
      el("td", { "data-label": "Merchant" }, [merchantCell(t), t.tags.length ? el("div", { class: "muted small", text: t.tags.join(", ") }) : null]),
      el("td", { "data-label": "Account" }, [accountIcons.get(t.accountId) ? withIcon(accountIcons.get(t.accountId), t.accountName) : el("span", { text: t.accountName })]),
      el("td", { "data-label": "Category" }, [t.splits.length ? "Split"
        : categories.get(t.categoryId) ? categoryLabel(categories.get(t.categoryId).name, categories.get(t.categoryId).shownColor, categories.get(t.categoryId).shownIcon)
          : (t.kind === "transfer" ? "—" : withIcon("tag", "Uncategorized"))]),
      el("td", { "data-label": "Amount", class: "num" }, [amountWithDirection(t, prefs)]),
      el("td", { "data-label": "Status" }, [
        badge(STATUS_LABELS[t.status] || t.status),
        t.reversedBy ? [" ", badge("Reversed", "closed")] : null,
        t.links && t.links.reverses ? [" ", badge("Reversal")] : null,
        t.kind !== "expense" ? el("div", { class: "muted small", text: KIND_LABELS[t.kind] || t.kind }) : null,
      ].flat()),
      el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
        t.canEdit ? button("Edit", () => openQuickEntry(ctx, { transaction: t }), { small: true, attrs: { "aria-label": `Edit ${t.payeeName || "entry"} on ${t.date}` } }) : null,
        // Corrections never overwrite history (BT-001-05): a reversal cancels an entry, even a
        // reconciled one, and every change is listed under History.
        t.canEdit && !t.transferId && !t.reversedBy && !(t.links && t.links.reverses) ? button("Reverse", () => openReverse(ctx, t), { small: true, attrs: { "aria-label": `Reverse ${t.payeeName || "entry"} on ${t.date}` } }) : null,
        t.amendmentCount ? button("History", () => void openHistory(ctx, t), { small: true, attrs: { "aria-label": `History of ${t.payeeName || "entry"} on ${t.date}` } }) : null,
        t.canDelete && t.status !== "reconciled" ? button("Delete", () => openDelete(ctx, t), { small: true, variant: "danger", attrs: { "aria-label": `Delete ${t.payeeName || "entry"} on ${t.date}` } }) : null,
      ])]),
    ]));
    mount(tableBox, el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards" }, [
      el("caption", { class: "sr-only", text: `${txns.data.total} entries` }),
      el("thead", {}, [el("tr", {}, ["Date", "Merchant", "Account", "Category", "Amount", "Status", "Actions"].map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
      el("tbody", {}, rows),
    ])]));
  }
  return { element, update };
}

const CHANGE_LABELS = {
  amountMinor: "Amount", kind: "Type", date: "Date", postedDate: "Posted date", categoryId: "Category", splits: "Split lines",
  payeeId: "Merchant", responsibleRef: "Responsible person", original: "Exchange details", status: "Status", tags: "Tags", notes: "Notes",
  deleted: "Deleted", reversedBy: "Reversed",
};
const stampOf = (iso) => String(iso || "").replace("T", " ").slice(0, 16);

// Deleting takes an entry out of balances and lists; it is never erased, and the reason is kept.
function openDelete(ctx, t) {
  const reason = input({ maxlength: "200", autocomplete: "off" });
  const confirm = el("button", { type: "button", class: "btn btn--danger", text: "Delete entry" });
  const modal = openModal({
    title: "Delete this entry?",
    body: [
      el("p", { text: "It is taken out of balances and lists. The entry itself stays in the workspace history with your reason and is never erased." }),
      linkedDeleteNote(t) ? el("p", { text: linkedDeleteNote(t) }) : null,
      field("Reason", reason, { help: "Required." }),
    ],
    actions: [button("Cancel", () => modal.close()), confirm],
  });
  confirm.addEventListener("click", async () => {
    modal.setError("");
    if (!reason.value.trim()) {
      reason.setAttribute("aria-invalid", "true");
      reason.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Give a reason for deleting this entry.");
      reason.focus();
      return;
    }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.deleteTransaction(ws, { transactionId: t.id, revision: t.revision, reason: reason.value.trim() }));
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Entry deleted. It stays in the history.");
    modal.close();
  });
}

// A reversal adds an entry with the opposite amount; the original is left exactly as it is.
function openReverse(ctx, t) {
  const key = newIdempotencyKey();
  const reason = input({ maxlength: "200", autocomplete: "off" });
  const date = input({ type: "date" });
  // The entry's own date by default, so the pair cancels out in the same budget period (FIN-T4).
  date.value = t.date || todayIso();
  const opposite = t.amount.startsWith("-") ? t.amount.slice(1) : `-${t.amount}`;
  const confirm = el("button", { type: "button", class: "btn btn--primary", text: "Reverse entry" });
  const modal = openModal({
    title: `Reverse ${t.payeeName || "this entry"}?`,
    body: [
      el("p", { text: `A new entry of ${opposite} ${t.currency} is added so the two cancel out. The original stays exactly as it is${t.status === "reconciled" ? ", including its reconciliation" : ""}. Add the correct entry afterwards if one is needed.` }),
      el("div", { class: "form-grid" }, [field("Reason", reason, { help: "Required. It is kept with both entries." }), field("Date of the reversal", date)]),
    ],
    actions: [button("Cancel", () => modal.close()), confirm],
  });
  confirm.addEventListener("click", async () => {
    modal.setError("");
    if (!reason.value.trim()) {
      reason.setAttribute("aria-invalid", "true");
      reason.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Give a reason for the reversal.");
      reason.focus();
      return;
    }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.reverseTransaction(ws, { transactionId: t.id, reason: reason.value.trim(), date: date.value }, key));
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Entry reversed. Both entries stay in the history.");
    modal.close();
  });
}

// Every change to an entry: who, when, what changed from what to what, and why.
async function openHistory(ctx, t) {
  const state = ctx.store.getState();
  const names = new Map([
    ...((sliceFor(state, "categories").data || {}).categories || []).map((c) => [c.id, c.name]),
    ...((sliceFor(state, "payees").data || {}).payees || []).map((p) => [p.id, p.name]),
  ]);
  const show = (fieldName, v) => {
    if (v === null || v === undefined || v === "") return "—";
    if (fieldName === "reversedBy") return "yes";
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (fieldName === "status") return STATUS_LABELS[v] || v;
    if (fieldName === "kind") return KIND_LABELS[v] || v;
    if (Array.isArray(v)) return fieldName === "tags" ? v.join(", ") : `${v.length} line${v.length === 1 ? "" : "s"}`;
    if (typeof v === "object") return "updated";
    return names.get(v) || String(v);
  };
  const body = el("div", { "aria-live": "polite" }, [el("p", { class: "muted", text: "Loading…" })]);
  const modal = openModal({ title: `History of ${t.payeeName || "this entry"}`, body: [body], actions: [button("Close", () => modal.close())] });
  try {
    const h = await ctx.api.transactionHistory(state.selectedWorkspaceId, t.id);
    mount(body,
      el("p", { class: "muted small", text: `Added ${stampOf(h.createdAt)} by ${h.createdBy}.` }),
      el("ul", { class: "history-list" }, h.amendments.slice().reverse().map((a) => el("li", {}, [
        el("div", { class: "muted small", text: `${stampOf(a.at)} · ${a.by}` }),
        el("div", { text: a.changes.map((c) => `${CHANGE_LABELS[c.field] || c.field}: ${show(c.field, c.from)} → ${show(c.field, c.to)}`).join("; ") }),
        a.reason ? el("div", { class: "muted small", text: `Reason: ${a.reason}` }) : null,
      ]))));
  } catch (err) {
    mount(body);
    modal.setError(err);
  }
}

// Merchants choosable on an account: active, fully visible, and in a scope the account allows — a
// shared account takes shared merchants only; your own private account also takes your private
// merchants. The server enforces the same rule.
export function choosableMerchants(merchants, account) {
  const active = merchants.filter((p) => p.status !== "closed" && !p.referenceOnly);
  if (account && account.access === "own") return active.filter((p) => p.visibility === "shared" || p.ownedBySelf);
  return active.filter((p) => p.visibility === "shared");
}

export function openQuickEntry(ctx, { transaction } = {}) {
  const state = ctx.store.getState();
  const allAccounts = ((sliceFor(state, "accounts").data || {}).accounts || []);
  // Closed accounts take no new entries, so they are not offered (BT-001-05); an edit keeps its account.
  const accounts = allAccounts.filter((a) => !a.deletedAt && a.status !== "closed" && a.capabilities.includes("create"));
  const editing = !!transaction;
  // An entry keeps its category even if that category has since been archived (audit B5).
  const categories = ((sliceFor(state, "categories").data || {}).categories || [])
    .filter((c) => !c.archived || (editing && c.id === transaction.categoryId));
  let merchants = ((sliceFor(state, "payees").data || {}).payees || []);
  const isTransfer = editing && transaction.kind === "transfer";
  if (!editing && !accounts.length) return;
  const key = newIdempotencyKey();
  const touched = new Set();
  const hints = {};

  const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00 or 12.50+3.20", value: editing ? transaction.amount.replace(/^-/, "") : "" });
  const amountPreview = el("p", { class: "field__help", "aria-live": "polite" });
  const account = select(accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), editing ? transaction.accountId : (accounts[0] || {}).id, { disabled: editing });
  const category = select([{ value: "", label: "Uncategorized" }].concat(categories.map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name }))), editing ? transaction.categoryId || "" : "", { disabled: isTransfer });
  const date = input({ type: "date", value: editing ? transaction.date : todayIso() });
  const kind = select(Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })), editing ? transaction.kind : "expense", { disabled: isTransfer });
  const toAccount = select(accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), "");
  const toAmount = input({ inputmode: "decimal", placeholder: "Amount received" });
  const rate = input({ inputmode: "decimal", placeholder: "Exchange rate" });
  const tags = input({ placeholder: "Comma separated", value: editing ? transaction.tags.join(", ") : "" });
  const notes = el("textarea", { class: "field__input", maxlength: "5000", text: editing ? transaction.notes : "" });
  const status = select([{ value: "pending", label: "Pending" }, { value: "cleared", label: "Cleared" }].concat(editing ? [{ value: "reconciled", label: "Reconciled" }] : []), editing ? transaction.status : "pending");
  // Corrections keep their reason with the entry's history (BT-001-05).
  const reason = input({ maxlength: "200", autocomplete: "off", placeholder: "Why is this being changed?" });

  const accountOf = (id) => allAccounts.find((a) => a.id === id) || null;
  const currentAccountId = () => (editing ? transaction.accountId : account.value);
  const currentCurrency = () => { const a = accountOf(currentAccountId()); return a ? a.currency : (editing ? transaction.currency : "EUR"); };
  const amountLabel = el("label", { class: "field__label", for: "", text: "" });
  const setAmountLabel = () => { amountLabel.textContent = `Amount (${currentCurrency()})`; };

  // Each hint sits under its own field, is linked by aria-describedby while visible, and is removed
  // the moment the person edits that field (UX-006).
  const hintFor = (name) => { hints[name] = el("span", { class: "suggestion", id: `${key}-hint-${name}`, hidden: true }); return hints[name]; };
  const clearHint = (name, control) => {
    if (!hints[name] || hints[name].hidden) return;
    hints[name].hidden = true;
    const ids = (control.getAttribute("aria-describedby") || "").split(" ").filter((id) => id && id !== hints[name].id);
    if (ids.length) control.setAttribute("aria-describedby", ids.join(" ")); else control.removeAttribute("aria-describedby");
  };
  const watched = { amount, account, category, date, kind, tags };
  for (const [name, control] of Object.entries(watched)) {
    const onEdit = () => { touched.add(name); clearHint(name, control); };
    control.addEventListener("input", onEdit);
    control.addEventListener("change", onEdit);
  }
  const withHint = (label, name, control, extra = []) => el("div", { class: "field" }, [field(label, control), ...extra, hintFor(name)]);

  // ---- merchant picker with inline creation ----
  const current = editing && transaction.payeeId ? { id: transaction.payeeId, name: transaction.payeeName || "Merchant" } : null;
  const merchantLink = el("p", { class: "field__help", hidden: !current }, [
    el("a", { href: "#/payees", text: "Edit merchant details on the Merchants tab", onClick: () => modal.close() }), " (closes this form)",
  ]);
  const picker = createMerchantPicker({
    merchants: choosableMerchants(merchants, accountOf(currentAccountId())),
    current,
    onChange: (m) => { merchantLink.hidden = !m; void onMerchant(m); },
    onRequestCreate: (name) => showCreate(name),
  });
  if (isTransfer) picker.input.disabled = true;
  // Reversal pairs: financial fields are shown but cannot be changed (FIN-R1).
  const lock = editing ? reversalLock(transaction) : null;
  if (lock) {
    for (const control of [amount, category, date, kind]) control.setAttribute("disabled", "");
    picker.input.disabled = true;
  }

  const createName = input({ maxlength: "80", autocomplete: "off" });
  const createType = select(Object.entries(MERCHANT_TYPE_LABELS).map(([value, label]) => ({ value, label })), "other");
  const createNote = el("p", { class: "field__help" });
  const createError = el("p", { class: "error-text", role: "alert", hidden: true, id: `${key}-create-error` });
  const createActions = el("div", { class: "inline-create__actions" });
  const createBox = el("fieldset", { class: "inline-create", hidden: true }, [
    el("legend", { text: "New merchant" }), field("Merchant name", createName), field("Type", createType), createNote, createError, createActions,
  ]);
  const scopeText = () => {
    const a = accountOf(currentAccountId());
    if (!a || a.access === "shared") return "It will be shared with the workspace, because this account is shared.";
    if (a.access === "own") return "It will be private to you. You can share it later on the Merchants tab.";
    return `It will belong to ${a.ownerName || "the account's owner"}, because this is their account.`;
  };
  function showCreate(name) {
    createName.value = name;
    createType.value = "other";
    createError.hidden = true;
    createNote.textContent = scopeText();
    mount(createActions, button("Cancel", hideCreate), button("Add merchant", () => void submitCreate(false), { variant: "primary" }));
    createBox.hidden = false;
    createName.focus();
  }
  function hideCreate() { createBox.hidden = true; picker.input.focus(); }
  function refreshMerchantChoices() {
    merchants = ((sliceFor(ctx.store.getState(), "payees").data || {}).payees || []);
    picker.setItems(choosableMerchants(merchants, accountOf(currentAccountId())));
  }
  function useExisting(existing) {
    if (existing.status === "closed") { createError.textContent = `${existing.name} is closed. Reopen it on the Merchants tab to use it again.`; createError.hidden = false; return; }
    picker.select(merchants.find((p) => p.id === existing.id) || existing);
    createBox.hidden = true;
    picker.input.focus();
  }
  async function submitCreate(allowDuplicate) {
    createError.hidden = true;
    const name = createName.value.trim();
    // The name field is marked and linked to its message (A11Y2-012).
    const markName = () => { createName.setAttribute("aria-invalid", "true"); createName.setAttribute("aria-errormessage", createError.id); };
    createName.removeAttribute("aria-invalid");
    if (!name) { createError.textContent = "Enter the merchant's name."; createError.hidden = false; markName(); createName.focus(); return; }
    try {
      const body = { name, type: createType.value, accountId: currentAccountId() };
      if (allowDuplicate) body.allowDuplicate = true;
      const out = await ctx.api.createMerchant(state.selectedWorkspaceId, body);
      await ctx.store.actions.refreshPayees();
      refreshMerchantChoices();
      picker.select({ id: out.payee.id, name: out.payee.name, visibility: out.payee.visibility });
      createBox.hidden = true;
      picker.input.focus();
      announce(`${out.payee.name} added and selected.`);
    } catch (err) {
      createError.textContent = messageFor(err);
      createError.hidden = false;
      markName();
      if (err && err.code === "duplicate_merchant" && err.details) {
        const existing = err.details;
        mount(createActions, button("Cancel", hideCreate), button(`Use ${existing.name}`, () => useExisting(existing), { variant: "primary" }),
          button("Add as a separate merchant", () => void submitCreate(true)));
      }
    }
  }
  // Enter in the new-merchant name adds the merchant; it must never submit the expense form.
  createName.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void submitCreate(false); } });

  async function onMerchant(m) {
    for (const [name, control] of Object.entries(watched)) clearHint(name, control);
    if (!m || editing) return;
    try {
      const { suggestion } = await ctx.api.suggest(state.selectedWorkspaceId, m.id);
      const applyHint = (name, control, value, reason) => {
        if (value === null || value === undefined || touched.has(name) || !hints[name]) return;
        control.value = value;
        hints[name].replaceChildren(el("span", { class: "suggestion__mark", text: "Suggested" }), el("span", { text: ` — ${reason}` }));
        hints[name].hidden = false;
        const described = new Set((control.getAttribute("aria-describedby") || "").split(" ").filter(Boolean));
        described.add(hints[name].id);
        control.setAttribute("aria-describedby", [...described].join(" "));
      };
      if (suggestion.accountId && accounts.some((a) => a.id === suggestion.accountId)) { applyHint("account", account, suggestion.accountId, suggestion.accountReason); onAccountChange(); }
      applyHint("category", category, suggestion.categoryId, suggestion.categoryReason);
      applyHint("amount", amount, suggestion.amount, suggestion.amountReason);
      if (suggestion.tags.length) applyHint("tags", tags, suggestion.tags.join(", "), "From your last entry for this merchant.");
      announce("Suggestions filled from your earlier entries. Every field stays editable.");
    } catch (err) { /* a suggestion is optional; entry still works without it */ }
  }

  function onAccountChange() {
    setAmountLabel();
    refreshMerchantChoices();
    createNote.textContent = scopeText();
    const chosen = picker.getSelected();
    if (chosen && !choosableMerchants(merchants, accountOf(currentAccountId())).some((p) => p.id === chosen.id)) {
      picker.select(null);
      announce("The merchant was cleared: it cannot be used with this account.");
    }
  }

  const transferBox = el("div", { class: "form-grid more", hidden: kind.value !== "transfer" || editing }, [
    field("To account", toAccount), field("Amount received", toAmount, { help: "Only when the currencies differ." }), field("Or exchange rate", rate),
  ]);
  kind.addEventListener("change", () => { transferBox.hidden = kind.value !== "transfer"; });
  account.addEventListener("change", onAccountChange);

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

  const amountField = el("div", { class: "field" }, [amountLabel, amount, amountPreview, hintFor("amount")]);
  if (!amount.id) amount.id = `${key}-amount`;
  amountLabel.setAttribute("for", amount.id);
  setAmountLabel();

  // The footer button belongs to the form, so Enter in a field submits it (UX2-006).
  const save = el("button", { type: "submit", class: "btn btn--primary", text: editing ? "Save changes" : "Save expense", form: `${key}-form` });
  const cancel = button("Cancel", () => modal.close());
  const form = el("form", { class: "form-grid", novalidate: true, id: `${key}-form` }, [
    lock ? el("p", { class: "field__help field--wide reversal-lock", text: lock }) : null,
    el("div", { class: "field" }, [el("label", { class: "field__label", for: picker.input.id, text: "Merchant" }), picker.element, merchantLink]),
    createBox,
    amountField,
    withHint("Account", "account", account),
    withHint("Category", "category", category),
    field("Date", date),
    field("Type", kind),
    transferBox,
    editing ? field("Reason for this change", reason, { help: "Needed when you change the amount, date, type, category or merchant, or un-reconcile. It is kept with the entry's history.", wide: true }) : null,
    el("details", { class: "more" }, [
      el("summary", { text: "More details (tags, status, notes)" }),
      el("div", { class: "form-grid" }, [withHint("Tags", "tags", tags), field("Status", status), field("Notes", notes, { wide: true })]),
    ]),
  ]);
  const modal = openModal({ title: editing ? "Edit entry" : "Add expense", body: [form, el("p", { class: "field__help", text: "Suggestions use only entries you are allowed to see and are never saved until you save." })], actions: [cancel, save] });
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });

  // Only the fields the person changed are sent, so history records real changes (audit B7).
  function editBody(value, tagList) {
    const t = transaction;
    const body = { transactionId: t.id, revision: t.revision };
    if (Number(value) !== Math.abs(Number(t.amount))) body.amount = value;
    if (date.value !== t.date) body.date = date.value;
    if (notes.value !== (t.notes || "")) body.notes = notes.value;
    if (tagList.join(",") !== (t.tags || []).join(",")) body.tags = tagList;
    if (status.value !== t.status) body.status = status.value;
    if (!isTransfer) {
      if (kind.value !== t.kind) body.kind = kind.value;
      if ((category.value || null) !== (t.categoryId || null)) body.categoryId = category.value || null;
      if (picker.getValue() !== (t.payeeId || null)) body.payeeId = picker.getValue();
    }
    return body;
  }

  async function submit() {
    modal.setError("");
    const value = computedAmount();
    if (!value) {
      // The invalid field is marked and linked to the message (WCAG 3.3.1, A11Y-016).
      amount.setAttribute("aria-invalid", "true");
      amount.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Enter an amount, for example 12.50 or 10+2.50.");
      amount.focus();
      return;
    }
    amount.removeAttribute("aria-invalid");
    amount.removeAttribute("aria-errormessage");
    const tagList = tags.value.split(",").map((t) => t.trim()).filter(Boolean);
    if (editing) {
      const body = editBody(value, tagList);
      if (Object.keys(body).length === 2) { announce("Nothing changed."); modal.close(); return; }
      if (reason.value.trim()) body.reason = reason.value.trim();
      reason.removeAttribute("aria-invalid");
      modal.setBusy(true);
      const out = await ctx.store.actions.write((ws) => ctx.api.updateTransaction(ws, body));
      modal.setBusy(false);
      if (!out.ok) {
        modal.setError(out.error);
        if (out.error && out.error.code === "reason_required") {
          reason.setAttribute("aria-invalid", "true");
          reason.setAttribute("aria-errormessage", modal.errorId);
          reason.focus();
        }
        return;
      }
      announce("Entry saved.");
      modal.close();
      return;
    }
    modal.setBusy(true);
    const out = await ctx.store.actions.write(async (ws) => {
      const body = { accountId: account.value, kind: kind.value, amount: value, date: date.value, notes: notes.value, tags: tagList, status: status.value };
      if (kind.value === "transfer") {
        body.transfer = { toAccountId: toAccount.value };
        if (toAmount.value.trim()) body.transfer.toAmount = toAmount.value.trim();
        else if (rate.value.trim()) body.transfer.rate = rate.value.trim();
      } else {
        if (picker.getValue()) body.payeeId = picker.getValue();
        if (category.value) body.categoryId = category.value;
      }
      return ctx.api.createTransaction(ws, body, key);
    });
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Expense added.");
    modal.close();
  }
}
