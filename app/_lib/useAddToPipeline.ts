"use client";

import { useState } from "react";

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
  };
}

// The network call, factored out as a pure async function so the error handling the
// two copies kept re-implementing — a non-OK status, a body carrying `{ error }`, a
// non-JSON (HTML 500) response, and a thrown network error — lives and is tested in
// one place. Returns a discriminated result; never throws.
export async function postPipelineAdd(
  jobId: string,
  jobTitle: string,
  c: PipelineAddInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const r = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pipelineAddBody(jobId, jobTitle, c)),
    });
    const payload = (await r.json().catch(() => null)) as { error?: string } | null;
    if (!r.ok) return { ok: false, message: payload?.error ?? `Couldn't add (${r.status}).` };
    return { ok: true };
  } catch (caught) {
    return { ok: false, message: caught instanceof Error ? caught.message : "Couldn't add to the pipeline." };
  }
}

export function useAddToPipeline(jobId: string, jobTitle: string): AddToPipeline {
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
    const result = await postPipelineAdd(jobId, jobTitle, c);
    if (result.ok) {
      setAdded((s) => new Set(s).add(c.candidateId));
      setAnnounce(`${c.candidateLabel} added to the pipeline.`);
    } else {
      setFailed((m) => new Map(m).set(c.candidateId, result.message));
      setAnnounce(`Couldn't add ${c.candidateLabel} to the pipeline. ${result.message}`);
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
