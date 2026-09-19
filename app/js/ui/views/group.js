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
import * as offline from "../../core/offline.js";
import { evaluateAmount, isPlainAmount } from "../../core/calc.js";
import { formatAmount, formatDate, todayIso } from "../../core/format.js";
import { previewSplit, previewItemization, precisionOf, formatMinor, parseAmount, parseRate, convert } from "../../core/split.js";
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
  // BT-009-25: settlement units (couples/families) — a display/suggestion-only grouping (never a
  // second calculation of balance; never a thing that can hold money or gain access). Its own card,
  // for the same reason Events has one: the honest "this only changes the Settle-up view" note
  // belongs right beside the thing it explains.
  const unitsBox = el("div");
  const unitsCard = el("section", { class: "card", "aria-labelledby": "grp-units" }, [titled("grp-units", "users", "Households"), unitsBox]);
  // BT-009-25: shared income / prepaid contributions / deposits — a fully separate report, never a
  // real income/expense transaction and never netted against the Balances card above (see the long
  // comment on api/group/handler.js's contributionView section for why).
  const fundBox = el("div");
  const fundCard = el("section", { class: "card", "aria-labelledby": "grp-fund" }, [titled("grp-fund", "coins", "Shared fund"), fundBox]);
  // BT-009-26: in-app payment reminders — a nudge only, in-app, never an email/SMS/push (no
  // delivery provider or credentials are configured for this workspace); it moves no money and
  // never changes a balance itself — only an actual recorded payment does that.
  const remindersBox = el("div");
  const remindersCard = el("section", { class: "card", "aria-labelledby": "grp-reminders" }, [titled("grp-reminders", "bell", "Payment reminders"), remindersBox]);
  // BT-009-26: insights — spending by category/participant, and a settlement summary, all derived
  // from the exact same canonical records the rest of this page already reads (never a second,
  // independent calculation). Fetched separately (its own read-only route) since it is a genuinely
  // different shape from the main page load, refetched only when the workspace or the viewed event
  // actually changes.
  const insightsBox = el("div");
  const insightsCard = el("section", { class: "card", "aria-labelledby": "grp-insights" }, [titled("grp-insights", "chart-pie", "Insights"), insightsBox]);
  let insightsKey = null;
  let insightsForData = null; // the exact `data` object last fetched for — a fresh object every real refresh
  let insightsData = null;
  // BT-009-26: offline entry — an explicit, per-device opt-in (`offline.js`); when on and adding a
  // new expense/payment fails for a genuine connectivity reason, it is saved on this device and
  // sent automatically once a sync succeeds. Never a second calculation or a mirror of this page's
  // own data — only the queued requests themselves.
  const offlineBox = el("div");
  const offlineCard = el("section", { class: "card", "aria-labelledby": "grp-offline" }, [titled("grp-offline", "wifi", "Offline entry"), offlineBox]);
  let offlineSyncedFor = null; // avoids re-attempting a sync every render once one has already run for this data
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
      unitsCard,
      fundCard,
      remindersCard,
      insightsCard,
      offlineCard,
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
  // BT-009-26: the offline queue lives outside the store's own state on purpose (never mirrored
  // into it — "minimal retained data"), so this page re-renders itself directly whenever it
  // changes (opted in/out, something queued, discarded, sent or blocked), the same way it already
  // reacts to every real state change.
  const unsubscribeOffline = offline.onChange(() => update(ctx.store.getState()));
  // "Sent automatically" (Terry, 2026-09-19) means exactly that — the browser's own connectivity
  // signal triggers a sync attempt, never waiting on the person to notice, click something or
  // navigate away and back. `renderOffline` also tries once per genuinely new page load as a
  // fallback for a browser that never fires this event.
  const onOnline = () => { const s = ctx.store.getState(); if (groupData(s)) void syncOffline(s.selectedWorkspaceId); };
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("online", onOnline);

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
      button("Itemize a receipt…", () => openItemizedExpenseModal(ctx, { eventId: scoped ? scoped.id : null }), {}),
      button("Record a payment", () => openRecordPayment(ctx, { eventId: scoped ? scoped.id : null })),
      button("Import from Splitwise…", () => openSplitwiseImportModal(ctx, data)),
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
    renderUnits(data, nameOf);
    renderFund(data, nameOf, fmt);
    renderReminders(data, nameOf, fmt, me);
    loadInsights(state.selectedWorkspaceId, scoped ? scoped.id : null, data, nameOf, fmt);
    renderOffline(state.selectedWorkspaceId, data, fmt, nameOf);
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
  // BT-009-25: the Households card — a plain list of settlement units, each with its members named
  // (never hidden), and a way to add or remove one. Explicitly says what a household changes (only
  // the Settle-up view) and what it never does (grant access, rewrite history, move liability).
  function renderUnits(data, nameOf) {
    const list = data.settlementUnits || [];
    mount(unitsBox,
      el("p", { class: "field__help", text: "Group a couple or family together so “Settle up” can suggest one payment instead of several. This never changes who paid what or who owes what, and never gives anyone access to anything." }),
      list.length ? el("ul", { class: "stack" }, list.map((u) => el("li", { class: "grow" }, [
        el("span", {}, [withIcon("users", u.name), el("span", { class: "muted small" }, [` — ${u.memberRefs.map((ref) => nameOf(ref)).join(", ")}`])]),
        el("span", { class: "app__spacer" }),
        data.permissions.canAdd ? button("Remove", () => void removeUnit(u), { small: true, variant: "danger", attrs: { "aria-label": `Remove household ${u.name}` } }) : null,
      ]))) : el("p", { class: "muted small", text: "No households yet." }),
      data.permissions.canAdd ? button("Add household…", () => openAddUnitModal(ctx, data), { small: true }) : null,
    );
  }
  async function removeUnit(u) {
    const out = await ctx.store.actions.write((ws) => ctx.api.deleteSettlementUnit(ws, { unitId: u.id }), ["group"]);
    announce(out.ok ? `"${u.name}" removed.` : messageFor(out.error));
  }

  // BT-009-25: the Shared fund card. Deliberately says, in words, that this NEVER counts as income
  // or spending and NEVER changes the Balances card above — the two are honestly separate reports
  // (docs/BT-009-25-WORKED-EXAMPLES.md §4's own recorded design decision).
  function renderFund(data, nameOf, fmt) {
    const list = data.contributions || [];
    mount(fundBox,
      el("p", { class: "field__help", text: "Money contributed in advance, or a refundable deposit, held by one person on behalf of others. This never counts as income or spending, and never changes the Balances card above — check both to see your full position." }),
      list.length ? el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards" }, [
        el("thead", {}, [el("tr", {}, ["Contributor", "Held by", "Kind", "Amount", "Applied", "Returned", "Still held", "Actions"].map((h) => el("th", { scope: "col", class: ["Amount", "Applied", "Returned", "Still held"].includes(h) ? "num" : "", text: h })))]),
        el("tbody", {}, list.map((c) => el("tr", {}, [
          el("td", { "data-label": "Contributor", text: nameOf(c.contributor) }),
          el("td", { "data-label": "Held by", text: nameOf(c.holder) }),
          el("td", { "data-label": "Kind", text: c.kind === "deposit" ? "Deposit" : "Contribution" }),
          el("td", { "data-label": "Amount", class: "num" }, [amountText(c.amount, c.currency)]),
          el("td", { "data-label": "Applied", class: "num" }, [amountText(c.applied, c.currency)]),
          el("td", { "data-label": "Returned", class: "num" }, [amountText(c.returned, c.currency)]),
          el("td", { "data-label": "Still held", class: "num" }, [amountText(c.held, c.currency)]),
          el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
            data.permissions.canAdd && Number(c.heldMinor) > 0 ? button("Apply…", () => openContributionMoveModal(ctx, c, "apply", nameOf, fmt), { small: true, attrs: { "aria-label": `Apply part of ${nameOf(c.contributor)}'s ${c.kind}` } }) : null,
            data.permissions.canAdd && Number(c.heldMinor) > 0 ? button("Return…", () => openContributionMoveModal(ctx, c, "return", nameOf, fmt), { small: true, attrs: { "aria-label": `Return part of ${nameOf(c.contributor)}'s ${c.kind}` } }) : null,
          ])]),
        ]))),
      ])]) : el("p", { class: "muted small", text: "No contributions or deposits recorded yet." }),
      data.permissions.canAdd ? button("Add contribution…", () => openAddContributionModal(ctx, data, nameOf), { small: true }) : null,
    );
  }
  function openContributionMoveModal(ctx, c, action, nameOf, fmt) {
    const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00", value: c.held });
    const note = input({ maxlength: "200", autocomplete: "off" });
    const verb = action === "apply" ? "Apply" : "Return";
    const form = el("form", { class: "form-grid", novalidate: true, id: `contribution-${action}-form` }, [
      el("p", { text: `${nameOf(c.contributor)}'s ${c.kind} currently has ${fmt(c.held, c.currency)} ${c.currency} still held by ${nameOf(c.holder)}.` }),
      field("Amount", amount), field("Note (optional)", note, { wide: true }),
    ]);
    const save = el("button", { type: "submit", class: "btn btn--primary", text: verb, form: `contribution-${action}-form` });
    const modal = openModal({ title: `${verb} ${nameOf(c.contributor)}'s ${c.kind}`, body: [form], actions: [button("Cancel", () => modal.close()), save] });
    async function submit() {
      modal.setError("");
      const minor = parseAmount(amount.value.trim(), c.currency);
      if (!minor || minor <= 0) { modal.setError("Enter an amount greater than zero."); amount.focus(); return; }
      modal.setBusy(true);
      const call = action === "apply" ? ctx.api.applyContribution : ctx.api.returnContribution;
      const out = await ctx.store.actions.write((ws) => call(ws, { contributionId: c.id, amount: amount.value.trim(), note: note.value.trim() }), ["group"]);
      modal.setBusy(false);
      if (!out.ok) { modal.setError(out.error); return; }
      announce(`${verb === "Apply" ? "Applied" : "Returned"} ${amount.value.trim()} ${c.currency}.`);
      modal.close();
    }
    save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
    return modal;
  }
  function openAddContributionModal(ctx, data, nameOf) {
    const people = data.participants.filter((p) => p.active);
    const contributor = pickerSelect(people.map((p) => ({ value: p.ref, label: nameOf(p.ref) })), data.permissions.selfRef, {}, { search: false });
    const holder = pickerSelect(people.map((p) => ({ value: p.ref, label: nameOf(p.ref) })), data.permissions.selfRef, {}, { search: false });
    const kind = pickerSelect([{ value: "contribution", label: "Contribution (advance payment into a shared fund)" }, { value: "deposit", label: "Deposit (refundable)" }], "contribution", {}, { search: false });
    const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00" });
    const date = input({ type: "date", value: todayIso() });
    const notes = el("textarea", { class: "field__input", maxlength: "2000" });
    const form = el("form", { class: "form-grid", novalidate: true, id: "add-contribution-form" }, [
      field("Who contributed", contributor), field("Held by", holder), field("Kind", kind),
      field("Amount", amount), field("Date", date), field("Notes (optional)", notes, { wide: true }),
    ]);
    const save = el("button", { type: "submit", class: "btn btn--primary", text: "Add contribution", form: "add-contribution-form" });
    const modal = openModal({ title: "Add contribution", body: [form], actions: [button("Cancel", () => modal.close()), save] });
    async function submit() {
      modal.setError("");
      const minor = parseAmount(amount.value.trim(), data.currency);
      if (!minor || minor <= 0) { modal.setError("Enter an amount greater than zero."); amount.focus(); return; }
      modal.setBusy(true);
      const out = await ctx.store.actions.write((ws) => ctx.api.createContribution(ws, {
        contributor: contributor.value, holder: holder.value, kind: kind.value, amount: amount.value.trim(), date: date.value, notes: notes.value.trim(),
      }), ["group"]);
      modal.setBusy(false);
      if (!out.ok) { modal.setError(out.error); return; }
      announce("Contribution added.");
      modal.close();
    }
    save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
    return modal;
  }

  // BT-009-26: the Payment reminders card — a plain in-app nudge, never an email/SMS/push (no
  // delivery provider or credentials are configured for this workspace, said here in words rather
  // than silently pretending one was sent). Sending or resolving one never moves money or changes a
  // balance; only "Record payment" (already on this page) does that.
  function renderReminders(data, nameOf, fmt, me) {
    const list = [...(data.paymentRequests || [])].sort((a, b) => (a.status === "open") === (b.status === "open") ? String(b.createdAt).localeCompare(String(a.createdAt)) : a.status === "open" ? -1 : 1);
    const rows = list.map((r) => {
      const open = r.status === "open";
      const canDismiss = open && r.from === me;
      const canCancel = open && (r.createdBySelf || data.permissions.canManage);
      return el("li", { class: "grow" }, [
        el("span", {}, [
          el("span", { text: `${nameOf(r.to)} asked ${nameOf(r.from)} to pay ${fmt(r.amount, r.currency)}` }),
          r.note ? el("span", { class: "muted small" }, [` — ${r.note}`]) : null,
        ]),
        !open ? badge(r.status === "dismissed" ? "Seen" : "Cancelled", "closed") : null,
        el("span", { class: "app__spacer" }),
        canDismiss ? button("Mark as seen", () => void respondReminder(r, "dismiss"), { small: true, attrs: { "aria-label": `Mark reminder to pay ${fmt(r.amount, r.currency)} as seen` } }) : null,
        canCancel ? button("Cancel", () => void respondReminder(r, "cancel"), { small: true, variant: "danger", attrs: { "aria-label": `Cancel the reminder to ${nameOf(r.from)}` } }) : null,
      ]);
    });
    mount(remindersBox,
      el("p", { class: "field__help", text: "An in-app nudge that money is owed. This is not an email, text or push notification — nothing is sent outside the app — and sending or resolving one never moves money or changes a balance; actually recording a payment happens above, in Settle up." }),
      rows.length ? el("ul", { class: "stack" }, rows) : el("p", { class: "muted small", text: "No payment reminders yet." }),
      data.permissions.canAdd ? button("Send a reminder…", () => openAddReminderModal(ctx, data, nameOf), { small: true }) : null,
    );
  }
  async function respondReminder(r, action) {
    const call = action === "dismiss" ? ctx.api.dismissPaymentRequest : ctx.api.cancelPaymentRequest;
    const out = await ctx.store.actions.write((ws) => call(ws, { requestId: r.id }), ["group"]);
    announce(out.ok ? (action === "dismiss" ? "Marked as seen." : "Reminder cancelled.") : messageFor(out.error));
  }
  function openAddReminderModal(ctx, data, nameOf) {
    const me = data.permissions.selfRef;
    const people = data.participants.filter((p) => p.active);
    const toChoices = [{ value: me, label: "You" }, ...people.filter((p) => p.ref !== me).map((p) => ({ value: p.ref, label: nameOf(p.ref) }))];
    const to = pickerSelect(toChoices, me, {}, { search: false });
    const fromChoices = () => people.filter((p) => p.ref !== to.value).map((p) => ({ value: p.ref, label: nameOf(p.ref) }));
    const from = pickerSelect(fromChoices(), (fromChoices()[0] || {}).value || "", {}, { search: false });
    to.addEventListener("change", () => from.replaceChildren(...fromChoices().map((c) => el("option", { value: c.value, text: c.label }))));
    const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00" });
    const note = input({ maxlength: "500", autocomplete: "off" });
    const form = el("form", { class: "form-grid", novalidate: true, id: "add-reminder-form" }, [
      field("Who is owed", to), field("Who should pay", from), field("Amount", amount), field("Note (optional)", note, { wide: true }),
    ]);
    const save = el("button", { type: "submit", class: "btn btn--primary", text: "Send reminder", form: "add-reminder-form" });
    const modal = openModal({ title: "Send a payment reminder", body: [form], actions: [button("Cancel", () => modal.close()), save] });
    async function submit() {
      modal.setError("");
      const minor = parseAmount(amount.value.trim(), data.currency);
      if (!minor || minor <= 0) { modal.setError("Enter an amount greater than zero."); amount.focus(); return; }
      if (!from.value) { modal.setError("Choose who should pay."); return; }
      modal.setBusy(true);
      const out = await ctx.store.actions.write((ws) => ctx.api.createPaymentRequest(ws, { from: from.value, to: to.value, amount: amount.value.trim(), note: note.value.trim() }), ["group"]);
      modal.setBusy(false);
      if (!out.ok) { modal.setError(out.error); return; }
      announce("Reminder sent, in-app only.");
      modal.close();
    }
    save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
    return modal;
  }

  // BT-009-26: the Offline entry card — the explicit device opt-in, the disclosure in words, and
  // whatever is currently saved on this device waiting to be sent. A successful sync attempt is
  // made at most once per genuinely new page load of data (never on every render), the same
  // debounce discipline `loadInsights` below uses, for the same reason.
  function renderOffline(wsId, data, fmt, nameOf) {
    const toggle = el("input", { type: "checkbox", id: "grp-offline-toggle" });
    toggle.checked = offline.isEnabled();
    toggle.addEventListener("change", () => { offline.setEnabled(toggle.checked); announce(toggle.checked ? "Offline entry turned on for this device." : "Offline entry turned off for this device."); });
    const pending = offline.queueFor(wsId);
    const rows = pending.map((entry) => {
      const desc = entry.kind === "expense" ? (entry.body.description || "Shared expense") : `Payment to ${nameOf(entry.body.to)}`;
      const amount = entry.body.amount ? amountText(entry.body.amount, entry.body.currency || data.currency) : null;
      const status = entry.blocked ? el("span", { class: "muted small", text: entry.lastError || "This could not be sent." }) : el("span", { class: "muted small", text: "Waiting to send…" });
      return el("li", { class: "grow" }, [
        el("span", {}, [el("span", { text: `${desc} ` }), status]),
        el("span", { class: "app__spacer" }),
        amount,
        // `offline.discard`/`offline.unblock` notify this page's own subscription, which re-renders
        // this card (and the rest of the page) right away — no manual re-render call needed here.
        entry.blocked ? button("Try again", () => { offline.unblock(entry.id); void syncOffline(wsId); }, { small: true, attrs: { "aria-label": `Try sending ${desc} again` } }) : null,
        button("Discard", () => offline.discard(entry.id), { small: true, variant: "danger", attrs: { "aria-label": `Discard ${desc}, saved on this device` } }),
      ]);
    });
    mount(offlineBox,
      el("div", { class: "field--inline" }, [toggle, el("label", { for: toggle.id, text: "Save new expenses and payments on this device when offline, and send them once back online" })]),
      el("p", { class: "field__help", text: offline.DISCLOSURE }),
      pending.length ? el("ul", { class: "stack" }, rows) : el("p", { class: "muted small", text: "Nothing is currently waiting to be sent." }),
      pending.some((e) => !e.blocked) ? button("Send now", () => void syncOffline(wsId), { small: true }) : null,
    );
    if (offlineSyncedFor !== data && pending.some((e) => !e.blocked)) {
      offlineSyncedFor = data;
      void syncOffline(wsId);
    } else {
      offlineSyncedFor = data;
    }
  }
  async function syncOffline(wsId) {
    const { sent } = await offline.sync(ctx, wsId);
    if (sent.length) { announce(`${sent.length} offline ${sent.length === 1 ? "entry" : "entries"} sent.`); await ctx.store.actions.refreshGroup(); }
    else {
      const state = ctx.store.getState();
      const data = groupData(state);
      if (!data) return;
      const names = namesOf(data);
      const me = data.permissions.selfRef;
      renderOffline(wsId, data, fmtFor(state), (ref) => (ref === me ? "You" : names.get(ref) || "Someone"));
    }
  }

  // BT-009-26: fetched only when the workspace or the viewed event actually changes (never on every
  // render), and rendered from whatever the last successful fetch returned.
  function loadInsights(wsId, eventId, data, nameOf, fmt) {
    if (typeof ctx.api.groupInsights !== "function") return;
    const key = `${wsId}|${eventId || ""}`;
    // Refetch whenever the workspace/event changes OR the underlying group data itself is a genuinely
    // new object (a real refresh — `store.js`'s `loadSlice` always produces a fresh `data` reference
    // on every real fetch, never mutating the previous one in place) — never on an incidental
    // re-render that reuses the same, already-current data.
    if (key === insightsKey && data === insightsForData) { renderInsights(nameOf, fmt); return; }
    insightsKey = key;
    insightsForData = data;
    mount(insightsBox, el("div", { class: "state", text: "Loading…" }));
    ctx.api.groupInsights(wsId, eventId).then((res) => {
      if (insightsKey !== key || insightsForData !== data) return; // a newer request has already superseded this one
      insightsData = res.insights;
      renderInsights(nameOf, fmt);
    }, (err) => {
      if (insightsKey !== key || insightsForData !== data) return;
      mount(insightsBox, el("div", { class: "state state--error", role: "alert", text: messageFor(err) }));
    });
  }
  function renderInsights(nameOf, fmt) {
    if (!insightsData) return;
    if (!insightsData.length || !insightsData.some((t) => t.expenseCount > 0)) {
      mount(insightsBox, el("p", { class: "muted small", text: "No shared expenses yet — insights will appear once there are some." }));
      return;
    }
    mount(insightsBox, ...insightsData.filter((t) => t.expenseCount > 0).flatMap((t) => {
      const c = t.currency;
      return [
        insightsData.length > 1 ? el("h3", { class: "section-title", text: `In ${c}` }) : null,
        el("ul", { class: "stack" }, [
          metricRow("Total spent", amountText(t.totalSpent, c)),
          metricRow("Expenses", el("span", { text: String(t.expenseCount) })),
          metricRow("Confirmed payments", amountText(t.settlements.confirmed, c)),
          t.settlements.pendingCount ? metricRow("Pending payments", amountText(t.settlements.pending, c)) : null,
          t.settlements.disputedCount ? metricRow("Disputed payments", amountText(t.settlements.disputed, c)) : null,
        ].filter(Boolean)),
        el("h4", { class: "section-title", text: "By category" }),
        el("ul", { class: "stack" }, t.byCategory.map((cat) => el("li", { class: "row" }, [el("span", { text: cat.name }), el("span", { class: "app__spacer" }), el("span", { class: "muted small", text: `${cat.count} expense${cat.count === 1 ? "" : "s"}` }), amountText(cat.total, c)]))),
        el("h4", { class: "section-title", text: "By participant" }),
        el("ul", { class: "stack" }, t.byParticipant.filter((p) => Number(p.paidMinor) || Number(p.shareMinor)).map((p) => el("li", { class: "row" }, [el("span", { text: nameOf(p.ref) }), el("span", { class: "app__spacer" }), el("span", { class: "muted small", text: `paid ${fmt(p.paid, c)} · share ${fmt(p.share, c)}` })]))),
      ];
    }));
  }
  function metricRow(label, valueNode) {
    return el("li", { class: "row" }, [el("span", { text: label }), el("span", { class: "app__spacer" }), valueNode]);
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
  // BT-009-25: a third mode, "By household", merges any settlement units (couples/families) into
  // one row for the suggestion — display/suggestion only, never a second calculation of balance
  // (groups.js's own unitSuggest). Recording a payment from this view always uses the REAL person
  // named to actually pay/receive (`fromRef`/`toRef`), never a unit — a unit itself can never be a
  // settlement's `from`/`to`.
  function renderSettle(tables, data, fmt, nameOf, me) {
    const hasUnits = tables.some((t) => (t.unitSuggestions || []).length);
    const toggle = (value, label) => el("button", { type: "button", class: "btn btn--small", "aria-pressed": mode === value ? "true" : "false", text: label, onClick: () => { mode = value; update(ctx.store.getState()); } });
    const effectiveMode = mode === "units" && !hasUnits ? "suggested" : mode;
    const lists = tables.map((t) => [t, effectiveMode === "suggested" ? t.suggestions : effectiveMode === "units" ? (t.unitSuggestions || []) : t.direct]).filter(([, list]) => list.length);
    const labelled = lists.length > 1 || lists.some(([t]) => t.currency !== data.currency);
    const unitName = (s, side) => (side === "from" ? (s.fromIsUnit ? s.fromName : nameOf(s.from)) : (s.toIsUnit ? s.toName : nameOf(s.to)));
    mount(settleBox,
      el("div", { class: "seg", role: "group", "aria-label": "How to settle" }, [toggle("suggested", "Fewest payments"), toggle("direct", "Keep who owes whom"), hasUnits ? toggle("units", "By household") : null]),
      el("p", { class: "muted small", text: effectiveMode === "suggested" ? "The fewest payments that settle everyone." : effectiveMode === "units" ? "Households (couples/families) shown as one line where it saves a payment — recording still names the real person who actually pays or receives." : "Each person pays back the people who paid for them, without passing debts along." }),
      ...(lists.length ? lists.flatMap(([t, list]) => { const c = t.currency; return [
        labelled ? el("h3", { class: "section-title", text: `In ${c}` }) : null,
        el("ul", { class: "stack" }, list.map((s) => {
          const fromReal = effectiveMode === "units" ? s.fromRef : s.from;
          const toReal = effectiveMode === "units" ? s.toRef : s.to;
          // "You" whenever the REAL person underneath (never the household's own name) is the one
          // looking — computed once, used identically in the visible text and the accessible name,
          // so neither ever disagrees with the other about who is actually paying or receiving.
          const fromLabel = fromReal === me ? "You" : unitName(s, "from");
          const toLabel = toReal === me ? "you" : unitName(s, "to");
          return el("li", { class: "row" }, [
            fromReal === me ? arrow("money-out") : toReal === me ? arrow("money-in") : null,
            el("span", { text: `${fromLabel} ${fromReal === me ? "pay" : "pays"} ${toLabel}` }),
            el("span", { class: "app__spacer" }),
            amountText(s.amount, c),
            data.permissions.canAdd ? button("Record payment", () => openRecordPayment(ctx, { from: fromReal, to: toReal, amount: s.amount, currency: c, eventId: data.currentEvent ? data.currentEvent.id : null }), { small: true, attrs: { "aria-label": `Record payment of ${fmt(s.amount, c)} from ${fromLabel} to ${toLabel}` } }) : null,
          ]);
        })),
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
            e.split && e.split.method === "itemized" ? [" ", badge("Itemized")] : null,
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
            // BT-009-25: the original expense is never edited by a refund — this is purely
            // descriptive, exactly like the original-currency note above.
            e.refundedMinor > 0 ? el("div", { class: "muted small", text: `Refunded: ${fmt(e.refunded, e.currency)}` }) : null,
          ]),
          el("td", { "data-label": "Your share", class: "num" }, [myShare ? amountText(myShare.amount, e.currency) : el("span", { class: "muted", text: "—" })]),
          el("td", { "data-label": "" }, [el("div", { class: "row-actions" }, [
            e.canEdit ? button("Edit", () => (e.split && e.split.method === "itemized" ? openItemizedExpenseModal(ctx, { expense: e }) : openGroupExpense(ctx, { expense: e })), { small: true, attrs: { "aria-label": `Edit ${e.description}` } }) : null,
            e.canRefund ? button("Refund…", () => openRefundModal(ctx, e, data, nameOf), { small: true, attrs: { "aria-label": `Refund ${e.description}` } }) : null,
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

  // Leaving the page (the shell asked first) forgets the card's unsaved mark, and never leaves a
  // stale offline-queue listener from a page instance that no longer exists.
  return { element, update, destroy: () => { settingsForm.destroy(); unsubscribeOffline(); if (typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("online", onOnline); } };
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
// BT-009-22: "Copy setup from" offers any existing event as a template — its description, icon and
// colour are copied server-side (createEvent's templateEventId), NEVER its participants, expenses,
// settlements, invitations or grants (proven by api/test/group-events.test.js). Choosing one fills
// in the Description field visibly (still editable before saving) so what will be copied is exactly
// what is shown, never a silent server-side default the person cannot see.
export function openAddEventModal(ctx) {
  const data = groupData(ctx.store.getState()) || { events: [] };
  const templates = data.events || [];
  const name = input({ maxlength: "80", autocomplete: "off", required: true });
  const description = el("textarea", { class: "field__input", maxlength: "500" });
  const templateOptions = [{ value: "", label: "None — start blank" }, ...templates.map((e) => ({ value: e.id, label: e.name }))];
  const templatePicker = pickerSelect(templateOptions, "", {});
  templatePicker.addEventListener("change", () => {
    const t = templates.find((e) => e.id === templatePicker.value);
    description.value = t ? (t.description || "") : "";
  });
  const form = el("form", { class: "form-grid", novalidate: true, id: "add-event-form" }, [
    field("Name", name, { wide: true, help: "For example: a trip, a dinner series, or any group of expenses you want to track and settle together." }),
    templates.length ? field("Copy setup from (optional)", templatePicker, { wide: true, help: "Copies its description, icon and colour only — never its expenses, payments, invitations or who can see it." }) : null,
    field("Description (optional)", description, { wide: true }),
  ]);
  const save = el("button", { type: "submit", class: "btn btn--primary", text: "Add event", form: "add-event-form" });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({ title: "Add event", body: [form], actions: [cancel, save] });
  async function submit() {
    modal.setError("");
    if (!name.value.trim()) { name.setAttribute("aria-invalid", "true"); modal.setError("Give this event a name."); name.focus(); return; }
    modal.setBusy(true);
    const body = { name: name.value.trim(), description: description.value.trim() };
    if (templatePicker.value) body.templateEventId = templatePicker.value;
    const out = await ctx.store.actions.write((ws) => ctx.api.createGroupEvent(ws, body), ["group"]);
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

// BT-009-25: a household names >=2 real, individually identifiable people by checkbox — never a
// free-text group, so it can only ever name real participants the server also checks. Nothing here
// creates a new person or expense; it only groups existing ones for the Settle-up view.
export function openAddUnitModal(ctx, data) {
  const name = input({ maxlength: "80", autocomplete: "off", required: true });
  const already = new Set((data.settlementUnits || []).flatMap((u) => u.memberRefs));
  const eligible = data.participants.filter((p) => p.active && !already.has(p.ref));
  // The full real name plus "(you)" — the same convention every other people-picker in this dialog
  // family uses (openGroupExpense's own `label`), never the page-level "You" shorthand, since this
  // list can name several people at once and must stay unambiguous.
  const label = (p) => `${p.name}${p.self ? " (you)" : ""}`;
  const boxes = eligible.map((p) => { const box = el("input", { type: "checkbox", id: uid("unit-member") }); return { p, box }; });
  const form = el("form", { class: "form-grid", novalidate: true, id: "add-unit-form" }, [
    field("Name", name, { wide: true, help: "For example: “The Smiths” or “Alice and Bob”." }),
    el("fieldset", { class: "plain-fieldset field--wide" }, [
      el("legend", { class: "field__label", text: "Who is in this household? (at least two)" }),
      eligible.length ? el("div", { class: "stack" }, boxes.map(({ p, box }) => el("div", { class: "field--inline" }, [box, el("label", { for: box.id, text: label(p) })]))) : el("p", { class: "muted small", text: "Everyone here is already in another household." }),
    ]),
  ]);
  const save = el("button", { type: "submit", class: "btn btn--primary", text: "Add household", form: "add-unit-form" });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({ title: "Add household", body: [form], actions: [cancel, save] });
  async function submit() {
    modal.setError("");
    if (!name.value.trim()) { name.setAttribute("aria-invalid", "true"); modal.setError("Give this household a name."); name.focus(); return; }
    const memberRefs = boxes.filter((b) => b.box.checked).map((b) => b.p.ref);
    if (memberRefs.length < 2) { modal.setError("Choose at least two people."); return; }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.createSettlementUnit(ws, { name: name.value.trim(), memberRefs }), ["group"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(`"${out.result.unit.name}" added.`);
    modal.close();
  }
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  return modal;
}

// ---- Splitwise import (BT-009-26) -----------------------------------------------------------------
// "Start with the specified Splitwise import, including mapping, validation, duplicate detection
// and a non-mutating preview before confirmed import" (Terry, 2026-09-19). No Splitwise account or
// credentials are used here — the CSV a person exports from Splitwise themselves is read entirely
// client-side into text and sent for a read-only preview; nothing is created until "Import
// selected" is pressed. Three steps, all inside one dialog's own body (never the modal's fixed
// footer, so each step's own actions stay beside what they act on): choose a file, map each of
// Splitwise's own named people to someone real here, then review and choose which rows to import.
export function openSplitwiseImportModal(ctx, data) {
  const label = (p) => `${p.name}${p.self ? " (you)" : ""}`;
  const people = data.participants.filter((p) => p.active);
  const nameOf = (ref) => { const p = people.find((x) => x.ref === ref); return p ? label(p) : "Someone"; };
  const wsId = ctx.store.getState().selectedWorkspaceId;
  const container = el("div");
  let csvText = null;
  let personColumns = [];
  const mapping = {};
  let lastSummary = null;
  const modal = openModal({ title: "Import from Splitwise", body: [container], actions: [button("Cancel", () => modal.close())] });

  function cleanMapping() { return Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== undefined)); }

  function renderChoose() {
    const fileInput = el("input", { type: "file", accept: ".csv,text/csv" });
    const loading = el("p", { class: "muted small", hidden: true, text: "Reading the file…" });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      modal.setError("");
      loading.hidden = false;
      try {
        csvText = await file.text();
        const out = await ctx.api.previewSplitwiseImport(wsId, { csv: csvText, mapping: {} });
        personColumns = out.personColumns;
        for (const col of personColumns) mapping[col] = undefined;
        renderMapping();
      } catch (err) {
        loading.hidden = true;
        modal.setError(err);
      }
    });
    mount(container,
      el("p", { class: "field__help", text: "Choose the CSV file Splitwise exports for a group (Splitwise → the group → Export → Download as CSV). Nothing is imported until you review and confirm it." }),
      field("CSV file", fileInput, { wide: true }),
      loading,
    );
  }

  function renderMapping() {
    const options = [{ value: "", label: "Choose who this is" }, { value: "__skip__", label: "Skip this person" }, ...people.map((p) => ({ value: p.ref, label: label(p) }))];
    const pickers = personColumns.map((col) => {
      const pick = pickerSelect(options, "", {}, { search: false });
      pick.addEventListener("change", () => { mapping[col] = pick.value === "__skip__" ? null : (pick.value || undefined); });
      return field(col, pick);
    });
    const next = button("Preview import…", () => void doPreview(), { variant: "primary" });
    mount(container,
      el("p", { class: "field__help", text: "Match each person Splitwise names to someone real in this group, or skip them if they take no part here." }),
      el("div", { class: "form-grid" }, pickers),
      el("div", { class: "row" }, [next]),
    );
  }

  async function doPreview() {
    modal.setError("");
    modal.setBusy(true);
    try {
      const out = await ctx.api.previewSplitwiseImport(wsId, { csv: csvText, mapping: cleanMapping() });
      lastSummary = out.summary;
      renderReview(out.rows);
    } catch (err) { modal.setError(err); } finally { modal.setBusy(false); }
  }

  function renderReview(rows) {
    const real = rows.filter((r) => !r.skip);
    const boxes = real.map((r) => {
      const cb = el("input", { type: "checkbox" });
      cb.checked = r.ok;
      cb.disabled = !r.ok;
      const desc = r.kind === "settlement" ? `Payment: ${nameOf(r.from)} → ${nameOf(r.to)}` : (r.raw && r.raw.description) || "";
      const notes = [];
      if (!r.ok) notes.push(r.message);
      else if (r.duplicateOf) notes.push("Possibly already recorded — review before importing.");
      if (r.roundingNote) notes.push(r.roundingNote);
      return { r, cb, node: el("li", { class: "grow" }, [
        el("label", { class: "row" }, [cb, el("span", { text: `${r.date} — ${desc}` })]),
        el("span", { class: "app__spacer" }),
        amountText(r.amount, r.currency),
        notes.length ? el("span", { class: "muted small", text: notes.join(" ") }) : null,
      ]) };
    });
    const back = button("Back", () => renderMapping());
    const doImport = button("Import selected", () => void confirmImport(boxes), { variant: "primary" });
    mount(container,
      el("p", { class: "field__help", text: `${lastSummary.importable} of ${lastSummary.total} row${lastSummary.total === 1 ? "" : "s"} can be imported as shown; ${lastSummary.duplicates} look like something already recorded here; ${lastSummary.refused} need attention and cannot be imported yet.` }),
      boxes.length ? el("ul", { class: "stack" }, boxes.map((b) => b.node)) : el("p", { class: "muted small", text: "Nothing to import." }),
      el("div", { class: "row" }, [back, doImport]),
    );
  }

  async function confirmImport(boxes) {
    const rows = boxes.filter((b) => b.cb.checked).map((b) => b.r.index);
    if (!rows.length) { modal.setError("Choose at least one row to import."); return; }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.confirmSplitwiseImport(ws, { csv: csvText, mapping: cleanMapping(), rows }), ["group"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    const { imported, skipped } = out.result;
    announce(`Imported ${imported.length} record${imported.length === 1 ? "" : "s"} from Splitwise${skipped.length ? `; ${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped` : ""}.`);
    modal.close();
  }

  renderChoose();
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

  // BT-009-24: moving an expense to another event is only ever offered into an ACTIVE one — the
  // server refuses a closed/archived destination anyway (409), so a doomed choice is never even
  // shown. Sent as just another field on the same correction/amendment, audited like any other
  // field change (before/after event, who, when, why) — never a separate, unaudited "move" route.
  const currentEvent = editing ? (data.events || []).find((e) => e.id === expense.eventId) : null;
  const otherActiveEvents = editing ? (data.events || []).filter((e) => e.status === "active" && e.id !== expense.eventId) : [];
  const moveEventPicker = editing && otherActiveEvents.length
    ? pickerSelect(
        [{ value: expense.eventId, label: currentEvent ? `Keep in "${currentEvent.name}"` : "Keep in its current event" }, ...otherActiveEvents.map((e) => ({ value: e.id, label: `Move to "${e.name}"` }))],
        expense.eventId, {}, { search: false },
      )
    : null;

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
    moveEventPicker ? field("Event", moveEventPicker, { wide: true, help: "Moving it never changes a balance or forgives debt — only which event it is organized under." }) : null,
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
    // BT-009-24: only sent when it genuinely changed, exactly like every other correction field —
    // "Keep in its current event" (the default selection) sends nothing.
    if (editing && moveEventPicker && moveEventPicker.value !== expense.eventId) body.eventId = moveEventPicker.value;
    const withLedger = !editing && !ledgerField.hidden && ledgerBox.checked && ledgerAccount.value;
    if (withLedger) body.ledger = { accountId: ledgerAccount.value };
    modal.setBusy(true);
    const out = editing
      ? await ctx.store.actions.write((ws) => ctx.api.updateGroupExpense(ws, { expenseId: expense.id, revision: expense.revision, reason: reason.value.trim(), ...body }), REFRESH)
      : await writeConfirmingBackdate((confirmBackdated) => ctx.store.actions.write((ws) => ctx.api.createGroupExpense(ws, confirmBackdated ? { ...body, confirmBackdated: true } : body, key), withLedger || linked ? REFRESH : ["group"]));
    modal.setBusy(false);
    if (!out.ok) {
      // BT-009-26: offline entry — only a NEW expense, only a genuine connectivity failure (never
      // something the server actually looked at and refused), and only on a device that explicitly
      // opted in. Kept with the exact same idempotency key it would have used online, so a sync
      // later can never create it twice.
      if (!editing && offline.isEnabled() && offline.shouldQueue(out.error)) {
        offline.enqueue({ wsId: state.selectedWorkspaceId, kind: "expense", body, idempotencyKey: key });
        announce("You're offline. This expense is saved on this device and will be sent once you're back online.");
        modal.close();
        return;
      }
      modal.setError(out.error); return;
    }
    announce(editing ? "Correction saved. The earlier values stay in the history." : "Shared expense added.");
    modal.close();
  }
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  return modal;
}

// ---- Itemized receipts (BT-009-25) ----------------------------------------------------------------
// "Allocate individual lines to selected participants; support quantities, shared lines, tax, tip,
// discounts and fees. Show any unallocated remainder and require the final allocation to reconcile
// exactly to the receipt total" (Terry, 2026-09-19; worked example in
// docs/BT-009-25-WORKED-EXAMPLES.md §2). A genuinely different entry point from the plain Add
// expense dialog, since the input shape (line items, not one value per person) is fundamentally
// different — never forced into the same five split methods' UI.
export function openItemizedExpenseModal(ctx, { expense = null, eventId = null } = {}) {
  const state = ctx.store.getState();
  const data = groupData(state);
  if (!data) { announce("Shared expenses are still loading. Try again in a moment."); void ctx.store.actions.refreshGroup(); return null; }
  const editing = !!expense;
  const currency = data.currency;
  const people = data.participants.filter((p) => p.active);
  const label = (p) => `${p.name}${p.self ? " (you)" : ""}`;
  const key = newIdempotencyKey();

  const description = input({ maxlength: "120", autocomplete: "off", required: true, placeholder: "For example: Grocery run", value: editing ? expense.description : "" });
  const date = input({ type: "date", value: editing ? expense.date : todayIso() });
  const categories = ((sliceFor(state, "categories").data || {}).categories || []).filter((c) => !c.archived && c.type !== "income");
  const category = pickerSelect([{ value: "", label: "No category" }].concat(categories.map((c) => ({ value: c.id, label: c.name }))), editing ? expense.categoryId || "" : "", {}, { badgeOf: categoryBadges(state) });
  const notes = el("textarea", { class: "field__input", maxlength: "2000", text: editing ? expense.notes : "" });
  const reason = input({ maxlength: "200", autocomplete: "off", placeholder: "Why is this being corrected?" });
  const total = input({ inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.00", value: editing ? expense.amount : "" });

  // Paid by (kept simple: a single payer — the common case for a receipt; multiple payers are
  // already fully supported by the plain Add expense dialog for whoever needs that).
  const paidByDefault = people.find((p) => p.self) || people[0];
  const paidBy = pickerSelect(people.map((p) => ({ value: p.ref, label: label(p) })), editing ? expense.payers[0].ref : (paidByDefault ? paidByDefault.ref : ""), {}, { search: false });

  const feeRow = (labelText) => {
    const box = input({ inputmode: "decimal", autocomplete: "off", placeholder: "0.00" });
    return { box, node: field(labelText, box) };
  };
  const tax = feeRow("Tax");
  const tip = feeRow("Tip");
  const discount = feeRow("Discount");
  const fee = feeRow("Other fee");
  if (editing && expense.itemization) {
    tax.box.value = expense.itemization.tax !== "0.00" ? expense.itemization.tax : "";
    tip.box.value = expense.itemization.tip !== "0.00" ? expense.itemization.tip : "";
    discount.box.value = expense.itemization.discount !== "0.00" ? expense.itemization.discount : "";
    fee.box.value = expense.itemization.fee !== "0.00" ? expense.itemization.fee : "";
  }

  const linesBox = el("div", { class: "stack" });
  const lineRows = [];
  function makeLineRow(preset = {}) {
    const desc = input({ maxlength: "120", autocomplete: "off", placeholder: "Item", value: preset.description || "" });
    const qty = input({ inputmode: "decimal", autocomplete: "off", placeholder: "1", value: preset.quantity !== undefined ? String(preset.quantity) : "1" });
    const price = input({ inputmode: "decimal", autocomplete: "off", placeholder: "0.00", value: preset.unitPrice || "" });
    const checked = new Set(preset.refs || (paidByDefault ? [paidByDefault.ref] : []));
    const boxes = people.map((p) => { const b = el("input", { type: "checkbox", id: uid("item-line-person") }); b.checked = checked.has(p.ref); return { p, b }; });
    const remove = button("Remove line", () => { linesBox.removeChild(row.row); lineRows.splice(lineRows.indexOf(row), 1); refresh(); }, { small: true, variant: "danger" });
    const row = {
      desc, qty, price, boxes,
      row: el("div", { class: "card item-line" }, [
        el("div", { class: "form-grid" }, [field("Item description", desc, { wide: true }), field("Quantity", qty), field("Unit price", price)]),
        el("div", { class: "row" }, [
          el("span", { class: "field__label", text: "Shared by:" }),
          ...boxes.map(({ p, b }) => el("span", { class: "field--inline" }, [b, el("label", { for: b.id, text: label(p) })])),
        ]),
        remove,
      ]),
    };
    for (const node of [desc, qty, price]) node.addEventListener("input", refresh);
    for (const { b } of boxes) b.addEventListener("change", refresh);
    lineRows.push(row);
    linesBox.appendChild(row.row);
    refresh();
  }

  const preview = el("div", { class: "split-preview", "aria-live": "polite" });
  const problems = el("ul", { class: "split-problems error-text", "aria-live": "polite" });
  let last = null;
  function refresh() {
    const totalMinor = parseAmount(total.value.trim(), currency);
    const itemLines = lineRows.map((r) => ({ description: r.desc.value.trim(), quantity: r.qty.value.trim(), unitPrice: r.price.value.trim(), refs: r.boxes.filter((x) => x.b.checked).map((x) => x.p.ref) }));
    const pv = previewItemization(itemLines, { tax: tax.box.value, tip: tip.box.value, discount: discount.box.value, fee: fee.box.value }, totalMinor, currency);
    last = { ...pv, totalMinor };
    const lines = [];
    if (totalMinor === null) lines.push("Enter the receipt total, more than zero.");
    else if (pv.unallocatedMinor > 0) lines.push(`${formatMinor(pv.unallocatedMinor, currency)} ${currency} of the ${formatMinor(totalMinor, currency)} ${currency} total is not yet allocated to any item, tax, tip, discount or fee.`);
    else if (pv.unallocatedMinor < 0) lines.push(`The items, tax, tip, discount and fee add up to ${formatMinor(pv.grandTotalMinor, currency)} ${currency}, more than the ${formatMinor(totalMinor, currency)} ${currency} total.`);
    else if (pv.perPerson.size) lines.push(`Reconciles exactly to ${formatMinor(totalMinor, currency)} ${currency}.`);
    mount(problems, ...[...pv.errors, ...lines].map((t) => el("li", { text: t })));
    mount(preview, pv.perPerson.size ? el("ul", { class: "stack" }, [...pv.perPerson.entries()].map(([ref, minor]) => {
      const p = people.find((x) => x.ref === ref);
      return el("li", { class: "row" }, [el("span", { text: p ? label(p) : "Someone" }), el("span", { class: "app__spacer" }), amountText(formatMinor(minor, currency), currency)]);
    })) : null);
  }
  total.addEventListener("input", refresh);
  for (const f of [tax, tip, discount, fee]) f.box.addEventListener("input", refresh);
  const addLine = button("Add item line", () => makeLineRow(), { small: true });

  if (editing && expense.itemization) for (const l of expense.itemization.lines) makeLineRow({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, refs: l.refs });
  else makeLineRow();

  const formId = `${editing ? "edit" : "add"}-itemized-form`;
  const save = el("button", { type: "submit", class: "btn btn--primary", text: editing ? "Save correction" : "Save expense", form: formId });
  const form = el("form", { class: "form-grid", novalidate: true, id: formId }, [
    field("Description", description, { wide: true }),
    field("Date", date), field("Category", category), field("Paid by", paidBy),
    field("Receipt total", total),
    el("fieldset", { class: "plain-fieldset field--wide" }, [el("legend", { class: "field__label", text: "Items" }), linesBox, addLine]),
    el("div", { class: "form-grid itemized-fees" }, [tax.node, tip.node, discount.node, fee.node]),
    preview, problems,
    el("details", { class: "more" }, [el("summary", { text: "Notes" }), field("Notes", notes, { wide: true })]),
    editing ? field("Reason for this correction", reason, { wide: true, help: "Required." }) : null,
  ]);
  const modal = openModal({ title: editing ? "Correct itemized receipt" : "Itemize a receipt", body: [form], actions: [button("Cancel", () => modal.close()), save] });
  async function submit() {
    modal.setError("");
    if (!description.value.trim()) { modal.setError("Describe the expense."); description.focus(); return; }
    if (editing && !reason.value.trim()) { modal.setError("Give a reason for this correction."); reason.focus(); return; }
    if (!last || !last.ok) { modal.setError((last && (last.errors[0] || "The allocation does not reconcile exactly to the receipt total.")) || "Enter the receipt total."); return; }
    const itemization = {
      lines: lineRows.map((r) => ({ description: r.desc.value.trim(), quantity: Number(r.qty.value.trim()), unitPriceMinor: parseAmount(r.price.value.trim(), currency), refs: r.boxes.filter((x) => x.b.checked).map((x) => x.p.ref) })),
      taxMinor: tax.box.value.trim() ? parseAmount(tax.box.value.trim(), currency) : 0,
      tipMinor: tip.box.value.trim() ? parseAmount(tip.box.value.trim(), currency) : 0,
      discountMinor: discount.box.value.trim() ? parseAmount(discount.box.value.trim(), currency) : 0,
      feeMinor: fee.box.value.trim() ? parseAmount(fee.box.value.trim(), currency) : 0,
    };
    const body = {
      description: description.value.trim(), date: date.value, notes: notes.value,
      categoryId: category.value || null,
      amount: formatMinor(last.totalMinor, currency),
      payers: [{ ref: paidBy.value }],
      itemization,
    };
    if (!editing && eventId) body.eventId = eventId;
    modal.setBusy(true);
    const out = editing
      ? await ctx.store.actions.write((ws) => ctx.api.updateGroupExpense(ws, { expenseId: expense.id, revision: expense.revision, reason: reason.value.trim(), ...body }), REFRESH)
      : await ctx.store.actions.write((ws) => ctx.api.createGroupExpense(ws, body, key), ["group"]);
    modal.setBusy(false);
    if (!out.ok) {
      // BT-009-26: offline entry — see the identical guard in openGroupExpense's own submit.
      if (!editing && offline.isEnabled() && offline.shouldQueue(out.error)) {
        offline.enqueue({ wsId: state.selectedWorkspaceId, kind: "expense", body, idempotencyKey: key });
        announce("You're offline. This expense is saved on this device and will be sent once you're back online.");
        modal.close();
        return;
      }
      modal.setError(out.error); return;
    }
    announce(editing ? "Correction saved." : "Itemized expense added.");
    modal.close();
  }
  save.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  refresh();
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
    if (!out.ok) {
      // BT-009-26: offline entry — see the identical guard in openGroupExpense's own submit.
      if (offline.isEnabled() && offline.shouldQueue(out.error)) {
        offline.enqueue({ wsId: state.selectedWorkspaceId, kind: "settlement", action: "settle", body, idempotencyKey: key });
        announce("You're offline. This payment is saved on this device and will be sent once you're back online.");
        modal.close();
        return;
      }
      modal.setError(out.error); return;
    }
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

// BT-009-25: a linked refund. The original expense is NEVER edited here — this creates a separate,
// linked record. Defaults to the original expense's own split (method + people); "explicitly
// reviewed adjustment" is just editing the same checkboxes/values before saving, exactly like
// editing a real split, with the same live "does it reconcile" preview and problems list.
function openRefundModal(ctx, e, data, nameOf) {
  const remainingMinor = e.amountMinor - (e.refundedMinor || 0);
  const amount = input({ inputmode: "decimal", autocomplete: "off", required: true, value: formatMinor(remainingMinor, e.currency) });
  const reason = input({ maxlength: "200", autocomplete: "off", required: true, placeholder: "Why is this being refunded?" });
  const method = pickerSelect(Object.entries(METHOD_LABELS).map(([value, text]) => ({ value, label: text })), e.split.method, {}, { search: false });
  const onExpense = new Set([...e.payers.map((p) => p.ref), ...e.shares.map((s) => s.ref)]);
  const people = data.participants.filter((p) => p.active || onExpense.has(p.ref));
  const values = new Map(e.split.lines.map((l) => [l.ref, l.value === null || l.value === undefined ? "" : String(l.value)]));
  const rows = people.map((p) => {
    const box = el("input", { type: "checkbox", id: uid("refund-line"), class: "split-row__box" });
    box.checked = values.has(p.ref);
    const val = input({ inputmode: "decimal", autocomplete: "off", value: values.get(p.ref) || "" });
    const out = el("span", { class: "num split-row__share" });
    return { p, box, val, out, row: el("div", { class: "split-row" }, [box, el("label", { for: box.id, text: nameOf(p.ref) }), val, out]) };
  });
  const rowsEl = el("div", { class: "split-list" }, rows.map((r) => r.row));
  const preview = el("div", { class: "split-preview", "aria-live": "polite" });
  const problems = el("ul", { class: "split-problems error-text", "aria-live": "polite" });
  let last = null;
  function snapshot() {
    return {
      amount: amount.value.trim(), currency: e.currency, method: method.value,
      payers: [{ ref: "single", name: "", amount: "" }],
      lines: rows.filter((r) => r.box.checked).map((r) => ({ ref: r.p.ref, name: r.p.name, value: r.val.value })),
    };
  }
  function refresh() {
    const m = method.value;
    for (const r of rows) {
      r.val.hidden = m === "equal" || !r.box.checked;
      r.val.setAttribute("aria-label", `${VALUE_LABELS[m] || "Value for"} ${r.p.name}`);
      r.val.setAttribute("placeholder", VALUE_HINTS[m] || "");
    }
    const pv = previewSplit(snapshot());
    last = pv;
    const shareOf = new Map(pv.shares.map((s) => [s.ref, s]));
    for (const r of rows) { const s = r.box.checked ? shareOf.get(r.p.ref) : null; r.out.textContent = s ? `${formatMinor(s.amountMinor, e.currency)} ${e.currency}` : ""; }
    mount(preview, pv.shares.length ? el("p", { class: "field__help", text: `The shares add up to exactly ${formatMinor(pv.totalMinor, e.currency)} ${e.currency}.` }) : null);
    mount(problems, ...pv.errors.map((t) => el("li", { text: t })));
  }
  commitOnConfirm(method, refresh);
  amount.addEventListener("input", refresh);
  for (const r of rows) { r.box.addEventListener("change", refresh); r.val.addEventListener("input", refresh); }
  const form = el("form", { class: "form-grid", novalidate: true, id: "refund-form" }, [
    field("Amount", amount, { help: `Up to ${formatMinor(remainingMinor, e.currency)} ${e.currency} remaining to refund on this expense.` }),
    el("fieldset", { class: "plain-fieldset field--wide" }, [
      el("legend", { class: "field__label", text: "Allocated to" }),
      field("Split", method), rowsEl, preview, problems,
    ]),
    field("Reason", reason, { wide: true, help: "Required. Kept with the expense's history." }),
  ]);
  const save = el("button", { type: "submit", class: "btn btn--primary", text: "Record refund", form: "refund-form" });
  const modal = openModal({ title: `Refund "${e.description}"`, body: [form], actions: [button("Cancel", () => modal.close()), save] });
  refresh();
  async function submit() {
    modal.setError("");
    if (!reason.value.trim()) { modal.setError("Give a reason for this refund."); reason.focus(); return; }
    if (!last.ok) { modal.setError(last.errors[0]); return; }
    const lineBody = (l) => {
      if (method.value === "equal") return { ref: l.ref };
      if (method.value === "shares") return { ref: l.ref, value: Number(String(l.value).trim()) };
      if (method.value === "percentages") return { ref: l.ref, value: String(l.value).trim() };
      if (method.value === "fixed-remainder" && String(l.value ?? "").trim() === "") return { ref: l.ref };
      return { ref: l.ref, value: formatMinor(parseAmount(l.value, e.currency), e.currency) };
    };
    const snap = snapshot();
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => ctx.api.createRefund(ws, {
      expenseId: e.id, amount: formatMinor(last.totalMinor, e.currency), reason: reason.value.trim(),
      split: { method: method.value, lines: snap.lines.map(lineBody) },
    }), REFRESH);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(`Refund of ${formatMinor(last.totalMinor, e.currency)} ${e.currency} recorded.`);
    modal.close();
  }
  save.addEventListener("click", (ev) => { ev.preventDefault(); void submit(); });
  form.addEventListener("submit", (ev) => { ev.preventDefault(); void submit(); });
  return modal;
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
