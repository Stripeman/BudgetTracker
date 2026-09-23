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
import { stateView, money, button, field, input, pickerSelect, categoryBadges, iconBadges, badge, categoryLabel } from "../components.js";
import { categoryIndex } from "../../core/categories.js";
import { openModal } from "../modal.js";
import { openDeleteDialog } from "../permanentdelete.js";
import { createMerchantSelect, setMerchantOptions, readMerchantSelect, selectMerchant } from "../merchantselect.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { messageFor } from "../../core/errors.js";
import { evaluateAmount, isPlainAmount } from "../../core/calc.js";
import { formatDate, formatAmount, todayIso, KIND_LABELS, MERCHANT_TYPE_LABELS } from "../../core/format.js";
import { parseAmount, formatMinor } from "../../core/split.js";
import { icon, withIcon, defaultIconFor } from "../icons.js";
import { amountWithDirection, transferLabel, amountText } from "../components.js";
import { directionOf } from "../icons.js";
import { createActionsMenu } from "../actionsmenu.js";
// bills.js already imports choosableMerchants/canAddEntries/addEntriesBlocked from this module; this
// is the one place the dependency runs the other way, calling into it only from an onClick handler
// (never at module-evaluation time), which ES modules resolve correctly either way.
import { openBillEditor } from "./bills.js";
import { effectiveLayoutId, layoutAccentVars } from "../../core/layoutmeta.js";

export { amountWithDirection };

// The amount shown for an entry: with its money arrow (in or out), or — for an amount owed to others for
// a shared expense, where no money moved — no arrow and the words "No money moved" (Terry's rule: arrows
// only for money actually in or out; BT-009 recheck N3).
export function entryAmount(t, prefs) {
  if (directionOf(t) !== "no-money-moved") return amountWithDirection(t, prefs);
  // The |==| mark, the amount in neutral colour (neither in nor out) and the words: the mark is
  // decorative, the words say it (BT-011-05: an icon never stands alone).
  return el("span", { class: "amount-dir" }, [
    el("span", { class: "dir" }, [icon("no-money-moved")]),
    amountText(t.amount, t.currency, prefs),
    // A share someone else paid says so (financial recheck L4); an amount owed says no money moved.
    el("span", { class: "muted small", text: t.paidBySomeoneElse ? " Paid by someone else" : " No money moved" }),
  ]);
}

const PRECISION = { JPY: 0, KRW: 0, ISK: 0, CLP: 0, VND: 0, BHD: 3, KWD: 3, JOD: 3, OMR: 3, TND: 3 };
const precisionOf = (c) => (c in PRECISION ? PRECISION[c] : 2);
const STATUS_LABELS = { pending: "Pending", cleared: "Cleared", reconciled: "Reconciled" };

// A reversal and the entry it reverses keep their financial details for good (FIN-R1): only notes,
// tags and status can change, so the edit form locks the rest and says why. The server enforces it.
// An entry recorded from Shared expenses follows the shared expense: the server keeps its financial
// details locked here (BT-009 recheck N2), and the form says where to change it.
// The server says so even when it does not show which shared expense (security recheck R3-3).
export const sharedLinked = (t) => !!(t.fromSharedExpense || (t.links && (t.links.groupExpenseId || t.links.groupSettlementId)));
export function reversalLock(t) {
  if (sharedLinked(t)) return "This entry was recorded from Shared expenses, so its amount, date, type, category and merchant follow the shared expense. Change it in Shared expenses; notes, tags and status can be changed here.";
  if (t.reversedBy) return "This entry has been reversed, so its amount, date, type, category and merchant can no longer change. To correct it, add a new entry.";
  if (t.links && t.links.reverses) return "This is a reversal, so its amount, date, type, category and merchant always match the entry it reverses. To correct it, add a new entry.";
  return null;
}

