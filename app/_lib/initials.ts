// Single source for avatar / logo monograms across the app: candidate avatars
// (PipelineShared, CandidateDrawer, DecisionsShared, GroupEvalModal), the
// schedule grid (ScheduleCalendar), and the offer page's company logo slot.
// Six near-identical copies had quietly drifted — some split on a single " ",
// others on /\s+/; the fallback was "?" in one place, "•" in another, and
// nothing in the rest. This reconciles them into one explicit behavior: trim,
// split on any run of whitespace, take the first letter of the first two words,
// uppercase; when there is nothing to show, return the caller's `fallback`
// (default empty string).
export function initials(label: string | null | undefined, fallback = ""): string {
  return (
    (label ?? "")
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || fallback
  );
}
