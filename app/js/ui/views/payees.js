// Merchants (BT-007-01): the managed directory. Create, edit, close and reopen merchants — never
// delete them (BT-001-05) — and see each one's authorized history: spent, refunds and net per
// currency, entry count and last date. "View history" opens Transactions filtered to that
// merchant. Closed merchants stay listed (Show: Active / Closed / All) and keep their history.
// Every change shows who made it, when, what changed and why.
import { el, mount, announce } from "../dom.js";
import { pageHead, stateView, badge, button, money, field, input, select } from "../components.js";
import { openModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { formatDate, todayIso, MERCHANT_TYPE_LABELS } from "../../core/format.js";
import { normalize } from "../merchantpicker.js";

const FIELD_LABELS = {
  name: "Name", aliases: "Other names", type: "Type", contact: "Contact details", customerNumber: "Customer number",
  openedOn: "Date opened", closedOn: "Date closed", closeReason: "Reason closed", status: "Status", visibility: "Sharing",
  defaultCategoryId: "Default category", defaultAccountId: "Default account", defaultCurrency: "Default currency", tags: "Tags", notes: "Notes",
};
const stamp = (iso) => String(iso || "").replace("T", " ").slice(0, 16);

export function createView(ctx) {
  const box = el("div");
  const show = select([{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }], "active");
  const search = input({ type: "search", placeholder: "Name or other name" });
  const add = el("div", { class: "page-head__actions" });
  const element = el("section", {}, [
    el("div", { class: "page-head" }, [el("h1", { text: "Merchants" }), add]),
    el("p", { class: "muted", text: "Totals include only entries you are allowed to see. Merchants are never deleted: close one you no longer use and its history stays." }),
    el("div", { class: "filters" }, [field("Show", show), field("Search", search)]),
    box,
  ]);
  let last = null;
  show.addEventListener("change", () => { if (last) render(last); });
  search.addEventListener("input", () => { if (last) render(last); });
  void ctx.store.actions.refreshPayees();

  function render(state) {
    const prefs = state.preferences;
    const dateFormat = prefs && prefs.effective && prefs.effective.dateFormat;
    const payees = sliceFor(state, "payees");
    const s = stateView(payees, { empty: "No merchants yet. Add one here or while entering an expense.", isEmpty: (d) => !d.payees.length });
    if (s) { mount(box, s); return; }
    const want = show.value;
    const q = normalize(search.value);
    // A merchant without a status (recorded before merchants had one) is active.
    const list = payees.data.payees.filter((p) => (want === "all" || (p.status || "active") === want) && (!q || [p.name, ...(p.aliases || [])].some((x) => normalize(x).includes(q))));
    if (!list.length) { mount(box, el("div", { class: "state", text: want === "closed" ? "No closed merchants." : "No merchants match." })); return; }
    const plain = { effective: { ...((prefs && prefs.effective) || {}), balanceMasking: false } };
    mount(box, el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": "Merchants" }, [
      el("thead", {}, [el("tr", {}, ["Merchant", "Spent", "Refunds", "Net", "Entries", "Last entry", "Actions"].map((h) => el("th", { scope: "col", class: ["Spent", "Refunds", "Net", "Entries"].includes(h) ? "num" : "", text: h })))]),
      el("tbody", {}, list.flatMap((p) => {
        const stats = p.stats.length ? p.stats : [null];
        // Every row names its merchant (additional currencies repeat it quietly) (A11Y-015).
        return stats.map((st, i) => el("tr", {}, [
          el("th", { scope: "row", "data-label": "Merchant" }, i === 0
            ? [
              el("strong", { text: p.name }), " ",
              p.visibility === "shared" ? badge("Shared", "shared") : badge("Private", "private"), " ",
              p.status === "closed" ? badge(p.closedOn ? `Closed ${formatDate(p.closedOn, dateFormat)}` : "Closed", "closed") : null,
              p.type && p.type !== "other" ? el("div", { class: "muted small", text: MERCHANT_TYPE_LABELS[p.type] || p.type }) : null,
              p.referenceOnly ? el("div", { class: "muted small", text: "Seen through an entry shared with you" }) : null,
            ]
            : [el("span", { class: "muted small", text: `${p.name} (${st.currency})` })]),
          el("td", { "data-label": "Spent", class: "num" }, [st ? money(st.gross, st.currency, plain) : "—"]),
          el("td", { "data-label": "Refunds", class: "num" }, [st ? money(st.refunds, st.currency, plain) : "—"]),
          el("td", { "data-label": "Net", class: "num" }, [st ? money(st.net, st.currency, plain) : "—"]),
          el("td", { "data-label": "Entries", class: "num", text: st ? String(st.count) : "0" }),
          el("td", { "data-label": "Last entry", text: st ? formatDate(st.lastDate, dateFormat) : "" }),
          el("td", { "data-label": "" }, i === 0 ? [el("div", { class: "row-actions" }, [
            button("View history", () => ctx.navigate("transactions", { payeeId: p.id }), { small: true, attrs: { "aria-label": `View history for ${p.name}` } }),
            p.canEdit ? button("Edit", () => openMerchantEditor(ctx, p), { small: true, attrs: { "aria-label": `Edit ${p.name}` } }) : null,
            p.canEdit && p.status !== "closed" ? button("Close", () => openLifecycle(ctx, p, "archive"), { small: true, attrs: { "aria-label": `Close ${p.name}` } }) : null,
            p.canEdit && p.status === "closed" ? button("Reopen", () => openLifecycle(ctx, p, "reopen"), { small: true, attrs: { "aria-label": `Reopen ${p.name}` } }) : null,
          ])] : []),
        ]));
      })),
    ])]));
  }

  function update(state) {
    last = state;
    mount(add, button("Add merchant", () => openMerchantEditor(ctx), { variant: "primary" }));
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
    const what = h.changes.map((c) => (c.field === "create" ? "created" : `${FIELD_LABELS[c.field] || c.field}: ${describeValue(c.from, lookups)} → ${describeValue(c.to, lookups)}`)).join("; ");
    return el("li", {}, [el("div", { class: "muted small", text: `${stamp(h.at)} · ${h.by}` }), el("div", { text: what }), h.reason ? el("div", { class: "muted small", text: `Reason: ${h.reason}` }) : null]);
  });
  return el("details", { class: "more" }, [el("summary", { text: `Change history (${items.length})` }), el("ul", { class: "history-list" }, items)]);
}

