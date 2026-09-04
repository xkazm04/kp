// The pure half of useUrlInboxState — the URL-as-a-one-shot-inbox rules, with no
// React and no router in them, so each can be pinned by a plain assertion.
//
// The hook's three decisions all used to be inline in a render body and an
// effect, where the only way to check them was to reason about the code:
//
//   1. what the FIRST frame renders when a param is already in the URL,
//   2. when an incoming param counts as an ARRIVAL (once per appearance, not
//      once per render, and never when the value cannot be parsed),
//   3. when the inbox is emptied.
//
// Rule (2) is the subtle one, and the one a test earns its keep on: an ABSENT
// param is never an arrival. The hook clears the param it just consumed, so
// treating absence as "the default arrived" would bounce every deep link back to
// the default a frame after it landed.

/** The value a COLD load renders on its first frame: an already-present param
 *  wins, anything unparseable falls back. No flash-and-correct. */
export function initialInboxValue<T extends string>(
  incoming: string | null,
  parse: (raw: string | null) => T | null,
  fallback: T
): T {
  return parse(incoming) ?? fallback;
}

/** One render's verdict on the param, given what the last render saw.
 *
 *  `isArrival` is "this param changed", which is what makes the adoption fire
 *  once per appearance; `value` is what the state should hold afterwards — the
 *  parsed arrival, or the current value when the arrival is absent or junk (a
 *  deep link with a typo must not knock the reader back to the default). */
export function arrivalAdoption<T extends string>(
  incoming: string | null,
  seen: string | null,
  parse: (raw: string | null) => T | null,
  current: T
): { isArrival: boolean; value: T } {
  if (incoming === seen) return { isArrival: false, value: current };
  const parsed = parse(incoming);
  return { isArrival: true, value: parsed ?? current };
}

/** Does the inbox need emptying this commit? Any PRESENT param does, including
 *  an unparseable one: leaving `?tab=nonsense` in the bar would make a later
 *  valid link to the same key look like a no-op, and the reader has no use for
 *  it either way. Absence is already empty. */
export function shouldEmptyInbox(incoming: string | null): boolean {
  return incoming != null;
}
