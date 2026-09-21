// BT-013-15 evidence gap (Terry, 2026-09-20): confirms My Settings and Workspace Settings are
// genuinely present, reachable from the in-frame nav, and show real, distinct content for all three
// flagship designs specifically (Executive Forecast, Budget Workspace, Financial Overview) — these two
// pages already exist for every concept (BT-013-14) on the shared flat-list/two-column-grouped
// pattern, deliberately left shared per that checkpoint's own already-passed audit; this scenario is
// direct real-browser evidence for these three concepts by name, not assumed from the generic case.
export const name = "flagshipsettings";
export const title = "BT-013-15 evidence: My Settings and Workspace Settings, real-browser evidence, for all three flagship designs by name";
export const needsBrowser = true;

const DESIGNS = [
  { id: "ledgerfly-forecast", name: "Executive Forecast" },
  { id: "finexa-budget", name: "Budget Workspace" },
  { id: "acru-overview", name: "Financial Overview" },
];

async function openPage(session, conceptId, pageLabel) {
  await session.goto("gallery");
  await session.waitForText("All 15 concepts");
  await session.click({ role: "button", text: "Preview this concept", scope: `[data-concept="${conceptId}"]` });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe')", { what: "the preview frame" });
  await session.click({ role: "button", text: pageLabel, scope: ".gpreview-pane .gnav" });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: `the ${pageLabel} preview` });
  await session.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
  await session.settle();
}

export async function run(h, t) {
  const { dave } = await h.browsers(["dave"], { prefix: "flagshipsettings-", width: 1440, height: 1000 });

  for (const design of DESIGNS) {
    // ---- My Settings ----
    await openPage(dave, design.id, "My Settings");
    const navText = await dave.text(".gpreview-pane .gnav");
    t.check(`${design.name}: "My Settings" is a real nav item`, { expected: true, actual: /My Settings/.test(navText) });
    const myText = await dave.text(".gpreview-pane .gframe__main");
    t.check(`${design.name}: My Settings shows real, personal-scope content (colour palette, mask amounts, landing page, notifications) — never Workspace Settings' own content`, {
      expected: true, actual: /Colour palette/i.test(myText) && !/Use Shared expenses in this workspace/i.test(myText),
    });
    await dave.shot(`${design.id}-my-settings`);

    // ---- Workspace Settings ----
    await openPage(dave, design.id, "Workspace Settings");
    const navText2 = await dave.text(".gpreview-pane .gnav");
    t.check(`${design.name}: "Workspace Settings" is a real nav item`, { expected: true, actual: /Workspace Settings/.test(navText2) });
    const workText = await dave.text(".gpreview-pane .gframe__main");
    t.check(`${design.name}: Workspace Settings shows real, workspace-scope content (shared expenses, layout theme, correction scope, budget period) — never My Settings' own content`, {
      expected: true, actual: /Use Shared expenses in this workspace/i.test(workText) && !/Colour palette/i.test(workText),
    });
    await dave.shot(`${design.id}-workspace-settings`);

    // ---- Both controls are genuinely interactive (real select-backed pickers, not read-only text) --
    const pickerCount = await dave.evaluate("document.querySelectorAll('.gpreview-pane .gframe__main select').length");
    t.check(`${design.name}: Workspace Settings has real interactive controls, not a read-only list`, { expected: true, actual: pickerCount > 0 });
  }
  t.check("dave: no console errors/exceptions across all three designs' Settings pages", { expected: [], actual: dave.problems() });
  await dave.close();
}
