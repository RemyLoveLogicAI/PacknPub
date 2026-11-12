import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TARGETS = ["npm", "github-release", "github-packages", "homebrew"] as const;
export type Target = (typeof TARGETS)[number];

export const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

export function readTemplate(relative: string): string {
  return readFileSync(path.join(TEMPLATES_DIR, relative), "utf8").replace(/\r\n/g, "\n");
}

const BLOCK = /^[ \t]*# >>> ([\w-]+)\n([\s\S]*?)^[ \t]*# <<< \1\n/gm;

/** Fills `{{KEY}}` placeholders and keeps `# >>> target` ... `# <<< target` blocks only for enabled targets. */
export function render(template: string, vars: Record<string, string>, enabled: readonly string[] = []): string {
  let withBlocks = template;
  for (let previous = ""; previous !== withBlocks; ) {
    previous = withBlocks;
    withBlocks = withBlocks.replace(BLOCK, (_, name: string, body: string) => (enabled.includes(name) ? body : ""));
  }
  return withBlocks.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (!(key in vars)) throw new Error(`template variable ${key} has no value`);
    return vars[key];
  });
}

export function formulaClassName(binName: string): string {
  return binName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}
