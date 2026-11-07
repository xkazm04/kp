// The Stage's declared grid: three slots, each a SPAN in reading order, never a
// coordinate (registry composition-region §2). The session reducer owns WHICH views are
// on screen; this module owns WHERE each one sits, so a view keeps its slot across
// turns, a close frees a slot without sliding its neighbours, and Undo puts a restored
// view back in the slot it last held.
//
// Pure and import-free so node:test reads it directly.

export const STAGE_SLOTS = [
  /** The lead slot: the widest span, where the first view lands. */
  { name: "A", span: "lead" },
  { name: "B", span: "side" },
  { name: "C", span: "side" },
] as const;
export type SlotSpan = (typeof STAGE_SLOTS)[number]["span"];

/** id → slot index for every view ever placed; it only grows, so a restored id finds
 *  its old slot again. */
export type SlotMemory = Readonly<Record<string, number>>;

export type SlotPlan = {
  /** The view sitting in each slot, by slot index; null = a free slot. */
  bySlot: (string | null)[];
  memory: SlotMemory;
};

/**
 * Seat the views. A view that held a slot before gets it back if it is free; every other
 * view takes the lowest free slot, in the reducer's order. When the reducer replaced the
 * oldest unpinned view, that view's slot is the only free one — so the newcomer lands
 * exactly where the view it replaced was, and nothing else moves.
 */
export function assignSlots(memory: SlotMemory, ids: readonly string[]): SlotPlan {
  const bySlot: (string | null)[] = STAGE_SLOTS.map(() => null);
  const seated = new Set<string>();
  for (const id of ids) {
    const prev = memory[id];
    if (prev != null && prev >= 0 && prev < bySlot.length && bySlot[prev] === null) {
      bySlot[prev] = id;
      seated.add(id);
    }
  }
  for (const id of ids) {
    if (seated.has(id)) continue;
    const free = bySlot.indexOf(null);
    if (free < 0) break; // more views than slots: the reducer caps at MAX_PANELS, so unreachable
    bySlot[free] = id;
    seated.add(id);
  }
  const next: Record<string, number> = { ...memory };
  bySlot.forEach((id, i) => {
    if (id) next[id] = i;
  });
  return { bySlot, memory: next };
}
