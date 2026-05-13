/**
 * Parse dependency keywords from a GitHub issue body.
 *
 * Recognizes three reference patterns (all case-insensitive):
 *
 * 1. Inline strong dependencies (kind: 'hard') — trigger word directly
 *    before `#N`. Semantics: blocks merge; downstream cannot ship before:
 *    - "depends on #42"
 *    - "blocked by #42"
 *    - "requires #42"
 *    - "after #42"
 *
 * 2. Inline soft references (kind: 'soft') — same shape, weaker semantics.
 *    Semantics: same code area or contextually relevant, not blocking:
 *    - "related to #42"
 *    - "see also #42"
 *
 * 3. Section-based references (kind: 'soft') — a markdown heading
 *    containing "related" (h1–h4), followed by a block of any formatting
 *    where every `#N` reference up to the next heading is harvested:
 *    ```markdown
 *    ## Related
 *
 *    - #42 — context about the linked issue
 *    - #43
 *    ```
 *
 * If the same number appears with both kinds (e.g. "depends on #42" AND
 * a "## Related" section also lists #42), 'hard' wins — the stronger
 * claim takes precedence.
 *
 * All parsed numbers are then filtered to the provided releaseIssueNumbers
 * set, so the graph stays scoped to the selected release. Cross-release
 * references are dropped silently.
 */
export function parseDependencies(
  body: string,
  releaseIssueNumbers: Set<number>
): { number: number; kind: 'hard' | 'soft' }[] {
  const deps = new Map<number, 'hard' | 'soft'>();
  const record = (n: number, kind: 'hard' | 'soft') => {
    if (deps.get(n) === 'hard') return;
    deps.set(n, kind);
  };

  // 1. Hard inline triggers.
  for (const match of body.matchAll(
    /(?:depends on|blocked by|requires|after)\s+#(\d+)/gi
  )) {
    record(parseInt(match[1], 10), 'hard');
  }

  // 2. Soft inline triggers.
  for (const match of body.matchAll(/(?:related to|see also)\s+#(\d+)/gi)) {
    record(parseInt(match[1], 10), 'soft');
  }

  // 3. Section-based: a markdown heading whose text contains "related" (any
  //    level, any trailing text), then everything up to the next heading or
  //    end of body. Inside that block, harvest every #N reference as soft.
  const sectionPattern =
    /(?:^|\n)#{1,4}\s*[^\n]*related[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/gi;
  for (const match of body.matchAll(sectionPattern)) {
    const sectionBody = match[1];
    for (const refMatch of sectionBody.matchAll(/#(\d+)/g)) {
      record(parseInt(refMatch[1], 10), 'soft');
    }
  }

  return [...deps.entries()]
    .filter(([n]) => releaseIssueNumbers.has(n))
    .map(([number, kind]) => ({ number, kind }));
}
