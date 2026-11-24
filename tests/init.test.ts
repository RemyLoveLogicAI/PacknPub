import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doctor } from "../src/doctor.js";
import { dryRunFollowUp, init, shellSingleQuote, UsageError, writeAtomic } from "../src/init.js";

let dir: string;

function makeProject(pkg: Record<string, unknown>, remote?: string) {
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "packnpub-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("init", () => {
  it("writes workflows, verify script, formula and patches package.json", async () => {
    makeProject({ name: "@acme/widget", version: "1.2.3", bin: { widget: "./bin/cli.js" } }, "git@github.com:Acme/widget.git");
    const result = await init({ cwd: dir, interactive: false });

    expect(result.created).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      "scripts/verify-release.sh",
      "scripts/homebrew/widget.rb",
    ]);
    expect(result.warnings).toEqual([]);
    if (process.platform !== "win32") {
      expect(statSync(path.join(dir, "scripts/verify-release.sh")).mode & 0o111).not.toBe(0);
    }

    const release = readFileSync(path.join(dir, ".github/workflows/release.yml"), "utf8");
    expect(release).toContain("repository: Acme/homebrew-tap");
    expect(release).toContain('npm view "@acme/widget@$VERSION"');
    expect(release).not.toMatch(/# (>>>|<<<)/);
    expect(release).not.toMatch(/\{\{\w+\}\}/);

    const formula = readFileSync(path.join(dir, "scripts/homebrew/widget.rb"), "utf8");
    expect(formula).toContain("class Widget < Formula");
    expect(formula).toContain("/@acme/widget/-/widget-1.2.3.tgz");

    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    expect(pkg.repository.url).toBe("git+https://github.com/Acme/widget.git");
    expect(pkg.scripts.verify).toBe("bash scripts/verify-release.sh");
  });

  it("is idempotent and never overwrites without force", async () => {
    makeProject({ name: "widget", version: "0.1.0", files: ["dist"] }, "https://github.com/acme/widget");
    await init({ cwd: dir, interactive: false });
    const second = await init({ cwd: dir, interactive: false });
    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(4);
    expect(second.patched).toEqual([]);
  });

  it("drops disabled targets and their needs entries", async () => {
    makeProject({ name: "widget", version: "0.1.0" }, "https://github.com/acme/widget");
    await init({ cwd: dir, interactive: false, targets: "github-release" });
    const release = readFileSync(path.join(dir, ".github/workflows/release.yml"), "utf8");
    expect(release).toContain("github-release:");
    expect(release).not.toContain("id-token: write");
    expect(release).not.toContain("      - npm\n");
    expect(release).not.toContain("homebrew");
    expect(existsSync(path.join(dir, "scripts/homebrew"))).toBe(false);
  });

  it("dry run writes nothing", async () => {
    makeProject({ name: "widget", version: "0.1.0" }, "https://github.com/acme/widget");
    const result = await init({ cwd: dir, interactive: false, dryRun: true });
    expect(result.created).toHaveLength(4);
    expect(existsSync(path.join(dir, ".github"))).toBe(false);
  });

  it("dry-run next preserves owner, targets, and force with shell quoting", async () => {
    makeProject({ name: "widget", version: "0.1.0" });
    const result = await init({
      cwd: dir,
      interactive: false,
      dryRun: true,
      owner: "acme",
      targets: "github-release",
      force: true,
    });
    expect(result.next).toBe(
      "npx packnpub init --yes --owner 'acme' --targets 'github-release' --force",
    );
    expect(dryRunFollowUp("acme", ["npm", "github-release"], false)).toBe(
      "npx packnpub init --yes --owner 'acme' --targets 'npm,github-release'",
    );
    expect(dryRunFollowUp("OWNER", ["npm", "github-release", "github-packages", "homebrew"])).toBe(
      "npx packnpub init --yes",
    );
    expect(shellSingleQuote("acme;rm -rf /")).toBe("'acme;rm -rf /'");
    expect(shellSingleQuote("o'wner")).toBe(`'o'\\''wner'`);
  });

  it("preserves existing file mode when writeAtomic overwrites without an explicit mode", () => {
    if (process.platform === "win32") return;
    const file = path.join(dir, "secret.json");
    writeFileSync(file, "{}\n");
    chmodSync(file, 0o600);
    writeAtomic(file, '{"ok":true}\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe('{"ok":true}\n');
  });

  it("uses a placeholder owner and warns when no remote exists", async () => {
    makeProject({ name: "widget", version: "0.1.0" });
    const result = await init({ cwd: dir, interactive: false });
    expect(result.warnings[0]).toContain("--owner");
    expect(doctor(dir).find((c) => c.name === "release owner")?.status).toBe("fail");
  });

  it("doctor reports bash availability for verify", () => {
    makeProject({ name: "widget", version: "0.1.0" }, "https://github.com/acme/widget");
    const originalPath = process.env.PATH;
    const bashStatus = () => doctor(dir).find((c) => c.name === "bash")?.status;

    try {
      let bashDir: string | undefined;
      try {
        const found = execFileSync(process.platform === "win32" ? "where" : "which", ["bash"], {
          encoding: "utf8",
        })
          .trim()
          .split(/\r?\n/)[0];
        if (found) bashDir = path.dirname(found);
      } catch {
        /* bash not on PATH in this environment */
      }

      if (bashDir) {
        process.env.PATH = bashDir;
        expect(bashStatus()).toBe("pass");
      }

      process.env.PATH = path.join(dir, "no-bash-bin");
      expect(bashStatus()).toBe("warn");
    } finally {
      process.env.PATH = originalPath;
    }
  });


  it("rejects bad input with usage errors", async () => {
    await expect(init({ cwd: dir, interactive: false })).rejects.toBeInstanceOf(UsageError);
    makeProject({ name: "widget", version: "0.1.0" });
    await expect(init({ cwd: dir, interactive: false, targets: "pypi" })).rejects.toThrow(/unknown target/);
    await expect(init({ cwd: dir, interactive: false, targets: "homebrew" })).rejects.toThrow(/add npm/);
    await expect(init({ cwd: dir, interactive: false, targets: "," })).rejects.toThrow(/at least one/);
    await expect(init({ cwd: dir, interactive: false, targets: "  ,  " })).rejects.toThrow(/at least one/);
    await expect(init({ cwd: dir, interactive: false, targets: "" })).rejects.toThrow(/at least one/);
    await expect(init({ cwd: dir, interactive: false, owner: "acme;rm" })).rejects.toThrow(/invalid --owner/);
    await expect(init({ cwd: dir, interactive: false, owner: "acme $(id)" })).rejects.toThrow(/invalid --owner/);
    await expect(init({ cwd: dir, interactive: false, owner: "" })).rejects.toThrow(/must not be empty/);
    await expect(init({ cwd: dir, interactive: false, owner: "   " })).rejects.toThrow(/must not be empty/);
  });

  it("cleans up the temp file when writeAtomic fails before rename", () => {
    const dest = path.join(dir, "blocked.json");
    mkdirSync(dest); // rename onto a directory fails
    const before = new Set(readdirSync(dir));
    expect(() => writeAtomic(dest, '{"x":1}\n')).toThrow();
    const leftovers = readdirSync(dir).filter((name) => name.includes(".tmp") && !before.has(name));
    expect(leftovers).toEqual([]);
  });
});
