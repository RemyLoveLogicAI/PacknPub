import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { formatConformanceReport, runConformanceCheck } from "./check.js";
import { doctor, formatChecks, nextAfterDoctor } from "./doctor.js";
import { formatInitResult, init, UsageError } from "./init.js";
import { planProjectFiles, rollbackProject, upgradeProject } from "./upgrade.js";
import { verify } from "./verify.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const HELP = `packnpub ${version}: evidence-backed release standard for npm, GitHub Releases, GitHub Packages and Homebrew

Usage
  packnpub init      Add CI, release workflow, verify script, Homebrew formula and .packnpub/state.json
  packnpub check     Run machine-readable conformance gate (PASS / FAIL / HOLD)
  packnpub doctor    Check local package readiness and workflow hardening
  packnpub diff      Preview unified diffs and drift against the current contract
  packnpub upgrade   Safely upgrade managed templates (halts on conflicts, backs up before writing)
  packnpub rollback  Restore the latest pre-upgrade backup snapshot
  packnpub verify    Run the pre-publish gate (pack, install in isolation, smoke test)

Common options
  -y, --yes            Accept defaults, never prompt
  --owner <name>       GitHub user or org (default: from git remote)
  --targets <list>     Comma list of npm,github-release,github-packages,homebrew (default: all)
  --force              Overwrite existing/conflicting files (creates backup on upgrade)
  --dry-run            Preview changes and unified diffs without writing
  --local-only         For check: gate on local + workflow checks (external checks still reported UNKNOWN)
  --json               Machine-readable JSON output

Verify options
  --skip-git           Allow a dirty working tree
  --skip-tag           Skip the tag == version check
  --skip-network       Skip publint/attw if offline

Examples
  npx packnpub init --yes --dry-run
  npx packnpub check --json
  npx packnpub diff
  npx packnpub upgrade --dry-run
  npx packnpub verify --skip-tag`;

type Command = "init" | "check" | "doctor" | "diff" | "upgrade" | "rollback" | "verify" | "help" | "";

export async function run(argv: string[], cwd = process.cwd()): Promise<number> {
  const raw = argv[0]?.startsWith("-") ? "" : (argv[0] ?? "help");
  const rest = argv[0]?.startsWith("-") ? argv : argv.slice(1);
  const command = raw as Command | string;
  if (command === "verify") return verify(cwd, rest);

  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        yes: { type: "boolean", short: "y" },
        force: { type: "boolean" },
        "dry-run": { type: "boolean" },
        "local-only": { type: "boolean" },
        json: { type: "boolean" },
        owner: { type: "string" },
        targets: { type: "string" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  if (values.version) {
    console.log(version);
    return 0;
  }
  if (values.help || command === "" || command === "help") {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case "init": {
      const interactive = Boolean(process.stdin.isTTY) && !process.env.CI && !values.yes && !values.json;
      try {
        const result = await init({
          cwd,
          force: values.force,
          dryRun: values["dry-run"],
          owner: values.owner,
          targets: values.targets,
          interactive,
        });
        if (!values["dry-run"]) {
          result.checks = doctor(cwd);
          result.next = nextAfterDoctor(result.checks);
        }
        console.log(
          values.json
            ? JSON.stringify(result)
            : formatInitResult(result, Boolean(values["dry-run"]), formatChecks),
        );
        // Scaffold succeeded — doctor FAILs are guidance in the scorecard/next step, not init errors.
        return 0;
      } catch (err) {
        if (err instanceof UsageError) {
          console.error(err.message);
          return 2;
        }
        throw err;
      }
    }
    case "check": {
      const report = runConformanceCheck(cwd, { localOnly: Boolean(values["local-only"]) });
      console.log(values.json ? JSON.stringify(report, null, 2) : formatConformanceReport(report));
      if (report.verdict === "PASS") return 0;
      if (report.verdict === "HOLD") return 2;
      return 1;
    }
    case "diff": {
      try {
        const plan = planProjectFiles(cwd, { targets: values.targets, owner: values.owner });
        if (values.json) {
          console.log(JSON.stringify(plan, null, 2));
        } else {
          console.log(`packnpub diff (${plan.fromContractVersion} -> contract v${plan.contractVersion})`);
          for (const f of plan.files) {
            console.log(`  [${f.status}] ${f.path}`);
            if (f.diff) console.log(f.diff);
          }
        }
        return plan.conflicts.length > 0 ? 1 : 0;
      } catch (err) {
        if (err instanceof UsageError) {
          console.error(err.message);
          return 2;
        }
        throw err;
      }
    }
    case "upgrade": {
      try {
        const result = upgradeProject(cwd, {
          dryRun: Boolean(values["dry-run"]),
          force: Boolean(values.force),
          targets: values.targets,
          owner: values.owner,
        });
        if (values.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.conflicts.length > 0) {
          console.error(`packnpub upgrade halted: ${result.conflicts.length} conflict(s) detected (pass --force to overwrite with backup):`);
          for (const c of result.conflicts) {
            console.error(`  conflict  ${c}`);
            if (result.diffs[c]) console.error(result.diffs[c]);
          }
        } else {
          console.log(result.dryRun ? "Dry run: nothing written." : `packnpub upgrade applied (backup: ${result.backupDir})`);
          for (const f of result.created) console.log(`  ${result.dryRun ? "would create" : "created"}  ${f}`);
          for (const f of result.updated) console.log(`  ${result.dryRun ? "would update" : "updated"}  ${f}`);
          for (const f of result.unchanged) console.log(`  unchanged ${f}`);
        }
        return result.conflicts.length > 0 ? 1 : 0;
      } catch (err) {
        if (err instanceof UsageError) {
          console.error(err.message);
          return 2;
        }
        throw err;
      }
    }
    case "rollback": {
      try {
        const res = rollbackProject(cwd);
        console.log(values.json ? JSON.stringify(res, null, 2) : `Restored ${res.restored.length} file(s), removed ${res.removed.length} file(s) from ${res.restoredFrom}`);
        return 0;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return 1;
      }
    }
    case "doctor": {
      const checks = doctor(cwd);
      console.log(values.json ? JSON.stringify(checks) : formatChecks(checks));
      return checks.some((c) => c.status === "fail") ? 1 : 0;
    }
    default: {
      console.error(`unknown command: ${command}\n\n${HELP}`);
      return 2;
    }
  }
}
