/**
 * Parse dependency keywords from a GitHub issue body.
 *
 * Supported patterns (case-insensitive):
 *   - "depends on #42"
 *   - "blocked by #42"
 *   - "requires #42"
 *   - "after #42"
 *
 * Only returns issue numbers that exist in the provided releaseIssueNumbers set,
 * so the graph stays scoped to the selected release.
 */
export function parseDependencies(
  body: string,
  releaseIssueNumbers: Set<number>
): number[] {
  const pattern = /(?:depends on|blocked by|requires|after)\s+#(\d+)/gi;
  const deps: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    const num = parseInt(match[1], 10);
    if (releaseIssueNumbers.has(num) && !deps.includes(num)) {
      deps.push(num);
    }
  }

  return deps;
}
