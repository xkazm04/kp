"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { capabilityAwareReason, useErrorMessage } from "./use-error-message";
import type { GithubEvidenceSummary } from "./github-summary";

// One canonical optimistic "add this candidate to the pipeline" flow. Both the
// recruiter-candidates surface and the rediscovery panel hand-rolled an identical
// POST /api/pipeline (stage Screened) plus added/adding/failed state, an aria-live
// announce string, and retry handling — and had already drifted in their state
// representation (Set+Map vs Record<string,boolean>) and in whether they guarded a
// double-add. This hook is the single source so the accessibility string and the
// error handling can't diverge again, and the other call sites (CandidateDrawer,
// Results, DecisionsTab) can adopt it later.

// The per-candidate fields the POST needs. roleFamily is optional — the recruiter
// candidates surface carries one, rediscovery doesn't (the API coalesces a missing
// value to null either way, so omitting it is equivalent to sending null).
export type PipelineAddInput = {
  candidateId: string;
  candidateLabel: string;
  archetype: string | null;
  matchScore: number | null;
  roleFamily?: string | null;
  // GH2 — compact GitHub evidence summary to attach to the entry (only the
  // report surface carries one; every other add surface omits it).
  github?: GithubEvidenceSummary | null;
  // d95fed6d — which surface filed this candidate ("match", "matrix",
  // "analyze", "sourcing"…). Persisted as the entry's source_channel so the
  // drawer can answer "where did this person come from" and analytics can
  // attribute outcomes. Omitted = unattributed (legacy behavior).
  source?: string | null;
};

export type AddToPipeline = {
  add: (c: PipelineAddInput) => Promise<void>;
  /** Has this candidate been added in this session? */
  added: (candidateId: string) => boolean;
  /** Is this candidate's add request in flight? */
  adding: (candidateId: string) => boolean;
  /** The last add error for this candidate, or null. */
  error: (candidateId: string) => string | null;
  /** aria-live message for the latest add outcome. */
  announce: string;
};

// The exact POST body both surfaces sent. stage is always "Screened" and roleFamily
// is always present (null when absent) so the body shape is fixed regardless of the
// caller — the API reads `roleFamily ?? null`, so null and omitted are equivalent.
export function pipelineAddBody(jobId: string, jobTitle: string, c: PipelineAddInput) {
  return {
    candidateId: c.candidateId,
    candidateLabel: c.candidateLabel,
    archetype: c.archetype ?? null,
    roleFamily: c.roleFamily ?? null,
    jobId,
    jobTitle,
    matchScore: c.matchScore ?? null,
    stage: "Screened" as const,
    ...(c.github ? { github: c.github } : {}),
    ...(c.source ? { source: c.source } : {}),
  };
}

// The network call, factored out as a pure async function so the error handling the
// two copies kept re-implementing — a non-OK status, a body carrying `{ error }`, a
// non-JSON (HTML 500) response, and a thrown network error — lives and is tested in
// one place. Returns a discriminated result; never throws.
export type PipelineAddFailure = {
  ok: false;
  /** The machine refusal the UI renders through `errors.<CODE>` (useErrorMessage),
   *  null when the door answered prose only. THIS is what a client reads. */
  code: string | null;
  /** The capability a FORBIDDEN_CAPABILITY refusal wanted (wave 18a ships it beside
   *  the code) — data for the localized sentence, never a sentence itself. */
  capability: string | null;
  /** The HTTP status, so a caller can tell a refusal (403) from a fault (500), and
   *  a transport blip (null) from either. */
  status: number | null;
};
// There is deliberately NO `message` here any more. It carried the server's
// canonical ENGLISH "as a last-resort fallback", and all three remaining call sites
// used it as the FIRST resort — painting an English sentence onto a Czech, German or
// French surface while the coded half sat unread beside it. A caller now folds
// `code`/`capability` through capabilityAwareReason and supplies its own localized
// fallback; the English still exists where it belongs, in the server log.

export async function postPipelineAdd(
  jobId: string,
  jobTitle: string,
  c: PipelineAddInput
): Promise<{ ok: true } | PipelineAddFailure> {
  try {
    const r = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pipelineAddBody(jobId, jobTitle, c)),
    });
    const payload = (await r.json().catch(() => null)) as { error?: string; code?: string; capability?: string } | null;
    if (!r.ok) {
      return {
        ok: false,
        code: payload?.code ?? null,
        capability: payload?.capability ?? null,
        status: r.status,
      };
    }
    return { ok: true };
  } catch {
    // A thrown fetch is a transport blip, not a verdict: no code, no status. The
    // caller's own localized "couldn't add" line is the honest thing to show, and
    // the browser has already logged the network error itself.
    return { ok: false, code: null, capability: null, status: null };
  }
}

