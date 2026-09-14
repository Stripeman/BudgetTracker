'use strict';
// The canonical ledger model (BT-006). Accounts, payees, categories and transactions live in the
// workspace document. Balances are DERIVED on read from the opening balance plus transactions —
// never stored, so they cannot drift.
//
// Sign convention: every amount is signed from the account holder's point of view. Money leaving
// an account is negative. A purchase on a credit card is negative (debt grows); paying the card is
// a TRANSFER (checking −, card +), which is not spending. A loan's opening balance is negative.
const { badRequest } = require('./http');
const money = require('./money');
const fields = require('./fields');
const { capabilitiesFor, can } = require('./authz');
const icons = require('./icons');

const ACCOUNT_TYPES = Object.freeze(['checking', 'savings', 'cash', 'credit-card', 'loan', 'mortgage',
  'merchant-credit', 'investment', 'other-asset', 'other-liability']);
const LIABILITY_TYPES = new Set(['credit-card', 'loan', 'mortgage', 'merchant-credit', 'other-liability']);
const CREDIT_TYPES = new Set(['credit-card', 'merchant-credit']);
const LOAN_TYPES = new Set(['loan', 'mortgage']);

// `payable` and `repayment` (BT-009, financial review finding 2): a share of an expense someone else
// paid is spending with no money leaving yet — an `expense` for the share plus a `payable` (positive,
// money owed) that offsets it — and paying that back is a `repayment` (negative). With `advance` (lent)
// and `reimbursement` (repaid to you) they make up what is owed: advances − reimbursements − payables +
// repayments. None of the four is spending or income.
const TX_KINDS = Object.freeze(['expense', 'income', 'transfer', 'refund', 'fee', 'reimbursement', 'advance', 'adjustment', 'interest', 'payable', 'repayment']);
// The sign each kind takes (OUTFLOW negative, INFLOW positive); a payable is positive but moves no money.
const OUTFLOW = new Set(['expense', 'fee', 'advance', 'interest', 'repayment']);
const INFLOW = new Set(['income', 'refund', 'reimbursement', 'payable']);
const TX_STATUSES = Object.freeze(['pending', 'cleared', 'reconciled']);
// Liabilities whose opening balance is money OWED and therefore never positive. Cards may open
// with a credit (overpayment), so they are not in this set.
const NEVER_POSITIVE_OPENING = new Set(['loan', 'mortgage', 'other-liability']);

// THE one classification every summary, report and payee statistic uses. An advance is money
// lent (a receivable) and a reimbursement repays it — neither is spending or ordinary income
// (financial review finding 4; the brief's EUR 300 dinner rule). Transfers are movements.
function classify(kind) {
  if (kind === 'transfer') return 'transfer';
  if (kind === 'expense' || kind === 'fee' || kind === 'interest') return 'spending';
  if (kind === 'refund') return 'refund';
  if (kind === 'income') return 'income';
  if (kind === 'adjustment') return 'adjustment';
  if (kind === 'advance') return 'advance';
  if (kind === 'reimbursement') return 'reimbursement';
  // Owed to others for their shared expenses, and repayments made to them (BT-009): never spending.
  if (kind === 'payable') return 'payable';
  if (kind === 'repayment') return 'repayment';
  return 'other';
}

function openingBalance(type, text, currency) {
  const minor = text === undefined ? 0 : money.parseDecimal(text, currency, 'Opening balance');
  if (NEVER_POSITIVE_OPENING.has(type) && minor > 0) {
    throw badRequest('A loan or other liability opens with the amount owed, entered as a negative number (for example "-20000.00").', 'invalid_opening_balance');
  }
  return minor;
}

// Refuses any write that would push an account balance or a per-currency workspace total beyond
// what the money module can represent exactly (financial review finding 2). Checked on the whole
// candidate document so a single oversized entry cannot make the workspace unreadable.
function assertLedgerInRange(doc) {
  const limit = BigInt(money.MAX_MINOR);
  const perCurrency = new Map();
  const balances = new Map((doc.accounts || []).map((a) => [a.id, BigInt(a.openingBalanceMinor || 0)]));
  for (const t of doc.transactions || []) {
    if (!t.deletedAt && balances.has(t.accountId)) balances.set(t.accountId, balances.get(t.accountId) + BigInt(t.amountMinor));
  }
  for (const a of doc.accounts || []) {
    const b = balances.get(a.id);
    const total = (perCurrency.get(a.currency) || 0n) + (a.deletedAt ? 0n : b);
    perCurrency.set(a.currency, total);
    if (b > limit || b < -limit || total > limit || total < -limit) {
      throw badRequest('This change would make a balance or total larger than BudgetTracker can record exactly.', 'balance_out_of_range');
    }
  }
}

