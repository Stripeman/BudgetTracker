// Bills (BT-008-02): rent or mortgage, utilities, subscriptions, insurance, loan and debt payments,
// memberships, payroll and other items that repeat. The page shows what needs attention (overdue
// and due soon), every bill with its next due date and the next 30 days, and lets the person
// REVIEW each generated payment — amount, date, merchant, category, notes — before it becomes a
// real entry. Changes to a bill's terms take effect from a chosen date and never rewrite payments
// already recorded; bills are ended, never deleted (BT-001-05). The server enforces every rule.
import { el, mount, announce } from "../dom.js";
import { stateView, money, button, field, input, select, badge } from "../components.js";
import { openModal } from "../modal.js";
import { createMerchantPicker } from "../merchantpicker.js";
import { choosableMerchants, canAddEntries } from "./transactions.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { formatDate, formatAmount, todayIso, BILL_TYPE_LABELS } from "../../core/format.js";

const PRESETS = [
  { value: "weekly", label: "Weekly", freq: "weekly", interval: 1 },
  { value: "biweekly", label: "Every 2 weeks", freq: "weekly", interval: 2 },
  { value: "monthly", label: "Monthly", freq: "monthly", interval: 1 },
  { value: "quarterly", label: "Every 3 months", freq: "monthly", interval: 3 },
  { value: "semiannual", label: "Every 6 months", freq: "monthly", interval: 6 },
  { value: "yearly", label: "Yearly", freq: "yearly", interval: 1 },
  { value: "custom", label: "Custom…" },
];
const DIRECTIONS = [{ value: "expense", label: "Money out" }, { value: "income", label: "Money in" }, { value: "transfer", label: "Transfer to another account" }];
const defaultDirection = (billType) => (billType === "income" ? "income" : billType === "savings" ? "transfer" : "expense");
const stamp = (iso) => String(iso || "").replace("T", " ").slice(0, 16);

export function scheduleLabel(s) {
  const day = Number(String(s.startDate).slice(8, 10));
  if (s.freq === "weekly") return s.interval === 1 ? "Weekly" : `Every ${s.interval} weeks`;
  if (s.freq === "yearly") return s.interval === 1 ? `Yearly on ${s.startDate.slice(5)}` : `Every ${s.interval} years`;
  const every = s.interval === 1 ? "Monthly" : `Every ${s.interval} months`;
  return `${every} on day ${day}`;
}

function signedAmount(b) { return b.kind === "income" ? b.amount : `-${b.amount}`; }

function amountCell(b, prefs) {
  return el("span", {}, [
    b.amountType === "variable" ? el("span", { class: "muted", text: "≈ " }) : null,
    money(signedAmount(b), b.currency, prefs),
    b.amountType === "variable" ? el("div", { class: "muted small", text: "varies" }) : null,
  ]);
}

function card(title, value, meta) {
  return el("div", { class: "card" }, [el("h2", { class: "card__title", text: title }), el("div", { class: "card__value", text: value }), meta ? el("p", { class: "card__meta", text: meta }) : null]);
}

function table(headers, rows, label) {
  return el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": label }, [
    el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ])]);
}

