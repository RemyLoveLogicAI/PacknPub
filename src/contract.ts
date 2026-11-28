import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT_VERSION = "1.0.0";
export const TEMPLATE_VERSION = "1.0.0";

export const CONTRACTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "contracts", "v1");

export interface NonGoal {
  id: string;
  reason: string;
  errorCode: string;
  revisitCriteria: string;
}

export interface ContractCheckDef {
  id: string;
  mandatory: boolean;
  scope: "local" | "workflow" | "external";
  description: string;
}

export interface PacknPubContract {
  contractVersion: string;
  templateVersion: string;
  supportedEcosystems: Array<{
    id: string;
    manifestFile: string;
    runtimeRequirement: string;
    status: "supported" | "planned" | "non-goal";
  }>;
  nonGoals: NonGoal[];
  authoritativeManifests: Record<
    string,
    {
      file: string;
      requiredFields: string[];
      derivedProperties: string[];
      forbiddenInTarball: string[];
    }
  >;
  supportedTargets: Array<{
    id: string;
    requiresHumanApprovalEnvironment: boolean;
    approvalEnvironmentName: string;
    authMechanism: string;
    dependsOnTargets: string[];
  }>;
  supportedOutputs: Array<{
    pathPattern: string;
    managedBy: "packnpub-template" | "packnpub-state";
    mode: "0644" | "0755";
    conflictPolicy: "halt-with-diff" | "never-overwrite";
  }>;
  pinnedActions: Record<string, { sha: string; versionComment: string }>;
  checks: ContractCheckDef[];
  gateSemantics: {
    passRule: string;
    failRule: string;
    holdRule: string;
    publishAuthorization: string;
    exitCodes: { PASS: number; FAIL: number; HOLD: number; USAGE_ERROR: number };
  };
  threatModel: Array<{ id: string; threat: string; mitigation: string; verification: string }>;
  compatibility: {
    minimumNodeVersion: string;
    migratesFrom: string[];
    breakingChangePolicy: string;
  };
}

export function loadContract(): PacknPubContract {
  const file = path.join(CONTRACTS_DIR, "packnpub.contract.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as PacknPubContract;
  const errors = validateContract(parsed);
  if (errors.length) {
    throw new Error(`Invalid PacknPub contract (${file}): ${errors.join("; ")}`);
  }
  return parsed;
}

export function validateContract(contract: unknown): string[] {
  const errors: string[] = [];
  if (!contract || typeof contract !== "object") return ["contract must be a JSON object"];
  const c = contract as Partial<PacknPubContract>;
  const semverRe = /^[0-9]+\.[0-9]+\.[0-9]+$/;
  if (!c.contractVersion || !semverRe.test(c.contractVersion)) errors.push("invalid contractVersion");
  if (!c.templateVersion || !semverRe.test(c.templateVersion)) errors.push("invalid templateVersion");
  if (!Array.isArray(c.supportedEcosystems) || c.supportedEcosystems.length === 0) errors.push("supportedEcosystems required");
  if (!Array.isArray(c.supportedTargets) || c.supportedTargets.length === 0) errors.push("supportedTargets required");
  if (!Array.isArray(c.checks) || c.checks.length === 0) errors.push("checks required");
  if (!c.pinnedActions || typeof c.pinnedActions !== "object") {
    errors.push("pinnedActions required");
  } else {
    for (const [action, pin] of Object.entries(c.pinnedActions)) {
      if (!pin?.sha || !/^[0-9a-f]{40}$/.test(pin.sha)) {
        errors.push(`pinned action ${action} must use a 40-char lowercase hex commit SHA`);
      }
    }
  }
  if (!c.gateSemantics?.exitCodes) errors.push("gateSemantics.exitCodes required");
  return errors;
}

export function findNonGoal(target: string): NonGoal | undefined {
  const contract = loadContract();
  return contract.nonGoals.find((g) => g.id.toLowerCase() === target.toLowerCase());
}
