import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { CONTRACT_VERSION, findNonGoal, TEMPLATE_VERSION } from "./contract.js";
import { detectProject, unscopedName, type PackageJson, type Project } from "./detect.js";
import type { Check } from "./doctor.js";
import { unifiedDiff } from "./diff.js";
import {
  readState,
  safeResolve,
  rubyStringBody,
  sha256,
  validatePackageName,
  validateSafeName,
  validateVersion,
  writeState,
  type ManagedFileRecord,
} from "./state.js";
import { TARGETS, formulaClassName, readTemplate, render, type Target } from "./templates.js";

/** POSIX single-quote escape for values embedded in suggested shell commands. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Write via temp+rename; preserve an existing destination mode when overwriting. */
export function writeAtomic(dest: string, contents: string, mode?: number): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  let created = false;
  let settled = false;
  try {
    // Exclusive + owner-only until the final mode is applied
    writeFileSync(tmp, contents, { mode: 0o600, flag: "wx" });
    created = true;
    let applyMode = mode;
    if (applyMode === undefined) {
      if (existsSync(dest)) {
        try {
          applyMode = statSync(dest).mode & 0o777;
        } catch {
          // destination unreadable — keep the restrictive 0o600 temp mode
        }
      } else if (process.platform !== "win32") {
        // New file: match normal create semantics once the restrictive temp is ready
        applyMode = 0o666 & ~process.umask();
      }
    }
    // win32 chmod is a no-op for exec bits; skip to avoid EPERM noise
    if (applyMode !== undefined && process.platform !== "win32") chmodSync(tmp, applyMode);
    renameSync(tmp, dest);
    settled = true;
  } finally {
    // Only unlink temps THIS call created — never remove another writer's EEXIST collision
    if (created && !settled) {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort cleanup; preserve the original error from try
      }
    }
  }
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function assertOwner(owner: string): void {
  if (owner === OWNER_PLACEHOLDER) return;
  if (!owner || owner.length > 39 || !OWNER_RE.test(owner)) {
    throw new UsageError(
      owner
        ? `invalid --owner "${owner}": use a GitHub user or org name (letters, digits, ._-; no spaces or shell metacharacters)`
        : "invalid --owner: value must not be empty",
    );
  }
}

export interface InitOptions {
  cwd: string;
  yes?: boolean;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  owner?: string;
  targets?: string;
  interactive: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
  patched: string[];
  warnings: string[];
  diffs: Record<string, string>;
  contractVersion: string;
  templateVersion: string;
  next: string;
  checks?: Check[];
}

export class UsageError extends Error {}

export const OWNER_PLACEHOLDER = "OWNER";

export function parseTargets(value: string | undefined): Target[] {
  // Omitted flag → defaults. Explicit empty / comma-only → error (not a silent all-targets).
  if (value === undefined) return [...TARGETS];
  const picked = value.split(",").map((t) => t.trim()).filter(Boolean);
  if (!picked.length) {
    throw new UsageError(`--targets must list at least one of: ${TARGETS.join(", ")}`);
  }
  for (const t of picked) {
    const nonGoal = findNonGoal(t);
    if (nonGoal) {
      throw new UsageError(`${nonGoal.errorCode}: unknown target "${t}" — ${nonGoal.reason}`);
    }
  }
  const unknown = picked.filter((t) => !(TARGETS as readonly string[]).includes(t));
  if (unknown.length) throw new UsageError(`unknown target(s): ${unknown.join(", ")}. Valid: ${TARGETS.join(", ")}`);
  if (picked.includes("homebrew") && !picked.includes("npm")) {
    throw new UsageError("the homebrew target installs from the npm tarball; add npm to --targets");
  }
  return picked as Target[];
}

async function ask(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} (${fallback}): `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

/** Fills missing package.json fields without overwriting anything the author set. */
function patchManifest(project: Project, owner: string, repo: string): { pkg: PackageJson; patched: string[] } {
  const pkg: PackageJson = structuredClone(project.pkg);
  const patched: string[] = [];
  const fill = (key: string, value: unknown) => {
    if (pkg[key] === undefined) {
      pkg[key] = value;
      patched.push(key);
    }
  };
  fill("repository", { type: "git", url: `git+https://github.com/${owner}/${repo}.git` });
  fill("homepage", `https://github.com/${owner}/${repo}#readme`);
  fill("bugs", `https://github.com/${owner}/${repo}/issues`);
  fill("files", ["bin", "dist", "README.md", "LICENSE"]);
  fill("engines", { node: ">=20" });
  fill("publishConfig", { access: "public", provenance: true });
  pkg.scripts ??= {};
  if (!pkg.scripts.verify) {
    pkg.scripts.verify = "node scripts/verify-release.mjs";
    patched.push("scripts.verify");
  }
  return { pkg, patched };
}

