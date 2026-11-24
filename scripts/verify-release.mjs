#!/usr/bin/env node
// Cross-platform pre-publish gate for npm packages (Node.js >= 20).
// Run from the package root after building.
// Flags: --skip-git (allow dirty tree), --skip-tag (skip tag == version check), --skip-network (skip npx publint/attw if offline)
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
let skipGit = false;
let skipTag = false;
let skipNetwork = false;

for (const arg of args) {
  if (arg === "--skip-git") skipGit = true;
  else if (arg === "--skip-tag") skipTag = true;
  else if (arg === "--skip-network") skipNetwork = true;
  else {
    console.error(`unknown flag: ${arg}`);
    process.exit(2);
  }
}

const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";
const npxCmd = isWin ? "npx.cmd" : "npx";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`ok: ${msg}`);
}

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWin && (cmd.endsWith(".cmd") || cmd === "npx" || cmd === "npm"),
    ...opts,
  });
}

const cwd = process.cwd();
const pkgPath = path.join(cwd, "package.json");
if (!existsSync(pkgPath)) fail(`no package.json in ${cwd}`);

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const name = pkg.name;
const version = pkg.version;
if (!name || !version) fail("package.json must define name and version");

let binName = "";
let binEntry = "";
if (typeof pkg.bin === "string") {
  binName = name.split("/").pop() ?? name;
  binEntry = pkg.bin;
} else if (pkg.bin && typeof pkg.bin === "object") {
  const first = Object.entries(pkg.bin)[0];
  if (first) {
    binName = first[0];
    binEntry = first[1];
  }
}

if (!skipGit) {
  const status = run("git", ["status", "--porcelain"], { cwd }).trim();
  if (status) fail("working tree is dirty (commit, stash, or pass --skip-git)");
  ok("clean git tree");
}

if (!skipTag) {
  let tag = process.env.GITHUB_REF_NAME ?? "";
  if (!tag) {
    try {
      tag = run("git", ["describe", "--tags", "--exact-match"], { cwd }).trim();
    } catch {
      tag = "";
    }
  }
  if (!tag) fail("HEAD has no tag (pass --skip-tag before tagging)");
  if (tag !== `v${version}`) fail(`tag ${tag} != package.json v${version}`);
  ok(`tag ${tag} matches version`);
}

if (Array.isArray(pkg.files) && pkg.files.includes("dist") && !existsSync(path.join(cwd, "dist"))) {
  fail("dist/ missing; run the build first");
}

const packRaw = run(npmCmd, ["pack", "--dry-run", "--json"], { cwd });
const packJson = JSON.parse(packRaw);
const entry = Array.isArray(packJson) ? packJson[0] : Object.values(packJson)[0];
const files = (entry?.files ?? []).map((f) => f.path);

const secretRe = /(^|\/)(\.env|\.npmrc|id_rsa|[^/]*\.pem|[^/]*\.key|credentials|secrets?\.)/i;
const secretHits = files.filter((f) => secretRe.test(f));
if (secretHits.length) {
  console.error(secretHits.join("\n"));
  fail("secret-looking files in the pack");
}

const forbiddenRe = /^(src|tests?|node_modules|\.github)\//;
const forbiddenHits = files.filter((f) => forbiddenRe.test(f));
if (forbiddenHits.length) {
  console.error(forbiddenHits.join("\n"));
  fail('source, test, or CI files in the pack; tighten "files" in package.json');
}
ok(`pack contents (${files.length} files)`);

if (binEntry) {
  const resolved = path.resolve(cwd, binEntry);
  if (!resolved.startsWith(path.resolve(cwd) + path.sep)) fail(`bin entry escapes repo root: ${binEntry}`);
  if (!existsSync(resolved)) fail(`bin entry missing: ${binEntry}`);
  const firstLine = readFileSync(resolved, "utf8").split(/\r?\n/)[0] ?? "";
  if (!firstLine.startsWith("#!/usr/bin/env node")) fail(`${binEntry} is missing #!/usr/bin/env node`);
  ok(`shebang in ${binEntry}`);
}

if (!skipNetwork) {
  try {
    run(npxCmd, ["--no-install", "publint"], { cwd });
    ok("publint");
  } catch {
    fail("publint failed (run: npx publint)");
  }

  if (pkg.exports) {
    const profile = JSON.stringify(pkg.exports).includes("require") ? "node16" : "esm-only";
    try {
      run(npxCmd, ["--no-install", "attw", "--pack", ".", "--profile", profile], { cwd });
      ok(`attw (${profile})`);
    } catch {
      fail(`attw failed (run: npx attw --pack . --profile ${profile})`);
    }
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), "packnpub-verify-"));
try {
  const tarball = run(npmCmd, ["pack", "--silent", "--pack-destination", tmp], { cwd }).trim().split(/\r?\n/).pop();
  if (!tarball) fail("npm pack did not output tarball filename");
  run(npmCmd, ["init", "-y"], { cwd: tmp });
  run(npmCmd, ["install", "--silent", "--no-audit", "--no-fund", "--offline", `./${tarball}`], { cwd: tmp });

  if (binName) {
    const verOut = run(npxCmd, ["--no-install", binName, "--version"], { cwd: tmp });
    if (!verOut.includes(version)) fail(`smoke test: --version output did not include ${version}`);
    const helpOut = run(npxCmd, ["--no-install", binName, "--help"], { cwd: tmp });
    if (/\binit\b/.test(helpOut)) {
      run(npxCmd, ["--no-install", binName, "init", "--yes", "--dry-run"], {
        cwd: tmp,
        env: { ...process.env, CI: "true" },
      });
    }
  } else {
    run("node", ["--input-type=module", "-e", `await import(${JSON.stringify(name)})`], { cwd: tmp });
  }
  ok("tarball installs and runs in isolation");
} catch (err) {
  fail(`tarball smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`PASS: ${name}@${version} is ready for human-approved release (gate pass does not authorize publish)`);
