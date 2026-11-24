import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONTRACT_VERSION, loadContract } from "./contract.js";
import { detectProject } from "./detect.js";
import { OWNER_PLACEHOLDER } from "./init.js";
import { readState, safeResolve, sha256 } from "./state.js";

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";
export type GateVerdict = "PASS" | "FAIL" | "HOLD";

export interface ConformanceCheckResult {
  id: string;
  mandatory: boolean;
  scope: "local" | "workflow" | "external";
  status: CheckStatus;
  evidence: string;
  remediation?: string;
}

export interface ConformanceReport {
  contractVersion: string;
  verdict: GateVerdict;
  publishAuthorized: false;
  localOnly: boolean;
  summary: { pass: number; fail: number; unknown: number };
  checks: ConformanceCheckResult[];
}

const SHA_PIN_RE = /uses:\s*([^\s#]+)@([0-9a-f]{40})\b/;
const USES_LINE_RE = /^\s*(?:-\s*)?uses:\s*(.+)$/;
const PUBLISH_JOB_NAMES = ["npm", "github-packages", "github-release", "homebrew"] as const;

function parseJobBlocks(yaml: string): Record<string, string> {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const jobs: Record<string, string[]> = {};
  let inJobs = false;
  let currentJob: string | undefined;

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      currentJob = undefined;
      continue;
    }
    if (inJobs && /^[a-zA-Z0-9_-]+:/.test(line)) {
      inJobs = false;
      currentJob = undefined;
      continue;
    }
    if (!inJobs) continue;
    const jobMatch = /^  ([a-zA-Z0-9_-]+):\s*$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobs[currentJob] = [line];
      continue;
    }
    if (currentJob) jobs[currentJob].push(line);
  }

  return Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, v.join("\n")]));
}

function checkShaPinning(files: Array<{ rel: string; content: string }>): { ok: boolean; unpinned: string[] } {
  const unpinned: string[] = [];
  for (const file of files) {
    for (const line of file.content.replace(/\r\n/g, "\n").split("\n")) {
      const m = USES_LINE_RE.exec(line);
      if (!m) continue;
      const raw = m[1].trim();
      if (raw.startsWith("./") || raw.startsWith("../")) continue;
      if (!SHA_PIN_RE.test(line)) {
        unpinned.push(`${file.rel}: ${raw}`);
      }
    }
  }
  return { ok: unpinned.length === 0, unpinned };
}

function checkTopLevelPermissions(content: string): boolean {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((l) => /^permissions:/.test(l));
  if (idx === -1) return false;
  const line = lines[idx].trim();
  if (line === "permissions: {}" || line === "permissions: read-all") return true;
  if (line !== "permissions:") return false;
  const block: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    if (lines[i].trim()) block.push(lines[i].trim());
  }
  return block.length > 0 && block.every((entry) => entry.endsWith(": read") || entry.endsWith(": none"));
}

