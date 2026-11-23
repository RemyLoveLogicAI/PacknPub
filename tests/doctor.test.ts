import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doctor, nextAfterDoctor } from "../src/doctor.js";
import { init } from "../src/init.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "packnpub-doctor-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeReadme(body: string) {
  writeFileSync(path.join(dir, "README.md"), body);
}

describe("doctor", () => {
  it("warns when README lacks a quickstart command", async () => {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "widget", version: "0.1.0" }));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/widget.git"], { cwd: dir });
    writeReadme("# widget\n\nA thing.\n");
    await init({ cwd: dir, interactive: false });
    const check = doctor(dir).find((c) => c.name === "README quickstart");
    expect(check?.status).toBe("warn");
  });

  it("passes README quickstart when npx appears early", async () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "widget", version: "0.1.0", bin: { widget: "./bin/cli.js" } }),
    );
    mkdirSync(path.join(dir, "bin"), { recursive: true });
    writeFileSync(path.join(dir, "bin/cli.js"), "#!/usr/bin/env node\n");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/widget.git"], { cwd: dir });
    writeReadme("# widget\n\n```bash\nnpx packnpub init\n```\n");
    await init({ cwd: dir, interactive: false });
    const check = doctor(dir).find((c) => c.name === "README quickstart");
    expect(check?.status).toBe("pass");
  });

  it("chooses the next command from check severity", () => {
    const next = nextAfterDoctor([{ name: "x", status: "pass", detail: "" }]);
    expect(next).toContain("commit the scaffold");
    expect(next).toContain("npx packnpub verify --skip-tag");
    expect(next).toContain("--skip-git");
    expect(nextAfterDoctor([{ name: "x", status: "fail", detail: "" }])).toContain("fix the FAIL");
  });
});
