// Shared expenses (BT-009): who paid, who shared, balances, suggested payments and the payments
// people report and confirm. A group needs no account (Terry, 2026-09-14): an expense records who
// paid and who shared, nothing more. Anyone who paid may ALSO record it on an account of their own;
// only they ever see which one.
//
// Money direction follows Terry's rule: an arrow shows only money coming in (up) or going out (down)
// for the person looking, never both ways. Everything is also said in words.
//
// The dropdowns are TaskTracker's command picker (BT-004-05) over the same selects, so commitOnConfirm
// and every value the dialogs set from code behave as before.
import { el, mount, announce } from "../dom.js";
import { stateView, button, field, input, pickerSelect, categoryBadges, iconBadges, badge, amountText, commitOnConfirm, uid } from "../components.js";
import { openModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { newIdempotencyKey } from "../../core/api.js";
import { evaluateAmount, isPlainAmount } from "../../core/calc.js";
import { formatAmount, formatDate, todayIso } from "../../core/format.js";
import { previewSplit, precisionOf, formatMinor, parseAmount, parseRate, convert } from "../../core/split.js";
import { icon, withIcon } from "../icons.js";
import { messageFor } from "../../core/errors.js";
import { downloadFile } from "../permanentdelete.js";
// Values in words exactly as the workspace settings card shows them (eefd115).
import { createSettingsForm, settingText } from "../settingsform.js";
import { trackUnsaved } from "../../core/unsaved.js";

// Who changes the group's settings, said once (UX/accessibility review of eefd115, findings 6 and 11).
const INTRO_CHANGE = "These decide how everyone in this group works. Owners and managers change them. Each one starts with how Shared expenses has always worked, and every change is kept below.";
const INTRO_READ = "These decide how everyone in this group works. Owners and managers change them; you can see how it is set up and every change below.";

export const METHOD_LABELS = Object.freeze({ equal: "Equally", amounts: "By amounts", percentages: "By percentages", shares: "By shares", "fixed-remainder": "Fixed amounts, then split the rest" });
// BT-009-25: only PROPORTIONS (never a money-shaped method) can be saved as a reusable preset —
// mirrors api/_shared/groups.js's own `PRESET_METHODS` exactly (a plain literal here since the
// browser bundle cannot `require` that server module; the server is authoritative either way).
const PRESET_METHODS = ["equal", "shares", "percentages"];
const VALUE_LABELS = { amounts: "Amount for", percentages: "Percent for", shares: "Shares for", "fixed-remainder": "Fixed amount for" };
const VALUE_HINTS = { amounts: "0.00", percentages: "%", shares: "1", "fixed-remainder": "0.00 or leave blank" };
const STATUS_LABELS = { reported: "Reported", confirmed: "Confirmed", disputed: "Disputed" };
const EVENT_LABELS = { create: "Added", update: "Corrected", void: "Voided", reported: "Reported as paid", confirmed: "Confirmed as received", disputed: "Disputed",
  "confirmed-by-reporter": "Confirmed by the person who reported it", withdrawn: "Confirmation withdrawn", "confirmed-over-dispute": "Confirmed over a dispute", "reported-again": "Reported again after a dispute" };
const FIELD_LABELS = { description: "Description", date: "Date", amountMinor: "Amount", categoryId: "Category", notes: "Notes", payers: "Paid by", split: "Split", shares: "Shares", status: "Status", original: "Original amount" };
// A shared expense's own currency, when different from the workspace's reporting currency
// (BT-009-13). Same list as accounts.js/landing.js's own currency pickers (not shared as one
// module: each of those predates this one and duplicating a plain list of codes is not the kind
// of shared calculation CLAUDE.md's "one canonical model per concept" is about — the canonical
// model is `api/_shared/money.js`'s precision table, which every one of these lists is a subset
// of for picker convenience only).
const FOREIGN_CURRENCIES = ["USD", "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "CAD", "AUD", "NZD", "JPY", "SGD", "HKD", "INR", "ZAR"];
const RATE_SOURCE_LABELS = { manual: "Entered manually", "bank-posted": "From the bank statement", provider: "From a rate provider", agreed: "Agreed with the group" };

// BT-009-20/21: an event's lifecycle status, in words, and the confirm-style prose for changing it.
const EVENT_STATUS_LABELS = { active: "Active", closed: "Closed", archived: "Archived" };
const EVENT_STATUS_HELP = {
  closed: "No new expenses can be added to it, but settling up (recording, confirming, disputing or voiding a payment) stays possible. Nothing already recorded changes, and no balance is forgiven.",
  archived: "Fully read-only: no new expenses or payments, and nothing existing can be changed. Nothing already recorded changes, and no balance is forgiven.",
  active: "New expenses and payments are allowed again, and existing ones can be corrected again.",
};
// Same transitions the server allows (api/group/handler.js EVENT_TRANSITIONS) — never offering a
// button the server would refuse.
const EVENT_TRANSITIONS_UI = { active: ["closed", "archived"], closed: ["active", "archived"], archived: ["active"] };
const EVENT_TRANSITION_LABEL = { active: "Reopen", closed: "Close", archived: "Archive" };

const titled = (id, iconId, text) => el("h2", { class: "card__title", id }, [withIcon(iconId, text)]);
const groupData = (state) => sliceFor(state, "group").data || null;
const namesOf = (data) => new Map((data.participants || []).map((p) => [p.ref, p.name]));
const fmtFor = (state) => {
  const effective = ((state.preferences || {}).effective) || {};
  return (decimal, currency) => formatAmount(decimal, currency, { numberFormat: effective.numberFormat });
};
const isZero = (decimal) => /^-?0(\.0+)?$/.test(String(decimal || "0"));
// A group setting's value from the server's one list, and a person's own default over it (Terry's
// settings b and e, 2026-09-14): the person's preference when set, otherwise the group's.
const groupValue = (data, key, fallback) => { const s = ((data && data.groupSettings && data.groupSettings.settings) || []).find((x) => x.key === key); return s ? s.value : fallback; };
const personalDefault = (state, key) => (((state && state.preferences) || {}).effective || {})[key] || null;
const stampOf = (iso) => String(iso || "").replace("T", " ").slice(0, 16);
// The arrow for the person looking: in (up) or out (down), never both ways (Terry, 2026-09-13).
const arrow = (dir) => el("span", { class: `dir dir--${dir}` }, [icon(dir)]);

// Accounts where this person may record their part of the group: their OWN PRIVATE accounts only
// (security review S2 — nobody else sees which account), open, and in the same currency.
export function ledgerAccounts(state, currency) {
  const data = sliceFor(state, "accounts").data;
  return ((data && data.accounts) || []).filter((a) => a.ownedBySelf && !a.deletedAt && a.status !== "closed" && a.capabilities.includes("create") && a.currency === currency);
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

// The balance tables to show: the reporting currency's, then every other currency in which someone's
// balance is still open, so a balance left from before a change of reporting currency is never hidden
// behind "settled up" (financial review finding 3).
export function shownTables(data) {
  const open = (b) => b.rows.some((r) => !isZero(r.net));
  const reporting = data.balances.filter((b) => b.currency === data.currency);
  const others = data.balances.filter((b) => b.currency !== data.currency && open(b));
  const out = [...reporting, ...others];
  return out.length ? out : data.balances.slice(0, 1);
}

export function createView(ctx) {
  const actions = el("div", { class: "page-head__actions" });
  const intro = el("p", { class: "muted" });
  const needs = el("div");
  const balancesBox = el("div");
  const settleBox = el("div");
  const expensesBox = el("div");
  const paymentsBox = el("div");
  // BT-009-20/21: the event directory and, when one is open, its own scoped view. A separate card
  // rather than folded into the page head, so its own honest access-scope note always sits right
  // next to the thing it is explaining.
  const eventsBox = el("div");
  const eventsCard = el("section", { class: "card", "aria-labelledby": "grp-events" }, [titled("grp-events", "tag", "Events"), eventsBox]);
  // The group's settings (Terry, 2026-09-14), in the settings card shared with the workspace settings:
  // owners and managers change them, everyone else reads them and their history (decision 11).
  const settingsBox = el("div");
  const settingsCard = el("section", { class: "card", "aria-labelledby": "grp-settings", hidden: true }, [titled("grp-settings", "filter", "Shared expenses settings"), settingsBox]);
  let lastSettings = null;
  const settingsForm = createSettingsForm({
    id: "grp-set", storageKey: "bt.settingsGroups.group", onSave: (changes, reason) => saveGroupSettings(changes, reason),
    // Leaving the page or closing the tab with unsaved changes asks first (finding 3).
    onDirtyChange: (dirty) => trackUnsaved("group-settings", "Shared expenses settings", dirty),
  });
  mount(settingsBox, settingsForm.element);
  // Each person's own right to confirm payments, from the server (Terry, 2026-09-14).
  const myRight = el("p", { class: "muted small", hidden: true });
  // Each person's own defaults for new expenses and their preferred balance view (settings b and e).
  const mineBox = el("div");
  const mineCard = el("section", { class: "card", "aria-labelledby": "grp-mine", hidden: true }, [titled("grp-mine", "user", "Your own defaults"), mineBox]);
  let mode = personalDefault(ctx.store.getState(), "groupBalanceView") || "suggested";
  const element = el("section", {}, [
    el("div", { class: "page-head" }, [el("h1", { text: "Shared expenses" }), actions]),
    intro,
    el("div", { class: "stack" }, [
      needs,
      eventsCard,
      // Full width: the balances table has seven columns (half width clipped the balance itself).
      el("section", { class: "card", "aria-labelledby": "grp-balances" }, [titled("grp-balances", "scale", "Balances"), balancesBox]),
      el("section", { class: "card", "aria-labelledby": "grp-settle" }, [titled("grp-settle", "users", "Settle up"), settleBox]),
      el("section", { class: "card", "aria-labelledby": "grp-expenses" }, [titled("grp-expenses", "receipt", "Expenses"), expensesBox]),
      el("section", { class: "card", "aria-labelledby": "grp-payments" }, [titled("grp-payments", "coins", "Payments"), myRight, paymentsBox]),
      settingsCard,
      mineCard,
    ]),
  ]);
  void ctx.store.actions.refreshGroup();

  function update(state) {
    const slice = sliceFor(state, "group");
    const data = slice.data;
    const loading = stateView(slice);
    if (loading && !data) { mount(actions); mount(needs); mount(eventsBox, loading); mount(balancesBox, loading); mount(settleBox); mount(expensesBox); mount(paymentsBox); return; }
    const fmt = fmtFor(state);
    const names = namesOf(data);
    const me = data.permissions.selfRef;
    const nameOf = (ref) => (ref === me ? "You" : names.get(ref) || "Someone");
    const effective = ((state.preferences || {}).effective) || {};
    const scoped = data.currentEvent || null;
    mount(actions, ...(data.permissions.canAdd ? [
      button("Add expense", () => openGroupExpense(ctx, { eventId: scoped ? scoped.id : null }), { variant: "primary" }),
      button("Record a payment", () => openRecordPayment(ctx, { eventId: scoped ? scoped.id : null })),
    ] : [el("p", { class: "muted small", text: "You can see this group's expenses but not add or change them." })]));
    intro.textContent = scoped
      ? `Showing only "${scoped.name}" (${(EVENT_STATUS_LABELS[scoped.status] || scoped.status).toLowerCase()}). A new expense or payment here is added to this event.`
      : "Record who paid and who shared. No bank account is needed; balances show who owes whom.";

    // Entries on the person's own account that no longer match what the group records.
    const review = [...data.expenses.map((e) => ["expense", e]), ...data.settlements.map((s) => ["settlement", s])].filter(([, r]) => r.myLedger && r.myLedger.needsReview && !r.myLedger.accountUnavailable);
    mount(needs, review.length ? el("section", { class: "notice notice--warning", "aria-labelledby": "grp-review" }, [
      titled("grp-review", "alert", "Your account needs updating"),
      el("ul", { class: "stack" }, review.map(([type, r]) => el("li", { class: "row" }, [
        // The server's reason when the part sits on a former account (financial recheck F2).
        el("span", { text: `${type === "expense" ? `“${r.description}”` : "A payment"}: ${r.myLedger.note || `not yet up to date on ${r.myLedger.accountName || "your account"}.`}` }),
        // With no account of their own to record on, the person chooses one; updating would do nothing.
        r.myLedger.accountId
          ? button("Update my account", () => void syncMine(ctx, type, r), { small: true, attrs: { "aria-label": `Update my account for ${type === "expense" ? r.description : "this payment"}` } })
          : button("Choose my account", () => openLedgerChoice(ctx, type, r), { small: true, attrs: { "aria-label": `Choose my account for ${type === "expense" ? r.description : "this payment"}` } }),
      ]))),
    ]) : null);

    renderEvents(data);
    const tables = shownTables(data);
    renderBalances(tables, data, fmt, nameOf);
    renderSettle(tables, data, fmt, nameOf, me);
    renderExpenses(data, fmt, nameOf, me, effective.dateFormat, state);
    renderPayments(data, fmt, nameOf, me, effective.dateFormat, state);
    // The group's settings for everyone: owners and managers change them, others read them (the server
    // decides who may change them).
    settingsCard.hidden = !data.groupSettings;
    if (!settingsCard.hidden) renderSettings(data.groupSettings, !!data.permissions.canManage);
    mineCard.hidden = !data.permissions.canAdd;
    if (!mineCard.hidden) renderMine(state);
    const mine = data.groupSettings && data.groupSettings.mine;
    myRight.hidden = !mine;
    myRight.textContent = !mine ? "" : mine.effective ? "You can confirm any reported payment in this group."
      : data.permissions.canManage ? "You can confirm payments made to you, and payments to contacts." : "You can confirm payments made to you.";
  }

  // "Can confirm payments" for each person (owners and managers only; the server sends the list only to them).
  const perPersonOf = (gs) => (gs.perMember || []).find((p) => p.key === "confirmOverrides") || { label: "Can confirm payments", setting: "anyoneConfirms",
    options: [{ value: "inherit", label: "Use the group setting" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }] };

  // The per-person pickers, shown in the group of the setting they override, with unsaved and undo.
  function personExtra(gs, onChange) {
    const perPerson = perPersonOf(gs);
    const people = (gs.members || []).map((m) => {
      const pick = pickerSelect(perPerson.options, m.override, { "aria-label": `${perPerson.label}: ${m.name}` }, { search: false });
      pick.addEventListener("change", onChange);
      const now = m.role === "viewer" ? "Only payments made to them (a viewer)" : m.effective ? "Can confirm any payment now" : "Only payments made to them now";
      // field() names the picker's trigger by the visible label (BT-004-07); the legend says what it is.
      return { m, pick, node: field(m.name, pick, { help: now }) };
    });
    const group = (gs.settings.find((s) => s.key === perPerson.setting) || {}).group;
    const overrides = () => Object.fromEntries(people.filter((p) => p.pick.value !== p.m.override).map((p) => [p.m.memberId, p.pick.value]));
    return {
      group,
      // A per-member permission list is a complex control that can run to many rows — kept
      // full-width in the two-column settings layout (item 5, review 2026-09-18), never squeezed.
      node: el("fieldset", { class: "plain-fieldset setting setting--wide" }, [
        el("legend", { class: "field__label", text: perPerson.label }),
        el("p", { class: "field__help", text: "Each person follows the group setting above unless you choose Yes or No for them. Yes lets them confirm any reported payment, their own included; No lets them confirm only payments made to them. A viewer can only ever confirm payments made to them." }),
        el("div", { class: "stack" }, people.map((p) => p.node)),
      ]),
      isDirty: () => Object.keys(overrides()).length > 0,
      changes: () => (Object.keys(overrides()).length ? { confirmOverrides: overrides() } : {}),
      reset: () => { for (const p of people) p.pick.value = p.m.override; },
    };
  }

  // Every setting from the server's one list in the shared settings card; everyone reads the history.
  function renderSettings(gs, canManage) {
    lastSettings = gs;
    const perPerson = perPersonOf(gs);
    const shown = (key, value) => { const s = gs.settings.find((x) => x.key === key); return s ? settingText(s, value) : String(value); };
    const optionLabel = (value) => { const o = perPerson.options.find((x) => x.value === value); return o ? o.label : String(value); };
    settingsForm.render({
      settings: gs.settings.map((s) => ({ ...s, canChange: canManage })),
      intro: canManage ? INTRO_CHANGE : INTRO_READ,
      history: (gs.history || []).map((h) => ({
        when: stampOf(h.at), by: h.by, reason: h.reason || "",
        text: h.member ? `${h.label} for ${h.member}: ${optionLabel(h.from)} → ${optionLabel(h.to)}` : `${h.label}: ${shown(h.key, h.from)} → ${shown(h.key, h.to)}`,
      })),
      extrasSig: JSON.stringify(canManage ? gs.members || null : null),
      makeExtras: canManage && (gs.members || []).length ? (onChange) => [personExtra(gs, onChange)] : null,
    });
  }

  async function saveGroupSettings(changes, reason) {
    const gs = lastSettings || { settings: [], members: [] };
    const perPerson = perPersonOf(gs);
    const body = { changes, ...(reason ? { reason } : {}) };
    const out = await ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "settings", body), ["group"]);
    if (!out.ok) return { ok: false, error: out.error };
    // Said only for what the server now holds (security recheck of 47617b5, M1): every value asked for
    // is compared with the settings it returned.
    const overrides = changes.confirmOverrides || {};
    const kept = (out.result && out.result.groupSettings) || null;
    const missed = !kept ? [] : [
      ...Object.entries(changes).filter(([k]) => k !== "confirmOverrides").filter(([k, v]) => { const s = (kept.settings || []).find((x) => x.key === k); return !s || s.value !== v; }).map(([k]) => (gs.settings.find((x) => x.key === k) || { label: k }).label),
      ...Object.entries(overrides).filter(([id, v]) => { const m = (kept.members || []).find((x) => x.memberId === id); return !m || m.override !== v; }).map(([id]) => `${perPerson.label}: ${((gs.members || []).find((m) => m.memberId === id) || { name: id }).name}`),
    ];
    return { ok: true, said: missed.length ? `Not everything was saved: ${missed.join("; ")}. The settings shown are what is saved now.` : "Settings saved. Everyone in the group now works this way." };
  }

  // The person's own defaults (settings b and e): personal preferences that apply only to them and
  // override the group's defaults for new expenses; "Use the group's setting" clears one.
  function renderMine(state) {
    const eff = ((state.preferences || {}).effective) || {};
    const theGroups = (list) => [{ value: "", label: "Use the group's setting" }, ...list];
    const pickers = [
      ["groupSplitMethod", "Default split", theGroups(Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label })))],
      ["groupSplitWho", "Who shares by default", theGroups([{ value: "everyone", label: "Everyone in the group" }, { value: "me", label: "Only me" }])],
      ["groupPaidBy", "Who paid by default", theGroups([{ value: "me", label: "Me" }, { value: "nobody", label: "Nobody until I choose" }])],
      ["groupBalanceView", "Balances shown as", [{ value: "", label: "Fewest payments" }, { value: "direct", label: "Keep who owes whom" }]],
    ].map(([key, label, options]) => ({ key, label, pick: pickerSelect(options, eff[key] || "", {}, { search: false }) }));
    const save = button("Save my defaults", async () => {
      const patch = Object.fromEntries(pickers.filter((p) => (p.pick.value || null) !== (eff[p.key] || null)).map((p) => [p.key, p.pick.value || null]));
      if (!Object.keys(patch).length) { announce("Nothing changed."); return; }
      if (Object.prototype.hasOwnProperty.call(patch, "groupBalanceView")) mode = patch.groupBalanceView || "suggested";
      await ctx.store.actions.savePreferences(patch);
      announce("Your defaults are saved. They apply only to you.");
    });
    mount(mineBox,
      el("p", { class: "muted small", text: "These apply only to you, on every device, and take the place of the group's defaults when you add an expense." }),
      el("div", { class: "form-grid" }, pickers.map((p) => field(p.label, p.pick))),
      el("div", { class: "row" }, [save]));
  }

  // One table per currency shown (the reporting currency, then any other with an open balance).
  // BT-009-20/21: the event directory. Combined view first (or "back to it" when scoped), then
  // every event with its status, counts and a way to view it; a manager/owner also gets the
  // status-transition actions. The honest access-scope note always sits right here, not buried.
  function renderEvents(data) {
    const events = data.events || [];
    const scoped = data.currentEvent || null;
    const rows = events.map((e) => {
      const isCurrent = scoped && scoped.id === e.id;
      const transitions = EVENT_TRANSITIONS_UI[e.status] || [];
      return el("li", { class: "grow" }, [
        el("span", {}, [withIcon("tag", e.name), e.isDefault ? el("span", { class: "muted small" }, [" (default)"]) : null]),
        badge(EVENT_STATUS_LABELS[e.status] || e.status, e.status === "archived" ? "closed" : e.status === "closed" ? "warning" : ""),
        el("span", { class: "muted small", text: `${e.expenseCount} expense${e.expenseCount === 1 ? "" : "s"}, ${e.settlementCount} payment${e.settlementCount === 1 ? "" : "s"}` }),
        el("span", { class: "app__spacer" }),
        isCurrent
          ? button("Viewing this event", () => void ctx.store.actions.setGroupEventFilter(null), { small: true, variant: "primary", attrs: { "aria-label": `Stop viewing ${e.name} — show every event combined` } })
          : button("View", () => void ctx.store.actions.setGroupEventFilter(e.id), { small: true, attrs: { "aria-label": `View only ${e.name}` } }),
        button("Export…", () => openExportModal(ctx, { eventId: e.id, title: `Export "${e.name}"` }), { small: true, attrs: { "aria-label": `Export ${e.name}` } }),
        data.permissions.canManage && transitions.length
          ? el("span", { class: "row" }, transitions.map((t) => button(EVENT_TRANSITION_LABEL[t], () => void changeEventStatus(e, t), { small: true, variant: t === "archived" ? "danger" : "", attrs: { "aria-label": `${EVENT_TRANSITION_LABEL[t]} ${e.name}` } })))
          : null,
      ]);
    });
    mount(eventsBox,
      el("p", { class: "field__help", text: data.eventAccessNote || "" }),
      scoped ? el("p", { class: "row" }, [
        el("span", { text: `Currently viewing only "${scoped.name}".` }),
        button("Show every event combined", () => void ctx.store.actions.setGroupEventFilter(null), { small: true }),
      ]) : null,
      events.length ? el("ul", { class: "stack" }, rows) : el("p", { class: "muted small", text: "No named events yet — every expense goes to a plain \"General\" event until you add one." }),
      el("div", { class: "row" }, [
        data.permissions.canAdd ? button("Add event…", () => openAddEventModal(ctx), { small: true }) : null,
        button("Export everything…", () => openExportModal(ctx, { title: "Export every shared expense" }), { small: true }),
      ]),
    );
  }
  // BT-009-23: the same authorized PDF/CSV/XLSX/JSON export BT-014-06 already offers before a
  // deletion, reachable directly from Shared expenses too — scoped to one event when `eventId` is
  // given, every event combined otherwise. Downloading never changes anything, so no confirmation.
  function openExportModal(ctx, { eventId = null, title }) {
    const status = el("p", { class: "muted small", role: "status" });
    const wsId = ctx.store.getState().selectedWorkspaceId;
    const download = async (format) => {
      status.textContent = `Preparing the ${format.toUpperCase()} download…`;
      try {
        const out = await ctx.api.sharedExport(wsId, format, eventId);
        downloadFile(out.filename, out.mime, out.content, out.encoding);
        status.textContent = "Downloaded.";
        announce("Shared-expenses information downloaded.");
      } catch (err) {
        status.textContent = messageFor(err);
      }
    };
    const modal = openModal({
      title,
      body: [
        el("p", { text: "Participants, dates, descriptions, currencies, amounts, splits, settlements and outstanding balances — authorized for you to see, exactly as the page already shows them." }),
        el("div", { class: "row" }, [
          button("CSV", () => void download("csv"), { small: true }),
          button("JSON", () => void download("json"), { small: true }),
          button("XLSX", () => void download("xlsx"), { small: true }),
          button("PDF", () => void download("pdf"), { small: true }),
        ]),
        status,
      ],
      actions: [button("Close", () => modal.close())],
    });
  }

  // Closing/archiving/reopening (manager/owner only, server-enforced too): a small confirm dialog
  // stating the real effect in words (Terry, 2026-09-19: closing/archiving never forgives debt,
  // erases history or forces a balance to zero — said here, not just true underneath), with an
  // optional reason kept in the event's own history.
  async function changeEventStatus(event, status) {
    const reason = input({ maxlength: "200", autocomplete: "off", placeholder: "Optional" });
    const modal = openModal({
      title: `${EVENT_TRANSITION_LABEL[status]} "${event.name}"?`,
      body: [el("p", { text: EVENT_STATUS_HELP[status] }), field("Reason (optional)", reason)],
      actions: [button("Cancel", () => modal.close()), button(EVENT_TRANSITION_LABEL[status], () => void go(), { variant: status === "archived" ? "danger" : "primary" })],
    });
    async function go() {
      modal.setBusy(true);
      const body = { eventId: event.id, status, ...(reason.value.trim() ? { reason: reason.value.trim() } : {}) };
      const out = await ctx.store.actions.write((ws) => ctx.api.groupEventStatus(ws, body), ["group"]);
      modal.setBusy(false);
      if (!out.ok) { modal.setError(out.error); return; }
      announce(`"${event.name}" is now ${(EVENT_STATUS_LABELS[status] || status).toLowerCase()}.`);
      modal.close();
    }
  }

  function renderBalances(tables, data, fmt, nameOf) {
    const active = new Set(data.participants.filter((p) => p.active).map((p) => p.ref));
    const blocks = tables.map((table) => [table, table.rows.filter((r) => active.has(r.ref) || !isZero(r.paid) || !isZero(r.share) || !isZero(r.net))]).filter(([, rows]) => rows.length);
    if (!blocks.length) { mount(balancesBox, el("div", { class: "state", text: "No one is in this group yet." })); return; }
    mount(balancesBox,
      ...blocks.flatMap(([table, rows]) => { const c = table.currency; return [
      blocks.length > 1 ? el("h3", { class: "section-title", text: `In ${c}` }) : null,
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
      ])])]; }),
      el("p", { class: "card__meta", text: "Balance = paid − share + payments made − payments received. Only confirmed payments count." }),
    );
  }

  // Suggested or direct payments for every currency shown; each is recorded in its own currency.
  function renderSettle(tables, data, fmt, nameOf, me) {
    const toggle = (value, label) => el("button", { type: "button", class: "btn btn--small", "aria-pressed": mode === value ? "true" : "false", text: label, onClick: () => { mode = value; update(ctx.store.getState()); } });
    const lists = tables.map((t) => [t, mode === "suggested" ? t.suggestions : t.direct]).filter(([, list]) => list.length);
    const labelled = lists.length > 1 || lists.some(([t]) => t.currency !== data.currency);
    mount(settleBox,
      el("div", { class: "seg", role: "group", "aria-label": "How to settle" }, [toggle("suggested", "Fewest payments"), toggle("direct", "Keep who owes whom")]),
      el("p", { class: "muted small", text: mode === "suggested" ? "The fewest payments that settle everyone." : "Each person pays back the people who paid for them, without passing debts along." }),
      ...(lists.length ? lists.flatMap(([t, list]) => { const c = t.currency; return [
        labelled ? el("h3", { class: "section-title", text: `In ${c}` }) : null,
        el("ul", { class: "stack" }, list.map((s) => el("li", { class: "row" }, [
          s.from === me ? arrow("money-out") : s.to === me ? arrow("money-in") : null,
          el("span", { text: `${nameOf(s.from)} ${s.from === me ? "pay" : "pays"} ${s.to === me ? "you" : nameOf(s.to)}` }),
          el("span", { class: "app__spacer" }),
          amountText(s.amount, c),
          data.permissions.canAdd ? button("Record payment", () => openRecordPayment(ctx, { from: s.from, to: s.to, amount: s.amount, currency: c, eventId: data.currentEvent ? data.currentEvent.id : null }), { small: true, attrs: { "aria-label": `Record payment of ${fmt(s.amount, c)} from ${nameOf(s.from)} to ${nameOf(s.to)}` } }) : null,
        ]))),
      ]; }) : [el("div", { class: "state", text: "Everyone is settled up." })]),
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
          el("td", { "data-label": "Amount", class: "num" }, [
            amountText(e.amount, e.currency),
            // BT-009-13: the reporting-currency figure is what every calculation uses; the
            // original currency, amount and rate are always shown alongside it, never hidden.
            e.original ? el("div", { class: "muted small", text: `${e.original.amount} ${e.original.currency} at ${e.original.rate}` }) : null,
          ]),
          el("td", { "data-label": "Your share", class: "num" }, [myShare ? amountText(myShare.amount, e.currency) : el("span", { class: "muted", text: "—" })]),
          el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
            e.canEdit ? button("Edit", () => openGroupExpense(ctx, { expense: e }), { small: true, attrs: { "aria-label": `Edit ${e.description}` } }) : null,
            e.canVoid ? button("Void", () => openVoid(ctx, "expense", e), { small: true, variant: "danger", attrs: { "aria-label": `Void ${e.description}` } }) : null,
            // Anyone who pays or shares may record their part, once per currency (their own account only).
            !void_ && (paidByMe || myShare) && !e.myLedger && !(data.myLedgers || []).some((l) => l.currency === e.currency) && ledgerAccounts(state, e.currency).length && data.permissions.canAdd ? button("Record on my account", () => openLedgerChoice(ctx, "expense", e), { small: true, attrs: { "aria-label": `Record ${e.description} on my account` } }) : null,
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
        // A confirmation withdrawn afterwards, and one given by the person who reported the payment, are
        // said as such (security review S5, S6).
        const detail = s.voided ? `${s.withdrawn ? "Confirmation withdrawn" : "Voided"}: ${s.voidReason}` : s.status === "reported" ? `${s.reportedAgainOf ? "Reported again after a dispute. " : ""}Waiting for ${s.to === me ? "you" : nameOf(s.to)} to confirm it arrived.`
          : s.status === "disputed" ? `Disputed: ${s.disputeReason}`
            // Confirmed over the receiver's dispute: always said (financial recheck F1).
            : s.confirmedOverDispute ? `Confirmed over a dispute by ${s.confirmation ? s.confirmation.by : "someone"}.`
            : s.confirmedByReporter ? "Confirmed by the person who reported it."
            // Who confirmed, when it was not the receiver (the group setting "Anyone in the group can confirm payments").
            : s.confirmation && s.confirmation.relation === "payer" ? `Confirmed by ${s.confirmation.by}, who paid it.`
              : s.confirmation && s.confirmation.relation === "other" ? `Confirmed by ${s.confirmation.by} for ${nameOf(s.to)}.` : null;
        return el("tr", { class: s.voided ? "row--void" : "" }, [
          el("th", { scope: "row", "data-label": "Date", text: formatDate(s.date, dateFormat) }),
          el("td", { "data-label": "Payment" }, [el("span", { text: label }), s.method ? el("div", { class: "muted small", text: s.method }) : null]),
          el("td", { "data-label": "Amount", class: "num" }, [el("span", { class: "amount-dir" }, [s.from === me ? arrow("money-out") : s.to === me ? arrow("money-in") : null, amountText(s.amount, s.currency)])]),
          el("td", { "data-label": "Status" }, [status, detail ? el("div", { class: "muted small", text: detail }) : null,
            s.myLedger && !s.myLedger.accountUnavailable ? el("div", { class: "muted small", text: `Also on your account: ${s.myLedger.accountName}` }) : null]),
          el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
            s.canConfirm ? button("Confirm", () => openConfirm(ctx, s, nameOf), { small: true, variant: "primary", attrs: { "aria-label": `Confirm ${label}` } }) : null,
            s.canDispute ? button("Dispute", () => openDispute(ctx, s, nameOf), { small: true, attrs: { "aria-label": `Dispute ${label}` } }) : null,
            // Whoever paid or received a confirmed payment may record their part, once per currency.
            !s.voided && s.status === "confirmed" && (s.to === me || s.from === me) && !s.myLedger && !(data.myLedgers || []).some((l) => l.currency === s.currency) && ledgerAccounts(state, s.currency).length && data.permissions.canAdd ? button("Record on my account", () => openLedgerChoice(ctx, "settlement", s), { small: true, attrs: { "aria-label": `Record ${label} on my account` } }) : null,
            s.canVoid ? button("Void", () => openVoid(ctx, "settlement", s), { small: true, variant: "danger", attrs: { "aria-label": `Void ${label}` } }) : null,
            button("History", () => void openHistory(ctx, "settlement", s), { small: true, attrs: { "aria-label": `History of ${label}` } }),
          ])]),
        ]);
      })),
    ])]));
  }

  // Leaving the page (the shell asked first) forgets the card's unsaved mark.
  return { element, update, destroy: () => settingsForm.destroy() };
}

