// BT-009-26 offline entry, core logic: explicit per-device opt-in, a minimal local queue, which
// errors are safe to queue unattended (never one the server already looked at and refused), and
// syncing — including a permission/validation failure at sync time blocking further silent retries
// without ever dropping the record. All data is fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ErrorKind } from "../js/core/errors.js";
import * as offline from "../js/core/offline.js";

function fakeStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

beforeEach(() => { globalThis.localStorage = fakeStorage(); });
afterEach(() => { delete globalThis.localStorage; });

describe("BT-009-26 offline entry: device opt-in and the local queue", () => {
  test("disabled by default; explicit opt-in turns it on and off, per device", () => {
    assert.equal(offline.isEnabled(), false);
    offline.setEnabled(true);
    assert.equal(offline.isEnabled(), true);
    offline.setEnabled(false);
    assert.equal(offline.isEnabled(), false);
  });

  test("only a genuine connectivity failure is safe to queue unattended; a real rejection never is", () => {
    assert.equal(offline.shouldQueue({ kind: ErrorKind.NETWORK }), true);
    assert.equal(offline.shouldQueue({ kind: ErrorKind.UNAVAILABLE }), true);
    for (const kind of [ErrorKind.FORBIDDEN, ErrorKind.CONFLICT, ErrorKind.CLIENT, ErrorKind.SCHEMA, ErrorKind.NOT_FOUND]) {
      assert.equal(offline.shouldQueue({ kind }), false, kind);
    }
    assert.equal(offline.shouldQueue(null), false);
  });

  test("enqueue keeps only this workspace's own entries, in order, with a stable id and the exact idempotency key given", () => {
    const a = offline.enqueue({ wsId: "ws_1", kind: "expense", body: { description: "Fictional Dinner" }, idempotencyKey: "k-1" });
    offline.enqueue({ wsId: "ws_2", kind: "expense", body: { description: "Someone else's workspace" }, idempotencyKey: "k-2" });
    const b = offline.enqueue({ wsId: "ws_1", kind: "settlement", action: "settle", body: { from: "member:a", to: "member:b", amount: "10.00" }, idempotencyKey: "k-3" });
    const mine = offline.queueFor("ws_1");
    assert.deepEqual(mine.map((e) => e.id), [a.id, b.id]);
    assert.equal(mine[0].idempotencyKey, "k-1");
    assert.equal(mine[0].blocked, false);
    offline.discard(a.id);
    offline.discard(b.id);
  });

  test("discard removes an entry for good; it does not reappear after another read", () => {
    const e = offline.enqueue({ wsId: "ws_1", kind: "expense", body: {}, idempotencyKey: "k-4" });
    offline.discard(e.id);
    assert.equal(offline.queueFor("ws_1").length, 0);
  });

  test("sync replays each entry through the real create route with its own idempotency key, in order, and clears what succeeds", async () => {
    const calls = [];
    const ctx = { api: {
      createGroupExpense: async (ws, body, key) => { calls.push({ kind: "expense", ws, body, key }); return { expense: { id: "gex_1" } }; },
      groupAction: async (ws, action, body, key) => { calls.push({ kind: "settlement", ws, action, body, key }); return { settlement: { id: "gst_1" } }; },
    } };
    const e1 = offline.enqueue({ wsId: "ws_1", kind: "expense", body: { description: "Fictional Dinner", amount: "20.00" }, idempotencyKey: "k-5" });
    const e2 = offline.enqueue({ wsId: "ws_1", kind: "settlement", action: "settle", body: { from: "member:a", to: "member:b", amount: "10.00" }, idempotencyKey: "k-6" });
    const { sent, failed } = await offline.sync(ctx, "ws_1");
    assert.equal(sent.length, 2);
    assert.equal(failed.length, 0);
    assert.equal(offline.queueFor("ws_1").length, 0, "both are removed from the queue once genuinely sent");
    assert.deepEqual(calls.map((c) => c.key), [e1.idempotencyKey, e2.idempotencyKey]);
    assert.equal(calls[1].action, "settle");
  });

  test("still offline at sync time: the item stays queued, un-blocked, for the next attempt", async () => {
    const ctx = { api: { createGroupExpense: async () => { throw { kind: ErrorKind.NETWORK }; } } };
    const e = offline.enqueue({ wsId: "ws_1", kind: "expense", body: {}, idempotencyKey: "k-7" });
    const { sent, failed } = await offline.sync(ctx, "ws_1");
    assert.equal(sent.length, 0);
    assert.equal(failed.length, 1);
    const mine = offline.queueFor("ws_1");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].blocked, false);
    offline.discard(e.id);
  });

  test("a real rejection at sync time (e.g. revoked access) blocks the item — revalidated fully on the server, never bypassed by having been queued, and never silently retried forever or dropped", async () => {
    const ctx = { api: { createGroupExpense: async () => { throw { kind: ErrorKind.FORBIDDEN, message: "You do not have permission to do that." }; } } };
    const e = offline.enqueue({ wsId: "ws_1", kind: "expense", body: { description: "Fictional Snacks" }, idempotencyKey: "k-8" });
    const { failed } = await offline.sync(ctx, "ws_1");
    assert.equal(failed.length, 1);
    const mine = offline.queueFor("ws_1");
    assert.equal(mine.length, 1, "kept for review, never silently dropped");
    assert.equal(mine[0].blocked, true);
    assert.match(mine[0].lastError, /permission/);
    // A second sync pass does not even try it again while blocked.
    const calls = [];
    const ctx2 = { api: { createGroupExpense: async (...args) => { calls.push(args); throw { kind: ErrorKind.FORBIDDEN }; } } };
    await offline.sync(ctx2, "ws_1");
    assert.equal(calls.length, 0);
    // Explicitly unblocking it makes it eligible again.
    offline.unblock(e.id);
    assert.equal(offline.queueFor("ws_1")[0].blocked, false);
    offline.discard(e.id);
  });
});
