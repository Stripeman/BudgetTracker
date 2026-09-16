import { el, svgEl, announce } from "../dom.js";
import { field, input, pickerSelect, button, money, categoryLabel, amountWithDirection } from "../components.js";
import { withIcon } from "../icons.js";
import { openModal } from "../modal.js";
import { createDayNightControl } from "../daynight.js";
import { lineChart } from "./analytics.js";
import { AUTH, newIdempotencyKey } from "../../core/api.js";
import { messageFor } from "../../core/errors.js";

// ---- the unauthenticated sign-in page (Terry, 2026-09-16 design brief) -------------------------
//
// A two-panel layout: brand, value statement, the Google sign-in (route unchanged: AUTH.login),
// privacy assurances and the reused day/night control on the left; an illustrative preview of what
// BudgetTracker manages on the right, built ONLY from the local PREVIEW constant below — it must
// never fetch anything private, and never require authentication. The one exception is the
// footer's version/channel, read from the PUBLIC, deliberately unauthenticated `GET /api/site-
// settings` (already exposed for exactly this verification purpose — see PROJECT_STATE.md
// "PRODUCTION DEPLOYED"); it fails silently, leaving the generic "BudgetTracker" label, since
// nothing on this page may depend on a network call succeeding.
//
// No inline `style`: the CSP forbids it. Colours reach the DOM only through CSS classes or the
// CSSOM (`vars`), exactly like every other view.

const PREVIEW_CURRENCY = "USD";
// A stand-in for the real preferences object `money()`/`amountWithDirection()` read (number format,
// masking); the preview never has a signed-in person's preferences, so it uses the built-in defaults.
const PREVIEW_PREFS = Object.freeze({ effective: {} });

// Fictional, obviously synthetic data only (never fetched) — matches the "Fictional" seed
// convention in scripts/dev/seed.mjs. Every figure here is illustrative, not a real record.
const PREVIEW = Object.freeze({
  budget: { name: "Fictional Groceries", icon: "cart", color: "#f59e0b", spent: "412.50", limit: "500.00" },
  moneyIn: Object.freeze({ kind: "income", amount: "3200.00", amountMinor: 320000, currency: PREVIEW_CURRENCY }),
  moneyOut: Object.freeze({ kind: "expense", amount: "-186.40", amountMinor: -18640, currency: PREVIEW_CURRENCY }),
  categories: [
    { name: "Fictional Groceries", color: "#f59e0b", icon: "cart", amount: "-412.50" },
    { name: "Fictional Dining", color: "#ef4444", icon: "utensils", amount: "-96.20" },
    { name: "Fictional Transport", color: "#3b82f6", icon: "car", amount: "-64.10" },
  ],
  forecast: [1800, 2100, 1950, 2400, 2650, 2300, 3120].map((count, i) => ({ date: `Day ${i * 5 + 1}`, count })),
  forecastStart: "1,800.00", forecastEnd: "3,120.00",
  trip: { name: "Fictional Lisbon Trip", who: "Fictional Dana", owed: Object.freeze({ kind: "payable", amount: "42.00", amountMinor: 4200, currency: PREVIEW_CURRENCY }) },
  bill: { name: "Fictional Streaming Plan", dueInDays: 3 },
});

function previewMeter(spent, limit) {
  const pct = Number(limit) > 0 ? Math.min(999, (Number(spent) / Number(limit)) * 100) : 0;
  return el("div", { class: "meter", "aria-hidden": "true" }, [
    el("div", { class: ["meter__fill", pct > 100 ? "meter__fill--over" : ""], vars: { "--fill": `${pct.toFixed(0)}%` } }),
  ]);
}

function previewWidget(children) {
  return el("div", { class: "login__widget" }, children);
}

function previewBudget() {
  const b = PREVIEW.budget;
  return previewWidget([
    el("p", { class: "card__title" }, [categoryLabel(b.name, b.color, b.icon)]),
    previewMeter(b.spent, b.limit),
    el("p", { class: "card__meta", text: `${PREVIEW_CURRENCY} ${b.spent} of ${b.limit} this month (fictional data).` }),
  ]);
}

function previewFlow() {
  return previewWidget([
    el("p", { class: "card__title", text: "This month" }),
    el("div", { class: "row" }, [el("span", { class: "muted small", text: "Income" }), amountWithDirection(PREVIEW.moneyIn, PREVIEW_PREFS)]),
    el("div", { class: "row" }, [el("span", { class: "muted small", text: "Spending" }), amountWithDirection(PREVIEW.moneyOut, PREVIEW_PREFS)]),
  ]);
}

function previewCategories() {
  return previewWidget([
    el("p", { class: "card__title", text: "Spending by category" }),
    el("ul", { class: "stack" }, PREVIEW.categories.map((c) => el("li", { class: "row" }, [categoryLabel(c.name, c.color, c.icon), money(c.amount, PREVIEW_CURRENCY, PREVIEW_PREFS)]))),
  ]);
}

