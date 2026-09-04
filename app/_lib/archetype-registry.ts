import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
// ArchetypeChecklistItem is a leaf type with no node:fs dependency, so it is
// single-sourced from the client-safe ProfileTypes (a type-only import, erased at
// compile time — it does not pull this server module into the client bundle). The
// full ArchetypeDef stays declared separately on each side: the client/server
// split is intentional (this module imports node:fs) and the weight/dimension
// maps differ (Record<Slot,...> here vs the literal object client-side).
import { BUILT_IN_ARCHETYPE_IDS, type ArchetypeChecklistItem } from "@/app/features/shared/profileTypes";

// Server-side read/write for the shared archetype registry (pipeline/jobfit/
// archetypes.json) — the SAME file the Python pipeline reads per spawn, so an
// edit here is picked up by the next ranking/intake run immediately. The TS app
// also imports this JSON statically (app/_lib/archetypes.ts) for app-wide labels;
// that copy refreshes on a dev rebuild, but the Profile management UI reads
// through THESE live endpoints so edits are always visible there at once.

// Module-internal: no external importer (the two archetype routes use only
// create/list/updateArchetype). validateArchetype and slotsOnly stay exported as the
// tested peers of Python's test_registry.py / registry._validate_archetype_weights
// contract — the invariants they mirror are the reason the write boundary is safe.
type Slot = "skills" | "career" | "personal";
const SLOTS: Slot[] = ["skills", "career", "personal"];
const SCORING_MODELS = ["experienced", "early_career"] as const;

// The tolerance Python's runtime guard uses (registry._validate_archetype_weights →
// `abs(total - 1.0) > 1e-6`). It USED to be 1e-3 here, which is not a rounding
// allowance — it is a hole: a weight vector summing to 0.9995 passed this boundary,
// was persisted into archetypes.json, and then made registry.py raise RuntimeError at
// IMPORT — on every profile_cli / match / analyze / intake spawn, for the whole
// deployment, until someone hand-edited the JSON. Mirror the Python number exactly so
// this validator can only ever reject MORE than the file's own reader does.
const WEIGHT_SUM_TOLERANCE = 1e-6;

// Ids the app reserves as SENTINELS for "this candidate was never routed to an
// archetype" — they must never become registry entries. app/_lib/archetypes.ts derives
// the fairness gate from registry membership: isFairnessProtected() fails CLOSED (true)
// precisely because "unknown" is NOT a known id, and archetypeDisplayKey() renders it as
// the honest "Unrouted" for the same reason. Registering an archetype called "unknown"
// therefore flips every unrouted candidate on the deployment — legacy CV analyses in the
// candidate pool (candidate-pool.ts stamps archetype "unknown"), the Profile matrix's
// unrouted column, the matcher's own sentinel — from shielded to auto-rejectable, and
// relabels them as a concrete class. "unrouted" is the display key that same module
// returns, reserved for the matching reason.
const RESERVED_IDS = new Set(["unknown", "unrouted"]);

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

// A registry file that cannot be read, parsed, or validated. Thrown by readRegistry
// and converted to a structured { error } by every exported entry point, so a broken
// file answers a CODE the manager localizes instead of a 500 carrying a parser
// message (or, worse, a merge computed against half a registry).
//
// The message is client-safe BY CONSTRUCTION: it names the file relative to the repo
// and quotes the validator, never the absolute path fs threw (that path is the reason
// the raw readFile error is caught and replaced rather than rethrown).
export class ArchetypeRegistryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ArchetypeRegistryError";
    this.code = code;
  }
}

// Validate a parsed registry through THE SAME validator every write goes through.
// Reading was a bare `JSON.parse(raw) as Registry` — a cast, which asserts nothing at
// runtime — while Python's reader validates the identical file at IMPORT and raises
// RuntimeError on the same invariant. So a hand-edited archetypes.json (the file is
// meant to be hand-editable: it is checked in, and the whole taxonomy is data) passed
// here and took every pipeline spawn down there. Validating on READ makes the two
// readers agree: what this module will serve is exactly what Python will import.
function validateRegistry(parsed: unknown): Registry {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ArchetypeRegistryError("registry_invalid", "pipeline/jobfit/archetypes.json is not a JSON object.");
  }
  const reg = parsed as Registry;
  if (!Array.isArray(reg.archetypes)) {
    throw new ArchetypeRegistryError("registry_invalid", "pipeline/jobfit/archetypes.json has no `archetypes` array.");
  }
  for (const a of reg.archetypes) {
    if (typeof a !== "object" || a === null || typeof (a as ArchetypeDef).id !== "string" || !(a as ArchetypeDef).id) {
      throw new ArchetypeRegistryError("registry_invalid", "pipeline/jobfit/archetypes.json contains an archetype with no id.");
    }
    const err = validateArchetype(a);
    if (err) {
      throw new ArchetypeRegistryError(
        "registry_invalid",
        `pipeline/jobfit/archetypes.json: archetype '${(a as ArchetypeDef).id}' is invalid — ${err.message}`
      );
    }
  }
  return reg;
}

