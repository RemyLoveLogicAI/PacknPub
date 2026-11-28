import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

function existsNoFollow(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Ensures a relative path resolves strictly inside cwd. Blocks traversal and absolute paths lexically,
 * then resolves the deepest existing component (following symlinks) so a symlinked file or parent
 * directory cannot redirect writes outside the project root.
 */
export function safeResolve(cwd: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`unsafe path outside project root: ${relativePath}`);
  }
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, relativePath);
  if (!isInside(root, resolved)) {
    throw new Error(`path traversal blocked: ${relativePath}`);
  }
  let probe = resolved;
  while (probe !== root && !existsNoFollow(probe)) probe = path.dirname(probe);
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    // root does not exist yet; nothing below it can be a symlink
    return resolved;
  }
  let realProbe: string;
  try {
    realProbe = realpathSync(probe);
  } catch {
    throw new Error(`symlink escape blocked (dangling link): ${relativePath}`);
  }
  if (!isInside(realRoot, realProbe)) {
    throw new Error(`symlink escape blocked: ${relativePath} resolves outside the project root`);
  }
  return resolved;
}

const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PACKAGE_NAME_RE = /^(?:@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

/**
 * Validates names that are interpolated into generated filenames, YAML, shell commands and Ruby
 * (bin name, owner, repo). Only letters, digits, `.`, `_` and `-` are allowed, so quotes, newlines,
 * shell metacharacters and path separators can never reach a template.
 */
export function validateSafeName(label: string, value: string): string {
  if (!value || value.includes("..") || !SAFE_NAME_RE.test(value)) {
    throw new Error(`unsafe ${label}: ${JSON.stringify(value)} (allowed: letters, digits, ".", "_", "-")`);
  }
  return value;
}

/** Validates an npm package name before it is interpolated into generated workflows or formulas. */
export function validatePackageName(value: string): string {
  if (!value || value.includes("..") || !PACKAGE_NAME_RE.test(value)) {
    throw new Error(`unsafe package name: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Validates a semver-like version before it is interpolated into generated formulas or URLs. */
export function validateVersion(value: string): string {
  if (!value || !VERSION_RE.test(value)) {
    throw new Error(`unsafe version: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Escapes free text for the body of a Ruby double-quoted string (blocks `#{...}` interpolation). */
export function rubyStringBody(value: string): string {
  return value
    .replace(/[\\"#]/g, (c) => `\\${c}`)
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u{${c.charCodeAt(0).toString(16)}}`);
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
