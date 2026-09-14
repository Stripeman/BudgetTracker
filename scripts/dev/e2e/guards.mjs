// ROUTE GUARDS: group link keys (links.groupExpenseId, links.groupSettlementId) are set only by the
// shared-expense route for the person recording their own part (BT-009, security review S3). Every
// route that accepts `links` — and every write that might carry them — must refuse them from a
// client, write nothing, and still accept the same request without them (so the refusal is about
// the keys, not about a broken request).
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";
import { newIdempotencyKey } from "../harness/api.mjs";

export const name = "guards";
export const title = "/api/transactions, /api/recurring (bills) and /api/group refuse client-supplied group link keys";
export const needsBrowser = false;

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Guards", kind: "household" });
  const alice = h.api("alice");
  const k = newIdempotencyKey;
  const account = async (label) => firstRecord(await alice.ok("accounts", { method: "POST", query: W.q, body: { name: label, type: "checking", currency: "EUR" }, idempotencyKey: k() }));
  const wallet = await account("E2E Guard Wallet");
  const other = await account("E2E Guard Savings");
  const me = W.ref("alice");
  const expense = (await alice.ok("group", { method: "POST", query: W.q, body: { description: "E2E guard dinner", amount: "20.00", payers: [{ ref: me }], split: { method: "equal", lines: [{ ref: me }] } }, idempotencyKey: k() })).expense;
  const contact = firstRecord(await alice.ok("contacts", { method: "POST", body: { scope: "workspace", workspaceId: W.id, name: "E2E Guard Contact" } }));
  const settlement = contact && contact.ref
    ? (await alice.ok("group", { method: "POST", query: { ...W.q, action: "settle" }, body: { from: contact.ref, to: me, amount: "5.00" }, idempotencyKey: k() })).settlement
    : null;
  const entry = firstRecord(await alice.ok("transactions", { method: "POST", query: W.q, body: { accountId: wallet.id, kind: "expense", amount: "3.00", notes: "E2E guard entry" }, idempotencyKey: k() }));
  const today = new Date().toISOString().slice(0, 10);
  const billBody = { name: "E2E Guard Bill", billType: "subscription", accountId: wallet.id, amount: "9.00", schedule: { freq: "monthly", startDate: today } };
  const bill = firstRecord(await alice.ok("recurring", { method: "POST", query: W.q, body: billBody, idempotencyKey: k() }));

  const settlementId = settlement ? settlement.id : "gst_fiction0001";
  const cases = [
    ["POST /api/transactions with links.groupExpenseId", "transactions", "POST", {}, { accountId: wallet.id, kind: "expense", amount: "20.00", links: { groupExpenseId: expense.id } }],
    ["POST /api/transactions with links.groupSettlementId", "transactions", "POST", {}, { accountId: wallet.id, kind: "expense", amount: "20.00", links: { groupSettlementId: settlementId } }],
    ["POST /api/transactions with both group link keys and an allowed one", "transactions", "POST", {}, { accountId: wallet.id, kind: "expense", amount: "20.00", links: { tripId: "trp_fiction0001", groupExpenseId: expense.id, groupSettlementId: settlementId } }],
    ["POST /api/transactions (a transfer) with links.groupExpenseId", "transactions", "POST", {}, { accountId: wallet.id, kind: "transfer", amount: "20.00", transfer: { toAccountId: other.id }, links: { groupExpenseId: expense.id } }],
    ["PATCH /api/transactions with links.groupExpenseId", "transactions", "PATCH", {}, { transactionId: entry.id, revision: entry.revision || 1, reason: "E2E guard", notes: "changed", links: { groupExpenseId: expense.id } }],
    ["POST /api/transactions?action=reverse with links.groupSettlementId", "transactions", "POST", { action: "reverse" }, { transactionId: entry.id, reason: "E2E guard", links: { groupSettlementId: settlementId } }],
    ["POST /api/recurring (a new bill) with links.groupExpenseId", "recurring", "POST", {}, { ...billBody, name: "E2E Guard Bill 2", links: { groupExpenseId: expense.id } }],
    ["POST /api/recurring?action=record with links.groupExpenseId", "recurring", "POST", { action: "record" }, { recurringId: bill.id, occurrence: today, links: { groupExpenseId: expense.id } }],
    ["POST /api/group (a new shared expense) with links.groupExpenseId", "group", "POST", {}, { description: "E2E guard 2", amount: "20.00", payers: [{ ref: me }], split: { method: "equal", lines: [{ ref: me }] }, links: { groupExpenseId: expense.id } }],
    ["POST /api/group?action=settle with links.groupSettlementId", "group", "POST", { action: "settle" }, { from: contact ? contact.ref : me, to: me, amount: "1.00", links: { groupSettlementId: settlementId } }],
  ];

  const allEntries = async () => (await alice.ok("transactions", { query: W.q })).transactions || [];
  const before = await allEntries();
  for (const [label, route, method, query, body] of cases) {
    const r = await alice.request(route, { method, query: { ...W.q, ...query }, body, idempotencyKey: method === "POST" ? k() : undefined });
    t.check(`${label} is refused`, { expected: { status: 400 }, actual: { status: r.status, code: r.code, message: r.message }, pass: r.status === 400 });
  }
  const afterRefusals = await allEntries();
  const groupLinked = afterRefusals.filter((x) => x.links && (x.links.groupExpenseId || x.links.groupSettlementId)).map((x) => x.id);
  t.check("the refused requests wrote no entry, and no entry carries a group link key", { expected: { added: 0, groupLinked: [] }, actual: { added: afterRefusals.length - before.length, groupLinked } });
  const g = await alice.ok("group", { query: W.q });
  t.check("the refused requests added no shared expense or payment", { expected: { expenses: 1, payments: settlement ? 1 : 0 }, actual: { expenses: g.expenses.length, payments: g.settlements.length } });

  // Controls: the same routes accept the request without the group keys.
  const controls = [
    ["POST /api/transactions with only links.tripId", "transactions", "POST", {}, { accountId: wallet.id, kind: "expense", amount: "1.00", links: { tripId: "trp_fiction0001" } }, 201],
    ["PATCH /api/transactions without links", "transactions", "PATCH", {}, { transactionId: entry.id, revision: entry.revision || 1, reason: "E2E guard control", notes: "changed" }, 200],
    ["POST /api/recurring?action=record without links", "recurring", "POST", { action: "record" }, { recurringId: bill.id, occurrence: today }, 201],
    ["POST /api/group?action=settle without links", "group", "POST", { action: "settle" }, { from: contact ? contact.ref : me, to: me, amount: "1.00" }, 201],
  ];
  for (const [label, route, method, query, body, status] of controls) {
    const r = await alice.request(route, { method, query: { ...W.q, ...query }, body, idempotencyKey: method === "POST" ? k() : undefined });
    t.check(`control: ${label} is accepted`, { expected: { status }, actual: { status: r.status, code: r.code, message: r.message }, pass: r.status === status });
  }
}
