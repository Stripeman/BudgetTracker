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
const bills = require('./bills');
const groups = require('./groups');

// Shared expenses (BT-009) name who paid and who shared. A new workspace starts with only the
// restorer, so records naming any other member cannot come along without losing that.
const GROUP_MEMBERS_BLOCKER = 'Shared expenses in this backup name other members. A new workspace starts with only you, so who paid and who shared could not be kept. Restore into this workspace with Merge or Replace instead.';
const GROUP_LEDGER_BLOCKER = 'This restore would change or set aside shared expenses or payments that another member also recorded on their own account, which this restore cannot change. Their entries would no longer match. That member can first stop recording them on their account, or a recovery operator can perform a full restore.';

// What another member's identity becomes in a create-new restore (security review S4): no workspace
// member has this subject or id, so it is shown as "Former member" and grants nothing.
const FORMER_SUBJECT = 'former-member';
const FORMER_REF = 'member:former';

const invalidData = (detail) => Object.assign(new HttpError(422, 'backup_invalid', `The workspace data failed an integrity check (${detail}). Nothing has been changed.`), { detail });
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
    // Every reference a bill can copy into a new entry must exist (security review SEC-B1).
    if (r.toAccountId && !accounts.has(r.toAccountId)) throw invalidData('bill destination');
    for (const v of r.versions) {
      if (v.categoryId && !categories.has(v.categoryId)) throw invalidData('bill category');
      if (v.payeeId && !payees.has(v.payeeId)) throw invalidData('bill merchant');
    }
  }
  // Checks every version's lines too, not just the current plan (financial review finding,
  // 2026-09-17) — a budget's versions[] keeps every past plan (BT-008 versioning) and each has its
  // own categoryId references, so a check of only the current `lines` could pass a document with a
  // dangling category reference buried in an older version.
  for (const b of doc.budgets || []) {
    for (const l of b.lines || []) if (!categories.has(l.categoryId)) throw invalidData('budget category');
    for (const v of b.versions || []) for (const l of v.lines || []) if (!categories.has(l.categoryId)) throw invalidData('budget category');
  }
  // Shared expenses and payments (BT-009): payers and shares add up to the total, the shares are what
  // the split gives, everyone named exists as a member or shared contact, payments are positive.
  uniqueIds(doc.groupExpenses || [], 'group expense');
  uniqueIds(doc.groupSettlements || [], 'group settlement');
  const groupProblem = groups.invariantProblem(doc);
  if (groupProblem) throw invalidData(groupProblem);
  // The group settings object (Terry, 2026-09-14): its shape, and valid values for known keys.
  const settingsProblem = require('./group-settings').problem(doc);
  if (settingsProblem) throw invalidData(settingsProblem);
  // The workspace settings (Terry, 2026-09-14): an object, and valid (or earlier accepted) values.
  const workspaceSettingsProblem = require('./workspace-settings').problem(doc);
  if (workspaceSettingsProblem) throw invalidData(workspaceSettingsProblem);
  // A reversal matches the entry it reverses: same account and kind, exactly the opposite amount.
  const txById = new Map((doc.transactions || []).map((t) => [t.id, t]));
  for (const t of doc.transactions || []) {
    if (!t.links || !t.links.reverses) continue;
    const target = txById.get(t.links.reverses);
    if (!target || target.accountId !== t.accountId || target.kind !== t.kind || target.amountMinor !== -t.amountMinor) throw invalidData('reversal');
    // A live reversal of a deleted entry (or the reverse) would count only one half (financial review FIN-R2).
    if (Boolean(target.deletedAt) !== Boolean(t.deletedAt)) throw invalidData('reversal deletion state');
    // The original names its reversal, so an entry is reversed at most once and a reversal cannot
    // be separated from what it reverses — for example by a merge restore (financial retest FIN-T1).
    if (target.reversedBy !== t.id) throw invalidData('reversal link');
  }
  for (const t of doc.transactions || []) {
    if (!t.reversedBy) continue;
    const reversal = txById.get(t.reversedBy);
    if (!reversal || !reversal.links || reversal.links.reverses !== t.id) throw invalidData('reversal link');
  }
  // A hand-entered amount owed (group setting "Owed-to-others and repayment entries") is a pair: the
  // share as spending and the matching payable, on one account in one currency on one date, opposite
  // amounts, deleted or kept together — never a lone payable (BT-009 recheck, Terry's decision C).
  const owedPairs = new Map();
  for (const t of doc.transactions || []) if (t.owedPairId) owedPairs.set(t.owedPairId, [...(owedPairs.get(t.owedPairId) || []), t]);
  for (const legs of owedPairs.values()) {
    const [a, b] = legs;
    if (legs.length !== 2 || legs.map((x) => x.kind).sort().join(',') !== 'expense,payable' || a.accountId !== b.accountId || a.currency !== b.currency
        || a.date !== b.date || !money.isMinor(a.amountMinor) || !money.isMinor(b.amountMinor) || a.amountMinor + b.amountMinor !== 0
        || Boolean(a.deletedAt) !== Boolean(b.deletedAt)) throw invalidData('owed pair');
  }
  // A bill occurrence is recorded at most once among live entries (both legs of a transfer count once)
  // (SEC-B6). A recording cancelled by a live reversal no longer counts, so the occurrence can be
  // recorded again correctly — the same rule the bills module uses (bills.recordingCounts, FIN-R4).
  const occurrence = new Map();
  for (const t of doc.transactions || []) {
    if (!bills.recordingCounts(t, txById)) continue;
    const key = `${t.links.recurringId}|${t.links.occurrence}`;
    const group = t.transferId || t.id;
    if (occurrence.has(key) && occurrence.get(key) !== group) throw invalidData('bill occurrence recorded twice');
    occurrence.set(key, group);
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
    // Direction follows kind (a reversal carries the opposite sign of the entry it reverses);
    // transfers are exactly the entries with a transfer id.
    const reversal = !!(t.links && t.links.reverses);
    if (!reversal && ledger.OUTFLOW.has(t.kind) && t.amountMinor > 0) throw invalidData('transaction direction');
    if (!reversal && ledger.INFLOW.has(t.kind) && t.amountMinor < 0) throw invalidData('transaction direction');
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

// Each account's amounts are summed exactly in one go and range-checked once, on the total, like
// ledger.balanceOf: a running total may pass the range on the way to a valid balance (financial
// review FIN-R15; retest FIN-T2 found the step-by-step check refused valid workspaces).
function balances(doc) {
  const amounts = new Map((doc.accounts || []).map((a) => [a.id, [a.openingBalanceMinor]]));
  for (const t of doc.transactions || []) if (!t.deletedAt && amounts.has(t.accountId)) amounts.get(t.accountId).push(t.amountMinor);
  return new Map([...amounts].map(([id, list]) => [id, money.sum(list)]));
}

function manifestOf(doc, attachments) {
  const transferPairs = checkInvariants(doc);
  return {
    counts: {
      accounts: (doc.accounts || []).length, transactions: (doc.transactions || []).length, payees: (doc.payees || []).length,
      categories: (doc.categories || []).length, contacts: (doc.contacts || []).length, members: (doc.members || []).length,
      grants: (doc.grants || []).length, attachments: attachments.length, transferPairs,
      // Only when the workspace has them, so manifests of archives made before shared expenses existed
      // still verify byte for byte (BT-009).
      ...(Array.isArray(doc.groupExpenses) ? { groupExpenses: doc.groupExpenses.length } : {}),
      ...(Array.isArray(doc.groupSettlements) ? { groupSettlements: doc.groupSettlements.length } : {}),
      ...(Array.isArray(doc.groupEvents) ? { groupEvents: doc.groupEvents.length } : {}),
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
  // Verified against the RAW stored payload (`data.workspace`), never the migrated `doc` (BT-009-20):
  // a schema migration can add fields a genuinely older archive's own stored manifest never counted
  // (here, `groupEvents`, backfilled onto a pre-events workspace's expenses/settlements on read) —
  // recomputing from the migrated shape would make every such archive fail its own byte-for-byte
  // integrity check the moment it upgrades, which is exactly the silent incompatibility this check
  // exists to catch, not cause. For an archive already at the current schema version (every archive
  // made after this change), `data.workspace` and the migrated `doc` are identical, so this changes
  // nothing for them.
  const recomputed = manifestOf(data.workspace, data.attachments);
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

const COLLECTIONS = ['accounts', 'transactions', 'payees', 'categories', 'contacts', 'recurring', 'budgets', 'groupExpenses', 'groupSettlements', 'groupEvents'];
// Directory records a replace never removes: records outside the caller's scope may refer to them,
// and the directory is never pruned (security review SEC-B1 and SEC-R4 for contacts, BT-001-05).
const KEEP_ON_REPLACE = new Set(['categories', 'payees', 'contacts']);

function inScope(doc, scope) {
  return {
    accounts: (doc.accounts || []).filter(scope.account),
    transactions: (doc.transactions || []).filter(scope.transaction),
    payees: (doc.payees || []).filter(scope.payee),
    categories: scope.shared ? (doc.categories || []) : [],
    contacts: scope.shared ? (doc.contacts || []) : [],
    recurring: (doc.recurring || []).filter(scope.recurring),
    budgets: (doc.budgets || []).filter(scope.budget),
    // Shared expenses and payments are shared group records: owner scope, like shared accounts (BT-009).
    groupExpenses: scope.shared ? (doc.groupExpenses || []) : [],
    groupSettlements: scope.shared ? (doc.groupSettlements || []) : [],
    // Shared-expense events (BT-009-20) are the same shared, owner-scope record as the expenses and
    // payments that belong to them — never restored separately from the records they organize.
    groupEvents: scope.shared ? (doc.groupEvents || []) : [],
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

// An entry deleted since the backup, brought back by a merge when asked (Terry, 2026-09-13): it is
// undeleted IN PLACE — never swapped for the older copy — so its amendments and history stay, and
// the undelete is recorded like any other (history, amendment with reason, audit entry).
function undeleteFromBackup(doc, t, by, at, archiveId) {
  const prior = { deletedAt: t.deletedAt || null, deletedBy: t.deletedBy || null };
  t.deletedAt = null;
  t.deletedBy = null;
  t.revision = (Number.isSafeInteger(t.revision) ? t.revision : 0) + 1;
  t.history = [...(t.history || []), { revision: t.revision, at, by, fields: ['restore'] }];
  t.amendments = [...(t.amendments || []), { revision: t.revision, at, by, reason: `Brought back from backup ${archiveId}`, changes: [{ field: 'deleted', from: true, to: false, previouslyDeletedAt: prior.deletedAt, previouslyDeletedBy: prior.deletedBy }] }];
  audit.record(doc, { actor: by, action: 'transaction.restore', targetType: 'transaction', targetId: t.id, scope: `account:${t.accountId}`, at });
}

// Produces the preview summary and, for execution, the next document. Pure: no storage access.
// `restoreDeleted` (merge only) also brings back entries deleted since the backup.
function plan({ current, archived, mode, principal, member, nowIso, newWorkspaceId, archiveId = null, restoreDeleted = false }) {
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
    // Entries recorded from a shared expense or payment that does not come along lose that link, so
    // nothing points at a record the new workspace does not have (BT-009, S8).
    const carriedGroup = new Set([...arc.groupExpenses, ...arc.groupSettlements].map((r) => r.id));
    const withoutLostGroupLinks = (t) => {
      const l = t.links || {};
      if ((!l.groupExpenseId || carriedGroup.has(l.groupExpenseId)) && (!l.groupSettlementId || carriedGroup.has(l.groupSettlementId))) return t;
      const links = { ...l };
      if (links.groupExpenseId && !carriedGroup.has(links.groupExpenseId)) delete links.groupExpenseId;
      if (links.groupSettlementId && !carriedGroup.has(links.groupSettlementId)) delete links.groupSettlementId;
      return { ...t, links };
    };
    // An entry moved between accounts keeps the move in its amendments (BT-006-05). An account that does
    // not come along is named there by id only, and it may be another member's private account, so the
    // copy keeps "moved from/to an account" without that id (as for transfer counterparts, L2 below).
    const ACCOUNT_REFS = new Set(['accountId', 'counterpartAccountId']);
    const keptRef = (id) => (typeof id === 'string' && keepAccounts.has(id) ? id : null);
    const withoutLostAccountRefs = (t) => (!Array.isArray(t.amendments) || !t.amendments.some((a) => (a.changes || []).some((c) => ACCOUNT_REFS.has(c.field))) ? t
      : { ...t, amendments: t.amendments.map((a) => ({ ...a, changes: (a.changes || []).map((c) => (ACCOUNT_REFS.has(c.field) ? { ...c, from: keptRef(c.from), to: keptRef(c.to) } : c)) })) });
    const txns = arc.transactions.map(withoutLostGroupLinks).map(withoutLostAccountRefs).map((t) => {
      if (!t.transferId) return t;
      const counterpartIncluded = keepAccounts.has(t.counterpartAccountId);
      // The other side stays behind, and so does its id: it may be another member's private account
      // (security recheck of 47617b5, L2). The leg keeps its amount and is marked as one-sided.
      return counterpartIncluded ? t : { ...t, counterpartExcluded: true, counterpartAccountId: null };
    });
    // Another member's identity never enters the new workspace (security review S4): on shared
    // expenses and payments every other subject becomes a former member (shown as "Former member"),
    // references to other members inside earlier values become one former member, and only the
    // restorer's own ledger links to accounts that come along are kept.
    const otherMemberIds = new Set((archived.members || []).filter((m) => m.subject !== principal.subject).map((m) => m.id));
    const mapSubject = (s) => (typeof s === 'string' && s !== principal.subject ? FORMER_SUBJECT : s);
    const mapRefs = (v) => {
      if (Array.isArray(v)) return v.map(mapRefs);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapRefs(x)]));
      return typeof v === 'string' && v.startsWith('member:') && otherMemberIds.has(v.slice(7)) ? FORMER_REF : v;
    };
    const scrub = (r) => {
      const out = { ...r };
      for (const k of ['createdBy', 'updatedBy', 'voidedBy', 'confirmedBy', 'disputedBy']) if (out[k]) out[k] = mapSubject(out[k]);
      if (Array.isArray(r.history)) out.history = r.history.map((x) => ({ ...x, by: mapSubject(x.by) }));
      if (Array.isArray(r.amendments)) out.amendments = r.amendments.map((a) => ({ ...a, by: mapSubject(a.by), changes: (a.changes || []).map((ch) => ({ ...ch, from: mapRefs(ch.from), to: mapRefs(ch.to) })) }));
      if (Object.prototype.hasOwnProperty.call(r, 'ledgerLinks')) out.ledgerLinks = (r.ledgerLinks || []).filter((l) => l.subject === principal.subject && keepAccounts.has(l.accountId)).map((l) => ({ ...l }));
      return out;
    };
    // A savings commitment into an account that is not restored would move money nowhere.
    const carriedBills = arc.recurring.filter((r) => r.kind !== 'transfer' || keepAccounts.has(r.toAccountId));
    // Merchants used by carried entries and bills come along, so nothing points at a missing one (SEC-B1).
    const usedPayees = new Set([...txns.map((t) => t.payeeId), ...carriedBills.flatMap((r) => (r.versions || []).map((v) => v.payeeId))].filter(Boolean));
    const payees = (archived.payees || []).filter((p) => scopeArc.payee(p) || usedPayees.has(p.id));
    // The restorer keeps the member id they had, so shared expenses that name them still do (BT-009).
    const archivedSelf = (archived.members || []).find((m) => m.subject === principal.subject);
    const memberId = archivedSelf ? archivedSelf.id : newId('mem');
    // Nobody else's identity comes along on ANY carried record (security recheck, S4 residual): every
    // other member's subject becomes the former-member value and every reference to another member
    // becomes one former member — on entries of shared accounts, merchants, bills, budgets, contacts,
    // categories, settings, shared expenses and all their histories. The new workspace therefore
    // grants nothing, and charges nothing to anyone's allowance, on the strength of an old id, even if
    // that person joins it later. The restorer's own identity is kept.
    const otherSubjects = new Set((archived.members || []).map((m) => m.subject).filter((s) => typeof s === 'string' && s !== principal.subject));
    const forgetOthers = (v) => {
      if (Array.isArray(v)) return v.map(forgetOthers);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, forgetOthers(x)]));
      if (typeof v !== 'string') return v;
      if (otherSubjects.has(v)) return FORMER_SUBJECT;
      return v.startsWith('member:') && otherMemberIds.has(v.slice(7)) ? FORMER_REF : v;
    };
    next = {
      id: newWorkspaceId, name: `${archived.name} (restored ${nowIso.slice(0, 10)})`.slice(0, 80), kind: archived.kind, status: 'active',
      createdAt: nowIso, createdBy: principal.subject, updatedAt: nowIso, revision: 1, settings: forgetOthers({ ...archived.settings }),
      members: [{ id: memberId, subject: principal.subject, email: principal.email, name: principal.name || '', role: 'owner', status: 'active', joinedAt: nowIso }],
      invitations: [], grants: [], contacts: forgetOthers(scopeArc.shared ? arc.contacts : []),
      accounts: forgetOthers(arc.accounts.map((a) => (a.visibility === 'private' ? { ...a, ownerSubject: principal.subject } : a))),
      // Payee ownership is never transferred to the restorer (security review finding 9).
      payees: forgetOthers(payees),
      categories: forgetOthers(archived.categories || []), transactions: forgetOthers(txns), audit: [], idempotency: {}, restoredFrom: null,
      recurring: forgetOthers(carriedBills),
      budgets: forgetOthers(arc.budgets),
      groupExpenses: forgetOthers(arc.groupExpenses.map(scrub)),
      groupSettlements: forgetOthers(arc.groupSettlements.map(scrub)),
      // The events those expenses/payments belong to come along the same way (BT-009-20); `scrub`
      // already generically maps `createdBy`/`history[].by` (an event has no amendments or
      // ledgerLinks, so those branches simply do nothing for it). `defaultEventId` follows only
      // when its event actually came along — otherwise the next expense here lazily creates a
      // fresh one (`resolveEvent`), never pointing at an event that does not exist.
      groupEvents: forgetOthers(arc.groupEvents.map(scrub)),
      defaultEventId: archived.defaultEventId && arc.groupEvents.some((e) => e.id === archived.defaultEventId) ? archived.defaultEventId : null,
      groupLedgers: (archived.groupLedgers || []).filter((l) => l.subject === principal.subject && keepAccounts.has(l.accountId)).map((l) => ({ ...l })),
      // The group's settings come along with the group; who changed them is mapped like everything else.
      // Per-person overrides of anyone else are left behind; they are keyed by member id (S4).
      ...(archived.groupSettings ? { groupSettings: forgetOthers(require('./group-settings').forNewWorkspace(archived.groupSettings, memberId)) } : {}),
    };
    if ([...groups.memberIds(next)].some((id) => id !== memberId)) blockers.push(GROUP_MEMBERS_BLOCKER);
  } else {
    // Personal ledger links are each member's own current state and never come from an archive
    // (security review S1): a record that replace or merge brings in keeps the links it has now, or
    // none; `groupLedgers` is not a restored collection, so it always stays as it is now.
    for (const c of ['groupExpenses', 'groupSettlements']) {
      const nowById = new Map((current[c] || []).map((r) => [r.id, r]));
      arc[c] = arc[c].map((r) => {
        const now = nowById.get(r.id);
        const out = { ...r };
        if (now && Object.prototype.hasOwnProperty.call(now, 'ledgerLinks')) out.ledgerLinks = structuredClone(now.ledgerLinks);
        else delete out.ledgerLinks;
        return out;
      });
    }
    const cur = inScope(current, scopeNow);
    next = structuredClone(current);
    if (mode === 'replace') {
      // NOTHING IS DROPPED (BT-001-05, audit A7): a current record that the backup's version replaces,
      // or that did not exist when the backup was made, leaves the live lists but is kept whole in
      // the append-only `superseded` collection with who, when, why and the archive it came from.
      // Identical records are simply kept.
      // A record the caller may restore NOW but that the backup holds OUTSIDE the caller's scope (for
      // example a member's private account shared after the backup) is not the caller's to roll
      // back: it stays exactly as it is, and is never labelled "not in backup" (financial review FIN-R5).
      // Everything on such an account stays as it is too — entries and bills added or changed since
      // the backup — so its balance is never one it never had (financial retest FIN-T5).
      const setAside = [];
      let keptScopeChanged = 0;
      const archivedAccountsInScope = new Set(arc.accounts.map((a) => a.id));
      const keptAccounts = new Set(cur.accounts.filter((a) => (archived.accounts || []).some((x) => x.id === a.id) && !archivedAccountsInScope.has(a.id)).map((a) => a.id));
      for (const c of COLLECTIONS) {
        const archivedById = new Map(arc[c].map((r) => [r.id, r]));
        const archivedOutside = new Set((archived[c] || []).filter((r) => !archivedById.has(r.id)).map((r) => r.id));
        const kept = (r) => archivedOutside.has(r.id) || ((c === 'transactions' || c === 'recurring') && keptAccounts.has(r.accountId));
        keptScopeChanged += cur[c].filter(kept).length;
        const drop = new Set(cur[c].filter((r) => !kept(r) && (!KEEP_ON_REPLACE.has(c) || archivedById.has(r.id))).map((r) => r.id));
        for (const r of cur[c]) {
          if (!drop.has(r.id)) continue;
          const incoming = archivedById.get(r.id);
          if (incoming && JSON.stringify(incoming) === JSON.stringify(r)) continue;
          setAside.push({ id: newId('sup'), collection: c, reason: incoming ? 'replaced-by-backup' : 'not-in-backup', archiveId, at: nowIso, by: principal.subject, record: structuredClone(r) });
        }
        const add = arc[c].filter((r) => !((next[c] || []).some((x) => x.id === r.id) && !drop.has(r.id)));
        next[c] = [...(next[c] || []).filter((r) => !drop.has(r.id)), ...add];
      }
      next.superseded = [...(current.superseded || []), ...setAside];
      excluded.setAside = setAside.length;
      excluded.keptScopeChanged = keptScopeChanged;
    } else {
      let skipped = 0;
      let undeleted = 0;
      for (const c of COLLECTIONS) {
        const have = new Map((next[c] || []).map((r) => [r.id, JSON.stringify(r)]));
        for (const r of arc[c]) {
          if (!have.has(r.id)) next[c] = [...(next[c] || []), r];
          else if (have.get(r.id) !== JSON.stringify(r)) {
            // Linked entries (transfer legs, reversal pairs, bill recordings) must come back together;
            // if one cannot, the integrity check below blocks the restore and names the rule.
            const now = restoreDeleted && c === 'transactions' ? next.transactions.find((x) => x.id === r.id) : null;
            if (now && now.deletedAt && !r.deletedAt && scopeNow.transaction(now)) {
              undeleteFromBackup(next, now, principal.subject, nowIso, archiveId);
              undeleted += 1;
            } else skipped += 1;
          }
        }
      }
      excluded.conflictsSkipped = skipped;
      if (restoreDeleted) excluded.deletedRestored = undeleted;
    }
    // Private accounts outside scope must stay exactly as they are now.
    next.members = current.members;
    next.grants = current.grants;
    next.invitations = current.invitations;
    next.idempotency = current.idempotency;
  }
  const crossScope = 'This restore would break a link with records outside what you can restore (for example a transfer with another member\'s private account, or with an account shared after this backup was made). A recovery operator must perform a full restore instead.';
  // Say which integrity rule failed when the CURRENT data already breaks it, instead of blaming the
  // restore scope (financial review FIN-R17). The detail is a rule name, never a record or value.
  let currentFails = null;
  if (current) { try { checkInvariants(current); } catch (e) { currentFails = e.detail || 'document'; } }
  let nextFails = false;
  try { checkInvariants(next); } catch (e) {
    nextFails = true;
    const detail = e.detail || 'document';
    if (currentFails) blockers.push(`The current workspace data already fails an integrity check (${currentFails}), so it cannot be restored over. Correct that record first, or ask a recovery operator.`);
    else if (/^transfer/.test(detail)) blockers.push(crossScope);
    // A more specific blocker already given (shared expenses naming other members) says it better.
    else if (!blockers.length) blockers.push(`This restore would leave records inconsistent (${detail}), so it cannot run as chosen. Try another restore mode, or ask a recovery operator.`);
  }
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
  // A shared expense or payment that another member records on an account outside the caller's scope
  // must not change in a way that changes what their entries should be: their entries would no longer
  // match and only they can change them (BT-009). Merge never changes an existing record, so only
  // replace can do this. Checked for every record replace adds, changes or sets aside.
  if (mode === 'replace' && !blockers.length) {
    const byId = (d) => new Map([...(d.groupExpenses || []).map((r) => [r.id, ['expense', r]]), ...(d.groupSettlements || []).map((r) => [r.id, ['settlement', r]])]);
    const nowRecs = byId(current);
    const nextRecs = byId(next);
    const others = (current.members || []).filter((m) => m.subject !== principal.subject);
    outer: for (const id of new Set([...nowRecs.keys(), ...nextRecs.keys()])) {
      const a = nowRecs.get(id);
      const b = nextRecs.get(id);
      if (a && b && JSON.stringify(a[1]) === JSON.stringify(b[1])) continue;
      const [type, rec] = a || b;
      for (const m of others) {
        if (!groups.recordedOutside(current, rec, type, m.subject, scopeNow.accountIds)) continue;
        const ref = `member:${m.id}`;
        const before = a ? groups.desiredEntries(a[1], type, ref) : [];
        const after = b ? groups.desiredEntries(b[1], type, ref) : [];
        if (JSON.stringify(before) !== JSON.stringify(after)) { blockers.push(GROUP_LEDGER_BLOCKER); break outer; }
      }
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
    scope: { accounts: arc.accounts.length, transactions: arc.transactions.length, payees: arc.payees.length, categories: arc.categories.length, contacts: arc.contacts.length, recurring: arc.recurring.length, budgets: arc.budgets.length, groupExpenses: arc.groupExpenses.length, groupSettlements: arc.groupSettlements.length, groupEvents: arc.groupEvents.length },
    changes: diff,
    excluded,
    // Totals only over data that passed the integrity check: a broken amount cannot be summed.
    totalsAfter: nextFails ? [] : totals(after.accounts, balances(next)),
    totalsNow: current && !currentFails ? totals(inScope(current, scopeNow).accounts, balances(current)) : [],
    permissions: 'Archived memberships, grants and invitations are never restored. Current access is kept; a new workspace starts with only you as owner.',
    warnings: mode === 'replace' ? ['Replace sets aside records created or changed after this backup within your restore scope: they leave the lists but are kept in the workspace history. A recovery point is created first.'] : [],
    blockers,
    attachmentsInScope: referenced.size,
  };
  return { summary, next: blockers.length ? null : next, attachments: referenced };
}

