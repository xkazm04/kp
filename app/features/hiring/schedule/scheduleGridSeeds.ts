// WHERE A GRID CHIP'S TIME CAME FROM — the pure half of useScheduleTab's seeding.
//
// The Schedule grid seeds each candidate's cell from three sources of very
// different authority: the invite engine's canonical `slotAt` (a real, booked
// instant), the legacy free-text `approvalDetail` on the pipeline entry, and —
// when neither exists — a flat "Tue 14:00" guess. All three rendered identically,
// so a slot nobody has agreed to looked exactly like one a candidate confirmed
// through their own link. The recruiter could not tell which chips were facts.
//
// Extracted from the hook so the classification is testable without a renderer:
// the provenance is the product decision, not the plumbing around it.

/** How a grid cell's time was arrived at. `booked` is the only one backed by a
 *  confirmed invite; the other two are guesses the recruiter should be able to see
 *  as guesses. */
export type SlotSource = "booked" | "legacy" | "guess";

export interface SeedInput {
  /** Pipeline entry id. */
  id: string;
  /** The dated slot ("YYYY-MM-DD HH:MM") derived from a CONFIRMED invite, if any. */
  fromInvite: string | null;
  /** The dated slot derived from the entry's legacy free-text detail, if any. */
  fromLegacy: string | null;
  /** The last-resort default cell — never null, so every entry lands somewhere. */
  fallback: string;
}

export interface SeededSlot {
  slot: string;
  source: SlotSource;
}

/** Resolve one entry's cell and say where it came from. Order matches the product
 *  rule: the engine wins over the legacy string, which wins over the guess. */
export function seedSlot(input: SeedInput): SeededSlot {
  if (input.fromInvite) return { slot: input.fromInvite, source: "booked" };
  if (input.fromLegacy) return { slot: input.fromLegacy, source: "legacy" };
  return { slot: input.fallback, source: "guess" };
}

/** The two records the grid renders from: id → slot, and id → provenance. Built in
 *  one pass so they cannot drift apart. */
export function seedGrid(inputs: readonly SeedInput[]): {
  picks: Record<string, string>;
  sources: Record<string, SlotSource>;
} {
  const picks: Record<string, string> = {};
  const sources: Record<string, SlotSource> = {};
  for (const input of inputs) {
    const seeded = seedSlot(input);
    picks[input.id] = seeded.slot;
    sources[input.id] = seeded.source;
  }
  return { picks, sources };
}

/** Is this cell a statement of fact (a confirmed booking) or a suggestion? The UI
 *  asks exactly this question, so it is asked in ONE place. */
export function isSuggested(source: SlotSource | undefined): boolean {
  return source !== "booked";
}
