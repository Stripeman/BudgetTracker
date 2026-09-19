// BT-013 Design Gallery — ONE canonical set of FICTIONAL view-model data, shared by every one of the
// 20 layout concepts and every required page. This is deliberately the same shape (and much of the
// same content) as scripts/dev/seed.mjs's fictional household: real account/category/merchant names
// carrying "Fictional" only where the seed itself does not already make that obvious, never a real
// person, institution or amount. Nothing here is fetched from any API — the Gallery never calls a
// workspace route, so it can never expose a real workspace's data (BT-013 hard boundary).
//
// This is what makes the Gallery a proof of the REUSABLE composition system rather than 20 separate
// mockups: every concept renders the exact same data through the exact same shared components
// (money, categoryLabel, icon, badge — all from app/js/ui/components.js and icons.js), only the
// composition (nav, density, dashboard pattern, card style) differs per concept.
const PREFS = Object.freeze({ effective: {} });

export const prefs = PREFS;

export const accounts = Object.freeze([
  { id: "acc-joint", name: "Joint Checking", type: "checking", icon: "bank", balance: "3412.55", currency: "EUR", access: "shared" },
  { id: "acc-card", name: "Household Card", type: "credit-card", icon: "credit-card", balance: "-482.10", currency: "EUR", access: "shared" },
  { id: "acc-savings", name: "Alice Savings", type: "savings", icon: "piggy-bank", balance: "8420.00", currency: "EUR", access: "private" },
  { id: "acc-loan", name: "Car Loan", type: "loan", icon: "loan", balance: "-11480.00", currency: "EUR", access: "private" },
]);

export const netPosition = Object.freeze({
  currency: "EUR", amount: "11350.45",
  breakdown: { own: "8420.00", shared: "2930.45", granted: "0.00" },
});

export const categories = Object.freeze([
  { id: "cat-groceries", name: "Groceries", color: "#0e8478", icon: "cart" },
  { id: "cat-dining", name: "Dining", color: "#b45309", icon: "utensils" },
  { id: "cat-transport", name: "Transport", color: "#2563eb", icon: "car" },
  { id: "cat-utilities", name: "Utilities", color: "#52607a", icon: "bolt" },
  { id: "cat-entertainment", name: "Entertainment", color: "#d73753", icon: "film" },
  { id: "cat-housing", name: "Housing", color: "#077352", icon: "home" },
]);

export const merchants = Object.freeze([
  { id: "m-grocer", name: "Fictional Grocer", icon: "cart" },
  { id: "m-cafe", name: "Corner Cafe", icon: "coffee" },
  { id: "m-transit", name: "City Transit", icon: "train" },
  { id: "m-power", name: "Power and Light Co", icon: "bolt" },
  { id: "m-stream", name: "Streaming Service", icon: "film" },
  { id: "m-landlord", name: "Fictional Landlord", icon: "home" },
]);

export const transactions = Object.freeze([
  { id: "t1", date: "2026-09-14", payee: "m-grocer", category: "cat-groceries", account: "acc-joint", amount: "-73.20", person: "Alice" },
  { id: "t2", date: "2026-09-13", payee: "m-cafe", category: "cat-dining", account: "acc-card", amount: "-4.50", person: "Bob" },
  { id: "t3", date: "2026-09-12", payee: "m-transit", category: "cat-transport", account: "acc-joint", amount: "-49.00", person: "Alice" },
  { id: "t4", date: "2026-09-10", payee: null, category: null, account: "acc-joint", amount: "3150.00", person: "Alice", label: "Salary" },
  { id: "t5", date: "2026-09-08", payee: "m-power", category: "cat-utilities", account: "acc-joint", amount: "-96.40", person: "Alice" },
  { id: "t6", date: "2026-09-06", payee: "m-stream", category: "cat-entertainment", account: "acc-card", amount: "-11.99", person: "Bob" },
  { id: "t7", date: "2026-09-05", payee: "m-grocer", category: "cat-groceries", account: "acc-joint", amount: "-58.75", person: "Bob" },
  { id: "t8", date: "2026-09-02", payee: "m-cafe", category: "cat-dining", account: "acc-card", amount: "-12.80", person: "Alice" },
]);

export const bills = Object.freeze([
  { id: "b1", name: "Rent", icon: "home", amount: "1250.00", currency: "EUR", dueDate: "2026-09-01", status: "overdue", account: "acc-joint" },
  { id: "b2", name: "Electricity", icon: "bolt", amount: "95.00", currency: "EUR", dueDate: "2026-09-16", status: "due-soon", account: "acc-joint" },
  { id: "b3", name: "Streaming", icon: "film", amount: "11.99", currency: "EUR", dueDate: "2026-09-20", status: "upcoming", account: "acc-card" },
  { id: "b4", name: "Salary", icon: "briefcase", amount: "3150.00", currency: "EUR", dueDate: "2026-09-25", status: "upcoming", kind: "income", account: "acc-joint" },
  { id: "b5", name: "Phone", icon: "phone", amount: "35.00", currency: "EUR", dueDate: "2026-09-29", status: "upcoming", account: "acc-joint" },
]);

