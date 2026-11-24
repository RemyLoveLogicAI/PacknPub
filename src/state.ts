import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const STATE_REL_PATH = ".packnpub/state.json";
export const BACKUPS_REL_DIR = ".packnpub/backups";

export interface ManagedFileRecord {
  sha256: string;
  template: string;
}

export interface PacknPubState {
  schemaVersion: 1;
  contractVersion: string;
  templateVersion: string;
  targets: string[];
  owner: string;
  repo: string;
  managedFiles: Record<string, ManagedFileRecord>;
}

export interface BackupManifest {
  createdAt: string;
  files: Array<{ path: string; existed: boolean; content?: string }>;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Ensures a relative path resolves strictly inside cwd (blocks path traversal and absolute escapes). */
export function safeResolve(cwd: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`unsafe path outside project root: ${relativePath}`);
  }
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path traversal blocked: ${relativePath}`);
  }
  return resolved;
}

/** Validates a bin name used in generated filenames so it cannot contain path separators or traversal segments. */
export function validateSafeName(label: string, value: string): string {
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value) || value.includes("..")) {
    throw new Error(`unsafe ${label}: "${value}"`);
  }
  return value;
}

export function readState(cwd: string): PacknPubState | undefined {
  const file = safeResolve(cwd, STATE_REL_PATH);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as PacknPubState;
}

export function writeState(cwd: string, state: PacknPubState): void {
  const file = safeResolve(cwd, STATE_REL_PATH);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function createBackup(cwd: string, relPaths: string[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = safeResolve(cwd, path.join(BACKUPS_REL_DIR, stamp));
  mkdirSync(backupDir, { recursive: true });

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    files: relPaths.map((rel) => {
      const full = safeResolve(cwd, rel);
      if (existsSync(full)) {
        return { path: rel, existed: true, content: readFileSync(full, "utf8") };
      }
      return { path: rel, existed: false };
    }),
  };

  const manifestPath = path.join(backupDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return path.join(BACKUPS_REL_DIR, stamp);
}

export function restoreLatestBackup(cwd: string): { restoredFrom: string; restored: string[]; removed: string[] } {
  const backupsRoot = safeResolve(cwd, BACKUPS_REL_DIR);
  if (!existsSync(backupsRoot)) {
    throw new Error("no PacknPub backups found under .packnpub/backups");
  }
  const entries = readdirSync(backupsRoot).sort();
  const latest = entries.pop();
  if (!latest) {
    throw new Error("no PacknPub backups found under .packnpub/backups");
  }
  const manifestFile = path.join(backupsRoot, latest, "manifest.json");
  if (!existsSync(manifestFile)) {
    throw new Error(`backup manifest missing in ${latest}`);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as BackupManifest;
  const restored: string[] = [];
  const removed: string[] = [];

  for (const item of manifest.files) {
    const dest = safeResolve(cwd, item.path);
    if (item.existed) {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, item.content ?? "");
      restored.push(item.path);
    } else if (existsSync(dest)) {
      rmSync(dest, { force: true });
      removed.push(item.path);
    }
  }

  return { restoredFrom: path.join(BACKUPS_REL_DIR, latest), restored, removed };
}
