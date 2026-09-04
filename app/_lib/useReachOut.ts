"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { capabilityAwareReason, useErrorMessage } from "./use-error-message";
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
//
// THE FAILURE IS DATA, NOT PROSE. This hook was the last of the pair still
// painting `payload?.error ?? "..."` — the server's canonical ENGLISH sentence,
// straight onto a Czech, German or French surface — which is the exact inverted
// fallback chain useAddToPipeline was fixed for (88013253). Post-fix a failure
// carries the machine facts only: a delivery `suppression` the server named, or
// the route's refusal `code` + `capability` + HTTP `status`. The rendering
// hook folds those through `useErrorMessage`/`capabilityAwareReason` in the
// reader's language; the English still exists where it belongs, in the log.
export type ReachOutResult =
  | { ok: true; note: "sent" | "already_sent" }
  | ReachOutFailure;

export type ReachOutFailure = {
  ok: false;
  /** Which DELIVERY refusal the 200 named (the dispatch was declined, not the
   *  call), or null when the call itself failed. */
  suppression: "anonymized" | "suppressed" | null;
  /** The route's machine refusal, rendered through `errors.<CODE>`. Null on a
   *  200-with-suppression and on a transport blip. */
  code: string | null;
  /** The capability a FORBIDDEN_CAPABILITY refusal wanted — data for the
   *  localized sentence, never a sentence itself. */
  capability: string | null;
  /** Lets a caller tell a refusal (403) from a fault (500) and either from a
   *  transport blip (null). */
  status: number | null;
};

const suppressed = (kind: "anonymized" | "suppressed"): ReachOutFailure => ({
  ok: false,
  suppression: kind,
  code: null,
  capability: null,
  status: 200,
});

export function reachOutVerdict(applied: unknown): ReachOutResult {
  if (applied === "already_sent") return { ok: true, note: "already_sent" };
  if (applied === "suppressed_anonymized") return suppressed("anonymized");
  if (typeof applied === "string" && applied.startsWith("suppressed")) {
    // The server collapses every non-consent refusal (an expired consent, a
    // stopped/answered outreach sequence) into this one token, so the sentence
    // names both rather than asserting a reason we can't tell apart from here.
    return suppressed("suppressed");
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
    const payload = (await r.json().catch(() => null)) as
      | { error?: string; code?: string; capability?: string; suppressed?: unknown; applied?: unknown }
      | null;
    if (!r.ok) {
      // The route's own GDPR pre-check (409) names WHICH suppression in a
      // `suppressed` field beside its English prose — carry the token, drop the
      // prose, and the 409 reads exactly like the 200-with-suppression does.
      if (payload?.suppressed === "anonymized") return suppressed("anonymized");
      if (typeof payload?.suppressed === "string" && payload.suppressed) return suppressed("suppressed");
      return {
        ok: false,
        suppression: null,
        code: payload?.code ?? null,
        capability: payload?.capability ?? null,
        status: r.status,
      };
    }
    return reachOutVerdict(payload?.applied);
  } catch {
    // A thrown fetch is a transport blip, not a verdict: no code, no status. The
    // caller's own localized line is the honest thing to show, and the browser
    // has already logged the network error itself.
    return { ok: false, suppression: null, code: null, capability: null, status: null };
  }
}

export function useReachOut(jobId: string, source?: string | null) {
  // Same resolution chain as useAddToPipeline: the refusal is rendered from its
  // CODE in the reader's language, and the per-surface sentence is only the
  // FALLBACK for a failure that carries none.
  const t = useTranslations("pipeline.reachOut");
  const errMsg = useErrorMessage();
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
      setAnnounce(t(result.note === "sent" ? "sent" : "alreadySent", { name: c.candidateLabel }));
    } else {
      // A DELIVERY refusal (the 200 said the dispatch was declined) has its own
      // sentence; anything else folds code + capability through the catalog.
      const reason = result.suppression
        ? t(`suppressed.${result.suppression}`)
        : capabilityAwareReason(errMsg, result, t("failed", { name: c.candidateLabel }));
      setFailed((m) => new Map(m).set(c.candidateId, reason));
      setAnnounce(t("failedAnnounce", { name: c.candidateLabel, reason }));
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
