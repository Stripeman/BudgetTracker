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
const { capabilitiesFor } = require('./authz');

const ACCOUNT_TYPES = Object.freeze(['checking', 'savings', 'cash', 'credit-card', 'loan', 'mortgage',
  'merchant-credit', 'investment', 'other-asset', 'other-liability']);
const LIABILITY_TYPES = new Set(['credit-card', 'loan', 'mortgage', 'merchant-credit', 'other-liability']);
const CREDIT_TYPES = new Set(['credit-card', 'merchant-credit']);
const LOAN_TYPES = new Set(['loan', 'mortgage']);

const TX_KINDS = Object.freeze(['expense', 'income', 'transfer', 'refund', 'fee', 'reimbursement', 'advance', 'adjustment', 'interest']);
const OUTFLOW = new Set(['expense', 'fee', 'advance', 'interest']);
const INFLOW = new Set(['income', 'refund', 'reimbursement']);
const TX_STATUSES = Object.freeze(['pending', 'cleared', 'reconciled']);

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

function balanceOf(doc, account) {
  let total = Number.isSafeInteger(account.openingBalanceMinor) ? account.openingBalanceMinor : 0;
  for (const t of doc.transactions || []) {
    if (t.accountId === account.id && !t.deletedAt) total += t.amountMinor;
  }
  return total === 0 ? 0 : total;
}

function accountView(doc, principal, account, now) {
  const caps = capabilitiesFor(doc, principal, account, now);
  const out = {
    id: account.id, name: account.name, type: account.type, currency: account.currency,
    visibility: account.visibility, liability: LIABILITY_TYPES.has(account.type),
    institution: account.institution || '', maskedNumber: account.maskedNumber || '',
    openingDate: account.openingDate, status: account.status || 'open', deletedAt: account.deletedAt || null,
    ownedBySelf: account.visibility === 'private' && account.ownerSubject === principal.subject,
    capabilities: [...caps].sort(), notes: account.notes || '',
  };
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

function transactionView(doc, t, principal, now, lookups) {
  const account = lookups.accounts.get(t.accountId);
  return {
    id: t.id, accountId: t.accountId, accountName: account ? account.name : '', kind: t.kind,
    amountMinor: t.amountMinor, amount: money.toDecimal(t.amountMinor, t.currency), currency: t.currency,
    original: t.original || null, date: t.date, postedDate: t.postedDate || null, status: t.status,
    payeeId: t.payeeId || null, payeeName: t.payeeId && lookups.payees.get(t.payeeId) ? lookups.payees.get(t.payeeId).name : '',
    categoryId: t.categoryId || null, splits: (t.splits || []).map((s) => ({ ...s, amount: money.toDecimal(s.amountMinor, t.currency) })),
    tags: t.tags || [], notes: t.notes || '', responsibleRef: t.responsibleRef || null,
    transferId: t.transferId || null, counterpartAccountId: t.counterpartAccountId || null,
    links: t.links || {}, createdAt: t.createdAt, updatedAt: t.updatedAt || null, revision: t.revision || 1,
    createdBySelf: t.createdBy === principal.subject, deletedAt: t.deletedAt || null,
  };
}

// A payee is discoverable if it is shared, created by the viewer, or referenced by a
// transaction the viewer may already see — so suggestions never reveal hidden spending.
function visiblePayees(doc, principal, visibleTxns) {
  const referenced = new Set(visibleTxns.map((t) => t.payeeId).filter(Boolean));
  return (doc.payees || []).filter((p) => !p.deletedAt && (p.visibility === 'shared' || p.ownerSubject === principal.subject || referenced.has(p.id)));
}

module.exports = {
  ACCOUNT_TYPES, LIABILITY_TYPES, TX_KINDS, OUTFLOW, INFLOW, TX_STATUSES, validateTerms, maskedNumber,
  balanceOf, accountView, signedAmount, validateSplits, transactionView, visiblePayees,
};
