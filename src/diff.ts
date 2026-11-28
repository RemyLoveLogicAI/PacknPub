/** Produces a compact, deterministic unified diff without external dependencies. */
export function unifiedDiff(relPath: string, before: string | undefined, after: string): string {
  const oldLines = before === undefined ? [] : before.replace(/\r\n/g, "\n").split("\n");
  const newLines = after.replace(/\r\n/g, "\n").split("\n");

  if (before === after) return "";

  const header = [`--- ${before === undefined ? "/dev/null" : `a/${relPath}`}`, `+++ b/${relPath}`];

  // Find common prefix and suffix to keep diffs focused and readable.
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const ctxStart = Math.max(0, start - 2);
  const oldCtxEnd = Math.min(oldLines.length - 1, oldEnd + 2);
  const newCtxEnd = Math.min(newLines.length - 1, newEnd + 2);

  const oldCount = oldCtxEnd >= ctxStart ? oldCtxEnd - ctxStart + 1 : 0;
  const newCount = newCtxEnd >= ctxStart ? newCtxEnd - ctxStart + 1 : 0;

  const hunk: string[] = [`@@ -${ctxStart + 1},${oldCount} +${ctxStart + 1},${newCount} @@`];
  for (let i = ctxStart; i < start; i++) hunk.push(` ${oldLines[i]}`);
  for (let i = start; i <= oldEnd; i++) hunk.push(`-${oldLines[i]}`);
  for (let i = start; i <= newEnd; i++) hunk.push(`+${newLines[i]}`);
  for (let i = oldEnd + 1; i <= oldCtxEnd; i++) hunk.push(` ${oldLines[i]}`);

  return [...header, ...hunk].join("\n");
}
