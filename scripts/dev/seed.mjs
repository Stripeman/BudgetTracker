// Seeds FICTIONAL local data for development and screenshots: one household with Alice (owner),
// Bob (member) and Carol (viewer), a shared joint account, private accounts, merchants, ~40 entries
// over recent weeks, a card payment transfer and a grant. Runs the real handlers against the local
// file storage in .local/dev-data. Refuses to run if that directory already has data; delete
// .local/dev-data yourself to reseed (it contains fictional data only).
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { invoke } = require(path.join(ROOT, "api/_shared/runtime.js"));
const { createFileStorage } = require(path.join(ROOT, "api/_shared/storage.js"));
const { ROUTES } = require(path.join(ROOT, "api/_shared/routes.js"));

const DATA_DIR = path.join(ROOT, ".local", "dev-data");
if (fs.existsSync(DATA_DIR) && fs.readdirSync(DATA_DIR).length) {
  console.error(`${path.relative(ROOT, DATA_DIR)} already contains data. Delete it yourself to reseed (fictional data only).`);
  process.exit(2);
}
const KEY_FILE = path.join(ROOT, ".local", "dev-backup-key");
fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, randomBytes(32).toString("base64"), { mode: 0o600 });

const USERS = {
  alice: { userId: "dev-alice", email: "alice@example.com", name: "Alice Fictional" },
  bob: { userId: "dev-bob", email: "bob@example.com", name: "Bob Fictional" },
  carol: { userId: "dev-carol", email: "carol@example.com", name: "Carol Fictional" },
};
const storage = createFileStorage(DATA_DIR);
const backupStorage = createFileStorage(path.join(ROOT, ".local", "dev-backups"));
const env = { BT_ENVIRONMENT: "local", BT_LOCAL_DEV: "1", BT_SITE_ADMINS: "dave@example.com", BT_BACKUP_KEYS: `dev1:${fs.readFileSync(KEY_FILE, "utf8").trim()}`, BT_BACKUP_ACTIVE_KEY: "dev1" };

async function call(route, method, as, { query = {}, body } = {}) {
  const u = USERS[as];
  const principal = Buffer.from(JSON.stringify({ identityProvider: "google", userId: u.userId, userDetails: u.email, userRoles: ["anonymous", "authenticated"], claims: [{ typ: "name", val: u.name }] })).toString("base64");
  const handler = require(path.join(ROOT, "api", route, "handler.js"));
  const out = await invoke(handler, { method, headers: { "x-ms-client-principal": principal, "x-bt-request": "1" }, query, body }, { storage, backupStorage, env }, ROUTES[route].options || {});
  const data = out.body ? JSON.parse(out.body) : null;
  if (out.status >= 400) throw new Error(`${method} ${route} failed ${out.status}: ${data && data.error && data.error.code}`);
  return data;
}

const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const ws = (await call("workspaces", "POST", "alice", { body: { name: "Fictional Household", kind: "household", reportingCurrency: "EUR" } })).workspace;
const q = { workspaceId: ws.id };
for (const [who, role] of [["bob", "member"], ["carol", "viewer"]]) {
  const inv = await call("invitations", "POST", "alice", { query: q, body: { email: USERS[who].email, role } });
  await call("invitations", "POST", who, { query: { action: "accept" }, body: { workspaceId: ws.id, token: inv.token } });
}
const acc = async (as, body) => (await call("accounts", "POST", as, { query: q, body })).account;
const joint = await acc("alice", { name: "Joint Checking", type: "checking", currency: "EUR", visibility: "shared", openingBalance: "2400.00", institution: "Fictional Bank", maskedNumber: "0421" });
const card = await acc("alice", { name: "Household Card", type: "credit-card", currency: "EUR", visibility: "shared", terms: { creditLimit: "3000.00", dueDay: 25, apr: "18.90" } });
const savings = await acc("alice", { name: "Alice Savings", type: "savings", currency: "EUR", openingBalance: "8200.00" });
const bobCard = await acc("bob", { name: "Bob Personal Card", type: "credit-card", currency: "EUR" });
await acc("alice", { name: "Car Loan", type: "loan", currency: "EUR", openingBalance: "-12500.00", terms: { principal: "15000.00", interestRate: "4.90", termMonths: 60, payment: "282.00", paymentDay: 5 } });

