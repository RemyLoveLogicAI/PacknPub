import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConformanceCheck } from "../src/check.js";
import { loadContract, validateContract } from "../src/contract.js";
import { doctor } from "../src/doctor.js";
import { init, UsageError } from "../src/init.js";
import { readState, safeResolve, writeState } from "../src/state.js";
import { planProjectFiles, rollbackProject, upgradeProject } from "../src/upgrade.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let dir: string;

function makeFixture(pkg: Record<string, unknown>, remote = "https://github.com/acme/widget") {
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  writeFileSync(path.join(dir, "bin/cli.js"), "#!/usr/bin/env node\nconsole.log('ok');\n");
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "packnpub-conf-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Area 1 & 2: Normative contract and authoritative manifest", () => {
  it("loads and validates contracts/v1/packnpub.contract.json", () => {
    const contract = loadContract();
    expect(contract.contractVersion).toBe("1.0.0");
    expect(contract.nonGoals.some((g) => g.id === "pypi" && g.errorCode === "UNSUPPORTED_ECOSYSTEM")).toBe(true);
    expect(validateContract({ contractVersion: "bad" }).length).toBeGreaterThan(0);
  });

  it("reports HOLD offline by default and PASS with --local-only, never authorizing publish", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false });

    const full = runConformanceCheck(dir);
    expect(full.verdict).toBe("HOLD");
    expect(full.publishAuthorized).toBe(false);
    expect(full.checks.find((c) => c.id === "external.github_environment_reviewers")?.status).toBe("UNKNOWN");

    const local = runConformanceCheck(dir, { localOnly: true });
    expect(local.verdict).toBe("PASS");
    expect(local.publishAuthorized).toBe(false);
  });

  it("detects Homebrew formula version drift against authoritative package.json", async () => {
    makeFixture({ name: "widget", version: "2.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false });

    const formulaPath = path.join(dir, "scripts/homebrew/widget.rb");
    writeFileSync(formulaPath, readFileSync(formulaPath, "utf8").replace("widget-2.0.0.tgz", "widget-0.1.0.tgz"));

    const report = runConformanceCheck(dir, { localOnly: true });
    expect(report.verdict).toBe("FAIL");
    expect(report.checks.find((c) => c.id === "manifest.version_consistency")?.status).toBe("FAIL");
    expect(doctor(dir).find((c) => c.name === "version consistency")?.status).toBe("fail");
  });
});

describe("Area 3: Representative fixture matrix (clean, customized, conflicting, invalid)", () => {
  it("preserves custom user files and existing package.json decisions", async () => {
    makeFixture({
      name: "widget",
      version: "1.0.0",
      bin: { widget: "./bin/cli.js" },
      files: ["dist", "custom-assets"],
      scripts: { verify: "npm run custom-verify" },
    });
    mkdirSync(path.join(dir, ".github/workflows"), { recursive: true });
    writeFileSync(path.join(dir, ".github/workflows/custom.yml"), "name: Custom\n");

    await init({ cwd: dir, interactive: false });

    expect(readFileSync(path.join(dir, ".github/workflows/custom.yml"), "utf8")).toBe("name: Custom\n");
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    expect(pkg.files).toEqual(["dist", "custom-assets"]);
    expect(pkg.scripts.verify).toBe("npm run custom-verify");
  });

  it("blocks path traversal in bin names and safeResolve", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { "../escape": "./bin/cli.js" } });
    await expect(init({ cwd: dir, interactive: false })).rejects.toBeInstanceOf(UsageError);
    expect(() => safeResolve(dir, "../outside.txt")).toThrow(/path traversal blocked/);
    expect(() => safeResolve(dir, "/etc/passwd")).toThrow(/unsafe path/);
  });
});

