import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_FIELD_KEYS,
  CANONICAL_TASK_IDS,
  coerceQuestionnaire,
  coerceTasks,
  DEFAULT_ONBOARDING_TASKS,
  DEFAULT_QUESTIONNAIRE,
  ENTRY_QUESTIONNAIRE_FIELDS,
  ONBOARDING_PRESETS,
  onboardingProgress,
  type OnboardingTask,
} from "./onboarding.ts";
import { namespaceTranslator } from "./catalog-translator.ts";
import { LOCALES } from "@/i18n/locales.ts";

test("coerceTasks trims, drops blanks, de-dups ids, caps length", () => {
  const tasks = coerceTasks([
    { id: "a", label: "  First step  " },
    { label: "Auto slug from label!" },
    { id: "a", label: "Dup id step" }, // collides with first → re-keyed
    { label: "" }, // dropped (blank)
    { label: "   " }, // dropped (whitespace)
    "not an object", // dropped
  ]);
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].id, "a");
  assert.equal(tasks[0].label, "First step");
  assert.equal(tasks[1].id, "auto-slug-from-label"); // slugified
  assert.notEqual(tasks[2].id, "a"); // re-keyed off the collision
  // ids are unique
  assert.equal(new Set(tasks.map((t) => t.id)).size, 3);
});

test("coerceTasks tolerates non-array input", () => {
  assert.deepEqual(coerceTasks(null), []);
  assert.deepEqual(coerceTasks("nope"), []);
  assert.deepEqual(coerceTasks({}), []);
});

test("onboardingProgress counts done over template tasks (sparse states)", () => {
  const tasks: OnboardingTask[] = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
    { id: "d", label: "D" },
  ];
  const p = onboardingProgress(tasks, [
    { taskId: "a", done: true, doneAt: "x" },
    { taskId: "b", done: false, doneAt: null },
    { taskId: "c", done: true, doneAt: "x" },
    // d has no state → not done
    { taskId: "ghost", done: true, doneAt: "x" }, // a state for a removed task → ignored
  ]);
  assert.equal(p.total, 4);
  assert.equal(p.done, 2); // a + c
  assert.equal(p.pct, 50);
  assert.equal(p.complete, false);
});

test("onboardingProgress is complete only when every task is done", () => {
  const tasks: OnboardingTask[] = [{ id: "a", label: "A" }];
  assert.equal(onboardingProgress(tasks, [{ taskId: "a", done: true, doneAt: "x" }]).complete, true);
  // empty template never reads as complete, and never divides by zero
  assert.deepEqual(onboardingProgress([], []), { done: 0, total: 0, pct: 0, complete: false });
});

// --- P1-4: editable questionnaire + industry presets ---

test("coerceQuestionnaire derives keys, de-dups, drops blanks, tolerates junk", () => {
  const q = coerceQuestionnaire([
    { key: "preferredName", label: "Preferred name" },
    { label: "License number" }, // key derived → licenseNumber
    { label: "License number" }, // dup label → key re-keyed unique
    { label: "" }, // dropped
    "nope", // dropped
  ]);
  assert.equal(q.length, 3);
  assert.equal(q[0].key, "preferredName");
  assert.equal(q[1].key, "licenseNumber");
  assert.notEqual(q[2].key, q[1].key); // unique
  assert.equal(new Set(q.map((f) => f.key)).size, q.length);
  assert.deepEqual(coerceQuestionnaire(null), []);
});

test("ENTRY_QUESTIONNAIRE_FIELDS mirrors the default questionnaire keys", () => {
  assert.deepEqual(ENTRY_QUESTIONNAIRE_FIELDS, DEFAULT_QUESTIONNAIRE.map((f) => f.key));
});

test("every onboarding preset is well-formed and non-tech-inclusive", () => {
  const ids = new Set(ONBOARDING_PRESETS.map((p) => p.id));
  // The cohort's gaps are represented (not just generic-office).
  for (const id of ["general", "healthcare_clinical", "skilled_trades", "tech_startup", "frontline_service"]) {
    assert.ok(ids.has(id), `missing preset ${id}`);
  }
  for (const p of ONBOARDING_PRESETS) {
    assert.ok(p.name && p.industry, `${p.id} needs a name + industry`);
    // tasks survive the same coercion the store applies, and there's at least one.
    assert.ok(coerceTasks(p.tasks).length >= 1, `${p.id} needs >=1 task`);
    const q = coerceQuestionnaire(p.questionnaire);
    assert.equal(q.length, p.questionnaire.length, `${p.id} questionnaire must be coercion-clean`);
    assert.equal(new Set(q.map((f) => f.key)).size, q.length, `${p.id} questionnaire keys must be unique`);
  }
});

test("F16 — every canonical task id / field key resolves in all four locales", async () => {
  // The presets are stored as a REFERENCE and rendered at read time (see the header
  // of onboarding.ts), so a preset row with no catalog entry would reach a new hire
  // in English no matter what language they opened the link in. This is the gate on
  // that: add a preset task, add its message.
  for (const locale of LOCALES) {
    const t = await namespaceTranslator(locale, "onboarding");
    for (const id of CANONICAL_TASK_IDS) assert.ok(t.has(`task.${id}`), `${locale}: onboarding.task.${id}`);
    for (const key of CANONICAL_FIELD_KEYS) assert.ok(t.has(`field.${key}`), `${locale}: onboarding.field.${key}`);
    for (const p of ONBOARDING_PRESETS) {
      assert.ok(t.has(`preset.${p.id}.name`), `${locale}: onboarding.preset.${p.id}.name`);
      assert.ok(t.has(`preset.${p.id}.industry`), `${locale}: onboarding.preset.${p.id}.industry`);
    }
    // The hire-facing page reads its own namespace — a field the recruiter can see
    // localized but the new hire cannot is the exact failure F16 is about.
    const c = await namespaceTranslator(locale, "candidateOnboarding");
    for (const key of CANONICAL_FIELD_KEYS) {
      const flat = `field${key[0].toUpperCase()}${key.slice(1)}`;
      assert.ok(c.has(flat), `${locale}: candidateOnboarding.${flat}`);
    }
  }
});

test("F16 — a task id is shared across presets only when the sentence is identical", () => {
  // The id doubles as the catalog key, so two presets meaning different things under
  // one id would make one of them render the other's wording.
  const byId = new Map<string, Set<string>>();
  for (const task of [...DEFAULT_ONBOARDING_TASKS, ...ONBOARDING_PRESETS.flatMap((p) => p.tasks)]) {
    if (!byId.has(task.id)) byId.set(task.id, new Set());
    byId.get(task.id)!.add(task.label);
  }
  for (const [id, labels] of byId) assert.equal(labels.size, 1, `task id "${id}" carries ${labels.size} different labels`);

  const byKey = new Map<string, Set<string>>();
  for (const f of [...DEFAULT_QUESTIONNAIRE, ...ONBOARDING_PRESETS.flatMap((p) => p.questionnaire)]) {
    if (!byKey.has(f.key)) byKey.set(f.key, new Set());
    byKey.get(f.key)!.add(f.label);
  }
  for (const [key, labels] of byKey) assert.equal(labels.size, 1, `field key "${key}" carries ${labels.size} different labels`);
});