export async function init(options: InitOptions): Promise<InitResult> {
  const project = detectProject(options.cwd);
  if (!project) throw new UsageError(`no package.json with a "name" in ${options.cwd}. Run \`npm init -y\` first.`);

  let targets = parseTargets(options.targets);
  // Distinguish omitted --owner (undefined) from an explicit empty/whitespace value.
  let owner: string | undefined;
  if (options.owner !== undefined) {
    owner = options.owner.trim();
    assertOwner(owner);
  } else {
    owner = project.owner;
  }
  const repo = project.repo ?? unscopedName(project.name);

  if (options.interactive) {
    owner = await ask("GitHub owner", owner ?? "your-github-user");
    targets = parseTargets(await ask("Targets", targets.join(",")));
  }
  const warnings: string[] = [];
  if (!owner) {
    owner = OWNER_PLACEHOLDER;
    warnings.push(`no GitHub remote found; wrote "${OWNER_PLACEHOLDER}" as a placeholder. Re-run with --owner <user-or-org> --force.`);
  } else {
    assertOwner(owner);
  }

  let binName: string;
  try {
    binName = validateSafeName("bin name", project.binName ?? unscopedName(project.name));
    validatePackageName(project.name);
    validateVersion(project.version);
    validateSafeName("repo", repo);
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const vars = {
    PKG: project.name,
    BIN: binName,
    OWNER: owner,
    REPO: repo,
    VERSION: project.version,
    UNSCOPED: unscopedName(project.name),
    FORMULA_CLASS: formulaClassName(binName),
    DESCRIPTION: rubyStringBody(String(project.pkg.description ?? `${binName} command-line tool`)),
    LICENSE: rubyStringBody(String(project.pkg.license ?? "MIT")),
  };

  const files: Array<{ to: string; from: string; mode?: number }> = [
    { to: ".github/workflows/ci.yml", from: "workflows/ci.yml" },
    { to: ".github/workflows/release.yml", from: "workflows/release.yml" },
    { to: "scripts/verify-release.mjs", from: "scripts/verify-release.mjs", mode: 0o755 },
    { to: "scripts/verify-release.sh", from: "scripts/verify-release.sh", mode: 0o755 },
  ];
  if (targets.includes("homebrew")) files.push({ to: `scripts/homebrew/${binName}.rb`, from: "homebrew/formula.rb" });

  const existingState = readState(options.cwd);
  const managedFiles: Record<string, ManagedFileRecord> = { ...(existingState?.managedFiles ?? {}) };

  const result: InitResult = {
    created: [],
    skipped: [],
    patched: [],
    warnings,
    diffs: {},
    contractVersion: CONTRACT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    next: "",
  };

  for (const file of files) {
    const dest = safeResolve(options.cwd, file.to);
    const rendered = render(readTemplate(file.from), vars, targets);
    const exists = existsSync(dest);
    if (exists && !options.force) {
      result.skipped.push(file.to);
      continue;
    }
    const before = exists ? readFileSync(dest, "utf8") : undefined;
    const diffText = unifiedDiff(file.to, before, rendered);
    if (diffText) result.diffs[file.to] = diffText;

    result.created.push(file.to);
    if (options.dryRun) continue;
    writeAtomic(dest, rendered, file.mode);
    managedFiles[file.to] = { sha256: sha256(rendered), template: file.from };
  }

  const { pkg, patched } = patchManifest(project, owner, repo);
  result.patched = patched;
  if (patched.length && !options.dryRun) {
    writeAtomic(safeResolve(options.cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  }

  if (!options.dryRun && (result.created.length > 0 || !existingState)) {
    writeState(options.cwd, {
      schemaVersion: 1,
      contractVersion: CONTRACT_VERSION,
      templateVersion: TEMPLATE_VERSION,
      targets,
      owner,
      repo,
      managedFiles,
    });
  }

  result.next = options.dryRun ? dryRunFollowUp(owner, targets, options.force) : "npx packnpub check";
  return result;
}

/** Rebuilds the real init command so a dry-run follow-up matches the previewed configuration. */
export function dryRunFollowUp(owner: string, targets: Target[], force?: boolean): string {
  const parts = ["npx packnpub init --yes"];
  if (owner !== OWNER_PLACEHOLDER) parts.push(`--owner ${shellSingleQuote(owner)}`);
  const isDefault = targets.length === TARGETS.length && TARGETS.every((t) => targets.includes(t));
  if (!isDefault) parts.push(`--targets ${shellSingleQuote(targets.join(","))}`);
  if (force) parts.push("--force");
  return parts.join(" ");
}

export function formatInitResult(result: InitResult, dryRun: boolean, formatDoctor?: (checks: Check[]) => string): string {
  const lines = [dryRun ? "Dry run: nothing written." : `packnpub init (contract v${result.contractVersion})`];
  for (const file of result.created) lines.push(`  ${dryRun ? "would create" : "created"}  ${file}`);
  for (const file of result.skipped) lines.push(`  skipped  ${file} (exists; --force to overwrite)`);
  if (result.patched.length) lines.push(`  ${dryRun ? "would patch" : "patched"}  package.json: ${result.patched.join(", ")}`);
  for (const warning of result.warnings) lines.push(`  warning  ${warning}`);
  if (dryRun && Object.keys(result.diffs).length > 0) {
    lines.push("", "Preview diffs:");
    for (const diffText of Object.values(result.diffs)) {
      lines.push(diffText);
    }
  }
  if (result.checks?.length && formatDoctor) {
    lines.push("", "Doctor", formatDoctor(result.checks));
  }
  lines.push("", `Next: ${result.next}`);
  return lines.join("\n");
}
