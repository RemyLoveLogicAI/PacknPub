import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONTRACT_VERSION, TEMPLATE_VERSION } from "./contract.js";
import { detectProject, unscopedName } from "./detect.js";
import { unifiedDiff } from "./diff.js";
import { OWNER_PLACEHOLDER, parseTargets, UsageError } from "./init.js";
import {
  createBackup,
  readState,
  restoreLatestBackup,
  safeResolve,
  sha256,
  STATE_REL_PATH,
  validateSafeName,
  writeState,
  type ManagedFileRecord,
} from "./state.js";
import { formulaClassName, readTemplate, render, type Target } from "./templates.js";

export type FileDiffStatus = "unchanged" | "create" | "auto-upgrade" | "conflict";

export interface PlannedFile {
  path: string;
  template: string;
  mode?: number;
  status: FileDiffStatus;
  diff: string;
  content: string;
}

export interface UpgradePlan {
  contractVersion: string;
  templateVersion: string;
  fromContractVersion: string;
  targets: Target[];
  owner: string;
  repo: string;
  files: PlannedFile[];
  conflicts: string[];
}

export interface UpgradeResult {
  applied: boolean;
  dryRun: boolean;
  backupDir?: string;
  updated: string[];
  created: string[];
  unchanged: string[];
  conflicts: string[];
  diffs: Record<string, string>;
}

export function planProjectFiles(
  cwd: string,
  options: { targets?: string; owner?: string } = {}
): UpgradePlan {
  const project = detectProject(cwd);
  if (!project) {
    throw new UsageError(`no package.json with a "name" in ${cwd}. Run \`npm init -y\` first.`);
  }
  const existingState = readState(cwd);
  const targets = options.targets
    ? parseTargets(options.targets)
    : existingState
      ? parseTargets(existingState.targets.join(","))
      : parseTargets(undefined);

  const owner = options.owner ?? existingState?.owner ?? project.owner ?? OWNER_PLACEHOLDER;
  const repo = existingState?.repo ?? project.repo ?? unscopedName(project.name);
  const binName = validateSafeName("bin name", project.binName ?? unscopedName(project.name));

  const vars: Record<string, string> = {
    PKG: project.name,
    BIN: binName,
    OWNER: owner,
    REPO: repo,
    VERSION: project.version,
    UNSCOPED: unscopedName(project.name),
    FORMULA_CLASS: formulaClassName(binName),
    DESCRIPTION: String(project.pkg.description ?? `${binName} command-line tool`),
    LICENSE: String(project.pkg.license ?? "MIT"),
  };

  const specs: Array<{ to: string; from: string; mode?: number }> = [
    { to: ".github/workflows/ci.yml", from: "workflows/ci.yml" },
    { to: ".github/workflows/release.yml", from: "workflows/release.yml" },
    { to: "scripts/verify-release.mjs", from: "scripts/verify-release.mjs", mode: 0o755 },
    { to: "scripts/verify-release.sh", from: "scripts/verify-release.sh", mode: 0o755 },
  ];
  if (targets.includes("homebrew")) {
    specs.push({ to: `scripts/homebrew/${binName}.rb`, from: "homebrew/formula.rb" });
  }

  const files: PlannedFile[] = [];
  const conflicts: string[] = [];

  for (const spec of specs) {
    const dest = safeResolve(cwd, spec.to);
    const rendered = render(readTemplate(spec.from), vars, targets);
    const existed = existsSync(dest);
    const current = existed ? readFileSync(dest, "utf8").replace(/\r\n/g, "\n") : undefined;

    let status: FileDiffStatus;
    if (!existed) {
      status = "create";
    } else if (current === rendered) {
      status = "unchanged";
    } else {
      const tracked = existingState?.managedFiles[spec.to];
      if (tracked && sha256(current!) === tracked.sha256) {
        status = "auto-upgrade";
      } else {
        status = "conflict";
        conflicts.push(spec.to);
      }
    }

    files.push({
      path: spec.to,
      template: spec.from,
      mode: spec.mode,
      status,
      diff: status === "unchanged" ? "" : unifiedDiff(spec.to, current, rendered),
      content: rendered,
    });
  }

  return {
    contractVersion: CONTRACT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    fromContractVersion: existingState?.contractVersion ?? "unversioned",
    targets,
    owner,
    repo,
    files,
    conflicts,
  };
}

export function upgradeProject(
  cwd: string,
  options: { dryRun?: boolean; force?: boolean; targets?: string; owner?: string } = {}
): UpgradeResult {
  const plan = planProjectFiles(cwd, { targets: options.targets, owner: options.owner });
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);

  const diffs: Record<string, string> = {};
  for (const f of plan.files) {
    if (f.diff) diffs[f.path] = f.diff;
  }

  if (plan.conflicts.length > 0 && !force) {
    return {
      applied: false,
      dryRun,
      updated: [],
      created: [],
      unchanged: plan.files.filter((f) => f.status === "unchanged").map((f) => f.path),
      conflicts: plan.conflicts,
      diffs,
    };
  }

  const created = plan.files.filter((f) => f.status === "create").map((f) => f.path);
  const updated = plan.files
    .filter((f) => f.status === "auto-upgrade" || (f.status === "conflict" && force))
    .map((f) => f.path);
  const unchanged = plan.files.filter((f) => f.status === "unchanged").map((f) => f.path);

  if (dryRun) {
    return { applied: false, dryRun: true, updated, created, unchanged, conflicts: [], diffs };
  }

  const backupDir = createBackup(cwd, [...plan.files.map((f) => f.path), STATE_REL_PATH]);
  const managedFiles: Record<string, ManagedFileRecord> = {};

  for (const f of plan.files) {
    const dest = safeResolve(cwd, f.path);
    if (f.status !== "unchanged") {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, f.content);
      if (f.mode && process.platform !== "win32") chmodSync(dest, f.mode);
    }
    managedFiles[f.path] = { sha256: sha256(f.content), template: f.template };
  }

  writeState(cwd, {
    schemaVersion: 1,
    contractVersion: plan.contractVersion,
    templateVersion: plan.templateVersion,
    targets: plan.targets,
    owner: plan.owner,
    repo: plan.repo,
    managedFiles,
  });

  return { applied: true, dryRun: false, backupDir, updated, created, unchanged, conflicts: [], diffs };
}

export function rollbackProject(cwd: string) {
  return restoreLatestBackup(cwd);
}
