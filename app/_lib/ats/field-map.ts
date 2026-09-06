// W1.1 — the per-connection FIELD MAP: vendor payload → AtsInboundCandidate.
//
// We chose to hand-build connectors rather than buy a unified API (D1), which makes it
// tempting to hard-code each vendor's JSON shape in its own adapter. That fails on the
// first real customer, for a boring reason: two companies on the SAME ATS do not model
// their pipeline the same way. Their stage names differ ("Phone screen" vs "1st round"),
// they keep the real email in a custom field, they rename the requisition id. A connector
// with the shape baked in needs a code change and a deploy for each of those.
//
// So the vendor-specific code stays thin — talk HTTP, hand back parsed JSON — and the
// shape lives in configuration: a dot-path per field, plus a stage map. A connector ships
// a sensible DEFAULT map; a customer overrides the parts their tenant does differently.
//
// Pure + dependency-free.

import type { RefusalErrorCode } from "../api-response";
import { PIPELINE_STAGES, type PipelineStage } from "../pipeline-stages";
import { parseInboundCandidate, type AtsInboundCandidate } from "./inbound";

/** The inbound fields a map can bind. `provider` is not one of them — it identifies the
 *  connection itself, so a payload must never be able to claim to be another provider. */
export const MAPPABLE_FIELDS = [
  "externalId",
  "displayName",
  "contact",
  "externalJobId",
  "jobTitle",
  "externalStage",
  "appliedAt",
  "cvText",
  "sourceLabel",
] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

export type AtsFieldMap = {
  /** field → dot path into the vendor payload, e.g. "candidate.emails.0". */
  paths: Partial<Record<MappableField, string>>;
  /** Vendor stage name (lowercased) → kp stage. Unmapped stages stay null so the caller
   *  can decide, rather than a wrong stage quietly entering the funnel and skewing it. */
  stages: Record<string, PipelineStage>;
};

const MAX_DEPTH = 8;

/**
 * Read a dot path out of an arbitrary parsed payload. Numeric segments index arrays, so
 * "candidate.emails.0" works on the shape most ATS APIs actually return.
 *
 * Depth-bounded, and it refuses to walk prototype keys — the payload is remote JSON, and
 * `__proto__.x` on an object built by JSON.parse is inert but a path like that reaching
 * into any non-plain object later would not be. Returns undefined for any miss; the
 * inbound parser turns that into a null field.
 */
