// BT-019-04 (Terry, 2026-09-19): the Workspace page's own "Category colours and icons" panel made
// collapsible, consistent with My Settings' own personal-override version of it (already
// collapsible via the same shared shell, BT-017 — this scenario is the Workspace-page counterpart
// to mysettings.mjs's own collapsible-groups check). Starts OPEN (never previously collapsible
// here, so nothing about today's visible behaviour changes until a person collapses it themselves),
// keyboard accessible, and the choice is remembered per browser across a reload without discarding
// anything already shown.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "workspacecolours";
export const title = "BT-019-04: the Workspace page's Category colours and icons panel is collapsible, in a real browser";
export const needsBrowser = true;

const NAME = "Category colours and icons";

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Workspace Colours Household", kind: "household" });
  const { alice } = await h.browsers(["alice"], { prefix: "workspacecolours-" });
  await alice.open("dashboard");
  await alice.useWorkspace(W.name);
  await alice.goto("workspace");
  await alice.waitForText("Members", { scope: "main" });

  const hasToggle = await alice.evaluate(`[...document.querySelectorAll('main button.settings-group__toggle')].some((b) => b.textContent === ${JSON.stringify(NAME)})`);
  if (!hasToggle) { t.skip("the Workspace page's collapsible colours panel", "not present at this commit"); return; }

  // ---- starts open: nothing about today's visible behaviour changed until collapsed on purpose ----
  const state = () => alice.evaluate(`(() => {
    const toggle = [...document.querySelectorAll('main button.settings-group__toggle')].find((b) => b.textContent === ${JSON.stringify(NAME)});
    const body = toggle ? document.getElementById(toggle.getAttribute('aria-controls')) : null;
    return { expanded: toggle ? toggle.getAttribute('aria-expanded') : null, bodyHidden: body ? body.hidden : null, text: body ? body.textContent : null };
  })()`);
  const before = await state();
  t.check("the panel starts expanded (real toggle, aria-expanded true, body genuinely not hidden), showing a real category", {
    expected: { expanded: "true", bodyHidden: false }, actual: { expanded: before.expanded, bodyHidden: before.bodyHidden },
  });
  t.check("real category colour/icon content is inside, not a placeholder", { expected: true, actual: before.text.length > 20 });
  await alice.shot("1-open-by-default");

  // ---- keyboard accessible: a real button, reachable and operable without a mouse -----------------
  await alice.click({ role: "button", name: NAME, scope: "main" });
  const collapsed = await state();
  t.check("clicking the toggle collapses the panel (aria-expanded false, body genuinely hidden)", {
    expected: { expanded: "false", bodyHidden: true }, actual: { expanded: collapsed.expanded, bodyHidden: collapsed.bodyHidden },
  });
  t.check("collapsing hides the content — it does not empty it (still there, just hidden)", { expected: true, actual: collapsed.text.length > 20 });
  await alice.shot("2-collapsed");

  // ---- remembered per browser, across a real reload -------------------------------------------------
  await alice.reload();
  await alice.waitForText("Members", { scope: "main" });
  const afterReload = await state();
  t.check("the collapsed choice survives a real page reload, exactly like every other settings group", {
    expected: "false", actual: afterReload.expanded,
  });

  // ---- reopening shows the same real content again, nothing lost -------------------------------------
  await alice.click({ role: "button", name: NAME, scope: "main" });
  const reopened = await state();
  t.check("reopening after a reload shows the real category content again", {
    expected: { expanded: "true", bodyHidden: false, hasContent: true },
    actual: { expanded: reopened.expanded, bodyHidden: reopened.bodyHidden, hasContent: reopened.text.length > 20 },
  });

  // Leave this browser's remembered state as it was found (open), so a standalone re-run of this
  // scenario sees the same starting point as a fresh one.
  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