// "Add as bill" (Terry, 2026-09-18: "button next to a transaction to add transaction as a bill and
// carry over/refill data from the transaction to bill"): what a NEW bill starts with from this
// entry — its own account, direction, amount, category, merchant, notes, responsible person and
// date (as the bill's first-payment date), nothing guessed beyond what the entry already says. A
// bill's own recurrence (how often, how many days ahead it is due) has no equivalent on a single
// entry, so those are left at openBillEditor's normal new-bill defaults, exactly as if "Add bill"
// had been opened directly. Only "income" and "transfer" map onto a bill's own kind/billType;
// every other transaction kind (expense, adjustment, advance, reimbursement, …) leaves both at the
// bill form's own default, since a bill only really distinguishes those three directions today.
// A transaction's own amount is SIGNED (negative for money out, e.g. "-45.67"; ledger.js's
// transactionView, via money.toDecimal); a bill's amount is always an unsigned magnitude — its
// direction picker supplies the sign back where it matters (bills.js's own signedAmount()) — so the
// sign is stripped here, never carried into the bill's Amount field.
export function billPrefillFrom(t) {
  const income = t.kind === "income";
  const transfer = t.kind === "transfer";
  return {
    name: t.payeeName || "",
    accountId: t.accountId,
    kind: transfer ? "transfer" : income ? "income" : undefined,
    billType: income ? "income" : undefined,
    toAccountId: transfer && t.counterpartAccountId ? t.counterpartAccountId : undefined,
    amount: String(t.amount || "").replace(/^-/, ""),
    categoryId: t.categoryId || undefined,
    payeeId: t.payeeId || undefined,
    payeeName: t.payeeName || undefined,
    notes: t.notes || undefined,
    responsible: t.responsible || undefined,
    schedule: { startDate: t.date },
  };
}

// A reversal and its original are deleted together (FIN-R2), so the dialog says so.
export function linkedDeleteNote(t) {
  if (t.reversedBy) return "Its reversal is deleted with it, so the two keep cancelling out.";
  if (t.links && t.links.reverses) return "The entry it reverses is deleted with it, so the two keep cancelling out.";
  return null;
}

