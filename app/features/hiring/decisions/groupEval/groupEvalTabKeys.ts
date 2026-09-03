// The per-candidate tablist's keyboard movement rule, as a pure function.
//
// Same idiom (and the same arithmetic) as app/features/library/jobs/
// jobsPostingModalTabs.ts, for the same reason: the strip owned the tab ROLES
// but none of the APG keyboard contract, so every tab was its own tab stop and a
// keyboard user walked through eight candidates' tabs — and the advance/reject
// buttons behind each — to reach the last one. With a roving tabindex the strip
// is ONE stop and the arrows move within it.
//
// Kept here rather than shared with the jobs copy: that file's note states the
// promote-on-third-caller rule, and the third caller is this one — but the shared
// home would be app/_components/ui/, outside this lot's write set. Promoting the
// two into one helper is left as the follow-up the note already asks for.

/** The index a tablist key press should move focus + selection to, or null when
 *  the key is not ours (so the event keeps its default — Tab must still leave the
 *  strip, Escape must still reach the dialog). Wraps at both ends, per APG. */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  const wrap = (n: number) => ((n % count) + count) % count;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return wrap(index + 1);
    case "ArrowLeft":
    case "ArrowUp":
      return wrap(index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