export function runConformanceCheck(cwd: string, options: { localOnly?: boolean } = {}): ConformanceReport {
  const contract = loadContract();
  const localOnly = Boolean(options.localOnly);
  const results: ConformanceCheckResult[] = [];
  const metaById = new Map(contract.checks.map((c) => [c.id, c]));

  const push = (id: string, status: CheckStatus, evidence: string, remediation?: string) => {
    const meta = metaById.get(id) ?? { id, mandatory: true, scope: "local" as const, description: id };
    results.push({ id, mandatory: meta.mandatory, scope: meta.scope, status, evidence, ...(remediation ? { remediation } : {}) });
  };

  // 1. runtime.node_version
  const major = Number(process.versions.node.split(".")[0]);
  push(
    "runtime.node_version",
    major >= 20 ? "PASS" : "FAIL",
    `Node.js ${process.versions.node}`,
    major >= 20 ? undefined : "Upgrade to Node.js >= 20."
  );

  // 2. manifest.authoritative
  const project = detectProject(cwd);
  if (!project) {
    push("manifest.authoritative", "FAIL", "package.json missing or missing name field", "Create a valid package.json with name and semver version.");
  } else {
    const missing: string[] = [];
    if (!project.pkg.version || !/^\d+\.\d+\.\d+/.test(project.pkg.version)) missing.push("valid semver version");
    if (!Array.isArray(project.pkg.files) || project.pkg.files.length === 0) missing.push("files allowlist");
    if (!project.pkg.repository) missing.push("repository");
    const engines = project.pkg.engines as Record<string, string> | undefined;
    if (!engines?.node) missing.push("engines.node");
    push(
      "manifest.authoritative",
      missing.length === 0 ? "PASS" : "FAIL",
      missing.length === 0 ? `${project.name}@${project.version} defines all required manifest fields` : `missing: ${missing.join(", ")}`,
      missing.length === 0 ? undefined : "Run `packnpub init` or populate missing fields in package.json."
    );
  }

  // 3. manifest.bin_shebang
  if (!project) {
    push("manifest.bin_shebang", "UNKNOWN", "skipped because package.json is missing");
  } else if (!project.binPath) {
    push("manifest.bin_shebang", "PASS", "library package (no bin entrypoint declared)");
  } else {
    try {
      const entry = safeResolve(cwd, project.binPath);
      const ok = existsSync(entry) && readFileSync(entry, "utf8").startsWith("#!/usr/bin/env node");
      push(
        "manifest.bin_shebang",
        ok ? "PASS" : "FAIL",
        ok ? `${project.binPath} exists inside root with #!/usr/bin/env node` : `${project.binPath} missing or lacks #!/usr/bin/env node`,
        ok ? undefined : `Ensure ${project.binPath} exists and begins with #!/usr/bin/env node.`
      );
    } catch (err) {
      push("manifest.bin_shebang", "FAIL", err instanceof Error ? err.message : String(err), "Confine package.json bin path inside repository root.");
    }
  }

  // 4. manifest.version_consistency
  if (!project) {
    push("manifest.version_consistency", "UNKNOWN", "skipped because package.json is missing");
  } else {
    const binName = project.binName ?? project.name.split("/").pop() ?? project.name;
    const formulaRel = `scripts/homebrew/${binName}.rb`;
    const formulaPath = path.join(cwd, formulaRel);
    if (!existsSync(formulaPath)) {
      push("manifest.version_consistency", "PASS", "no local Homebrew seed formula present");
    } else {
      const formula = readFileSync(formulaPath, "utf8");
      const urlMatch = /^\s*url\s+"([^"]+)"/m.exec(formula);
      const url = urlMatch?.[1] ?? "";
      const matchesVersion = url.includes(`-${project.version}.tgz`);
      push(
        "manifest.version_consistency",
        matchesVersion ? "PASS" : "FAIL",
        matchesVersion
          ? `${formulaRel} URL matches package.json version ${project.version}`
          : `${formulaRel} URL (${url || "missing"}) drifted from package.json version ${project.version}`,
        matchesVersion ? undefined : `Run \`packnpub upgrade\` or sync ${formulaRel} URL to ${project.version}.`
      );
    }
  }

  // 5. workflow.files_present
  const ciRel = ".github/workflows/ci.yml";
  const relRel = ".github/workflows/release.yml";
  const ciExists = existsSync(path.join(cwd, ciRel));
  const relExists = existsSync(path.join(cwd, relRel));
  const verifyExists =
    existsSync(path.join(cwd, "scripts/verify-release.mjs")) || existsSync(path.join(cwd, "scripts/verify-release.sh"));
  const missingFiles = [
    ...(!ciExists ? [ciRel] : []),
    ...(!relExists ? [relRel] : []),
    ...(!verifyExists ? ["scripts/verify-release.mjs"] : []),
  ];
  push(
    "workflow.files_present",
    missingFiles.length === 0 ? "PASS" : "FAIL",
    missingFiles.length === 0 ? "CI, release workflow, and verify script present" : `missing: ${missingFiles.join(", ")}`,
    missingFiles.length === 0 ? undefined : "Run `npx packnpub init`."
  );

  const ciContent = ciExists ? readFileSync(path.join(cwd, ciRel), "utf8") : undefined;
  const relContent = relExists ? readFileSync(path.join(cwd, relRel), "utf8") : undefined;

  // 6. workflow.actions_sha_pinned
  const wfFiles = [
    ...(ciContent ? [{ rel: ciRel, content: ciContent }] : []),
    ...(relContent ? [{ rel: relRel, content: relContent }] : []),
  ];
  if (wfFiles.length === 0) {
    push("workflow.actions_sha_pinned", "UNKNOWN", "no workflow files present to audit");
  } else {
    const pin = checkShaPinning(wfFiles);
    push(
      "workflow.actions_sha_pinned",
      pin.ok ? "PASS" : "FAIL",
      pin.ok ? "all workflow uses: references are pinned to 40-char commit SHAs" : `unpinned actions: ${pin.unpinned.join(", ")}`,
      pin.ok ? undefined : "Pin every uses: reference to a full 40-char commit SHA (run `packnpub upgrade`)."
    );
  }

  // 7. workflow.least_privilege_permissions
  if (wfFiles.length === 0) {
    push("workflow.least_privilege_permissions", "UNKNOWN", "no workflow files present to audit");
  } else {
    const bad = wfFiles.filter((f) => !checkTopLevelPermissions(f.content)).map((f) => f.rel);
    push(
      "workflow.least_privilege_permissions",
      bad.length === 0 ? "PASS" : "FAIL",
      bad.length === 0 ? "all workflows declare least-privilege top-level permissions" : `over-permissive or missing top-level permissions: ${bad.join(", ")}`,
      bad.length === 0 ? undefined : "Set top-level `permissions: {}` or `permissions: contents: read`."
    );
  }

  // 8. workflow.human_approval_environment
  if (!relContent) {
    push("workflow.human_approval_environment", "UNKNOWN", "release.yml missing");
  } else {
    const jobs = parseJobBlocks(relContent);
    const presentPublishJobs = PUBLISH_JOB_NAMES.filter((name) => name in jobs);
    const ungated = presentPublishJobs.filter((name) => !/^\s+environment:\s*release\b/m.test(jobs[name]));
    const ok = presentPublishJobs.length > 0 && ungated.length === 0;
    push(
      "workflow.human_approval_environment",
      ok ? "PASS" : "FAIL",
      ok
        ? `all ${presentPublishJobs.length} publish job(s) (${presentPublishJobs.join(", ")}) require environment: release`
        : presentPublishJobs.length === 0
          ? "no publish jobs detected in release.yml"
          : `publish job(s) missing \`environment: release\`: ${ungated.join(", ")}`,
      ok ? undefined : "Add `environment: release` to every publish job and configure Required Reviewers in GitHub."
    );
  }

  // 9. workflow.artifact_checksum_verified
  if (!relContent) {
    push("workflow.artifact_checksum_verified", "UNKNOWN", "release.yml missing");
  } else {
    const hasChecksumCheck = relContent.includes("sha256sum -c SHA256SUMS.txt");
    const hasRunExprInjection = /^\s*(?:run:|\s*npm publish\s+).*?\$\{\{\s*needs\./m.test(relContent);
    const ok = hasChecksumCheck && !hasRunExprInjection;
    const reasons: string[] = [];
    if (!hasChecksumCheck) reasons.push("missing `sha256sum -c SHA256SUMS.txt` verification before publish");
    if (hasRunExprInjection) reasons.push("direct `${{ needs.* }}` interpolation inside `run:` command");
    push(
      "workflow.artifact_checksum_verified",
      ok ? "PASS" : "FAIL",
      ok ? "release.yml verifies SHA256SUMS.txt and passes job outputs via env:" : reasons.join("; "),
      ok ? undefined : "Verify SHA256SUMS.txt before publishing and pass job outputs through `env:`."
    );
  }

  // 10. workflow.owner_resolved
  if (!relContent) {
    push("workflow.owner_resolved", "UNKNOWN", "release.yml missing");
  } else {
    const hasPlaceholder = relContent.includes(`${OWNER_PLACEHOLDER}/`);
    push(
      "workflow.owner_resolved",
      hasPlaceholder ? "FAIL" : "PASS",
      hasPlaceholder ? `release.yml still contains ${OWNER_PLACEHOLDER}/ placeholder` : "release owner resolved",
      hasPlaceholder ? "Re-run `npx packnpub init --owner <github-owner> --force`." : undefined
    );
  }

  // 11. state.template_drift (optional)
  const state = readState(cwd);
  if (!state) {
    push(
      "state.template_drift",
      "UNKNOWN",
      "no .packnpub/state.json found (unversioned or pre-v1.0.0 repo)",
      "Run `npx packnpub upgrade --dry-run` to migrate to versioned state."
    );
  } else {
    const drifted: string[] = [];
    for (const [rel, rec] of Object.entries(state.managedFiles)) {
      const full = path.join(cwd, rel);
      if (!existsSync(full)) {
        drifted.push(`${rel} (missing)`);
      } else if (sha256(readFileSync(full, "utf8")) !== rec.sha256) {
        drifted.push(`${rel} (modified)`);
      }
    }
    const versionMatch = state.contractVersion === CONTRACT_VERSION;
    const ok = drifted.length === 0 && versionMatch;
    push(
      "state.template_drift",
      ok ? "PASS" : "FAIL",
      ok
        ? `state matches contract v${state.contractVersion} (${Object.keys(state.managedFiles).length} managed files)`
        : `contract=${state.contractVersion}, drift: ${drifted.join(", ") || "version mismatch"}`,
      ok ? undefined : "Run `npx packnpub diff` to inspect drift or `npx packnpub upgrade --dry-run`."
    );
  }

  // 12 & 13. External server-side checks (always UNKNOWN offline — never fabricated)
  push(
    "external.github_environment_reviewers",
    "UNKNOWN",
    "GitHub repository 'release' Environment Required Reviewers cannot be verified offline",
    "Confirm Required Reviewers and tag rulesets in GitHub Settings -> Environments -> release."
  );
  push(
    "external.ci_run_verified",
    "UNKNOWN",
    "Remote GitHub Actions CI run status for HEAD cannot be verified offline",
    "Verify CI workflow run on GitHub Actions after pushing branch."
  );

  const gatingChecks = results.filter((c) => c.mandatory && (!localOnly || c.scope !== "external"));
  const hasFail = gatingChecks.some((c) => c.status === "FAIL");
  const hasUnknown = gatingChecks.some((c) => c.status === "UNKNOWN");
  const verdict: GateVerdict = hasFail ? "FAIL" : hasUnknown ? "HOLD" : "PASS";

  return {
    contractVersion: contract.contractVersion,
    verdict,
    publishAuthorized: false,
    localOnly,
    summary: {
      pass: results.filter((c) => c.status === "PASS").length,
      fail: results.filter((c) => c.status === "FAIL").length,
      unknown: results.filter((c) => c.status === "UNKNOWN").length,
    },
    checks: results,
  };
}

export function formatConformanceReport(report: ConformanceReport): string {
  const lines = [
    `packnpub check (contract v${report.contractVersion}) — verdict: ${report.verdict} (publishAuthorized: ${report.publishAuthorized})`,
  ];
  for (const c of report.checks) {
    const tag = c.mandatory ? "REQ" : "OPT";
    lines.push(`  [${c.status.padEnd(7)}] (${tag}/${c.scope}) ${c.id}: ${c.evidence}`);
    if (c.remediation && c.status !== "PASS") {
      lines.push(`             fix: ${c.remediation}`);
    }
  }
  return lines.join("\n");
}
