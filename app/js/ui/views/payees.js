// Merchants (BT-007-01): the managed directory. Create, edit, close and reopen merchants — never
// delete them (BT-001-05) — and see each one's authorized history: spent, refunds and net per
// currency, entry count and last date. "View history" opens Transactions filtered to that
// merchant. Closed merchants stay listed (Show: Active / Closed / All) and keep their history.
// Every change shows who made it, when, what changed and why.
import { el, mount, announce } from "../dom.js";
import { stateView, badge, button, amountText, field, input, pickerSelect, categoryBadges, iconBadges } from "../components.js";
import { openModal } from "../modal.js";
import { openDeleteDialog } from "../permanentdelete.js";
import { sliceFor } from "../../core/store.js";
import { formatDate, todayIso, MERCHANT_TYPE_LABELS } from "../../core/format.js";
import { normalize } from "../merchantselect.js";
import { icon, withIcon, iconLabel, defaultIconFor } from "../icons.js";
import { createIconPicker, iconChange } from "../iconpicker.js";

const FIELD_LABELS = {
  name: "Name", aliases: "Other names", type: "Type", contact: "Contact details", customerNumber: "Customer number",
  openedOn: "Date opened", closedOn: "Date closed", closeReason: "Reason closed", status: "Status", visibility: "Sharing",
  defaultCategoryId: "Default category", defaultAccountId: "Default account", defaultCurrency: "Default currency", tags: "Tags", notes: "Notes",
  icon: "Icon",
};
const stamp = (iso) => String(iso || "").replace("T", " ").slice(0, 16);