const RATE_PERCENT_RE = /^\d{1,3}(\.\d{1,4})?$/;

function percent(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !RATE_PERCENT_RE.test(value)) throw badRequest(`${field} must be a percentage such as "19.99".`, 'invalid_rate');
  return value;
}

function dayOfMonth(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value) || value < 1 || value > 31) throw badRequest(`${field} must be a day of the month (1–31).`, 'invalid_field');
  return value;
}

function positiveAmount(value, currency, field) {
  if (value === undefined || value === null || value === '') return null;
  const minor = money.parseDecimal(value, currency, field);
  if (minor < 0) throw badRequest(`${field} cannot be negative.`, 'invalid_amount');
  return minor;
}

// Type-specific terms, validated per type; unknown keys are refused.
function validateTerms(type, terms, currency) {
  const t = terms === undefined || terms === null ? {} : terms;
  if (typeof t !== 'object' || Array.isArray(t)) throw badRequest('Account terms must be an object.', 'invalid_field');
  if (CREDIT_TYPES.has(type)) {
    fields.onlyKeys(t, ['creditLimit', 'statementDay', 'dueDay', 'minimumPayment', 'apr', 'promoApr', 'promoEndDate']);
    return {
      creditLimitMinor: positiveAmount(t.creditLimit, currency, 'Credit limit'),
      statementDay: dayOfMonth(t.statementDay, 'Statement day'),
      dueDay: dayOfMonth(t.dueDay, 'Due day'),
      minimumPaymentMinor: positiveAmount(t.minimumPayment, currency, 'Minimum payment'),
      apr: percent(t.apr, 'APR'),
      promoApr: percent(t.promoApr, 'Promotional APR'),
      promoEndDate: fields.date(t.promoEndDate, 'Promotion end date'),
    };
  }
  if (LOAN_TYPES.has(type) || type === 'other-liability') {
    fields.onlyKeys(t, ['principal', 'interestRate', 'termMonths', 'payment', 'paymentDay', 'startDate']);
    const termMonths = t.termMonths === undefined || t.termMonths === null ? null : t.termMonths;
    if (termMonths !== null && (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 600)) throw badRequest('Term must be 1–600 months.', 'invalid_field');
    return {
      principalMinor: positiveAmount(t.principal, currency, 'Principal'),
      interestRate: percent(t.interestRate, 'Interest rate'),
      termMonths,
      paymentMinor: positiveAmount(t.payment, currency, 'Payment'),
      paymentDay: dayOfMonth(t.paymentDay, 'Payment day'),
      startDate: fields.date(t.startDate, 'Start date'),
    };
  }
  fields.onlyKeys(t, []);
  return {};
}

function maskedNumber(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{2,4}$/.test(value)) throw badRequest('Only the last 2–4 digits of an account number may be stored.', 'invalid_field');
  return value;
}

// Added exactly with money.sum (BigInt), so a partial total never loses a minor unit whatever the
// order of the entries (FIN-R15).
function balanceOf(doc, account) {
  const amounts = [Number.isSafeInteger(account.openingBalanceMinor) ? account.openingBalanceMinor : 0];
  for (const t of doc.transactions || []) {
    if (t.accountId === account.id && !t.deletedAt) amounts.push(t.amountMinor);
  }
  return money.sum(amounts);
}

// How the viewer relates to an account (UX review UX-002): their own private account, a shared
// account, or someone else's private account shared with them by explicit grant. For the last,
// the owner's name is shown — a grantee already knows whose account it is, and without it a
// "Private" badge on an account that is not theirs is misleading.
function accessOf(account, principal) {
  if (account.visibility === 'shared') return 'shared';
  return account.ownerSubject === principal.subject ? 'own' : 'granted';
}

// Whether anything was ever recorded against an account (BT-006-05): an entry (deleted or reversed ones
// too, because they are kept), a bill from or into it, a grant given on it, or a Shared-expenses link
// to it. An account with none of these was most likely created by mistake.
function hasEntries(doc, account) {
  const id = account.id;
  if ((doc.transactions || []).some((t) => t.accountId === id || t.counterpartAccountId === id)) return true;
  if ((doc.recurring || []).some((r) => r.accountId === id || r.toAccountId === id)) return true;
  if ((doc.grants || []).some((g) => g.resourceId === id)) return true;
  if ((doc.groupLedgers || []).some((l) => l.accountId === id)) return true;
  return [...(doc.groupExpenses || []), ...(doc.groupSettlements || [])].some((rec) => (rec.ledgerLinks || []).some((l) => l.accountId === id));
}

