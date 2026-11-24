import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { runConformanceCheck } from "./check.js";
import { detectProject } from "./detect.js";
import { OWNER_PLACEHOLDER } from "./init.js";

export type Status = "pass" | "warn" | "fail";

export interface Check {
  name: string;
  status: Status;
  detail: string;
}

/** Strip C0 + C1 controls (including CR/LF/tab) so formatChecks cannot be line-spoofed. */
export function sanitizeText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

function isRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function onPath(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

/** Install/init command near the top of README — not deep content or `yarn test`-style noise. */
export function hasReadmeQuickstart(content: string): boolean {
  const head = content.slice(0, 500);
  // Real install/init only — not `yarn test`, `pnpm run build`, `bun run`, etc.
  const install =
    "(?:npx +\\S+|npm +(?:i|install)\\b|pnpm +(?:i|install|add)\\b|yarn +add\\b|bunx +\\S+|bun +(?:i|install|add)\\b|brew +install\\b)";
  // Line start: indent, optional fence, optional shell prompt ($ # > %), optional wrapping backtick
  const onLine = `(?:^|\\n)[ \\t]*(?:\`\`\`[^\\n]*\\n[ \\t]*)?(?:[$%>#][ \\t]*)?\`?${install}`;
  // Inline code form anywhere in the opening window: `npx …` / `bun add …`
  const inline = `\`${install}`;
  return new RegExp(`(?:${onLine}|${inline})`, "m").test(head);
}

export function doctor(cwd: string): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, severity: Status = "fail") =>
    checks.push({ name, status: ok ? "pass" : severity, detail: sanitizeText(detail) });

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
    try {
      const shebang = existsSync(entry) && readFileSync(entry, "utf8").startsWith("#!/usr/bin/env node");
      add("bin shebang", shebang, `${project.binPath} starts with #!/usr/bin/env node`);
    } catch {
      add("bin shebang", false, `${project.binPath} exists but could not be read`);
    }
  }

  for (const file of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
    add(file, existsSync(path.join(cwd, file)), existsSync(path.join(cwd, file)) ? "present" : "run `npx packnpub init`");
  }
  const hasVerify =
    existsSync(path.join(cwd, "scripts/verify-release.mjs")) || existsSync(path.join(cwd, "scripts/verify-release.sh"));
  add("verify script", hasVerify, hasVerify ? "present" : "run `npx packnpub init`");

  const release = path.join(cwd, ".github/workflows/release.yml");
  if (existsSync(release)) {
    try {
      const placeholder = readFileSync(release, "utf8").includes(`${OWNER_PLACEHOLDER}/`);
      add("release owner", !placeholder, placeholder ? "replace OWNER: `npx packnpub init --owner <name> --force`" : "set");
    } catch {
      add("release owner", false, "release.yml exists but could not be read");
    }
  }
  const hasLock = isRegularFile(path.join(cwd, "package-lock.json"));
  add(
    "lockfile",
    hasLock,
    hasLock ? "present" : "run `npm install` to create package-lock.json (CI uses npm ci)",
  );

  const report = runConformanceCheck(cwd, { localOnly: true });
  const versionCheck = report.checks.find((c) => c.id === "manifest.version_consistency");
  if (versionCheck) {
    add("version consistency", versionCheck.status === "PASS", versionCheck.evidence);
  }
  const shaCheck = report.checks.find((c) => c.id === "workflow.actions_sha_pinned");
  if (shaCheck && shaCheck.status !== "UNKNOWN") {
    add("workflow SHA pinning", shaCheck.status === "PASS", shaCheck.evidence);
  }
  const envCheck = report.checks.find((c) => c.id === "workflow.human_approval_environment");
  if (envCheck && envCheck.status !== "UNKNOWN") {
    add("release approval gate", envCheck.status === "PASS", envCheck.evidence);
  }

  add("gh CLI", onPath("gh"), "used for GitHub Releases and the Homebrew tap", "warn");
  add("bash", onPath("bash"), "legacy verify-release.sh needs bash; verify-release.mjs runs natively on Node", "warn");

  const readmePath = path.join(cwd, "README.md");
  if (!existsSync(readmePath)) {
    add("README quickstart", false, "add README.md that opens with the install command", "warn");
  } else {
    try {
      const content = readFileSync(readmePath, "utf8");
      const ok = hasReadmeQuickstart(content);
      add(
        "README quickstart",
        ok,
        ok ? "opens with an install / init command" : "README.md should open with an install/init command (npx / npm i / brew install)",
        "warn",
      );
    } catch {
      add("README quickstart", false, "README.md exists but could not be read", "warn");
    }
  }
  return checks;
}

export function formatChecks(checks: Check[]): string {
  const icon: Record<Status, string> = { pass: "ok  ", warn: "warn", fail: "FAIL" };
  return checks
    .map((c) => `  ${icon[c.status]}  ${sanitizeText(c.name)}: ${sanitizeText(c.detail)}`)
    .join("\n");
}

export function nextAfterDoctor(checks: Check[]): string {
  if (checks.some((c) => c.status === "fail")) {
    const lock = checks.find((c) => c.name === "lockfile" && c.status === "fail");
    if (lock) return "run `npm install` to create package-lock.json, then npx packnpub doctor";
    return "fix the FAIL items above, then npx packnpub doctor";
  }
  // verify requires a clean tree; init just dirtied it — build dist when listed, commit, or --skip-git once.
  return "npm run build if files includes dist, commit the scaffold, then npx packnpub verify --skip-tag (or add --skip-git for an initial check)";
}