export function createView(ctx) {
  const cards = el("div", { class: "grid grid--cards" });
  const attention = el("div");
  const listBox = el("div");
  const actions = el("div", { class: "page-head__actions" });
  const element = el("section", {}, [
    el("div", { class: "page-head" }, [el("h1", { text: "Bills" }), actions]),
    el("p", { class: "muted", text: "Bills and income that repeat. Each payment is reviewed before it becomes an entry, and changing a bill never rewrites payments already recorded." }),
    cards,
    el("h2", { class: "section-title", text: "Needs attention" }), attention,
    el("h2", { class: "section-title", text: "All bills" }), listBox,
  ]);
  void ctx.store.actions.refreshBills();

  function update(state) {
    mount(actions, canAddEntries(state)
      ? button("Add bill", () => openBillEditor(ctx), { variant: "primary" })
      : el("p", { class: "muted small", text: "You can view bills but not add them." }));
    const eff = (state.preferences && state.preferences.effective) || {};
    const plain = { effective: { ...eff, balanceMasking: false } };
    const fmt = (v, c) => formatAmount(v, c, { numberFormat: eff.numberFormat });
    const slice = sliceFor(state, "bills");
    const s = stateView(slice, { empty: "No bills yet. Add rent, utilities, subscriptions, insurance, loan payments or income that repeats.", isEmpty: (d) => !d.recurring.length });
    if (s) { mount(cards); mount(attention); mount(listBox, s); return; }
    const { recurring, summary } = slice.data;
    mount(cards,
      card("Overdue", String(summary.overdue), summary.overdue ? "Past due and not yet recorded or skipped." : "Nothing is overdue."),
      card("Due soon", String(summary.dueSoon), "Within each bill's reminder window."),
      ...summary.next30Days.map((x) => card(`Next 30 days (${x.currency})`, `Out ${fmt(x.outgoing, x.currency)}`, `In ${fmt(x.incoming, x.currency)}`)),
    );

    const items = [];
    for (const b of recurring) {
      for (const d of b.overdue) items.push({ b, date: d, overdue: true });
      for (const d of b.reminders) items.push({ b, date: d, overdue: false });
    }
    items.sort((x, y) => (x.date === y.date ? 0 : x.date < y.date ? -1 : 1));
    mount(attention, items.length ? table(["Due", "Bill", "Account", "Amount", "Actions"], items.map(({ b, date, overdue }) => el("tr", {}, [
      el("th", { scope: "row", "data-label": "Due" }, [el("span", { text: formatDate(date, eff.dateFormat) }), " ", overdue ? badge("Overdue", "overdue") : badge("Due soon")]),
      el("td", { "data-label": "Bill", text: b.name }),
      el("td", { "data-label": "Account", text: b.accountName }),
      el("td", { "data-label": "Amount", class: "num" }, [amountCell(b, plain)]),
      el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
        b.canRecord ? button("Review and record", () => void openRecord(ctx, b, date), { small: true, variant: "primary", attrs: { "aria-label": `Review and record ${b.name}, due ${date}` } }) : null,
        b.canEdit ? button("Skip", () => openSkip(ctx, b, date), { small: true, attrs: { "aria-label": `Skip ${b.name}, due ${date}` } }) : null,
      ])]),
    ])), "Bills that need attention") : el("div", { class: "state", text: "Nothing needs attention." }));

    mount(listBox, table(["Bill", "Account", "Amount", "Schedule", "Next due", "Actions"], recurring.map((b) => el("tr", {}, [
      el("th", { scope: "row", "data-label": "Bill" }, [
        el("strong", { text: b.name }), " ", badge(BILL_TYPE_LABELS[b.billType] || b.billType),
        b.pausedNow ? [" ", badge("Paused")] : null, b.ended ? [" ", badge("Ended", "closed")] : null,
        b.payeeName ? el("div", { class: "muted small", text: b.payeeName }) : null,
      ].flat()),
      el("td", { "data-label": "Account", text: b.kind === "transfer" ? `${b.accountName} → ${b.toAccountName || ""}` : b.accountName }),
      el("td", { "data-label": "Amount", class: "num" }, [amountCell(b, plain)]),
      el("td", { "data-label": "Schedule", text: scheduleLabel(b.schedule) }),
      el("td", { "data-label": "Next due", text: b.ended ? "Ended" : b.nextDue ? formatDate(b.nextDue, eff.dateFormat) : "—" }),
      el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
        b.canRecord && b.nextDue ? button("Record next", () => void openRecord(ctx, b, b.nextDue), { small: true, attrs: { "aria-label": `Review and record the next ${b.name} payment` } }) : null,
        b.canEdit ? button("Edit", () => openBillEditor(ctx, b), { small: true, attrs: { "aria-label": `Edit ${b.name}` } }) : null,
        b.canEdit ? (b.pausedNow
          ? button("Resume", () => openResume(ctx, b), { small: true, attrs: { "aria-label": `Resume ${b.name}` } })
          : button("Pause", () => openPause(ctx, b), { small: true, attrs: { "aria-label": `Pause ${b.name}` } })) : null,
        button("History", () => openHistory(ctx, b), { small: true, attrs: { "aria-label": `History of ${b.name}` } }),
      ])]),
    ])), "All bills"));
  }
  return { element, update };
}

