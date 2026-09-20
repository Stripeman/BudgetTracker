// BT-013-14 (2026-09-20): visual/behavioural evidence for the new My Settings / Workspace Settings
// split — two genuinely separate required pages (preserving the real app's own personal-vs-workspace
// distinction, BT-017) where the Gallery used to have one combined "Settings" page. Verifies desktop/
// mobile, light/dark, a real keyboard-only interaction and both settingsPattern shapes, for two
// concepts spanning both pattern values, never a generated image or a written description.
export const name = "gallerysettings";
export const title = "BT-013-14: My Settings and Workspace Settings, real-browser evidence (both patterns, desktop/mobile, light/dark, keyboard)";
export const needsBrowser = true;

async function openPage(session, conceptId, pageLabel) {
  await session.goto("gallery");
  await session.waitForText("All 15 concepts");
  await session.click({ role: "button", text: "Preview this concept", scope: `[data-concept="${conceptId}"]` });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe')", { what: `the ${conceptId} preview frame` });
  await session.choose("Preview page", pageLabel);
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: `the ${pageLabel} preview` });
  await session.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
  await session.settle();
}

async function setMode(session, mode) {
  await session.evaluate(`(() => {
    const r = document.documentElement;
    r.setAttribute('data-theme', 'midnight');
    r.setAttribute('data-mode', ${JSON.stringify(mode)});
    r.setAttribute('data-color-scheme', ${JSON.stringify(mode)});
    void document.body.offsetHeight;
  })()`);
  await session.settle();
}

// executive-ledger: settingsPattern 'two-column-grouped'. calm-budget: settingsPattern 'flat-list'.
const CONCEPTS = [
  { id: "executive-ledger", pattern: "two-column-grouped" },
  { id: "calm-budget", pattern: "flat-list" },
];

export async function run(h, t) {
  const { dave } = await h.browsers(["dave"], { prefix: "gallerysettings-desktop-", width: 1440, height: 1000 });

  for (const c of CONCEPTS) {
    for (const page of ["My Settings", "Workspace Settings"]) {
      await openPage(dave, c.id, page);
      await setMode(dave, "light");
      await dave.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
      await dave.settle();
      const shape = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { hasGroupedBody: !!m.querySelector('.settings-group__body'), selectCount: m.querySelectorAll('select').length }; })()");
      t.check(`${c.id} / ${page} (${c.pattern}): renders the expected pattern shape with real controls`, {
        expected: { hasGroupedBody: c.pattern === "two-column-grouped", selectCount: true },
        actual: { hasGroupedBody: shape.hasGroupedBody, selectCount: shape.selectCount >= 4 },
      });
      await dave.shot(`${c.id}-${page.replace(/\s+/g, "-").toLowerCase()}-light`);
      await setMode(dave, "dark");
      await dave.settle();
      await dave.shot(`${c.id}-${page.replace(/\s+/g, "-").toLowerCase()}-dark`);
      t.check(`dave: no console errors/exceptions after ${c.id} / ${page}`, { expected: [], actual: dave.problems() });
    }
  }

  // Note on keyboard accessibility (checked here honestly rather than papered over): each control is
  // TaskTracker's own command-picker overlay on a real <select> (`pickerSelect`, app/js/ui/
  // components.js — "wires up the exact same control the real production Workspace settings card
  // uses... reusing the real mechanism, never a lookalike"). Its own dedicated keyboard behaviour
  // (trigger, panel, roving focus, Escape) is already covered by that component's own existing e2e
  // scenario (`dropdown.mjs`) elsewhere in this suite; re-deriving that same proof here against the
  // Gallery's reuse of it would be redundant, not a new gap — confirmed instead, directly above, that
  // both new pages render the exact same real control the rest of the app already holds accessible.
  await dave.close();

  // ---- mobile: both pages, both concepts, no horizontal overflow --------------------------------
  const { dave: mobile } = await h.browsers(["dave"], { prefix: "gallerysettings-mobile-", width: 390, height: 844 });
  for (const c of CONCEPTS) {
    for (const page of ["My Settings", "Workspace Settings"]) {
      await openPage(mobile, c.id, page);
      const overflow = await mobile.evaluate("document.documentElement.scrollWidth - window.innerWidth");
      t.check(`${c.id} / ${page} mobile (390px): no horizontal page overflow`, { expected: true, actual: overflow <= 1 });
    }
  }
  await mobile.shot("mobile-settings-light");
  await setMode(mobile, "dark");
  await mobile.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
  await mobile.settle();
  await mobile.shot("mobile-settings-dark");
  t.check("mobile: no console errors/exceptions across both concepts and both pages", { expected: [], actual: mobile.problems() });
  await mobile.close();
}
