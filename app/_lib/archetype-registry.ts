import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
// ArchetypeChecklistItem is a leaf type with no node:fs dependency, so it is
// single-sourced from the client-safe ProfileTypes (a type-only import, erased at
// compile time — it does not pull this server module into the client bundle). The
// full ArchetypeDef stays declared separately on each side: the client/server
// split is intentional (this module imports node:fs) and the weight/dimension
// maps differ (Record<Slot,...> here vs the literal object client-side).
import { BUILT_IN_ARCHETYPE_IDS, type ArchetypeChecklistItem } from "@/app/features/sub_profile/ProfileTypes";

// Server-side read/write for the shared archetype registry (pipeline/jobfit/
// archetypes.json) — the SAME file the Python pipeline reads per spawn, so an
// edit here is picked up by the next ranking/intake run immediately. The TS app
// also imports this JSON statically (app/_lib/archetypes.ts) for app-wide labels;
// that copy refreshes on a dev rebuild, but the Profile management UI reads
// through THESE live endpoints so edits are always visible there at once.

// Module-internal: no external importer (the two archetype routes use only
// create/list/updateArchetype). validateArchetype stays exported as the tested
// peer of Python's test_registry.py contract.
type Slot = "skills" | "career" | "personal";
const SLOTS: Slot[] = ["skills", "career", "personal"];
const SCORING_MODELS = ["experienced", "early_career"] as const;

export type ArchetypeDef = {
  id: string;
  label: string;
  badge: string;
  pythonLabel?: string;
  applyLabel?: string;
  fairnessProtected: boolean;
  scoringModel: string;
  weights: Record<Slot, number>;
  dimensionLabels: Record<Slot, string>;
  checklist: ArchetypeChecklistItem[];
  // Retired custom archetype (additive). The entry STAYS in the registry so a profile
  // routed to it still scores/routes; the flag only removes it from the pickers. NULL/
  // absent on active archetypes. The Python reader tolerates the extra key (it reads by
  // known keys / .get) — see registry.py archived_ids() + test_registry.
  archived?: boolean;
};

const BUILT_IN = new Set<string>(BUILT_IN_ARCHETYPE_IDS);

// A structured validation/lifecycle error: a stable `code` the client maps to a
// localized label (the labelOr id→label pattern), plus the English `message` kept as
// the fallback for direct API callers. `params` fill the localized ICU placeholders.
export type ArchetypeError = { code: string; message: string; params?: Record<string, string | number> };

type Registry = {
  archetypes: ArchetypeDef[];
  commonChecklist?: unknown;
  detection?: unknown;
  [key: string]: unknown;
};

// The fields a recruiter may edit through the UI. id is immutable (it keys
// scoring/fairness/detection); checklist + detection rules stay code-adjacent and
// are not edited here (a new check id would have no predicate behind it).
const EDITABLE_FIELDS = [
  "label",
  "badge",
  "applyLabel",
  "fairnessProtected",
  "scoringModel",
  "weights",
  "dimensionLabels",
] as const;

function registryPath(): string {
  return path.join(process.cwd(), "pipeline", "jobfit", "archetypes.json");
}

async function readRegistry(): Promise<Registry> {
  const raw = await readFile(registryPath(), "utf-8");
  return JSON.parse(raw) as Registry;
}

