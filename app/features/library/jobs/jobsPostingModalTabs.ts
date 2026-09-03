// The job posting modal's tab vocabulary.
//
// Literal array → derived union → runtime guard, the repo's closed-vocabulary
// shape (cf. app/features/shell/tabs.ts, i18n/locales.ts): the ids exist ONCE,
// the union is derived from them, and the strip renders by mapping the array so
// a new tab can never be added to the markup without the type following.
//
// The keyboard movement that used to live here has been promoted, as this note
// asked: the third caller appeared, and `useTablist` (app/_components/ui/
// useTablist.ts) now owns the roving tabindex, the arrow arithmetic and the
// aria wiring for every tablist in the app. This file is the VOCABULARY only.

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
