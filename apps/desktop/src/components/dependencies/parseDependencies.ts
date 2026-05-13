/**
 * Parse dependency keywords from a GitHub issue body.
 *
 * Recognizes three reference patterns (all case-insensitive):
 *
 * 1. Inline strong dependencies — trigger word directly before `#N`:
 *    - "depends on #42"
 *    - "blocked by #42"
 *    - "requires #42"
 *    - "after #42"
 *
 * 2. Inline soft references — same shape, weaker semantics:
 *    - "related to #42"
 *    - "see also #42"
 *
 * 3. Section-based references — a markdown heading containing "related"
 *    (h1–h4), followed by a block of any formatting (lists, paragraphs, ...)
 *    where every `#N` reference up to the next heading is harvested:
 *    ```markdown
 *    ## Related
 *
 *    - #42 — context about the linked issue
 *    - #43
 *    ```
 *
 * All parsed numbers are deduplicated and then filtered to the
 * provided releaseIssueNumbers set, so the graph stays scoped to the
 * selected release. Cross-release references are dropped silently.
 *
 * No edge-type distinction between hard deps and soft refs in the
 * returned array — that's a future polish. For now both kinds become
 * regular graph edges.
 */
export function parseDependencies(
  body: string,
  releaseIssueNumbers: Set<number>
): number[] {
  const deps = new Set<number>();

  // 1+2. Inline patterns: trigger word + whitespace + #N.
  const inlinePattern =
    /(?:depends on|blocked by|requires|after|related to|see also)\s+#(\d+)/gi;
  for (const match of body.matchAll(inlinePattern)) {
    deps.add(parseInt(match[1], 10));
  }

  // 3. Section-based: a markdown heading whose text contains "related" (any
  //    level, any trailing text), then everything up to the next heading or
  //    end of body. Inside that block, harvest every #N reference.
  const sectionPattern =
    /(?:^|\n)#{1,4}\s*[^\n]*related[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/gi;
  for (const match of body.matchAll(sectionPattern)) {
    const sectionBody = match[1];
    for (const refMatch of sectionBody.matchAll(/#(\d+)/g)) {
      deps.add(parseInt(refMatch[1], 10));
    }
  }

  // Filter to release-scoped references; preserve insertion order.
  return [...deps].filter((num) => releaseIssueNumbers.has(num));
}
