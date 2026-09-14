// CONCURRENCY through the direct API client: requests fired IN PARALLEL against the real handlers
// and the file storage's ETag-guarded writes. Nothing may be duplicated or silently overwritten.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";
import { newIdempotencyKey } from "../harness/api.mjs";

export const name = "concurrency";
export const title = "Parallel confirms, idempotent and non-idempotent creates, and parallel edits: nothing duplicated or overwritten";
export const needsBrowser = false;

const sortedStatuses = (rs) => rs.map((r) => r.status).sort((a, b) => a - b);

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Concurrency", kind: "group", members: { bob: "member", carol: "member" } });
  const alice = h.api("alice");
  const bob = h.api("bob");
  const everyone = { method: "equal", lines: ["alice", "bob", "carol"].map((u) => ({ ref: W.ref(u) })) };
  const expenseBody = (description, amount = "30.00") => ({ description, amount, payers: [{ ref: W.ref("alice") }], split: everyone });
  const group = () => alice.ok("group", { query: W.q });
  const countOf = async (description) => (await group()).expenses.filter((e) => e.description === description).length;

  // 1. Two parallel confirms of one payment.
  const s = (await bob.ok("group", { method: "POST", query: { ...W.q, action: "settle" }, body: { from: W.ref("bob"), to: W.ref("alice"), amount: "10.00" }, idempotencyKey: newIdempotencyKey() })).settlement;
  const confirms = await Promise.all([1, 2].map(() => alice.request("group", { method: "POST", query: { ...W.q, action: "confirm" }, body: { settlementId: s.id, revision: s.revision } })));
  t.check("two parallel confirms of one payment: exactly one succeeds and one is refused with 409", { expected: [200, 409], actual: sortedStatuses(confirms) });
  const history = await alice.ok("group", { query: { ...W.q, action: "history", settlementId: s.id } });
  const after = (await group()).settlements.find((x) => x.id === s.id);
  t.check("the payment is confirmed once: revision 2 and one confirmation in its history", {
    expected: { status: "confirmed", revision: 2, confirmations: 1 },
    actual: { status: after.status, revision: after.revision, confirmations: history.history.filter((e) => /^confirmed/.test(e.event)).length },
  });

  // 2. Parallel creates with the SAME Idempotency-Key: one record.
  const key = newIdempotencyKey();
  const same = await Promise.all([1, 2].map(() => alice.request("group", { method: "POST", query: W.q, body: expenseBody("E2E same key"), idempotencyKey: key })));
  t.check("two parallel creates with the same Idempotency-Key make one expense", {
    expected: { statuses: [201, 201], records: 1, sameId: true, replays: 1 },
    actual: { statuses: sortedStatuses(same), records: await countOf("E2E same key"), sameId: !!same[0].data && !!same[1].data && same[0].data.expense.id === same[1].data.expense.id, replays: same.filter((r) => r.data && r.data.replayed === true).length },
  });
  const burstKey = newIdempotencyKey();
  const burst = await Promise.all(Array.from({ length: 10 }, () => alice.request("group", { method: "POST", query: W.q, body: expenseBody("E2E burst"), idempotencyKey: burstKey })));
  t.check("ten parallel creates with one Idempotency-Key make one expense", { expected: { failed: 0, records: 1 }, actual: { failed: burst.filter((r) => !r.ok).length, records: await countOf("E2E burst") } });
  const reused = await alice.request("group", { method: "POST", query: W.q, body: expenseBody("E2E same key", "31.00"), idempotencyKey: key });
  t.check("the same Idempotency-Key with a different body is refused (409) and adds nothing", { expected: { status: 409, code: "idempotency_key_reused", records: 1 }, actual: { status: reused.status, code: reused.code, records: await countOf("E2E same key") } });

  // 3. Parallel creates with DIFFERENT keys: two records.
  const different = await Promise.all([1, 2].map(() => alice.request("group", { method: "POST", query: W.q, body: expenseBody("E2E different keys"), idempotencyKey: newIdempotencyKey() })));
  t.check("two parallel creates with different keys make two expenses", {
    expected: { statuses: [201, 201], records: 2, distinctIds: true },
    actual: { statuses: sortedStatuses(different), records: await countOf("E2E different keys"), distinctIds: !!different[0].data && !!different[1].data && different[0].data.expense.id !== different[1].data.expense.id },
  });

  // 4. Two parallel edits of one expense with the same revision: one wins, one 409, no lost update.
  const target = (await alice.ok("group", { method: "POST", query: W.q, body: expenseBody("E2E edit race"), idempotencyKey: newIdempotencyKey() })).expense;
  const edits = await Promise.all(["A", "B"].map((v) => alice.request("group", { method: "PATCH", query: W.q, body: { expenseId: target.id, revision: target.revision, reason: `E2E race ${v}`, description: `E2E edit race ${v}` } })));
  const winner = edits.find((r) => r.status === 200);
  const edited = (await group()).expenses.find((e) => e.id === target.id);
  t.check("two parallel edits with the same revision: one succeeds and one is refused with 409", { expected: [200, 409], actual: sortedStatuses(edits) });
  t.check("the edited expense has one correction and the winner's description", {
    expected: { revision: 2, corrections: 1, description: winner ? winner.data.expense.description : "(no winner)" },
    actual: { revision: edited.revision, corrections: edited.amendmentCount, description: edited.description },
  });

  // 5. The ledger route too: parallel entry creates with one key, then with two keys.
  const wallet = firstRecord(await alice.ok("accounts", { method: "POST", query: W.q, body: { name: "E2E Race Wallet", type: "cash", currency: "EUR" }, idempotencyKey: newIdempotencyKey() }))
    || firstRecord(await alice.ok("accounts", { method: "POST", query: W.q, body: { name: "E2E Race Wallet 2", type: "checking", currency: "EUR" }, idempotencyKey: newIdempotencyKey() }));
  const entryBody = (notes) => ({ accountId: wallet.id, kind: "expense", amount: "5.00", notes });
  const entries = async (notes) => ((await alice.ok("transactions", { query: { ...W.q, accountId: wallet.id } })).transactions || []).filter((x) => x.notes === notes).length;
  const entryKey = newIdempotencyKey();
  const sameEntry = await Promise.all([1, 2].map(() => alice.request("transactions", { method: "POST", query: W.q, body: entryBody("E2E same key entry"), idempotencyKey: entryKey })));
  t.check("two parallel entry creates with the same Idempotency-Key make one entry", { expected: { failed: 0, entries: 1 }, actual: { failed: sameEntry.filter((r) => !r.ok).length, entries: await entries("E2E same key entry") } });
  const twoEntries = await Promise.all([1, 2].map(() => alice.request("transactions", { method: "POST", query: W.q, body: entryBody("E2E two keys entry"), idempotencyKey: newIdempotencyKey() })));
  t.check("two parallel entry creates with different keys make two entries", { expected: { failed: 0, entries: 2 }, actual: { failed: twoEntries.filter((r) => !r.ok).length, entries: await entries("E2E two keys entry") } });

  // 6. Nothing duplicated overall, and the group still balances.
  const final = await group();
  const ids = [...final.expenses.map((e) => e.id), ...final.settlements.map((x) => x.id)];
  const nets = (final.balances.find((x) => x.currency === "EUR") || { rows: [] }).rows.reduce((sum, r) => sum + r.netMinor, 0);
  t.check("in total: 5 expenses and 1 payment, no duplicate ids, and the balances sum to zero", {
    expected: { expenses: 5, payments: 1, duplicateIds: 0, netSumMinor: 0 },
    actual: { expenses: final.expenses.length, payments: final.settlements.length, duplicateIds: ids.length - new Set(ids).size, netSumMinor: nets },
  });
}
