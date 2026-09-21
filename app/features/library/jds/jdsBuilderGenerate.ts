// Pure generate-success helpers for JdsBuilder. The POST returns `{ slug, taskId }`
// and the client used to throw both away: a 4s "queued" chip, then the recruiter
// sits on the authoring tab while the JD appears as Analyzing on another sidebar
// item. The slug is the one object the 1-2 minute paid run is producing.

export function readGenerateSlug(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const slug = (payload as { slug?: unknown }).slug;
  if (typeof slug !== "string") return null;
  const trimmed = slug.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Library-row deep link. HistoryTable already uses `?tab=library&jd=`. */
export function generateSuccessHref(slug: string | null): string {
  if (!slug) return "/?tab=library";
  return `/?tab=library&jd=${encodeURIComponent(slug)}`;
}
