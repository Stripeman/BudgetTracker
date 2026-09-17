'use strict';
// Permanent deletion (BT-014). Terry, 2026-09-17: "Users must have meaningful control over their
// own data... They must be able to clean up their workspace, including permanently deleting
// records when needed. This replaces the earlier blanket 'nothing can ever be deleted'
// requirement. Archiving may remain available, but it must not be the only option. Audit history
// must remain preserved." This module is the ONE place the cascade rule lives, so every record
// type applies it the same way:
//
//   "A alone", or "A -> B" where B has no further dependents of its own, are allowed after two
//   confirmations. "A -> B and A -> C" (branching) and "A -> B -> C" or "A -> C -> D" (a second
//   hop) are blocked. A dependency GROUP may hold many records of ONE relationship (every
//   transaction on an account is one group, not branching); two DIFFERENT relationships from the
//   same record (its own transactions AND its own bills, say) is branching.
//
// This module never decides WHO may delete something: every route keeps its own authorization
// (mirroring its existing edit authority) and calls here only after that passes. What it does:
//   1. computes the impact: what would be permanently removed (cascade), what would only lose a
//      pointer (severed), and what refuses the operation outright (blockers) — never combining
//      separate dependency groups to make an otherwise-blocked operation look allowed;
//   2. stamps the impact with a short-lived fingerprint so the final call can detect drift between
//      what the caller reviewed and what is true right before it executes (BT-014, "revalidate at
//      final confirmation");
//   3. performs the removal and reference severance atomically inside the SAME mutateWorkspace
//      write as its one audit entry, then re-validates the result with the exact invariant checker
//      backups use (api/_shared/backup.js checkInvariants) — so a deletion can never leave a
//      dangling reference a later backup or restore would refuse. That check throws and aborts the
//      whole write if it ever would, which is the atomicity guarantee for this module.
//
// A record's own audit trail is never removed by deleting the record (BT-001-05's surviving half):
// `doc.audit` is untouched by every `apply` function below, and this module's own entry is written
// in the same transaction as the removal, never best-effort.
const { createHash } = require('node:crypto');
const { readBody, query, badRequest, notFound, conflict } = require('./http');
const { requireId } = require('./ids');
const store = require('./store');
const fields = require('./fields');
const audit = require('./audit');
const groups = require('./groups');

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

// One dependency relationship from the target record (e.g. "every transaction on this account").
function relationship(key, records, { reason } = {}) {
  return { key, count: records.length, ids: records.map((r) => r.id), reason: reason || null };
}

// Applies the branching half of the cascade rule on top of relationships already found, and any
// blockers the caller collected (transfer legs on another account, Shared-expenses involvement,
// and the like — conditions that refuse the operation regardless of branching).
function evaluate({ relationships, blockers }) {
  const nonEmpty = relationships.filter((r) => r.count > 0);
  const out = [...blockers];
  if (nonEmpty.length > 1) {
    out.push(`This would affect more than one kind of related record at once (${nonEmpty.map((r) => r.key).join(', ')}), which is not allowed in a single deletion.`);
  }
  const blocked = out.length > 0;
  return { blocked, blockers: out, cascade: blocked ? [] : (nonEmpty.length === 1 ? [nonEmpty[0]] : []) };
}

// ---- per-type impact and apply -----------------------------------------------------------------

