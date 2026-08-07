// Onboarding hand-off — the pure, dependency-free core (tested under node --test).
// The DB store that uses these lives in onboarding-store.ts. Closes the lifecycle
// past Hired: a reusable checklist template runs per new hire, a pre-boarding entry
// questionnaire populates the hire record, and documents are signed through a
// provider SEAM (markSigned) — a real eIDAS provider (Signicat/DocuSign) wires in
// there; the in-app flow is an audit-stamped record, NOT itself eIDAS-compliant.
//
// ─────────────────────────────────────────────────────────────────────────────
// F16 — WHOSE LANGUAGE ARE THE PRESETS IN? A LANGUAGE-NEUTRAL KEY, RENDERED AT
// READ TIME. Not the creating recruiter's language, not the new hire's.
//
// The strings below are COPIED INTO A DB ROW at template-creation time
// (onboarding-store.createTemplate → tasks_json / questionnaire_json), and that row
// then has three different readers, none of whom shares a locale by construction:
//   · the recruiter who made it            (OnboardingRunChecklist, run detail)
//   · any colleague in the same workspace  (templates are workspace-scoped —
//     listTemplates(workspaceId), not per-user)
//   · the NEW HIRE, on a public token page (app/onboarding/[token]) whose locale is
//     their own browser's, months later
// Materializing the preset in whichever language happened to be active when someone
// pressed "Save template" would pin all three to that one language forever. This is
// the third case in docs/architecture/localization.md — a string composed on the
// server ahead of its readers — and the settled answer there is "store a reference,
// not a sentence".
//
// The reference is the `id` / `key` these presets already carry. Every shipped task
// id and field key has a catalog entry (`onboarding.task.<id>`,
// `onboarding.field.<key>`, and `candidateOnboarding.field<Key>` on the hire-facing
// page); the render sites resolve it and FALL BACK to the stored label. That is not
// a new mechanism — the questionnaire read path already worked exactly this way
// ("Known default keys stay i18n-localized at the render site; custom keys render
// their authored label", below), and this only extends it to the tasks and to the
// preset-specific fields.
//
// So the `label` values below are ENGLISH FALLBACKS, not the copy of record. They
// still matter: they are what a row shows when its id was slugified away (a
// recruiter edited the row's text before saving, so the canonical id was
// deliberately dropped — see OnboardingTemplateManager) and what already sits in
// every template row written before this change. NOTHING PERSISTED IS REWRITTEN:
// existing rows keep their stored text and simply start resolving when their id is
// canonical, so no migration and no history rewrite is involved.
// ─────────────────────────────────────────────────────────────────────────────

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

// A pre-boarding questionnaire field: a stable `key` (answers are keyed by it) + a
// human `label`. Per-template + editable (P1-4) so a healthcare template can ask for
// a license number and a startup for a GitHub handle — instead of every industry
// getting the same frozen "t-shirt size + dietary needs" const. Known default keys
// stay i18n-localized at the render site; custom keys render their authored label.
export type QuestionnaireField = { key: string; label: string };

// The default pre-boarding questionnaire a fresh tenant gets (the prior frozen set,
// now data). Editable per template; the candidate/recruiter UIs localize these known
// keys and fall back to the authored label for any custom field.
export const DEFAULT_QUESTIONNAIRE: QuestionnaireField[] = [
  { key: "preferredName", label: "Preferred name" },
  { key: "tshirtSize", label: "T-shirt size" },
  { key: "dietaryNeeds", label: "Dietary needs" },
  { key: "equipmentPrefs", label: "Equipment preferences" },
  { key: "emergencyContact", label: "Emergency contact" },
  { key: "startDateConfirm", label: "Confirm your start date" },
];

// Back-compat: the default field KEYS (some call sites + tests reference these).
export const ENTRY_QUESTIONNAIRE_FIELDS = DEFAULT_QUESTIONNAIRE.map((f) => f.key);
export type EntryQuestionnaireField = string;

const MAX_TASKS = 40;
const MAX_FIELDS = 20;
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

