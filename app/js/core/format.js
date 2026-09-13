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

export const ACCOUNT_TYPE_LABELS = Object.freeze({
  checking: "Checking", savings: "Savings", cash: "Cash", "credit-card": "Credit card", loan: "Loan", mortgage: "Mortgage",
  "merchant-credit": "Merchant credit", investment: "Investment", "other-asset": "Other asset", "other-liability": "Other liability",
});

export const KIND_LABELS = Object.freeze({
  expense: "Expense", income: "Income", transfer: "Transfer", refund: "Refund", fee: "Fee",
  reimbursement: "Reimbursement received", advance: "Advance (lent)", adjustment: "Adjustment", interest: "Interest",
});
