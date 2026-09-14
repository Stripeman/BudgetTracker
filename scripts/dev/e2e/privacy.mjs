// PRIVACY: Alice's private account is invisible to Bob (member), Carol (viewer), Dave (a site
// administrator who is also a manager here) and Eve (an outsider), in their browsers and through
// the API; Eve and Dave get "not found" for workspaces they are not in, the same answer as for a
// workspace that does not exist.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";
import { newIdempotencyKey } from "../harness/api.mjs";

export const name = "privacy";
export const title = "Alice's private account is invisible to Bob, Carol, Dave (site admin) and Eve, in the UI and the API";
export const needsBrowser = true;

const HIDDEN = { account: "Alice Hidden Reserve", note: "E2E-HIDDEN-NOTE fictional", opening: "4321.00" };
const SHARED = "E2E Shared Checking";
// What would appear if the private account leaked into a list or a total: its name, its note, its
// balance (4,321.00 opening, 4,308.66 after the 12.34 entry), and the shared account's 100.00 plus it.
const UI_LEAKS = [HIDDEN.account, HIDDEN.note, "4,321.00", "4,308.66", "4,421.00", "4,408.66"];

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Privacy Household", kind: "household", members: { bob: "member", carol: "viewer", dave: "manager" } });
  const alice = h.api("alice");
  const hidden = firstRecord(await alice.ok("accounts", { method: "POST", query: W.q, body: { name: HIDDEN.account, type: "savings", currency: "EUR", openingBalance: HIDDEN.opening }, idempotencyKey: newIdempotencyKey() }));
  const shared = firstRecord(await alice.ok("accounts", { method: "POST", query: W.q, body: { name: SHARED, type: "checking", currency: "EUR", visibility: "shared", openingBalance: "100.00" }, idempotencyKey: newIdempotencyKey() }));
  const entry = firstRecord(await alice.ok("transactions", { method: "POST", query: W.q, body: { accountId: hidden.id, kind: "expense", amount: "12.34", notes: HIDDEN.note }, idempotencyKey: newIdempotencyKey() }));
  const secrets = [hidden.id, HIDDEN.account, HIDDEN.note, "4321", entry ? entry.id : hidden.id];

  // ---- API ------------------------------------------------------------------------------------------
  const own = await alice.request("accounts", { query: W.q });
  t.check("alice (control): her own account list includes the private account", { expected: true, actual: own.ok && own.text.includes(hidden.id) });

  const surfaces = [
    ["accounts", W.q], ["transactions", W.q], ["transactions", { ...W.q, accountId: hidden.id }],
    ["transactions", { ...W.q, action: "history", transactionId: entry ? entry.id : "" }], ["forecast", W.q], ["budgets", W.q],
    ["recurring", W.q], ["payees", W.q], ["group", W.q], ["members", W.q], ["workspaces", { id: W.id }], ["audit", W.q],
    ["grants", { ...W.q, accountId: hidden.id }], ["backups", W.q],
  ];
  for (const user of ["bob", "carol", "dave"]) {
    const api = h.api(user);
    const list = await api.request("accounts", { query: W.q });
    t.check(`${user} (control): sees the shared account through the API`, { expected: { status: 200, shared: true }, actual: { status: list.status, shared: list.text.includes(shared.id) } });
    for (const [route, query] of surfaces) {
      const r = await api.request(route, { query });
      const leaked = secrets.filter((s) => r.text.includes(s));
      const shown = Object.keys(query).filter((k) => k !== "workspaceId").map((k) => `${k}=...`).join("&");
      t.check(`${user}: GET /api/${route}${shown ? `?${shown}` : ""} reveals nothing of the private account`, {
        expected: { leaked: [], serverError: false }, actual: { status: r.status, leaked, serverError: r.status >= 500 }, pass: !leaked.length && r.status < 500,
      });
    }
  }

  // Not found, exactly as for a workspace that does not exist (no existence oracle).
  const cut = W.id.indexOf("_") + 1;
  const bogus = W.id.slice(0, cut) + W.id[cut].repeat(W.id.length - cut);
  const household = ((await alice.ok("workspaces")).workspaces || []).find((w) => w.name === "Fictional Household");
  const outsiders = [["eve", W.id, "E2E Privacy Household"], ...(household ? [["dave", household.id, "the seeded Fictional Household (Dave is not a member)"]] : [])];
  for (const [user, wsId, label] of outsiders) {
    const api = h.api(user);
    for (const [route, query] of [["workspaces", { id: wsId }], ["accounts", { workspaceId: wsId }], ["transactions", { workspaceId: wsId }], ["group", { workspaceId: wsId }], ["members", { workspaceId: wsId }]]) {
      const real = await api.request(route, { query });
      const fake = await api.request(route, { query: { ...query, [query.id ? "id" : "workspaceId"]: bogus } });
      t.check(`${user}: GET /api/${route} for ${label} is not found, the same as a workspace that does not exist`, {
        expected: { status: 404, sameAsMissing: true, leaked: [] },
        actual: { status: real.status, sameAsMissing: real.status === fake.status && real.code === fake.code && real.message === fake.message, leaked: secrets.filter((s) => real.text.includes(s)) },
      });
    }
  }

  // ---- browsers ------------------------------------------------------------------------------------
  const b = await h.browsers(["alice", "bob", "carol", "dave", "eve"], { prefix: "privacy-" });
  await b.alice.open("accounts");
  await b.alice.useWorkspace(W.name);
  await b.alice.goto("accounts");
  t.check("alice (control): her Accounts page shows her private account", { expected: true, actual: (await b.alice.text()).includes(HIDDEN.account) });
  await b.alice.shot("accounts");

  for (const user of ["bob", "carol", "dave"]) {
    const s = b[user];
    await s.open("dashboard");
    await s.useWorkspace(W.name);
    for (const route of ["dashboard", "accounts", "transactions", "bills", "planning", "group"]) {
      await s.goto(route);
      const text = await s.text();
      t.check(`${user}: the ${route} page shows nothing of the private account`, { expected: [], actual: UI_LEAKS.filter((x) => text.includes(x)) });
      if (route === "accounts") {
        t.check(`${user} (control): the Accounts page shows the shared account`, { expected: true, actual: text.includes(SHARED) });
        await s.shot("accounts");
      }
    }
  }

  await b.eve.open("accounts");
  const eveText = await b.eve.text();
  t.check("eve: her browser shows no workspace of Alice's and nothing of the private account", {
    expected: { workspacePicker: false, leaked: [] },
    actual: { workspacePicker: await b.eve.exists(".picker--workspace"), leaked: [...UI_LEAKS, W.name, "Fictional Household"].filter((x) => eveText.includes(x)) },
  });
  await b.eve.shot("accounts");

  for (const user of ["alice", "bob", "carol", "dave", "eve"]) {
    t.check(`${user}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: b[user].problems() });
  }
}
