'use strict';
// BT-002 isolated restore drill (service-level recovery operator tool).
//
//   node scripts/recovery/drill.cjs --archive <file.btbk> --workspace <wsId> --target <empty dir>
//
// Keys come from BT_BACKUP_KEYS / BT_BACKUP_ACTIVE_KEY in the operator's environment (never from
// arguments or files in the repository). The drill:
//   1. verifies the header, decrypts, validates schema, attachments and financial invariants;
//   2. restores the COMPLETE document and attachments into an EMPTY isolated directory (it refuses
//      a non-empty target, so it can never overwrite live or previous data);
//   3. reads the restored copy back, recomputes every balance and compares it to the manifest;
//   4. prints a JSON report of counts, checks and durations — no names, amounts or identifiers of
//      people. Operators record the report in the recovery log (see docs/RECOVERY_RUNBOOK.md).
const fs = require('node:fs');
const path = require('node:path');
const archive = require('../../api/_shared/archive');
const backup = require('../../api/_shared/backup');
const { createFileStorage } = require('../../api/_shared/storage');
const { readDocument } = require('../../api/_shared/schema');

async function runDrill({ archiveBytes, env, workspaceId, targetDir }) {
  const started = process.hrtime.bigint();
  const checks = [];
  const check = (name, ok) => { checks.push({ name, ok: !!ok }); if (!ok) throw new Error(`Drill check failed: ${name}`); };
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length) throw new Error('Drill target must be an empty directory.');
  const keyring = archive.loadKeys(env);
  const { header } = archive.readHeader(archiveBytes);
  check('header.workspace-matches', header.workspaceId === workspaceId);
  const opened = backup.openArchive(archiveBytes, keyring, workspaceId);
  check('decrypt-and-validate', true);
  const target = createFileStorage(targetDir);
  for (const a of opened.attachments) await target.putBytes(`workspaces/${workspaceId}/attachments/${a.sha256}`, Buffer.from(a.base64, 'base64'), { ifNoneMatch: '*' });
  await target.putJson(`workspaces/${workspaceId}/workspace.json`, opened.doc, { ifNoneMatch: '*' });
  const restoredAt = process.hrtime.bigint();
  const readBack = readDocument('workspace', (await target.getJson(`workspaces/${workspaceId}/workspace.json`)).value);
  const attachments = await backup.readAttachments(target, workspaceId);
  check('attachments-complete', attachments.length === opened.attachments.length);
  const manifest = backup.manifestOf(readBack, attachments);
  check('balances-match-manifest', JSON.stringify(manifest.balances) === JSON.stringify(opened.manifest.balances));
  check('counts-match-manifest', JSON.stringify(manifest.counts) === JSON.stringify(opened.manifest.counts));
  const finished = process.hrtime.bigint();
  return {
    archiveId: header.archiveId, archiveCreatedAt: header.createdAt, schemaVersion: header.schemaVersion, keyId: header.keyId,
    counts: manifest.counts, checks,
    durationsMs: { restore: Number(restoredAt - started) / 1e6, verify: Number(finished - restoredAt) / 1e6, total: Number(finished - started) / 1e6 },
    recoveryPointAgeHours: Math.round(((Date.now() - Date.parse(header.createdAt)) / 36e5) * 10) / 10,
    result: 'passed',
  };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith('--') ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
  if (!args.archive || !args.workspace || !args.target) {
    console.error('usage: node scripts/recovery/drill.cjs --archive <file> --workspace <wsId> --target <empty dir>');
    process.exit(2);
  }
  try {
    const report = await runDrill({ archiveBytes: fs.readFileSync(path.resolve(args.archive)), env: process.env, workspaceId: args.workspace, targetDir: path.resolve(args.target) });
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    console.error(`drill failed: ${e.code || ''} ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { runDrill };
