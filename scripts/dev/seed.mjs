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
  ["Fictional Grocer", "Groceries", ["82.40", "64.15", "91.30", "58.75", "73.20", "88.05"]],
  ["Corner Cafe", "Dining", ["4.50", "5.20", "4.50", "12.80", "4.50"]],
  ["City Transit", "Transport", ["49.00", "2.80", "2.80"]],
  ["Power and Light Co", "Utilities", ["96.40"]],
  ["Streaming Service", "Entertainment", ["11.99"]],
  ["Hardware Barn", "Shopping", ["37.60", "124.99"]],
];
let n = 0;
for (const [payeeName, category, amounts] of shopping) {
  for (const amount of amounts) {
    n += 1;
    await tx(n % 3 === 0 ? "bob" : "alice", { accountId: n % 4 === 0 ? card.id : joint.id, kind: "expense", amount, payeeName, categoryId: cats[category], date: day(2 + n * 2), status: n > 6 ? "cleared" : "pending" });
  }
}
await tx("alice", { accountId: joint.id, kind: "income", amount: "3150.00", payeeName: "Fictional Employer", categoryId: cats.Salary, date: day(20), status: "cleared" });
await tx("alice", { accountId: joint.id, kind: "refund", amount: "37.60", payeeName: "Hardware Barn", date: day(8) });
await tx("alice", { accountId: joint.id, kind: "transfer", amount: "250.00", date: day(6), transfer: { toAccountId: card.id } });
await tx("alice", { accountId: joint.id, kind: "transfer", amount: "300.00", date: day(15), transfer: { toAccountId: savings.id } });
await tx("bob", { accountId: bobCard.id, kind: "expense", amount: "180.00", payeeName: "Fictional Watch Shop", categoryId: cats.Shopping, date: day(4) });
await tx("bob", { accountId: bobCard.id, kind: "expense", amount: "23.90", payeeName: "Corner Cafe", categoryId: cats.Dining, date: day(3) });
const members = (await call("members", "GET", "alice", { query: q })).members;
await call("grants", "POST", "alice", { query: q, body: { accountId: savings.id, memberId: members.find((m) => m.name.startsWith("Bob")).id, capabilities: ["view-balances"] } });
console.log(`Seeded fictional workspace ${ws.name} (${ws.id}) with ${n + 6} entries.`);
