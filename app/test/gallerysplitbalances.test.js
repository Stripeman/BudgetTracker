// BT-013-15: the Design Gallery's shared-expense fixture now DERIVES its balances from real
// expenses + per-expense split shares (`splitBalances`), rather than an independently hand-set
// number — so the combined figure and any per-event figure can never quietly disagree. Verified
// directly against hand-computed expected values, not merely "it renders something".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitBalances, shared, events } from "../js/ui/gallery/fixtures.js";

describe("BT-013-15 shared-expense split balances (real arithmetic, never invented)", () => {
  test("the combined balance across every event sums to zero and matches hand-computed shares", () => {
    const byName = Object.fromEntries(shared.balances.map((b) => [b.name, b.net]));
    assert.equal(byName["You (Alice)"], "238.00");
    assert.equal(byName["Bob"], "-76.00");
    assert.equal(byName["Dana (contact)"], "-162.00");
    const total = shared.balances.reduce((s, b) => s + Number(b.net), 0);
    assert.ok(Math.abs(total) < 0.01, `balances must sum to zero, got ${total}`);
  });

  test("a per-event balance is the SAME real arithmetic, restricted to that event's own expenses — General is still outstanding", () => {
    const general = shared.expenses.filter((e) => e.eventId === "gev1");
    const balances = splitBalances(general);
    const byName = Object.fromEntries(balances.map((b) => [b.name, b.net]));
    assert.equal(byName["You (Alice)"], "188.00");
    assert.equal(byName["Bob"], "-76.00");
    assert.equal(byName["Dana (contact)"], "-112.00");
  });

  test("Museum day is a real OUTSTANDING example: Dana still owes Alice", () => {
    const museum = shared.expenses.filter((e) => e.eventId === "gev2");
    const balances = splitBalances(museum);
    const byName = Object.fromEntries(balances.map((b) => [b.name, b.net]));
    assert.equal(byName["You (Alice)"], "50.00");
    assert.equal(byName["Dana (contact)"], "-50.00");
  });

  test("Solo coffee run is a real SETTLED example: an expense split only among its own payer nets to zero for everyone", () => {
    const solo = shared.expenses.filter((e) => e.eventId === "gev3");
    const balances = splitBalances(solo);
    assert.equal(balances.length, 1);
    assert.equal(balances[0].net, "0.00");
  });

  test("three real, distinct event lifecycle/settlement states exist: active+outstanding, closed+outstanding, closed+settled", () => {
    assert.deepEqual(events.map((e) => e.status), ["active", "closed", "closed"]);
    const outstandingGeneral = splitBalances(shared.expenses.filter((e) => e.eventId === "gev1")).some((b) => Number(b.net) !== 0);
    const outstandingMuseum = splitBalances(shared.expenses.filter((e) => e.eventId === "gev2")).some((b) => Number(b.net) !== 0);
    const settledSolo = splitBalances(shared.expenses.filter((e) => e.eventId === "gev3")).every((b) => Number(b.net) === 0);
    assert.deepEqual({ outstandingGeneral, outstandingMuseum, settledSolo }, { outstandingGeneral: true, outstandingMuseum: true, settledSolo: true });
  });
});