// The mutating action POST against a single entry (`/api/pipeline/[id]`), factored
// out so the transport wiring (the encoded id, method, headers, JSON body) the four
// move/decide call sites kept hand-rolling lives in one place. Each caller passes its
// OWN body — crucially its per-caller `expectedStage` CAS value, which is intentional
// and stays at the call site — and keeps its own distinct success/error handling
// (some read `data.error`, the bulk loops only check `r.ok`), so this returns the raw
// Response rather than a parsed result.
export type PipelineActionBody =
  | { action: "set_stage"; toStage: string; expectedStage: string }
  | { action: "accept" | "reject"; expectedStage: string };

export function postPipelineAction(id: string, body: PipelineActionBody): Promise<Response> {
  return fetch(`/api/pipeline/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// One canonical batch move/decide POST against `/api/pipeline/batch` — the board's
// bulk move + bulk accept/reject in ONE round trip instead of N serial per-entry
// POSTs. Each item carries its OWN expectedStage CAS (the stage the board showed
// for THAT card); the server runs each as an isolated per-id transaction and
// reports a per-id outcome. Returns a discriminated result: `ok:false` is a
// WHOLE-REQUEST failure (the call was refused or fell over — the caller treats
// every item as retryable), `ok:true` carries the per-id `results` (each ok, or
// failed + the server's verbatim reason). Never throws.
//
// A whole-request refusal (batch-authz-parity: the operator gate returns 401/403
// with no per-id `results`) is NOT a per-id outcome, so it carries `status` back
// to the caller — the board renders a readable "not permitted" line rather than a
// blank count or a fabricated per-id reason. `status` is absent on a genuine
// transport blip (fetch threw / no response).
export type PipelineBatchItem =
  | { id: string; action: "set_stage"; toStage: string; expectedStage: string }
  | { id: string; action: "accept" | "reject"; expectedStage: string };
/** `code` is the machine refusal the UI renders (errors.<CODE>, in the reader's
 *  language); `reason` is the canonical English beside it, kept for the log and
 *  as a last-resort fallback. The bar must never paint `reason`. */
export type PipelineBatchOutcome = { id: string; ok: boolean; code?: string; reason?: string };
/** A whole-request refusal: `code` is the machine reason (the capability gate's
 *  FORBIDDEN_CAPABILITY, wave 18a) and `capability` the permission it wanted, so the
 *  bar can say WHICH permission is missing instead of a flat "not permitted". Both
 *  absent on a transport blip. */
export type PipelineBatchResult =
  | { ok: true; results: PipelineBatchOutcome[] }
  | { ok: false; status?: number; code?: string | null; capability?: string | null };

export async function postPipelineBatch(items: PipelineBatchItem[]): Promise<PipelineBatchResult> {
  try {
    const r = await fetch("/api/pipeline/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const d = (await r.json().catch(() => null)) as
      | { results?: PipelineBatchOutcome[]; code?: string; capability?: string }
      | null;
    if (r.ok && Array.isArray(d?.results)) return { ok: true, results: d.results };
    return { ok: false, status: r.status, code: d?.code ?? null, capability: d?.capability ?? null };
  } catch {
    return { ok: false };
  }
}

/** Moved to app/_lib/use-error-message.ts, beside the rule it implements — eight
 *  surfaces import this fold and only two of them add a candidate. Re-exported here
 *  for ONE wave so the existing importers keep resolving; import it from
 *  `use-error-message` in new code. */
export { capabilityAwareReason };

export function useAddToPipeline(jobId: string, jobTitle: string, source?: string | null): AddToPipeline {
  // The refusal is rendered from its CODE in the reader's language; the server's
  // English `message` never reaches the card or the aria-live line again.
  const t = useTranslations("pipeline.add");
  const errMsg = useErrorMessage();
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Map<string, string>>(() => new Map());
  const [announce, setAnnounce] = useState("");

  const add = async (c: PipelineAddInput) => {
    // Guard a double-add: no id, already added, or already in flight. The recruiter
    // surface guarded; rediscovery relied only on the button disabling. Folding the
    // guard in is strictly safer for both.
    if (!c.candidateId || added.has(c.candidateId) || adding.has(c.candidateId)) return;
    setAdding((s) => new Set(s).add(c.candidateId));
    setFailed((m) => {
      if (!m.has(c.candidateId)) return m;
      const n = new Map(m);
      n.delete(c.candidateId);
      return n;
    });
    // The surface's source rides every add unless the caller set one per-candidate.
    const result = await postPipelineAdd(jobId, jobTitle, { source, ...c });
    if (result.ok) {
      setAdded((s) => new Set(s).add(c.candidateId));
      setAnnounce(t("added", { name: c.candidateLabel }));
    } else {
      const reason = capabilityAwareReason(errMsg, result, t("failed", { name: c.candidateLabel }));
      setFailed((m) => new Map(m).set(c.candidateId, reason));
      setAnnounce(t("failedAnnounce", { name: c.candidateLabel, reason }));
    }
    setAdding((s) => {
      const n = new Set(s);
      n.delete(c.candidateId);
      return n;
    });
  };

  return {
    add,
    added: (id) => added.has(id),
    adding: (id) => adding.has(id),
    error: (id) => failed.get(id) ?? null,
    announce,
  };
}