// ---- review and record one payment ----------------------------------------------------------
async function openRecord(ctx, bill, occurrence) {
  const state = ctx.store.getState();
  let draft;
  try {
    draft = (await ctx.api.billDraft(state.selectedWorkspaceId, bill.id, occurrence)).draft;
  } catch (err) {
    const m = openModal({ title: `Record ${bill.name}`, body: [el("p", { text: "This payment could not be prepared." })], actions: [button("Close", () => m.close())] });
    m.setError(err);
    return;
  }
  const key = newIdempotencyKey();
  const eff = (state.preferences && state.preferences.effective) || {};
  const account = ((sliceFor(state, "accounts").data || {}).accounts || []).find((a) => a.id === bill.accountId) || null;
  const categories = ((sliceFor(state, "categories").data || {}).categories || []).filter((c) => !c.archived || c.id === draft.categoryId);
  const merchants = ((sliceFor(state, "payees").data || {}).payees || []);
  const isTransfer = bill.kind === "transfer";
  const amount = input({ inputmode: "decimal", autocomplete: "off", required: true });
  amount.value = draft.amountIsEstimate ? "" : draft.amount;
  const date = input({ type: "date" });
  date.value = draft.date;
  const category = select([{ value: "", label: "Uncategorized" }].concat(categories.map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name }))), draft.categoryId || "");
  const picker = createMerchantPicker({ merchants: choosableMerchants(merchants, account), current: draft.payeeId ? { id: draft.payeeId, name: draft.payeeName } : null });
  const notes = el("textarea", { class: "field__input", maxlength: "5000" });
  const status = select([{ value: "pending", label: "Pending" }, { value: "cleared", label: "Cleared" }], "pending");
  const where = isTransfer ? `from ${bill.accountName} to ${bill.toAccountName || "another account"}` : `from ${bill.accountName}`;
  const record = el("button", { type: "button", class: "btn btn--primary", text: "Record payment" });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({
    title: `Record ${bill.name}`,
    body: [
      el("p", { text: `${draft.overdue ? "Overdue: " : ""}due ${formatDate(occurrence, eff.dateFormat)}, ${where}.` }),
      el("div", { class: "form-grid" }, [
        field(`Amount paid (${draft.currency})`, amount, { help: draft.amountIsEstimate ? `This bill varies; the estimate is ${draft.amount}. Enter the actual amount.` : "Change it if this payment was different." }),
        field("Date paid", date),
        isTransfer ? null : el("div", { class: "field" }, [el("label", { class: "field__label", for: picker.input.id, text: "Merchant" }), picker.element]),
        isTransfer ? null : field("Category", category),
        field("Status", status),
        field("Notes", notes, { wide: true }),
      ]),
      el("p", { class: "field__help", text: "Nothing is saved until you record it. These values apply to this payment only, not to the bill." }),
    ],
    actions: [cancel, record],
  });
  record.addEventListener("click", async () => {
    modal.setError("");
    const value = amount.value.trim();
    if (!value) {
      amount.setAttribute("aria-invalid", "true");
      amount.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Enter the amount paid.");
      amount.focus();
      return;
    }
    amount.removeAttribute("aria-invalid");
    const body = { recurringId: bill.id, occurrence, amount: value, date: date.value, status: status.value };
    if (notes.value.trim()) body.notes = notes.value;
    if (!isTransfer) {
      if ((category.value || null) !== (draft.categoryId || null)) body.categoryId = category.value || null;
      if (picker.getValue() !== (draft.payeeId || null)) body.payeeId = picker.getValue();
    }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.billAction(ws, "record", body, key), ["bills", "transactions", "accounts"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(`${bill.name} recorded.`);
    modal.close();
  });
}