// `auditScope`: a restore by someone other than an owner touches only their own private records, so
// its audit entry is theirs alone (security review SEC-R3).
function finalize(next, { actor, nowIso, archiveId, mode, recoveryPoint = null, setAside = 0, auditScope }) {
  next.revision = (Number.isSafeInteger(next.revision) ? next.revision : 0) + 1;
  next.updatedAt = nowIso;
  if (mode === 'create-new') next.restoredFrom = { archiveId, at: nowIso };
  // Every restore into this workspace leaves a record of itself; never truncated (BT-001-05).
  else next.restores = [...(next.restores || []), { id: newId('rst'), archiveId, mode, at: nowIso, by: actor, recoveryPoint, setAside, ...(auditScope ? { private: true } : {}) }];
  audit.record(next, { actor, action: mode === 'create-new' ? 'workspace.restore-create' : `workspace.restore-${mode}`, targetType: 'backup', targetId: archiveId, scope: auditScope, at: nowIso });
  return stampDocument('workspace', next);
}

function ensureRestorable(summary) {
  if (summary.blockers.length) throw conflict(summary.blockers[0], 'restore_blocked');
}

module.exports = { checkInvariants, manifestOf, readAttachments, buildArchive, openArchive, plan, finalize, ensureRestorable, balances, sha256 };
