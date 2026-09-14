'use strict';
// BT-003-03 staged-content scan. Runs from .githooks/pre-commit and can be run by hand:
//   node scripts/scan-staged.cjs
// Ignore rules are one layer only; this inspects what is ACTUALLY staged (paths and blob
// content from the index, not the working tree) before a commit reaches this public repo.
// It then runs gitleaks against the staged diff when a gitleaks binary is available.
// Findings print the path, rule and line number only — never the matched value.
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAX_BYTES = 1024 * 1024;
const LARGE_ALLOWED = [/^app\/vendor\/[^/]+\.js$/];

// Paths that must never be committed, whatever .gitignore says.
const FORBIDDEN_PATHS = [
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/i, 'environment-file'],
  [/(^|\/)local\.settings\.json$/i, 'functions-local-settings'],
  [/\.(pem|key|pfx|p12|jks|keystore)$/i, 'key-material'],
  [/(credentials|service-account|client_secret)[^/]*\.json$/i, 'credential-json'],
  [/\.(db|sqlite|sqlite3|mdb|accdb)$/i, 'local-database'],
  [/\.(zip|7z|tar|gz|tgz|bak|dump|btbackup)$/i, 'archive-or-backup'],
  [/\.(ofx|qfx|qif|mt940|camt|sta)$/i, 'bank-export'],
  [/\.(xlsx|xls|numbers|ods)$/i, 'spreadsheet'],
  [/\.(docx|doc|pdf)$/i, 'document'],
  // Root-anchored like .gitignore: these names are private-data folders at the repository root.
  // Source directories with the same name (for example api/backups/) are code, not data.
  [/^(private-data|data|exports|imports|receipts|attachments|backups|restore-staging)\//i, 'private-data-directory'],
  [/(^|\/)(__blobstorage__|__queuestorage__|\.azurite|\.azurelite)\//i, 'emulator-state'],
  [/(^|\/)__azurite_db_[^/]*\.json$/i, 'emulator-state'],
  [/\.tfstate(\.|$)/i, 'terraform-state'],
  [/(^|\/)(history\.jsonl|sessions\/)/i, 'agent-session-output'],
];
// CSV and images are only allowed where fictional fixtures or app assets live.
const FIXTURE_ONLY = [
  [/\.(csv|tsv)$/i, /^(test|api\/test)\/fixtures\//, 'csv-outside-fixtures'],
  [/\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$/i, /^(app\/assets|docs\/images|test\/fixtures|api\/test\/fixtures)\//, 'image-outside-assets'],
];

const CONTENT_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private-key'],
  [/AccountKey=[A-Za-z0-9+/=]{20,}/, 'azure-storage-key'],
  [/SharedAccess(?:Signature)=|[?&]sig=[A-Za-z0-9%+/=]{20,}/, 'azure-sas'],
  [/DefaultEndpointsProtocol=https?;AccountName=(?!devstoreaccount1;)/, 'azure-connection-string'],
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, 'google-client-secret'],
  [/AIza[0-9A-Za-z_-]{35}/, 'google-api-key'],
  [/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/, 'github-token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'aws-access-key'],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{20,}/, 'api-secret-key'],
  [/\bre_[A-Za-z0-9]{20,}\b/, 'resend-key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'jwt'],
  [/(client_?secret|api_?key|password|passwd|secret_?key|access_?token)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i, 'assigned-secret'],
];

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const EMAIL_ALLOWED = [/@example\.(com|org|net)$/i, /\.(test|invalid|example)$/i, /^noreply@anthropic\.com$/i,
  /@users\.noreply\.github\.com$/i];

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function ibanValid(candidate) {
  const s = candidate.replace(/ /g, '');
  if (s.length < 15 || s.length > 34) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of moved) {
    const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function scanPath(file) {
  const findings = [];
  const normalized = file.replace(/\\/g, '/');
  if (/^\.env\.example$|\/\.env\.example$/i.test(normalized)) return findings;
  for (const [pattern, rule] of FORBIDDEN_PATHS) if (pattern.test(normalized)) findings.push({ file, rule });
  for (const [pattern, allowed, rule] of FIXTURE_ONLY) {
    if (pattern.test(normalized) && !allowed.test(normalized)) findings.push({ file, rule });
  }
  return findings;
}

// npm writes the registry's own deprecation notices into lockfiles, and some quote a package
// maintainer's public contact address. That is third-party package metadata, not a personal
// identifier of anyone in this project, and hand-editing it would be undone by the next install.
// The exception is deliberately narrow: only `"deprecated":` lines, only in package-lock.json.
const isLockfileDeprecation = (file, line) => /(^|[\\/])package-lock\.json$/.test(file) && /^\s*"deprecated":\s*"/.test(line);

// A registered vendored bundle (app/js/vendor/<name>/, validate.cjs rule 10) carries the MIT
// licence notices of the packages compiled into it, and the licence requires their copyright lines
// to ship with the code. Some quote the author's public address. That is third-party licence text,
// not a personal identifier of anyone in this project. Equally narrow as the lockfile exception:
// only files under app/js/vendor/, only lines inside the file's opening generated comment block,
// and only lines that are a copyright line (" * ... Copyright ..."). An address anywhere else in
// the bundle, or in any other file, is still refused.
// Narrowed after security review SEC-R6: only a REGISTERED bundle directory at the repository's
// app/js/vendor (keep in step with VENDORED_BUNDLES in scripts/validate.cjs rule 10), only a banner
// that starts the file with the generator's "GENERATED FILE" line and closes within
// BANNER_MAX_LINES, and only the address check is skipped — card, IBAN and secret rules still run.
const VENDORED_DIRS = ['tiptap'];
const BANNER_MAX_LINES = 300;
const isVendoredFile = (file) => {
  const m = /^app\/js\/vendor\/([^/]+)\/[^/]+\.js$/.exec(file.replace(/\\/g, '/'));
  return !!m && VENDORED_DIRS.includes(m[1]);
};
const isCopyrightLine = (line) => /^\s*\*\s+Copyright\b/i.test(line);

function bannerEndOf(file, lines) {
  if (!isVendoredFile(file) || !/^\/\*/.test(lines[0] || '') || !/^\s*\*\s+GENERATED FILE\b/.test(lines[1] || '')) return -1;
  const end = lines.findIndex((l) => l.includes('*/'));
  return end > 0 && end <= BANNER_MAX_LINES ? end : -1;
}

function scanContent(file, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  const bannerEnd = bannerEndOf(file, lines);
  lines.forEach((line, index) => {
    const at = index + 1;
    for (const [pattern, rule] of CONTENT_RULES) if (pattern.test(line)) findings.push({ file, line: at, rule });
    const addressExempt = isLockfileDeprecation(file, line) || (index < bannerEnd && isCopyrightLine(line));
    if (!addressExempt) for (const match of line.matchAll(EMAIL)) {
      if (!EMAIL_ALLOWED.some(allowed => allowed.test(match[0]))) findings.push({ file, line: at, rule: 'personal-email' });
    }
    for (const match of line.matchAll(/\b[3-6]\d{3}(?:[ -]?\d{4}){2}[ -]?\d{1,4}\b/g)) {
      const digits = match[0].replace(/[ -]/g, '');
      if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) findings.push({ file, line: at, rule: 'payment-card-number' });
    }
    for (const match of line.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g)) {
      if (ibanValid(match[0])) findings.push({ file, line: at, rule: 'iban' });
    }
  });
  return findings;
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...options });
}

