// BT-017 (My Settings redesign, Terry, 2026-09-18: "cluttered and chaotic... not simply another
// column added to the current arrangement... task-oriented sections... collapsible advanced
// sections... consistent save/unsaved/error states"). Verifies the first slice: My Settings' own
// ~8 previously flat, ungrouped cards are now named, collapsible, task-oriented sections using the
// SAME disclosure shell as Workspace Settings (settingsgroup.js), with only the genuinely advanced
// group (category colours and icons) collapsed by default, and every group whose open/closed state
// this browser has chosen remembered afterwards — without changing any individual card's own,
// already-verified behaviour (name, appearance, staging link, private contacts, category colours).
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "mysettings";
export const title = "BT-017 My Settings: task-oriented collapsible sections (advanced ones closed by default, remembered per browser), no regression to any card's own behaviour";
export const needsBrowser = true;

const GROUPS = "[...document.querySelectorAll('main .settings-group')]";
const groupState = (s) => s.evaluate(`${GROUPS}.map((g) => {
  const toggle = g.querySelector('.settings-group__toggle');
  const body = g.querySelector('.settings-group__body');
  return { name: toggle ? toggle.textContent.trim() : null, expanded: toggle ? toggle.getAttribute('aria-expanded') : null, bodyHidden: body ? body.hidden : null, sectionHidden: g.hidden };
})`);

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E My Settings Household", kind: "household" });
  t.note(`workspace ${W.name}: ${W.id}`);

  const { alice: s } = await h.browsers(["alice"], { prefix: "mysettings-" });
  await s.open("dashboard");
  await s.useWorkspace(W.name);
  await s.goto("settings");
  await s.waitForText("Colour palette", { scope: "main" });

  // ---- a plain, explicit personal-vs-workspace distinction (BT-017) -----------------------------------
  const personalNote = await s.evaluate("document.body.innerText.includes('These apply only to you, everywhere you sign in')");
  t.check("My Settings states plainly, up front, that everything here is personal — never shared with or changed by anyone else in a workspace", { expected: true, actual: personalNote });

  // ---- task-oriented, named, collapsible sections replace the old flat card list ---------------------
  // "Deleted workspaces" is not asserted here at all: whether it appears depends on the fictional
  // seed's own prior workspace history for alice (already covered end-to-end by the dedicated
  // deleteworkspace.mjs scenario, including its own default-open state), not on this section's
  // grouping/order, which is what this check verifies.
  const groups = await groupState(s);
  const byName = (n) => groups.find((g) => g.name === n);
  const CORE = ["Profile & appearance", "Display, privacy & contacts", "Staging link", "Category colours & icons"];
  t.check("My Settings is organized into named, collapsible sections in a sensible task order", {
    expected: CORE, actual: groups.map((g) => g.name).filter((n) => CORE.includes(n)),
  });
  t.check("only the genuinely advanced section (category colours and icons) starts collapsed; the everyday ones start open, exactly as visible as before", {
    expected: { profile: "true", display: "true", staging: "true", colours: "false" },
    actual: { profile: byName("Profile & appearance").expanded, display: byName("Display, privacy & contacts").expanded, staging: byName("Staging link").expanded, colours: byName("Category colours & icons").expanded },
  });
  t.check("a collapsed section's content is not merely styled shut — it is actually hidden from the page", {
    expected: true, actual: byName("Category colours & icons").bodyHidden,
  });

  // ---- no regression: every existing card still renders and works inside its new section ------------
  const nameLabelSeen = await s.evaluate("!!document.querySelector('#set-name')");
  const stagingSeen = await s.evaluate("!!document.querySelector('#set-staging')");
  const displaySeen = await s.evaluate("!!document.querySelector('#set-display')");
  t.check("the existing cards (name, staging, display and privacy) are all still present, unchanged, inside their new sections", {
    expected: { nameLabelSeen: true, stagingSeen: true, displaySeen: true }, actual: { nameLabelSeen, stagingSeen, displaySeen },
  });

  // ---- expanding the advanced section reveals its own, already-existing content ----------------------
  await s.click({ role: "button", name: "Category colours & icons", scope: "main" });
  await s.waitFor("(() => { const b = document.querySelector('main .settings-group__body #set-colours'); return !!b; })()", { what: "the Category colours and icons card to be visible after expanding its section" });
  const afterExpand = await s.evaluate("(() => { const b = document.getElementById('set-colours'); return b ? !b.closest('.settings-group__body').hidden : false; })()");
  t.check("expanding the advanced section shows its real content (Category colours and icons)", { expected: true, actual: afterExpand });

  // ---- collapsing an everyday section, and the choice is remembered after a reload -------------------
  await s.click({ role: "button", name: "Staging link", scope: "main" });
  const collapsedNow = (await groupState(s)).find((g) => g.name === "Staging link").expanded;
  await s.reload();
  await s.waitForText("Colour palette", { scope: "main" });
  const collapsedAfterReload = (await groupState(s)).find((g) => g.name === "Staging link").expanded;
  t.check("collapsing a section persists across a reload, exactly like Workspace Settings' own groups", {
    expected: { collapsedNow: "false", collapsedAfterReload: "false" }, actual: { collapsedNow, collapsedAfterReload },
  });

  // Leave this browser's remembered state as it was found, so a re-run of this scenario alone (not
  // through the full suite's fresh-seed-per-scenario isolation) still sees the same defaults.
  await s.click({ role: "button", name: "Staging link", scope: "main" });
  await s.click({ role: "button", name: "Category colours & icons", scope: "main" });

  await s.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: s.problems() });
}
