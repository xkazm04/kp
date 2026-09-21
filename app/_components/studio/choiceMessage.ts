import { choiceMessage as libChoiceMessage, toggleChoice as libToggleChoice } from "@/app/_lib/intake-choices";
import type { StudioChoiceSet } from "@/app/_lib/jobseeker/types";

// The card→message shape, in the kit's vocabulary.
//
// A pick SENDS AN ORDINARY MESSAGE: the selected labels become the reader's own
// words in the transcript, so the engine, the extraction, the voice thread and
// the read-back all see the conversation they already understand. That rule and
// its clamps are `app/_lib/intake-choices.ts` (the wire contract the engine
// authors against); `StudioChoiceSet` is structurally that module's
// `IntakeChoiceSet`, so the kit delegates rather than carrying a second copy of
// a five-line function that must never drift from the first.

/** The message a selection sends — offer order, not selection order, so the
 *  sentence reads the way the cards read. */
export function choiceMessage(set: StudioChoiceSet, ids: string[]): string {
  return libChoiceMessage(set, ids);
}

/** Toggle under the set's own arity — single-select replaces, multi adds. */
export function toggleChoice(set: StudioChoiceSet, selected: readonly string[], id: string): string[] {
  return libToggleChoice(set, selected, id);
}
