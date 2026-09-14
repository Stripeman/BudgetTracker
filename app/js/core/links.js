// The staging link's address, checked again in the browser before it becomes a link (BT-011-06).
// The server is the authority (api/_shared/fields.js `webAddress`, which builds on the rich-text link
// rule); this is the same rule, so a stored, stale or tampered value can never become a javascript:,
// credential-disguised or look-alike link. A test checks both sides agree case by case.
//   * https only, written with "//" and no backslash;
//   * printable ASCII only: no spaces, no control, invisible or direction-changing characters and no
//     look-alike Unicode host (international names are written in their xn-- form);
//   * no user name or password; at most 300 characters.
export const STAGING_MAX = 300;
const CHARS = /^[\x21-\x7e]+$/;

// Only ASCII spaces and line breaks around an address are trimmed, as on the server:
// String.prototype.trim would also strip a byte-order mark, and hidden characters are refused.
export const trimAddress = (raw) => String(raw).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");

// The address to use as a link, or null when it must not become one.
export function stagingHref(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = trimAddress(raw);
  if (!cleaned || cleaned.length > STAGING_MAX || !CHARS.test(cleaned) || cleaned.includes("\\")) return null;
  if (!/^https:\/\/[^/]/i.test(cleaned)) return null;
  let url;
  try { url = new URL(cleaned); } catch { return null; }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  return cleaned;
}

// The host people see beside the link, as the browser will really connect to it.
export function stagingHost(href) {
  try { return new URL(href).host; } catch { return ""; }
}
