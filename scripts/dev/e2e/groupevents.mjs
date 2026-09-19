// BT-009-20/21, in a real browser: creating a named shared-expense event, adding an expense to it,
// switching between the combined (all-events) view and one event's own scoped view, and closing an
// event blocking a new expense while a payment can still be recorded against it.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "groupevents";
export const title = "BT-009-20/21: the shared-expense event directory, picker and lifecycle, in a real browser";
export const needsBrowser = true;

const EVENTS = '[aria-labelledby="grp-events"]';
const EXPENSES = '[aria-labelledby="grp-expenses"]';

export async function run(h, t) {
  const api = (u) => h.api(u);
  const W = await createWorkspace(h, { name: "E2E Events Trip", kind: "group", members: { bob: "member" } });
  const { alice } = await h.browsers(["alice"], { prefix: "groupevents-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(EVENTS))) { t.skip("shared-expense events in the browser", "the Events card is not present at this commit"); return; }

  const eventsText = await alice.text(EVENTS);
  t.check("the events card states the honest access-scope note before anything else", { expected: true, actual: eventsText.includes("do not change who can see them") });

  // ---- 1. Create a named event and confirm it switches straight to viewing it --------------------
  await alice.click({ role: "button", name: "Add event…", scope: EVENTS });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add event dialog" });
  await alice.fill({ label: "Name", scope: ".modal" }, "E2E Ski trip");
  await alice.shot("1-add-event-dialog");
  await alice.click({ role: "button", name: "Add event", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText('Showing only "E2E Ski trip"', { scope: "main" });

  // ---- 2. Add an expense while viewing this event; it must belong to it, not the workspace default -
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E lift passes");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "80.00");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("E2E lift passes", { scope: EXPENSES });

  // ---- 3. Back to the combined view: the event now shows one real expense counted against it ------
  await alice.click({ role: "button", name: "Show every event combined", scope: EVENTS });
  await alice.waitFor(`!document.querySelector('${EVENTS}')?.textContent.includes('Showing only')`, { what: "the combined view banner to clear" });
  const afterAdd = await alice.text(EVENTS);
  t.check("back in the combined view, the event directory shows the real expense count", { expected: true, actual: /E2E Ski trip[\s\S]*1 expense, 0 payments/.test(afterAdd.replace(/\s+/g, " ")) });

  // ---- 4. Close the event: a new expense against it is refused; a payment still works -------------
  await alice.click({ role: "button", name: "Close E2E Ski trip", scope: EVENTS });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Close event confirm dialog" });
  await alice.shot("2-close-event-dialog");
  await alice.click({ role: "button", name: "Close", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after confirming" });
  await alice.waitForText("Closed", { scope: EVENTS });

  await alice.click({ role: "button", name: "View only E2E Ski trip", scope: EVENTS });
  await alice.waitForText('Showing only "E2E Ski trip"', { scope: "main" });
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E too late");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "5.00");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!!document.querySelector('.modal .modal__error')?.textContent", { what: "the server's refusal to show" });
  const refusalText = await alice.text(".modal__error");
  t.check("a new expense against a CLOSED event is refused, in the server's own words", { expected: true, actual: /closed/i.test(refusalText) });
  await alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close" });

  // Recording a payment against the closed event is still allowed ("settlement/dispute resolution
  // remains possible", Terry, 2026-09-19).
  await alice.click({ role: "button", name: "Record a payment", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Record a payment dialog" });
  await alice.choose("From", "Bob Fictional", { scope: ".modal" });
  await alice.choose("To", "Alice Fictional (you)", { scope: ".modal" });
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "40.00");
  await alice.click({ role: "button", name: "Record payment", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after recording" });
  t.check("a payment against a closed event is still recorded", { expected: true, actual: (await alice.text()).includes("40.00") });

  // ---- 5. BT-009-23: a real click on the event's own "Export…" downloads only its own expense -----
  // Same real-download-success pattern as BT-014-06 (permanentdelete.mjs): openExportModal() only
  // shows "Downloaded." once the fetch/Blob/anchor-click path resolves without throwing. The same
  // authorized export is independently re-fetched here (a plain API call) to inspect the actual
  // scoped content the button just downloaded.
  await alice.click({ role: "button", name: "Export E2E Ski trip", scope: EVENTS });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Export dialog" });
  await alice.waitForText('Export "E2E Ski trip"', { scope: ".modal" });
  await alice.click({ role: "button", name: "CSV", scope: ".modal" });
  await alice.waitForText("Downloaded.", { scope: ".modal" });
  await alice.click({ role: "button", name: "Close", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close" });
  const skiEventId = (await api("alice").ok("group", { query: { ...W.q, action: "events" } })).events.find((e) => e.name === "E2E Ski trip").id;
  const scopedExport = await api("alice").ok("group", { query: { ...W.q, action: "export", format: "json", eventId: skiEventId } });
  const scopedReport = JSON.parse(scopedExport.content);
  t.check("the real CSV click downloaded successfully (dialog reached \"Downloaded.\"); the same event, fetched directly, contains only its own expense", {
    expected: { descriptions: ["E2E lift passes"], filenameHasEventName: true },
    actual: { descriptions: scopedReport.expenses.map((e) => e.description), filenameHasEventName: /ski-trip/.test(scopedExport.filename) },
  });

  await alice.settle();
  // The one 409 above (a new expense refused against a closed event) is the deliberate subject of
  // this scenario's own check just above, not an unexpected problem.
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems({ allowHttp: [{ status: 409, path: /\/api\/group/ }] }) });
}