async function readRegistry(): Promise<Registry> {
  let raw: string;
  try {
    raw = await readFile(registryPath(), "utf-8");
  } catch {
    // Replaced, not rethrown: the fs error carries the deployment's ABSOLUTE path.
    throw new ArchetypeRegistryError("registry_unreadable", "pipeline/jobfit/archetypes.json could not be read.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The parser message quotes the offending bytes; the position is not actionable
    // to the manager UI and the bytes are file content, so answer the fact only.
    throw new ArchetypeRegistryError("registry_invalid", "pipeline/jobfit/archetypes.json is not valid JSON.");
  }
  return validateRegistry(parsed);
}

// Every exported entry point funnels its registry read through here, so a broken file
// becomes the SAME structured refusal at all four doors instead of an exception at one
// and a 500 at the next. Anything that is not an ArchetypeRegistryError (a disk fault
// mid-write, a bug) still escapes to the route's catch — this converts the ONE
// condition it can name.
async function guarded<T>(fn: () => Promise<T>): Promise<T | { error: ArchetypeError }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ArchetypeRegistryError) return { error: { code: err.code, message: err.message } };
    throw err;
  }
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
  // typeof-guarded, not just truthy: the body is an unvalidated cast at the route, so a
  // `{"label": 123}` PUT used to reach `.trim()` and throw a TypeError the handler turned
  // into a 500 — a server error for what is plainly bad client input.
  if (typeof a.label !== "string" || !a.label.trim()) return { code: "label_required", message: "Label is required." };
  if (!a.scoringModel || !(SCORING_MODELS as readonly string[]).includes(a.scoringModel)) {
    return { code: "scoring_model_invalid", message: "Scoring model must be 'experienced' or 'early_career'." };
  }
  if (!a.weights) return { code: "weights_required", message: "Weights are required." };
  for (const slot of SLOTS) {
    if (typeof a.weights[slot] !== "number" || Number.isNaN(a.weights[slot])) {
      return { code: "weight_not_number", message: `Weight for ${slot} must be a number.`, params: { slot } };
    }
    // The headline score is `100 * (w.skills*skills + w.career*career + w.personal*
    // personal)` — a weighted AVERAGE only while every weight is a share in [0,1]. A
    // NEGATIVE weight still passes the sum check when a sibling compensates
    // ({-0.1, 0.6, 0.5} sums to 1.0) and passes Python's import guard too, so it lands
    // in the scorer and INVERTS that dimension: the candidate with the stronger skills
    // evidence scores lower. Reachable from the manager UI, whose `min={0}` on the
    // percentage input is advisory (the save is a click handler, not a form submit).
    // ±Infinity is caught here too.
    const w = a.weights[slot] as number;
    if (!(w >= 0 && w <= 1)) {
      return { code: "weight_out_of_range", message: `Weight for ${slot} must be between 0 and 1.`, params: { slot } };
    }
  }
  const sum = SLOTS.reduce((n, s) => n + (a.weights as Record<Slot, number>)[s], 0);
  if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
    // Two decimals is the readable default, but it renders a 0.9995 sum as "1.00" — a
    // rejection the caller cannot act on. Widen only when 2dp would hide the error.
    const shown = Math.abs(sum - 1) >= 0.005 ? sum.toFixed(2) : sum.toFixed(6);
    return { code: "weights_sum", message: `Weights must sum to 1.0 (currently ${shown}).`, params: { sum: shown } };
  }
  if (!a.dimensionLabels) return { code: "dimension_labels_required", message: "Dimension labels are required." };
  for (const slot of SLOTS) {
    // typeof-guarded for the same reason as `label` above.
    const dim = a.dimensionLabels[slot] as unknown;
    if (typeof dim !== "string" || !dim.trim()) {
      return { code: "dimension_label_required", message: `Dimension label for ${slot} is required.`, params: { slot } };
    }
  }
  return null;
}