function accountView(doc, principal, account, now) {
  const caps = capabilitiesFor(doc, principal, account, now);
  const access = accessOf(account, principal);
  const owner = access === 'granted' ? (doc.members || []).find((m) => m.subject === account.ownerSubject) : null;
  const out = {
    access,
    ownerName: access === 'granted' ? (owner && owner.name) || 'Another member' : null,
    id: account.id, name: account.name, type: account.type, currency: account.currency,
    visibility: account.visibility, liability: LIABILITY_TYPES.has(account.type),
    institution: account.institution || '', maskedNumber: account.maskedNumber || '',
    openingDate: account.openingDate, status: account.status || 'open', deletedAt: account.deletedAt || null,
    ownedBySelf: account.visibility === 'private' && account.ownerSubject === principal.subject,
    capabilities: [...caps].sort(), notes: account.notes || '', revision: account.revision || 1,
    ...icons.effective('account', account, doc),
  };
  // Only to people who can see its entries: to anyone else even "nothing recorded" says too much.
  if (caps.has('view-transactions')) out.hasEntries = hasEntries(doc, account);
  if (caps.has('view-balances')) {
    out.openingBalance = money.toDecimal(account.openingBalanceMinor, account.currency);
    out.openingBalanceMinor = account.openingBalanceMinor;
    out.balanceMinor = balanceOf(doc, account);
    out.balance = money.toDecimal(out.balanceMinor, account.currency);
    out.terms = account.terms || {};
  }
  return out;
}

// Signed amount from a kind and a positive magnitude. Adjustments carry their own sign.
function signedAmount(kind, amountText, currency) {
  const minor = money.parseDecimal(amountText, currency, 'Amount');
  if (kind === 'adjustment') {
    if (minor === 0) throw badRequest('An adjustment cannot be zero.', 'invalid_amount');
    return minor;
  }
  if (minor <= 0) throw badRequest('Amount must be greater than zero; the kind decides the direction.', 'invalid_amount');
  if (OUTFLOW.has(kind)) return -minor;
  if (INFLOW.has(kind)) return minor;
  throw badRequest('Unsupported transaction kind for a single-account entry.', 'invalid_kind');
}

// Split allocations must sum EXACTLY to the transaction amount; a mismatch is refused rather
// than silently absorbed into a line.
function validateSplits(splits, amountMinor, currency, doc) {
  if (splits === undefined || splits === null) return [];
  if (!Array.isArray(splits) || splits.length > 50) throw badRequest('Splits must be a list of at most 50 lines.', 'invalid_field');
  if (splits.length === 0) return [];
  const categories = new Set((doc.categories || []).map((c) => c.id));
  const sign = amountMinor < 0 ? -1 : 1;
  const out = splits.map((s, i) => {
    if (!s || typeof s !== 'object') throw badRequest(`Split ${i + 1} is not valid.`, 'invalid_field');
    fields.onlyKeys(s, ['categoryId', 'amount', 'note']);
    const categoryId = fields.optionalId(s.categoryId, 'Split category');
    if (categoryId && !categories.has(categoryId)) throw badRequest(`Split ${i + 1} category does not exist.`, 'invalid_field');
    const magnitude = money.parseDecimal(s.amount, currency, `Split ${i + 1} amount`);
    if (magnitude <= 0) throw badRequest(`Split ${i + 1} amount must be positive.`, 'invalid_amount');
    return { categoryId, amountMinor: sign * magnitude, note: fields.text(s.note, { field: 'Split note', max: 200 }) };
  });
  const total = money.sum(out.map((s) => s.amountMinor));
  if (total !== amountMinor) {
    throw badRequest(`Splits add up to ${money.toDecimal(Math.abs(total), currency)} but the amount is ${money.toDecimal(Math.abs(amountMinor), currency)}.`, 'split_mismatch');
  }
  return out;
}

