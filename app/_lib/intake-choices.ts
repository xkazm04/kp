// DECISION CARDS — the intake agent's structured offer.
//
// ── When the agent is allowed to offer choices (the thought process) ────────
//
// The persona's whole posture is "propose and let them correct you"
// (_PERSONA_CORE in pipeline/jobfit/intake.py). An open question asks the
// requestor to PRODUCE vocabulary; a choice offers vocabulary they can react
// to. Reaction is cheaper than production, and cheaper is not always better —
// it is better in exactly two situations, and worse everywhere else, because a
// menu asked too early anchors the requestor onto our words and the session
// stops being an intake and becomes a form.
//
// So there are two, and only two, triggers:
//
//   confirm — the agent has INFERRED something load-bearing that the requestor
//             never said. Today that inference lands silently in the brief as
//             provenance `inferred` and the requestor has to notice it in the
//             panel and go edit it. A confirm card puts the reading on the
//             table as the turn's one question: "I've been treating this as X"
//             — pick, and it becomes `stated`; ignore it and type instead, and
//             it stays an assumption honestly labelled as one.
//
//   propose — a part of the brief the requestor has STALLED on. Not "has not
//             answered yet" — stalled: they said they don't know, or answered
//             the slot vaguely once already. The agent then puts 2–4 concrete,
//             DISPOSABLE shapes for that part on the table, each with what it
//             would cost. This is technique rule (7) — the this-or-that
//             contrast after an open question stalls — widened from two spoken
//             options to a small set the requestor can actually compare.
//
// Everything else stays an open question. In particular a choice is never the
// FIRST thing said about a topic, never a way to skip the laddering, and never
// the read-back (a read-back invites one open correction by design).
//
// ── What keeps it a conversation ───────────────────────────────────────────
//
//  · One card set per turn, at most 4 options. The set IS the turn's one
//    question (technique rule 1), not an extra widget beside one.
//  · The composer stays live and every set is escapable — "none of these" is
//    typing, which is the same act as before the cards existed. A choice the
//    requestor cannot refuse is a form field.
//  · Picking SENDS A NORMAL MESSAGE. The selected labels become the requestor's
//    words in the transcript, so the engine, the extraction, the voice thread,
//    the evals and the read-back all see the conversation they already
//    understand — and the value lands as `stated`, because they did say it.
//    That is the whole integration: a card is a composer affordance, not a new
//    kind of turn.
//  · `multi` follows the underlying field: a list-valued part (dealbreakers,
//    90-day outcomes) can take several; an either/or (seniority, role shape)
//    takes one.
//
// This module is the wire contract + its clamps. The offer itself is authored
// by the engine (pipeline/jobfit/intake.py) and, keyless, by its scripted path.

export type IntakeChoiceKind = "confirm" | "propose";

export type IntakeChoiceOption = {
  id: string;
  label: string;
  /** One line of consequence — what picking this makes true. Optional, because
   *  a confirm card's options are usually self-evident. */
  detail?: string;
};

export type IntakeChoiceSet = {
  kind: IntakeChoiceKind;
  /** The part of the brief this shapes (`seniority`, `role_shape`, `musts`…).
   *  A LABEL for the reader and a key for telemetry — never a writer: nothing
   *  in this app maps a choice straight into a brief field, because the answer
   *  goes back through the engine as a message like any other. */
  field: string;
  /** The one question the cards answer, in the requestor's language. */
  prompt: string;
  multi: boolean;
  options: IntakeChoiceOption[];
};

// Clamps, not suggestions: this payload is authored by a model, and a card set
// with nine options or a 900-character label is a broken turn, not a rich one.
export const MAX_CHOICE_OPTIONS = 4;
export const MIN_CHOICE_OPTIONS = 2;
const MAX_PROMPT_CHARS = 200;
const MAX_LABEL_CHARS = 90;
const MAX_DETAIL_CHARS = 180;
const MAX_FIELD_CHARS = 40;

function text(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function coerceOption(raw: unknown, index: number): IntakeChoiceOption | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = text(o.label, MAX_LABEL_CHARS);
  if (!label) return null;
  const detail = text(o.detail, MAX_DETAIL_CHARS);
  const id = text(o.id, MAX_FIELD_CHARS) || `o${index}`;
  return { id, label, ...(detail ? { detail } : {}) };
}

/** Parse an engine-authored choice set. Returns null for anything that would
 *  render as a broken offer — a set with one option is not a choice, and a turn
 *  with no usable cards is better off as the plain question it already carries
 *  than as an empty card rail. */
export function coerceIntakeChoiceSet(raw: unknown): IntakeChoiceSet | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const prompt = text(c.prompt, MAX_PROMPT_CHARS);
  if (!prompt) return null;
  const list = Array.isArray(c.options) ? c.options : [];
  const seen = new Set<string>();
  const options: IntakeChoiceOption[] = [];
  for (const [i, item] of list.entries()) {
    const option = coerceOption(item, i);
    // Two cards saying the same thing is a worse offer than one; and duplicate
    // ids would make a selection ambiguous.
    if (!option || seen.has(option.id) || seen.has(option.label.toLowerCase())) continue;
    seen.add(option.id);
    seen.add(option.label.toLowerCase());
    options.push(option);
    if (options.length === MAX_CHOICE_OPTIONS) break;
  }
  if (options.length < MIN_CHOICE_OPTIONS) return null;
  return {
    kind: c.kind === "confirm" ? "confirm" : "propose",
    field: text(c.field, MAX_FIELD_CHARS) || "role",
    prompt,
    multi: c.multi === true,
    options,
  };
}

/** The message a selection sends — the requestor's own words for the
 *  transcript. Selection order is ignored in favour of the OFFER's order, so
 *  the sentence reads the way the cards read. */
export function choiceMessage(set: IntakeChoiceSet, selected: readonly string[]): string {
  const picked = set.options.filter((o) => selected.includes(o.id));
  if (picked.length === 0) return "";
  if (!set.multi) return picked[0].label;
  return picked.map((o) => o.label).join("; ");
}

/** Toggle under the set's own arity — single-select replaces, multi adds. */
export function toggleChoice(set: IntakeChoiceSet, selected: readonly string[], id: string): string[] {
  if (!set.options.some((o) => o.id === id)) return [...selected];
  if (!set.multi) return selected.includes(id) ? [] : [id];
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}