function stagedFiles() {
  return git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).toString('utf8').split('\0').filter(Boolean);
}

function gitleaksBinary() {
  const local = path.join(ROOT, '.local', 'bin', process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  if (existsSync(local)) return local;
  try { execFileSync('gitleaks', ['version'], { stdio: 'ignore' }); return 'gitleaks'; } catch { return null; }
}

function main() {
  const files = stagedFiles();
  const findings = [];
  for (const file of files) {
    findings.push(...scanPath(file));
    const blob = git(['show', `:${file}`]);
    if (blob.length > MAX_BYTES && !LARGE_ALLOWED.some(p => p.test(file))) findings.push({ file, rule: 'large-file' });
    if (!blob.subarray(0, 8000).includes(0)) findings.push(...scanContent(file, blob.toString('utf8')));
  }
  for (const f of findings) console.error(`scan-staged: ${f.rule} in ${f.file}${f.line ? `:${f.line}` : ''}`);
  const gitleaks = gitleaksBinary();
  let leaks = false;
  if (gitleaks) {
    try {
      execFileSync(gitleaks, ['git', '--pre-commit', '--staged', '--redact', '--no-banner', ROOT], { stdio: 'inherit' });
    } catch { leaks = true; }
  } else {
    console.error('scan-staged: gitleaks not found (.local/bin or PATH); CI secret-scan remains required.');
  }
  if (findings.length || leaks) {
    console.error(`scan-staged: blocked commit (${findings.length} finding(s)${leaks ? ', gitleaks leaks' : ''}).`);
    process.exit(1);
  }
  console.log(`scan-staged: ${files.length} staged file(s) clean${gitleaks ? ' (gitleaks passed)' : ''}.`);
}

if (require.main === module) main();
module.exports = { scanPath, scanContent, luhn, ibanValid };
