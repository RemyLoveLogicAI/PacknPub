import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { TEMPLATES_DIR } from "./templates.js";

/**
 * Runs the project's cross-platform verify-release.mjs when present,
 * falling back to scripts/verify-release.sh (or the bundled bash copy) for legacy projects.
 */
export function verify(cwd: string, args: string[]): number {
  if (!existsSync(cwd)) {
    console.error(`packnpub verify: working directory does not exist: ${cwd}`);
    return 1;
  }

  const localMjs = path.join(cwd, "scripts", "verify-release.mjs");
  if (existsSync(localMjs)) {
    const res = spawnSync(process.execPath, [localMjs, ...args], { cwd, stdio: "inherit" });
    if (res.error) {
      console.error(res.error.message);
      return 1;
    }
    return res.status ?? 1;
  }

  const localSh = path.join(cwd, "scripts", "verify-release.sh");
  const script = existsSync(localSh) ? localSh : path.join(TEMPLATES_DIR, "scripts", "verify-release.sh");
  const result = spawnSync("bash", [script, ...args], { cwd, stdio: "inherit" });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.error("packnpub verify needs bash on PATH (Git Bash or WSL on Windows), or upgrade to scripts/verify-release.mjs.");
      return 1;
    }
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}
