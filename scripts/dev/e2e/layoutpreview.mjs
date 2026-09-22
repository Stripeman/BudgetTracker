// BT-013-16 (Terry, 2026-09-21) step 3: the full-size Layout Preview — a client-only, ephemeral
// override of which layout the CURRENT browser renders, never a server write, restored to the real
// applied layout on exit, and disabling financial mutations while active. Alice (owner) previews
// Executive Forecast from the real Layout Picker, confirms it opens the Dashboard at full size with
// the workspace and layout named, navigates to another page and confirms the banner is still there
// (a genuine session, not per-page state), confirms Add expense is blocked, exits without applying
// (nothing changed), then previews again and Applies (the real setting persists). Bob (member)
// previews too but never sees Apply. TWO BROWSERS AT ONCE.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "layoutpreview";
export const title = "BT-013-16 step 3: the real Layout Preview — full-size, persists across navigation, read-only, Apply/Exit, in real browsers";
export const needsBrowser = true;

const LAYOUT_CARD = 'section[aria-labelledby="ws-layout"]';
const cardOf = (name) => `(() => { const cs = [...document.querySelectorAll(${JSON.stringify(`${LAYOUT_CARD} article.layoutpicker-card`)})]; return cs.find((c) => { const h = c.querySelector('h3'); return h && h.textContent === ${JSON.stringify(name)}; }) || null; })()`;
async function clickPreview(s, cardName) {
  const spot = await s.evaluate(`(() => {
    const card = ${cardOf(cardName)};
    const btn = card ? [...card.querySelectorAll('button')].find((b) => b.textContent === "Preview") : null;
    if (!btn) return null;
    btn.scrollIntoView({ block: "center" });
    const at = btn.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  })()`);
  if (!spot) throw new Error(`could not find Preview on "${cardName}"`);
  await s.mouseClick(spot.x, spot.y);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Layout Preview Household", kind: "household", members: { bob: "member" } });
  const api = (u) => h.api(u);

  const b = await h.browsers(["alice", "bob"], { prefix: "layoutpreview-", width: 1440, height: 1000 });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }

  // ---- Alice previews Executive Forecast from the real Layout Picker -------------------------------
  await b.alice.goto("workspace");
  // BT-021 (2026-09-22): the Layout card now lives on its own "Layout & colours" sub-tab, remembered per
  // browser for the rest of this session (including the later re-visit at line ~79 below).
  await b.alice.click({ role: "tab", name: "Layout & colours" });
  await b.alice.waitForText("Executive Forecast", { scope: LAYOUT_CARD });
  await clickPreview(b.alice, "Executive Forecast");
  await b.alice.waitFor("!!document.querySelector('.dashflag')", { what: "the previewed flagship Dashboard" });
  const bannerText = await b.alice.text(".preview-banner");
  t.check("the banner opens at full size (the real Dashboard itself, not a small inset), naming the layout and workspace", {
    expected: true, actual: /Previewing Executive Forecast/.test(bannerText) && bannerText.includes("E2E Layout Preview Household") && /read-only/.test(bannerText),
  });
  const shot1 = await b.alice.shot("1-preview-dashboard");
  t.note(`screenshot of the full-size preview: ${shot1}`);

  // ---- the preview REMAINS ACTIVE while navigating between pages -----------------------------------
  await b.alice.goto("transactions");
  await b.alice.settle();
  const bannerStillThere = await b.alice.evaluate(`(() => { const el = document.querySelector('.preview-banner'); return !!el && !el.hidden; })()`);
  t.check("the preview banner is still shown after navigating to a different page (one continuous session, not per-page state)", { expected: true, actual: bannerStillThere });

  // ---- financial mutations are refused while previewing --------------------------------------------
  await b.alice.goto("dashboard");
  await b.alice.settle();
  const addDisabled = await b.alice.evaluate(`(() => { const h = document.querySelector('.page-head__actions'); const btn = h ? h.querySelector('button') : null; return !!btn && btn.disabled; })()`);
  t.check("the primary Add-expense action is disabled while previewing, explaining why, rather than opening a form that would be refused anyway", { expected: true, actual: addDisabled });

  // ---- Exit preview restores the real layout instantly, with no server write -----------------------
  const before = await api("alice").ok("workspaces", { query: { id: W.ws.id } });
  await b.alice.click({ role: "button", name: "Exit preview" });
  await b.alice.waitFor("!document.querySelector('.dashflag')", { what: "the Dashboard to return to Classic" });
  const after = await api("alice").ok("workspaces", { query: { id: W.ws.id } });
  t.check("exiting a preview never changes the workspace's real, saved layout", { expected: before.workspace.settingValues.layoutId, actual: after.workspace.settingValues.layoutId });
  t.check("exiting removes the banner", { expected: true, actual: await b.alice.evaluate(`document.querySelector('.preview-banner').hidden`) });

  // ---- Bob (member) may preview too, but never sees Apply — only owners/managers change the default -
  await b.bob.goto("workspace");
  await b.bob.click({ role: "tab", name: "Layout & colours" });
  await b.bob.waitForText("Financial Overview", { scope: LAYOUT_CARD });
  await clickPreview(b.bob, "Financial Overview");
  await b.bob.waitFor("!!document.querySelector('.dashflag')", { what: "Bob's previewed Dashboard" });
  const bobHasApply = await b.bob.evaluate(`(() => { const btn = [...document.querySelectorAll('.preview-banner button')].find((x) => x.textContent === "Apply to workspace"); return !!btn && !btn.hidden; })()`);
  t.check("a plain member previewing never sees Apply in the banner", { expected: false, actual: bobHasApply });
  await b.bob.click({ role: "button", name: "Exit preview" });

  // ---- Alice previews again and Applies: the real setting persists, visible to Bob too --------------
  await b.alice.goto("workspace");
  await b.alice.waitForText("Financial Overview", { scope: LAYOUT_CARD });
  await clickPreview(b.alice, "Financial Overview");
  await b.alice.waitFor("!!document.querySelector('.dashflag')", { what: "the previewed Financial Overview Dashboard" });
  await b.alice.click({ role: "button", name: "Apply to workspace", scope: ".preview-banner" });
  await b.alice.waitFor("document.querySelector('.preview-banner').hidden", { what: "the banner to close after a successful Apply" });
  await b.alice.settle();
  const applied = await api("alice").ok("workspaces", { query: { id: W.ws.id } });
  t.check("Apply from the banner persists the real, audited settings change", { expected: "acru-overview", actual: applied.workspace.settingValues.layoutId });
  await b.bob.reload();
  await b.bob.waitFor("!!document.querySelector('.dashflag')", { what: "Bob to see the newly applied layout, unprompted" });

  t.check("alice: no console errors/exceptions", { expected: [], actual: b.alice.problems() });
  t.check("bob: no console errors/exceptions", { expected: [], actual: b.bob.problems() });
  await b.alice.close();
  await b.bob.close();
}
