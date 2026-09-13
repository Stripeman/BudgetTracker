'use strict';
// Managed merchant directory (BT-007-01). A merchant is a managed record with a stable id: entries,
// bills and filters link to it by id, never by name, so renaming a merchant renames it everywhere
// and two merchants with similar names stay distinct.
//
// NORMALIZATION AND DUPLICATES: names are compared by a normalized search form (accents folded,
// case and punctuation ignored, "&" = "and", a leading "The" and trailing legal suffixes such as
// "Ltd" or "GmbH" dropped). Creating or renaming to a normalized name that already exists in the
// same scope is refused with the existing merchant's id so the person can use it instead; similar
// names are offered as suggestions but never block. Only merchants the caller may already see are
// compared, so the check never reveals another member's private merchant.
//
// LIFECYCLE: merchants are never deleted (BT-001-05). Closing a merchant removes it from new-entry
// choices; every entry already linked to it keeps the link and its history. It can be reopened.
//
// PRIVACY: a merchant used on a shared account must itself be shared, so a private merchant's name
// never reaches other members through a shared record. On a private account the merchant must be
// shared or belong to the account's owner.
const { HttpError, badRequest } = require('./http');
const fields = require('./fields');
const ledger = require('./ledger');
const { visibleTransactions } = require('./authz');

const MERCHANT_TYPES = Object.freeze(['retailer', 'grocery', 'restaurant', 'utility', 'housing', 'employer', 'bank', 'insurer', 'subscription', 'transport', 'health', 'government', 'person', 'other']);
const LEGAL_SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'plc', 'gmbh', 'ag', 'sa', 'sarl', 'bv', 'nv', 'oy', 'ab', 'co', 'corp', 'corporation', 'company']);

function normalizeName(name) {
  const words = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words.join(' ');
}

// Levenshtein distance, abandoned early once it exceeds `limit`.
function distance(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

function isSimilar(a, b) {
  if (!a || !b || a === b) return false;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  return Math.min(a.length, b.length) >= 5 && distance(a, b) <= 2;
}

const keysOf = (p) => [p.normalizedName || normalizeName(p.name), ...(p.aliases || []).map(normalizeName)].filter(Boolean);
const statusOf = (p) => p.status || 'active';

// Exact and similar merchants among those the caller may see, in the scope the merchant would live in.
function findDuplicates(doc, principal, now, { name, aliases = [], visibility, ownerSubject, exceptId = null }) {
  const visible = ledger.visiblePayees(doc, principal, visibleTransactions(doc, principal, now));
  const inScope = visible.filter((p) => p.id !== exceptId && (p.visibility === 'shared' || (visibility === 'private' && p.ownerSubject === ownerSubject)));
  const mine = [normalizeName(name), ...aliases.map(normalizeName)].filter(Boolean);
  const exact = inScope.filter((p) => keysOf(p).some((k) => mine.includes(k)));
  const similar = inScope.filter((p) => !exact.includes(p) && keysOf(p).some((k) => mine.some((m) => isSimilar(k, m))));
  return { exact, similar };
}

const brief = (p) => ({ id: p.id, name: p.name, status: statusOf(p) });

function duplicateError(p) {
  const closed = statusOf(p) === 'closed' ? ' (closed — you can reopen it)' : '';
  return new HttpError(409, 'duplicate_merchant', `${p.name} is already in your merchant list${closed}. Use it, or add this one as a separate merchant.`, brief(p));
}

function usableOn(p, account) {
  if (account.visibility === 'shared') return p.visibility === 'shared';
  return p.visibility === 'shared' || p.ownerSubject === account.ownerSubject;
}

function requireOpen(doc, payeeId) {
  const p = payeeId && (doc.payees || []).find((x) => x.id === payeeId);
  if (p && statusOf(p) === 'closed') throw badRequest(`${p.name} is closed. Reopen it on the Merchants tab or choose another merchant.`, 'merchant_closed');
  return payeeId || null;
}

// Validates a merchant chosen for an entry or a bill on `account`. `current` is the merchant the
// record already has: keeping it is always allowed, even if that merchant has since closed.
function requireMerchant(doc, principal, account, payeeId, now, { current = null } = {}) {
  const id = fields.optionalId(payeeId, 'Merchant');
  if (!id) return null;
  if (id === current) return id;
  const p = (doc.payees || []).find((x) => x.id === id && !x.deletedAt);
  const visible = p && (p.createdBy === principal.subject || ledger.visiblePayees(doc, principal, visibleTransactions(doc, principal, now)).some((x) => x.id === id));
  if (!p || !visible || !usableOn(p, account)) throw badRequest('Choose a merchant from your merchant list.', 'invalid_payee');
  return requireOpen(doc, id);
}

module.exports = { MERCHANT_TYPES, normalizeName, isSimilar, findDuplicates, duplicateError, brief, statusOf, usableOn, requireOpen, requireMerchant };
