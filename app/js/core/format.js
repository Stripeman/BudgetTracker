// Display formatting only. Amounts arrive from the server as exact decimal strings in the
// currency's precision; they are formatted as strings and never converted to binary floating
// point, so a display can never disagree with the stored integer amount.

const GROUP = { "1,234.56": [",", "."], "1.234,56": [".", ","], "1 234,56": [" ", ","] };

export function formatAmount(decimal, currency, { numberFormat = "1,234.56", masked = false, signed = true } = {}) {
  if (masked) return `${currency} ••••`;
  const text = String(decimal || "0");
  const negative = text.startsWith("-");
  const [whole, frac] = text.replace(/^-/, "").split(".");
  const [groupSep, decimalSep] = GROUP[numberFormat] || GROUP["1,234.56"];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
  const body = frac !== undefined ? `${grouped}${decimalSep}${frac}` : grouped;
  const sign = negative ? "−" : "";
  return `${signed ? sign : ""}${currency} ${body}`;
}

export function isNegative(decimal) { return String(decimal || "").startsWith("-"); }

export function formatDate(iso, dateFormat = "iso") {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  if (dateFormat === "dmy") return `${d}/${m}/${y}`;
  if (dateFormat === "mdy") return `${m}/${d}/${y}`;
  return `${y}-${m}-${d}`;
}

export function todayIso(now = new Date()) {
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

// The server's own calendar day (api/_shared/runtime.js `nowIso`, always UTC — `new
// Date(...).toISOString()`). Bug fix (2026-09-23, Terry's second report of the same symptom as
// BT-026 — "select EnBW from the Merchant dropdown and click Save changes. The merchant does not
// persist" — after the BT-026 fix already covered the far-future-`nextDue` case): a bill's "changes
// take effect from" default (and the identical default in the Merchants page's own "Add merchant"
// quick-link, `linkBillToMerchant`) used `todayIso()` — the BROWSER's own local calendar day. For
// roughly 1–3 hours near local midnight (whenever the browser's timezone is AHEAD of UTC — Terry's
// own machine is `W. Europe Standard Time`, UTC+1/+2), the local calendar day has already rolled
// to tomorrow while the server's UTC calendar day has not: the submitted `effectiveFrom` is then
// LATER than the server's own idea of "today", so `termsAt` (api/_shared/bills.js — "the version
// effective on `date`, not after it") never selects the just-written version. The write genuinely
// succeeds server-side; the bill's CURRENT view (the All-bills list, and a freshly reopened Edit
// dialog) stays exactly as it was until the server's own UTC date catches up — indistinguishable
// from "nothing saved", the exact symptom reported. Every OTHER `todayIso()` default in this app
// (a new bill's own start date, recording a payment's date, closing a merchant, an end date, ...)
// is a plain user-facing entry default with no server-side "is this in effect right now" comparison
// behind it, and correctly stays the viewer's own local calendar day — only the two term-effective-
// date defaults that are compared against the server's UTC `termsAt` need this.
export function todayIsoUTC(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// The viewer's own local calendar, same technique as todayIso above (Dashboard weekly/monthly
// widgets, BT-014-14). Weeks start Monday, a plain default — there is no "week starts on" setting.
export function startOfWeekIso(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  const dayIndex = (local.getUTCDay() + 6) % 7; // 0 = Monday .. 6 = Sunday
  local.setUTCDate(local.getUTCDate() - dayIndex);
  return local.toISOString().slice(0, 10);
}

export function startOfMonthIso(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  local.setUTCDate(1);
  return local.toISOString().slice(0, 10);
}

export const ACCOUNT_TYPE_LABELS = Object.freeze({
  checking: "Checking", savings: "Savings", cash: "Cash", "credit-card": "Credit card", loan: "Loan", mortgage: "Mortgage",
  "merchant-credit": "Merchant credit", investment: "Investment", "other-asset": "Other asset", "other-liability": "Other liability",
});

// Bill types (BT-008-02); the ids match api/_shared/bills.js BILL_TYPES.
export const BILL_TYPE_LABELS = Object.freeze({
  housing: "Rent or mortgage", utilities: "Utilities", subscription: "Subscription", insurance: "Insurance",
  "debt-payment": "Loan or debt payment", membership: "Membership", income: "Payroll or income", savings: "Savings transfer", custom: "Other",
});

// Merchant types (BT-007-01); the ids match api/_shared/merchants.js MERCHANT_TYPES.
export const MERCHANT_TYPE_LABELS = Object.freeze({
  retailer: "Retailer", grocery: "Grocery", restaurant: "Restaurant or café", utility: "Utility", housing: "Landlord or housing",
  employer: "Employer", bank: "Bank or lender", insurer: "Insurer", subscription: "Subscription service", transport: "Transport",
  health: "Health", government: "Government", person: "Person", other: "Other",
});

export const KIND_LABELS = Object.freeze({
  expense: "Expense", income: "Income", transfer: "Transfer", refund: "Refund", fee: "Fee",
  reimbursement: "Reimbursement received", advance: "Advance (lent)", adjustment: "Adjustment", interest: "Interest",
  // Shared expenses (BT-009): a share of an expense someone else paid (owed, no money moved yet) and a
  // repayment made to someone who paid for you. Neither is spending or income.
  payable: "Owed to others", repayment: "Repayment made",
});
