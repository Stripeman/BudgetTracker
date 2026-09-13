'use strict';
// Workspace backup and restore planning (BT-002).
//
// SNAPSHOT CONSISTENCY: a workspace is one document, so one read is a consistent snapshot of every
// financial record, ownership and grant. Attachments are content-addressed (sha256) and immutable.
//
// VALIDATE THE BYTES THAT ARE ENCRYPTED (review finding 3): the payload is serialized first, parsed
// back, validated, sealed, then test-opened and compared byte-for-byte before a backup counts.
//
// PRIVACY OF RECOVERY: archives stay in separate backup storage and are never handed to users. A
// restore is limited to what the caller may manage — shared records for workspace owners and the
// caller's own private accounts — so a workspace owner can neither read nor roll back another
// member's private records. Previews return counts, never financial payloads (finding 5).
//
// ACCESS IS NEVER RESURRECTED: archived members, grants, invitations and idempotency records are
// never restored. Replace and merge keep the workspace's CURRENT membership and grants; create-new
// starts with the requester as sole owner and no grants.
const { createHash } = require('node:crypto');
const { HttpError, safeParse, conflict } = require('./http');
const { newId } = require('./ids');
const money = require('./money');
const ledger = require('./ledger');
const { readDocument, stampDocument, CURRENT } = require('./schema');
const archive = require('./archive');
const audit = require('./audit');

const invalidData = (detail) => new HttpError(422, 'backup_invalid', `The workspace data failed an integrity check (${detail}). Nothing has been changed.`);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ---- financial invariants ------------------------------------------------------------------
function uniqueIds(list, name) {
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r.id !== 'string' || seen.has(r.id)) throw invalidData(`${name} ids`);
    seen.add(r.id);
  }
  return seen;
}

function checkInvariants(doc) {
  if (!doc || typeof doc !== 'object') throw invalidData('document');
  const accounts = new Map((doc.accounts || []).map((a) => [a.id, a]));
  uniqueIds(doc.accounts || [], 'account');
  const categories = uniqueIds(doc.categories || [], 'category');
  const payees = uniqueIds(doc.payees || [], 'payee');
  uniqueIds(doc.transactions || [], 'transaction');
  uniqueIds(doc.members || [], 'member');
  uniqueIds(doc.budgets || [], 'budget');
  uniqueIds(doc.recurring || [], 'recurring');
  // A commitment belongs to its source account; a dangling one would be counted nowhere (BT-008).
  for (const r of doc.recurring || []) {
    const a = accounts.get(r.accountId);
    if (!a || r.currency !== a.currency) throw invalidData('bill account');
    if (!Array.isArray(r.versions) || !r.versions.length || !r.versions.every((v) => money.isMinor(v.amountMinor) && v.amountMinor > 0)) throw invalidData('bill amounts');
  }
  for (const a of accounts.values()) {
    if (!money.isCurrency(a.currency) || !money.isMinor(a.openingBalanceMinor)) throw invalidData('account amounts');
  }
  const pairs = new Map();
  for (const t of doc.transactions || []) {
    const a = accounts.get(t.accountId);
    if (!a || t.currency !== a.currency || !money.isMinor(t.amountMinor) || t.amountMinor === 0) throw invalidData('transaction amounts');
    if (t.categoryId && !categories.has(t.categoryId)) throw invalidData('transaction category');
    if (t.payeeId && !payees.has(t.payeeId)) throw invalidData('transaction payee');
    // Direction follows kind; transfers are exactly the entries with a transfer id.
    if (ledger.OUTFLOW.has(t.kind) && t.amountMinor > 0) throw invalidData('transaction direction');
    if (ledger.INFLOW.has(t.kind) && t.amountMinor < 0) throw invalidData('transaction direction');
    if ((t.kind === 'transfer') !== Boolean(t.transferId)) throw invalidData('transfer kind');
    if (Array.isArray(t.splits) && t.splits.length) {
      let total;
      try { total = money.sum(t.splits.map((s) => s.amountMinor)); } catch { throw invalidData('split amounts'); }
      if (total !== t.amountMinor) throw invalidData('split totals');
      for (const s of t.splits) {
        if (s.categoryId && !categories.has(s.categoryId)) throw invalidData('split category');
        if (Math.sign(s.amountMinor) !== Math.sign(t.amountMinor)) throw invalidData('split direction');
      }
    }
    if (t.transferId) pairs.set(t.transferId, [...(pairs.get(t.transferId) || []), t]);
  }
  for (const legs of pairs.values()) {
    if (legs.length === 1 && legs[0].counterpartExcluded === true) {
      if (accounts.has(legs[0].counterpartAccountId)) throw invalidData('transfer counterpart');
      continue;
    }
    if (legs.length !== 2 || legs[0].accountId === legs[1].accountId) throw invalidData('transfer pairs');
    if (legs[0].counterpartAccountId !== legs[1].accountId || legs[1].counterpartAccountId !== legs[0].accountId) throw invalidData('transfer counterpart');
    if (Math.sign(legs[0].amountMinor) === Math.sign(legs[1].amountMinor)) throw invalidData('transfer direction');
    if (Boolean(legs[0].deletedAt) !== Boolean(legs[1].deletedAt)) throw invalidData('transfer deletion state');
    if (legs[0].currency === legs[1].currency && legs[0].amountMinor + legs[1].amountMinor !== 0) throw invalidData('transfer balance');
  }
  return pairs.size;
}

