/*
 * Shared choreography for the /about step illustrations.
 *
 * Every step art replays when it re-enters the viewport (`once: false`), so
 * scrolling the page up and down keeps it alive. These two constants were
 * duplicated into each of the seven illustrations back when they all lived in
 * one 416-line file.
 */
export const ENTER = { once: false, amount: 0.5 } as const;
export const DRAW = { duration: 1, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

export type AboutStepKey = "design" | "source" | "intake" | "screen" | "interview" | "offer" | "hired";
