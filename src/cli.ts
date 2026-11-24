import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { doctor, formatChecks, nextAfterDoctor } from "./doctor.js";
import { formatInitResult, init, UsageError } from "./init.js";
import { verify } from "./verify.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const HELP = `packnpub ${version}: release pipeline for npm, GitHub Releases, GitHub Packages and Homebrew

Usage
  packnpub init      Add CI, release workflow, verify script and Homebrew formula
  packnpub doctor    Check the package is ready to publish
  packnpub verify    Run the pre-publish gate (pack, install in isolation, smoke test)

Init options
  -y, --yes            Accept defaults, never prompt
  --owner <name>       GitHub user or org (default: from git remote)
  --targets <list>     Comma list of npm,github-release,github-packages,homebrew (default: all)
  --force              Overwrite existing files
  --dry-run            Show what would change
  --json               Machine-readable output

Verify options
  --skip-git           Allow a dirty working tree
  --skip-tag           Skip the tag == version check

Examples
  npx packnpub init
  npx packnpub init --yes --targets npm,github-release
  npx packnpub verify --skip-tag`;

type Command = "init" | "doctor" | "verify" | "help" | "";

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
