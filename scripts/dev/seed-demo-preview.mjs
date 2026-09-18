// Seeds (or safely reports on) exactly ONE fictional DEMO workspace in PREVIEW, owned by a real,
// verified identity supplied at runtime (Terry, docs/Claude-handoff.md item 3). This is an
// operator script, not part of the deployed application: it calls the SAME real route handlers
// used by the live API (api/_shared/runtime.js's invoke(), exactly like api/test/helpers.js's
// harness() and scripts/dev/seed.mjs already do), but points storage directly at Preview's real
// Azure Blob container using an operator-supplied connection string — the same kind of
// infrastructure-level access scripts/recovery/drill.cjs already uses for backup drills. It never
// goes through the deployed HTTPS endpoint's Google sign-in (this is a trusted backend operation,
// not a forged browser session), but every business rule, validation and authorization check the
// real API enforces still runs, because these are the real handlers.
//
// SAFETY (read before running):
//   - Refuses unless the connection string's AccountName starts with "stbudgetpv" (Preview's data
//     account; Production is "stbudgetprd01" — a completely different name, by design).
//   - Refuses unless a live GET to <site>/api/site-settings reports environment "preview".
//   - Never invents an identity: the owner's real provider subject and email must be supplied by
//     the caller (environment variables), never hardcoded or guessed.
//   - Idempotent by default: if a workspace literally named "DEMO" already owned by this subject
//     exists, it is reported and left untouched — never duplicated, never silently overwritten.
//     Pass --reset to permanently delete that exact workspace first (using the app's own tested,
//     audited permanent-deletion flow — never a raw storage wipe) and reseed fresh.
//   - Every person, merchant, account, entry and amount below is fictional. No real invitation or
//     notification is sent to anyone; the two "guest" participants are private CONTACTS (BT-009),
//     which never have application access — never invented signed-in members.
//
// Required environment variables (never pass these on a shared shell history; use a local .env
// sourced just for this one run, and never commit it):
//   BT_DEMO_STORAGE_CONNECTION_STRING   Preview's BT_STORAGE_CONNECTION_STRING app setting
//   BT_DEMO_OWNER_SUBJECT               the real "<provider>:<providerUserId>" (e.g. google:123...)
//   BT_DEMO_OWNER_EMAIL                 the real, verified email for that subject
//   BT_DEMO_SITE_URL                    the Preview hostname, e.g. https://…-preview…azurestaticapps.net
// Optional: BT_DEMO_OWNER_NAME, BT_DEMO_DATA_CONTAINER (default "data").
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { invoke } = require(path.join(ROOT, "api/_shared/runtime.js"));
const { createBlobStorage } = require(path.join(ROOT, "api/_shared/storage.js"));
const { ROUTES } = require(path.join(ROOT, "api/_shared/routes.js"));
const { readDocument } = require(path.join(ROOT, "api/_shared/schema.js"));

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Refusing to run: missing required environment variable ${name}. See the comment at the top of this script.`); process.exit(2); }
  return v;
}

const CONN = need("BT_DEMO_STORAGE_CONNECTION_STRING");
const CONTAINER = process.env.BT_DEMO_DATA_CONTAINER || "data";
const SUBJECT = need("BT_DEMO_OWNER_SUBJECT");
const OWNER_EMAIL = need("BT_DEMO_OWNER_EMAIL");
const OWNER_NAME = process.env.BT_DEMO_OWNER_NAME || "";
const SITE_URL = need("BT_DEMO_SITE_URL").replace(/\/$/, "");
const RESET = process.argv.includes("--reset");

const accountName = (/AccountName=([^;]+)/.exec(CONN) || [])[1] || "";
if (!/^stbudgetpv/i.test(accountName)) {
  console.error(`Refusing: the storage account in BT_DEMO_STORAGE_CONNECTION_STRING is "${accountName}", which does not look like a Preview data account (expected a name starting "stbudgetpv"). Never seed Production.`);
  process.exit(2);
}

const providerMatch = /^([a-z]+):(.+)$/i.exec(SUBJECT);
if (!providerMatch) { console.error(`BT_DEMO_OWNER_SUBJECT must look like "provider:id" (e.g. google:1234567890...), got ${JSON.stringify(SUBJECT)}.`); process.exit(2); }
const [, PROVIDER, USER_ID] = providerMatch;

async function verifyPreview() {
  const res = await fetch(`${SITE_URL}/api/site-settings`);
  if (!res.ok) { console.error(`Refusing: GET ${SITE_URL}/api/site-settings returned ${res.status}.`); process.exit(2); }
  const body = await res.json();
  const env = body && body.app && body.app.environment;
  if (env !== "preview") { console.error(`Refusing: ${SITE_URL}/api/site-settings reports environment ${JSON.stringify(env)}, not "preview". Never seed Production.`); process.exit(2); }
  console.log(`Verified live: ${SITE_URL} reports environment=preview, commit=${body.app.commit}, version=${body.app.version}.`);
}
await verifyPreview();

const storage = createBlobStorage({ connectionString: CONN, container: CONTAINER });
const env = { BT_ENVIRONMENT: "preview", BT_SITE_ADMINS: "" };
const principal = Buffer.from(JSON.stringify({
  identityProvider: PROVIDER, userId: USER_ID, userDetails: OWNER_EMAIL,
  userRoles: ["anonymous", "authenticated"], claims: OWNER_NAME ? [{ typ: "name", val: OWNER_NAME }] : [],
})).toString("base64");

async function call(route, method, { query = {}, body } = {}) {
  const handler = require(path.join(ROOT, "api", route, "handler.js"));
  const headers = { "x-ms-client-principal": principal };
  if (method !== "GET") headers["x-bt-request"] = "1";
  const out = await invoke(handler, { method, headers, query, body }, { storage, env }, (ROUTES[route] || {}).options || {});
  const data = out.body ? JSON.parse(out.body) : null;
  if (out.status >= 400) throw new Error(`${method} ${route} failed ${out.status}: ${JSON.stringify(data && data.error)}`);
  return data;
}

// ---- find an existing DEMO workspace owned by this exact subject, without guessing at another
// workspace's name (a plain listing scoped to this person's own workspaceIds, same as /api/me). ---
async function findExistingDemo() {
  const me = await call("me", "GET");
  for (const w of me.workspaces || []) {
    if (w.name !== "DEMO") continue;
    const { value } = await storage.getJson(`workspaces/${w.id}/workspace.json`);
    const doc = readDocument("workspace", value);
    if (doc && doc.createdBy === `${PROVIDER}:${USER_ID}` && doc.status !== "deleted-permanent") return { id: w.id, doc };
  }
  return null;
}

async function permanentlyDeleteExisting(id) {
  const imp = (await call("workspaces", "POST", { query: { id, action: "delete-impact" } })).impact;
  if (imp.blocked) throw new Error(`Cannot reset the existing DEMO workspace: ${imp.blockers.join(" ")}`);
  await call("workspaces", "POST", { query: { id, action: "delete-permanent" }, body: { impactToken: imp.token, typedConfirmation: imp.confirmPhrase, reason: "DEMO reseed (--reset)" } });
  console.log(`Permanently deleted the previous DEMO workspace ${id} using the app's own audited deletion flow.`);
}