describe("Area 4 & 5: Policy mutation tests (SHA pins, permissions, approval gates, checksums)", () => {
  it("catches unpinned mutable action tag mutations", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false });

    const ciPath = path.join(dir, ".github/workflows/ci.yml");
    writeFileSync(ciPath, readFileSync(ciPath, "utf8").replace(/actions\/checkout@[0-9a-f]{40}.*/, "actions/checkout@v4"));

    const report = runConformanceCheck(dir, { localOnly: true });
    expect(report.verdict).toBe("FAIL");
    expect(report.checks.find((c) => c.id === "workflow.actions_sha_pinned")?.status).toBe("FAIL");
  });

  it("catches removal of human approval environment from any publish job", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false, targets: "github-release" });

    // Baseline subset passes local-only because github-release has environment: release.
    expect(runConformanceCheck(dir, { localOnly: true }).verdict).toBe("PASS");

    // Mutate: strip environment: release from github-release job.
    const relPath = path.join(dir, ".github/workflows/release.yml");
    writeFileSync(relPath, readFileSync(relPath, "utf8").replace("    environment: release\n", ""));

    const mutated = runConformanceCheck(dir, { localOnly: true });
    expect(mutated.verdict).toBe("FAIL");
    expect(mutated.checks.find((c) => c.id === "workflow.human_approval_environment")?.status).toBe("FAIL");
  });

  it("catches removal of checksum verification or direct run-block expression injection", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false });

    const relPath = path.join(dir, ".github/workflows/release.yml");
    writeFileSync(relPath, readFileSync(relPath, "utf8").replaceAll("sha256sum -c SHA256SUMS.txt", "true"));

    const mutated = runConformanceCheck(dir, { localOnly: true });
    expect(mutated.verdict).toBe("FAIL");
    expect(mutated.checks.find((c) => c.id === "workflow.artifact_checksum_verified")?.status).toBe("FAIL");
  });

  it("catches over-permissive top-level workflow permissions", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false });

    const relPath = path.join(dir, ".github/workflows/release.yml");
    writeFileSync(relPath, readFileSync(relPath, "utf8").replace("permissions: {}", "permissions: write-all"));

    const mutated = runConformanceCheck(dir, { localOnly: true });
    expect(mutated.verdict).toBe("FAIL");
    expect(mutated.checks.find((c) => c.id === "workflow.least_privilege_permissions")?.status).toBe("FAIL");
  });
});

describe("Area 7: Versioning, migration, conflict stop, and atomic rollback", () => {
  it("halts on legacy unversioned conflicts, upgrades with --force + backup, and rolls back cleanly", () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    mkdirSync(path.join(dir, ".github/workflows"), { recursive: true });
    const legacyCi = "name: Legacy CI\n# custom user step\n";
    writeFileSync(path.join(dir, ".github/workflows/ci.yml"), legacyCi);

    const dry = upgradeProject(dir, { dryRun: true });
    expect(dry.applied).toBe(false);
    expect(dry.conflicts).toContain(".github/workflows/ci.yml");
    expect(dry.diffs[".github/workflows/ci.yml"]).toContain("-name: Legacy CI");
    expect(readFileSync(path.join(dir, ".github/workflows/ci.yml"), "utf8")).toBe(legacyCi);

    const applied = upgradeProject(dir, { force: true });
    expect(applied.applied).toBe(true);
    expect(applied.backupDir).toBeDefined();
    expect(readState(dir)?.contractVersion).toBe("1.0.0");
    expect(readFileSync(path.join(dir, ".github/workflows/ci.yml"), "utf8")).not.toBe(legacyCi);

    const rolled = rollbackProject(dir);
    expect(rolled.restored).toContain(".github/workflows/ci.yml");
    expect(readFileSync(path.join(dir, ".github/workflows/ci.yml"), "utf8")).toBe(legacyCi);
    expect(existsSync(path.join(dir, ".packnpub/state.json"))).toBe(false);
  });

  it("auto-upgrades unmodified managed files and halts on user-modified managed files", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false });

    // Simulate older versioned template where user did NOT edit ci.yml:
    const ciPath = path.join(dir, ".github/workflows/ci.yml");
    const oldContent = "# old v0.9 template\n";
    writeFileSync(ciPath, oldContent);
    const st = readState(dir)!;
    st.contractVersion = "0.9.0";
    const { sha256 } = await import("../src/state.js");
    st.managedFiles[".github/workflows/ci.yml"].sha256 = sha256(oldContent);
    writeState(dir, st);

    const plan = planProjectFiles(dir);
    expect(plan.files.find((f) => f.path === ".github/workflows/ci.yml")?.status).toBe("auto-upgrade");
    const upgraded = upgradeProject(dir);
    expect(upgraded.applied).toBe(true);
    expect(upgraded.updated).toContain(".github/workflows/ci.yml");

    // Now simulate a user edit: upgrade must halt on conflict and preserve the edit.
    writeFileSync(ciPath, "# user customized workflow\n");
    const blocked = upgradeProject(dir);
    expect(blocked.applied).toBe(false);
    expect(blocked.conflicts).toContain(".github/workflows/ci.yml");
    expect(readFileSync(ciPath, "utf8")).toBe("# user customized workflow\n");
  });
});

describe("Self-hosting conformance proof (PacknPub repository)", () => {
  it("passes local-only conformance and holds full conformance pending external reviewer verification", () => {
    const local = runConformanceCheck(REPO_ROOT, { localOnly: true });
    expect(local.verdict).toBe("PASS");
    expect(local.publishAuthorized).toBe(false);

    const full = runConformanceCheck(REPO_ROOT);
    expect(full.verdict).toBe("HOLD");
    expect(full.publishAuthorized).toBe(false);
  });
});
