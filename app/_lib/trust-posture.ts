// W0.5 — the public trust surface's DATA. Rendered by app/trust/, kept here so the
// claims are single-sourced, unit-testable, and reviewable as text rather than buried
// in JSX.
//
// WHY THIS PAGE EXISTS, AND WHY IT ADMITS GAPS
// Competitors publish "EU AI Act compliant" as a badge. A badge is unfalsifiable, and a
// procurement reviewer knows it. kp's differentiator is that its compliance claims are
// checkable — so this page states, article by article, what is ENFORCED IN CODE, what is
// PARTIAL, and what is NOT YET BUILT. A page that admits three gaps is worth more to a
// serious buyer than one that admits none, and it is the only version we can defend when
// they ask for evidence.
//
// Source of truth: docs/AI_ACT_CONFORMITY.md (compiled against the repo, with file:line
// evidence). This module carries the PUBLIC projection: the posture and the plain-English
// summary, never the internal evidence paths or the gap ids.
//
// Pure data + types. No DB, no server imports.

export type Posture = "enforced" | "partial" | "not_yet";

export type ObligationRow = {
  /** e.g. "Art. 14" — the article, not a marketing label. */
  article: string;
  title: string;
  posture: Posture;
  /** What actually exists, in a sentence a non-engineer can check us on. */
  summary: string;
  /** Stated plainly when the posture is not "enforced". Empty otherwise. */
  gap?: string;
};

/** Classification is the first thing a reviewer looks for, and the first place vendors
 *  hedge. kp screens, scores, ranks and interviews candidates: Annex III point 4. */
export const CLASSIFICATION = {
  annex: "Annex III, point 4 (employment, workers management, access to self-employment)",
  conclusion: "kp is a high-risk AI system.",
  // Art. 6(3)'s "narrow procedural task" derogation is the standard escape hatch. Saying
  // out loud that it does not apply is a stronger signal than any badge.
  derogation:
    "The Art. 6(3) derogation for narrow procedural or preparatory tasks does not apply: the score is designed to shape advance and reject outcomes.",
  providerRole: "The kp vendor is the provider (Art. 16). A customer running kp on their candidates is a deployer (Art. 26). A self-hosted install that substantially modifies the system makes that customer a provider too.",
  appliesFrom: "2 August 2026",
} as const;

export const OBLIGATIONS: readonly ObligationRow[] = [
  {
    article: "Art. 9",
    title: "Risk-management system",
    posture: "not_yet",
    summary: "No risk register, DPIA or residual-risk analysis is published yet.",
    gap: "A documented, maintained risk-management system is outstanding. It is scheduled, not shipped.",
  },
  {
    article: "Art. 10",
    title: "Data & data governance",
    posture: "partial",
    summary:
      "Consent is captured before any AI reads candidate data, expires on a configured TTL, gates PII reads and suppresses outreach; erasure runs as one transaction across transcripts, scorecards and the outbox. An offline mode blocks all model egress for self-hosted installs.",
    gap: "No published governance artifact for training and seed data.",
  },
  {
    article: "Art. 11 + Annex IV",
    title: "Technical documentation",
    posture: "not_yet",
    summary: "The Annex IV skeleton exists internally; the model card and deployer instructions-for-use are not published.",
    gap: "Instructions-for-use — the document that tells a deployer their own obligations — is outstanding.",
  },
  {
    article: "Art. 12",
    title: "Record-keeping",
    posture: "enforced",
    summary:
      "Every decision is sealed into a per-tenant, tamper-evident hash chain (HMAC-SHA256, key rotation, anti-downgrade). Each record carries the acting party — distinguishing an automated actor from a named human — the policy and prompt version, the candidate reference, the rationale and the decisive inputs. Group evaluations additionally seal the model's own reasoning about the candidate it ranked first.",
    gap: "A separate audit log for authentication, configuration and export events, and signed SIEM export, are outstanding.",
  },
  {
    article: "Art. 13",
    title: "Transparency",
    posture: "partial",
    summary:
      "Candidates are told an AI is involved before it reads their data, can see the decisions recorded about them, and can request or erase their data through a token link. A provenance dossier records how each data point was derived.",
    gap: "Deployer-facing instructions-for-use are outstanding (see Art. 11).",
  },
  {
    article: "Art. 14",
    title: "Human oversight",
    posture: "enforced",
    summary:
      "No candidate is rejected, advanced or offered by the machine alone. Bulk rejections need a signed human approval that the server recomputes and refuses if the cohort drifted; unattended automation queues rejections for a person rather than executing them; advance-top-N stops before Offer; governed evaluation modes cannot be downgraded to auto-seal; a kill switch arms and confirms separately.",
  },
  {
    article: "Art. 15",
    title: "Accuracy, robustness, security",
    posture: "partial",
    summary:
      "Scores are calibrated against outcomes with an honesty floor and per-source label-leakage disclosure; a deterministic clean-arm holdout is sealed and read back; threshold changes are sealed as human policy acts; unevidenced skill claims are discounted for every candidate alike; a name-neutrality invariant is tested across Czech, Vietnamese, Ukrainian, Arabic and Roma names.",
    gap: "Post-market drift monitoring beyond in-product display is outstanding.",
  },
  {
    article: "Art. 26",
    title: "Deployer obligations",
    posture: "partial",
    summary: "The product operationalizes the deployer's duties: named oversight assignment, logs that are never pruned, and the candidate information duties.",
    gap: "Until instructions-for-use ships, deployers must determine their own duties — worker-representative notification, fundamental-rights impact assessment for public bodies, and log retention of at least six months.",
  },
] as const;

