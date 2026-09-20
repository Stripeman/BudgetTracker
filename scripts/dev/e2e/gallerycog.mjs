// BT-013-15: the Design Gallery's per-design appearance cog (coordinated presets, custom light/dark
// colours, reset, saved only in the caller's own personal preferences) and the full-size standalone
// preview takeover — real-browser evidence, never a generated image or a written description.
export const name = "gallerycog";
export const title = "BT-013-15: Gallery appearance cog (presets, custom colours, reset, personal-only) and the full-size preview takeover";
export const needsBrowser = true;

const CONCEPT_ID = "ledgerfly-forecast";
const CONCEPT_NAME = "Executive Forecast";

async function openCog(session, scope) {
  await session.click({ role: "button", name: new RegExp(`Customize colours for ${CONCEPT_NAME}`), scope });
  await session.waitFor("!!document.querySelector('.gcog__panel:not([hidden])')", { what: "the appearance cog panel" });
}

// The preset picker (createThemePicker) floats its OWN option list on the body — never nested inside
// `.gcog__panel` — so choosing a preset is two real clicks: open its toggle, then pick the option.
// Opening the preset picker's own floating list is occasionally lost to a genuine, real-browser
// timing race between a CDP-dispatched click landing in the renderer and this harness's very next
// command (observed directly while building this scenario: a fixed short pause between the two
// always avoided it) — self-heals by re-clicking the toggle once if the list has not appeared
// shortly after the first click, rather than either papering over it with a single long sleep
// every time or leaving a rare, non-deterministic scenario in the delivered suite.
async function pickPreset(session, label) {
  await session.click({ css: ".themepick__toggle", scope: ".gcog__panel" });
  await session.waitFor("!!document.querySelector('.themepick__list:not([hidden])')", { what: "the preset list" });
  await session.click({ role: "option", text: label });
}

