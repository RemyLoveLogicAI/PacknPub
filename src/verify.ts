import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { TEMPLATES_DIR } from "./templates.js";

/** Runs the project's own verify-release.sh if it has one, otherwise the bundled copy. */
export function verify(cwd: string, args: string[]): number {
  const local = path.join(cwd, "scripts", "verify-release.sh");
  const script = existsSync(local) ? local : path.join(TEMPLATES_DIR, "scripts", "verify-release.sh");
  const result = spawnSync("bash", [script, ...args], { cwd, stdio: "inherit" });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.error("packnpub verify needs bash on PATH (Git Bash or WSL on Windows).");
      return 1;
    }
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}
