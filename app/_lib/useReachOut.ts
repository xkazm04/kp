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

// The route answers 200 with the automation's `applied` verdict, and a 200 does
// NOT mean a message went out: the dispatch is gated on a durable per-entry
// `outreach_sent` marker (a repeat click ⇒ "already_sent") and on the consent /
// sequence-halt gates inside dispatchOutreach (⇒ "suppressed_*", nothing queued,
// nothing relayed). Announcing "a first-touch message is on its way" off `r.ok`
// alone was exactly the green lie the delivery-truth doctrine forbids
// (app/_lib/comms-truth.ts) — the recruiter walked away believing a candidate had
// been contacted when the server had refused to contact them. Classify the verdict
// instead. An absent/unknown `applied` keeps the optimistic reading: only the
// verdicts we can name change behaviour.
export type ReachOutResult =
  | { ok: true; note: "sent" | "already_sent" }
  | { ok: false; message: string };

export function reachOutVerdict(applied: unknown): ReachOutResult {
  if (applied === "already_sent") return { ok: true, note: "already_sent" };
  if (applied === "suppressed_anonymized") {
    return { ok: false, message: "No message was sent — this candidate has been anonymized." };
  }
  if (typeof applied === "string" && applied.startsWith("suppressed")) {
    // The server collapses every non-consent refusal (an expired consent, a
    // stopped/answered outreach sequence) into this one token, so the wording
    // names both rather than asserting a reason we can't tell apart from here.
    return {
      ok: false,
      message: "No message was sent — outreach to this candidate is suppressed (consent lapsed, or the sequence was stopped).",
    };
  }
  return { ok: true, note: "sent" };
}

// The network call, factored out as a pure async function (mirroring
// useAddToPipeline's postPipelineAdd) so the transport + the delivery verdict are
// testable without a React renderer. Never throws.
export async function postReachOut(
  jobId: string,
  c: PipelineAddInput,
  source?: string | null
): Promise<ReachOutResult> {
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
    const payload = (await r.json().catch(() => null)) as { error?: string; applied?: unknown } | null;
    if (!r.ok) return { ok: false, message: payload?.error ?? `Couldn't reach out (${r.status}).` };
    return reachOutVerdict(payload?.applied);
  } catch (caught) {
    return { ok: false, message: caught instanceof Error ? caught.message : "Couldn't reach out." };
  }
}

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
    const result = await postReachOut(jobId, c, source);
    if (result.ok) {
      // Both verdicts leave the candidate filed AND contacted for this role, so
      // the affordance settles into its done state either way — but only a real
      // dispatch may claim a message is on its way.
      setReached((s) => new Set(s).add(c.candidateId));
      setAnnounce(
        result.note === "sent"
          ? `Reached out to ${c.candidateLabel} — added to the pipeline and a first-touch message is on its way.`
          : `${c.candidateLabel} is in the pipeline and was already contacted for this role — no new message was sent.`
      );
    } else {
      setFailed((m) => new Map(m).set(c.candidateId, result.message));
      setAnnounce(`Couldn't reach out to ${c.candidateLabel}. ${result.message}`);
    }
    setReaching((s) => {
      const n = new Set(s);
      n.delete(c.candidateId);
      return n;
    });
  };

  return {
    reach,
    reached: (id: string) => reached.has(id),
    reaching: (id: string) => reaching.has(id),
    error: (id: string) => failed.get(id) ?? null,
    announce,
  };
}