const existing = await findExistingDemo();
if (existing && !RESET) {
  console.log(`A DEMO workspace already exists (${existing.id}), owned by this identity. Left untouched — nothing duplicated, nothing overwritten. Run again with --reset to permanently delete it and reseed fresh.`);
  process.exit(0);
}
if (existing && RESET) await permanentlyDeleteExisting(existing.id);

// ---- the anchor date this whole dataset is built relative to, recorded so the run is auditable ---
const ANCHOR = new Date();
const day = (n) => new Date(ANCHOR.getTime() - n * 86400000).toISOString().slice(0, 10);
console.log(`Seeding relative to anchor date ${ANCHOR.toISOString().slice(0, 10)} (today, when this script ran).`);

// ==== ONE workspace: every implemented capability lives inside it (cross-workspace flows are out
// of scope for this authorization — documented as "not demonstrated" in the completion report). ===
const ws = (await call("workspaces", "POST", { body: { name: "DEMO", kind: "household", reportingCurrency: "EUR" } })).workspace;
const q = { workspaceId: ws.id };
console.log(`Created DEMO workspace ${ws.id}.`);

const cats = Object.fromEntries((await call("categories", "GET", { query: q })).categories.map((c) => [c.name, c.id]));

// ---- accounts: multiple types AND currencies, including one demonstrating debt (a loan with
// terms) and one demonstrating a credit card, so forecasts/budgets/net-worth all have real content.
const acc = async (body) => (await call("accounts", "POST", { query: q, body })).account;
const checking = await acc({ name: "DEMO Everyday Checking", type: "checking", currency: "EUR", openingBalance: "2400.00", institution: "Fictional Bank", maskedNumber: "0421" });
const usdSavings = await acc({ name: "DEMO Travel Savings (USD)", type: "savings", currency: "USD", openingBalance: "3100.00" });
const eurSavings = await acc({ name: "DEMO Emergency Fund", type: "savings", currency: "EUR", openingBalance: "1500.00" });
const card = await acc({ name: "DEMO Household Card", type: "credit-card", currency: "EUR", terms: { creditLimit: "3000.00", dueDay: 25, apr: "18.90" } });
await acc({ name: "DEMO Car Loan", type: "loan", currency: "EUR", openingBalance: "-12500.00", terms: { principal: "15000.00", interestRate: "4.90", termMonths: 60, payment: "282.00", paymentDay: 5 } });

