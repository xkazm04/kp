// Onboarding hand-off — the pure, dependency-free core (tested under node --test).
// The DB store that uses these lives in onboarding-store.ts. Closes the lifecycle
// past Hired: a reusable checklist template runs per new hire, a pre-boarding entry
// questionnaire populates the hire record, and documents are signed through a
// provider SEAM (markSigned) — a real eIDAS provider (Signicat/DocuSign) wires in
// there; the in-app flow is an audit-stamped record, NOT itself eIDAS-compliant.

export type OnboardingTask = { id: string; label: string };
export type OnboardingTaskState = { taskId: string; done: boolean; doneAt: string | null };

// The default checklist a fresh tenant gets — the table-stakes new-hire steps every
// onboarding repeats. Editable per template once created (the store seeds this).
export const DEFAULT_ONBOARDING_TASKS: OnboardingTask[] = [
  { id: "contract", label: "Send & sign the employment contract" },
  { id: "documents", label: "Collect ID, tax and bank details" },
  { id: "equipment", label: "Order laptop and equipment" },
  { id: "accounts", label: "Create email and system accounts" },
  { id: "buddy", label: "Assign an onboarding buddy" },
  { id: "firstday", label: "Share the first-day plan and agenda" },
  { id: "intro", label: "Schedule the team intro meeting" },
];

// The pre-boarding entry questionnaire fields the new hire fills before day one;
// the answers populate their hire record. Kept deliberately small + non-sensitive.
export const ENTRY_QUESTIONNAIRE_FIELDS = [
  "preferredName",
  "tshirtSize",
  "dietaryNeeds",
  "equipmentPrefs",
  "emergencyContact",
  "startDateConfirm",
] as const;
export type EntryQuestionnaireField = (typeof ENTRY_QUESTIONNAIRE_FIELDS)[number];

const MAX_TASKS = 40;
const MAX_LABEL = 200;

/** Validate + bound a tasks array coming from a template create/edit (trust
 *  boundary): trims, drops blank/oversize labels, de-dups ids, caps the count.
 *  Returns a clean OnboardingTask[] (possibly empty). Never throws. */
export function coerceTasks(input: unknown): OnboardingTask[] {
  if (!Array.isArray(input)) return [];
  const out: OnboardingTask[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (out.length >= MAX_TASKS) break;
    const r = raw as { id?: unknown; label?: unknown };
    const label = typeof r?.label === "string" ? r.label.trim().slice(0, MAX_LABEL) : "";
    if (!label) continue;
    let id = typeof r?.id === "string" && r.id.trim() ? r.id.trim().slice(0, 64) : slugifyTask(label);
    if (!id || seen.has(id)) id = `${id || "task"}-${out.length}`;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

function slugifyTask(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export type OnboardingProgress = { done: number; total: number; pct: number; complete: boolean };

/** Completion rollup for a run: how many of the template's tasks are done. The
 *  states list may be sparse (only touched tasks have a row) — a task with no
 *  state counts as not-done. pct is 0 when there are no tasks (avoids /0). */
export function onboardingProgress(tasks: OnboardingTask[], states: OnboardingTaskState[]): OnboardingProgress {
  const doneIds = new Set(states.filter((s) => s.done).map((s) => s.taskId));
  const total = tasks.length;
  const done = tasks.filter((t) => doneIds.has(t.id)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct, complete: total > 0 && done === total };
}
