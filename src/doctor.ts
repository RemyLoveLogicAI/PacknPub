import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { detectProject } from "./detect.js";
import { OWNER_PLACEHOLDER } from "./init.js";

export type Status = "pass" | "warn" | "fail";

export interface Check {
  name: string;
  status: Status;
  detail: string;
}

function onPath(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function doctor(cwd: string): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, severity: Status = "fail") =>
    checks.push({ name, status: ok ? "pass" : severity, detail });

  const major = Number(process.versions.node.split(".")[0]);
  add("node >= 20", major >= 20, `node ${process.versions.node}`);

  const project = detectProject(cwd);
  add("package.json", Boolean(project), project ? `${project.name}@${project.version}` : "missing or has no name");
  if (!project) return checks;

  const { pkg } = project;
  add("files whitelist", Array.isArray(pkg.files) && pkg.files.length > 0, "package.json \"files\" limits what gets published");
  add("repository", Boolean(pkg.repository), "needed for npm provenance and trusted publishing");
  add("GitHub remote", Boolean(project.owner), project.owner ? `${project.owner}/${project.repo}` : "no github.com origin remote", "warn");

  if (project.binPath) {
    const entry = path.join(cwd, project.binPath);
    const shebang = existsSync(entry) && readFileSync(entry, "utf8").startsWith("#!/usr/bin/env node");
    add("bin shebang", shebang, `${project.binPath} starts with #!/usr/bin/env node`);
  }

  for (const file of [".github/workflows/ci.yml", ".github/workflows/release.yml", "scripts/verify-release.sh"]) {
    add(file, existsSync(path.join(cwd, file)), existsSync(path.join(cwd, file)) ? "present" : "run `npx packnpub init`");
  }
  const release = path.join(cwd, ".github/workflows/release.yml");
  if (existsSync(release)) {
    const placeholder = readFileSync(release, "utf8").includes(`${OWNER_PLACEHOLDER}/`);
    add("release owner", !placeholder, placeholder ? "replace OWNER: `npx packnpub init --owner <name> --force`" : "set");
  }
  add("lockfile", existsSync(path.join(cwd, "package-lock.json")), "CI uses `npm ci`, which needs package-lock.json", "warn");

  add("gh CLI", onPath("gh"), "used for GitHub Releases and the Homebrew tap", "warn");

  const readmePath = path.join(cwd, "README.md");
  if (!existsSync(readmePath)) {
    add("README quickstart", false, "add README.md that opens with the install command", "warn");
  } else {
    const head = readFileSync(readmePath, "utf8").slice(0, 1200);
    const hasQuickstart = /(?:^|\n)(?:```[^\n]*\n)?(?:npx |npm (?:i|install) |pnpm |yarn |bunx |brew install )/m.test(head);
    add(
      "README quickstart",
      hasQuickstart,
      hasQuickstart ? "opens with an install / init command" : "README.md should open with the install command (npx / npm / brew)",
      "warn",
    );
  }
  return checks;
}

export function formatChecks(checks: Check[]): string {
  const icon: Record<Status, string> = { pass: "ok  ", warn: "warn", fail: "FAIL" };
  return checks.map((c) => `  ${icon[c.status]}  ${c.name}: ${c.detail}`).join("\n");
}

export function nextAfterDoctor(checks: Check[]): string {
  if (checks.some((c) => c.status === "fail")) {
    return "fix the FAIL items above, then npx packnpub doctor";
  }
  // verify requires a clean tree; init just dirtied it — commit first, or use --skip-git once.
  return "build if needed, commit the scaffold, then npx packnpub verify --skip-tag (or add --skip-git for an initial check)";
}
