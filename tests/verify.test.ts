import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verify } from "../src/verify.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("verify", () => {
  it("reports missing cwd instead of missing bash on ENOENT", () => {
    const missing = path.join(tmpdir(), `packnpub-missing-${Date.now()}`);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = verify(missing, ["--skip-tag"]);
    expect(code).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toMatch(/working directory does not exist/);
    expect(err.mock.calls.flat().join("\n")).not.toMatch(/needs bash/);
  });

  it("reports missing bash when cwd exists but bash is not on PATH", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "packnpub-verify-"));
    dirs.push(cwd);
    const originalPath = process.env.PATH;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.PATH = path.join(cwd, "no-bash");
      const code = verify(cwd, ["--skip-tag"]);
      expect(code).toBe(1);
      expect(err.mock.calls.flat().join("\n")).toMatch(/needs bash/);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