function accountImpact(doc, account) {
  const txns = (doc.transactions || []).filter((t) => t.accountId === account.id);
  const bills = (doc.recurring || []).filter((r) => r.accountId === account.id);
  const grants = (doc.grants || []).filter((g) => g.resourceType === 'account' && g.resourceId === account.id);
  const blockers = [];
  // A transfer leg (or the reversal of one) whose OTHER half lives on a different, untouched
  // account: Terry's rule 1 — this always blocks, it is not solved by cascading, because the other
  // account stays untouched (financial invariant: a transfer's two legs live on different accounts).
  const elsewhere = txns.filter((t) => t.counterpartAccountId && t.counterpartAccountId !== account.id);
  if (elsewhere.length) {
    blockers.push(`${elsewhere.length} transaction${elsewhere.length === 1 ? '' : 's'} on this account ${elsewhere.length === 1 ? 'is' : 'are'} one leg of a transfer whose other leg is on a different account. Resolve the transfer first, then try again.`);
  }
  // A bill on another, untouched account that transfers INTO this one would be left with a
  // destination that no longer exists.
  const incomingBills = (doc.recurring || []).filter((r) => r.toAccountId === account.id && r.accountId !== account.id);
  if (incomingBills.length) {
    blockers.push(`${incomingBills.length} recurring bill${incomingBills.length === 1 ? '' : 's'} on another account transfer into this account. Change or end ${incomingBills.length === 1 ? 'it' : 'them'} first.`);
  }
  // A single reconciled transaction is already blocked from permanent deletion elsewhere in this
  // module (transactionImpact, below: "Reverse the entry instead") — cascading through the account
  // must not become a back door around that same protection (financial review finding, 2026-09-17).
  const reconciled = txns.filter((t) => t.status === 'reconciled');
  if (reconciled.length) {
    blockers.push(`${reconciled.length} reconciled transaction${reconciled.length === 1 ? '' : 's'} on this account cannot be permanently deleted. Reverse ${reconciled.length === 1 ? 'it' : 'them'} first, then try again.`);
  }
  // Shared expenses linked to this account (Terry, 2026-09-17): "The behavior depends on whether
  // the shared expense involves another workspace ... Contacts without their own participating
  // workspace do not count as another workspace." groups.foreignWorkspaceIds documents why every
  // shared expense in this codebase today is managed solely by this workspace (no cross-workspace
  // participation model exists yet) — so this always cascades rather than blocking. If a future
  // change ever gives a shared expense a real foreign workspace, this refuses instead of guessing
  // at the sever/preserve flow that would then be required.
  // Counts ENDED links too, not only active ones (financial review finding, 2026-09-17):
  // accountApply below removes every matching groupLedgers/ledgerLinks entry regardless of
  // endedAt (an ended pointer at a now-deleted account would itself be a dangling reference the
  // invariant checker refuses — see the comment there), so the impact preview and the audit
  // entry's counts must reflect that too, or a piece of Shared-expenses history is erased with
  // no warning shown and no trace of it in the audit trail.
  const ledgerLinks = (doc.groupLedgers || []).filter((l) => l.accountId === account.id);
  const affectedRecords = [...(doc.groupExpenses || []), ...(doc.groupSettlements || [])]
    .filter((rec) => (rec.ledgerLinks || []).some((l) => l.accountId === account.id));
  const groupLinkedTxns = txns.filter((t) => t.links && (t.links.groupExpenseId || t.links.groupSettlementId));
  const foreign = groups.foreignWorkspaceIds(doc);
  const groupInvolved = ledgerLinks.length > 0 || affectedRecords.length > 0 || groupLinkedTxns.length > 0;
  if (groupInvolved && foreign.length) {
    blockers.push('This account is linked to Shared expenses that involve another workspace. Disconnecting from the other workspace is not available in this version; resolve it in Shared expenses first.');
  }
  const relationships = [
    relationship('transactions', txns),
    relationship('recurring', bills, { reason: 'These bills are sourced from this account and have no meaning without it.' }),
  ];
  const out = evaluate({ relationships, blockers });
  const autoCleanup = [];
  if (grants.length) autoCleanup.push({ type: 'grant', count: grants.length });
  // Never a branching cascade of its own (like grants above): the account's own Shared-expenses
  // ledger link and any legacy per-record link are ended, and the shared expense itself — its
  // participants, amounts, splits, settlements and history — is preserved exactly as Terry
  // required ("Preserve the shared expense ... amounts, splits, settlements, and relevant
  // history"), just no longer pointing at this deleted account (falls back to no-account
  // recording, already supported — BT-009 increment 1, "shared expenses without accounts").
  if (!out.blocked && groupInvolved) autoCleanup.push({ type: 'group-link', count: ledgerLinks.length + affectedRecords.length });
  return {
    target: { type: 'account', id: account.id, label: account.name, confirmPhrase: account.name },
    ...out, together: [], autoCleanup, severed: [], groupInvolved: !out.blocked && groupInvolved,
  };
}
function accountApply(doc, account, impact, nowIso) {
  const group = (key) => new Set((impact.cascade.find((g) => g.key === key) || { ids: [] }).ids);
  const txnIds = group('transactions');
  const billIds = group('recurring');
  doc.transactions = (doc.transactions || []).filter((t) => !txnIds.has(t.id));
  doc.recurring = (doc.recurring || []).filter((r) => !billIds.has(r.id));
  doc.grants = (doc.grants || []).filter((g) => !(g.resourceType === 'account' && g.resourceId === account.id));
  // Sever this account's Shared-expenses synchronization so a later edit cannot recreate the
  // deleted entries or reconnect it automatically (Terry, 2026-09-17). The link cannot be kept as
  // an "ended" tombstone the way api/group/handler.js's stop-recording does it: the same invariant
  // check this deletion re-validates with (api/_shared/groups.js invariantProblem, reused by
  // api/_shared/backup.js) requires EVERY groupLedgers/ledgerLinks entry's accountId to resolve to
  // a real account, ended or not — an ended link pointing at a now-deleted account would itself be
  // a dangling reference, exactly what this deletion must never ship. So the pointer entries are
  // removed outright instead; the shared expense records themselves, their splits, settlements,
  // amounts, participants and history are untouched.
  void nowIso;
  doc.groupLedgers = (doc.groupLedgers || []).filter((l) => l.accountId !== account.id);
  for (const rec of [...(doc.groupExpenses || []), ...(doc.groupSettlements || [])]) {
    if (Array.isArray(rec.ledgerLinks) && rec.ledgerLinks.some((l) => l.accountId === account.id)) {
      rec.ledgerLinks = rec.ledgerLinks.filter((l) => l.accountId !== account.id);
    }
  }
  doc.accounts = (doc.accounts || []).filter((a) => a.id !== account.id);
}