function previewForecast() {
  return previewWidget([
    el("p", { class: "card__title" }, [withIcon("chart-line", "Cash-flow forecast")]),
    lineChart(PREVIEW.forecast, { width: 260, height: 64 }),
    el("p", { class: "card__meta", text: `Projected balance: ${PREVIEW.forecastStart} → ${PREVIEW.forecastEnd} ${PREVIEW_CURRENCY} over the next 30 days (fictional).` }),
  ]);
}

function previewTrip() {
  const t = PREVIEW.trip;
  return previewWidget([
    el("p", { class: "card__title" }, [withIcon("suitcase", t.name)]),
    el("div", { class: "row" }, [el("span", { text: `${t.who} owes you` }), amountWithDirection(t.owed, PREVIEW_PREFS)]),
  ]);
}

function previewBill() {
  const b = PREVIEW.bill;
  return previewWidget([el("p", {}, [withIcon("repeat", `${b.name} — due in ${b.dueInDays} days`)])]);
}

// Illustrative only: never fetches, never requires sign-in (Terry's brief). Marked as a landmark
// with its own accessible name so it is announced once and skipped as a whole by anyone who wants
// only the sign-in content; its own drawings (icons, the chart) are already decorative (aria-hidden).
function renderPreviewPanel() {
  return el("aside", { class: "login__panel login__panel--preview", "aria-label": "Illustrative preview of BudgetTracker, with fictional data" }, [
    el("p", { class: "login__previewlabel", text: "Illustrative preview — fictional data" }),
    el("div", { class: "login__previewgrid" }, [previewBudget(), previewFlow(), previewCategories(), previewForecast(), previewTrip(), previewBill()]),
  ]);
}

// The Google "G" mark (the officially published four-colour glyph), drawn with svgEl — never raw
// markup — so it stays inside the same XSS-safe convention as every other icon in the app. Fixed
// brand colours, not the app's accent: Google's sign-in button is not re-themed (its guidelines).
function googleMark() {
  const svg = svgEl("svg", { class: "login__googlemark", viewBox: "0 0 18 18", "aria-hidden": "true", focusable: "false" });
  const PATHS = [
    ["#4285F4", "M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.8741 2.6836-6.615z"],
    ["#34A853", "M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.5401-1.8368.8591-3.0477.8591-2.3436 0-4.3282-1.5831-5.036-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"],
    ["#FBBC05", "M3.964 10.71c-.18-.5401-.2822-1.1168-.2822-1.71s.1023-1.1699.2822-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.964 10.71z"],
    ["#EA4335", "M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6564 3.5795 9 3.5795z"],
  ];
  for (const [fill, d] of PATHS) svg.appendChild(svgEl("path", { fill, d }));
  return svg;
}

// Unchanged behaviour (Terry: "retain the existing secure authentication route and redirect
// handling"): a real link to AUTH.login("/"), the same href the old plain button used.
function googleSignInButton() {
  return el("a", { class: "btn login__google", href: AUTH.login("/") }, [googleMark(), el("span", { text: "Sign in with Google" })]);
}

const PRIVACY_POINTS = [
  "Financial records are private by default.",
  "Sharing is explicit and controlled by you.",
  "Site administrators cannot browse private financial records.",
];

// `theme`: the canonical controller (main.js's `browserThemeController`), so the reused day/night
// control (BT-011-01) changes the SAME state the rest of the app reads — no second theme model.
// `api`: optional; when given, used only to read the public app version/channel for the footer.
export function renderLanding({ theme = null, api = null } = {}) {
  // Not unsubscribed: the page is replaced whole (a fresh sign-in navigation, or shell.js rebuilding
  // this view on the next render) rather than incrementally torn down, the same as the account
  // menu's day/night control in shell.js.
  const dayNight = theme ? createDayNightControl({ theme }) : null;
  if (dayNight) theme.subscribe(() => dayNight.refresh());

  const versionText = el("span", { text: "BudgetTracker" });
  const envBadge = el("span", { class: "badge badge--env" });
  envBadge.hidden = true;
  if (api && typeof api.siteSettings === "function") {
    api.siteSettings().then((res) => {
      const app = res && res.app;
      if (!app) return;
      versionText.textContent = `BudgetTracker ${app.version || ""}`.trim();
      if (app.environment) { envBadge.textContent = app.environment; envBadge.hidden = false; }
    }).catch(() => { /* the footer stays generic; nothing on this page depends on a network call */ });
  }

  const brand = el("section", { class: "login__panel login__panel--brand" }, [
    el("div", { class: "login__brandrow" }, [
      el("img", { src: "/favicon.svg", alt: "", width: "40", height: "40", class: "login__logo" }),
      el("span", { class: "login__brandname", text: "BudgetTracker" }),
    ]),
    el("h1", { class: "login__heading", text: "Know where your money is going." }),
    el("p", { class: "login__lede", text: "Plan budgets, track bills and debt, forecast cash flow, and split shared expenses—without giving administrators access to your private finances." }),
    googleSignInButton(),
    el("ul", { class: "login__points" }, PRIVACY_POINTS.map((text) => el("li", {}, [withIcon("shield", text)]))),
    dayNight ? el("div", { class: "login__appearance" }, [el("p", { class: "menu__heading", text: "Appearance" }), dayNight.element]) : null,
    el("footer", { class: "login__foot" }, [versionText, envBadge]),
  ]);

  return el("main", { class: "login", id: "main", tabindex: "-1" }, [brand, renderPreviewPanel()]);
}

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "CAD", "AUD", "NZD", "JPY", "SGD", "HKD", "INR", "ZAR"];
const KINDS = [{ value: "personal", label: "Personal" }, { value: "household", label: "Household" }, { value: "group", label: "Shared-expense group" }, { value: "trip", label: "Trip" }];

