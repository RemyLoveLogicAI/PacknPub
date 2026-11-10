import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface PackageJson {
  name?: string;
  version?: string;
  bin?: string | Record<string, string>;
  files?: string[];
  repository?: string | { type?: string; url?: string };
  scripts?: Record<string, string>;
  publishConfig?: Record<string, unknown>;
  exports?: unknown;
  [key: string]: unknown;
}

export interface Project {
  root: string;
  pkg: PackageJson;
  name: string;
  version: string;
  binName: string | undefined;
  binPath: string | undefined;
  owner: string | undefined;
  repo: string | undefined;
}

export function readPackageJson(root: string): PackageJson | undefined {
  const file = path.join(root, "package.json");
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
}

export function parseGitHubRemote(url: string): { owner: string; repo: string } | undefined {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

function gitRemote(root: string): string | undefined {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

function repositoryUrl(pkg: PackageJson): string | undefined {
  return typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
}

export function unscopedName(name: string): string {
  return name.split("/").pop() ?? name;
}

export function detectProject(root: string): Project | undefined {
  const pkg = readPackageJson(root);
  if (!pkg?.name) return undefined;
  const remote = gitRemote(root) ?? repositoryUrl(pkg);
  const gh = remote ? parseGitHubRemote(remote) : undefined;
  const [binName, binPath] =
    typeof pkg.bin === "string" ? [unscopedName(pkg.name), pkg.bin] : Object.entries(pkg.bin ?? {})[0] ?? [];
  return {
    root,
    pkg,
    name: pkg.name,
    version: pkg.version ?? "0.0.0",
    binName,
    binPath,
    owner: gh?.owner,
    repo: gh?.repo,
  };
}
