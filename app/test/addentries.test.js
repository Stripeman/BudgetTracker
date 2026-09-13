// Why entries cannot be added, said plainly (Terry's preview check, 2026-09-14): a new workspace with
// no accounts told its owner "You can view this workspace but not add entries".
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { addEntriesBlocked } from "../js/ui/views/transactions.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const state = (role, accounts) => ({
  selectedWorkspaceId: "ws_1",
  workspaces: [{ id: "ws_1", name: "Fictional Trip", role }],
  accounts: { workspaceId: "ws_1", status: "ready", data: { accounts } },
});

test("an owner of a workspace without accounts is told to add an account, with the way there", () => {
  const note = addEntriesBlocked(state("owner", []));
  assert.match(note.textContent, /Add an account first: entries are recorded against an account/);
  assert.doesNotMatch(note.textContent, /view this workspace/);
  assert.equal(note.querySelector("a").getAttribute("href"), "#/accounts");
});

test("only a viewer is told they can only view", () => {
  assert.match(addEntriesBlocked(state("viewer", [])).textContent, /You can view this workspace but not add entries/);
  assert.match(addEntriesBlocked(state("viewer", []), "bills").textContent, /not add bills/);
});

test("a member whose only account is closed is told to add their own", () => {
  const note = addEntriesBlocked(state("member", [{ id: "acc_1", status: "closed", capabilities: ["create"] }]));
  assert.match(note.textContent, /Add an account first/);
  const other = addEntriesBlocked(state("member", [{ id: "acc_2", status: "open", capabilities: ["view-balances"] }]));
  assert.match(other.textContent, /None of the open accounts here lets you add entries/);
});

test("nothing is said before the accounts have loaded", () => {
  assert.equal(addEntriesBlocked({ selectedWorkspaceId: "ws_1", workspaces: [{ id: "ws_1", role: "owner" }] }), null);
});