function transactionImpact(doc, t) {
  const blockers = [];
  if (t.links && (t.links.groupExpenseId || t.links.groupSettlementId)) blockers.push('This entry was recorded from Shared expenses. Remove or amend it there first.');
  if (t.owedPairId) blockers.push('This entry is one of a hand-entered amount owed and its matching share, recorded and removed together. Reverse it instead.');
  if (t.status === 'reconciled') blockers.push('Reconciled entries cannot be permanently deleted. Reverse the entry instead.');
  // The other half of the SAME financial event — a transfer's other leg, or a reversal pair — is
  // removed together as one operation on the entry itself. This is not a cascade dependency (it is
  // the same event, always on the same account, per the ledger's own invariants), so it never
  // counts toward branching.
  const partner = t.transferId
    ? (doc.transactions || []).find((x) => x.transferId === t.transferId && x.id !== t.id)
    : (t.links && t.links.reverses ? (doc.transactions || []).find((x) => x.id === t.links.reverses)
      : t.reversedBy ? (doc.transactions || []).find((x) => x.id === t.reversedBy) : null);
  if (partner) {
    if (partner.links && (partner.links.groupExpenseId || partner.links.groupSettlementId)) blockers.push('The linked entry was recorded from Shared expenses. Remove or amend it there first.');
    if (partner.status === 'reconciled') blockers.push('The linked entry is reconciled and cannot be permanently deleted. Reverse it instead.');
  }
  const together = partner ? [partner.id] : [];
  return {
    target: { type: 'transaction', id: t.id, label: `${t.kind} entry of ${t.date}`, confirmPhrase: 'DELETE' },
    blocked: blockers.length > 0, blockers, cascade: [], together, autoCleanup: [], severed: [],
  };
}
function transactionApply(doc, t, impact) {
  const ids = new Set([t.id, ...(impact.together || [])]);
  doc.transactions = (doc.transactions || []).filter((x) => !ids.has(x.id));
}

function payeeImpact(doc, payee) {
  const txns = (doc.transactions || []).filter((t) => t.payeeId === payee.id);
  const bills = (doc.recurring || []).filter((r) => (r.versions || []).some((v) => v.payeeId === payee.id));
  return {
    target: { type: 'payee', id: payee.id, label: payee.name, confirmPhrase: payee.name },
    blocked: false, blockers: [], cascade: [], together: [], autoCleanup: [],
    severed: [
      ...(txns.length ? [{ type: 'transaction', field: 'payeeId', count: txns.length }] : []),
      ...(bills.length ? [{ type: 'recurring', field: 'payeeId', count: bills.length }] : []),
    ],
  };
}
function payeeApply(doc, payee) {
  for (const t of doc.transactions || []) if (t.payeeId === payee.id) t.payeeId = null;
  for (const r of doc.recurring || []) for (const v of r.versions || []) if (v.payeeId === payee.id) v.payeeId = null;
  doc.payees = (doc.payees || []).filter((p) => p.id !== payee.id);
}