// ---- contacts: non-login participants for Shared expenses (never invented signed-in members). ---
const contact = async (name) => (await call("contacts", "POST", { query: q, body: { scope: "workspace", workspaceId: ws.id, name } })).contact.ref;
const dana = await contact("Dana Fictional (guest)");
const priya = await contact("Priya Fictional (guest)");

// ---- merchants: defaults, icons (via defaultCategoryId, the icon catalogue's own default-by-type
// is exercised without an explicit icon override), aliases, and BOTH lifecycle states (one closed,
// reopened once, to show real history; the rest active). ------------------------------------------
const merchant = async (body) => (await call("payees", "POST", { query: q, body })).payee;
const grocer = await merchant({ name: "Fictional Grocer", type: "grocery", visibility: "shared", aliases: ["The Grocer"], defaultCategoryId: cats.Groceries });
const cafe = await merchant({ name: "Corner Cafe", type: "restaurant", visibility: "shared", aliases: ["CC"], defaultCategoryId: cats.Dining });
const transit = await merchant({ name: "City Transit", type: "transport", visibility: "shared", defaultCategoryId: cats.Transport });
const utility = await merchant({ name: "Power and Light Co", type: "utility", visibility: "shared", defaultCategoryId: cats.Utilities });
const streaming = await merchant({ name: "Streaming Service", type: "subscription", visibility: "shared", defaultCategoryId: cats.Entertainment });
const employer = await merchant({ name: "Fictional Employer", type: "employer", visibility: "shared", defaultCategoryId: cats.Salary });
const landlord = await merchant({ name: "Fictional Landlord", type: "housing", visibility: "shared", defaultCategoryId: cats.Housing, contact: { website: "https://landlord.example.com", phone: "+1 555 0100", email: "rent@example.com" } });
const oldShop = await merchant({ name: "Discontinued Gadget Shop", type: "retailer", visibility: "shared" });
await call("payees", "POST", { query: { ...q, action: "archive" }, body: { payeeId: oldShop.id, revision: oldShop.revision, reason: "Store closed down (demo lifecycle example)" } });
console.log("Seeded 8 merchants (7 active, 1 closed) with defaults and aliases.");

// ---- transactions: income, categorized/varied expenses, a refund, a transfer, cleared/pending. ---
const tx = (body) => call("transactions", "POST", { query: q, body });
const shopping = [
  [grocer, cats.Groceries, ["82.40", "64.15", "91.30", "58.75"]],
  [cafe, cats.Dining, ["4.50", "5.20", "12.80"]],
  [transit, cats.Transport, ["49.00", "2.80"]],
  [utility, cats.Utilities, ["96.40"]],
  [streaming, cats.Entertainment, ["11.99"]],
];
let n = 0;
for (const [m, categoryId, amounts] of shopping) {
  for (const amount of amounts) {
    n += 1;
    await tx({ accountId: n % 3 === 0 ? card.id : checking.id, kind: "expense", amount, payeeId: m.id, categoryId, date: day(2 + n * 2), status: n > 5 ? "cleared" : "pending" });
  }
}
await tx({ accountId: checking.id, kind: "income", amount: "3150.00", payeeId: employer.id, categoryId: cats.Salary, date: day(20), status: "cleared" });
await tx({ accountId: checking.id, kind: "refund", amount: "22.00", payeeId: grocer.id, date: day(9) });
await tx({ accountId: checking.id, kind: "transfer", amount: "300.00", date: day(15), transfer: { toAccountId: card.id } });
await tx({ accountId: usdSavings.id, kind: "income", amount: "500.00", categoryId: cats.Salary, date: day(25), status: "cleared", notes: "Fictional freelance top-up, for the travel fund" });
console.log(`Seeded ${n + 4} transactions (income, expense, refund, transfer) across EUR and USD accounts.`);

