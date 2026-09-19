// BT-009-26 offline entry: "explicit device opt-in, clear local-data disclosure, minimal retained
// data, safe retry/idempotency and conflict handling. Revalidate permissions on synchronization;
// revoked access must not be bypassed by queued changes" (Terry, 2026-09-19).
//
// Scoped to NEW shared expenses and payments only (never a correction, void, confirm or dispute —
// those change something that already exists and are never queued blind). When this device has
// explicitly opted in and adding one fails for a genuine connectivity reason (never because the
// server actually looked at it and refused it), it is kept here — its exact request body and the
// same idempotency key it would have used — until the next successful sync. Sync replays it through
// the EXACT SAME create route a normal request uses, with the caller's CURRENT session and
// membership: a permission revoked since it was queued refuses it at that moment, on the server,
// exactly like any other write — queuing something can never grant it more than it would have had
// if it were sent immediately. Minimal retained data: only the entries themselves are kept here,
// never a mirror of balances, other people's records or anything not typed by this person.
import { ErrorKind } from "./errors.js";

const ENABLED_KEY = "bt.offlineEntry.enabled";
const QUEUE_KEY = "bt.offlineEntry.queue";

export const DISCLOSURE = "When you're offline, a new shared expense or payment you add on this device is saved here until you're back online, then sent automatically with the same safeguards as sending it right away. Only what you typed is kept on this device — nothing else is downloaded or stored for offline use. Turning this off does not send or discard anything already saved here.";

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// A tiny local pub-sub, independent of the app's own store: the queue lives outside any workspace
// slice on purpose (BT-009-26's "minimal retained data" — never mirrored into the store's own
// state), so a view that wants to reflect a change here (opting in, queuing, discarding, syncing)
// subscribes directly rather than polling.
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) fn(); }

export function isEnabled() {
  const s = storage();
  return !!s && s.getItem(ENABLED_KEY) === "1";
}
export function setEnabled(value) {
  const s = storage();
  if (!s) return;
  if (value) s.setItem(ENABLED_KEY, "1");
  else s.removeItem(ENABLED_KEY);
  notify();
}

function readQueue() {
  const s = storage();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s.getItem(QUEUE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function writeQueue(list) {
  const s = storage();
  if (s) s.setItem(QUEUE_KEY, JSON.stringify(list));
  notify();
}

export function queueFor(wsId) {
  return readQueue().filter((e) => e.wsId === wsId);
}

let seq = 0;
export function enqueue({ wsId, kind, action = null, body, idempotencyKey }) {
  const entry = { id: `off_${Date.now()}_${seq++}`, wsId, kind, action, body, idempotencyKey, createdAt: new Date().toISOString(), lastError: null, blocked: false };
  writeQueue([...readQueue(), entry]);
  return entry;
}
export function discard(id) {
  writeQueue(readQueue().filter((e) => e.id !== id));
}
function updateEntry(id, patch) {
  writeQueue(readQueue().map((e) => (e.id === id ? { ...e, ...patch } : e)));
}
// A blocked item (refused for a real reason, not connectivity) is retried again only when the
// person explicitly asks — never silently forever, and never silently dropped either.
export function unblock(id) {
  updateEntry(id, { blocked: false, lastError: null });
}

// Only a genuine connectivity problem is safe to retry unattended. Anything the server actually
// looked at and rejected (permission, validation, a stale conflict) is never queued in the first
// place — the person sees it immediately, exactly as they would if they were online.
export function shouldQueue(err) {
  return !!err && (err.kind === ErrorKind.NETWORK || err.kind === ErrorKind.UNAVAILABLE);
}

// Replays every un-blocked queued item for `wsId`, oldest first. The first one that fails for a
// reason other than still being offline stops the pass (its own error is kept for review and it is
// marked "blocked" so it is not retried forever against something the server has already refused);
// everything queued before it that already succeeded stays sent.
export async function sync(ctx, wsId) {
  const mine = queueFor(wsId).filter((e) => !e.blocked);
  const sent = []; const failed = [];
  for (const entry of mine) {
    try {
      if (entry.kind === "expense") await ctx.api.createGroupExpense(wsId, entry.body, entry.idempotencyKey);
      else await ctx.api.groupAction(wsId, entry.action || "settle", entry.body, entry.idempotencyKey);
      discard(entry.id);
      sent.push(entry);
    } catch (err) {
      if (shouldQueue(err)) { failed.push(entry); break; }
      updateEntry(entry.id, { lastError: err.message || err.code || "This could not be sent.", blocked: true });
      failed.push(entry);
    }
  }
  return { sent, failed };
}
