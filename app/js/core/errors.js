// API error classification (pattern from TaskTracker app/js/core/errors.js).
// Rule: an error is never rendered as an empty result. "Denied" or "unreadable" must not look
// like "you have no transactions".

export const ErrorKind = Object.freeze({
  NETWORK: "network",
  UNAUTHENTICATED: "unauthenticated",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  TOO_LARGE: "too_large",
  SCHEMA: "schema",
  UNAVAILABLE: "unavailable",
  CLIENT: "client",
  SERVER: "server",
});

export class ApiError extends Error {
  constructor({ kind, status = 0, code = "", message = "", details } = {}) {
    super(message || code || kind);
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get isAuthFailure() { return this.kind === ErrorKind.UNAUTHENTICATED; }
}

export function classify(status, code) {
  if (code === "schema_unsupported" || code === "schema_too_old" || code === "schema_invalid") return ErrorKind.SCHEMA;
  if (status === 401) return ErrorKind.UNAUTHENTICATED;
  if (status === 403) return ErrorKind.FORBIDDEN;
  if (status === 404) return ErrorKind.NOT_FOUND;
  if (status === 409) return ErrorKind.CONFLICT;
  if (status === 413) return ErrorKind.TOO_LARGE;
  if (status === 503) return ErrorKind.UNAVAILABLE;
  if (status >= 400 && status < 500) return ErrorKind.CLIENT;
  return ErrorKind.SERVER;
}

// The server's message is written for people and never contains another person's data, so it is
// shown as-is; the fallbacks cover transport failures.
export function messageFor(error) {
  if (!error) return "";
  if (error.kind === ErrorKind.NETWORK) return "BudgetTracker could not be reached. Check your connection and try again.";
  if (error.kind === ErrorKind.UNAUTHENTICATED) return "Your session has ended. Sign in again to continue.";
  return error.message || "Something went wrong. Nothing was changed.";
}