export function createView(ctx) {
  const box = el("div");
  const missingBox = el("div");
  // The dropdowns are TaskTracker's command picker (BT-004-05).
  const show = pickerSelect([{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }], "active", {}, { search: false });
  const search = input({ type: "search", placeholder: "Name or other name" });
  const add = el("div", { class: "page-head__actions" });
  const element = el("section", {}, [
    el("div", { class: "page-head" }, [el("h1", { text: "Merchants" }), add]),
    el("p", { class: "muted", text: "Totals include only entries you are allowed to see. Merchants are never deleted: close one you no longer use and its history stays." }),
    missingBox,
    el("div", { class: "filters" }, [field("Show", show), field("Search", search)]),
    box,
  ]);
  let last = null;
  show.addEventListener("change", () => { if (last) render(last); });
  // The number of results is announced after typing pauses (A11Y2-007).
  let timer = null;
  search.addEventListener("input", () => {
    if (!last) return;
    const n = render(last);
    clearTimeout(timer);
    if (n >= 0) timer = setTimeout(() => announce(n === 0 ? "No merchants match." : `${n} merchant${n === 1 ? "" : "s"} shown.`), 400);
  });
  void ctx.store.actions.refreshPayees();
  void ctx.store.actions.refreshBills();

  // A bill's CURRENT payeeId (what the list below filters on) reflects only what is in effect
  // TODAY (api/_shared/bills.js termsAt) — for a bill whose own schedule hasn't started yet, no
  // change can be "in effect" any earlier than that start date, so a just-linked merchant keeps
  // reading as unlinked here until then, even though the link genuinely succeeded (bug found by
  // Terry, 2026-09-17, then re-confirmed happening for real in npm run e2e's real browser after
  // the effectiveFrom fix alone didn't fully resolve it — the fix was necessary but not
  // sufficient, since NO valid date can make a future-scheduled bill's term "current" today).
  // Remembered for this page visit only (not persisted) so the list stops repeating a bill the
  // person has already handled, rather than leaving it looking permanently stuck.
  const recentlyLinked = new Set();

  // "Pending merchants" (BT-014-11, extended by the Bills → Merchant fix, 2026-09-18). A bill can
  // only ever reference a merchant that already exists (BT-007-01: merchants are managed records,
  // never free text). Before this fix this section guessed the merchant's name from the BILL's own
  // title (a "Netflix" bill, a "Rent" bill) — confirmed wrong by review: a bill named "September
  // internet" with a typed merchant "Northstar Fiber" must show "Northstar Fiber", never "September
  // internet". Two genuinely different situations are shown separately:
  //   - a typed name WAS entered on the bill (`payeeDraftName`, api/recurring/handler.js) but
  //     matches no real merchant yet: shown here AS TYPED, grouped so the same name typed on
  //     several bills shows once with every bill it applies to; "Add merchant" links all of them.
  //   - no name was ever typed (older bills, or a bill saved before this feature existed): nothing
  //     is guessed or recovered — the person is asked to edit the bill themselves.
  // Never for a transfer (no payee) or an ended bill.
  function renderMissing(state) {
    const bills = sliceFor(state, "bills");
    const list = ((bills.data || {}).recurring || []).filter((b) => !b.payeeId && !b.ended && b.kind !== "transfer" && b.canEdit && !recentlyLinked.has(b.id));
    if (!list.length) { mount(missingBox); return; }
    const pending = list.filter((b) => b.payeeDraftName);
    const unnamed = list.filter((b) => !b.payeeDraftName);
    const groups = new Map();
    for (const b of pending) {
      const key = normalize(b.payeeDraftName);
      if (!groups.has(key)) groups.set(key, { name: b.payeeDraftName, bills: [] });
      groups.get(key).bills.push(b);
    }
    const sections = [];
    if (groups.size) {
      sections.push(el("h2", { class: "card__title", id: "payees-missing", text: "Pending merchants" }));
      sections.push(el("p", { class: "field__help", text: "These names were typed on a bill but don't match a merchant yet. “Add merchant” links every bill listed below it; you can also open a bill and choose an existing merchant instead." }));
      sections.push(el("ul", { class: "stack" }, [...groups.values()].map((g) => el("li", { class: "row" }, [
        el("div", {}, [
          el("strong", { text: g.name }),
          el("div", { class: "muted small", text: `On: ${g.bills.map((b) => b.name).join(", ")}` }),
        ]),
        // Exact label "Add merchant" (Terry, 2026-09-18 regression report) — previously "Add as
        // merchant"; same action, wording made to match his spec exactly.
        button("Add merchant", () => openMerchantEditor(ctx, null, {
          prefillName: g.name,
          onCreated: (payee) => {
            for (const b of g.bills) {
              void linkBillToMerchant(ctx, b, payee, { onLinked: () => { recentlyLinked.add(b.id); renderMissing(ctx.store.getState()); } });
            }
          },
        }), { small: true, attrs: { "aria-label": `Add ${g.name} as a merchant` } }),
      ]))));
    }
    if (unnamed.length) {
      sections.push(el("h2", { class: "card__title", id: groups.size ? undefined : "payees-missing", text: "Bills with no merchant name recorded" }));
      sections.push(el("p", { class: "field__help", text: "No merchant name was ever typed for these — nothing is guessed from the bill's own name. Open Bills and edit one to add a merchant." }));
      sections.push(el("ul", { class: "stack" }, unnamed.map((b) => el("li", { class: "row" }, [
        withIcon(b.icon || "receipt", el("span", { text: b.name })),
        button("Go to Bills", () => ctx.navigate("bills"), { small: true, attrs: { "aria-label": `Go to Bills to edit ${b.name}` } }),
      ]))));
    }
    mount(missingBox, el("section", { class: "card", "aria-labelledby": "payees-missing" }, sections));
  }

  function render(state) {
    const prefs = state.preferences;
    const dateFormat = prefs && prefs.effective && prefs.effective.dateFormat;
    const payees = sliceFor(state, "payees");
    const s = stateView(payees, { empty: "No merchants yet. Add one here or while entering an expense.", isEmpty: (d) => !d.payees.length });
    if (s) { mount(box, s); return -1; }
    const want = show.value;
    const q = normalize(search.value);
    // A merchant without a status (recorded before merchants had one) is active.
    const list = payees.data.payees.filter((p) => (want === "all" || (p.status || "active") === want) && (!q || [p.name, ...(p.aliases || [])].some((x) => normalize(x).includes(q))));
    if (!list.length) { mount(box, el("div", { class: "state", text: want === "closed" ? "No closed merchants." : "No merchants match." })); return 0; }
    const plain = { effective: { ...((prefs && prefs.effective) || {}), balanceMasking: false } };
    mount(box, el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": "Merchants" }, [
      el("thead", {}, [el("tr", {}, ["Merchant", "Spent", "Refunds", "Net", "Entries", "Last entry", "Actions"].map((h) => el("th", { scope: "col", class: ["Spent", "Refunds", "Net", "Entries"].includes(h) ? "num" : "", text: h })))]),
      el("tbody", {}, list.flatMap((p) => {
        const stats = p.stats.length ? p.stats : [null];
        // Every row names its merchant (additional currencies repeat it quietly) (A11Y-015).
        return stats.map((st, i) => el("tr", {}, [
          el("th", { scope: "row", "data-label": "Merchant" }, i === 0
            ? [
              withIcon(p.icon || "store", el("strong", { text: p.name })), " ",
              p.visibility === "shared" ? badge("Shared", "shared") : badge("Private", "private"), " ",
              p.status === "closed" ? badge(p.closedOn ? `Closed ${formatDate(p.closedOn, dateFormat)}` : "Closed", "closed") : null,
              p.type && p.type !== "other" ? el("div", { class: "muted small", text: MERCHANT_TYPE_LABELS[p.type] || p.type }) : null,
              p.referenceOnly ? el("div", { class: "muted small", text: "Seen through an entry shared with you" }) : null,
            ]
            : [el("span", { class: "muted small", text: `${p.name} (${st.currency})` })]),
          // Spending totals are magnitudes: not coloured as money in (green) or out.
          el("td", { "data-label": "Spent", class: "num" }, [st ? amountText(st.gross, st.currency, plain) : "—"]),
          el("td", { "data-label": "Refunds", class: "num" }, [st ? amountText(st.refunds, st.currency, plain) : "—"]),
          el("td", { "data-label": "Net", class: "num" }, [st ? amountText(st.net, st.currency, plain) : "—"]),
          el("td", { "data-label": "Entries", class: "num", text: st ? String(st.count) : "0" }),
          el("td", { "data-label": "Last entry", text: st ? formatDate(st.lastDate, dateFormat) : "" }),
          el("td", { "data-label": "" }, i === 0 ? [el("div", { class: "row-actions" }, [
            button("View history", () => ctx.navigate("transactions", { payeeId: p.id }), { small: true, attrs: { "aria-label": `View history for ${p.name}` } }),
            p.canEdit ? button("Edit", () => openMerchantEditor(ctx, p), { small: true, attrs: { "aria-label": `Edit ${p.name}` } }) : null,
            p.canEdit && p.status !== "closed" ? button("Close", () => openLifecycle(ctx, p, "archive"), { small: true, attrs: { "aria-label": `Close ${p.name}` } }) : null,
            p.canEdit && p.status === "closed" ? button("Reopen", () => openLifecycle(ctx, p, "reopen"), { small: true, attrs: { "aria-label": `Reopen ${p.name}` } }) : null,
            p.canEdit ? button("Delete permanently", () => openPermanentDelete(ctx, p, state.selectedWorkspaceId), { small: true, variant: "danger", attrs: { "aria-label": `Permanently delete ${p.name}` } }) : null,
          ])] : []),
        ]));
      })),
    ])]));
    return list.length;
  }

  function update(state) {
    last = state;
    // A viewer cannot add entries, so a merchant of theirs could never be used (UX2-009).
    const role = ((state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || {}).role;
    mount(add, role && role !== "viewer" ? button("Add merchant", () => openMerchantEditor(ctx), { variant: "primary" }) : null);
    renderMissing(state);
    render(state);
  }
  return { element, update };
}

