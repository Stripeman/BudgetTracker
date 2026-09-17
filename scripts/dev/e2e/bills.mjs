// "RECORD NEXT" TOOLTIP (BT-014-10/12; Terry, 2026-09-17: "add nice tool tips to the All bills
// pane for 'Record next' i dont know what that means", then, after the first version shipped
// without being opened in a real browser: "The tool tip on 'All bills > record next' is clipped..
// you would have seen this had you tested it on localhost"). The floating tooltip must actually be
// visible, in the real viewport, not clipped by the All bills table's own scrolling container
// (`.table-wrap { overflow-x: auto }`, which forces `overflow-y` to clip too) — exactly what a
// DOM-double unit test cannot see, since it has no real layout at all.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "bills";
export const title = "The All bills table's 'Record next' tooltip is visible in the real viewport, not clipped by the table's own scroll container";
export const needsBrowser = true;

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Bills Household", kind: "household" });
  const q = W.q;
  const account = firstRecord(await h.api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Bills Checking", type: "checking", currency: "USD", openingBalance: "1000.00" } }));
  // A near-term due date, so the bill sits with nothing but the page header above it — exactly the
  // "row near the top of the table" layout the original report's screenshot showed.
  const today = new Date().toISOString().slice(0, 10);
  const bill = firstRecord(await h.api("alice").ok("recurring", { method: "POST", query: q, body: { name: "E2E Rent", billType: "housing", accountId: account.id, amount: "950.00", schedule: { freq: "monthly", startDate: today } } }));
  t.note(`workspace ${W.name}: ${W.id}; bill ${bill.id} on account ${account.id}`);

  const b = await h.browsers(["alice"], { prefix: "bills-" });
  await b.alice.open("dashboard");
  await b.alice.useWorkspace(W.name);
  await b.alice.goto("bills");
  await b.alice.waitForText("Record next", { scope: "main" });

  const before = await b.alice.evaluate("!!document.querySelector('.floating-tip')");
  t.check("nothing shown before hover/focus", { expected: false, actual: before });

  const result = await b.alice.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent === "Record next");
    if (!btn) return { found: false };
    btn.focus();
    const tip = document.querySelector('.floating-tip');
    if (!tip) return { found: true, shown: false };
    const r = tip.getBoundingClientRect();
    return {
      found: true, shown: true,
      text: tip.textContent,
      ariaHidden: tip.getAttribute("aria-hidden"),
      fullyInViewport: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
      top: Math.round(r.top), bottom: Math.round(r.bottom), viewportHeight: window.innerHeight,
    };
  })()`);
  const shot = await b.alice.shot("bills-record-next-tooltip");
  t.check("focusing 'Record next' shows a real tooltip box fully inside the viewport (not clipped above the table, the exact bug reported)", {
    expected: { found: true, shown: true, ariaHidden: "true", fullyInViewport: true },
    actual: { found: result.found, shown: result.shown, ariaHidden: result.ariaHidden, fullyInViewport: result.fullyInViewport },
  });
  t.check("the tooltip explains what the button does", { expected: true, actual: /review.*record.*(entry|payment)/i.test(result.text || "") });
  t.note(`tooltip box: top=${result.top} bottom=${result.bottom} viewportHeight=${result.viewportHeight}; screenshot: ${shot}`);

  const after = await b.alice.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent === "Record next");
    btn.blur();
    return !!document.querySelector('.floating-tip');
  })()`);
  t.check("removed once focus leaves", { expected: false, actual: after });

  await b.alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: b.alice.problems() });
}
