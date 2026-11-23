import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  doctor,
  formatChecks,
  hasReadmeQuickstart,
  nextAfterDoctor,
  sanitizeText,
} from "../src/doctor.js";
import { init } from "../src/init.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "packnpub-doctor-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeReadme(body: string) {
  writeFileSync(path.join(dir, "README.md"), body);
}

function seed(pkg: Record<string, unknown> = { name: "widget", version: "0.1.0" }) {
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/widget.git"], { cwd: dir });
}

describe("doctor", () => {
  it("warns when README lacks a quickstart command", async () => {
    seed();
    writeReadme("# widget\n\nA thing.\n");
    await init({ cwd: dir, interactive: false });
    const check = doctor(dir).find((c) => c.name === "README quickstart");
    expect(check?.status).toBe("warn");
  });

  it("passes README quickstart when npx appears early", async () => {
    seed({ name: "widget", version: "0.1.0", bin: { widget: "./bin/cli.js" } });
    mkdirSync(path.join(dir, "bin"), { recursive: true });
    writeFileSync(path.join(dir, "bin/cli.js"), "#!/usr/bin/env node\n");
    writeReadme("# widget\n\n```bash\nnpx packnpub init\n```\n");
    await init({ cwd: dir, interactive: false });
    const check = doctor(dir).find((c) => c.name === "README quickstart");
    expect(check?.status).toBe("pass");
  });

  it("rejects broad yarn test noise and late install commands", () => {
    expect(hasReadmeQuickstart("# app\n\n```\nyarn test\n```\n")).toBe(false);
    expect(hasReadmeQuickstart("# app\n\n```\nnpm run build\n```\n")).toBe(false);
    const late = `${"x".repeat(520)}\nnpx packnpub init\n`;
    expect(hasReadmeQuickstart(late)).toBe(false);
    expect(hasReadmeQuickstart("# app\n\nnpm install -g packnpub\n")).toBe(true);
  });

  it("reports unreadable README as a check instead of throwing", () => {
    seed();
    mkdirSync(path.join(dir, "README.md"));
    const check = doctor(dir).find((c) => c.name === "README quickstart");
    expect(check?.status).toBe("warn");
    expect(check?.detail).toMatch(/could not be read/);
  });

  it("fails lockfile and blocks verify next-step when missing", async () => {
    seed({ name: "widget", version: "0.1.0", bin: { widget: "./bin/cli.js" } });
    mkdirSync(path.join(dir, "bin"), { recursive: true });
    writeFileSync(path.join(dir, "bin/cli.js"), "#!/usr/bin/env node\n");
    writeReadme("# widget\n\n```bash\nnpx packnpub init\n```\n");
    await init({ cwd: dir, interactive: false });
    const checks = doctor(dir);
    expect(checks.find((c) => c.name === "lockfile")?.status).toBe("fail");
    expect(nextAfterDoctor(checks)).toContain("npm install");
    expect(nextAfterDoctor(checks)).not.toContain("verify");
  });

  it("treats a package-lock.json directory as a missing lockfile", async () => {
    seed();
    writeReadme("# widget\n\nnpx packnpub init\n");
    await init({ cwd: dir, interactive: false });
    mkdirSync(path.join(dir, "package-lock.json"));
    expect(doctor(dir).find((c) => c.name === "lockfile")?.status).toBe("fail");
  });

  it("strips control characters from formatted checks", () => {
    const out = formatChecks([{ name: "pkg", status: "pass", detail: "evil\u001b[31mspoof\u0007" }]);
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
    expect(out).toContain("evil[31mspoof");
    expect(sanitizeText("a\u0000b")).toBe("ab");
    expect(sanitizeText("line\rspoof\nok\tbad")).toBe("linespoofokbad");
    expect(sanitizeText("x\u0085y\u009Fz")).toBe("xyz");
  });

  it("chooses the next command from check severity", () => {
    const next = nextAfterDoctor([{ name: "x", status: "pass", detail: "" }]);
    expect(next).toContain("files includes dist");
    expect(next).toContain("commit the scaffold");
    expect(next).toContain("npx packnpub verify --skip-tag");
    expect(next).toContain("--skip-git");
    expect(nextAfterDoctor([{ name: "x", status: "fail", detail: "" }])).toContain("fix the FAIL");
    expect(
      nextAfterDoctor([{ name: "lockfile", status: "fail", detail: "missing" }]),
    ).toContain("npm install");
  });
});