export const budget = Object.freeze({
  currency: "EUR",
  lines: [
    { category: "cat-groceries", planned: "450.00", spent: "314.20", available: "135.80" },
    { category: "cat-dining", planned: "120.00", spent: "92.10", available: "27.90" },
    { category: "cat-utilities", planned: "180.00", spent: "191.40", available: "-11.40" },
    { category: "cat-transport", planned: "100.00", spent: "49.00", available: "51.00" },
    { category: "cat-entertainment", planned: "40.00", spent: "11.99", available: "28.01" },
  ],
});

export const forecast = Object.freeze({
  horizon: "30",
  warnings: ["Household Card may go over its limit around 24 Sep if Streaming and Phone are both paid before Salary arrives."],
  points: [
    { date: "2026-09-16", expected: "3020.00", cautious: "2860.00", hopeful: "3120.00" },
    { date: "2026-09-23", expected: "2610.00", cautious: "2310.00", hopeful: "2780.00" },
    { date: "2026-09-30", expected: "4890.00", cautious: "4520.00", hopeful: "5030.00" },
    { date: "2026-10-07", expected: "4540.00", cautious: "4100.00", hopeful: "4720.00" },
  ],
});

// Shared expenses (BT-009's canonical shape, simplified for the Gallery): a household's shared
// balances and its most recent expenses, matching scripts/dev/seed.mjs's Fictional Dinner Club.
// `events` (added 2026-09-19, reflecting the now-real BT-009-20 event foundation shipped in the
// application itself): every expense belongs to a named event with a real lifecycle status, exactly
// like the production Shared expenses page's own Events card — never a Gallery-only invention.
export const shared = Object.freeze({
  currency: "EUR",
  balances: [
    { name: "You (Alice)", net: "35.00", self: true },
    { name: "Bob", net: "-15.00", self: false },
    { name: "Dana (contact)", net: "-20.00", self: false },
  ],
  events: [
    { id: "gev1", name: "General", status: "active", isDefault: true },
    { id: "gev2", name: "Museum day", status: "closed", isDefault: false },
  ],
  expenses: [
    { id: "g1", description: "Dinner at the harbour", date: "2026-09-11", amount: "300.00", payer: "Alice", eventId: "gev1" },
    { id: "g2", description: "Taxi back", date: "2026-09-11", amount: "36.00", payer: "Bob", eventId: "gev1" },
    { id: "g3", description: "Museum tickets", date: "2026-09-13", amount: "100.00", payer: "Alice", eventId: "gev2" },
  ],
});

// Trips (BT-010 is Planned, not yet built as a real feature): illustrative-only fictional data so
// every concept can still show a coherent Trips page for this review, clearly not backed by any real
// route today.
export const trips = Object.freeze([
  { id: "tr1", name: "Lisbon long weekend", icon: "suitcase", dateRange: "3–06 Oct 2026", budget: "800.00", spent: "310.40", currency: "EUR", participants: ["Alice", "Bob", "Dana"] },
  { id: "tr2", name: "Ski week", icon: "suitcase", dateRange: "12–19 Jan 2027", budget: "2200.00", spent: "0.00", currency: "EUR", participants: ["Alice", "Bob"] },
]);

// A small representative slice of the real workspace settings shape (api/_shared/workspace-settings.js),
// for the Settings page preview only — never a live settings call.
export const settingsSample = Object.freeze([
  { key: "sharedExpenses", label: "Use Shared expenses in this workspace", value: true, type: "boolean" },
  { key: "layoutId", label: "Layout theme", value: "classic", type: "choice", options: [{ value: "classic", label: "Classic (current)" }] },
  { key: "memberEditsOthers", label: "Which entries a member may correct on shared accounts", value: "own", type: "choice", options: [{ value: "own", label: "Only entries they added" }, { value: "any", label: "Any entry" }] },
  { key: "budgetPeriod", label: "Budget period for new budgets", value: "monthly", type: "choice", options: [{ value: "monthly", label: "Monthly" }, { value: "weekly", label: "Weekly" }] },
]);

export const alerts = Object.freeze([
  { icon: "alert", text: "1 overdue bill payment — review and record or skip." },
  { icon: "clock", text: "1 bill payment due soon" },
  { icon: "chart-line", text: forecast.warnings[0] },
]);

export const categoryById = new Map(categories.map((c) => [c.id, c]));
export const merchantById = new Map(merchants.map((m) => [m.id, m]));
export const accountById = new Map(accounts.map((a) => [a.id, a]));