// ---- budgets: household lines with rollover. ------------------------------------------------------
await call("budgets", "POST", { query: q, body: { name: "Household essentials", scope: "shared", currency: "EUR", period: "monthly", startDate: `${day(0).slice(0, 8)}01`, lines: [
  { categoryId: cats.Groceries, amount: "450.00", rollover: true }, { categoryId: cats.Dining, amount: "120.00" },
  { categoryId: cats.Utilities, amount: "180.00" }, { categoryId: cats.Transport, amount: "100.00" },
] } });

// ---- recurring bills: overdue, due-soon and an already-recorded (paid) example, plus a variable-
// amount bill and a savings transfer bill, so the forecast and "needs attention" have real content.
const bill = (body) => call("recurring", "POST", { query: q, body });
const monthly = (startDate) => ({ freq: "monthly", startDate });
// trackFrom must be set explicitly to the same (past) start date: a bill's own default (Terry's
// design, api/recurring/handler.js) is "today", specifically so creating a bill with a start date
// in the past does NOT flood a new bill with "missed" items — an overdue DEMO example needs that
// default overridden on purpose.
const rent = await bill({ name: "Rent", billType: "housing", accountId: checking.id, amount: "1250.00", schedule: monthly(day(65)), trackFrom: day(65), payeeId: landlord.id, categoryId: cats.Housing, reminderDays: 7 });
// Recorded once already, so "All bills" has a real paid example, not only forecasts.
await call("recurring", "POST", { query: { ...q, action: "record" }, body: { recurringId: rent.recurring.id, occurrence: rent.recurring.overdue[0] || rent.recurring.upcoming[0], amount: "1250.00" } });
const electric = await bill({ name: "Electricity", billType: "utilities", accountId: checking.id, amount: "95.00", amountType: "variable", schedule: monthly(day(40)), payeeId: utility.id, categoryId: cats.Utilities });
// A separate, still-overdue bill (never recorded), so "overdue" has a real example too.
await bill({ name: "Water", billType: "utilities", accountId: checking.id, amount: "42.00", schedule: monthly(day(40)), trackFrom: day(40), categoryId: cats.Utilities, payeeDraftName: "DEMO Water Utility (typed, not yet a merchant)" });
await bill({ name: "Streaming", billType: "subscription", accountId: card.id, amount: "11.99", schedule: monthly(day(12)), payeeId: streaming.id, categoryId: cats.Entertainment });
await bill({ name: "Salary", billType: "income", accountId: checking.id, amount: "3150.00", schedule: monthly(day(17)), payeeId: employer.id, categoryId: cats.Salary });
await bill({ name: "Savings transfer", billType: "savings", kind: "transfer", accountId: checking.id, toAccountId: eurSavings.id, amount: "300.00", schedule: monthly(day(15)) });
await bill({ name: "Phone", billType: "subscription", accountId: checking.id, amount: "35.00", schedule: monthly(day(-9)), trackFrom: day(-9), categoryId: cats.Utilities });
console.log("Seeded 6 bills: one already recorded (paid), one overdue with only a typed (pending) merchant name, one due soon, one variable, one income, one savings transfer.");

// ---- shared expenses: varied splitting (equal, shares, exact amounts) and a settlement, with the
// owner and two fictional contacts as participants (no invented signed-in members). ----------------
const members = (await call("members", "GET", { query: q })).members;
const ownerRef = `member:${members[0].id}`;
const everyone = { method: "equal", lines: [ownerRef, dana, priya].map((ref) => ({ ref })) };
const shared = (body) => call("group", "POST", { query: q, body });
await shared({ description: "DEMO: dinner at the harbour", date: day(5), amount: "300.00", payers: [{ ref: ownerRef }], split: everyone });
await shared({ description: "DEMO: taxi back", date: day(5), amount: "36.00", payers: [{ ref: ownerRef }], split: { method: "shares", lines: [{ ref: ownerRef, value: 1 }, { ref: dana, value: 1 }, { ref: priya, value: 2 }] } });
await shared({ description: "DEMO: museum tickets", date: day(3), amount: "100.00", payers: [{ ref: ownerRef, amount: "60.00" }, { ref: dana, amount: "40.00" }], split: everyone });
await call("group", "POST", { query: { ...q, action: "settle" }, body: { from: dana, to: ownerRef, amount: "50.00", date: day(1), method: "Bank transfer (fictional)" } });
console.log("Seeded 3 shared expenses (equal, shares and exact-amount splits) and one reported settlement.");

console.log(`\nDEMO workspace ready: ${ws.id} — https://…/#/dashboard?ws=${ws.id} (open it signed in as the DEMO owner).`);