// Project a submitted slot map (`weights` / `dimensionLabels`) onto EXACTLY the three
// scoring slots. Python's registry FAILS FAST at import when an archetype's weights
// carry any other key (`keys != {"skills","career","personal"}` →
// registry._validate_archetype_weights raises), and that import runs on EVERY pipeline
// spawn — so one extra key persisted here (an integrator adding a 4th dimension) takes
// analyze / match / intake / profile-build down for the whole deployment. The extra key
// never meant anything to either scorer, so DROP it rather than fail the save. A MISSING
// slot is deliberately left missing: validateArchetype then names the offending slot,
// which is the actionable error. Returns undefined for a non-object, so validateArchetype
// reports "weights are required" instead of the caller's junk reaching disk.
export function slotsOnly<T>(map: unknown): Record<Slot, T> | undefined {
  if (typeof map !== "object" || map === null || Array.isArray(map)) return undefined;
  const src = map as Record<string, T>;
  const out: Partial<Record<Slot, T>> = {};
  for (const slot of SLOTS) {
    if (slot in src) out[slot] = src[slot];
  }
  return out as Record<Slot, T>;
}

function pickEditable(patch: Record<string, unknown>): Partial<ArchetypeDef> {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in patch) out[key] = patch[key];
  }
  // Both slot maps are replaced wholesale by an edit, so normalize them here — the one
  // seam every PUT passes through — before the merge persists them (see slotsOnly).
  if ("weights" in out) out.weights = slotsOnly<number>(out.weights);
  if ("dimensionLabels" in out) out.dimensionLabels = slotsOnly<string>(out.dimensionLabels);
  return out as Partial<ArchetypeDef>;
}

// The READ door. Deliberately still THROWS an ArchetypeRegistryError on a broken file
// rather than returning { error }: its return type is the array the GET route spreads,
// and the thrown message is client-safe by construction (see ArchetypeRegistryError), so
// the route's 500 already says which file is broken and why — which is the operator's
// next action. The WRITE doors convert instead, because a write must not look like a
// validation failure of the operator's own edit.
export async function listArchetypes(): Promise<ArchetypeDef[]> {
  return (await readRegistry()).archetypes;
}

// Merge the editable fields of `patch` onto an existing archetype, validate the
// result, and persist. Returns the updated archetype or an { error } result.
export async function updateArchetype(
  id: string,
  patch: Record<string, unknown>
): Promise<{ archetype: ArchetypeDef } | { error: ArchetypeError }> {
  return guarded(() => serializeWrite(async () => {
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
  }));
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
  return guarded(() => serializeWrite(async () => {
    const reg = await readRegistry();
    const idx = reg.archetypes.findIndex((a) => a.id === id);
    if (idx === -1) return { error: { code: "not_found", message: "Archetype not found." } };
    const merged = { ...reg.archetypes[idx], archived };
    reg.archetypes[idx] = merged;
    await writeRegistry(reg);
    return { archetype: merged };
  }));
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
  // Refused BEFORE the write (like the id-format check above) — see RESERVED_IDS.
  if (RESERVED_IDS.has(id)) {
    return {
      error: {
        code: "id_reserved",
        message: `'${id}' is reserved for candidates that could not be routed; choose another id.`,
        params: { id },
      },
    };
  }
  return guarded(() => serializeWrite(async () => {
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
      // Normalized to exactly the three slots (see slotsOnly) so a submitted 4th
      // dimension can't reach archetypes.json and break the Python reader's import.
      weights: body.weights === undefined
        ? { skills: 0.5, career: 0.35, personal: 0.15 }
        : (slotsOnly<number>(body.weights) as Record<Slot, number>),
      dimensionLabels: body.dimensionLabels === undefined
        ? { skills: "Skills", career: "Career", personal: "Personal" }
        : (slotsOnly<string>(body.dimensionLabels) as Record<Slot, string>),
      checklist: [],
    };
    const err = validateArchetype(def);
    if (err) return { error: err };
    reg.archetypes.push(def);
    await writeRegistry(reg);
    return { archetype: def };
  }));
}
