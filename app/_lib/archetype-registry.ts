import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
// ArchetypeChecklistItem is a leaf type with no node:fs dependency, so it is
// single-sourced from the client-safe ProfileTypes (a type-only import, erased at
// compile time — it does not pull this server module into the client bundle). The
// full ArchetypeDef stays declared separately on each side: the client/server
// split is intentional (this module imports node:fs) and the weight/dimension
// maps differ (Record<Slot,...> here vs the literal object client-side).
import type { ArchetypeChecklistItem } from "@/app/features/sub_profile/ProfileTypes";

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
};

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
  // Trailing newline + 2-space indent to match the hand-authored file so the
  // diff stays minimal when this is committed.
  await writeFile(registryPath(), `${JSON.stringify(reg, null, 2)}\n`, "utf-8");
}

// Validate the compliance- and scoring-critical invariants the Python contract
// test (test_registry.py) also enforces, so a bad edit is rejected at the API
// boundary rather than desyncing the registry. Returns an error string or null.
export function validateArchetype(a: Partial<ArchetypeDef>): string | null {
  if (!a.label || !a.label.trim()) return "Label is required.";
  if (!a.scoringModel || !(SCORING_MODELS as readonly string[]).includes(a.scoringModel)) {
    return "Scoring model must be 'experienced' or 'early_career'.";
  }
  if (!a.weights) return "Weights are required.";
  for (const slot of SLOTS) {
    if (typeof a.weights[slot] !== "number" || Number.isNaN(a.weights[slot])) {
      return `Weight for ${slot} must be a number.`;
    }
  }
  const sum = SLOTS.reduce((n, s) => n + (a.weights as Record<Slot, number>)[s], 0);
  if (Math.abs(sum - 1) > 0.001) return `Weights must sum to 1.0 (currently ${sum.toFixed(2)}).`;
  if (!a.dimensionLabels) return "Dimension labels are required.";
  for (const slot of SLOTS) {
    if (!a.dimensionLabels[slot] || !a.dimensionLabels[slot].trim()) {
      return `Dimension label for ${slot} is required.`;
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
): Promise<{ archetype: ArchetypeDef } | { error: string }> {
  const reg = await readRegistry();
  const idx = reg.archetypes.findIndex((a) => a.id === id);
  if (idx === -1) return { error: "Archetype not found." };
  const merged = { ...reg.archetypes[idx], ...pickEditable(patch) };
  const err = validateArchetype(merged);
  if (err) return { error: err };
  reg.archetypes[idx] = merged;
  await writeRegistry(reg);
  return { archetype: merged };
}

// Create a new archetype. It is selectable/assignable immediately; without
// detection signals it won't be auto-routed from a CV (only via explicit
// self-declaration), and with an empty checklist its completeness uses the common
// items only — both are safe, honest defaults the recruiter can extend later.
export async function createArchetype(
  body: Record<string, unknown>
): Promise<{ archetype: ArchetypeDef } | { error: string }> {
  const id = String(body.id ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    return { error: "Id must be lowercase letters, digits, or underscores and start with a letter." };
  }
  const reg = await readRegistry();
  if (reg.archetypes.some((a) => a.id === id)) return { error: `An archetype with id '${id}' already exists.` };

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
}