const cats = Object.fromEntries((await call("categories", "GET", "alice", { query: q })).categories.map((c) => [c.name, c.id]));
const tx = (as, body) => call("transactions", "POST", as, { query: q, body });
const shopping = [
  ["Fictional Grocer", "grocery", "Groceries", ["82.40", "64.15", "91.30", "58.75", "73.20", "88.05"]],
  ["Corner Cafe", "restaurant", "Dining", ["4.50", "5.20", "4.50", "12.80", "4.50"]],
  ["City Transit", "transport", "Transport", ["49.00", "2.80", "2.80"]],
  ["Power and Light Co", "utility", "Utilities", ["96.40"]],
  ["Streaming Service", "subscription", "Entertainment", ["11.99"]],
  ["Hardware Barn", "retailer", "Shopping", ["37.60", "124.99"]],
];
// Merchants are managed records chosen by id (BT-007-01): shared ones for the household, one
// private to Bob.
const merchant = async (as, body) => (await call("payees", "POST", as, { query: q, body })).payee.id;
const m = {};
for (const [name, type, category] of shopping) m[name] = await merchant("alice", { name, type, visibility: "shared", defaultCategoryId: cats[category] });
m["Fictional Employer"] = await merchant("alice", { name: "Fictional Employer", type: "employer", visibility: "shared", defaultCategoryId: cats.Salary });
m["Fictional Landlord"] = await merchant("alice", { name: "Fictional Landlord", type: "housing", visibility: "shared", defaultCategoryId: cats.Housing, contact: { website: "https://landlord.example.com", phone: "+1 555 0100", email: "rent@example.com", address: "" } });
m["Fictional Watch Shop"] = await merchant("bob", { name: "Fictional Watch Shop", type: "retailer" });
let n = 0;
for (const [name, , category, amounts] of shopping) {
  for (const amount of amounts) {
    n += 1;
    await tx(n % 3 === 0 ? "bob" : "alice", { accountId: n % 4 === 0 ? card.id : joint.id, kind: "expense", amount, payeeId: m[name], categoryId: cats[category], date: day(2 + n * 2), status: n > 6 ? "cleared" : "pending" });
  }
}
await tx("alice", { accountId: joint.id, kind: "income", amount: "3150.00", payeeId: m["Fictional Employer"], categoryId: cats.Salary, date: day(20), status: "cleared" });
await tx("alice", { accountId: joint.id, kind: "refund", amount: "37.60", payeeId: m["Hardware Barn"], date: day(8) });
await tx("alice", { accountId: joint.id, kind: "transfer", amount: "250.00", date: day(6), transfer: { toAccountId: card.id } });
await tx("alice", { accountId: joint.id, kind: "transfer", amount: "300.00", date: day(15), transfer: { toAccountId: savings.id } });
await tx("bob", { accountId: bobCard.id, kind: "expense", amount: "180.00", payeeId: m["Fictional Watch Shop"], categoryId: cats.Shopping, date: day(4) });
await tx("bob", { accountId: bobCard.id, kind: "expense", amount: "23.90", payeeId: m["Corner Cafe"], categoryId: cats.Dining, date: day(3) });
const members = (await call("members", "GET", "alice", { query: q })).members;
await call("grants", "POST", "alice", { query: q, body: { accountId: savings.id, memberId: members.find((x) => x.name.startsWith("Bob")).id, capabilities: ["view-balances"] } });

// Recurring bills (BT-008-02) and a shared budget (BT-008-01). day(-n) is n days from now.
const bill = (as, body) => call("recurring", "POST", as, { query: q, body });
const monthly = (startDate) => ({ freq: "monthly", startDate });
await bill("alice", { name: "Rent", billType: "housing", accountId: joint.id, amount: "1250.00", schedule: monthly(day(-6)), payeeId: m["Fictional Landlord"], categoryId: cats.Housing, reminderDays: 7 });
await bill("alice", { name: "Electricity", billType: "utilities", accountId: joint.id, amount: "95.00", amountType: "variable", schedule: monthly(day(-2)), payeeId: m["Power and Light Co"], categoryId: cats.Utilities });
await bill("alice", { name: "Streaming", billType: "subscription", accountId: card.id, amount: "11.99", schedule: monthly(day(-12)), payeeId: m["Streaming Service"], categoryId: cats.Entertainment });
await bill("alice", { name: "Salary", billType: "income", accountId: joint.id, amount: "3150.00", schedule: monthly(day(-17)), payeeId: m["Fictional Employer"], categoryId: cats.Salary });
await bill("alice", { name: "Savings", billType: "savings", kind: "transfer", accountId: joint.id, toAccountId: savings.id, amount: "300.00", schedule: monthly(day(-15)) });
await bill("alice", { name: "Phone", billType: "subscription", accountId: joint.id, amount: "35.00", schedule: monthly(day(9)), trackFrom: day(9), categoryId: cats.Utilities });
await call("budgets", "POST", "alice", { query: q, body: { name: "Household essentials", scope: "shared", currency: "EUR", period: "monthly", startDate: `${day(0).slice(0, 8)}01`, lines: [
  { categoryId: cats.Groceries, amount: "450.00", rollover: true }, { categoryId: cats.Dining, amount: "120.00" },
  { categoryId: cats.Utilities, amount: "180.00" }, { categoryId: cats.Transport, amount: "100.00" },
] } });
console.log(`Seeded fictional workspace ${ws.name} (${ws.id}) with ${n + 6} entries, 6 bills and a budget.`);
