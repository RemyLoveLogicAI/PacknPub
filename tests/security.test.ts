import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConformanceCheck } from "../src/check.js";
import { init, UsageError } from "../src/init.js";
import { rubyStringBody, safeResolve, validateSafeName } from "../src/state.js";

let dir: string;
let outside: string;

function makeFixture(pkg: Record<string, unknown>, remote = "https://github.com/acme/widget") {
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  writeFileSync(path.join(dir, "bin/cli.js"), "#!/usr/bin/env node\nconsole.log('ok');\n");
}

const relPath = () => path.join(dir, ".github/workflows/release.yml");
const check = (id: string) => runConformanceCheck(dir, { localOnly: true }).checks.find((c) => c.id === id)?.status;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "packnpub-sec-"));
  outside = mkdtempSync(path.join(tmpdir(), "packnpub-outside-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("path confinement", () => {
  it("blocks writes through a symlinked directory that points outside the project", () => {
    if (process.platform === "win32") return;
    symlinkSync(outside, path.join(dir, ".github"));
    expect(() => safeResolve(dir, ".github/workflows/ci.yml")).toThrow(/symlink escape blocked/);
  });

  it("blocks a symlinked file that points outside the project, including dangling links", () => {
    if (process.platform === "win32") return;
    writeFileSync(path.join(outside, "target.txt"), "x");
    symlinkSync(path.join(outside, "target.txt"), path.join(dir, "linked.txt"));
    symlinkSync(path.join(outside, "missing.txt"), path.join(dir, "dangling.txt"));
    expect(() => safeResolve(dir, "linked.txt")).toThrow(/symlink escape blocked/);
    expect(() => safeResolve(dir, "dangling.txt")).toThrow(/symlink escape blocked/);
  });

  it("still allows symlinks that stay inside the project", () => {
    if (process.platform === "win32") return;
    mkdirSync(path.join(dir, "real"));
    symlinkSync(path.join(dir, "real"), path.join(dir, "alias"));
    expect(safeResolve(dir, "alias/file.txt")).toBe(path.join(path.resolve(dir), "alias/file.txt"));
  });
});

describe("template injection", () => {
  it("rejects bin names with quotes, newlines or shell metacharacters", async () => {
    for (const bad of ['wid"get', "wid\nget", "wid get", "wid;get", "wid&get", "$(id)"]) {
      expect(() => validateSafeName("bin name", bad)).toThrow(/unsafe bin name/);
    }
    expect(validateSafeName("bin name", "my-cli_2.0")).toBe("my-cli_2.0");

    makeFixture({ name: "widget", version: "1.0.0", bin: { 'widget"\n    run: id': "./bin/cli.js" } });
    await expect(init({ cwd: dir, interactive: false })).rejects.toBeInstanceOf(UsageError);
  });

  it("escapes Ruby interpolation in the generated Homebrew formula", async () => {
    expect(rubyStringBody('#{system("id")} \\ "q"')).toBe('\\#{system(\\"id\\")} \\\\ \\"q\\"');
    makeFixture({
      name: "widget",
      version: "1.0.0",
      description: '#{system("id")} "quoted"',
      bin: { widget: "./bin/cli.js" },
    });
    await init({ cwd: dir, interactive: false, targets: "npm,homebrew" });
    const formula = readFileSync(path.join(dir, "scripts/homebrew/widget.rb"), "utf8");
    expect(formula).toContain('desc "\\#{system(\\"id\\")} \\"quoted\\""');
    expect(formula).not.toContain('desc "#{');
  });
});

describe("workflow policy checks", () => {
  it("does not let a comment with a pinned ref mask a mutable action tag", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false });
    expect(check("workflow.actions_sha_pinned")).toBe("PASS");

    const ciPath = path.join(dir, ".github/workflows/ci.yml");
    const ci = readFileSync(ciPath, "utf8").replace(
      /actions\/checkout@[0-9a-f]{40}.*/,
      "actions/checkout@v4 # uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
    );
    writeFileSync(ciPath, ci);
    expect(check("workflow.actions_sha_pinned")).toBe("FAIL");
  });

  it("finds publish jobs by behaviour, not only by known job IDs", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false, targets: "github-release" });
    expect(check("workflow.human_approval_environment")).toBe("PASS");

    const extra = [
      "",
      "  sneaky-publish:",
      "    needs: verify",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: npm publish ./pkg.tgz",
      "",
    ].join("\n");
    writeFileSync(relPath(), readFileSync(relPath(), "utf8") + extra);
    expect(check("workflow.human_approval_environment")).toBe("FAIL");
  });

  it("requires the exact release environment name", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false, targets: "github-release" });
    writeFileSync(relPath(), readFileSync(relPath(), "utf8").replace("    environment: release\n", "    environment: release-preview\n"));
    expect(check("workflow.human_approval_environment")).toBe("FAIL");
  });

  it("audits job-level permissions, not only the workflow default", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false });
    expect(check("workflow.least_privilege_permissions")).toBe("PASS");

    const rel = readFileSync(relPath(), "utf8");
    writeFileSync(relPath(), rel.replace(/(  verify:\n    runs-on: ubuntu-latest\n    permissions:\n)      contents: read\n/, "$1      contents: write\n"));
    expect(check("workflow.least_privilege_permissions")).toBe("FAIL");

    writeFileSync(relPath(), rel.replace(/(  verify:\n    runs-on: ubuntu-latest\n)    permissions:\n      contents: read\n/, "$1    permissions: write-all\n"));
    expect(check("workflow.least_privilege_permissions")).toBe("FAIL");
  });

  it("publishes the checksum-verified tarball to GitHub Packages instead of a rebuild", async () => {
    makeFixture({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } });
    await init({ cwd: dir, interactive: false });
    const rel = readFileSync(relPath(), "utf8");
    const job = rel.slice(rel.indexOf("  github-packages:"), rel.indexOf("  github-release:"));
    expect(job).toContain('tar -xzf "verified-artifact/$TARBALL"');
    expect(job).not.toContain("npm ci");
    expect(job).not.toContain("npm run build");
    expect(check("workflow.artifact_checksum_verified")).toBe("PASS");
  });
});