function describeValue(v, lookups) {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return "updated";
  if (lookups.has(v)) return lookups.get(v);
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

function historyList(merchant, lookups) {
  const items = (merchant.history || []).slice().reverse().map((h) => {
    const what = h.changes.map((c) => {
      if (c.field === "create") return "created";
      // Contact details name the parts that changed, not just "updated" (UX2-011).
      if (c.field === "contact") {
        const parts = ["website", "address", "phone", "email"].filter((k) => ((c.from || {})[k] || "") !== ((c.to || {})[k] || ""));
        return `Contact details: ${parts.join(", ") || "updated"} changed`;
      }
      if (c.field === "icon") return `Icon: ${c.from ? iconLabel(c.from) : "Default"} → ${c.to ? iconLabel(c.to) : "Default"}`;
      return `${FIELD_LABELS[c.field] || c.field}: ${describeValue(c.from, lookups)} → ${describeValue(c.to, lookups)}`;
    }).join("; ");
    return el("li", {}, [el("div", { class: "muted small", text: `${stamp(h.at)} · ${h.by}` }), el("div", { text: what }), h.reason ? el("div", { class: "muted small", text: `Reason: ${h.reason}` }) : null]);
  });
  return el("details", { class: "more" }, [el("summary", { text: `Change history (${items.length})` }), el("ul", { class: "history-list" }, items)]);
}

// `prefillName` starts a NEW merchant (never edit mode) with its name already filled in, e.g. from
// a bill's own name (BT-014-11); `onCreated(payee)` fires once, only on a successful create, for a
// caller that wants to link the new merchant back to whatever prompted it.
export function openMerchantEditor(ctx, merchant = null, { prefillName = "", onCreated } = {}) {
  const state = ctx.store.getState();
  const editing = !!merchant;
  const role = ((state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || {}).role;
  const allCategories = ((sliceFor(state, "categories").data || {}).categories || []);
  const categories = allCategories.filter((c) => !c.archived || (editing && c.id === merchant.defaultCategoryId));
  const accounts = ((sliceFor(state, "accounts").data || {}).accounts || []).filter((a) => !a.deletedAt);
  const lookups = new Map([...allCategories.map((c) => [c.id, c.name]), ...accounts.map((a) => [a.id, a.name]), ["shared", "Shared"], ["private", "Private"], ["active", "Active"], ["closed", "Closed"], ...Object.entries(MERCHANT_TYPE_LABELS)]);
  const m = merchant || {};
  const c = m.contact || {};

  const name = input({ maxlength: "80", value: m.name || prefillName || "", required: true, autocomplete: "off" });
  const canShare = role !== "viewer";
  const visibility = pickerSelect([{ value: "private", label: "Private to me" }].concat(canShare ? [{ value: "shared", label: "Shared with the workspace" }] : []), editing ? m.visibility : (canShare ? "shared" : "private"), {}, { search: false });
  const visibilityEditable = !editing || (m.visibility === "private" && m.ownedBySelf && canShare);
  if (!visibilityEditable) visibility.disabled = true;
  // Each type shows the icon a merchant of that type gets by default (BT-011-05); fourteen types are
  // long enough that the picker offers its search box anyway.
  const type = pickerSelect(Object.entries(MERCHANT_TYPE_LABELS).map(([value, label]) => ({ value, label })), m.type || "other", {}, { search: false, badgeOf: (v) => icon(defaultIconFor("merchant", v)) });
  // The icon (BT-011-05); "Default" follows the chosen type.
  const chosenIcon = editing && m.iconSource === "record" ? m.icon : null;
  const iconBox = el("div");
  let iconPick = null;
  const makeIconPicker = (value) => { iconPick = createIconPicker({ value, inherited: defaultIconFor("merchant", type.value), name: m.name || "New merchant" }); mount(iconBox, iconPick.element); };
  makeIconPicker(chosenIcon);
  type.addEventListener("change", () => makeIconPicker(iconPick.getValue()));
  const website = input({ type: "url", value: c.website || "", placeholder: "https://" });
  const phone = input({ type: "tel", value: c.phone || "" });
  const email = input({ type: "email", value: c.email || "" });
  const address = el("textarea", { class: "field__input", maxlength: "300", text: c.address || "" });
  const customerNumber = input({ maxlength: "60", value: m.customerNumber || "", autocomplete: "off" });
  const openedOn = input({ type: "date", value: m.openedOn || "" });
  const defaultCategory = pickerSelect([{ value: "", label: "None" }].concat(categories.map((x) => ({ value: x.id, label: x.archived ? `${x.name} (archived)` : x.name }))), m.defaultCategoryId || "", {}, { badgeOf: categoryBadges(state) });
  // Filled below by fillAccounts(); the picker follows the new options (BT-004-05).
  const defaultAccount = pickerSelect([], "", {}, { badgeOf: iconBadges(accounts) });
  const fillAccounts = () => {
    // A shared merchant may default only to a shared account: its defaults are visible to everyone.
    const wanted = defaultAccount.value || m.defaultAccountId || "";
    const options = [{ value: "", label: "None" }].concat(accounts.filter((a) => visibility.value !== "shared" || a.access === "shared").map((a) => ({ value: a.id, label: a.name })));
    defaultAccount.replaceChildren(...options.map((o) => el("option", { value: o.value, text: o.label })));
    defaultAccount.value = options.some((o) => o.value === wanted) ? wanted : "";
  };
  fillAccounts();
  visibility.addEventListener("change", fillAccounts);
  const defaultCurrency = input({ maxlength: "3", value: m.defaultCurrency || "", placeholder: "EUR", autocomplete: "off" });
  const aliases = input({ value: (m.aliases || []).join(", "), placeholder: "Comma separated" });
  const tags = input({ value: (m.tags || []).join(", "), placeholder: "Comma separated" });
  const notes = el("textarea", { class: "field__input", maxlength: "5000", text: m.notes || "" });
  const reason = input({ maxlength: "200", placeholder: "Optional" });

  const list = (v) => v.split(",").map((x) => x.trim()).filter(Boolean);
  const contactNow = () => ({ website: website.value.trim(), address: address.value.trim(), phone: phone.value.trim(), email: email.value.trim() });

  function body(allowDuplicate) {
    const values = {
      name: name.value.trim(), type: type.value, aliases: list(aliases.value), contact: contactNow(), customerNumber: customerNumber.value.trim(),
      openedOn: openedOn.value || null, defaultCategoryId: defaultCategory.value || null, defaultAccountId: defaultAccount.value || null,
      defaultCurrency: defaultCurrency.value.trim().toUpperCase() || null, tags: list(tags.value), notes: notes.value,
    };
    if (!editing) return { ...values, visibility: visibility.value, ...(iconPick.getValue() ? { icon: iconPick.getValue() } : {}), ...(allowDuplicate ? { allowDuplicate: true } : {}) };
    // Only changed fields are sent, so the history records real changes.
    const out = { payeeId: m.id, revision: m.revision };
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const before = { name: m.name, type: m.type || "other", aliases: m.aliases || [], contact: { website: c.website || "", address: c.address || "", phone: c.phone || "", email: c.email || "" }, customerNumber: m.customerNumber || "", openedOn: m.openedOn || null, defaultCategoryId: m.defaultCategoryId || null, defaultAccountId: m.defaultAccountId || null, defaultCurrency: m.defaultCurrency || null, tags: m.tags || [], notes: m.notes || "" };
    for (const [k, v] of Object.entries(values)) if (!same(v, before[k])) out[k] = v;
    if (visibilityEditable && visibility.value !== m.visibility) out.visibility = visibility.value;
    const icon = iconChange(chosenIcon, iconPick.getValue());
    if (icon !== undefined) out.icon = icon;
    if (reason.value.trim()) out.reason = reason.value.trim();
    if (allowDuplicate) out.allowDuplicate = true;
    return out;
  }

  // The footer button belongs to the form, so Enter in a field submits it (UX2-006).
  const formId = `merchant-form-${Date.now()}`;
  const save = el("button", { type: "submit", class: "btn btn--primary", text: editing ? "Save changes" : "Add merchant", form: formId });
  const anyway = button("Save as a separate merchant", () => void submit(true), { attrs: { hidden: true } });
  const cancel = button("Cancel", () => modal.close());
  const form = el("form", { class: "form-grid", novalidate: true, id: formId }, [
    field("Name", name), field("Sharing", visibility, { help: editing && !visibilityEditable ? "A shared merchant stays shared." : undefined }), field("Type", type), iconBox,
    field("Other names", aliases, { help: "Names you might search for, like an abbreviation." }),
    el("details", { class: "more" }, [el("summary", { text: "Contact and account details" }), el("div", { class: "form-grid" }, [
      field("Website", website), field("Phone", phone), field("Email", email), field("Customer or account number", customerNumber), field("Date opened", openedOn), field("Address", address, { wide: true }),
    ])]),
    el("details", { class: "more" }, [el("summary", { text: "Defaults for new entries" }), el("div", { class: "form-grid" }, [
      field("Default category", defaultCategory), field("Default account", defaultAccount), field("Default currency", defaultCurrency),
    ])]),
    field("Tags", tags), field("Notes", notes, { wide: true }),
    editing ? field("Reason for this change", reason) : null,
    editing ? historyList(m, lookups) : null,
  ]);
  const modal = openModal({ title: editing ? `Edit ${m.name}` : "Add merchant", body: [form], actions: [cancel, anyway, save] });
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(false); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(false); });

  async function submit(allowDuplicate) {
    modal.setError("");
    if (!name.value.trim()) {
      name.setAttribute("aria-invalid", "true");
      name.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Enter the merchant's name.");
      name.focus();
      return;
    }
    name.removeAttribute("aria-invalid");
    const payload = body(allowDuplicate);
    if (editing && Object.keys(payload).length === 2) { announce("Nothing changed."); modal.close(); return; }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => (editing ? ctx.api.updateMerchant(ws, payload) : ctx.api.createMerchant(ws, payload)), ["payees"]);
    modal.setBusy(false);
    if (!out.ok) {
      modal.setError(out.error);
      // A duplicate is explained with the existing merchant's name; the person may still add a
      // separate one deliberately.
      if (out.error && out.error.code === "duplicate_merchant") anyway.hidden = false;
      return;
    }
    announce(editing ? "Merchant saved." : "Merchant added.");
    modal.close();
    if (!editing && onCreated) onCreated(out.result.payee);
  }
}

