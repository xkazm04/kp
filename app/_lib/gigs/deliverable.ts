import {
  GIG_ARTIFACT_KINDS,
  GIG_DELIVERABLE_FENCE,
  GIG_EVIDENCE_KINDS,
  type GigArtifactKind,
  type GigDeliverable,
  type GigEvidenceKind,
} from "./types";

// The deliverable parser - the trust boundary between a specialist's free-text run
// output (Personas `output_data`) and the typed GigDeliverable the Gig desk renders.
// PURE: no db, no clock, no network.
//
// The contract (GIG_DELIVERABLE_CONTRACT, stated in every specialist's system prompt):
// the run ENDS with one fenced block tagged `kp-deliverable` holding the JSON. The LAST
// such block wins - on purpose. The listing the specialist worked from is untrusted
// text written by strangers, and a listing can carry its own fake `kp-deliverable`
// block; a model that quotes the listing early in its output would otherwise hand that
// forgery to the operator as the specialist's work. The specialist's own block comes
// at the end, so the end is what counts.
//
// Every field is re-validated: lengths are bounded, confidence is clamped to 0..1, and
// an artifact or evidence row whose kind is not in the vocabulary is DROPPED with a
// count (the desk says "2 items dropped" rather than rendering a kind it cannot draw).
// A missing required field is `invalid_shape`, never a guessed default: an empty
// disclosure or a confidence nobody stated would be a claim the specialist never made.

export const DELIVERABLE_LIMITS = {
  summary: 2_000,
  draftText: 60_000,
  disclosure: 1_000,
  artifactRef: 2_000,
  artifactTitle: 300,
  evidenceCommand: 2_000,
  evidenceResult: 4_000,
  question: 1_000,
  maxArtifacts: 50,
  maxEvidence: 50,
  maxQuestions: 20,
} as const;

export type DeliverableFailureReason = "no_output" | "no_deliverable_block" | "invalid_json" | "invalid_shape";

export type ParseGigDeliverableResult =
  | {
      ok: true;
      deliverable: GigDeliverable;
      /** Rows removed for an unknown kind or a malformed shape. */
      dropped: { artifacts: number; evidence: number; questions: number };
    }
  | { ok: false; reason: DeliverableFailureReason; detail?: string };

// ```kp-deliverable ... ``` (backticks) or ~~~kp-deliverable ... ~~~ (tildes); the
// info string may carry trailing words (`kp-deliverable json`). The closing fence must
// match the opening character and sit at the start of a line.
const FENCE_RE = new RegExp(
  "(^|\\n)[ \\t]*(`{3,}|~{3,})[ \\t]*" + GIG_DELIVERABLE_FENCE + "(?:[ \\t][^\\n]*)?\\n([\\s\\S]*?)\\n[ \\t]*\\2[ \\t]*(?=\\n|$)",
  "g"
);

/** The body of the LAST `kp-deliverable` block, or null when there is none. */
export function lastDeliverableBlock(output: string): string | null {
  const text = output.replace(/\r\n/g, "\n");
  let last: string | null = null;
  for (const m of text.matchAll(FENCE_RE)) last = m[3] ?? "";
  return last;
}

function boundedText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function isArtifactKind(v: unknown): v is GigArtifactKind {
  return typeof v === "string" && (GIG_ARTIFACT_KINDS as readonly string[]).includes(v);
}

function isEvidenceKind(v: unknown): v is GigEvidenceKind {
  return typeof v === "string" && (GIG_EVIDENCE_KINDS as readonly string[]).includes(v);
}

function readArtifacts(raw: unknown): { rows: GigDeliverable["artifacts"]; dropped: number } | null {
  if (raw === undefined || raw === null) return { rows: [], dropped: 0 };
  if (!Array.isArray(raw)) return null;
  const rows: GigDeliverable["artifacts"] = [];
  let dropped = 0;
  for (const item of raw) {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const ref = o ? boundedText(o.ref, DELIVERABLE_LIMITS.artifactRef) : null;
    if (!o || !isArtifactKind(o.kind) || !ref || rows.length >= DELIVERABLE_LIMITS.maxArtifacts) {
      dropped += 1;
      continue;
    }
    rows.push({ kind: o.kind, ref, title: boundedText(o.title, DELIVERABLE_LIMITS.artifactTitle) ?? ref.slice(0, DELIVERABLE_LIMITS.artifactTitle) });
  }
  return { rows, dropped };
}

