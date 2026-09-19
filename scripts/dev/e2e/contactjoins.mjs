// BT-009-15 frontend (Terry's split-costs check, 2026-09-14): "Invite someone" on the Workspace
// page can link an invitation to an existing workspace contact, so accepting continues that
// contact's shared-expense history as the new member — proven here in a real browser, through the
// real invitation/acceptance/balance round trip, not just the API-level unit tests.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "contactjoins";
export const title = "BT-009-15: linking an invitation to a contact on the Workspace page continues that contact's shared-expense history as the new member, in a real browser";
export const needsBrowser = true;

const eur = (v) => v.balances.find((b) => b.currency === "EUR");
const rowOf = (v, ref) => eur(v).rows.find((r) => r.ref === ref);

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Contact Joins Group", kind: "group" });
  const alice = h.api("alice");
  const dana = firstRecord(await alice.ok("contacts", { method: "POST", query: W.q, body: { scope: "workspace", workspaceId: W.id, name: "E2E Dana Contact" } }));
  // Dana (a contact, not yet a member) pays for and shares a 60.00 dinner with Alice.
  await alice.ok("group", { method: "POST", query: W.q, body: { description: "E2E dinner", date: "2026-09-14", amount: "60.00", payers: [{ ref: dana.ref, amount: "60.00" }], split: { method: "equal", lines: [{ ref: dana.ref }, { ref: W.ref("alice") }] } } });

  const { alice: s } = await h.browsers(["alice"], { prefix: "contactjoins-" });
  await s.open("dashboard");
  await s.useWorkspace(W.name);
  await s.goto("workspace");
  await s.waitForText("Invite someone", { scope: "main" });

  const INVITE = 'section[aria-labelledby="ws-invite"]';
  await s.fill({ label: "Email", scope: INVITE }, "carol@example.com");
  // The real command picker (BT-004-05), not a native <select>: open it, read the REAL rendered
  // option rows, close it again — the same mechanism `choose()` uses just below, checked
  // explicitly first so a missing option is its own clear failure, not folded into `choose()`'s.
  const contactTrigger = await s.locate({ css: ".cmdpick__trigger", label: "Link to an existing contact (optional)", scope: INVITE });
  await s.mouseClick(contactTrigger.x, contactTrigger.y);
  await s.waitFor("!!document.querySelector('.cmdpick__panel:not([hidden])')", { what: "the contact list to open" });
  const contactOptions = await s.evaluate("[...document.querySelectorAll('.cmdpick__panel:not([hidden]) .cmdpick__optlabel')].map((n) => n.textContent)");
  await s.press("Escape");
  t.check("the contact picker on the real page offers Dana (not yet joined) alongside \"Not linked\"", {
    expected: { notLinked: true, dana: true }, actual: { notLinked: contactOptions.includes("Not linked to a contact"), dana: contactOptions.includes("E2E Dana Contact") },
  });
  await s.choose("Link to an existing contact (optional)", "E2E Dana Contact", { scope: INVITE });
  await s.click({ role: "button", name: "Create invitation", scope: INVITE });
  await s.waitForText("continues E2E Dana Contact's shared-expense history", { scope: INVITE });
  await s.waitForText("linking to E2E Dana Contact", { scope: INVITE });

  const link = await s.evaluate(`(() => { const l = [...document.querySelectorAll('${INVITE} label')].find((x) => x.textContent.includes('Invitation link')); const f = l && document.getElementById(l.getAttribute('for')); return f ? f.value : null; })()`);
  t.note(`invitation link shown: ${link}`);
  // The query string sits after the hash (#/join?ws=...&token=...), not as the URL's own search —
  // this is a hash-routed single-page app, so `new URL(link).searchParams` would always be empty.
  const token = link ? new URLSearchParams(link.split("?")[1] || "").get("token") : null;
  t.check("a real, usable invitation link (with a real token) was shown", { expected: true, actual: !!token });

  // Carol accepts (through the real API, exactly like every other e2e fixture's own accept step —
  // there is no dedicated "join" page UI in this app yet to click through).
  const accepted = await h.api("carol").ok("invitations", { method: "POST", query: { action: "accept" }, body: { workspaceId: W.id, token } });
  const carolRef = `member:${accepted.memberId}`;

  // Carol (now a real member) pays for a 20.00 taxi under her own new ref.
  await h.api("carol").ok("group", { method: "POST", query: W.q, body: { description: "E2E taxi", date: "2026-09-15", amount: "20.00", payers: [{ ref: carolRef, amount: "20.00" }], split: { method: "equal", lines: [{ ref: carolRef }, { ref: W.ref("alice") }] } } });
  const view = await alice.ok("group", { query: W.q });
  t.check("Dana's pre-join dinner and Carol's post-join taxi combine into ONE balance row under the member ref, with no separate contact row left", {
    expected: { combinedPaid: "80.00", noContactRow: true },
    actual: { combinedPaid: (rowOf(view, carolRef) || {}).paid, noContactRow: !rowOf(view, dana.ref) },
  });

  await s.reload();
  await s.waitForText("Members", { scope: "main" });
  const membersText = await s.evaluate('document.querySelector(\'section[aria-labelledby="ws-members"]\').innerText');
  t.check("the Members list, in the real browser, shows Carol as having been the contact she was linked to", { expected: true, actual: membersText.includes("was contact: E2E Dana Contact") });

  await s.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: s.problems() });
}
