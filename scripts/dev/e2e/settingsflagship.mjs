// BT-013-16 step 5 (Terry, 2026-09-21): My Settings under each flagship layout. Everything on this
// page is personal — never a financial mutation, never gated by the preview read-only guard. Every
// real settings group (Profile & appearance, Display/privacy, Contacts) stays completely shared and
// unchanged; only the surrounding card wrapper for the currently selected workspace's flagship
// layout differs. ONE BROWSER.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "settingsflagship";
export const title = "BT-013-16 step 5: My Settings renders the current workspace's real layout differently, personal controls unchanged, in a real browser";
export const needsBrowser = true;

async function applyLayout(api, wsId, layoutId) {
  const out = await api.ok("workspaces", { method: "PATCH", query: { id: wsId }, body: { settings: { layoutId } } });
  if (out.workspace.settingValues.layoutId !== layoutId) throw new Error(`layout did not apply: ${layoutId}`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Settings Flagship Household", kind: "household" });
  const api = h.api("alice");

  const { alice } = await h.browsers(["alice"], { prefix: "settingsflagship-", width: 1440, height: 1000 });
  await alice.open("settings");
  await alice.useWorkspace(W.name);
  await alice.waitForText("Appearance", { scope: "main" });
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
    const text = await alice.text(".dashflag");
    t.check(`${c.name}: every real settings group is still present`, { expected: true, actual: text.includes("Appearance") && text.includes("Display and privacy") && text.includes("Private contacts") });
    const shot = await alice.shot(`${c.id}`);
    t.note(`screenshot of My Settings under ${c.name}: ${shot}`);
  }

  // ---- a real personal preference change still works under a flagship layout, unaffected ----------
  // "Use device setting" is checked by default; unchecking it is a real, simple, always-enabled
  // personal-preference control (the day/night switch itself is aria-disabled while following the
  // device, a separate, unrelated state this checkpoint does not need to unwind).
  await alice.click({ label: "Use device setting" });
  await alice.settle();
  const nowFollowing = await alice.evaluate(`document.querySelector('.daynight input[type="checkbox"]').checked`);
  t.check("a real personal preference control still works under a flagship layout, unaffected by preview or layout state", { expected: false, actual: nowFollowing });

  // ---- back to Classic ------------------------------------------------------------------------
  await applyLayout(api, W.ws.id, "classic");
  await alice.reload();
  await alice.waitForText("Appearance", { scope: "main" });
  t.check("switching back to Classic removes the flagship wrapper entirely", { expected: false, actual: await alice.evaluate(`!!document.querySelector('.dashflag')`) });

  t.check("alice: no console errors/exceptions across every layout", { expected: [], actual: alice.problems() });
  await alice.close();
}
