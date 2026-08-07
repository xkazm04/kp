"use client";

import { useState } from "react";
import type { PipelineAddInput } from "./useAddToPipeline";

// The optimistic "reach out to this candidate" flow for the sourcing surfaces
// (recruiter candidate ranking + talent rediscovery). Mirrors useAddToPipeline's
// shape (per-candidate reached/reaching/error sets + an aria-live announce) so the
// two affordances read and behave consistently side by side. It POSTs to
// /api/jobs/[id]/candidates/outreach, which files the candidate into the pipeline
// AND dispatches a first-touch outreach in one server call (both idempotent), so a
// "reach out" is also implicitly an "add to pipeline".
// `source` is the sourcing channel the surface files under (d95fed6d) — e.g.
// "sourcing" for the recruiter candidate ranking + rediscovery panel. It rides the
// POST so the reach-out's minted entry gets an honest source_channel (matching the
// surface's "add to pipeline" button), instead of landing unattributed like it did
// before. Omitted = unattributed (legacy behavior preserved).
export function useReachOut(jobId: string, source?: string | null) {
  const [reached, setReached] = useState<Set<string>>(() => new Set());
  const [reaching, setReaching] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Map<string, string>>(() => new Map());
  const [announce, setAnnounce] = useState("");

  const reach = async (c: PipelineAddInput) => {
    if (!c.candidateId || reached.has(c.candidateId) || reaching.has(c.candidateId)) return;
    setReaching((s) => new Set(s).add(c.candidateId));
    setFailed((m) => {
      if (!m.has(c.candidateId)) return m;
      const n = new Map(m);
      n.delete(c.candidateId);
      return n;
    });
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/candidates/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: c.candidateId,
          candidateLabel: c.candidateLabel,
          archetype: c.archetype ?? null,
          matchScore: c.matchScore ?? null,
          roleFamily: c.roleFamily ?? null,
          // Per-candidate source wins if set; else the surface's default. Omitted
          // (both null) sends nothing, so the route keeps the unattributed default.
          ...(c.source ?? source ? { source: c.source ?? source } : {}),
        }),
      });
      const payload = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(payload?.error ?? `Couldn't reach out (${r.status}).`);
      setReached((s) => new Set(s).add(c.candidateId));
      setAnnounce(`Reached out to ${c.candidateLabel} — added to the pipeline and a first-touch message is on its way.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Couldn't reach out.";
      setFailed((m) => new Map(m).set(c.candidateId, message));
      setAnnounce(`Couldn't reach out to ${c.candidateLabel}. ${message}`);
    } finally {
      setReaching((s) => {
        const n = new Set(s);
        n.delete(c.candidateId);
        return n;
      });
    }
  };

  return {
    reach,
    reached: (id: string) => reached.has(id),
    reaching: (id: string) => reaching.has(id),
    error: (id: string) => failed.get(id) ?? null,
    announce,
  };
}