// ---- skip, pause, resume ------------------------------------------------------------------------
function simpleAction(ctx, { title, intro, fields: controls, confirmLabel, action, body }) {
  const confirm = el("button", { type: "button", class: "btn btn--primary", text: confirmLabel });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({ title, body: [el("p", { text: intro }), el("div", { class: "form-grid" }, controls)], actions: [cancel, confirm] });
  confirm.addEventListener("click", async () => {
    modal.setError("");
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.billAction(ws, action, body()), ["bills"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(`${title.replace(/\?$/, "")} — done.`);
    modal.close();
  });
}

function openSkip(ctx, bill, occurrence) {
  const reason = input({ maxlength: "200", placeholder: "Optional" });
  simpleAction(ctx, {
    title: `Skip ${bill.name}?`, intro: `The payment due ${occurrence} will not be expected, forecast or reminded about. You can undo this from the bill's history.`,
    fields: [field("Reason", reason)], confirmLabel: "Skip this payment", action: "skip",
    body: () => ({ recurringId: bill.id, occurrence, ...(reason.value.trim() ? { reason: reason.value.trim() } : {}) }),
  });
}

function openPause(ctx, bill) {
  const from = input({ type: "date" });
  from.value = bill.nextDue || todayIso();
  const until = input({ type: "date" });
  simpleAction(ctx, {
    title: `Pause ${bill.name}?`, intro: "Payments inside the pause are not expected, forecast or reminded about. Leave the end empty to pause until you resume.",
    fields: [field("Pause from", from), field("Until (optional)", until)], confirmLabel: "Pause", action: "pause",
    body: () => ({ recurringId: bill.id, from: from.value, ...(until.value ? { until: until.value } : {}) }),
  });
}

function openResume(ctx, bill) {
  const date = input({ type: "date" });
  date.value = todayIso();
  simpleAction(ctx, {
    title: `Resume ${bill.name}?`, intro: "Payments from this date are expected again. The pause stays in the bill's history.",
    fields: [field("Resume from", date)], confirmLabel: "Resume", action: "resume",
    body: () => ({ recurringId: bill.id, date: date.value }),
  });
}

function openHistory(ctx, bill) {
  const state = ctx.store.getState();
  const eff = (state.preferences && state.preferences.effective) || {};
  const categories = new Map(((sliceFor(state, "categories").data || {}).categories || []).map((c) => [c.id, c.name]));
  const plain = { effective: { ...eff, balanceMasking: false } };
  const close = button("Close", () => modal.close());
  const unskip = (date) => ctx.store.actions.write((ws) => ctx.api.billAction(ws, "unskip", { recurringId: bill.id, occurrence: date }), ["bills"]);
  const modal = openModal({
    title: `${bill.name}: history`,
    body: [
      el("h3", { text: "Terms over time" }),
      table(["From", "Amount", "Merchant", "Category"], bill.versions.map((v) => el("tr", {}, [
        el("th", { scope: "row", "data-label": "From", text: formatDate(v.effectiveFrom, eff.dateFormat) }),
        el("td", { "data-label": "Amount", class: "num" }, [money(bill.kind === "income" ? v.amount : `-${v.amount}`, bill.currency, plain), v.amountType === "variable" ? el("div", { class: "muted small", text: "varies" }) : null]),
        el("td", { "data-label": "Merchant", text: v.payeeName || "—" }),
        el("td", { "data-label": "Category", text: categories.get(v.categoryId) || "—" }),
      ])), "Terms over time"),
      el("h3", { text: "Skipped payments" }),
      bill.skips.length ? el("ul", { class: "history-list" }, bill.skips.map((s) => el("li", {}, [
        el("span", { text: `${formatDate(s.date, eff.dateFormat)}${s.reason ? ` — ${s.reason}` : ""} ` }),
        bill.canEdit ? button("Undo skip", async () => { const out = await unskip(s.date); if (out.ok) { announce("Skip undone."); modal.close(); } else modal.setError(out.error); }, { small: true }) : null,
      ]))) : el("p", { class: "muted", text: "None." }),
      el("h3", { text: "Pauses" }),
      bill.pauses.length ? el("ul", { class: "history-list" }, bill.pauses.map((p) => el("li", { text: `${formatDate(p.from, eff.dateFormat)} to ${p.until ? formatDate(p.until, eff.dateFormat) : "until resumed"}` }))) : el("p", { class: "muted", text: "None." }),
      el("h3", { text: "Changes" }),
      el("ul", { class: "history-list" }, bill.history.slice().reverse().map((h) => el("li", {}, [el("div", { class: "muted small", text: `${stamp(h.at)} · ${h.by}` }), el("div", { text: h.fields.join(", ") })]))),
    ],
    actions: [close],
  });
}

// ---- create or edit a bill ------------------------------------------------------------------
export function openBillEditor(ctx, bill = null) {
  const state = ctx.store.getState();
  const editing = !!bill;
  const key = newIdempotencyKey();
  const allAccounts = ((sliceFor(state, "accounts").data || {}).accounts || []);
  // Closed accounts take no new bills, so they are not offered (BT-001-05).
  const accounts = allAccounts.filter((a) => !a.deletedAt && a.status !== "closed" && a.capabilities.includes("create"));
  if (!editing && !accounts.length) return;
  const categories = ((sliceFor(state, "categories").data || {}).categories || []).filter((c) => !c.archived || (editing && c.id === bill.categoryId));
  let merchants = ((sliceFor(state, "payees").data || {}).payees || []);
  const b = bill || {};

  const name = input({ maxlength: "80", autocomplete: "off" });
  name.value = b.name || "";
  const billType = select(Object.entries(BILL_TYPE_LABELS).map(([value, label]) => ({ value, label })), b.billType || "housing");
  const direction = select(DIRECTIONS, b.kind === "transfer" ? "transfer" : b.kind === "income" ? "income" : defaultDirection(b.billType || "housing"), { disabled: editing });
  const account = select(accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), b.accountId || (accounts[0] || {}).id, { disabled: editing });
  const toAccount = select(accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), b.toAccountId || "", { disabled: editing });
  const amount = input({ inputmode: "decimal", autocomplete: "off" });
  amount.value = b.amount || "";
  const amountType = select([{ value: "fixed", label: "Always the same" }, { value: "variable", label: "Varies (estimate)" }], b.amountType || "fixed");
  const preset = select(PRESETS, editing ? "custom" : "monthly", { disabled: editing });
  const interval = input({ type: "number", min: "1", max: "52", value: "1" });
  const unit = select([{ value: "weekly", label: "weeks" }, { value: "monthly", label: "months" }, { value: "yearly", label: "years" }], "monthly");
  const customBox = el("div", { class: "form-grid", hidden: true }, [field("Every", interval), field("Unit", unit)]);
  const startDate = input({ type: "date", disabled: editing });
  startDate.value = b.schedule ? b.schedule.startDate : todayIso();
  const endDate = input({ type: "date" });
  endDate.value = (b.schedule && b.schedule.endDate) || "";
  const category = select([{ value: "", label: "Uncategorized" }].concat(categories.map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name }))), b.categoryId || "");
  const accountOf = (id) => allAccounts.find((a) => a.id === id) || null;
  const picker = createMerchantPicker({ merchants: choosableMerchants(merchants, accountOf(account.value)), current: b.payeeId ? { id: b.payeeId, name: b.payeeName } : null });
  const responsible = select([{ value: "", label: "Nobody in particular" }], "");
  const reminder = input({ type: "number", min: "0", max: "60" });
  reminder.value = String(b.reminderDays === undefined ? 3 : b.reminderDays);
  const notes = el("textarea", { class: "field__input", maxlength: "2000", text: b.notes || "" });
  const effectiveFrom = input({ type: "date" });
  effectiveFrom.value = b.nextDue || todayIso();

  // The responsible person comes from the people selector (members and contacts).
  void ctx.api.people(state.selectedWorkspaceId, "responsible").then((res) => {
    const options = [{ value: "", label: "Nobody in particular" }].concat((res.options || []).map((o) => ({ value: o.ref, label: `${o.label} (${o.typeLabel})` })));
    responsible.replaceChildren(...options.map((o) => el("option", { value: o.value, text: o.label })));
    responsible.value = (b.responsible && b.responsible.ref) || "";
  }).catch(() => {});

  const transferOnly = el("div", { class: "form-grid", hidden: direction.value !== "transfer" }, [field("To account", toAccount)]);
  const notTransfer = el("div", { class: "form-grid", hidden: direction.value === "transfer" }, [
    el("div", { class: "field" }, [el("label", { class: "field__label", for: picker.input.id, text: "Merchant" }), picker.element]),
    field("Category", category), field("Responsible person", responsible),
  ]);
  const syncDirection = () => { transferOnly.hidden = direction.value !== "transfer"; notTransfer.hidden = direction.value === "transfer"; };
  billType.addEventListener("change", () => { if (!editing) { direction.value = defaultDirection(billType.value); syncDirection(); } });
  direction.addEventListener("change", syncDirection);
  preset.addEventListener("change", () => { customBox.hidden = preset.value !== "custom"; });
  account.addEventListener("change", () => {
    merchants = ((sliceFor(ctx.store.getState(), "payees").data || {}).payees || []);
    picker.setItems(choosableMerchants(merchants, accountOf(account.value)));
    const chosen = picker.getSelected();
    if (chosen && !choosableMerchants(merchants, accountOf(account.value)).some((p) => p.id === chosen.id)) picker.select(null);
  });

  const scheduleFields = editing
    ? [el("p", { class: "field--wide muted", text: `${scheduleLabel(b.schedule)}, from ${b.schedule.startDate}. To change how often it repeats, end this bill and add a new one.` }), field("End date (optional)", endDate)]
    : [field("Repeats", preset), customBox, field("First payment", startDate), field("End date (optional)", endDate)];
  const form = el("form", { class: "form-grid", novalidate: true }, [
    field("Name", name), field("Type", billType), field("Direction", direction),
    field("Account", account), transferOnly,
    field("Amount", amount), field("Amount is", amountType),
    ...scheduleFields,
    notTransfer,
    field("Remind me (days before)", reminder),
    field("Notes", notes, { wide: true }),
    editing ? field("Changes to amount, merchant, category or responsible person take effect from", effectiveFrom, { help: "Payments already recorded are never changed.", wide: true }) : null,
  ]);
  const save = el("button", { type: "submit", class: "btn btn--primary", text: editing ? "Save changes" : "Add bill" });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({ title: editing ? `Edit ${b.name}` : "Add bill", body: [form], actions: [cancel, save] });
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });

  const invalid = (control, message) => {
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-errormessage", modal.errorId);
    modal.setError(message);
    control.focus();
  };

  function createBody() {
    const p = PRESETS.find((x) => x.value === preset.value);
    const schedule = p && p.freq ? { freq: p.freq, interval: p.interval, startDate: startDate.value } : { freq: unit.value, interval: Number(interval.value), startDate: startDate.value };
    if (endDate.value) schedule.endDate = endDate.value;
    const out = { name: name.value.trim(), billType: billType.value, kind: direction.value, accountId: account.value, amount: amount.value.trim(), amountType: amountType.value, schedule, reminderDays: Number(reminder.value || 0) };
    if (notes.value.trim()) out.notes = notes.value;
    if (direction.value === "transfer") out.toAccountId = toAccount.value;
    else {
      if (picker.getValue()) out.payeeId = picker.getValue();
      if (category.value) out.categoryId = category.value;
      if (responsible.value) out.responsibleRef = responsible.value;
    }
    return out;
  }

  // Only changed fields are sent; term changes carry the chosen effective date.
  function editBody() {
    const out = { recurringId: b.id, revision: b.revision };
    if (name.value.trim() !== b.name) out.name = name.value.trim();
    if (billType.value !== b.billType) out.billType = billType.value;
    if (notes.value !== (b.notes || "")) out.notes = notes.value;
    if (Number(reminder.value || 0) !== b.reminderDays) out.reminderDays = Number(reminder.value || 0);
    if ((endDate.value || null) !== (b.schedule.endDate || null)) out.endDate = endDate.value || null;
    const terms = {};
    if (Number(amount.value) !== Number(b.amount)) terms.amount = amount.value.trim();
    if (amountType.value !== b.amountType) terms.amountType = amountType.value;
    if (b.kind !== "transfer") {
      if ((category.value || null) !== (b.categoryId || null)) terms.categoryId = category.value || null;
      if (picker.getValue() !== (b.payeeId || null)) terms.payeeId = picker.getValue();
      if ((responsible.value || null) !== ((b.responsible && b.responsible.ref) || null)) terms.responsibleRef = responsible.value || null;
    }
    if (Object.keys(terms).length) Object.assign(out, terms, { effectiveFrom: effectiveFrom.value });
    return out;
  }

  async function submit() {
    modal.setError("");
    for (const c of [name, amount]) c.removeAttribute("aria-invalid");
    if (!name.value.trim()) { invalid(name, "Give the bill a name, for example Rent."); return; }
    if (!amount.value.trim()) { invalid(amount, "Enter the amount, or your best estimate if it varies."); return; }
    const body = editing ? editBody() : createBody();
    if (editing && Object.keys(body).length === 2) { announce("Nothing changed."); modal.close(); return; }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => (editing ? ctx.api.updateBill(ws, body) : ctx.api.createBill(ws, body, key)), ["bills"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(editing ? "Bill saved." : "Bill added.");
    modal.close();
  }
}