/** camelCase key from a label, for a questionnaire field whose key wasn't supplied
 *  ("License number" -> "licenseNumber"). Falls back to "field" when empty. */
function slugifyKey(label: string): string {
  const words = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "field";
  return (words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join("")).slice(0, 64);
}

/** Validate + bound a questionnaire field list from a template create/edit (trust
 *  boundary): trims, drops blank/oversize labels, derives a key from the label when
 *  absent, de-dups keys, caps the count. Never throws. Mirror of coerceTasks for the
 *  per-template questionnaire (P1-4 — the questionnaire is data now, not a const). */
export function coerceQuestionnaire(input: unknown): QuestionnaireField[] {
  if (!Array.isArray(input)) return [];
  const out: QuestionnaireField[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (out.length >= MAX_FIELDS) break;
    const r = raw as { key?: unknown; label?: unknown };
    const label = typeof r?.label === "string" ? r.label.trim().slice(0, MAX_LABEL) : "";
    if (!label) continue;
    // An explicit key (preset / canonical default) is preserved verbatim so it
    // round-trips and matches the i18n/answer keys; only DERIVE a key from the
    // label when none was supplied (custom UI fields send label-only).
    let key = typeof r?.key === "string" && r.key.trim() ? r.key.trim().slice(0, 64) : slugifyKey(label);
    if (!key || seen.has(key)) key = `${key || "field"}${out.length}`;
    seen.add(key);
    out.push({ key, label });
  }
  return out;
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

// Industry starter templates (P1-4). A recruiter creates a template from one of
// these — prefilled, then editable — so onboarding fits their world (credential
// verification for clinicians, safety + certs for trades, IP/equity for startups,
// work-authorization for frontline) instead of a generic-office default. These are
// STARTERS, not compliance guarantees: every task/field is editable after creation,
// and the e-sign seam is still audit-stamped, not eIDAS (see top of file).
//
// F16 — the ids below are the LOCALIZATION KEYS as well as the row ids, so an id is
// shared across presets only where the label is genuinely the same sentence
// ("contract" in four of them). Where a preset says something different it gets its
// own id (`equipment-badge` vs `equipment-tools` vs `equipment`) — otherwise one
// catalog entry would have to serve "Order laptop and equipment" and "Issue badge,
// equipment and system access" at once. `name` / `industry` are the dropdown's copy
// and are UI, not row data: they read from `onboarding.preset.*` at render time.
export type OnboardingPreset = {
  id: string;
  /** English fallback — the dropdown renders `onboarding.preset.<id>.name`. */
  name: string;
  /** English fallback — the dropdown renders `onboarding.preset.<id>.industry`. */
  industry: string;
  tasks: OnboardingTask[];
  questionnaire: QuestionnaireField[];
};

export const ONBOARDING_PRESETS: OnboardingPreset[] = [
  {
    id: "general",
    name: "Standard onboarding",
    industry: "General / office",
    tasks: DEFAULT_ONBOARDING_TASKS,
    questionnaire: DEFAULT_QUESTIONNAIRE,
  },
  {
    id: "healthcare_clinical",
    name: "Clinical / healthcare onboarding",
    industry: "Healthcare & clinical",
    tasks: [
      { id: "license-verify", label: "Verify professional license (primary-source)" },
      { id: "credential-check", label: "Credentialing & board-certification check" },
      { id: "background", label: "Background check & references" },
      { id: "immunization", label: "Collect immunization / health records" },
      { id: "compliance-training", label: "HIPAA / patient-safety compliance training" },
      { id: "contract", label: "Send & sign the employment contract" },
      { id: "equipment-badge", label: "Issue badge, equipment and system access" },
      { id: "firstday-unit", label: "Share the first-day plan and unit orientation" },
    ],
    questionnaire: [
      { key: "preferredName", label: "Preferred name" },
      { key: "licenseNumber", label: "License / registration number" },
      { key: "licenseExpiry", label: "License expiry date" },
      { key: "immunizationStatus", label: "Immunization status" },
      { key: "emergencyContact", label: "Emergency contact" },
      { key: "startDateConfirm", label: "Confirm your start date" },
    ],
  },
  {
    id: "skilled_trades",
    name: "Trades / manufacturing onboarding",
    industry: "Skilled trades, manufacturing & construction",
    tasks: [
      { id: "safety-orientation", label: "Safety orientation (OSHA / BOZP)" },
      { id: "ppe", label: "Issue PPE and safety equipment" },
      { id: "drug-screen", label: "Pre-employment drug screen" },
      { id: "cert-verify", label: "Verify trade certifications / licenses" },
      { id: "equipment-tools", label: "Issue tools and equipment" },
      { id: "site-assignment", label: "Site / shift assignment" },
      { id: "contract", label: "Send & sign the employment contract" },
    ],
    questionnaire: [
      { key: "preferredName", label: "Preferred name" },
      { key: "certifications", label: "Certifications / licenses held" },
      { key: "ppeSize", label: "PPE / boot size" },
      { key: "emergencyContact", label: "Emergency contact" },
      { key: "startDateConfirm", label: "Confirm your start date" },
    ],
  },
  {
    id: "tech_startup",
    name: "Startup / tech onboarding",
    industry: "Tech & startups",
    tasks: [
      { id: "contract-offer", label: "Send & sign the offer & employment contract" },
      { id: "ip-nda", label: "Sign IP assignment, NDA & equity / option docs" },
      { id: "equipment", label: "Order laptop and equipment" },
      { id: "accounts-repo", label: "Create accounts and repo / tool access" },
      { id: "buddy", label: "Assign an onboarding buddy" },
      { id: "firstweek", label: "Share the first-week plan and goals" },
    ],
    questionnaire: [
      { key: "preferredName", label: "Preferred name" },
      { key: "equipmentPrefs", label: "Equipment preferences" },
      { key: "githubHandle", label: "GitHub / portfolio handle" },
      { key: "emergencyContact", label: "Emergency contact" },
      { key: "startDateConfirm", label: "Confirm your start date" },
    ],
  },
  {
    id: "frontline_service",
    name: "Frontline / hourly onboarding",
    industry: "Retail, hospitality & food service",
    tasks: [
      { id: "work-auth", label: "Confirm work authorization (e.g. I-9 / right to work)" },
      { id: "uniform", label: "Issue uniform and locker" },
      { id: "pos-training", label: "POS / floor / station training" },
      { id: "cert", label: "Food-handler / role certification (if required)" },
      { id: "schedule", label: "Set up the schedule and availability" },
      { id: "contract", label: "Send & sign the employment contract" },
    ],
    questionnaire: [
      { key: "preferredName", label: "Preferred name" },
      { key: "workAuthorization", label: "Work-authorization status" },
      { key: "availability", label: "Weekly availability" },
      { key: "emergencyContact", label: "Emergency contact" },
      { key: "startDateConfirm", label: "Confirm your start date" },
    ],
  },
];

// F16 — the reference side of the read-time contract. Derived from the data above
// rather than hand-listed, so adding a preset task automatically demands its catalog
// entry (onboarding.test.ts asserts every id/key here resolves in all four locales)
// instead of silently shipping an English row into a new hire's browser.
//
// The render sites do NOT gate on these sets — they ask the catalog directly
// (`t.has("task." + id)`), which is the same has-fallback idiom the questionnaire
// already used and keeps a custom row from ever hitting a key path. The sets exist
// to make the coverage testable in one place.

/** Every task id the shipped default checklist + the industry presets use. */
export const CANONICAL_TASK_IDS: readonly string[] = Array.from(
  new Set([...DEFAULT_ONBOARDING_TASKS, ...ONBOARDING_PRESETS.flatMap((p) => p.tasks)].map((t) => t.id))
);

/** Every questionnaire field key the shipped default + the industry presets use. */
export const CANONICAL_FIELD_KEYS: readonly string[] = Array.from(
  new Set([...DEFAULT_QUESTIONNAIRE, ...ONBOARDING_PRESETS.flatMap((p) => p.questionnaire)].map((f) => f.key))
);
