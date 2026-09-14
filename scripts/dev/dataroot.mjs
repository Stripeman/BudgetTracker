// Where a LOCAL dev server and the fictional seed keep their data (fictional data only).
//
// Without BT_DEV_DATA_ROOT nothing changes: .local/dev-data, .local/dev-backups and
// .local/dev-backup-key, as `npm run dev` and `npm run seed:dev` always used. With it, a directory
// STRICTLY INSIDE the ignored .local/ holds that server's own data, backups and backup key, so a
// second server (the multi-user browser harness, BT-004-06) never reads or writes Terry's local data.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LOCAL = path.join(ROOT, ".local");

// True only when `child` is strictly inside `parent`: never equal, never a sibling such as
// ".local-other", never reached through "..", never on another drive.
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function resolveDataRoot(env = process.env, root = ROOT) {
  const local = path.join(root, ".local");
  const raw = env.BT_DEV_DATA_ROOT;
  const dataRoot = raw ? path.resolve(raw) : local;
  if (raw && !isInside(local, dataRoot)) throw new Error("BT_DEV_DATA_ROOT must be a directory inside .local/.");
  return {
    local,
    dataRoot,
    dataDir: path.join(dataRoot, "dev-data"),
    backupDir: path.join(dataRoot, "dev-backups"),
    keyFile: path.join(dataRoot, "dev-backup-key"),
  };
}