export function readPath(payload: unknown, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split(".");
  if (segments.length > MAX_DEPTH) return undefined;
  let node: unknown = payload;
  for (const seg of segments) {
    if (node === null || node === undefined) return undefined;
    if (seg === "__proto__" || seg === "constructor" || seg === "prototype") return undefined;
    if (Array.isArray(node)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) return undefined;
      node = node[idx];
      continue;
    }
    if (typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/** Map a vendor stage name onto the board's axis, case- and whitespace-insensitively.
 *
 *  `allowed` is the destination axis to validate against. It defaults to the
 *  shipped stage list so every existing caller behaves exactly as before; a caller
 *  that knows the workspace passes its own axis, so a team that renamed a column
 *  can still receive candidates onto it. (ats_connections is not workspace-keyed
 *  yet — see docs/features/integrations/README.md, Known gaps — which is why the
 *  default has to stay.) */
export function mapStage(map: AtsFieldMap, externalStage: unknown, allowed: readonly string[] = PIPELINE_STAGES): PipelineStage | null {
  if (typeof externalStage !== "string") return null;
  const key = externalStage.trim().toLowerCase();
  if (!key) return null;
  const mapped = map.stages[key];
  return mapped && allowed.includes(mapped) ? mapped : null;
}

/**
 * Apply a field map to one vendor record, then validate through the inbound parser (so a
 * mapped payload gets exactly the same bounds and required-field checks as a hand-built
 * one — the map is a convenience, never a way around validation).
 *
 * Throws AtsInboundError when the mapped result has no external id, which in practice means
 * the map's `externalId` path is wrong. That is worth failing loudly: a silent miss here
 * would re-import every candidate as new on every sync.
 */
export function applyFieldMap(map: AtsFieldMap, provider: string, record: unknown): AtsInboundCandidate {
  const value = (field: MappableField): unknown => {
    const path = map.paths[field];
    return path ? readPath(record, path) : undefined;
  };
  const externalStage = value("externalStage");
  return parseInboundCandidate({
    provider,
    externalId: coerceScalar(value("externalId")),
    displayName: coerceScalar(value("displayName")),
    contact: coerceScalar(value("contact")),
    externalJobId: coerceScalar(value("externalJobId")),
    jobTitle: coerceScalar(value("jobTitle")),
    externalStage: coerceScalar(externalStage),
    stage: mapStage(map, coerceScalar(externalStage)),
    appliedAt: coerceScalar(value("appliedAt")),
    cvText: coerceScalar(value("cvText")),
    sourceLabel: coerceScalar(value("sourceLabel")),
  });
}

/** Vendor ids are routinely numbers; everything else must already be a string.
 *  Objects and arrays are NOT stringified — "[object Object]" as an external id would be a
 *  plausible-looking value that collides across every candidate. */
function coerceScalar(v: unknown): unknown {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  return v;
}

export class AtsFieldMapError extends Error {
  /** The refusal the route answers with. One code for every way a map can be
   *  unusable: the specific sentence ("unknown mapped field \"foo\"") is operator
   *  detail for the server log, and the panel renders `errors.<code>` in the
   *  reader's language rather than this English message (.claude/CLAUDE.md, "a
   *  failure is answered with a CODE"). */
  readonly code: RefusalErrorCode = "ATS_FIELD_MAP_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "AtsFieldMapError";
  }
}

/** Validate a map arriving from the API/UI before it is stored.
 *
 *  `allowed` is the destination axis its `stages` values must name — defaulting
 *  to the shipped list, so a caller that cannot resolve a workspace behaves as
 *  before. See mapStage for why the default has to stay. */
export function parseFieldMap(raw: unknown, allowed: readonly string[] = PIPELINE_STAGES): AtsFieldMap {
  if (!raw || typeof raw !== "object") throw new AtsFieldMapError("fieldMap must be an object.");
  const o = raw as Record<string, unknown>;
  const paths: Partial<Record<MappableField, string>> = {};
  const rawPaths = o.paths;
  if (rawPaths !== undefined) {
    if (!rawPaths || typeof rawPaths !== "object") throw new AtsFieldMapError("fieldMap.paths must be an object.");
    for (const [k, v] of Object.entries(rawPaths as Record<string, unknown>)) {
      if (!(MAPPABLE_FIELDS as readonly string[]).includes(k)) {
        throw new AtsFieldMapError(`unknown mapped field "${k}". Allowed: ${MAPPABLE_FIELDS.join(", ")}.`);
      }
      if (typeof v !== "string" || !v.trim()) throw new AtsFieldMapError(`fieldMap.paths.${k} must be a non-empty string.`);
      paths[k as MappableField] = v.trim();
    }
  }
  if (!paths.externalId) {
    throw new AtsFieldMapError("fieldMap.paths.externalId is required — it is the sync identity.");
  }
  const stages: Record<string, PipelineStage> = {};
  const rawStages = o.stages;
  if (rawStages !== undefined) {
    if (!rawStages || typeof rawStages !== "object") throw new AtsFieldMapError("fieldMap.stages must be an object.");
    for (const [k, v] of Object.entries(rawStages as Record<string, unknown>)) {
      if (typeof v !== "string" || !allowed.includes(v)) {
        throw new AtsFieldMapError(`fieldMap.stages["${k}"] must be one of: ${allowed.join(", ")}.`);
      }
      stages[k.trim().toLowerCase()] = v as PipelineStage;
    }
  }
  return { paths, stages };
}