const REFRESH = ["group", "accounts", "transactions"];

// FA-1 (financial recheck of 41494d1): starting to record on an account for the first time can
// backdate confirmed cash the person has not yet seen (an advance, reimbursement or repayment waiting
// from before any account was linked), changing its balance the instant the link is made. `attempt`
// performs the write for a given confirmBackdated flag; on the server's 409 confirm_backdated this
// shows its own message (the amount and count) and asks before retrying with the flag set — mirroring
// confirmShare when sharing an account. Declining leaves the calling dialog exactly as it was: no
// error, since nothing failed, the person simply said no.
function writeConfirmingBackdate(attempt) {
  return new Promise((resolve) => {
    void (async () => {
      const first = await attempt(false);
      if (first.ok || !first.error || first.error.code !== "confirm_backdated") { resolve(first); return; }
      let settled = false;
      const finish = (out) => { if (!settled) { settled = true; resolve(out); } };
      const confirmBtn = button("Link anyway", async () => {
        dialog.setBusy(true);
        const out = await attempt(true);
        dialog.setBusy(false);
        if (!out.ok) { dialog.setError(out.error); return; }
        finish(out);
        dialog.close();
      }, { variant: "primary" });
      const dialog = openModal({
        title: "Link this account",
        body: [el("p", { text: messageFor(first.error) })],
        actions: [button("Cancel", () => dialog.close()), confirmBtn],
        onClose: () => finish({ ok: false, error: null }),
      });
    })();
  });
}