function balances(doc) {
  const out = new Map((doc.accounts || []).map((a) => [a.id, a.openingBalanceMinor]));
  for (const t of doc.transactions || []) if (!t.deletedAt && out.has(t.accountId)) out.set(t.accountId, out.get(t.accountId) + t.amountMinor);
  return out;
}

function manifestOf(doc, attachments) {
  const transferPairs = checkInvariants(doc);
  return {
    counts: {
      accounts: (doc.accounts || []).length, transactions: (doc.transactions || []).length, payees: (doc.payees || []).length,
      categories: (doc.categories || []).length, contacts: (doc.contacts || []).length, members: (doc.members || []).length,
      grants: (doc.grants || []).length, attachments: attachments.length, transferPairs,
    },
    balances: [...balances(doc).entries()].map(([accountId, minor]) => ({ accountId, minor })),
  };
}

// ---- building an archive --------------------------------------------------------------------
async function readAttachments(storage, workspaceId) {
  const prefix = `workspaces/${workspaceId}/attachments/`;
  const out = [];
  for (const name of await storage.list(prefix)) {
    const hit = await storage.getBytes(name);
    const sha = name.slice(prefix.length);
    if (!hit || sha256(hit.bytes) !== sha) throw invalidData('attachment hash');
    out.push({ sha256: sha, size: hit.bytes.length, base64: hit.bytes.toString('base64') });
  }
  return out;
}

function buildArchive({ doc, attachments, keyring, archiveId, createdAt, reason }) {
  const payload = Buffer.from(JSON.stringify({ workspace: doc, attachments, manifest: manifestOf(doc, attachments) }));
  const parsed = parsePayload(payload);
  const header = { workspaceId: doc.id, archiveId, schemaVersion: doc.schemaVersion, createdAt, reason };
  const sealed = archive.seal(header, payload, keyring);
  const reopened = archive.open(sealed, keyring, { expectedWorkspaceId: doc.id });
  if (!reopened.payload.equals(payload)) throw new Error('Backup verification failed');
  return { bytes: sealed, manifest: parsed.manifest };
}

// ---- reading an archive ---------------------------------------------------------------------
function parsePayload(payload) {
  let data;
  try { data = safeParse(payload.toString('utf8')); } catch { throw invalidData('payload'); }
  if (!data || typeof data !== 'object' || !data.workspace || !Array.isArray(data.attachments) || !data.manifest) throw invalidData('payload shape');
  const doc = readDocument('workspace', data.workspace);
  for (const a of data.attachments) {
    if (!a || !/^[0-9a-f]{64}$/.test(a.sha256) || typeof a.base64 !== 'string') throw invalidData('attachment entry');
    const bytes = Buffer.from(a.base64, 'base64');
    if (bytes.toString('base64') !== a.base64 || sha256(bytes) !== a.sha256) throw invalidData('attachment hash');
  }
  const recomputed = manifestOf(doc, data.attachments);
  if (JSON.stringify(recomputed) !== JSON.stringify(data.manifest)) throw invalidData('manifest');
  return { doc, attachments: data.attachments, manifest: data.manifest };
}

function openArchive(bytes, keyring, workspaceId) {
  const { header, payload } = archive.open(bytes, keyring, { expectedWorkspaceId: workspaceId });
  if (header.schemaVersion > CURRENT.workspace) throw new HttpError(422, 'schema_unsupported', 'This backup was made by a newer version of BudgetTracker. Nothing has been changed.');
  return { header, ...parsePayload(payload) };
}

// ---- restore planning -----------------------------------------------------------------------
function scopeFor(doc, subject, role) {
  const accounts = new Set((doc.accounts || []).filter((a) => (a.visibility === 'shared' && role === 'owner')
    || (a.visibility === 'private' && a.ownerSubject === subject)).map((a) => a.id));
  return {
    owner: role === 'owner',
    account: (a) => accounts.has(a.id),
    transaction: (t) => accounts.has(t.accountId),
    payee: (p) => (p.visibility === 'shared' && role === 'owner') || p.ownerSubject === subject,
    // Commitments follow their source account; shared budgets are owner-scope, private budgets
    // belong to their owner alone (BT-008).
    recurring: (r) => accounts.has(r.accountId),
    budget: (b) => (b.scope === 'shared' && role === 'owner') || (b.scope === 'private' && b.ownerSubject === subject),
    shared: role === 'owner',
    accountIds: accounts,
  };
}

