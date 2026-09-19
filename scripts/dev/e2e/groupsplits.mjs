// BT-009-25, in a real browser: "Fixed amounts, then split the rest" — a fixed amount for one
// person and blank values for everyone else, who split whatever is left, equally.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "groupsplits";
export const title = "BT-009-25: the \"fixed amounts, then split the rest\" shared-expense split method, in a real browser";
export const needsBrowser = true;

const EXPENSES = '[aria-labelledby="grp-expenses"]';

export async function run(h, t) {
  // Three people so the remainder genuinely SPLITS between more than one person (Alice fixed;
  // Bob and Carol share the rest) rather than one person simply getting all of it.
  const W = await createWorkspace(h, { name: "E2E Splits Trip", kind: "group", members: { bob: "member", carol: "viewer" } });
  const { alice } = await h.browsers(["alice"], { prefix: "groupsplits-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(EXPENSES))) { t.skip("shared expenses in the browser", "the Shared expenses page is not present at this commit"); return; }

  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E cabin weekend");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "100.00");
  await alice.choose("Split", "Fixed amounts, then split the rest", { scope: ".modal" });
  // A per-person split value has no <label for>, only an aria-label (it sits beside a checkbox
  // whose OWN <label> already names the person) — `name:` resolves aria-label; `label:` would not.
  await alice.fill({ name: "Fixed amount for Alice Fictional", scope: ".modal" }, "30.00");
  const bobShareOf = `(() => {
    const set = [...document.querySelectorAll('.modal fieldset')].find((f) => ((f.querySelector('legend') || {}).textContent || '') === 'Shared by');
    const row = set && [...set.querySelectorAll('.split-row')].find((r) => r.querySelector('label').textContent.startsWith('Bob'));
    return row ? row.querySelector('.split-row__share').textContent : '';
  })()`;
  await alice.waitFor(`${bobShareOf}.includes('35.00')`, { what: "the live preview to compute Bob's share of the remainder" });
  t.check("Bob's live preview share is the 70.00 remainder split equally with Alice's other share (35.00 each)", { expected: true, actual: true });
  await alice.shot("1-fixed-remainder-dialog");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("E2E cabin weekend", { scope: EXPENSES });

  const yourShare = await alice.evaluate(`(() => {
    const tr = [...document.querySelectorAll('${EXPENSES} tbody tr')].find((r) => r.textContent.includes('E2E cabin weekend'));
    return tr ? (tr.querySelector('td[data-label="Your share"]') || {}).innerText : null;
  })()`);
  t.check("the saved expense shows Alice's own fixed 30.00 share, not the remainder amount", { expected: true, actual: /30\.00/.test(String(yourShare)) });

  // ---- Saved split presets: save one, then apply it to a fresh expense -----------------------
  // Two ".modal" elements coexist once the nested "Save this split as a preset" dialog opens (the
  // Add-expense dialog underneath is a modal too) — the nested one is always the LAST child of
  // body (appended after), found reliably that way rather than by a bare ".modal" selector.
  const NESTED_MODAL = ".modal-backdrop:last-child .modal";
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E groceries (for preset)");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "30.00");
  await alice.choose("Split", "By shares", { scope: ".modal" });
  // Alice is checked under "Shared by" by default (everyone active); this split is only Bob and
  // Carol, so she is unchecked first (a real click via CDP coordinates, not a raw DOM .click(),
  // so the app's own "change" listener that recomputes the live preview actually fires).
  const aliceShareBoxAt = await alice.evaluate(`(() => {
    const set = [...document.querySelectorAll('.modal fieldset')].find((f) => ((f.querySelector('legend') || {}).textContent || '') === 'Shared by');
    const row = set && [...set.querySelectorAll('.split-row')].find((r) => r.querySelector('label').textContent.startsWith('Alice'));
    const box = row && row.querySelector('input[type="checkbox"]');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await alice.mouseClick(aliceShareBoxAt.x, aliceShareBoxAt.y);
  await alice.settle();
  await alice.fill({ name: "Shares for Bob Fictional", scope: ".modal" }, "2");
  await alice.fill({ name: "Shares for Carol Fictional", scope: ".modal" }, "1");
  await alice.click({ role: "button", name: "Save this split as a preset…", scope: ".modal" });
  await alice.waitFor(`!!document.querySelector('${NESTED_MODAL}')`, { what: "the save-preset dialog" });
  await alice.fill({ label: "Name", scope: NESTED_MODAL }, "E2E Bob and Carol, 2:1");
  await alice.click({ role: "button", name: "Save preset", scope: NESTED_MODAL });
  // Once the nested dialog closes, ".modal-backdrop:last-child" matches the OUTER Add-expense
  // dialog instead (it becomes the only, and so the last, one) — "gone" is checked by its own
  // title no longer appearing anywhere, never by a position-based selector re-matching something else.
  await alice.waitFor("![...document.querySelectorAll('.modal h2')].some((h) => h.textContent === 'Save this split as a preset')", { what: "the save-preset dialog to close" });
  await alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the Add expense dialog to close, discarding this draft — only the preset itself was meant to be kept" });

  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "a fresh Add shared expense dialog" });
  await alice.choose("Use a saved split", "E2E Bob and Carol, 2:1", { scope: ".modal" });
  const bobSharesValue = await alice.evaluate(`(() => {
    const set = [...document.querySelectorAll('.modal fieldset')].find((f) => ((f.querySelector('legend') || {}).textContent || '') === 'Shared by');
    const row = set && [...set.querySelectorAll('.split-row')].find((r) => r.querySelector('label').textContent.startsWith('Bob'));
    return row ? row.querySelector('input[type="text"]').value : null;
  })()`);
  t.check("applying the saved preset fills in Bob's 2 shares from it", { expected: "2", actual: bobSharesValue });
  await alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close" });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