function readEvidence(raw: unknown): { rows: GigDeliverable["evidence"]; dropped: number } | null {
  if (raw === undefined || raw === null) return { rows: [], dropped: 0 };
  if (!Array.isArray(raw)) return null;
  const rows: GigDeliverable["evidence"] = [];
  let dropped = 0;
  for (const item of raw) {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const result = o ? boundedText(o.result, DELIVERABLE_LIMITS.evidenceResult) : null;
    // `passed` is tri-state on the wire: true / false / null ("ran, no pass-fail
    // meaning"). Anything else is a claim we cannot read, so the row goes.
    const passed = o && (o.passed === true || o.passed === false) ? o.passed : o && (o.passed === null || o.passed === undefined) ? null : undefined;
    if (!o || !isEvidenceKind(o.kind) || !result || passed === undefined || rows.length >= DELIVERABLE_LIMITS.maxEvidence) {
      dropped += 1;
      continue;
    }
    rows.push({ kind: o.kind, command: boundedText(o.command, DELIVERABLE_LIMITS.evidenceCommand), result, passed });
  }
  return { rows, dropped };
}

function readQuestions(raw: unknown): { rows: string[]; dropped: number } | null {
  if (raw === undefined || raw === null) return { rows: [], dropped: 0 };
  if (!Array.isArray(raw)) return null;
  const rows: string[] = [];
  let dropped = 0;
  for (const item of raw) {
    const q = boundedText(item, DELIVERABLE_LIMITS.question);
    if (!q || rows.length >= DELIVERABLE_LIMITS.maxQuestions) {
      dropped += 1;
      continue;
    }
    rows.push(q);
  }
  return { rows, dropped };
}

function shapeFailure(detail: string): ParseGigDeliverableResult {
  return { ok: false, reason: "invalid_shape", detail };
}

/** Validate an already-parsed deliverable object (the JSON inside the block). */
export function validateGigDeliverable(value: unknown): ParseGigDeliverableResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return shapeFailure("not an object");
  const o = value as Record<string, unknown>;
  if (o.version !== 1) return shapeFailure("version must be 1");
  const summary = boundedText(o.summary, DELIVERABLE_LIMITS.summary);
  if (!summary) return shapeFailure("summary is required");
  const draftText = boundedText(o.draftText, DELIVERABLE_LIMITS.draftText);
  if (!draftText) return shapeFailure("draftText is required");
  const disclosure = boundedText(o.disclosure, DELIVERABLE_LIMITS.disclosure);
  if (!disclosure) return shapeFailure("disclosure is required");
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence)) return shapeFailure("confidence must be a number");
  const confidence = Math.min(1, Math.max(0, o.confidence));
  const artifacts = readArtifacts(o.artifacts);
  if (!artifacts) return shapeFailure("artifacts must be an array");
  const evidence = readEvidence(o.evidence);
  if (!evidence) return shapeFailure("evidence must be an array");
  const questions = readQuestions(o.questions);
  if (!questions) return shapeFailure("questions must be an array");
  return {
    ok: true,
    deliverable: {
      version: 1,
      summary,
      draftText,
      artifacts: artifacts.rows,
      evidence: evidence.rows,
      disclosure,
      confidence,
      questions: questions.rows,
    },
    dropped: { artifacts: artifacts.dropped, evidence: evidence.dropped, questions: questions.dropped },
  };
}

/** Parse a specialist's run output into a GigDeliverable. `no_output` for an absent or
 *  blank output; `no_deliverable_block` when the run never produced the fenced block;
 *  `invalid_json` when the LAST block is not JSON (an earlier valid block is NOT used
 *  as a fallback - see the header); `invalid_shape` when the JSON is not a deliverable. */
export function parseGigDeliverable(outputData: string | null): ParseGigDeliverableResult {
  if (typeof outputData !== "string" || !outputData.trim()) return { ok: false, reason: "no_output" };
  const block = lastDeliverableBlock(outputData);
  if (block === null) return { ok: false, reason: "no_deliverable_block" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (e) {
    return { ok: false, reason: "invalid_json", detail: e instanceof Error ? e.message.slice(0, 200) : undefined };
  }
  return validateGigDeliverable(parsed);
}
