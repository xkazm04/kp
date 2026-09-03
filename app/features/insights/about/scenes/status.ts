/*
 * The status line's phase → text lookup.
 *
 * Lives apart from `shared.tsx` because it is the one piece of that file with
 * no React in it, and a pure function that six scenes depend on deserves a test
 * that does not need a DOM (`shared.tsx` is TSX, which the node test runner's
 * type stripping will not load). `shared.tsx` re-exports it, so scenes keep
 * importing from one place.
 */

/**
 * Build a phase → text lookup that HOLDS the last set value.
 *
 * Scenes declare status only on the beats where the wording should CHANGE,
 * which keeps the table readable as prose and means a re-timed scene doesn't
 * need every intermediate beat re-stated.
 *
 * Two rules that a naive implementation gets wrong, both load-bearing:
 *
 *   - An EMPTY STRING is a value, not a miss. A scene that writes `{ 6: "" }`
 *     is deliberately blanking the line for a beat — the pause before a verdict
 *     — and a truthiness test (`if (hit)`) walks straight past it and re-prints
 *     the previous sentence instead. The line's whole job is to say what the
 *     machine is doing *right now*, so a stale sentence is worse than silence.
 *   - A beat BEFORE the first declared one falls back to whatever beat 0 says,
 *     or to empty. Scenes are re-entered constantly and the clock rewinds to 0,
 *     so this is a real path, not a defensive branch.
 */
export function statusPicker(table: Record<number, string>): (phase: number) => string {
  const first = table[0] ?? "";
  return (phase: number) => {
    for (let p = Math.floor(phase); p >= 0; p--) {
      const hit = table[p];
      if (hit !== undefined) return hit;
    }
    return first;
  };
}