// MOVE TO ANOTHER ACCOUNT (BT-006-05; Terry, 2026-09-14: "i should be able to move a transaction from
// one account to the next if i accidentally choose the wrong account in the first place"). Eligible
// destinations: same currency as the entry, open, where the caller may add entries, and not the
// entry's current account. The server enforces every one of these rules again.
export function moveDestinations(allAccounts, t) {
  return (allAccounts || []).filter((a) => !a.deletedAt && a.status !== "closed" && a.id !== t.accountId && a.currency === t.currency && (a.capabilities || []).includes("create"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A clear note only when visibility (or a private account's owner) actually changes, in Terry's
// requested wording.
export function moveVisibilityNote(from, to) {
  if (!from || !to) return null;
  if (from.visibility === "shared" && to.visibility === "private") {
    return to.ownedBySelf
      ? "Moving to your private account makes this entry visible only to you (and anyone you grant access to)."
      : `Moving to ${to.ownerName || "another member"}'s private account makes this entry visible only to them.`;
  }
  if (to.visibility === "shared" && from.visibility === "private") {
    return "Moving to a shared account makes this entry visible to everyone who can see that account.";
  }
  if (from.visibility === "private" && to.visibility === "private" && Boolean(from.ownedBySelf) !== Boolean(to.ownedBySelf)) {
    return to.ownedBySelf
      ? "Moving to your own private account makes this entry visible only to you."
      : `Moving to ${to.ownerName || "another member"}'s private account makes this entry visible only to them.`;
  }
  return null;
}

// A signed decimal string as minor units (money.parseDecimal's client mirror, split.js only parses
// positive amounts); null when it cannot be parsed exactly. Never binary floating point.
function signedMinor(text, currency) {
  const s = String(text ?? "").trim();
  const neg = s.startsWith("-");
  const abs = parseAmount(neg ? s.slice(1) : s, currency);
  return abs === null ? null : (neg ? -abs : abs);
}

// A plain, hand-checkable summary of the two balances a move changes ("Account A goes from X to Y;
// Account B from P to Q"): exact decimal-string arithmetic, computed from what is already on the page.
// The server recomputes and is authoritative; a value this cannot parse is simply left out.
export function moveImpactText(from, to, t, prefs) {
  if (!from || !to) return "";
  const effective = (prefs && prefs.effective) || {};
  const entry = signedMinor(t.amount, t.currency);
  const before = signedMinor(from.balance, from.currency);
  const destBefore = signedMinor(to.balance, to.currency);
  const fmt = (minor, currency) => formatAmount(formatMinor(minor, currency), currency, { numberFormat: effective.numberFormat });
  if (entry === null || before === null || destBefore === null) return `${from.name} to ${to.name}.`;
  return `${from.name} goes from ${fmt(before, from.currency)} to ${fmt(before - entry, from.currency)}; ${to.name} from ${fmt(destBefore, to.currency)} to ${fmt(destBefore + entry, to.currency)}.`;
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
  // A shared-expense group or a trip needs no account (Terry, 2026-09-14; BT-009): lead there.
  if (!open.length && what === "entries" && (ws.kind === "group" || ws.kind === "trip")) {
    return el("p", { class: "muted small" }, ["Shared expenses need no account: record them on Shared expenses. Add an account only to track your own money here. ", el("a", { href: "#/group", text: "Go to Shared expenses" })]);
  }
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
  // BT-013-16: the workspace's real, applied (or previewed) layout picks how filterBox/summary/
  // tableBox are ARRANGED below — the SAME persistent elements every layout reuses (filters, the
  // table, every edit/reverse/move/delete/add-as-bill action stay completely shared and unchanged;
  // `mount()` reparents these existing nodes rather than rebuilding them, so nothing inside is ever
  // lost — an open filter panel or an in-progress action menu survives a layout switch). Only a KPI
  // strip (the SAME real per-currency summary figures already computed below, never a second
  // calculation) and the card styling around the table differ per flagship layout.
  const kpiStrip = el("div");
  const bodyHost = el("div");
  const element = el("section", {}, [el("div", { class: "page-head" }, [el("h1", { text: "Transactions" }), actions]), bodyHost]);
  const classicArrangement = el("div", {}, [filterBox, summary, tableBox]);
  const FLAGSHIP_IDS = new Set(["ledgerfly-forecast", "finexa-budget", "acru-overview"]);
  // Genuinely different subhead per flagship identity (matching each one's own Dashboard treatment,
  // Terry's item 7: "organize reusable presentation components" — the same "Overview"/subhead idiom,
  // reused here rather than a fourth new pattern invented for this one page).
  const SUBHEAD = {
    "finexa-budget": { title: "Overview", note: "Every entry, filtered and totalled." },
    "acru-overview": { title: "Overview", note: null },
  };
  let mountedLayout = null;
  function arrangementFor(layoutId) {
    // Only the three real flagship ids get the flagship arrangement — an unknown or demo-only id
    // (one of the twelve Gallery concepts not yet integrated, or a stale/rolled-back value) falls
    // back to Classic, exactly like app/js/ui/views/dashboard.js's own `FLAGSHIP_RENDERERS[layoutId]`
    // lookup, never treated as "anything that is not literally the string classic".
    if (!FLAGSHIP_IDS.has(layoutId)) return classicArrangement;
    const sub = SUBHEAD[layoutId];
    return el("div", { class: "dashflag", vars: layoutAccentVars(ctx.store.getState(), layoutId) }, [
      sub ? el("div", { class: "dashflag-subhead" }, [el("h2", { text: sub.title }), sub.note ? el("p", { class: "muted small", text: sub.note }) : null]) : null,
      kpiStrip, filterBox,
      el("section", { class: "card", "aria-labelledby": "txn-ledger" }, [el("h2", { class: "card__title", id: "txn-ledger", text: "Ledger" }), summary, tableBox]),
    ]);
  }
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
    // stays reachable (BT-001-05). The dropdowns are TaskTracker's command picker (BT-004-05), with
    // the icon or colour each record shows everywhere else.
    // BT-025 (Terry, 2026-09-23): "category and type dropdowns should be alphabetized... in all
    // forms" — sorted copies (the state arrays are frozen); a filter's own "Any" default is
    // unaffected either way.
    const sortedPayees = [...payees.payees].sort((a, b) => a.name.localeCompare(b.name));
    const sortedAccounts = [...accounts.accounts].sort((a, b) => a.name.localeCompare(b.name));
    const sortedCategories = [...categories.categories].sort((a, b) => a.name.localeCompare(b.name));
    mount(filterGrid,
      filterControl("Search", "q", input({ type: "search", placeholder: "Merchant, note or tag" })),
      filterControl("Merchant", "payeeId", pickerSelect(any.concat(sortedPayees.map((p) => ({ value: p.id, label: p.status === "closed" ? `${p.name} (closed)` : p.name }))), "", {}, { badgeOf: iconBadges(payees.payees, "store") })),
      filterControl("Account", "accountId", pickerSelect(any.concat(sortedAccounts.map((a) => ({ value: a.id, label: a.name }))), "", {}, { badgeOf: iconBadges(accounts.accounts) })),
      filterControl("Category", "categoryId", pickerSelect(any.concat(sortedCategories.map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name }))), "", {}, { badgeOf: categoryBadges(state) })),
      filterControl("From", "from", input({ type: "date" })),
      filterControl("To", "to", input({ type: "date" })),
      filterControl("Min amount", "min", input({ inputmode: "decimal", placeholder: "0.00" })),
      filterControl("Max amount", "max", input({ inputmode: "decimal" })),
      filterControl("Status", "status", pickerSelect(any.concat(Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))), "", {}, { search: false })),
      el("div", { class: "filters__actions" }, [clear]),
    );
  }

  function update(state) {
    renderFilters(state);
    const ws = (state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId);
    const layoutId = effectiveLayoutId(state, ws);
    if (mountedLayout !== layoutId) { mount(bodyHost, arrangementFor(layoutId)); mountedLayout = layoutId; }
    // Preview mode's own read-only guard (BT-013-16, whatever layout is being previewed, Classic
    // included): mirrors app/js/ui/views/dashboard.js's own renderActions — a disabled, explained
    // button rather than one that opens a form any submit would be refused for anyway.
    mount(actions, state.layoutPreview
      ? button("Add expense", () => {}, { variant: "primary", attrs: { disabled: true, "aria-disabled": "true", title: "This is a read-only layout preview. Exit preview to make changes." } })
      : canAddEntries(state) ? button("Add expense", () => openQuickEntry(ctx), { variant: "primary" }) : addEntriesBlocked(state));
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
        // What is owed to the account holder, or what they owe, from lending and shared expenses (BT-009).
        !x.receivable || /^-?0(\.0+)?$/.test(x.receivable) ? null : el("span", { text: x.receivable.startsWith("-") ? ` · you owe ${fmt(x.receivable.slice(1), x.currency)}` : ` · owed to you ${fmt(x.receivable, x.currency)}` }),
        ` (${x.count} ${x.count === 1 ? "entry" : "entries"})`,
      ])));
    } else mount(summary);
    // BT-013-16: the flagship layouts' own KPI strip — the SAME real per-currency figures the plain
    // summary line above already states, never a second calculation, just a more visual composition
    // for the one currency with the most entries filtered (matching Dashboard's own single-currency
    // KPI-strip convention). Not shown at all on Classic (kpiStrip is not in its DOM tree).
    if (txns.data && txns.data.summary.length) {
      const x = [...txns.data.summary].sort((a, b) => b.count - a.count)[0];
      mount(kpiStrip, el("div", { class: "dashflag-kpis" }, [
        { label: "Spent", value: fmt(x.gross, x.currency), emphasize: true },
        { label: "Refunds", value: fmt(x.refunds, x.currency) },
        { label: "Net", value: fmt(x.net, x.currency) },
        { label: "Entries", value: String(x.count) },
      ].map((k) => el("div", { class: ["dashflag-kpi", k.emphasize ? "dashflag-kpi--emphasis" : ""] }, [
        el("p", { class: "dashflag-kpi__label", text: k.label }),
        el("p", { class: "dashflag-kpi__value", text: k.value }),
      ]))));
    } else mount(kpiStrip);
    if (s) { mount(tableBox, s); return; }
    // Merchant and account icons come from the records themselves (BT-011-05).
    const merchantIcons = new Map(((sliceFor(state, "payees").data || {}).payees || []).map((p) => [p.id, p.icon || "store"]));
    const allAccounts = ((sliceFor(state, "accounts").data || {}).accounts || []);
    const accountsById = new Map(allAccounts.map((a) => [a.id, a]));
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
      el("td", { "data-label": "Amount", class: "num" }, [entryAmount(t, prefs)]),
      el("td", { "data-label": "Status" }, [
        badge(STATUS_LABELS[t.status] || t.status),
        t.reversedBy ? [" ", badge("Reversed", "closed")] : null,
        t.links && t.links.reverses ? [" ", badge("Reversal")] : null,
        t.kind !== "expense" ? el("div", { class: "muted small", text: KIND_LABELS[t.kind] || t.kind }) : null,
      ].flat()),
      // BT-015 compact record actions menu (Terry, 2026-09-18): exact preserved order Edit, Reverse,
      // Move (renamed from "Move to another account"), History, Delete, Delete permanently — same
      // permission checks, same handlers, same confirmations, unchanged. Remove/Delete and Delete
      // permanently keep their distinct meanings (recoverable vs irreversible). "Add as bill" (Terry,
      // 2026-09-18) is a new addition placed right after Edit — a recognized recurring payment
      // becomes a bill without retyping it.
      el("td", { "data-label": "" }, [createActionsMenu({
        label: `Actions for ${t.payeeName || "entry"} on ${t.date}`,
        items: [
          t.canEdit ? { text: "Edit", onClick: () => openQuickEntry(ctx, { transaction: t }), attrs: { "aria-label": `Edit ${t.payeeName || "entry"} on ${t.date}` } } : null,
          // Opens the SAME "Add bill" dialog bills.js itself uses, pre-filled from this entry's own
          // account, amount, category, merchant, notes and responsible person (billPrefillFrom,
          // below) — nothing guessed beyond what the entry already says, and every field stays as
          // editable as a normal new bill, since the form is never switched into "editing" mode
          // (openBillEditor's opts.prefill contract). Gated exactly like the Bills page's own "Add
          // bill" button (canAddEntries): no dead menu item when no account can take a new bill.
          // Never offered on an entry where no money actually moved (an amount owed to others, or a
          // share someone else paid, BT-009 recheck N3/L4, directionOf() === "no-money-moved") — a
          // bill is a real scheduled payment from an account, which a payable placeholder is not.
          t.canEdit && canAddEntries(state) && directionOf(t) !== "no-money-moved" ? { text: "Add as bill", onClick: () => openBillEditor(ctx, null, { prefill: billPrefillFrom(t), title: "New bill from entry" }), attrs: { "aria-label": `Add ${t.payeeName || "entry"} on ${t.date} as a bill` } } : null,
          // Corrections never overwrite history (BT-001-05): a reversal cancels an entry, even a
          // reconciled one, and every change is listed under History.
          // Entries recorded from Shared expenses are reversed or removed only from there (N2).
          t.canEdit && !t.transferId && !t.reversedBy && !(t.links && t.links.reverses) && !sharedLinked(t) ? { text: "Reverse", onClick: () => openReverse(ctx, t), attrs: { "aria-label": `Reverse ${t.payeeName || "entry"} on ${t.date}` } } : null,
          // Moving picks the wrong-account entry up and re-points it (BT-006-05); an entry the server
          // would refuse still shows why, as text, not only by leaving the action off (Terry's rule).
          moveMenuItem(ctx, t, allAccounts),
          t.amendmentCount ? { text: "History", onClick: () => void openHistory(ctx, t), attrs: { "aria-label": `History of ${t.payeeName || "entry"} on ${t.date}` } } : null,
          t.canDelete && t.status !== "reconciled" && !sharedLinked(t) ? { text: "Delete", danger: true, onClick: () => openDelete(ctx, t), attrs: { "aria-label": `Delete ${t.payeeName || "entry"} on ${t.date}` } } : null,
          // BT-014-04: permanent deletion, distinct from the recoverable Delete above. No rename here —
          // a transaction has no name field; the server's fixed confirmation phrase is "DELETE".
          t.canDelete ? { text: "Delete permanently", danger: true, onClick: () => openPermanentDelete(ctx, t), attrs: { "aria-label": `Permanently delete ${t.payeeName || "entry"} on ${t.date}` } } : null,
        ],
      }).element]),
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
  deleted: "Deleted", reversedBy: "Reversed", accountId: "Account", counterpartAccountId: "Other account",
};
// accountId/counterpartAccountId changes (BT-006-05) carry fromName/toName instead of ids the viewer
// may not have; a masked side (another member's private account) reads as "another account", never
// blank, so a move is still legible without disclosing what it cannot show.
const ACCOUNT_CHANGE_FIELDS = new Set(["accountId", "counterpartAccountId"]);
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