const COLLECTIONS = ['accounts', 'transactions', 'payees', 'categories', 'contacts', 'recurring', 'budgets'];

function inScope(doc, scope) {
  return {
    accounts: (doc.accounts || []).filter(scope.account),
    transactions: (doc.transactions || []).filter(scope.transaction),
    payees: (doc.payees || []).filter(scope.payee),
    categories: scope.shared ? (doc.categories || []) : [],
    contacts: scope.shared ? (doc.contacts || []) : [],
    recurring: (doc.recurring || []).filter(scope.recurring),
    budgets: (doc.budgets || []).filter(scope.budget),
  };
}

function diffCounts(current, archived) {
  const out = { add: 0, remove: 0, update: 0, unchanged: 0 };
  for (const c of COLLECTIONS) {
    const cur = new Map(current[c].map((r) => [r.id, JSON.stringify(r)]));
    const arc = new Map(archived[c].map((r) => [r.id, JSON.stringify(r)]));
    for (const [id, v] of arc) { if (!cur.has(id)) out.add += 1; else if (cur.get(id) === v) out.unchanged += 1; else out.update += 1; }
    for (const id of cur.keys()) if (!arc.has(id)) out.remove += 1;
  }
  return out;
}

function totals(accounts, balanceMap) {
  const t = {};
  for (const a of accounts) if (!a.deletedAt) t[a.currency] = money.sum([t[a.currency] || 0, balanceMap.get(a.id) || 0]);
  return Object.entries(t).map(([currency, minor]) => ({ currency, amount: money.toDecimal(minor, currency) }));
}