// Share entries offset in full by an amount owed (financial recheck of 47617b5, L4; Terry's rule: arrows
// only for money actually in or out): the share of a shared expense someone else paid, or the spending
// half of a hand-entered pair. No money left the account for them, so they are shown with the
// no-money-moved mark and "Paid by someone else". A share one paid oneself, even in part, keeps its
// arrow. Matched per person, account and record (or pair), and per state (current, reversed, reversal).
function paidElsewhereIndex(doc) {
  const buckets = new Map();
  const byId = new Map((doc.transactions || []).map((t) => [t.id, t]));
  for (const t of doc.transactions || []) {
    if (t.kind !== 'expense' && t.kind !== 'payable') continue;
    const l = t.links || {};
    // A reversal belongs with the entry it reverses (a reversal of a hand-entered pair does not carry
    // the pair's id itself).
    const src = (l.reverses && byId.get(l.reverses)) || t;
    const groupExpenseId = l.groupExpenseId || (src.links || {}).groupExpenseId;
    const record = src.owedPairId ? `pair|${src.owedPairId}` : groupExpenseId ? `group|${t.createdBy}|${t.accountId}|${groupExpenseId}` : null;
    if (!record) continue;
    const key = `${record}|${l.reverses ? 'reversal' : t.reversedBy ? 'reversed' : 'current'}|${t.deletedAt ? 'deleted' : ''}`;
    const b = buckets.get(key) || { expenses: [], payables: [] };
    (t.kind === 'expense' ? b.expenses : b.payables).push(t);
    buckets.set(key, b);
  }
  const out = new Set();
  for (const { expenses, payables } of buckets.values()) {
    for (const e of expenses) if (payables.some((p) => p.amountMinor === -e.amountMinor)) out.add(e.id);
  }
  return out;
}

function transactionView(doc, t, principal, now, lookups) {
  const account = lookups.accounts.get(t.accountId);
  // Computed once per set of lookups (one request), after the request's own changes.
  const paidElsewhere = lookups.paidElsewhere || (lookups.paidElsewhere = paidElsewhereIndex(doc));
  // The other account of a transfer is identified only to someone who may see it, as a bill's
  // destination is (SEC-B12; security recheck of 47617b5, L3); the client then says "another account".
  const other = t.counterpartAccountId ? (doc.accounts || []).find((a) => a.id === t.counterpartAccountId) : null;
  const counterpartAccountId = other && can(doc, principal, other, 'view-balances', now) ? other.id : null;
  return {
    id: t.id, accountId: t.accountId, accountName: account ? account.name : '', kind: t.kind,
    amountMinor: t.amountMinor, amount: money.toDecimal(t.amountMinor, t.currency), currency: t.currency,
    original: t.original || null, date: t.date, postedDate: t.postedDate || null, status: t.status,
    payeeId: t.payeeId || null, payeeName: t.payeeId && lookups.payees.get(t.payeeId) ? lookups.payees.get(t.payeeId).name : '',
    categoryId: t.categoryId || null, splits: (t.splits || []).map((s) => ({ ...s, amount: money.toDecimal(s.amountMinor, t.currency) })),
    tags: t.tags || [], notes: t.notes || '', responsibleRef: t.responsibleRef || null,
    transferId: t.transferId || null, counterpartAccountId,
    // A hand-entered amount owed and its matching share, recorded and corrected together (BT-009).
    owedPairId: t.owedPairId || null,
    // A share someone else paid: no money moved (L4).
    paidBySomeoneElse: paidElsewhere.has(t.id),
    links: t.links || {}, createdAt: t.createdAt, updatedAt: t.updatedAt || null, revision: t.revision || 1,
    amendmentCount: (t.amendments || []).length, reversedBy: t.reversedBy || null,
    createdBySelf: t.createdBy === principal.subject, deletedAt: t.deletedAt || null,
  };
}

// A payee is discoverable if it is shared, created by the viewer, or referenced by a
// transaction the viewer may already see — so suggestions never reveal hidden spending.
function visiblePayees(doc, principal, visibleTxns) {
  const referenced = new Set(visibleTxns.map((t) => t.payeeId).filter(Boolean));
  return (doc.payees || []).filter((p) => !p.deletedAt && (p.visibility === 'shared' || p.ownerSubject === principal.subject || referenced.has(p.id)));
}