function categoryImpact(doc, category) {
  const blockers = [];
  // Checks EVERY budget version, not just the current plan (financial review finding, 2026-09-17):
  // a budget keeps every past version of its plan (b.versions[], BT-008 versioning — "term changes
  // take effect from a chosen date and never rewrite recorded entries"), and an older version can
  // reference a category the current plan no longer does. Checking only `b.lines` missed that case
  // and would leave a permanent dangling categoryId inside `b.versions[]` — invisible to this
  // check, to checkInvariants (fixed alongside this in api/_shared/backup.js), and to every future
  // backup's manifest, once the category was gone.
  const budgetsUsing = (doc.budgets || []).filter((b) =>
    (b.lines || []).some((l) => l.categoryId === category.id) ||
    (b.versions || []).some((v) => (v.lines || []).some((l) => l.categoryId === category.id)));
  if (budgetsUsing.length) blockers.push(`${budgetsUsing.length} budget${budgetsUsing.length === 1 ? '' : 's'} currently use this category. Remove it from ${budgetsUsing.length === 1 ? 'that budget' : 'those budgets'} (or delete the budget) first.`);
  const subcategories = (doc.categories || []).filter((c) => c.parentId === category.id);
  if (subcategories.length) blockers.push(`${subcategories.length} subcategor${subcategories.length === 1 ? 'y uses' : 'ies use'} this as their parent category. Move or delete ${subcategories.length === 1 ? 'it' : 'them'} first.`);
  const txns = blockers.length ? [] : (doc.transactions || []).filter((t) => t.categoryId === category.id || (t.splits || []).some((s) => s.categoryId === category.id));
  const bills = blockers.length ? [] : (doc.recurring || []).filter((r) => (r.versions || []).some((v) => v.categoryId === category.id));
  const payees = blockers.length ? [] : (doc.payees || []).filter((p) => p.defaultCategoryId === category.id);
  return {
    target: { type: 'category', id: category.id, label: category.name, confirmPhrase: category.name },
    blocked: blockers.length > 0, blockers, cascade: [], together: [], autoCleanup: [],
    severed: [
      ...(txns.length ? [{ type: 'transaction', field: 'categoryId', count: txns.length }] : []),
      ...(bills.length ? [{ type: 'recurring', field: 'categoryId', count: bills.length }] : []),
      ...(payees.length ? [{ type: 'payee', field: 'defaultCategoryId', count: payees.length }] : []),
    ],
  };
}
function categoryApply(doc, category) {
  for (const t of doc.transactions || []) {
    if (t.categoryId === category.id) t.categoryId = null;
    for (const s of t.splits || []) if (s.categoryId === category.id) s.categoryId = null;
  }
  for (const r of doc.recurring || []) for (const v of r.versions || []) if (v.categoryId === category.id) v.categoryId = null;
  for (const p of doc.payees || []) if (p.defaultCategoryId === category.id) p.defaultCategoryId = null;
  doc.categories = (doc.categories || []).filter((c) => c.id !== category.id);
}

function recurringImpact(doc, r) {
  const linked = (doc.transactions || []).filter((t) => t.links && t.links.recurringId === r.id);
  return {
    target: { type: 'recurring', id: r.id, label: r.name, confirmPhrase: r.name },
    blocked: false, blockers: [], cascade: [], together: [], autoCleanup: [],
    severed: linked.length ? [{ type: 'transaction', field: 'links.recurringId', count: linked.length }] : [],
  };
}
function recurringApply(doc, r) {
  for (const t of doc.transactions || []) {
    if (t.links && t.links.recurringId === r.id) {
      const { recurringId, occurrence, ...rest } = t.links;
      t.links = rest;
    }
  }
  doc.recurring = (doc.recurring || []).filter((x) => x.id !== r.id);
}

function budgetImpact(doc, b) {
  return {
    target: { type: 'budget', id: b.id, label: b.name, confirmPhrase: b.name },
    blocked: false, blockers: [], cascade: [], together: [], autoCleanup: [], severed: [],
  };
}
function budgetApply(doc, b) {
  doc.budgets = (doc.budgets || []).filter((x) => x.id !== b.id);
}

