// Arranging FICTIONAL data through the real API, as the fictional users themselves.
import { newIdempotencyKey } from "./api.mjs";

export const DISPLAY = Object.freeze({ alice: "Alice Fictional", bob: "Bob Fictional", carol: "Carol Fictional", dave: "Dave Siteadmin", eve: "Eve Outsider" });

// The first record in a create response, whatever its key (`account`, `transaction`, `recurring`...).
export function firstRecord(out) {
  if (!out || typeof out !== "object") return null;
  for (const v of Object.values(out)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof v.id === "string") return v;
    if (Array.isArray(v) && v[0] && typeof v[0].id === "string") return v[0];
  }
  return null;
}

// A workspace owned by `owner`, with the other fictional users invited and accepted in the given roles.
export async function createWorkspace(h, { owner = "alice", name, kind = "household", currency = "EUR", members = {} }) {
  const a = h.api(owner);
  const ws = (await a.ok("workspaces", { method: "POST", body: { name, kind, reportingCurrency: currency }, idempotencyKey: newIdempotencyKey() })).workspace;
  const q = { workspaceId: ws.id };
  for (const [user, role] of Object.entries(members)) {
    const inv = await a.ok("invitations", { method: "POST", query: q, body: { email: `${user}@example.com`, role } });
    await h.api(user).ok("invitations", { method: "POST", query: { action: "accept" }, body: { workspaceId: ws.id, token: inv.token } });
  }
  const list = (await a.ok("members", { query: q })).members;
  const memberOf = (user) => {
    const m = list.find((x) => x.name === DISPLAY[user]) || list.find((x) => String(x.name || "").startsWith(DISPLAY[user].split(" ")[0]));
    if (!m) throw new Error(`${user} is not a member of ${name}.`);
    return m;
  };
  return { ws, id: ws.id, name, q, members: list, memberOf, ref: (user) => `member:${memberOf(user).id}` };
}
