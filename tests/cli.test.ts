import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

let dir: string;
const logs: string[] = [];
const errors: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "packnpub-cli-"));
  logs.length = 0;
  errors.length = 0;
  viSpy();
});
afterEach(() => {
  restoreSpy();
  rmSync(dir, { recursive: true, force: true });
});

let logOrig: typeof console.log;
let errOrig: typeof console.error;
function viSpy() {
  logOrig = console.log;
  errOrig = console.error;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
}
function restoreSpy() {
  console.log = logOrig;
  console.error = errOrig;
}

function seedProject(remote?: string) {
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "widget", version: "1.0.0", bin: { widget: "./bin/cli.js" } }, null, 2),
  );
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  writeFileSync(path.join(dir, "bin/cli.js"), "#!/usr/bin/env node\nconsole.log('1.0.0')\n");
  writeFileSync(path.join(dir, "README.md"), "# widget\n\n```bash\nnpx widget init\n```\n");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
}

describe("cli", () => {
  it("prints version and help", async () => {
    expect(await run(["--version"], dir)).toBe(0);
    expect(logs.at(-1)).toMatch(/^\d+\.\d+\.\d+$/);
    logs.length = 0;
    expect(await run(["--help"], dir)).toBe(0);
    expect(logs.join("\n")).toContain("packnpub init");
  });

  it("rejects unknown commands with usage exit", async () => {
    expect(await run(["nope"], dir)).toBe(2);
    expect(errors.join("\n")).toMatch(/unknown command/);
  });

  it("init attaches a doctor scorecard and points at verify when healthy", async () => {
    seedProject("https://github.com/acme/widget.git");
    writeFileSync(path.join(dir, "package-lock.json"), "{}\n");
    const code = await run(["init", "--yes"], dir);
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("Doctor");
    expect(out).toContain("commit the scaffold");
    expect(out).toContain("npx packnpub verify --skip-tag");
    expect(out).toContain("--skip-git");
    expect(out).toMatch(/ok\s+release owner/);
  });

  it("init --json includes checks", async () => {
    seedProject("https://github.com/acme/widget.git");
    await run(["init", "--yes", "--json"], dir);
    const payload = JSON.parse(logs.join("\n"));
    expect(payload.created.length).toBeGreaterThan(0);
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.next).toContain("verify");
  });

  it("doctor --json returns an array", async () => {
    seedProject("https://github.com/acme/widget.git");
    await run(["init", "--yes"], dir);
    logs.length = 0;
    const code = await run(["doctor", "--json"], dir);
    expect(code).toBe(0);
    const checks = JSON.parse(logs.join("\n"));
    expect(checks.some((c: { name: string }) => c.name === "README quickstart")).toBe(true);
  });
});