// Produces the preview summary and, for execution, the next document. Pure: no storage access.
function plan({ current, archived, mode, principal, member, nowIso, newWorkspaceId }) {
  const scopeNow = current ? scopeFor(current, principal.subject, member.role) : null;
  const scopeArc = scopeFor(archived, principal.subject, member.role);
  const arc = inScope(archived, scopeArc);
  // Yes/no only: counts outside the caller's scope would reveal other members' private records,
  // grants and invitations (security review finding 4).
  const excluded = {
    otherMembersPrivateRecords: (archived.accounts || []).some((a) => a.visibility === 'private' && a.ownerSubject !== principal.subject),
    sharedRecordsOutsideYourRole: !scopeArc.shared && (archived.accounts || []).some((a) => a.visibility === 'shared'),
    archivedAccessIgnored: (archived.grants || []).length + (archived.invitations || []).length > 0 || (archived.members || []).length > 1,
  };
  const blockers = [];
  let next;
  if (mode === 'create-new') {
    const keepAccounts = new Set(arc.accounts.map((a) => a.id));
    const txns = arc.transactions.map((t) => {
      if (!t.transferId) return t;
      const counterpartIncluded = keepAccounts.has(t.counterpartAccountId);
      return counterpartIncluded ? t : { ...t, counterpartExcluded: true };
    });
    const usedPayees = new Set(txns.map((t) => t.payeeId).filter(Boolean));
    const payees = (archived.payees || []).filter((p) => scopeArc.payee(p) || usedPayees.has(p.id));
    const memberId = newId('mem');
    next = {
      id: newWorkspaceId, name: `${archived.name} (restored ${nowIso.slice(0, 10)})`.slice(0, 80), kind: archived.kind, status: 'active',
      createdAt: nowIso, createdBy: principal.subject, updatedAt: nowIso, revision: 1, settings: { ...archived.settings },
      members: [{ id: memberId, subject: principal.subject, email: principal.email, name: principal.name || '', role: 'owner', status: 'active', joinedAt: nowIso }],
      invitations: [], grants: [], contacts: scopeArc.shared ? arc.contacts : [], accounts: arc.accounts.map((a) => (a.visibility === 'private' ? { ...a, ownerSubject: principal.subject } : a)),
      // Payee ownership is never transferred to the restorer (security review finding 9).
      payees,
      categories: archived.categories || [], transactions: txns, audit: [], idempotency: {}, restoredFrom: null,
      // A savings commitment into an account that is not restored would move money nowhere.
      recurring: arc.recurring.filter((r) => r.kind !== 'transfer' || keepAccounts.has(r.toAccountId)),
      budgets: arc.budgets,
    };
  } else {
    const cur = inScope(current, scopeNow);
    next = structuredClone(current);
    if (mode === 'replace') {
      for (const c of COLLECTIONS) {
        const drop = new Set(cur[c].map((r) => r.id));
        const add = arc[c].filter((r) => !((next[c] || []).some((x) => x.id === r.id) && !drop.has(r.id)));
        next[c] = [...(next[c] || []).filter((r) => !drop.has(r.id)), ...add];
      }
    } else {
      let skipped = 0;
      for (const c of COLLECTIONS) {
        const have = new Map((next[c] || []).map((r) => [r.id, JSON.stringify(r)]));
        for (const r of arc[c]) {
          if (!have.has(r.id)) next[c] = [...(next[c] || []), r];
          else if (have.get(r.id) !== JSON.stringify(r)) skipped += 1;
        }
      }
      excluded.conflictsSkipped = skipped;
    }
    // Private accounts outside scope must stay exactly as they are now.
    next.members = current.members;
    next.grants = current.grants;
    next.invitations = current.invitations;
    next.idempotency = current.idempotency;
  }
  const crossScope = 'This restore would break a link with records outside what you can restore (for example a transfer with another member\'s private account). A recovery operator must perform a full restore instead.';
  try { checkInvariants(next); } catch (e) { blockers.push(crossScope); }
  // A transfer whose legs straddle the caller's scope must not change on the in-scope side while
  // the out-of-scope side stays as it is now — the invariant check cannot see this for
  // cross-currency pairs (security review finding 8).
  if (mode !== 'create-new' && !blockers.length) {
    const nowById = new Map((current.transactions || []).map((t) => [t.id, JSON.stringify(t)]));
    const legsByTransfer = new Map();
    for (const t of next.transactions || []) if (t.transferId) legsByTransfer.set(t.transferId, [...(legsByTransfer.get(t.transferId) || []), t]);
    for (const legs of legsByTransfer.values()) {
      const inside = legs.filter((l) => scopeNow.accountIds.has(l.accountId));
      if (inside.length === legs.length || inside.length === 0) continue;
      if (inside.some((l) => nowById.get(l.id) !== JSON.stringify(l))) { blockers.push(crossScope); break; }
    }
  }
  // Only attachments referenced by records the caller restores are written (security review
  // finding 2). Receipt references are introduced with receipt upload; until then none qualify.
  const referenced = new Set();
  const afterScope = scopeFor(next, principal.subject, mode === 'create-new' ? 'owner' : member.role);
  for (const t of next.transactions || []) {
    if (afterScope.accountIds.has(t.accountId)) for (const a of t.attachments || []) if (a && a.sha256) referenced.add(a.sha256);
  }
  // Counts and totals describe the RESULT that execution would write, not the archive, so a merge
  // preview reports what merging actually does (financial review finding 5).
  const scopeNext = scopeFor(next, principal.subject, mode === 'create-new' ? 'owner' : member.role);
  const after = inScope(next, scopeNext);
  const diff = mode === 'create-new' ? { add: COLLECTIONS.reduce((n, c) => n + after[c].length, 0), remove: 0, update: 0, unchanged: 0 }
    : diffCounts(inScope(current, scopeNow), after);
  const summary = {
    mode,
    scope: { accounts: arc.accounts.length, transactions: arc.transactions.length, payees: arc.payees.length, categories: arc.categories.length, contacts: arc.contacts.length, recurring: arc.recurring.length, budgets: arc.budgets.length },
    changes: diff,
    excluded,
    totalsAfter: totals(after.accounts, balances(next)),
    totalsNow: current ? totals(inScope(current, scopeNow).accounts, balances(current)) : [],
    permissions: 'Archived memberships, grants and invitations are never restored. Current access is kept; a new workspace starts with only you as owner.',
    warnings: mode === 'replace' ? ['Replace removes records created after this backup within your restore scope. A recovery point is created first.'] : [],
    blockers,
    attachmentsInScope: referenced.size,
  };
  return { summary, next: blockers.length ? null : next, attachments: referenced };
}

function finalize(next, { actor, nowIso, archiveId, mode }) {
  next.revision = (Number.isSafeInteger(next.revision) ? next.revision : 0) + 1;
  next.updatedAt = nowIso;
  if (mode === 'create-new') next.restoredFrom = { archiveId, at: nowIso };
  audit.record(next, { actor, action: mode === 'create-new' ? 'workspace.restore-create' : `workspace.restore-${mode}`, targetType: 'backup', targetId: archiveId, at: nowIso });
  return stampDocument('workspace', next);
}

function ensureRestorable(summary) {
  if (summary.blockers.length) throw conflict(summary.blockers[0], 'restore_blocked');
}

module.exports = { checkInvariants, manifestOf, readAttachments, buildArchive, openArchive, plan, finalize, ensureRestorable, balances, sha256 };