async function syncMine(ctx, type, rec) {
  const out = await ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "ledger", type === "expense" ? { expenseId: rec.id } : { settlementId: rec.id }), REFRESH);
  announce(out.ok ? "Your account now matches." : messageFor(out.error));
}

// "Add person" (BT-016, Terry, 2026-09-18: "I figured you would add a button that opened the
// existing modal to add a person"). A small, focused create-only dialog for a workspace-shared
// CONTACT — someone who takes part in shared expenses without an application account of their own
// (api/_shared/people.js's `contact:` reference: never signed in, never granted access; recorded
// only as who was involved). Viewers cannot add one (server-enforced too); the button that opens
// this is simply not offered to them. `onCreated(person)` receives the SAME shape
// `data.participants` entries already have (`{ ref, name, type: "contact", active: true }`), so a
// caller can splice it straight into an already-open picker/checklist without a full reload.
export function openAddPersonModal(ctx, { onCreated } = {}) {
  const key = newIdempotencyKey();
  const name = input({ maxlength: "80", autocomplete: "off", required: true });
  const email = input({ type: "email", autocomplete: "off" });
  const form = el("form", { class: "form-grid", novalidate: true, id: `add-person-${key}` }, [
    field("Name", name),
    field("Email (optional)", email, { help: "Not required, and never used to sign anyone in — this person never gets application access." }),
  ]);
  const save = el("button", { type: "submit", class: "btn btn--primary", text: "Add person", form: `add-person-${key}` });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({ title: "Add person", body: [form], actions: [cancel, save] });
  async function submit() {
    modal.setError("");
    if (!name.value.trim()) { name.setAttribute("aria-invalid", "true"); modal.setError("Give this person a name."); name.focus(); return; }
    modal.setBusy(true);
    try {
      const out = await ctx.api.request("contacts", { method: "POST", body: { scope: "workspace", workspaceId: ctx.store.getState().selectedWorkspaceId, name: name.value.trim(), email: email.value.trim() } });
      modal.setBusy(false);
      modal.close();
      announce(`${out.contact.name} added.`);
      if (onCreated) onCreated({ ref: out.contact.ref, name: out.contact.name, type: "contact", active: true });
    } catch (err) {
      modal.setBusy(false);
      modal.setError(messageFor(err));
    }
  }
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  return modal;
}

