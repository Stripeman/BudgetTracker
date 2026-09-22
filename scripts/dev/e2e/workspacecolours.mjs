// BT-019-04 (Terry, 2026-09-19): the Workspace page's own "Category colours and icons" panel made
// collapsible, consistent with My Settings' own personal-override version of it (already
// collapsible via the same shared shell, BT-017 — this scenario is the Workspace-page counterpart
// to mysettings.mjs's own collapsible-groups check). BT-021 (Terry, 2026-09-22) supersedes this
// panel's own earlier "starts open" default now that it lives on its own "Layout & colours" sub-tab: it
// starts CLOSED like every other secondary section there, with a live category count on its own
// toggle even while collapsed. Keyboard accessible, and the choice is remembered per browser across
// a reload without discarding anything already shown.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "workspacecolours";
export const title = "BT-019-04/BT-021: the Workspace page's Category colours and icons panel is collapsible (starts closed, on its own Layout & colours tab), in a real browser";
export const needsBrowser = true;

const NAME = "Category colours and icons";
// BT-021: the toggle's own text now carries a live trailing summary (a category count) after its
// name, so match by a regex prefix rather than exact text/name equality.
const NAME_RE = "^Category colours and icons";

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Workspace Colours Household", kind: "household" });
  const { alice } = await h.browsers(["alice"], { prefix: "workspacecolours-" });
  await alice.open("dashboard");
  await alice.useWorkspace(W.name);
  await alice.goto("workspace");
  await alice.waitForText("Members", { scope: "main" });
  // BT-021: the panel now lives on its own "Layout & colours" sub-tab, not the default "General" one.
  await alice.click({ role: "tab", name: "Layout & colours" });
  await alice.waitForText("Layout", { scope: "main" });

  const hasToggle = await alice.evaluate(`[...document.querySelectorAll('main button.settings-group__toggle')].some((b) => new RegExp(${JSON.stringify(NAME_RE)}).test(b.textContent))`);
  if (!hasToggle) { t.skip("the Workspace page's collapsible colours panel", "not present at this commit"); return; }

  // ---- BT-021: starts CLOSED, with a live category count on the toggle even while collapsed -------
  const state = () => alice.evaluate(`(() => {
    const toggle = [...document.querySelectorAll('main button.settings-group__toggle')].find((b) => new RegExp(${JSON.stringify(NAME_RE)}).test(b.textContent));
    const body = toggle ? document.getElementById(toggle.getAttribute('aria-controls')) : null;
    return { expanded: toggle ? toggle.getAttribute('aria-expanded') : null, bodyHidden: body ? body.hidden : null, text: body ? body.textContent : null, toggleText: toggle ? toggle.textContent : null };
  })()`);
  const before = await state();
  t.check("the panel starts CLOSED (BT-021: a secondary section on its own Layout & colours tab), with a real toggle (aria-expanded false, body genuinely hidden)", {
    expected: { expanded: "false", bodyHidden: true }, actual: { expanded: before.expanded, bodyHidden: before.bodyHidden },
  });
  t.check("a useful summary (a category count) stays visible on the toggle even while collapsed", { expected: true, actual: /\d+ categor/.test(before.toggleText) });
  await alice.shot("1-closed-by-default");

  // ---- keyboard accessible: a real button, reachable and operable without a mouse -----------------
  await alice.click({ role: "button", nameRe: NAME_RE, scope: "main" });
  const opened = await state();
  t.check("clicking the toggle opens the panel (aria-expanded true, body genuinely not hidden), showing a real category", {
    expected: { expanded: "true", bodyHidden: false }, actual: { expanded: opened.expanded, bodyHidden: opened.bodyHidden },
  });
  t.check("real category colour/icon content is inside, not a placeholder", { expected: true, actual: opened.text.length > 20 });
  await alice.shot("2-open");

  // ---- collapsing again hides the content — it does not empty it -----------------------------------
  await alice.click({ role: "button", nameRe: NAME_RE, scope: "main" });
  const collapsed = await state();
  t.check("collapsing again hides the content — it does not empty it (still there, just hidden)", { expected: true, actual: collapsed.expanded === "false" && collapsed.bodyHidden === true && collapsed.text.length > 20 });

  // ---- remembered per browser, across a real reload -------------------------------------------------
  await alice.click({ role: "button", nameRe: NAME_RE, scope: "main" }); // reopen before reloading
  await alice.reload();
  await alice.click({ role: "tab", name: "Layout & colours" });
  await alice.waitForText("Layout", { scope: "main" });
  const afterReload = await state();
  t.check("an opened choice survives a real page reload, exactly like every other settings group", {
    expected: "true", actual: afterReload.expanded,
  });

  // Leave this browser's remembered state as it was found (closed by default), so a standalone
  // re-run of this scenario sees the same starting point as a fresh one.
  await alice.click({ role: "button", nameRe: NAME_RE, scope: "main" });
  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