// BT-014-04: permanent deletion. A transfer's other leg, or a reversal pair, is removed together
// as the same event; entries recorded from Shared expenses, a hand-entered owed pair or a
// reconciled entry are refused with a plain reason (api/_shared/deletion.js).
function openPermanentDelete(ctx, t) {
  const wsId = ctx.store.getState().selectedWorkspaceId;
  openDeleteDialog(ctx, {
    title: `Permanently delete ${t.payeeName ? `the entry with ${t.payeeName}` : "this entry"}?`,
    fetchImpact: async () => (await ctx.api.permanentDeleteImpact("transactions", { workspaceId: wsId }, { transactionId: t.id })).impact,
    execute: async (impact, typedConfirmation) => {
      const out = await ctx.store.actions.write(
        (ws) => ctx.api.permanentDeleteExecute("transactions", { workspaceId: ws }, { transactionId: t.id, impactToken: impact.token, typedConfirmation }),
        ["transactions", "accounts"],
      );
      if (!out.ok) throw out.error;
    },
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

// The "Move" menu item (BT-006-05; renamed from "Move to another account", BT-015): enabled when the
// server says so, a disabled item WITH TEXT (a hover tooltip and a screen-reader description, not
// colour alone) when the person could otherwise change the entry but this one move rule refuses it,
// and nothing at all when they have no edit right here (matching Edit/Delete, which already say
// nothing in that case).
function moveMenuItem(ctx, t, allAccounts) {
  const label = `Move ${t.payeeName || "entry"} on ${t.date} to another account`;
  if (t.canMove) return { text: "Move", onClick: () => openMove(ctx, t, allAccounts), attrs: { "aria-label": label } };
  if (!t.canEdit || !t.moveBlockedReason) return null;
  const hintId = `${t.id}-move-hint`;
  const node = el("span", { class: "tip", "data-tip": t.moveBlockedReason }, [
    el("button", { type: "button", text: "Move", disabled: true, "aria-label": label, "aria-describedby": hintId }),
    el("span", { class: "sr-only", id: hintId, text: t.moveBlockedReason }),
  ]);
  return { node, plain: true };
}

// "Move to another account": the standard dialog pattern — a command-picker of eligible destinations
// (same currency, open, where the caller may add entries, excluding this account), the reason
// pre-filled "Wrong account", a plain impact summary and a note when the move would change who can see
// the entry.
function openMove(ctx, t, allAccounts) {
  const fromAccount = allAccounts.find((a) => a.id === t.accountId);
  const destinations = moveDestinations(allAccounts, t);
  const prefs = ctx.store.getState().preferences;
  const picker = pickerSelect(destinations.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), "", {}, { badgeOf: iconBadges(allAccounts), placeholder: "Choose an account…" });
  const reason = input({ maxlength: "200", autocomplete: "off" });
  reason.value = "Wrong account";
  const impact = el("p", { class: "field__help", "aria-live": "polite" });
  const note = el("p", { class: "field__help" });
  const refresh = () => {
    const dest = allAccounts.find((a) => a.id === picker.value);
    impact.textContent = dest ? moveImpactText(fromAccount, dest, t, prefs) : "";
    const n = dest ? moveVisibilityNote(fromAccount, dest) : null;
    mount(note, n ? el("strong", { text: n }) : null);
  };
  const confirm = el("button", { type: "button", class: "btn btn--primary", text: "Move entry", disabled: !destinations.length });
  const modal = openModal({
    title: `Move ${t.payeeName || "this entry"} to another account?`,
    body: destinations.length ? [
      field("Move to", picker),
      impact,
      note,
      field("Reason", reason, { help: "Required. It is kept with the entry's history on both accounts." }),
    ] : [el("p", { text: `There is no other open account in ${t.currency} where you may add entries.` })],
    actions: [button("Cancel", () => modal.close()), confirm],
  });
  picker.addEventListener("change", refresh);
  refresh();
  confirm.addEventListener("click", async () => {
    modal.setError("");
    if (!picker.value) { modal.setError("Choose an account to move this entry to."); return; }
    if (!reason.value.trim()) {
      reason.setAttribute("aria-invalid", "true");
      reason.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Give a reason for this move.");
      reason.focus();
      return;
    }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.moveTransaction(ws, { transactionId: t.id, revision: t.revision, toAccountId: picker.value, reason: reason.value.trim() }));
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce("Entry moved. Both accounts show it in their history.");
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
        el("div", { text: a.changes.map((c) => {
          const isAccount = ACCOUNT_CHANGE_FIELDS.has(c.field);
          const from = isAccount ? (c.fromName || "another account") : show(c.field, c.from);
          const to = isAccount ? (c.toName || "another account") : show(c.field, c.to);
          return `${CHANGE_LABELS[c.field] || c.field}: ${from} → ${to}`;
        }).join("; ") }),
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
  // BT-025 (Terry, 2026-09-23): "category and type dropdowns should be alphabetized... in all
  // forms" — the Merchant field uses the same command picker as Category (BT-014-11's own
  // wording), so it gets the same alphabetical order.
  const eligible = account && account.access === "own" ? active.filter((p) => p.visibility === "shared" || p.ownedBySelf) : active.filter((p) => p.visibility === "shared");
  return eligible.sort((a, b) => a.name.localeCompare(b.name));
}

export function openQuickEntry(ctx, { transaction } = {}) {
  const state = ctx.store.getState();
  const allAccounts = ((sliceFor(state, "accounts").data || {}).accounts || []);
  // Closed accounts take no new entries, so they are not offered (BT-001-05); an edit keeps its account.
  // BT-025: sorted, so the picker's own order and its "first available" default agree.
  const accounts = allAccounts.filter((a) => !a.deletedAt && a.status !== "closed" && a.capabilities.includes("create"))
    .sort((a, b) => a.name.localeCompare(b.name));
  const editing = !!transaction;
  // An entry keeps its category even if that category has since been archived (audit B5).
  const categories = ((sliceFor(state, "categories").data || {}).categories || [])
    .filter((c) => !c.archived || (editing && c.id === transaction.categoryId))
    .sort((a, b) => a.name.localeCompare(b.name));
  let merchants = ((sliceFor(state, "payees").data || {}).payees || []);
  const isTransfer = editing && transaction.kind === "transfer";
  if (!editing && !accounts.length) return;
  const key = newIdempotencyKey();
  const touched = new Set();
  const hints = {};

  const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00 or 12.50+3.20", value: editing ? transaction.amount.replace(/^-/, "") : "" });
  const amountPreview = el("p", { class: "field__help", "aria-live": "polite" });
  // The dropdowns are TaskTracker's command picker (BT-004-05); suggestions, hints and the reversal
  // lock below still work on the selects, and the pickers follow them.
  const accountMarks = iconBadges(allAccounts);
  const account = pickerSelect(accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), editing ? transaction.accountId : (accounts[0] || {}).id, { disabled: editing }, { badgeOf: accountMarks, placeholder: "Choose an account…" });
  const category = pickerSelect([{ value: "", label: "Uncategorized" }].concat(categories.map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name }))), editing ? transaction.categoryId || "" : "", { disabled: isTransfer }, { badgeOf: categoryBadges(state) });
  const date = input({ type: "date", value: editing ? transaction.date : todayIso() });
  // An explicit list of the kinds a person may choose, never every label: kinds only Shared expenses
  // make (owed to others, repayment made) are not offered (financial recheck N1). An entry that already
  // has another kind keeps showing it.
  // The server says which kinds may be entered here: it adds owed-to-others and repayment only when the
  // group allows entering them by hand (Terry's decision C). Without that list, the manual kinds.
  const manualKinds = ((sliceFor(state, "transactions").data || {}).entryKinds) || ["expense", "income", "transfer", "refund", "fee", "reimbursement", "advance", "adjustment", "interest"];
  const kindValues = editing && !manualKinds.includes(transaction.kind) ? [...manualKinds, transaction.kind] : manualKinds;
  const kind = pickerSelect(kindValues.map((value) => ({ value, label: KIND_LABELS[value] || value })), editing ? transaction.kind : "expense", { disabled: isTransfer }, { search: false });
  // "Choose an account…", not the label-built "Choose to account…" (UX review U6).
  const toAccount = pickerSelect(accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), "", {}, { badgeOf: accountMarks, placeholder: "Choose an account…" });
  const toAmount = input({ inputmode: "decimal", placeholder: "Amount received" });
  const rate = input({ inputmode: "decimal", placeholder: "Exchange rate" });
  const tags = input({ placeholder: "Comma separated", value: editing ? transaction.tags.join(", ") : "" });
  const notes = el("textarea", { class: "field__input", maxlength: "5000", text: editing ? transaction.notes : "" });
  const status = pickerSelect([{ value: "pending", label: "Pending" }, { value: "cleared", label: "Cleared" }].concat(editing ? [{ value: "reconciled", label: "Reconciled" }] : []), editing ? transaction.status : "pending", {}, { search: false });
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
  // A real entry always needs a real merchant (BT-007-01) — never a left-as-typed draft (unlike a
  // bill's own term, BT-014-11) — so `allowCustom` stays off; "+ Add merchant" opens the SAME
  // inline "New merchant" fieldset this form has always used, unchanged.
  const merchantSelect = createMerchantSelect({
    merchants: choosableMerchants(merchants, accountOf(currentAccountId())),
    current,
    create: { label: "Add merchant", onPick: (name) => showCreate(name) },
  });
  merchantSelect.addEventListener("change", () => { const m = merchants.find((p) => p.id === merchantSelect.value) || null; merchantLink.hidden = !m; void onMerchant(m); });
  if (isTransfer) merchantSelect.disabled = true;
  // Reversal pairs: financial fields are shown but cannot be changed (FIN-R1).
  const lock = editing ? reversalLock(transaction) : null;
  if (lock) {
    for (const control of [amount, category, date, kind]) control.setAttribute("disabled", "");
    merchantSelect.disabled = true;
  }

  const createName = input({ maxlength: "80", autocomplete: "off" });
  // Each merchant type with its default icon (BT-011-05); fourteen types, so the picker searches.
  const createType = pickerSelect(Object.entries(MERCHANT_TYPE_LABELS).map(([value, label]) => ({ value, label })), "other", {}, { search: false, badgeOf: (v) => icon(defaultIconFor("merchant", v)) });
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
  function hideCreate() { createBox.hidden = true; merchantSelect.focus(); }
  function refreshMerchantChoices() {
    merchants = ((sliceFor(ctx.store.getState(), "payees").data || {}).payees || []);
    setMerchantOptions(merchantSelect, choosableMerchants(merchants, accountOf(currentAccountId())));
  }
  function useExisting(existing) {
    if (existing.status === "closed") { createError.textContent = `${existing.name} is closed. Reopen it on the Merchants tab to use it again.`; createError.hidden = false; return; }
    selectMerchant(merchantSelect, merchants.find((p) => p.id === existing.id) || existing);
    createBox.hidden = true;
    merchantSelect.focus();
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
      selectMerchant(merchantSelect, { id: out.payee.id, name: out.payee.name, visibility: out.payee.visibility });
      createBox.hidden = true;
      merchantSelect.focus();
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
    const chosenBefore = merchantSelect.value;
    refreshMerchantChoices();
    createNote.textContent = scopeText();
    // `refreshMerchantChoices` (via `setMerchantOptions`) already clears a real merchant that is no
    // longer choosable on the new account, but that direct property write fires no "change" event
    // (only an explicit `pick()` does) — the merchant-changed side effects run here instead.
    if (chosenBefore && !merchantSelect.value) {
      merchantLink.hidden = true;
      void onMerchant(null);
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
    (() => { const f = field("Merchant", merchantSelect); f.appendChild(merchantLink); return f; })(),
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
      const chosenPayeeId = readMerchantSelect(merchantSelect).payeeId;
      if (chosenPayeeId !== (t.payeeId || null)) body.payeeId = chosenPayeeId;
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
        const chosenPayeeId = readMerchantSelect(merchantSelect).payeeId;
        if (chosenPayeeId) body.payeeId = chosenPayeeId;
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