export type Subprocessor = {
  name: string;
  purpose: string;
  /** True when the customer can run kp without this processor ever being engaged. */
  optional: boolean;
};

// Honest scope note: kp routes to whichever engines the CUSTOMER configures, so this is
// the set kp can engage, not a set it always does. Self-hosted installs can reduce it to
// nothing external (KP_OFFLINE blocks egress in both the TS and Python halves).
export const SUBPROCESSORS: readonly Subprocessor[] = [
  { name: "Anthropic", purpose: "Text model for analysis, reasoning and evaluation", optional: true },
  { name: "OpenAI", purpose: "Text model; realtime voice interviews", optional: true },
  { name: "Google (Gemini)", purpose: "Document/CV analysis and web-grounded salary lookups", optional: true },
  { name: "Azure OpenAI", purpose: "Text model on the customer's own Azure deployment", optional: true },
  { name: "OpenRouter", purpose: "Model proxy when the customer routes through it", optional: true },
  { name: "ElevenLabs", purpose: "Voice interview speech", optional: true },
  { name: "Polar", purpose: "Subscription billing and checkout", optional: true },
  { name: "Customer-configured mail relay", purpose: "Candidate email delivery; with none configured, messages stay in a local outbox and are never sent", optional: true },
  { name: "Self-hosted model server", purpose: "On-box or in-VPC model (Ollama, vLLM, an OpenAI-compatible proxy)", optional: true },
];

export const DATA_RIGHTS = [
  "Candidate data is never sold or shared, and is never used to train models.",
  "Provider API keys are stored write-only and encrypted at rest; they never round-trip to a browser.",
  "Every candidate gets a token link to see the data and the decisions held about them, and to request erasure.",
  "Erasure runs as a single transaction across the profile, transcripts, scorecards and the outbox.",
  "An offline mode blocks all model egress, for air-gapped and in-VPC installs.",
] as const;

/** The disclaimer is not boilerplate — the internal pack carries the same sentence, and a
 *  page that claimed certified conformance while listing open gaps would be incoherent. */
export const DISCLAIMER =
  "This is an engineering artifact, not legal advice, and not a claim of certified conformance. It describes mechanisms that exist in the product today, and states plainly where they do not yet exist.";

const ORDER: Record<Posture, number> = { not_yet: 0, partial: 1, enforced: 2 };

/** Counts by posture — the page leads with these so a reader sees the shape before the
 *  detail, and cannot come away thinking every row is green. */
export function postureSummary(rows: readonly ObligationRow[] = OBLIGATIONS): Record<Posture, number> {
  const out: Record<Posture, number> = { enforced: 0, partial: 0, not_yet: 0 };
  for (const r of rows) out[r.posture] += 1;
  return out;
}

/** Weakest first. A trust page that opens with its strongest row is a sales page; the
 *  reader's question is "what is missing", so answer it first. */
export function byWeakestFirst(rows: readonly ObligationRow[] = OBLIGATIONS): ObligationRow[] {
  return [...rows].sort((a, b) => ORDER[a.posture] - ORDER[b.posture] || a.article.localeCompare(b.article));
}