// Workspace contacts only (BT-014 scope note): a PRIVATE contact lives in the person's own
// document and can be referenced from more than one workspace, which this module has no way to
// scan; deleting one permanently is not offered yet (archive stays available), so it is never
// routed through this module.
function contactImpact(doc, contact) {
  const ref = `contact:${contact.id}`;
  const blockers = [];
  const txns = (doc.transactions || []).filter((t) => t.responsibleRef === ref);
  if (txns.length) blockers.push(`${txns.length} entr${txns.length === 1 ? 'y names' : 'ies name'} this contact as responsible for it. Change ${txns.length === 1 ? 'it' : 'them'} first.`);
  const inGroups = [...(doc.groupExpenses || []), ...(doc.groupSettlements || [])].some((rec) => JSON.stringify(rec).includes(ref));
  if (inGroups) blockers.push('This contact appears in Shared expenses history, which needs it to stay meaningful. It cannot be permanently deleted while that history refers to it; archive it instead.');
  return {
    target: { type: 'contact', id: contact.id, label: contact.name, confirmPhrase: contact.name },
    blocked: blockers.length > 0, blockers, cascade: [], together: [], autoCleanup: [], severed: [],
  };
}
function contactApply(doc, contact) {
  doc.contacts = (doc.contacts || []).filter((c) => c.id !== contact.id);
}

const TYPES = {
  account: { impact: accountImpact, apply: accountApply },
  transaction: { impact: transactionImpact, apply: transactionApply },
  payee: { impact: payeeImpact, apply: payeeApply },
  category: { impact: categoryImpact, apply: categoryApply },
  recurring: { impact: recurringImpact, apply: recurringApply },
  budget: { impact: budgetImpact, apply: budgetApply },
  contact: { impact: contactImpact, apply: contactApply },
};

function computeImpact(type, doc, record) {
  const spec = TYPES[type];
  if (!spec) throw new Error(`Unknown deletion type ${type}`);
  const out = spec.impact(doc, record);
  out.token = fingerprint({
    type, id: record.id, blocked: out.blocked, blockers: out.blockers,
    cascade: out.cascade.map((g) => ({ key: g.key, ids: g.ids })),
    together: out.together || [], severed: out.severed,
    // Defense-in-depth / consistency with workspace-deletion.js's token (financial review
    // finding, 2026-09-17): catches a concurrent edit to a record already IN the cascade/severed
    // group (e.g. its amount or status changing) that leaves group membership unchanged, which the
    // id-list hash above alone would not detect.
    revision: doc.revision || 0,
    // Closes a pre-existing staleness-detection gap for autoCleanup (e.g. grants, Shared-expenses
    // links) the same way: a change there between preview and confirm now also invalidates the
    // token, strictly stricter than before, not a new risk.
    autoCleanup: (out.autoCleanup || []).map((g) => ({ type: g.type, count: g.count })),
  });
  return out;
}

// Recomputes the impact fresh (never trusts the client's copy), refuses if blocked or if the
// impact drifted from what the caller reviewed, requires typing the confirmation phrase, then
// performs the removal/severance and writes the one audit entry for it — all inside the caller's
// mutateWorkspace callback, so it commits atomically with everything else or not at all. Finishes
// with the same invariant check backups use, so a bug here can never ship a dangling reference.
function execute(ctx, doc, member, type, record, { token, typedConfirmation, reason, scope }) {
  const impact = computeImpact(type, doc, record);
  if (impact.blocked) throw conflict(`This cannot be permanently deleted yet: ${impact.blockers.join(' ')}`, 'delete_blocked');
  if (!token || token !== impact.token) {
    throw conflict('What this would affect has changed since you reviewed it. Review the impact again before confirming.', 'delete_impact_stale');
  }
  const expected = String(impact.target.confirmPhrase || impact.target.label || '').trim().toLowerCase();
  const typed = String(typedConfirmation || '').trim().toLowerCase();
  if (!expected || typed !== expected) throw badRequest('Type the confirmation text exactly as shown to permanently delete this.', 'confirmation_mismatch');
  TYPES[type].apply(doc, record, impact, ctx.nowIso());
  // Defence in depth: refuses (aborting the whole write) if this would leave any dangling
  // reference the backup/restore invariant checker would also refuse.
  require('./backup').checkInvariants(doc);
  const summary = [
    'permanent',
    ...impact.cascade.map((g) => `cascade:${g.key}=${g.count}`),
    ...(impact.together.length ? [`together=${impact.together.length}`] : []),
    ...impact.severed.map((s) => `severed:${s.type}.${s.field}=${s.count}`),
    ...impact.autoCleanup.map((g) => `cleanup:${g.type}=${g.count}`),
    ...(reason ? ['reason'] : []),
  ];
  audit.record(doc, { actor: member.subject, action: `${type}.delete-permanent`, targetType: type, targetId: record.id, scope: scope || 'members', at: ctx.nowIso(), fields: summary });
  return impact;
}

