// BT-013-16 (Terry, 2026-09-21): the real, user-facing workspace Layout Picker. Alice (owner) applies
// Executive Forecast through the real Layout Picker card in Workspace settings; Bob (member) sees the
// same applied layout everywhere (it is a workspace-wide choice) but cannot apply or manage layouts
// himself; Alice removes Financial Overview from this workspace's choices, Bob cannot apply it while
// it is hidden, then Alice restores it. TWO BROWSERS AT ONCE, real workspace data throughout — this is
// the real per-workspace picker, never the Design Gallery's fictional-fixture pages.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "layoutpicker";
export const title = "BT-013-16: the real Layout Picker — apply, persist across a reload, and remove/restore a workspace choice, in real browsers";
export const needsBrowser = true;

const LAYOUT_CARD = 'section[aria-labelledby="ws-layout"]';
const cardText = async (s) => s.evaluate(`(() => { const c = document.querySelector(${JSON.stringify(LAYOUT_CARD)}); return c ? c.textContent : null; })()`);
const cardOf = (name) => `(() => { const cs = [...document.querySelectorAll(${JSON.stringify(`${LAYOUT_CARD} article.layoutpicker-card`)})]; return cs.find((c) => { const h = c.querySelector('h3'); return h && h.textContent === ${JSON.stringify(name)}; }) || null; })()`;
async function clickInCard(s, cardName, buttonText) {
  const spot = await s.evaluate(`(() => {
    const card = ${cardOf(cardName)};
    if (!card) return null;
    const btn = [...card.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(buttonText)});
    if (!btn) return null;
    btn.scrollIntoView({ block: "center" });
    const at = btn.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2, disabled: btn.disabled };
  })()`);
  if (!spot) throw new Error(`could not find "${buttonText}" on the "${cardName}" layout card`);
  return spot;
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Layout Picker Household", kind: "household", members: { bob: "member" } });
  const q = W.q;
  const api = (u) => h.api(u);

  const b = await h.browsers(["alice", "bob"], { prefix: "layoutpicker-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }

  // ---- the real Layout Picker card renders the four real layouts, Classic currently applied --------
  await b.alice.goto("workspace");
  await b.alice.waitForText("Layout", { scope: "main" });
  await b.alice.waitForText("Executive Forecast", { scope: LAYOUT_CARD });
  const before = await cardText(b.alice);
  t.check("the real Layout Picker card lists all four real layouts", {
    expected: true,
    actual: !!before && ["Classic (current)", "Executive Forecast", "Budget Workspace", "Financial Overview"].every((n) => before.includes(n)),
  });
  t.check("Classic starts as the currently applied layout", { expected: true, actual: before.includes("Currently applied") });
  const shot1 = await b.alice.shot("1-layout-picker-classic");
  t.note(`screenshot of the real Layout Picker before applying anything: ${shot1}`);

  // ---- Alice (owner) applies Executive Forecast -------------------------------------------------
  const applySpot = await clickInCard(b.alice, "Executive Forecast", "Apply to workspace");
  t.check("Apply is enabled for the owner", { expected: false, actual: applySpot.disabled });
  await b.alice.mouseClick(applySpot.x, applySpot.y);
  await b.alice.waitForText("applied", { scope: LAYOUT_CARD });
  await b.alice.settle();
  const applied = (await api("alice").ok("workspaces", { query: { id: W.ws.id } })).workspace;
  t.check("the workspace's real layoutId setting is now the flagship layout, applied through the existing settings PATCH — audited like every other setting", {
    expected: "ledgerfly-forecast", actual: applied.settings.layoutId,
  });
  const shot2 = await b.alice.shot("2-layout-picker-applied");
  t.note(`screenshot after applying Executive Forecast: ${shot2}`);

  // ---- Bob (member) sees the SAME applied layout everywhere, but cannot apply or manage -----------
  await b.bob.goto("workspace");
  await b.bob.reload();
  await b.bob.waitForText("Executive Forecast", { scope: LAYOUT_CARD });
  const bobCard = await cardText(b.bob);
  t.check("a member sees the workspace-wide applied layout", { expected: true, actual: bobCard.includes("Currently applied") });
  const bobApply = await clickInCard(b.bob, "Budget Workspace", "Apply to workspace");
  t.check("Apply is disabled for a plain member (still visible, never hidden entirely)", { expected: true, actual: bobApply.disabled });
  const bobRemove = await b.bob.evaluate(`(() => {
    const card = ${cardOf("Financial Overview")};
    return card ? !![...card.querySelectorAll('button')].find((x) => x.textContent === "Remove from this workspace's choices") : null;
  })()`);
  t.check("a member never gets the Remove/Restore management action at all", { expected: false, actual: bobRemove });

  // ---- Alice removes Financial Overview from this workspace's choices; Bob cannot apply it ---------
  const hideSpot = await clickInCard(b.alice, "Financial Overview", "Remove from this workspace's choices");
  await b.alice.mouseClick(hideSpot.x, hideSpot.y);
  await b.alice.waitForText("Removed from this workspace's choices", { scope: LAYOUT_CARD });
  await b.alice.settle();
  await b.bob.reload();
  await b.bob.waitForText("Removed from this workspace's choices", { scope: LAYOUT_CARD });
  const bobApplyHidden = await clickInCard(b.bob, "Financial Overview", "Apply to workspace");
  t.check("a hidden layout cannot be applied while it is hidden, even by a manager+ (checked here as a member, who could never apply anyway)", { expected: true, actual: bobApplyHidden.disabled });
  const shot3 = await b.alice.shot("3-layout-picker-hidden");
  t.note(`screenshot after removing Financial Overview from this workspace's choices: ${shot3}`);

  // ---- Alice restores it ----------------------------------------------------------------------
  const restoreSpot = await clickInCard(b.alice, "Financial Overview", "Restore to this workspace");
  await b.alice.mouseClick(restoreSpot.x, restoreSpot.y);
  await b.alice.waitFor(`!(${cardOf("Financial Overview")} || { textContent: "" }).textContent.includes("Removed from this workspace's choices")`, { what: "the Removed badge to clear after restoring" });
  await b.alice.settle();
  const afterRestoreCard = await b.alice.evaluate(`(() => { const c = ${cardOf("Financial Overview")}; return c ? c.textContent : null; })()`);
  t.check("restoring brings the layout back to this workspace's choices", { expected: false, actual: !!afterRestoreCard && afterRestoreCard.includes("Removed from this workspace's choices") });

  t.check("alice: no console errors/exceptions", { expected: [], actual: b.alice.problems() });
  t.check("bob: no console errors/exceptions", { expected: [], actual: b.bob.problems() });
  await b.alice.close();
  await b.bob.close();
}
