// Attach-a-saved-JD picker: GET /api/jds is a store read, and a 500 used to
// collapse to `[]` so the pane looked like an empty library. Same seam as
// fetchTemplates — empty list vs load failed are different facts.

export type IntakeJdOption = { slug: string; title: string };

export type IntakeJdPickerResult =
  | { jds: IntakeJdOption[]; failed: null }
  | { jds: null; failed: { code: "JD_LIST_FAILED" } };

export function intakeJdPickerFromResponse(ok: boolean, payload: unknown): IntakeJdPickerResult {
  if (!ok) return { jds: null, failed: { code: "JD_LIST_FAILED" } };
  const rows = (payload as { jds?: unknown } | null | undefined)?.jds;
  if (!Array.isArray(rows)) return { jds: null, failed: { code: "JD_LIST_FAILED" } };
  const jds: IntakeJdOption[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const slug = (row as { slug?: unknown }).slug;
    if (typeof slug !== "string" || !slug) continue;
    const title = (row as { title?: unknown }).title;
    jds.push({ slug, title: typeof title === "string" && title ? title : slug });
  }
  return { jds, failed: null };
}