async function writeRegistry(reg: Registry): Promise<void> {
  // ATOMIC write: the Python pipeline reads archetypes.json on EVERY intake/ranking
  // spawn, concurrently with a recruiter's save here. A plain writeFile is not atomic,
  // so a reader could catch a half-written (torn/truncated) file and 500 the live run
  // on a JSON parse failure. Write a sibling temp file, then rename() it over the
  // target — rename is atomic within a filesystem, so a reader always sees either the
  // complete old file or the complete new one, never a partial. Trailing newline +
  // 2-space indent match the hand-authored file so the committed diff stays minimal.
  const target = registryPath();
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(reg, null, 2)}\n`, "utf-8");
  await rename(tmp, target);
}

// Serialize read-modify-write cycles so two near-simultaneous saves (two browser
// tabs / a save racing an intake) can't each read the pre-other snapshot and clobber
// the first edit — a silent lost update to scoring weights / the compliance-critical
// fairness flag. A process-level promise chain: each write waits for the prior to
// settle, so within this process the read→mutate→write runs without interleaving.
let _writeChain: Promise<unknown> = Promise.resolve();
function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeChain.then(fn, fn);
  _writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// Validate the compliance- and scoring-critical invariants the Python contract
// test (test_registry.py) also enforces, so a bad edit is rejected at the API
// boundary rather than desyncing the registry. Returns a structured error (stable
// `code` + English `message` fallback) or null. The client localizes by `code`; a
// direct API caller still gets the readable English `message`.
export function validateArchetype(a: Partial<ArchetypeDef>): ArchetypeError | null {
  if (!a.label || !a.label.trim()) return { code: "label_required", message: "Label is required." };
  if (!a.scoringModel || !(SCORING_MODELS as readonly string[]).includes(a.scoringModel)) {
    return { code: "scoring_model_invalid", message: "Scoring model must be 'experienced' or 'early_career'." };
  }
  if (!a.weights) return { code: "weights_required", message: "Weights are required." };
  for (const slot of SLOTS) {
    if (typeof a.weights[slot] !== "number" || Number.isNaN(a.weights[slot])) {
      return { code: "weight_not_number", message: `Weight for ${slot} must be a number.`, params: { slot } };
    }
  }
  const sum = SLOTS.reduce((n, s) => n + (a.weights as Record<Slot, number>)[s], 0);
  if (Math.abs(sum - 1) > 0.001) {
    return { code: "weights_sum", message: `Weights must sum to 1.0 (currently ${sum.toFixed(2)}).`, params: { sum: sum.toFixed(2) } };
  }
  if (!a.dimensionLabels) return { code: "dimension_labels_required", message: "Dimension labels are required." };
  for (const slot of SLOTS) {
    if (!a.dimensionLabels[slot] || !a.dimensionLabels[slot].trim()) {
      return { code: "dimension_label_required", message: `Dimension label for ${slot} is required.`, params: { slot } };
    }
  }
  return null;
}

function pickEditable(patch: Record<string, unknown>): Partial<ArchetypeDef> {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in patch) out[key] = patch[key];
  }
  return out as Partial<ArchetypeDef>;
}

export async function listArchetypes(): Promise<ArchetypeDef[]> {
  return (await readRegistry()).archetypes;
}

// Merge the editable fields of `patch` onto an existing archetype, validate the
// result, and persist. Returns the updated archetype or an { error } result.
export async function updateArchetype(
  id: string,
  patch: Record<string, unknown>
): Promise<{ archetype: ArchetypeDef } | { error: ArchetypeError }> {
  return serializeWrite(async () => {
    const reg = await readRegistry();
    const idx = reg.archetypes.findIndex((a) => a.id === id);
    if (idx === -1) return { error: { code: "not_found", message: "Archetype not found." } };
    const current = reg.archetypes[idx];
    const editable = pickEditable(patch);
    // A built-in's fairness shield can't be edited away (candidate-profile-job-matching
    // #1). setArchetypeArchived already refuses to retire built-ins because that would
    // strip the shield — but updateArchetype had no such guard, so unticking the
    // fairness checkbox (or a raw PUT of fairnessProtected/scoringModel) silently
    // disabled the "early-career candidates are never auto-rejected" guarantee, or
    // re-ranked students on the experienced model. Reject those two changes for
    // built-ins (label/badge/weights edits still go through); mirrors archive_builtin.
    if (
      BUILT_IN.has(id) &&
      (("fairnessProtected" in editable && editable.fairnessProtected !== current.fairnessProtected) ||
        ("scoringModel" in editable && editable.scoringModel !== current.scoringModel))
    ) {
      return {
        error: {
          code: "edit_builtin_shield",
          message: `'${id}' is a built-in archetype; its fairness protection and scoring model can't be changed.`,
          params: { id },
        },
      };
    }
    // pickEditable omits `archived`, so a normal edit never flips retirement — only the
    // explicit archive endpoint touches it, and the flag survives weight/label edits.
    const merged = { ...current, ...editable };
    const err = validateArchetype(merged);
    if (err) return { error: err };
    reg.archetypes[idx] = merged;
    await writeRegistry(reg);
    return { archetype: merged };
  });
}

// Retire (archive) or restore (unarchive) a CUSTOM archetype. Built-in archetypes are
// refused with an honest reason — retiring them would strip the fairness shield /
// default routing the pipeline depends on. The entry is never deleted, so profiles
// routed to a retired archetype keep scoring; the flag only hides it from the pickers.
// Atomic through the same serializeWrite + temp-file rename machinery as every edit.
export async function setArchetypeArchived(
  id: string,
  archived: boolean
): Promise<{ archetype: ArchetypeDef } | { error: ArchetypeError }> {
  if (BUILT_IN.has(id)) {
    return { error: { code: "archive_builtin", message: `'${id}' is a built-in archetype and can't be retired.`, params: { id } } };
  }
  return serializeWrite(async () => {
    const reg = await readRegistry();
    const idx = reg.archetypes.findIndex((a) => a.id === id);
    if (idx === -1) return { error: { code: "not_found", message: "Archetype not found." } };
    const merged = { ...reg.archetypes[idx], archived };
    reg.archetypes[idx] = merged;
    await writeRegistry(reg);
    return { archetype: merged };
  });
}

// Create a new archetype. It is selectable/assignable immediately; without
// detection signals it won't be auto-routed from a CV (only via explicit
// self-declaration), and with an empty checklist its completeness uses the common
// items only — both are safe, honest defaults the recruiter can extend later.
export async function createArchetype(
  body: Record<string, unknown>
): Promise<{ archetype: ArchetypeDef } | { error: ArchetypeError }> {
  const id = String(body.id ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    return { error: { code: "id_invalid", message: "Id must be lowercase letters, digits, or underscores and start with a letter." } };
  }
  return serializeWrite(async () => {
    const reg = await readRegistry();
    if (reg.archetypes.some((a) => a.id === id)) return { error: { code: "id_exists", message: `An archetype with id '${id}' already exists.`, params: { id } } };

    const def: ArchetypeDef = {
      id,
      label: String(body.label ?? "").trim(),
      badge: String(body.badge ?? body.label ?? "").trim() || id,
      pythonLabel: String(body.label ?? "").trim(),
      applyLabel: body.applyLabel ? String(body.applyLabel).trim() : undefined,
      fairnessProtected: Boolean(body.fairnessProtected),
      scoringModel: String(body.scoringModel ?? "experienced"),
      weights: (body.weights as Record<Slot, number>) ?? { skills: 0.5, career: 0.35, personal: 0.15 },
      dimensionLabels:
        (body.dimensionLabels as Record<Slot, string>) ?? { skills: "Skills", career: "Career", personal: "Personal" },
      checklist: [],
    };
    const err = validateArchetype(def);
    if (err) return { error: err };
    reg.archetypes.push(def);
    await writeRegistry(reg);
    return { archetype: def };
  });
}
