// Wire type + prior-kind style map for the JobsRediscoveryFeed split —
// extracted verbatim so the feed file stays under the 200-line split threshold.

export type Alert = {
  id: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  // `stage`/`depth` are null for legacy rows persisted before feed-tells-why — those
  // fall back to the legacy English `label`; newer rows carry the live prior shape so
  // the feed rebuilds the same localized why-now the panel renders.
  // `kind` is the closed prior union (mirrors Rediscovered.prior.kind) so the
  // whyNow.{kind} message key type-checks as an exact key, not `whyNow.${string}`.
  prior: { kind: "rejected" | "closed" | "elsewhere"; label: string; stage: string | null; depth: number | null };
};

export const PRIOR_STYLE: Record<string, string> = {
  rejected: "bg-coral/10 text-coral",
  closed: "bg-dial-amber/20 text-ink",
  elsewhere: "bg-steel/10 text-steel",
};
