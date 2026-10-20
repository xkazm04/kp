/*
 * The stylised sample data the feature panels draw: invented people, figures,
 * clock times and a code listing. None of it is copy (nothing here is translated:
 * names are names, numbers are numbers, code is code), and none of it is real:
 * every panel is captioned "stylised illustration · sample data". Held as named
 * constants, never as JSX text, the same pattern as app/landing/spark/Wordmark.tsx.
 */
export const SAMPLE = {
  /** The human who signs every call on this page. */
  signer: "M. Horáková",
  jana: "Jana N.",
  petr: "Petr K.",
  alex: "Alex T.",
  /** The three candidates' tokens on the inbox's starting line. */
  tokens: [
    ["JN", "Jana N."],
    ["PK", "Petr K."],
    ["AT", "Alex T."]
  ],
  /** The card that travels round the features ring. */
  ringMark: "JN",
  /** Jana's job-fit score and its three sub-scores (skills, seniority, domain). */
  fit: 87,
  fitSubs: [92, 84, 61],
  /** Rank shown on the silver medallist's medal. */
  medallistRank: 2,
  /** The offer's figure. */
  offerAmount: "150k",
  offerCurrency: "CZK",
  /** Self-scheduling week: slot times (B/1's panel). */
  weekTimes: ["09:00", "10:30", "13:00", "15:30"],
  /** The work sample's code listing; line 5 carries the planted flaw. */
  code: [
    "function pageOf(items, n) {",
    "  const size = 10;",
    "  const from = n * size;",
    "  return items.slice(from,",
    "    from + size + 1);",
    "}"
  ],
  codeFlawLine: 4
} as const;