// Links a just-created merchant back to the bill that prompted it (BT-014-11) — a normal term
// change like any other (payeeId, versioned from a date), the same write the bill editor's own
// Merchant field already makes, refreshing both slices so the "Bills without a merchant" list and
// the bill itself immediately reflect it. A failure here is surfaced but the merchant itself is
// already saved either way — never silently lost even if the link fails.
//
// Bug fix (2026-09-17, Terry: the merchant "is not recorded" and the bill never leaves this list
// even after adding one): a bill's CURRENT view shows whichever version has the latest
// `effectiveFrom` that is still <= today (api/_shared/bills.js termsAt) — using `bill.nextDue`
// here versioned the new payeeId to start on the bill's NEXT occurrence, which is very often in
// the future (sometimes weeks or months away), so the link was genuinely saved but invisible,
// and this bill's payeeId kept reading as its OLD (null) version until that date arrived. Fixed:
// take effect as soon as the bill's own schedule allows — today, or the bill's own start date if
// that is later (a bill scheduled to start next month cannot have a term "in effect" any earlier
// than its own start; the server refuses an effectiveFrom before it, api/recurring/handler.js).
//
// That fix alone is NOT sufficient for a bill whose own schedule hasn't started yet (re-confirmed
// happening for real in a real browser, not just guessed at): nothing can be "in effect today" for
// such a bill, so its CURRENT payeeId keeps reading as unlinked until its start date arrives, even
// though the link genuinely succeeded — the exact same characteristic every other term change
// (amount, category, responsible person) on an unstarted bill already has, not something new this
// feature introduced. `onLinked()` fires only on a real success, so the caller can stop offering
// this bill again for the rest of this page visit, and the confirmation says plainly when to
// expect it to show, rather than implying it should appear immediately.
async function linkBillToMerchant(ctx, bill, payee, { onLinked } = {}) {
  const today = todayIso();
  const startDate = bill.schedule && bill.schedule.startDate;
  const delayed = !!(startDate && startDate > today);
  const effectiveFrom = delayed ? startDate : today;
  const out = await ctx.store.actions.write(
    (ws) => ctx.api.updateBill(ws, { recurringId: bill.id, revision: bill.revision, payeeId: payee.id, effectiveFrom }),
    ["bills", "payees"],
  );
  if (!out.ok) { announce(`“${payee.name}” was added, but linking it to “${bill.name}” failed. Choose it from the bill's own Edit dialog instead.`); return; }
  announce(delayed
    ? `“${payee.name}” added. It's linked to “${bill.name}”, but won't show on it until the bill starts on ${effectiveFrom} — the same as any other change to a bill that hasn't started yet.`
    : `“${payee.name}” added and linked to “${bill.name}”.`);
  if (onLinked) onLinked();
}