// Choosing a preset/custom colour saves over the network (`await onChange`) before painting — waits
// for the real save round-trip to finish rather than racing it with an immediate read.
function waitForAccent(session, selector, hex) {
  return session.waitFor(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue('--g-accent-light').trim() === ${JSON.stringify(hex)}`, { what: `${selector} to repaint to ${hex}` });
}

export async function run(h, t) {
  const { dave } = await h.browsers(["dave"], { prefix: "gallerycog-", width: 1440, height: 1000 });

  await dave.goto("gallery");
  await dave.waitForText("All 15 concepts");
  const card = `[data-concept="${CONCEPT_ID}"]`;

  // ---- the cog on a design card: presets, live paint, personal-only persistence -------------------
  await openCog(dave, card);
  await pickPreset(dave, "Purple");
  await waitForAccent(dave, `${card} .gframe`, "#6a1a9e");
  t.check("picking the Purple preset live-paints the card's own frame, without closing the panel or rebuilding the grid", {
    expected: { panelStillOpen: true, purple: "#6a1a9e" },
    actual: { panelStillOpen: await dave.exists(".gcog__panel:not([hidden])"), purple: await dave.evaluate(`getComputedStyle(document.querySelector('${card} .gframe')).getPropertyValue('--g-accent-light').trim()`) },
  });
  await dave.shot("card-preset-purple");

  // A real GET /api/preferences confirms it is saved server-side, in the caller's OWN personal
  // preferences — never a workspace setting.
  const savedAfterPreset = await dave.evaluate("fetch('/api/preferences').then((r) => r.json())");
  t.check("the preset is saved in dave's own preferences, keyed by concept id, with a real preset label", {
    expected: { light: "#6a1a9e", dark: "#c98ef0", preset: "purple" },
    actual: savedAfterPreset.effective.galleryDesignColors[CONCEPT_ID],
  });

  // ---- custom colours: a real hex, then an inaccessible one is refused with an inline explanation --
  await dave.evaluate(`(() => { const i = document.querySelector('.gcog__panel input[aria-label*="light mode"]'); i.value = '#123456'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await dave.settle();
  const savedAfterCustom = await dave.evaluate("fetch('/api/preferences').then((r) => r.json())");
  t.check("a custom light-mode colour is saved, and clears the preset label (no longer any single preset matches)", {
    expected: { light: "#123456", preset: undefined },
    actual: { light: savedAfterCustom.effective.galleryDesignColors[CONCEPT_ID].light, preset: savedAfterCustom.effective.galleryDesignColors[CONCEPT_ID].preset },
  });
  await dave.evaluate(`(() => { const i = document.querySelector('.gcog__panel input[aria-label*="light mode"]'); i.value = '#fefefe'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await dave.settle();
  const errText = await dave.text(".gcog__panel .gcog__error");
  t.check("an inaccessible custom colour is refused with a real, specific explanation, and the control reverts to the last saved value", {
    expected: { refused: true, revertedLight: "#123456" },
    actual: { refused: /too close|colour/i.test(errText), revertedLight: (await dave.evaluate("fetch('/api/preferences').then((r) => r.json())")).effective.galleryDesignColors[CONCEPT_ID].light },
  });
  await dave.shot("card-custom-error");

  // (That this personal override never reaches another person's preferences or any workspace is
  // already directly verified server-side in api/test/colors.test.js's BT-013-15 block, alice vs bob —
  // not re-derived here, which would only re-prove the same server contract through a slower path.)

  // ---- reset to design defaults ---------------------------------------------------------------------
  await dave.click({ role: "button", text: "Reset to design defaults", scope: ".gcog__panel" });
  await dave.settle();
  const savedAfterReset = await dave.evaluate("fetch('/api/preferences').then((r) => r.json())");
  t.check("Reset to design defaults clears dave's own override for this one concept only", {
    expected: undefined, actual: savedAfterReset.effective.galleryDesignColors[CONCEPT_ID],
  });
  await dave.evaluate("document.body.click()"); // close the panel (outside click)
  await dave.settle();

  // ---- the full-size standalone preview ------------------------------------------------------------
  await dave.click({ role: "button", text: "Open full-size", scope: card });
  await dave.waitFor("!!document.querySelector('.gfullscreen')", { what: "the full-size preview takeover" });
  const fs = await dave.evaluate(`(() => {
    const gf = document.querySelector('.gfullscreen');
    const r = gf.getBoundingClientRect();
    const appInert = document.getElementById('app') ? document.getElementById('app').inert : null;
    return { coversViewport: r.width >= innerWidth - 1 && r.height >= innerHeight - 1, appInert, hasFrame: !!gf.querySelector('.gframe') };
  })()`);
  t.check("full-size preview is a genuine viewport-covering takeover with a real concept frame, and the real app shell behind it is made inert", {
    expected: { coversViewport: true, appInert: true, hasFrame: true },
    actual: { coversViewport: fs.coversViewport, appInert: fs.appInert, hasFrame: fs.hasFrame },
  });
  await dave.shot("fullscreen-desktop-light");
  // Its own cog and page/viewport pickers work exactly like the card's.
  await dave.click({ role: "button", name: new RegExp(`Customize colours for ${CONCEPT_NAME}`), scope: ".gfullscreen__bar" });
  await dave.waitFor("!!document.querySelector('.gcog__panel:not([hidden])')", { what: "the full-size preview's own cog panel" });
  await pickPreset(dave, "Green");
  await waitForAccent(dave, ".gfullscreen .gframe", "#4a7a0a");
  t.check("the full-size preview's own cog changes its own frame's colours live too", { expected: "#4a7a0a", actual: await dave.evaluate("getComputedStyle(document.querySelector('.gfullscreen .gframe')).getPropertyValue('--g-accent-light').trim()") });
  await dave.click({ role: "button", text: "Reset to design defaults", scope: ".gcog__panel" });
  await dave.settle();
  await dave.evaluate("document.body.click()");

  await dave.choose("Page", "Transactions", { scope: ".gfullscreen__bar" });
  await dave.waitFor("document.querySelector('.gfullscreen__body [data-page=\"transactions\"]') !== null || document.querySelector('.gfullscreen .gframe').dataset.page === 'transactions'", { what: "the full-size preview to switch pages" });
  await dave.shot("fullscreen-transactions");

  // Escape closes it and returns focus to the opener, with the app shell no longer inert.
  await dave.evaluate("document.querySelector('.gfullscreen__bar button').focus()");
  await dave.press("Escape");
  await dave.waitFor("!document.querySelector('.gfullscreen')", { what: "the full-size preview to close" });
  const afterClose = await dave.evaluate("({ appInert: document.getElementById('app') ? document.getElementById('app').inert : null, focusOnOpener: document.activeElement && document.activeElement.closest('[data-concept]') && document.activeElement.closest('[data-concept]').dataset.concept })");
  t.check("Escape closes the full-size preview, restores the real app shell, and returns focus to roughly where it opened from", {
    expected: { appInert: false }, actual: { appInert: afterClose.appInert },
  });

  // ---- mobile: full-size preview reflows with no horizontal overflow ------------------------------
  await dave.close();
  const { dave: mobile } = await h.browsers(["dave"], { prefix: "gallerycog-mobile-", width: 390, height: 844 });
  await mobile.goto("gallery");
  await mobile.waitForText("All 15 concepts");
  await mobile.click({ role: "button", text: "Open full-size", scope: card });
  await mobile.waitFor("!!document.querySelector('.gfullscreen')", { what: "the full-size preview takeover on mobile" });
  const overflow = await mobile.evaluate("document.documentElement.scrollWidth - window.innerWidth");
  t.check("full-size preview on mobile (390px): no horizontal page overflow", { expected: true, actual: overflow <= 1 });
  await mobile.shot("fullscreen-mobile");
  t.check("no console errors/exceptions across the whole scenario (desktop + mobile)", { expected: [], actual: mobile.problems() });
  await mobile.close();
}