export function openMerchantEditor(ctx, merchant = null) {
  const state = ctx.store.getState();
  const editing = !!merchant;
  const role = ((state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || {}).role;
  const allCategories = ((sliceFor(state, "categories").data || {}).categories || []);
  const categories = allCategories.filter((c) => !c.archived || (editing && c.id === merchant.defaultCategoryId));
  const accounts = ((sliceFor(state, "accounts").data || {}).accounts || []).filter((a) => !a.deletedAt);
  const lookups = new Map([...allCategories.map((c) => [c.id, c.name]), ...accounts.map((a) => [a.id, a.name]), ["shared", "Shared"], ["private", "Private"], ["active", "Active"], ["closed", "Closed"], ...Object.entries(MERCHANT_TYPE_LABELS)]);
  const m = merchant || {};
  const c = m.contact || {};

  const name = input({ maxlength: "80", value: m.name || "", required: true, autocomplete: "off" });
  const canShare = role !== "viewer";
  const visibility = select([{ value: "private", label: "Private to me" }].concat(canShare ? [{ value: "shared", label: "Shared with the workspace" }] : []), editing ? m.visibility : (canShare ? "shared" : "private"));
  const visibilityEditable = !editing || (m.visibility === "private" && m.ownedBySelf && canShare);
  if (!visibilityEditable) visibility.disabled = true;
  const type = select(Object.entries(MERCHANT_TYPE_LABELS).map(([value, label]) => ({ value, label })), m.type || "other");
  const website = input({ type: "url", value: c.website || "", placeholder: "https://" });
  const phone = input({ type: "tel", value: c.phone || "" });
  const email = input({ type: "email", value: c.email || "" });
  const address = el("textarea", { class: "field__input", maxlength: "300", text: c.address || "" });
  const customerNumber = input({ maxlength: "60", value: m.customerNumber || "", autocomplete: "off" });
  const openedOn = input({ type: "date", value: m.openedOn || "" });
  const defaultCategory = select([{ value: "", label: "None" }].concat(categories.map((x) => ({ value: x.id, label: x.archived ? `${x.name} (archived)` : x.name }))), m.defaultCategoryId || "");
  const defaultAccount = select([], "");
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
    if (!editing) return { ...values, visibility: visibility.value, ...(allowDuplicate ? { allowDuplicate: true } : {}) };
    // Only changed fields are sent, so the history records real changes.
    const out = { payeeId: m.id, revision: m.revision };
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const before = { name: m.name, type: m.type || "other", aliases: m.aliases || [], contact: { website: c.website || "", address: c.address || "", phone: c.phone || "", email: c.email || "" }, customerNumber: m.customerNumber || "", openedOn: m.openedOn || null, defaultCategoryId: m.defaultCategoryId || null, defaultAccountId: m.defaultAccountId || null, defaultCurrency: m.defaultCurrency || null, tags: m.tags || [], notes: m.notes || "" };
    for (const [k, v] of Object.entries(values)) if (!same(v, before[k])) out[k] = v;
    if (visibilityEditable && visibility.value !== m.visibility) out.visibility = visibility.value;
    if (reason.value.trim()) out.reason = reason.value.trim();
    if (allowDuplicate) out.allowDuplicate = true;
    return out;
  }

  const save = el("button", { type: "submit", class: "btn btn--primary", text: editing ? "Save changes" : "Add merchant" });
  const anyway = button("Save as a separate merchant", () => void submit(true), { attrs: { hidden: true } });
  const cancel = button("Cancel", () => modal.close());
  const form = el("form", { class: "form-grid", novalidate: true }, [
    field("Name", name), field("Sharing", visibility, { help: editing && !visibilityEditable ? "A shared merchant stays shared." : undefined }), field("Type", type),
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
  }
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