function openLifecycle(ctx, merchant, action) {
  const closing = action === "archive";
  const closedOn = input({ type: "date", value: todayIso() });
  const reason = input({ maxlength: "200", placeholder: "Optional" });
  const confirm = el("button", { type: "button", class: "btn btn--primary", text: closing ? "Close merchant" : "Reopen merchant" });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({
    title: closing ? `Close ${merchant.name}?` : `Reopen ${merchant.name}?`,
    body: [
      el("p", { text: closing
        ? "It will no longer be offered for new entries or bills. Its entries and history stay exactly as they are, and you can reopen it at any time."
        : "It will be offered for new entries again. Its history is unchanged." }),
      el("div", { class: "form-grid" }, [closing ? field("Date closed", closedOn) : null, field("Reason", reason)]),
    ],
    actions: [cancel, confirm],
  });
  confirm.addEventListener("click", async () => {
    modal.setError("");
    modal.setBusy(true);
    const body = { payeeId: merchant.id, revision: merchant.revision };
    if (reason.value.trim()) body.reason = reason.value.trim();
    if (closing && closedOn.value) body.closedOn = closedOn.value;
    const out = await ctx.store.actions.write((ws) => ctx.api.merchantAction(ws, action, body), ["payees"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(closing ? `${merchant.name} closed.` : `${merchant.name} reopened.`);
    modal.close();
  });
}

// BT-014-04: permanent deletion, distinct from Close above (which is recoverable). An entry that
// referenced this merchant keeps everything else and only loses the link (api/_shared/deletion.js).
function openPermanentDelete(ctx, merchant, wsId) {
  openDeleteDialog(ctx, {
    title: `Permanently delete ${merchant.name}?`,
    fetchImpact: async () => (await ctx.api.permanentDeleteImpact("payees", { workspaceId: wsId }, { payeeId: merchant.id })).impact,
    execute: async (impact, typedConfirmation) => {
      const out = await ctx.store.actions.write(
        (ws) => ctx.api.permanentDeleteExecute("payees", { workspaceId: ws }, { payeeId: merchant.id, impactToken: impact.token, typedConfirmation }),
        ["payees", "transactions", "bills"],
      );
      if (!out.ok) throw out.error;
    },
  });
}
