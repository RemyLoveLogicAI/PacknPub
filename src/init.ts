import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { detectProject, unscopedName, type PackageJson, type Project } from "./detect.js";
import type { Check } from "./doctor.js";
import { TARGETS, formulaClassName, readTemplate, render, type Target } from "./templates.js";

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
  next: string;
  checks?: Check[];
}

export class UsageError extends Error {}

export const OWNER_PLACEHOLDER = "OWNER";

function parseTargets(value: string | undefined): Target[] {
  if (!value) return [...TARGETS];
  const picked = value.split(",").map((t) => t.trim()).filter(Boolean);
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
    pkg.scripts.verify = "bash scripts/verify-release.sh";
    patched.push("scripts.verify");
  }
  return { pkg, patched };
}

export async function init(options: InitOptions): Promise<InitResult> {
  const project = detectProject(options.cwd);
  if (!project) throw new UsageError(`no package.json with a "name" in ${options.cwd}. Run \`npm init -y\` first.`);

  let targets = parseTargets(options.targets);
  let owner = options.owner ?? project.owner;
  const repo = project.repo ?? unscopedName(project.name);

  if (options.interactive) {
    owner = await ask("GitHub owner", owner ?? "your-github-user");
    targets = parseTargets(await ask("Targets", targets.join(",")));
  }
  const warnings: string[] = [];
  if (!owner) {
    owner = OWNER_PLACEHOLDER;
    warnings.push(`no GitHub remote found; wrote "${OWNER_PLACEHOLDER}" as a placeholder. Re-run with --owner <user-or-org> --force.`);
  }

  const binName = project.binName ?? unscopedName(project.name);
  const vars = {
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

  const files: Array<{ to: string; from: string; mode?: number }> = [
    { to: ".github/workflows/ci.yml", from: "workflows/ci.yml" },
    { to: ".github/workflows/release.yml", from: "workflows/release.yml" },
    { to: "scripts/verify-release.sh", from: "scripts/verify-release.sh", mode: 0o755 },
  ];
  if (targets.includes("homebrew")) files.push({ to: `scripts/homebrew/${binName}.rb`, from: "homebrew/formula.rb" });

  const result: InitResult = { created: [], skipped: [], patched: [], warnings, next: "" };
  for (const file of files) {
    const dest = path.join(options.cwd, file.to);
    if (existsSync(dest) && !options.force) {
      result.skipped.push(file.to);
      continue;
    }
    result.created.push(file.to);
    if (options.dryRun) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, render(readTemplate(file.from), vars, targets));
    if (file.mode) chmodSync(dest, file.mode);
  }

  const { pkg, patched } = patchManifest(project, owner, repo);
  result.patched = patched;
  if (patched.length && !options.dryRun) {
    writeFileSync(path.join(options.cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  }

  result.next = options.dryRun ? "npx packnpub init --yes" : "npx packnpub doctor";
  return result;
}

export function formatInitResult(result: InitResult, dryRun: boolean, formatDoctor?: (checks: Check[]) => string): string {
  const lines = [dryRun ? "Dry run: nothing written." : "packnpub init"];
  for (const file of result.created) lines.push(`  ${dryRun ? "would create" : "created"}  ${file}`);
  for (const file of result.skipped) lines.push(`  skipped  ${file} (exists; --force to overwrite)`);
  if (result.patched.length) lines.push(`  ${dryRun ? "would patch" : "patched"}  package.json: ${result.patched.join(", ")}`);
  for (const warning of result.warnings) lines.push(`  warning  ${warning}`);
  if (result.checks?.length && formatDoctor) {
    lines.push("", "Doctor", formatDoctor(result.checks));
  }
  lines.push("", `Next: ${result.next}`);
  return lines.join("\n");
}
