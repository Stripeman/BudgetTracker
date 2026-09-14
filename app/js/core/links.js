// The staging link's address, checked again in the browser before it becomes a link (BT-011-06).
// The server is the authority (api/_shared/fields.js `webAddress`); this is the same rule, so a
// stored, stale or tampered value can never become a javascript:, credential-disguised, look-alike or
// odd-form link. A test runs identical cases through both sides:
//   * https, or http to 127.0.0.1, [::1] or localhost only while the app runs in the LOCAL development
//     environment (`local`, from the environment the server reports; the server decides for itself);
//   * printable ASCII only, "//" and no backslash, at most 300 characters before and after normalising;
//   * the authority as TYPED has no "@" or "%", no port 0 or empty port, and a host that is a normal
//     DNS name, a dotted-quad IPv4 or a bracketed IPv6 address: no hexadecimal, octal or shortened IP
//     forms and no empty labels (security review of d363eff, finding 5);
//   * the address used is the normalised `new URL(value).href`.
export const STAGING_MAX = 300;
const CHARS = /^[\x21-\x7e]+$/;
const LOOPBACK = Object.freeze(["127.0.0.1", "[::1]", "localhost"]);
const PART = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const DOTTED_QUAD = new RegExp(`^${PART}(\\.${PART}){3}$`);
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
// A last label the URL parser would read as a number (decimal, or 0x hexadecimal) makes it an IPv4 address.
const NUMERIC_LABEL = /^(\d+|0x[0-9a-f]*)$/i;

// Only ASCII spaces and line breaks around an address are trimmed, as on the server:
// String.prototype.trim would also strip a byte-order mark, and hidden characters are refused.
export const trimAddress = (raw) => String(raw).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");

function typedHostOk(host) {
  if (host.startsWith("[")) return /^\[[0-9a-f:.]+\]$/i.test(host);
  if (DOTTED_QUAD.test(host)) return true;
  if (host.length > 253) return false;
  const labels = host.split(".");
  return labels.every((l) => DNS_LABEL.test(l)) && !NUMERIC_LABEL.test(labels[labels.length - 1]);
}

// The authority as typed: its host (lower case) and port, or null when the form is refused.
function typedAuthority(address) {
  const m = /^https?:\/\/([^/?#]*)/i.exec(address);
  if (!m || !m[1] || /[@%]/.test(m[1])) return null;
  const authority = m[1];
  let host = authority;
  let port = null;
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 0) return null;
    host = authority.slice(0, close + 1);
    const rest = authority.slice(close + 1);
    if (rest) { if (!rest.startsWith(":")) return null; port = rest.slice(1); }
  } else if (authority.includes(":")) {
    const parts = authority.split(":");
    if (parts.length !== 2) return null;
    [host, port] = parts;
  }
  if (port !== null && (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)) return null;
  return typedHostOk(host) ? { host: host.toLowerCase(), port } : null;
}

// The normalised address to use as a link, or null when it must not become one.
export function stagingHref(raw, { local = false } = {}) {
  if (typeof raw !== "string") return null;
  const cleaned = trimAddress(raw);
  if (!cleaned || cleaned.length > STAGING_MAX || !CHARS.test(cleaned) || cleaned.includes("\\")) return null;
  if (!/^https?:\/\/[^/]/i.test(cleaned)) return null;
  const typed = typedAuthority(cleaned);
  if (!typed) return null;
  let url;
  try { url = new URL(cleaned); } catch { return null; }
  if (url.username || url.password) return null;
  if (!typed.host.startsWith("[") && url.hostname !== typed.host) return null;
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local && LOOPBACK.includes(url.hostname)))) return null;
  const href = url.href;
  return href.length <= STAGING_MAX && CHARS.test(href) ? href : null;
}

// The host people see beside the link and in its tooltip, as the browser will really connect to it.
export function stagingHost(href) {
  try { return new URL(href).host; } catch { return ""; }
}
