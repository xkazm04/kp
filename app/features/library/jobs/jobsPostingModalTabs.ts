// The job posting modal's tab vocabulary + its keyboard movement rule.
//
// Literal array → derived union → runtime guard, the repo's closed-vocabulary
// shape (cf. app/features/shell/tabs.ts, i18n/locales.ts): the ids exist ONCE,
// the union is derived from them, and the strip renders by mapping the array so
// a new tab can never be added to the markup without the type following.
//
// `nextTabIndex` is SegmentedControl's `move` arithmetic (app/_components/
// SegmentedControl.tsx) as a pure function. The pattern is COPIED rather than
// shared: SegmentedControl's version is entangled with its radiogroup semantics
// (aria-checked, the off-taxonomy-value recovery, the layoutId indicator) and
// extracting a hook from it would mean editing a shared primitive from a jobs
// lot. Copying the arithmetic and pinning it here is the cheaper honest move —
// if a third caller appears, promote it to app/_components/ui/ then.

export const POSTING_TAB_IDS = [
  "posting",
  "coach",
  "campaign",
  "candidates",
  "rediscover",
  "compare",
  "agentfit",
] as const;

export type PostingTabId = (typeof POSTING_TAB_IDS)[number];

export function isPostingTabId(value: string): value is PostingTabId {
  return (POSTING_TAB_IDS as readonly string[]).includes(value);
}

/** The index a tablist key press should move focus + selection to, or null when
 *  the key is not ours (so the event keeps its default — Tab must still leave
 *  the strip, Escape must still reach the dialog). Wraps at both ends, per APG. */
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
