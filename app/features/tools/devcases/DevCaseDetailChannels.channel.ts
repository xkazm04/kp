// Closed set of posting-channel ids the assignment detail chip localizes.
// Unknown values fall back to the raw store string (same has-guard as stage /
// probe-kind chips). The producer is distribution.ts ADAPTERS plus the ids
// createPosting actually stores (`link`, `email`); catalogs must cover all of them.

export const POSTING_CHANNELS = ["email", "link", "local"] as const;
export type PostingChannel = (typeof POSTING_CHANNELS)[number];

export function isPostingChannel(value: string): value is PostingChannel {
  return (POSTING_CHANNELS as readonly string[]).includes(value);
}
