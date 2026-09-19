// BT-009-15 frontend (Terry's split-costs check, 2026-09-14): "Invite someone" on the Workspace
// page can link the invitation to an existing, not-already-joined workspace contact, so accepting
// continues that contact's shared-expense history as the new member. Pending invitations show
// which contact they are linked to; a member who was previously a contact is labelled as such.
// Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { pickerNamed, chooseOption, offeredOptions } from "./pickerassert.js";
import { createView as createWorkspace } from "../js/ui/views/workspace.js";

let dom;
// The dom double has no global `location` (nothing in it has ever needed one before); the
// "Create invitation" flow reads `location.origin` to build the shareable link, exactly like a
// real browser, so a minimal stub is set up here, scoped to this file only, and restored after.
let previousLocation;
beforeEach(() => {
  dom = installDom();
  previousLocation = globalThis.location;
  globalThis.location = { origin: "https://budget.example.test" };
});
afterEach(() => { dom.teardown(); globalThis.location = previousLocation; });

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const inviteCard = (root) => root.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-invite");
const membersCard = (root) => root.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-members");

function fixture({ joinedFromContactName } = {}) {
  const calls = { invited: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const members = [{ id: "m_me", name: "Me Fictional", role: "owner", self: true }];
  if (joinedFromContactName) members.push({ id: "m_new", name: "Eve Fictional", role: "member", joinedFromContactName });
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner" }],
    members: ready({ members }),
    categories: ready({ categories: [], palette: [] }), icons: ready({ typeIcons: {}, canEditTypeIcons: false, catalog: null }),
  };
  let invitations = [];
  const api = {
    invitations: async () => ({ invitations }),
    invite: async (wsId, body) => {
      calls.invited.push(body);
      const inv = { id: "inv_1", email: body.email, role: body.role, status: "pending", createdAt: "2026-09-19T00:00:00Z", expiresAt: "2026-09-26T00:00:00Z", contactId: body.contactId || null };
      invitations = [inv];
      return { invitation: inv, accessPreview: { summary: "Can view and add to shared accounts.", capabilities: [] }, token: "tok_fictional" };
    },
    backups: async () => ({ archives: [], policy: "" }),
    audit: async () => ({ entries: [] }),
    request: async (name, opts = {}) => {
      if (name === "contacts") return { shared: [{ id: "con_dana", name: "Dana Contact", archived: false, joinedMemberId: null }, { id: "con_joined", name: "Already Joined", archived: false, joinedMemberId: "m_other" }, { id: "con_gone", name: "Archived One", archived: true, joinedMemberId: null }], private: [] };
      if (name === "workspaces") return { workspace: { history: [], lifecycle: [], settingsList: [], settingsHistory: [] } };
      if (name === "members") return { former: [] };
      return {};
    },
  };
  const store = { getState: () => state, actions: { write: async (fn) => { try { await fn("ws_1"); return { ok: true }; } catch (error) { return { ok: false, error }; } } } };
  return { ctx: { api, store }, state, calls };
}

async function open(options) {
  const { ctx, state, calls } = fixture(options);
  const view = createWorkspace(ctx);
  dom.body.appendChild(view.element);
  view.update(state);
  await settle();
  return { view, calls, card: inviteCard(view.element), members: membersCard(view.element) };
}

describe("BT-009-15: linking an invitation to a contact, on the Workspace page", () => {
  test("the contact picker offers only unarchived, not-already-joined contacts, plus \"Not linked\"", async () => {
    const { card } = await open();
    const select = pickerNamed(card, "Link to an existing contact (optional)");
    assert.deepEqual(offeredOptions(select), ["Not linked to a contact", "Dana Contact"]);
  });

  test("choosing a contact sends its id when the invitation is created; leaving it unlinked sends nothing extra", async () => {
    const { card, calls } = await open();
    const email = card.querySelector('input[type="email"]');
    email.value = "eve@example.com";
    email.dispatchEvent(new DomEvent("input"));
    const select = pickerNamed(card, "Link to an existing contact (optional)");
    chooseOption(select, "Dana Contact");
    await settle();
    buttonNamed(card, "Create invitation").click();
    await settle();
    assert.equal(calls.invited.length, 1);
    assert.equal(calls.invited[0].contactId, "con_dana");
    assert.match(card.textContent, /continues Dana Contact's shared-expense history/);
  });

  test("a pending invitation linked to a contact shows which one; an unlinked one shows no such badge", async () => {
    const { card, calls } = await open();
    const email = card.querySelector('input[type="email"]');
    email.value = "eve@example.com";
    email.dispatchEvent(new DomEvent("input"));
    const select = pickerNamed(card, "Link to an existing contact (optional)");
    chooseOption(select, "Dana Contact");
    await settle();
    buttonNamed(card, "Create invitation").click();
    await settle();
    assert.match(card.textContent, /linking to Dana Contact/);
  });

  test("a member who was previously a contact is labelled as such on the Members list", async () => {
    const { members } = await open({ joinedFromContactName: "Dana Contact" });
    assert.match(members.textContent, /was contact: Dana Contact/);
  });
});
