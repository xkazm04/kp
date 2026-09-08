// The decision-card wire contract. Every clamp here exists because the payload
// is AUTHORED BY A MODEL: the failure mode is not a missing field, it is a
// plausible-looking set that renders as nine cards, or as one (which is not a
// choice), or with two cards saying the same thing.

import test from "node:test";
import assert from "node:assert/strict";
import {
  choiceMessage,
  coerceIntakeChoiceSet,
  toggleChoice,
  MAX_CHOICE_OPTIONS,
  type IntakeChoiceSet,
} from "./intake-choices.ts";

const set = (over: Partial<IntakeChoiceSet> = {}): IntakeChoiceSet => ({
  kind: "propose",
  field: "seniority",
  prompt: "Which level feels right?",
  multi: false,
  options: [
    { id: "medior", label: "Medior" },
    { id: "senior", label: "Senior", detail: "Owns the migration end to end." },
  ],
  ...over,
});

test("a well-formed offer survives intact", () => {
  const parsed = coerceIntakeChoiceSet(set({ kind: "confirm" }));
  assert.equal(parsed?.kind, "confirm");
  assert.equal(parsed?.options.length, 2);
  assert.equal(parsed?.options[1].detail, "Owns the migration end to end.");
});

test("one option is not a choice", () => {
  assert.equal(coerceIntakeChoiceSet(set({ options: [{ id: "a", label: "Senior" }] })), null);
});

test("a set with no prompt is dropped — the turn keeps its own question", () => {
  assert.equal(coerceIntakeChoiceSet(set({ prompt: "" })), null);
  assert.equal(coerceIntakeChoiceSet(null), null);
  assert.equal(coerceIntakeChoiceSet("Senior or medior?"), null);
});

test("the option list is capped, not truncated silently into nonsense", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, label: `Option ${i}` }));
  const parsed = coerceIntakeChoiceSet(set({ options: many }));
  assert.equal(parsed?.options.length, MAX_CHOICE_OPTIONS);
  assert.deepEqual(
    parsed?.options.map((o) => o.id),
    ["o0", "o1", "o2", "o3"]
  );
});

test("two cards saying the same thing collapse to one", () => {
  const parsed = coerceIntakeChoiceSet(
    set({ options: [{ id: "a", label: "Senior" }, { id: "b", label: "senior" }, { id: "c", label: "Lead" }] })
  );
  assert.deepEqual(parsed?.options.map((o) => o.label), ["Senior", "Lead"]);
});

test("an option with no label is not a card", () => {
  const parsed = coerceIntakeChoiceSet(
    set({ options: [{ id: "a", label: "   " }, { id: "b", label: "Senior" }, { id: "c", label: "Lead" }] })
  );
  assert.deepEqual(parsed?.options.map((o) => o.id), ["b", "c"]);
});

test("an unnamed option still gets an id, so a selection is never ambiguous", () => {
  const parsed = coerceIntakeChoiceSet({ ...set(), options: [{ label: "Senior" }, { label: "Lead" }] });
  assert.deepEqual(parsed?.options.map((o) => o.id), ["o0", "o1"]);
});

test("long model prose is clamped rather than blown up on screen", () => {
  const parsed = coerceIntakeChoiceSet(
    set({ prompt: "p".repeat(400), options: [{ id: "a", label: "L".repeat(400) }, { id: "b", label: "Lead" }] })
  );
  assert.equal(parsed?.prompt.length, 200);
  assert.equal(parsed?.options[0].label.length, 90);
});

test("multi is opt-in — an either/or never becomes a checklist by accident", () => {
  assert.equal(coerceIntakeChoiceSet(set({}))?.multi, false);
  assert.equal(coerceIntakeChoiceSet(set({ multi: "yes" as unknown as boolean }))?.multi, false);
  assert.equal(coerceIntakeChoiceSet(set({ multi: true }))?.multi, true);
});

test("an unknown kind falls back to propose, which is the weaker claim", () => {
  assert.equal(coerceIntakeChoiceSet(set({ kind: "interrogate" as unknown as "confirm" }))?.kind, "propose");
});

test("selecting sends the requestor's own words, in the offer's order", () => {
  const multi = set({ multi: true, options: [{ id: "a", label: "Kotlin" }, { id: "b", label: "Kafka" }, { id: "c", label: "Postgres" }] });
  assert.equal(choiceMessage(multi, ["c", "a"]), "Kotlin; Postgres");
  assert.equal(choiceMessage(set(), ["senior"]), "Senior");
  assert.equal(choiceMessage(set(), []), "");
});

test("single-select replaces, multi-select accumulates, and both can be undone", () => {
  const single = set();
  assert.deepEqual(toggleChoice(single, [], "senior"), ["senior"]);
  assert.deepEqual(toggleChoice(single, ["medior"], "senior"), ["senior"]);
  assert.deepEqual(toggleChoice(single, ["senior"], "senior"), []);
  const multi = set({ multi: true });
  assert.deepEqual(toggleChoice(multi, ["medior"], "senior"), ["medior", "senior"]);
  assert.deepEqual(toggleChoice(multi, ["medior", "senior"], "medior"), ["senior"]);
});

test("a card that is not in the offer cannot be selected", () => {
  assert.deepEqual(toggleChoice(set(), [], "principal"), []);
});
