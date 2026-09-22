// BT-013-16 step 5 (Terry, 2026-09-21): Workspace settings — the page where the real Layout Picker
// itself lives — under each flagship layout. This page is already a `.grid.grid--two` of
// individually-carded sections (Members, Invite, Workspace settings, Layout, Backups and restore,
// Recent activity, Former members, Workspace changes, category/account/merchant types); every one of
// them stays completely shared and unchanged. Alice applies each flagship layout in turn (through the
// real Layout Picker itself), confirms every real card — including the Layout Picker card — still
// works, then confirms Classic is unaffected. ONE BROWSER.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "workspaceflagship";
export const title = "BT-013-16 step 5: Workspace settings (with the real Layout Picker itself) renders differently under each flagship layout, in a real browser";
export const needsBrowser = true;

const LAYOUT_CARD = 'section[aria-labelledby="ws-layout"]';

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Workspace Flagship Household", kind: "household" });
  const api = h.api("alice");

  const { alice } = await h.browsers(["alice"], { prefix: "workspaceflagship-", width: 1440, height: 1000 });
  await alice.open("workspace");
  await alice.useWorkspace(W.name);
  // BT-021 (2026-09-22): the Layout card now lives on its own "Layout & colours" sub-tab, not the default
  // "General" one — real ARIA tabs (role="tab"), so a real click is needed to reveal it. The choice
  // is remembered per browser (localStorage), so this ONE switch stays in effect through every
  // `reload()` below.
  await alice.click({ role: "tab", name: "Layout & colours" });
  await alice.waitForText("Executive Forecast", { scope: LAYOUT_CARD });
  t.check("Classic (the default) never shows the flagship wrapper", { expected: false, actual: await alice.evaluate(`!!document.querySelector('.dashflag')`) });

  const CASES = [
    { id: "ledgerfly-forecast", name: "Executive Forecast" },
    { id: "finexa-budget", name: "Budget Workspace" },
    { id: "acru-overview", name: "Financial Overview" },
  ];
  for (const c of CASES) {
    await applyLayout(api, W.ws.id, c.id);
    await alice.reload();
    await alice.waitFor("!!document.querySelector('.dashflag')", { what: `the ${c.name} flagship arrangement` });
    // BT-021: Members/Backups (General) and Layout/Currently applied (Layout & colours) are now on
    // separate real tabs — each checked on its own tab, both still inside the SAME `.dashflag`
    // flagship wrapper (the tab bar and its panels are all reparented together as one unit).
    const appearanceText = await alice.text(".dashflag");
    t.check(`${c.name}: the Layout Picker card itself is still present and shows what is currently applied`, {
      expected: true, actual: appearanceText.includes("Layout") && appearanceText.includes("Currently applied"),
    });
    await alice.click({ role: "tab", name: "General" });
    const generalText = await alice.text(".dashflag");
    t.check(`${c.name}: Members and Backups and restore are still present on General`, {
      expected: true, actual: generalText.includes("Members") && generalText.includes("Backups and restore"),
    });
    const shot = await alice.shot(`${c.id}`);
    t.note(`screenshot of Workspace settings (General tab) under ${c.name}: ${shot}`);
    await alice.click({ role: "tab", name: "Layout & colours" });
  }

  // ---- the real Layout Picker card still lets Alice apply a different layout from here -------------
  // The loop above ends with "acru-overview" (Financial Overview) already applied, so target a
  // DIFFERENT card here (Executive Forecast) — otherwise its own Apply button would already be
  // disabled as "Currently applied".
  await alice.waitForText("Executive Forecast", { scope: LAYOUT_CARD });
  const applyBtn = await alice.evaluate(`(() => {
    const cs = [...document.querySelectorAll(${JSON.stringify(`${LAYOUT_CARD} article.layoutpicker-card`)})];
    const card = cs.find((c) => { const h = c.querySelector('h3'); return h && h.textContent === "Executive Forecast"; });
    const btn = card ? [...card.querySelectorAll('button')].find((b) => b.textContent === "Apply to workspace") : null;
    if (!btn) return null;
    btn.scrollIntoView({ block: "center" });
    const at = btn.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  })()`);
  if (!applyBtn) throw new Error("could not find the Layout Picker's own Apply button under a flagship layout");
  await alice.mouseClick(applyBtn.x, applyBtn.y);
  // The picker's own transient "applied" status text clears itself the moment its data reload
  // finishes (already-established behaviour from an earlier checkpoint) — the durable, checkable
  // proof is the "Currently applied" badge moving to the new card, and the real, persisted setting.
  await alice.waitFor(`(() => {
    const cs = [...document.querySelectorAll(${JSON.stringify(`${LAYOUT_CARD} article.layoutpicker-card`)})];
    const card = cs.find((c) => { const h = c.querySelector('h3'); return h && h.textContent === "Executive Forecast"; });
    return !!card && card.textContent.includes("Currently applied");
  })()`, { what: "Executive Forecast's own card to show Currently applied" });
  const applied = await api.ok("workspaces", { query: { id: W.ws.id } });
  t.check("the real Layout Picker card, itself inside the flagship wrapper, still applies a real layout change", { expected: "ledgerfly-forecast", actual: applied.workspace.settingValues.layoutId });

  // ---- back to Classic ------------------------------------------------------------------------
  await applyLayout(api, W.ws.id, "classic");
  await alice.reload();
  await alice.waitForText("Executive Forecast", { scope: LAYOUT_CARD });
  t.check("switching back to Classic removes the flagship wrapper entirely", { expected: false, actual: await alice.evaluate(`!!document.querySelector('.dashflag')`) });

  t.check("alice: no console errors/exceptions across every layout", { expected: [], actual: alice.problems() });
  await alice.close();
}