function toClientImpact(impact) {
  return {
    type: impact.target.type, id: impact.target.id, label: impact.target.label, confirmPhrase: impact.target.confirmPhrase,
    blocked: impact.blocked, blockers: impact.blockers,
    cascade: impact.cascade.map((g) => ({ type: g.key, count: g.count, reason: g.reason })),
    together: impact.together || [], severed: impact.severed, autoCleanup: impact.autoCleanup || [], token: impact.token,
    // Set only for the account type today (BT-014, Terry 2026-09-17): true when this account is
    // linked to Shared expenses this workspace solely manages, so the client should offer the
    // pre-deletion "Download before continuing" step for that data before the final confirmation.
    groupInvolved: !!impact.groupInvolved,
  };
}

// Builds the two routes (`?action=delete-impact` and `?action=delete-permanent`) a handler wires
// into its POST dispatcher. `find(doc, id)` returns the record or a falsy value; `authorize(doc,
// member, record)` throws (forbidden/notFound) or returns; `scopeFor(record)` picks the audit
// scope (defaults to every member).
function makeRoutes({ type, idField, find, authorize, scopeFor }) {
  const scope = (record) => (scopeFor ? scopeFor(record) : 'members');

  async function impactRoute(ctx, req) {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), [idField]);
    const id = requireId(body[idField], idField);
    const { doc, member } = await store.loadWorkspace(ctx, wsId);
    const record = find(doc, id, ctx);
    if (!record) throw notFound(`Unknown ${type}.`);
    authorize(doc, member, record, ctx);
    return { body: { impact: toClientImpact(computeImpact(type, doc, record)) } };
  }

  async function permanentRoute(ctx, req) {
    const wsId = requireId(query(req, 'workspaceId'), 'workspaceId');
    const body = fields.onlyKeys(readBody(req), [idField, 'impactToken', 'typedConfirmation', 'reason']);
    const id = requireId(body[idField], idField);
    const reason = fields.text(body.reason, { field: 'Reason', max: 200 });
    // Checked once outside the write, so a genuinely blocked attempt is still audited: `execute`
    // throwing INSIDE the write below aborts the whole transaction, so it cannot itself persist a
    // "blocked" entry. The write itself re-checks everything fresh regardless (no TOCTOU risk to
    // the deletion itself, only to whether a blocked attempt gets its own audit line).
    {
      const { doc, member } = await store.loadWorkspace(ctx, wsId);
      const record = find(doc, id, ctx);
      if (!record) throw notFound(`Unknown ${type}.`);
      authorize(doc, member, record, ctx);
      const impact = computeImpact(type, doc, record);
      if (impact.blocked) {
        await store.mutateWorkspace(ctx, wsId, (doc2, member2) => {
          const r2 = find(doc2, id, ctx);
          audit.record(doc2, { actor: member2.subject, action: `${type}.delete-blocked`, targetType: type, targetId: id, scope: r2 ? scope(r2) : 'members', at: ctx.nowIso(), fields: ['blocked'] });
          return { blocked: true };
        }, { allowHeadroom: true });
        throw conflict(`This cannot be permanently deleted yet: ${impact.blockers.join(' ')}`, 'delete_blocked');
      }
    }
    const { result } = await store.mutateWorkspace(ctx, wsId, (doc, member) => {
      const record = find(doc, id, ctx);
      if (!record) throw notFound(`Unknown ${type}.`);
      authorize(doc, member, record, ctx);
      const impact = execute(ctx, doc, member, type, record, {
        token: body.impactToken, typedConfirmation: body.typedConfirmation, reason, scope: scope(record),
      });
      return { deleted: true, type, id, impact: toClientImpact(impact) };
    }, { allowHeadroom: true });
    return { body: result };
  }

  return { impactRoute, permanentRoute };
}

module.exports = { fingerprint, relationship, evaluate, computeImpact, execute, toClientImpact, makeRoutes, TYPES };
