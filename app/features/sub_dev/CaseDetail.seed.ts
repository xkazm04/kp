// Seed-preview logic for CaseDetail, extracted as pure TS so it is unit-testable.
// The author needs to verify the CONCRETE starter file tree the candidate is handed
// (the apply page ships kase.seed.files via LiveWorkSurface) before publishing — not
// just the prose brief. This collapses each file's contents to a short preview.
// bug-ui-scan-2026-07-09 (dev-case-authoring-publishing #5).

/** First `maxLines` lines of a seed file's contents, with a "+N more" trailer when
 *  truncated. The candidate always gets the full file; the author preview just needs
 *  path + shape. */
export function seedPreview(contents: string, maxLines = 12): string {
  const lines = contents.split("\n");
  if (lines.length <= maxLines) return contents;
  const remaining = lines.length - maxLines;
  return `${lines.slice(0, maxLines).join("\n")}\n… +${remaining} more line${remaining === 1 ? "" : "s"}`;
}