// The fields of a new workspace, shared by the first-workspace page and the "New workspace…"
// dialog, so both ask the same questions the same way. The dropdowns are TaskTracker's command
// picker (BT-004-05): Kind is a short fixed list, so it has no search box; currencies are searched.
function workspaceFields({ kind = "household", placeholder = "For example: Our household" } = {}) {
  const name = input({ required: true, maxlength: "80", placeholder });
  const kindSelect = pickerSelect(KINDS, kind, {}, { search: false });
  const currency = pickerSelect(CURRENCIES.map((c) => ({ value: c, label: c })), "EUR");
  return {
    name,
    controls: [field("Name", name), field("Kind", kindSelect), field("Reporting currency", currency)],
    values: () => ({ name: name.value.trim(), kind: kindSelect.value, reportingCurrency: currency.value }),
  };
}

export function createOnboarding({ store }) {
  const f = workspaceFields();
  const error = el("p", { class: "error-text", role: "alert" });
  const key = newIdempotencyKey();
  const create = button("Create workspace", async () => {
    error.textContent = "";
    create.disabled = true;
    try {
      await store.actions.createWorkspace(f.values(), key);
    } catch (err) {
      error.textContent = messageFor(err);
    } finally { create.disabled = false; }
  }, { variant: "primary" });
  const element = el("section", { class: "landing" }, [
    el("h1", { text: "Create your first workspace" }),
    el("p", { class: "muted", text: "A workspace holds accounts and budgets. You can keep it personal or invite others later; private accounts stay private either way." }),
    el("p", { class: "notice", text: "Were you invited to someone's workspace? Open the invitation link you were sent — it works only for the Google account it was sent to. Site administrators do not see anyone's finances." }),
    el("div", { class: "stack" }, [...f.controls, error, create]),
  ]);
  return { element, update() {} };
}

// Another workspace keeps its own accounts, entries, budgets and members apart — a trip, a side
// business or a shared group. Opened from the account menu at any time; the new workspace becomes
// the current one. One idempotency key per opening, so a double click creates one workspace.
// `name` pre-fills the name, when the workspace picker's "+ New workspace “…”" carries what was
// typed into its search box (BT-004-04).
export function openNewWorkspace({ store, name = "" }) {
  const f = workspaceFields({ kind: "personal", placeholder: "For example: Side business" });
  if (typeof name === "string" && name.trim()) f.name.value = name.trim().slice(0, 80);
  const key = newIdempotencyKey();
  const formId = `new-workspace-${key}`;
  // The footer button belongs to the form, so Enter in a field creates the workspace (UX2-006).
  const create = el("button", { type: "submit", class: "btn btn--primary", text: "Create workspace", form: formId });
  const form = el("form", { class: "form-grid", novalidate: true, id: formId }, f.controls);
  const modal = openModal({
    title: "New workspace",
    body: [
      el("p", { class: "muted", text: "A separate place for accounts, entries and budgets you want to track apart — for example a trip, a side business or a shared group. Nothing moves between workspaces; switch between them at the top of the page." }),
      form,
    ],
    actions: [button("Cancel", () => modal.close()), create],
  });
  async function submit() {
    modal.setError("");
    const values = f.values();
    if (!values.name) {
      f.name.setAttribute("aria-invalid", "true");
      f.name.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Give the workspace a name.");
      f.name.focus();
      return;
    }
    f.name.removeAttribute("aria-invalid");
    modal.setBusy(true);
    try {
      const workspace = await store.actions.createWorkspace(values, key);
      modal.close();
      announce(`${workspace.name} created. You are now in it.`);
    } catch (err) {
      modal.setBusy(false);
      modal.setError(err);
    }
  }
  create.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  return modal;
}