// Per-member quota on records a non-owner member adds (security review finding 1): one member
// cannot consume the whole workspace document and lock everyone else out. Counted as the
// serialized size of their private accounts, the entries on them and the entries they created on
// shared accounts. Owners are exempt (it is their workspace); the document cap still applies.
const PRIVATE_QUOTA_BYTES = 2 * 1024 * 1024;
// A member's allowance is the one an owner set for them (Terry, 2026-09-13: owners set each
// member's allowance; security recheck SEC-V3), otherwise the default. `BT_MEMBER_QUOTA_BYTES` may
// only lower the DEFAULT (tests).
const quotaLimit = (env, member) => {
  if (member && Number.isSafeInteger(member.allowanceBytes) && member.allowanceBytes > 0) return member.allowanceBytes;
  const configured = Number(env && env.BT_MEMBER_QUOTA_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 && configured < PRIVATE_QUOTA_BYTES ? configured : PRIVATE_QUOTA_BYTES;
};
// Nothing is ever deleted (BT-001-05), so the message does not suggest removing records.
function quotaExceeded() {
  const e = badRequest('You have reached your storage allowance in this workspace, so this change cannot be saved. Ask a workspace owner to raise it.', 'member_quota_exceeded');
  e.status = 409;
  return e;
}
function assertMemberQuota(doc, member, env) {
  if (member.role === 'owner') return;
  if (memberCharge(doc, member) > quotaLimit(env, member)) throw quotaExceeded();
}
// What a member is charged: the larger of what their records take now and all the growth their
// writes have caused (the usage counter kept by store.mutateWorkspace, security retest SEC-U1). The
// counter starts at zero for data written before it existed, which the record measure still covers.
// The member's idempotency records (kept 48 hours for safe retries) are added while they exist:
// they stop counting when they expire, so they are not in the permanent counter (SEC-V5).
function memberCharge(doc, member) {
  const usage = doc.memberUsage && typeof doc.memberUsage === 'object' && Object.prototype.hasOwnProperty.call(doc.memberUsage, member.subject) ? doc.memberUsage[member.subject] : 0;
  let retries = 0;
  // Keys are "<subject>|<key>" and a key never contains "|", so the owner is everything before the
  // last "|" — matched exactly, never as a prefix (security recheck L4).
  for (const [k, v] of Object.entries(doc.idempotency && typeof doc.idempotency === 'object' ? doc.idempotency : {})) {
    if (k.slice(0, k.lastIndexOf('|')) === member.subject) retries += Buffer.byteLength(k) + Buffer.byteLength(JSON.stringify(v));
  }
  return Math.max(memberBytes(doc, member), Number.isSafeInteger(usage) ? usage : 0) + retries;
}
// The quota's one measure: bytes a member's records take in the workspace document. Store writes
// use it too, so any write that grows a member past it is refused (security retest SEC-T2).
function memberBytes(doc, member) {
  const own = new Set((doc.accounts || []).filter((a) => a.visibility === 'private' && a.ownerSubject === member.subject).map((a) => a.id));
  let bytes = 0;
  for (const a of doc.accounts || []) if (own.has(a.id)) bytes += Buffer.byteLength(JSON.stringify(a));
  for (const t of doc.transactions || []) {
    if (own.has(t.accountId) || t.createdBy === member.subject) bytes += Buffer.byteLength(JSON.stringify(t));
  }
  // Merchants, bills and budgets a member adds count too (security review SEC-B5).
  for (const p of doc.payees || []) if (p.ownerSubject === member.subject || p.createdBy === member.subject) bytes += Buffer.byteLength(JSON.stringify(p));
  for (const r of doc.recurring || []) if (own.has(r.accountId) || r.createdBy === member.subject) bytes += Buffer.byteLength(JSON.stringify(r));
  for (const b of doc.budgets || []) if (b.ownerSubject === member.subject) bytes += Buffer.byteLength(JSON.stringify(b));
  // Records a member's own restores set aside stay in the document for good (BT-001-05), so they
  // count too; otherwise refill-and-replace cycles could grow the document without bound (SEC-R1).
  for (const s of doc.superseded || []) if (s.by === member.subject) bytes += Buffer.byteLength(JSON.stringify(s));
  return bytes;
}

module.exports = {
  assertMemberQuota, memberBytes, memberCharge, quotaLimit, quotaExceeded,
  ACCOUNT_TYPES, LIABILITY_TYPES, TX_KINDS, OUTFLOW, INFLOW, TX_STATUSES, NEVER_POSITIVE_OPENING, validateTerms, maskedNumber,
  balanceOf, accountView, hasEntries, accessOf, signedAmount, validateSplits, transactionView, visiblePayees, classify, openingBalance, assertLedgerInRange,
};