// BT-009-20/21: a small, focused create-only dialog for a new named event — any writer, matching
// "Add expense" itself (server-enforced too: `requireWriter`). The first event ever created in a
// workspace silently becomes its default; every one after that is just another choice.
export function openAddEventModal(ctx) {
  const name = input({ maxlength: "80", autocomplete: "off", required: true });
  const description = el("textarea", { class: "field__input", maxlength: "500" });
  const form = el("form", { class: "form-grid", novalidate: true, id: "add-event-form" }, [
    field("Name", name, { wide: true, help: "For example: a trip, a dinner series, or any group of expenses you want to track and settle together." }),
    field("Description (optional)", description, { wide: true }),
  ]);
  const save = el("button", { type: "submit", class: "btn btn--primary", text: "Add event", form: "add-event-form" });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({ title: "Add event", body: [form], actions: [cancel, save] });
  async function submit() {
    modal.setError("");
    if (!name.value.trim()) { name.setAttribute("aria-invalid", "true"); modal.setError("Give this event a name."); name.focus(); return; }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.createGroupEvent(ws, { name: name.value.trim(), description: description.value.trim() }), ["group"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(`"${out.result.event.name}" added.`);
    modal.close();
    // Switch straight to viewing the new event — the reason someone just made one.
    await ctx.store.actions.setGroupEventFilter(out.result.event.id);
  }
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  return modal;
}

// ---- Add or correct an expense -------------------------------------------------------------------
// Everyone who can take part is listed once under "Paid by" and once under "Shared by", with a
// checkbox each. A live preview shows each share and any rounding adjustment, and every problem is
// said inside the dialog before anything is sent.
export function openGroupExpense(ctx, { expense = null, eventId = null } = {}) {
  const state = ctx.store.getState();
  const data = groupData(state);
  if (!data) { announce("Shared expenses are still loading. Try again in a moment."); void ctx.store.actions.refreshGroup(); return null; }
  const editing = !!expense;
  // The reporting currency: every payer amount, split amount, balance and settlement is always
  // in THIS currency (BT-009-13), whatever currency the expense itself was actually paid in.
  const currency = editing ? expense.currency : data.currency;
  const hasOriginal = editing && !!expense.original;
  // The Amount field is always entered in the currency the expense actually was: fixed forever
  // once recorded (an expense's own currency can never change, in either direction —
  // `currency_locked`, api/group/handler.js) and chosen only when adding a new one.
  const fixedEntryCurrency = hasOriginal ? expense.original.currency : currency;
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
  const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00 or 12.50+3.20", value: editing ? (hasOriginal ? expense.original.amount : expense.amount) : "" });
  const amountLabel = el("label", { class: "field__label", text: "" });
  const amountHelp = el("p", { class: "field__help", "aria-live": "polite" });
  const amountField = el("div", { class: "field" }, [amountLabel, amount, amountHelp]);
  // A new expense may be entered in a currency other than the workspace's own (BT-009-13); an
  // existing one's currency is fixed and only ever shown, never offered as a picker.
  const currencyOptions = [{ value: currency, label: `${currency} (this workspace's currency)` }, ...FOREIGN_CURRENCIES.filter((c) => c !== currency).map((c) => ({ value: c, label: c }))];
  const currencyPicker = editing ? null : pickerSelect(currencyOptions, currency, {}, { search: false });
  const currencyFixedNote = hasOriginal
    ? el("p", { class: "field__help", text: `Currency: ${fixedEntryCurrency} — fixed once recorded. Void this expense and add a new one to change its currency.` }) : null;
  const entryCurrency = () => (currencyPicker ? currencyPicker.value : fixedEntryCurrency);
  const isForeign = () => entryCurrency() !== currency;
  // Exchange-rate details: only meaningful, and only shown, for a foreign-currency expense.
  // Preserved exactly (never silently reused for a new rate) unless the amount is ALSO
  // resubmitted — "changing rates later never changes a recorded expense" (Terry's split-costs
  // check, 2026-09-14) is enforced on the server; the note below explains that here too.
  const rate = input({ inputmode: "decimal", autocomplete: "off", placeholder: "e.g. 0.92", value: hasOriginal ? expense.original.rate : "" });
  const rateHelp = el("p", { class: "field__help" });
  const rateField = el("div", { class: "field" }, [el("label", { class: "field__label", for: rate.id || (rate.id = `${key}-rate`), text: "Exchange rate" }), rate, rateHelp]);
  const rateSource = pickerSelect(Object.entries(RATE_SOURCE_LABELS).map(([value, text]) => ({ value, label: text })), hasOriginal ? expense.original.rateSource : "manual", {}, { search: false });
  const rateDate = input({ type: "date", value: hasOriginal ? expense.original.rateDate : (editing ? expense.date : todayIso()) });
  const reportingPreview = el("p", { class: "field__help", "aria-live": "polite" });
  const rateOnlyNote = el("p", { class: "field__help", text: "Changing the rate or its date/source alone has no effect unless the amount above is also changed — a correction never silently revalues what was already recorded." });
  const foreignFieldset = el("fieldset", { class: "plain-fieldset field--wide" }, [
    el("legend", { class: "field__label", text: "Original amount and exchange rate" }),
    rateField, field("Rate source", rateSource), field("Rate date", rateDate), reportingPreview,
    editing ? rateOnlyNote : null,
  ]);
  const date = input({ type: "date", value: editing ? expense.date : todayIso() });
  const categories = ((sliceFor(state, "categories").data || {}).categories || []).filter((c) => (!c.archived && c.type !== "income") || (editing && c.id === expense.categoryId));
  const category = pickerSelect([{ value: "", label: "No category" }].concat(categories.map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name }))), editing ? expense.categoryId || "" : "", {}, { badgeOf: categoryBadges(state) });
  const notes = el("textarea", { class: "field__input", maxlength: "2000", text: editing ? expense.notes : "" });
  const reason = input({ maxlength: "200", autocomplete: "off", placeholder: "Why is this being corrected?" });

  // A new expense starts from the person's own defaults, otherwise the group's (setting b).
  const defaultPaidBy = personalDefault(state, "groupPaidBy") || groupValue(data, "paidBy", "me");
  const defaultWho = personalDefault(state, "groupSplitWho") || groupValue(data, "splitWho", "everyone");
  const defaultMethod = personalDefault(state, "groupSplitMethod") || groupValue(data, "splitMethod", "equal");

  // Paid by.
  const paid = new Map(editing ? expense.payers.map((p) => [p.ref, expense.payers.length > 1 ? p.amount : ""]) : defaultPaidBy === "nobody" ? [] : [[me, ""]]);
  const makePayerRow = (p, checked = paid.has(p.ref)) => {
    const box = el("input", { type: "checkbox", id: uid("payer"), class: "split-row__box" });
    box.checked = checked;
    const amt = input({ inputmode: "decimal", autocomplete: "off", "aria-label": `Amount paid by ${p.name}`, placeholder: "0.00", value: paid.get(p.ref) || "" });
    return { p, box, amt, row: el("div", { class: "split-row" }, [box, el("label", { for: box.id, text: label(p) }), amt]) };
  };
  const payerRows = people.map((p) => makePayerRow(p));
  const payerListEl = el("div", { class: "split-list" }, payerRows.map((r) => r.row));
  const payersNote = el("p", { class: "field__help" });

  // Shared by.
  const values = new Map(editing ? expense.split.lines.map((l) => [l.ref, l.value === null || l.value === undefined ? "" : String(l.value)]) : []);
  const method = pickerSelect(Object.entries(METHOD_LABELS).map(([value, text]) => ({ value, label: text })), editing ? expense.split.method : defaultMethod, {}, { search: false });
  const makeSplitRow = (p, checked = editing ? values.has(p.ref) : defaultWho === "me" ? p.ref === me : !!p.active) => {
    const box = el("input", { type: "checkbox", id: uid("share"), class: "split-row__box" });
    box.checked = checked;
    const val = input({ inputmode: "decimal", autocomplete: "off", value: values.get(p.ref) || "" });
    const out = el("span", { class: "num split-row__share" });
    return { p, box, val, out, row: el("div", { class: "split-row" }, [box, el("label", { for: box.id, text: label(p) }), val, out]) };
  };
  const splitRows = people.map((p) => makeSplitRow(p));
  const splitListEl = el("div", { class: "split-list" }, splitRows.map((r) => r.row));
  const everyone = button("Everyone", () => { for (const r of splitRows) r.box.checked = r.p.active || r.box.checked; refresh(); }, { small: true, attrs: { "aria-label": "Share with everyone" } });
  // BT-009-25: applying a saved preset replaces who is checked and their values outright (a preset
  // represents "this is who is typically in it"); the amount itself is never touched — presets are
  // proportions, reusable at any expense size.
  function applyPreset(preset) {
    method.value = preset.method;
    const byRef = new Map(preset.lines.map((l) => [l.ref, l.value]));
    for (const r of splitRows) {
      r.box.checked = byRef.has(r.p.ref);
      const v = byRef.get(r.p.ref);
      r.val.value = v === null || v === undefined ? "" : String(v);
    }
    refresh();
  }
  const presetPicker = (data.splitPresets || []).length
    ? pickerSelect([{ value: "", label: "Choose one…" }, ...data.splitPresets.map((p) => ({ value: p.id, label: p.name }))], "", {}, { search: false })
    : null;
  const presetControl = presetPicker ? commitOnConfirm(presetPicker, (v) => {
    if (v) { const preset = data.splitPresets.find((p) => p.id === v); if (preset) applyPreset(preset); }
    presetControl.reset("");
  }) : null;
  const savePresetButton = button("Save this split as a preset…", () => openSaveSplitPreset(), { small: true });
  function openSaveSplitPreset() {
    const snap = snapshot();
    if (!PRESET_METHODS.includes(snap.method)) { announce("Only Equally, By shares or By percentages splits can be saved as a preset — those are the ones that make sense at any expense size."); return; }
    if (snap.lines.length < 2) { announce("Choose at least two people to save a split preset."); return; }
    const name = input({ maxlength: "80", autocomplete: "off", required: true });
    const form = el("form", { class: "form-grid", novalidate: true, id: "save-split-preset-form" }, [field("Name", name, { wide: true, help: "For example: “Housemates” or “Alice and Bob, 60/40”." })]);
    const save = el("button", { type: "submit", class: "btn btn--primary", text: "Save preset", form: "save-split-preset-form" });
    const modal = openModal({ title: "Save this split as a preset", body: [form], actions: [button("Cancel", () => modal.close()), save] });
    async function submit() {
      modal.setError("");
      if (!name.value.trim()) { name.setAttribute("aria-invalid", "true"); modal.setError("Give this preset a name."); name.focus(); return; }
      const lines = snap.lines.map((l) => {
        if (snap.method === "equal") return { ref: l.ref };
        if (snap.method === "shares") return { ref: l.ref, value: Number(String(l.value).trim()) };
        return { ref: l.ref, value: String(l.value).trim() };
      });
      modal.setBusy(true);
      const out = await ctx.store.actions.write((ws) => ctx.api.createSplitPreset(ws, { name: name.value.trim(), method: snap.method, lines }), ["group"]);
      modal.setBusy(false);
      if (!out.ok) { modal.setError(out.error); return; }
      announce(`"${out.result.preset.name}" saved. It will be offered next time you add a shared expense.`);
      modal.close();
    }
    save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  }
  const preview = el("div", { class: "split-preview", "aria-live": "polite" });
  const problems = el("ul", { class: "split-problems error-text", "aria-live": "polite" });
  // "Add person" (BT-016): someone not already a choosable participant (not a workspace member,
  // never added as a contact before) can be added here, without leaving this dialog, and is
  // immediately available in BOTH lists above — checked under "Shared by" (the reason to add them
  // here is almost always that they took part), left unchecked under "Paid by". Never offered to
  // anyone who could not open this dialog in the first place (data.permissions.canAdd already
  // gates "Add expense"/"Edit" the same way); the server enforces it too either way.
  const addPerson = data.permissions.canAdd ? button("Add person…", () => {
    openAddPersonModal(ctx, {
      onCreated: (p) => {
        people.push(p);
        const payerRow = makePayerRow(p, false);
        payerRows.push(payerRow);
        payerListEl.appendChild(payerRow.row);
        payerRow.box.addEventListener("change", refresh);
        payerRow.amt.addEventListener("input", refresh);
        const splitRow = makeSplitRow(p, true);
        splitRows.push(splitRow);
        splitListEl.appendChild(splitRow.row);
        splitRow.box.addEventListener("change", refresh);
        splitRow.val.addEventListener("input", refresh);
        refresh();
      },
    });
  }, { small: true }) : null;

  // Optionally also on the person's own private account (never when correcting; that has its own
  // action). Anyone who pays or shares has a part to record. Once they record their part of the group
  // in a currency, every expense they take part in follows there, so the choice is not offered again.
  const linked = (data.myLedgers || []).find((l) => l.currency === currency && !l.accountUnavailable) || null;
  const mine = editing || linked ? [] : ledgerAccounts(state, currency);
  const ledgerBox = el("input", { type: "checkbox", id: `${key}-ledger` });
  const ledgerAccount = pickerSelect(mine.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), (mine[0] || {}).id, {}, { badgeOf: iconBadges(mine), placeholder: "Choose an account…" });
  const ledgerChoice = el("div", { class: "stack" }, [
    el("div", { class: "field--inline" }, [ledgerBox, el("label", { for: ledgerBox.id, text: "Also record my part on my own account" })]),
    field("Account", ledgerAccount),
    el("p", { class: "field__help", text: "Your share is recorded as spending. What you paid beyond it is money you lent; a share you did not pay is money you owe. Your other shared expenses and payments in this currency follow on the same account. Only you see which account." }),
  ]);
  const ledgerNote = el("p", { class: "field__help" });
  const ledgerField = el("fieldset", { class: "plain-fieldset field--wide" }, [
    el("legend", { class: "field__label", text: "Your own account (optional)" }),
    ledgerChoice, ledgerNote,
  ]);

  function computedAmount() {
    const raw = amount.value.trim();
    if (!raw) return "";
    if (isPlainAmount(raw)) return raw;
    return evaluateAmount(raw, precisionOf(entryCurrency())) || "";
  }
  const originalMinorNow = () => parseAmount(computedAmount(), entryCurrency());
  // The reporting-currency figure resubmitting the amount and/or rate would need — but a
  // correction that touches neither pins to the RECORD'S OWN stored amount rather than
  // recomputing anything, so an unrelated change (description, category, notes…) can never
  // silently convert an already-converted amount again (the exact regression this fixes).
  const initialOriginalMinor = hasOriginal ? expense.original.amountMinor : (editing ? expense.amountMinor : null);
  function moneyChanged() {
    if (!editing) return true;
    if (originalMinorNow() !== initialOriginalMinor) return true;
    if (hasOriginal) {
      if (rate.value.trim() !== expense.original.rate) return true;
      if (rateSource.value !== expense.original.rateSource) return true;
      if ((rateDate.value || null) !== (expense.original.rateDate || null)) return true;
    }
    return false;
  }
  function reportingMinorNow() {
    if (!isForeign()) return originalMinorNow();
    if (editing && !moneyChanged()) return expense.amountMinor;
    const om = originalMinorNow();
    const rt = rate.value.trim();
    return om === null || om <= 0 || !rt ? null : convert(om, entryCurrency(), currency, rt);
  }
  function snapshot() {
    const rm = reportingMinorNow();
    return {
      amount: rm !== null ? formatMinor(rm, currency) : "", currency, method: method.value,
      payers: payerRows.filter((r) => r.box.checked).map((r) => ({ ref: r.p.ref, name: r.p.name, amount: r.amt.value })),
      lines: splitRows.filter((r) => r.box.checked).map((r) => ({ ref: r.p.ref, name: r.p.name, value: r.val.value })),
    };
  }
  function refresh() {
    const foreign = isForeign();
    amountLabel.textContent = `Amount (${entryCurrency()})`;
    if (!amount.id) amount.id = `${key}-amount`;
    amountLabel.setAttribute("for", amount.id);
    foreignFieldset.hidden = !foreign;
    rateHelp.textContent = `How many ${currency} one ${entryCurrency()} was worth, for example 0.92.`;
    if (foreign) {
      const om = originalMinorNow();
      const rt = rate.value.trim();
      if (om === null) reportingPreview.textContent = "";
      else if (!rt) reportingPreview.textContent = `Give the exchange rate to convert from ${entryCurrency()} to ${currency}.`;
      else {
        const rm = editing && !moneyChanged() ? expense.amountMinor : convert(om, entryCurrency(), currency, rt);
        reportingPreview.textContent = rm === null ? "Not a valid exchange rate." : `= ${money(rm)} in ${currency}, this workspace's currency.`;
      }
    } else reportingPreview.textContent = "";
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
    const calc = raw && !isPlainAmount(raw) ? evaluateAmount(raw, precisionOf(entryCurrency())) : null;
    amountHelp.textContent = raw && !isPlainAmount(raw) ? (calc ? `= ${calc} ${entryCurrency()}` : "Not a valid calculation") : "";
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
    // Anyone who pays or shares has a part to record on their own account.
    const involved = payerRows.some((r) => r.p.ref === me && r.box.checked) || splitRows.some((r) => r.p.ref === me && r.box.checked);
    ledgerField.hidden = !involved;
    ledgerChoice.hidden = !mine.length;
    ledgerNote.textContent = linked ? `Your part is recorded on ${linked.accountName}, with your other shared expenses in ${currency}.`
      : mine.length ? "" : "Add a private account of your own on the Accounts page to record this there.";
    ledgerNote.hidden = !ledgerNote.textContent;
    ledgerAccount.disabled = !ledgerBox.checked;
  }
  commitOnConfirm(method, () => refresh());
  if (currencyPicker) commitOnConfirm(currencyPicker, () => refresh());
  commitOnConfirm(rateSource, () => refresh());
  for (const node of [amount, rate, rateDate, ...payerRows.map((r) => r.amt), ...splitRows.map((r) => r.val)]) node.addEventListener("input", refresh);
  for (const node of [...payerRows.map((r) => r.box), ...splitRows.map((r) => r.box), ledgerBox]) node.addEventListener("change", refresh);

  const formId = `${key}-form`;
  const save = el("button", { type: "submit", class: "btn btn--primary", text: editing ? "Save correction" : "Save expense", form: formId });
  const form = el("form", { class: "form-grid", novalidate: true, id: formId }, [
    field("Description", description, { wide: true }),
    currencyPicker ? field("Currency", currencyPicker, { help: "Choose a different currency only when this was actually paid in one — the amount below is then entered in that currency, with its own exchange rate." }) : null,
    amountField,
    currencyFixedNote,
    field("Date", date),
    field("Category", category),
    foreignFieldset,
    el("fieldset", { class: "plain-fieldset field--wide" }, [el("legend", { class: "field__label", text: "Paid by" }), payerListEl, payersNote, addPerson ? el("div", { class: "stack" }, [addPerson, el("p", { class: "field__help", text: "Not a workspace member yet — records who took part, without giving them application access." })]) : null]),
    el("fieldset", { class: "plain-fieldset field--wide" }, [
      el("legend", { class: "field__label", text: "Shared by" }),
      el("div", { class: "row" }, [field("Split", method), everyone, savePresetButton]),
      presetPicker ? field("Use a saved split", presetPicker) : null,
      splitListEl,
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
    for (const node of [description, amount, rate, reason]) node.removeAttribute("aria-invalid");
    refresh();
    if (!description.value.trim()) { mark(description); modal.setError("Describe the expense, for example “Dinner at the harbour”."); description.focus(); return; }
    if (isForeign() && originalMinorNow() !== null && originalMinorNow() > 0 && !rate.value.trim()) {
      mark(rate); modal.setError(`Give the exchange rate to convert from ${entryCurrency()} to ${currency}.`); rate.focus(); return;
    }
    if (isForeign() && rate.value.trim() && parseRate(rate.value.trim()) === null) {
      mark(rate); modal.setError("Enter a valid exchange rate, greater than zero."); rate.focus(); return;
    }
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
      // BT-009-25: a blank value under "Fixed amounts, then split the rest" shares the remainder —
      // sent with no `value` at all, exactly what the server's own "left blank" contract expects.
      if (snap.method === "fixed-remainder" && String(l.value ?? "").trim() === "") return { ref: l.ref };
      return { ref: l.ref, value: formatMinor(parseAmount(l.value, currency), currency) };
    };
    const body = {
      description: description.value.trim(), date: date.value, notes: notes.value,
      payers: last.payers.length === 1 ? [{ ref: last.payers[0].ref }] : last.payers.map((p) => ({ ref: p.ref, amount: formatMinor(p.amountMinor, currency) })),
      split: { method: snap.method, lines: snap.lines.map(lineBody) },
    };
    // BT-009-13 root fix: the amount (and, for a foreign expense, the rate/source/date) is only
    // ever sent when it genuinely changed. A correction that touches none of them (description,
    // category, notes…) never resubmits the amount at all, so the server keeps the record's own
    // stored, already-converted figure exactly as it is — it can never be reinterpreted in the
    // original currency and converted a second time.
    if (!editing || moneyChanged()) {
      body.amount = formatMinor(originalMinorNow(), entryCurrency());
      if (isForeign()) {
        if (!editing) body.currency = entryCurrency();
        body.rate = rate.value.trim();
        body.rateSource = rateSource.value;
        if (rateDate.value) body.rateDate = rateDate.value;
      }
    }
    if (editing) body.categoryId = category.value || null;
    else if (category.value) body.categoryId = category.value;
    // BT-009-21: a new expense started while viewing one event's own scoped page joins THAT event,
    // never silently the workspace's separate default — reassigning an existing expense to a
    // different event is not something this dialog does (that is BT-009-24's safe-move work).
    if (!editing && eventId) body.eventId = eventId;
    const withLedger = !editing && !ledgerField.hidden && ledgerBox.checked && ledgerAccount.value;
    if (withLedger) body.ledger = { accountId: ledgerAccount.value };
    modal.setBusy(true);
    const out = editing
      ? await ctx.store.actions.write((ws) => ctx.api.updateGroupExpense(ws, { expenseId: expense.id, revision: expense.revision, reason: reason.value.trim(), ...body }), REFRESH)
      : await writeConfirmingBackdate((confirmBackdated) => ctx.store.actions.write((ws) => ctx.api.createGroupExpense(ws, confirmBackdated ? { ...body, confirmBackdated: true } : body, key), withLedger || linked ? REFRESH : ["group"]));
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
export function openRecordPayment(ctx, { from = null, to = null, amount: preset = "", currency: presetCurrency = null, eventId = null } = {}) {
  const state = ctx.store.getState();
  const data = groupData(state);
  if (!data) { announce("Shared expenses are still loading. Try again in a moment."); void ctx.store.actions.refreshGroup(); return null; }
  // A suggested payment in an earlier currency with an open balance is recorded in that currency
  // (financial review finding 3); otherwise the reporting currency.
  const currency = presetCurrency || data.currency;
  const me = data.permissions.selfRef;
  const people = data.participants.filter((p) => p.active);
  const options = people.map((p) => ({ value: p.ref, label: `${p.name}${p.self ? " (you)" : ""}${p.type === "contact" ? " · contact" : ""}` }));
  const key = newIdempotencyKey();
  // People are searched, as in TaskTracker's people pickers.
  // "Choose who paid…", not the label-built "Choose from…" (UX review U6).
  const fromSel = pickerSelect(options, from || me, {}, { placeholder: "Choose who paid…" });
  const toSel = pickerSelect(options, to || (people.find((p) => p.ref !== (from || me)) || {}).ref, {}, { placeholder: "Choose who was paid…" });
  const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00", value: preset });
  const date = input({ type: "date", value: todayIso() });
  const methodText = input({ maxlength: "60", autocomplete: "off", placeholder: "Cash, bank transfer…" });
  // Once the viewer's part in this currency is recorded on an account, a payment to them follows there.
  const linked = (data.myLedgers || []).some((l) => l.currency === currency);
  const mine = linked ? [] : ledgerAccounts(state, currency);
  const ledgerBox = el("input", { type: "checkbox", id: `${key}-ledger` });
  const ledgerAccount = pickerSelect(mine.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), (mine[0] || {}).id, {}, { badgeOf: iconBadges(mine), placeholder: "Choose an account…" });
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
    field("From", fromSel), field("To", toSel), field(`Amount (${currency})`, amount), field("Date", date),
    field("How it was paid (optional)", methodText, { wide: true }), note, ledgerField,
  ]);
  const modal = openModal({ title: "Record a payment", body: [form], actions: [button("Cancel", () => modal.close()), save] });
  sync();
  async function submit() {
    modal.setError("");
    amount.removeAttribute("aria-invalid");
    const raw = amount.value.trim();
    const value = isPlainAmount(raw) ? raw : evaluateAmount(raw, precisionOf(currency));
    const minor = value ? parseAmount(value, currency) : null;
    if (!minor) { amount.setAttribute("aria-invalid", "true"); amount.setAttribute("aria-errormessage", modal.errorId); modal.setError("Enter the amount paid, more than zero."); amount.focus(); return; }
    if (fromSel.value === toSel.value) { modal.setError("A payment needs two different people."); return; }
    const body = { from: fromSel.value, to: toSel.value, amount: formatMinor(minor, currency), currency, date: date.value };
    if (methodText.value.trim()) body.method = methodText.value.trim();
    // BT-009-21: a payment reported while viewing one event's own scoped page joins THAT event.
    if (eventId) body.eventId = eventId;
    const withLedger = !ledgerField.hidden && ledgerBox.checked && ledgerAccount.value;
    if (withLedger) body.ledger = { accountId: ledgerAccount.value };
    modal.setBusy(true);
    const out = await writeConfirmingBackdate((confirmBackdated) => ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "settle", confirmBackdated ? { ...body, confirmBackdated: true } : body, key), withLedger || (linked && body.to === me) ? REFRESH : ["group"]));
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
  // Once the viewer's part in this currency is recorded on an account, the payment follows there.
  const linked = (data.myLedgers || []).some((l) => l.currency === s.currency);
  const mine = receiving && !linked ? ledgerAccounts(state, s.currency) : [];
  const ledgerBox = el("input", { type: "checkbox", id: uid("ledger") });
  const ledgerAccount = pickerSelect(mine.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), (mine[0] || {}).id, {}, { badgeOf: iconBadges(mine), placeholder: "Choose an account…" });
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
    const out = await writeConfirmingBackdate((confirmBackdated) => ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "confirm", confirmBackdated ? { ...body, confirmBackdated: true } : body), body.ledger || (receiving && linked) ? REFRESH : ["group"]));
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
  const account = pickerSelect(mine.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), (mine[0] || {}).id, {}, { badgeOf: iconBadges(mine), placeholder: "Choose an account…" });
  const modal = openModal({
    title: "Record on my account",
    body: [
      el("p", { text: `Your part of every shared expense and payment in ${rec.currency} is recorded on this account: your shares as spending, what you paid for others as money you lent, shares you did not pay as money you owe, and repayments once they are confirmed. None of it is income. Only you see which account.` }),
      field("Account", account),
    ],
    actions: [button("Cancel", () => modal.close()), button("Record", () => void go(), { variant: "primary" })],
  });
  async function go() {
    modal.setError("");
    modal.setBusy(true);
    const body = { [type === "expense" ? "expenseId" : "settlementId"]: rec.id, accountId: account.value };
    const out = await writeConfirmingBackdate((confirmBackdated) => ctx.store.actions.write((ws) => ctx.api.groupAction(ws, "ledger", confirmBackdated ? { ...body, confirmBackdated: true } : body), REFRESH));
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
    // BT-009-13: a history entry that changed `original` (a foreign-currency expense's own
    // amount, rate, source or date) shows exactly what it was, not just "[object Object]".
    if (fieldName === "original") return `${v.amount} ${v.currency} at ${v.rate} (${RATE_SOURCE_LABELS[v.rateSource] || v.rateSource}, ${v.rateDate})`;
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
