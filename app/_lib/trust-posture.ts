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
// Source of truth: docs/features/compliance/ai-act-conformity.md (compiled against the repo, with file:line
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
  conclusion: "KandiDate is a high-risk AI system.",
  // Art. 6(3)'s "narrow procedural task" derogation is the standard escape hatch. Saying
  // out loud that it does not apply is a stronger signal than any badge.
  derogation:
    "The Art. 6(3) derogation for narrow procedural or preparatory tasks does not apply: the score is designed to shape advance and reject outcomes. That covers the job-description builder too — it derives the required qualifications itself and then feeds the scorer that ranks CVs against them, which is not a narrow procedural task.",
  providerRole: "The KandiDate vendor is the provider (Art. 16). A customer running KandiDate on their candidates is a deployer (Art. 26). A self-hosted install that substantially modifies the system makes that customer a provider too. Being open-source changes none of it: Art. 2(12) does not exempt a high-risk system, and distributing free of charge is still placing on the market.",
  // MOVED, and this page said the old date for six weeks after it moved. Regulation
  // (EU) 2026/1744 — the AI Omnibus, in force 27 July 2026 — deferred the Annex III
  // high-risk obligations from 2 August 2026 to 2 December 2027. Verified 2026-09-08
  // against the Commission's own page (digital-strategy.ec.europa.eu, "Regulatory
  // framework on AI"), not against a summary.
  //
  // The deferral is a runway, not a reprieve, and it is NOT a general one — see
  // `inForceNow` for the parts that bind today. Naming the amending act is itself the
  // credibility signal: a reader can check it.
  appliesFrom: "2 December 2027",
  deferredBy: "Regulation (EU) 2026/1744 (the AI Omnibus), in force 27 July 2026, moved this from 2 August 2026.",
  inForceNow:
    "Three parts of the Act were not deferred and bind today: the Art. 5 prohibitions (since 2 February 2025), the Art. 50 transparency duties (since 2 August 2026, with synthetic-content marking required from 2 December 2026), and Art. 4 AI literacy. GDPR and national employment law were never on this clock at all.",
} as const;

export const OBLIGATIONS: readonly ObligationRow[] = [
  {
    // The table used to start at Art. 9 — i.e. it opened at the obligations that were
    // still 15 months away and never mentioned the one part of the Act that has been
    // enforceable since February 2025. Art. 5 is also the article kp most cleanly
    // satisfies, and a breach of it is uncurable: no oversight gate, no disclosure and
    // no human review saves a system that infers emotion in a hiring context.
    article: "Art. 5",
    title: "Prohibited practices",
    posture: "enforced",
    summary:
      "KandiDate does not infer emotions, and the design makes it hard to start. Voice interviews persist a transcript and never the audio, so no tone, pace or hesitation signal reaches scoring at all; the rubric scores stated competencies against verbatim evidence quotes; and the scorecard prompt instructs the model to rate substance and never to lower a rating for nerves, filler words, silences or an accent. It also runs no biometric categorisation and holds no demographic data.",
  },
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
    // THIS ROW USED TO OVER-CLAIM, on the one line a procurement reviewer reads most
    // closely. It asserted "tamper-evident … HMAC-SHA256, key rotation, anti-downgrade"
    // unconditionally, while the engineering doc said the opposite is the DEFAULT: the
    // seal is HMAC-SHA256 only when KP_DECISION_HMAC_KEY is set, and the reference
    // deploy does not set it. Keyless rows carry key_id "" and a plain SHA-256, which
    // decision-record-store.test.ts pins as "a keyless chain ACCEPTS an insider
    // re-hash". The strength is a deployment property, so the sentence has to be
    // conditional — the mechanism is enforced, the KEYING is the operator's act.
    // The truncation limit is stated for the same reason: verifyDecisionChain holds no
    // head or length commitment, so deleting the newest rows still verifies ok:true.
    summary:
      "Every decision is sealed into a per-tenant hash chain. Each record carries the acting party — distinguishing an automated actor from a named human — the policy and prompt version, the candidate reference, the rationale and the decisive inputs. A bulk rejection wave will not seal at all where the deployment cannot name the person who approved it, and the audit table marks every record whose actor is a role rather than a person. Group evaluations additionally seal the model's own reasoning about the candidate it ranked first. Where the operator configures a signing key the chain is HMAC-SHA256 with key rotation and downgrade protection; with no key configured it is a plain hash chain, and the product reports which of the two a given chain actually has rather than assuming the stronger one.",
    gap: "Two limits a reviewer should know. An unkeyed chain is integrity-evident but not tamper-resistant against someone with write access to the database, and the reference deployment ships unkeyed — turning the key on is an operator action that cannot retroactively re-seal existing records. Separately, the chain commits to no head or length, so truncating the newest records is not yet detectable at any key setting. A separate audit log for authentication, configuration and export events, and signed SIEM export, are also outstanding.",
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
    // The kill-switch clause used to read "a kill switch arms and confirms separately".
    // Both halves were false against the code, so both were corrected rather than
    // softened: the pause fires on a SINGLE click by deliberate design (an oversight
    // control that needs a second confirm cannot stop anything instantly — the
    // arm/confirm guard sits on Reconcile, which mutates lifecycle state), and it is
    // at the time read by the case-lifecycle orchestrator ONLY, not by the timed passes
    // the server clock drives. That scope gap has since been closed (instrumentation-node
    // now gates every discretionary pass on it), so the `gap` below states the ONE
    // remaining exemption rather than the old, much wider one. It is still stated as a
    // gap rather than implied away: a reviewer reading Art. 14 is looking for an
    // Art. 14(4)(e) stop control and must know exactly what it does not reach.
    // THE ABSOLUTE WAS FALSE IN TWO THIRDS, and is not softened here so much as
    // SPLIT. It used to open "No candidate is rejected, advanced or offered by the
    // machine alone". The rejection third holds and is the part worth claiming;
    // the other two do not, because Settings → Hiring exposes a per-stage gate and
    // `automation-run.ts` reads it (`getPlanGateForRole("screening"|"offer") ===
    // "auto"`). The landing page retired the same sentence on 2026-08-28 and this
    // one outlived it by a commit — which is exactly the divergence the test now
    // pins, off the SAME `INTERVIEW_PLAN_DEFAULT` both surfaces rest on.
    summary:
      "A rejection is always a person's: no gate can delegate one, unattended automation queues rejections for review rather than executing them, and a bulk rejection needs a signed human approval of that exact cohort — which the server recomputes and refuses if the set drifted, if the review went stale, or if it cannot name the approver. Advancing and extending an offer are human-approved by default: the shipped hiring plan gates every stage on a person. A workspace can delegate either of those two, stage by stage, and every step that then runs unattended is logged with the plan that allowed it. Advance-top-N stops before Offer; governed evaluation modes cannot be downgraded to auto-seal; and an operator can halt the automated case lifecycle on a single click, with no confirmation step in the way of stopping it.",
    gap: "That pause now halts every discretionary pass the server clock runs — the scheduling policy pass, interview and offer reminders, offer expiry, and the inbound pull/edge drain — as well as the automated case lifecycle. One pass is deliberately exempt: the consent-expiry anonymisation sweep keeps running, because it discharges a statutory retention duty (GDPR Art. 5(1)(e)) rather than making an automated decision, and holding identifiable data past consent expiry is itself the unlawful state — so an operator toggle must not be able to suspend it indefinitely.",
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
  {
    // UNDER-claimed, which costs as much credibility as over-claiming. kp ships a
    // candidate-facing explanation of an individual decision BEFORE the obligation
    // applies, derived from the sealed record rather than regenerated — so the
    // explanation and the audit trail cannot drift apart, which is the failure mode
    // this article exists to prevent. It was not on this page at all.
    article: "Art. 86",
    title: "Explanation of an individual decision",
    posture: "partial",
    summary:
      "A candidate who was rejected can read, on their own status link, what kind of decision was recorded, whether a person or an automated actor made it, the reason code, and — where an automated screening threshold decided it — the specific facts that put them the wrong side of it. That view is derived from the sealed decision record itself, not regenerated afterwards, so the explanation a candidate reads and the record an auditor reads cannot diverge. The rejection message a candidate receives is sourced from the same record.",
    gap: "Two limits. The full sealed dossier stays operator-gated, which is a deliberate design choice rather than an outstanding gap: it carries other people's data and the internal evidence chain. The real gap is narrower — where a record's actor cannot be classified as either a person or an automated system, the status page currently renders no attribution line at all, on the one surface built to answer \"was this decided by a machine?\".",
  },
  {
    // Art. 50 was missing from this table while being the one part of the Act with a
    // deadline inside 2026. It is also the article where the OPEN-SOURCE build is the
    // worse case rather than the safer one: a keyless self-hosted install speaks
    // through a local voice model that marks nothing at all.
    article: "Art. 50",
    title: "Transparency about AI interaction",
    posture: "partial",
    summary:
      "Candidates are told an AI is involved before it reads their data. The disclosure renders on every public candidate surface — both apply paths, the work-sample case, the voice interview, scheduling, the offer and the status page — and the voice portal additionally marks the conversation as AI-led. Voice interviews cannot start at all until consent is recorded, enforced on the server both when the credentials are minted and again when the transcript is persisted.",
    gap: "Synthetic-content marking under Art. 50(2) is not implemented. The AI interviewer generates synthetic speech and nothing in the product marks that audio as machine-generated in a machine-readable way; a self-hosted install using a local voice model is the most exposed case. This obligation is already in force, with the marking requirement landing on 2 December 2026.",
  },
] as const;

/** Does the processor use what kp sends it to train models, in the configuration kp
 *  actually produces? "depends_on_tier" is the honest answer where a free key and a
 *  billed key have materially different terms — which is the Gemini trap. */
export type TrainsOnInputs = "no" | "yes" | "yes_unless_opted_out" | "depends_on_tier";

/** Whether the processor can be reached in an EU region, and at what cost. */
export type EuRegion = "available" | "enterprise_only" | "not_offered" | "customer_tenant" | "self_hosted" | "n/a";

/** What class of data this processor can see. Presenting a billing processor and a
 *  model provider in one undifferentiated list overstates the first and understates
 *  the second. */
export type DataClass = "candidate_pii" | "operator_only" | "none";

export type Subprocessor = {
  name: string;
  purpose: string;
  /** True when the customer can run kp without this processor ever being engaged. */
  optional: boolean;
  /** What this processor can see. Not every row on this page handles candidate data. */
  dataClass: DataClass;
  trainsOnInputs: TrainsOnInputs;
  /** Plain-language retention, as the processor's own terms state it. */
  retention: string;
  euRegion: EuRegion;
  /** The Chapter V basis for a transfer out of the EEA, where one is needed. */
  transferBasis: "scc" | "dpf" | "eea" | "customer_owned" | "none" | "unknown";
  /** The day a human last opened this row's sources. A single page-level review date
   *  cannot express that one row was checked and another was not — which is exactly
   *  how the applicability date above stayed wrong through a review. */
  verifiedOn: string;
  /** Stated where a row's honest answer does not fit a column — the free-tier trap,
   *  the endpoint that decides the jurisdiction, the substitute that engages nobody. */
  note?: string;
  /** The `LLM_PROVIDERS` ids (llm-config.ts) this row discloses — empty for a row
   *  that is not a model route (billing, voice, mail). The trust page never renders
   *  these; they exist so a TEST can hold the table against the product's own
   *  provider list, which is how a `qwen` adapter shipped with no disclosure. Plain
   *  strings, not the imported union: this module is pure data with no server
   *  imports, and llm-config.ts pulls the DB slice. */
  providers: readonly string[];
};

// Honest scope note: kp routes to whichever engines the CUSTOMER configures, so this is
// the set kp can engage, not a set it always does. Self-hosted installs can reduce it to
// nothing external (KP_OFFLINE blocks egress in both the TS and Python halves).
export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: "Anthropic (API)",
    purpose: "Text model for analysis, reasoning and evaluation, on a commercial API key",
    optional: true,
    dataClass: "candidate_pii",
    trainsOnInputs: "no",
    retention: "30 days for abuse monitoring; longer for content its safety systems flag",
    euRegion: "not_offered",
    transferBasis: "scc",
    verifiedOn: "2026-09-08",
    note: "Processing is US or global; the first-party API offers no EU region, and KandiDate ships no adapter for the cloud resellers that do.",
    providers: ["anthropic"],
  },
  {
    // SPLIT OUT of the Anthropic row, because collapsing the two into one line hid a
    // materially different legal posture behind an identical name. The CLI runs under
    // whatever account the operator logged in with; on a consumer plan that means no
    // processing agreement at all and, unless the operator turned it off, training.
    name: "Anthropic (Claude Code CLI)",
    purpose: "The same models reached through the local Claude Code command-line tool instead of an API key",
    optional: true,
    dataClass: "candidate_pii",
    trainsOnInputs: "depends_on_tier",
    retention: "30 days on a business plan; five years on a personal plan with training left on",
    euRegion: "not_offered",
    transferBasis: "unknown",
    verifiedOn: "2026-09-08",
    note: "This route runs under the operator's own Anthropic account. A personal Free, Pro or Max subscription carries no data-processing agreement, excludes business use, and defaults to using inputs for training — so it belongs on a development machine, not on a deployment that reads real candidates.",
    providers: ["claude_cli"],
  },
  {
    name: "OpenAI",
    purpose: "Text model; realtime voice interviews",
    optional: true,
    dataClass: "candidate_pii",
    trainsOnInputs: "no",
    retention: "30 days for abuse monitoring; removable under an approved zero-retention agreement",
    euRegion: "available",
    transferBasis: "scc",
    verifiedOn: "2026-09-08",
    note: "European processing requires a Europe-region project; KandiDate does not select one for you.",
    providers: ["openai"],
  },
  {
    name: "Google (Gemini)",
    purpose: "Document/CV analysis and web-grounded salary lookups",
    optional: true,
    dataClass: "candidate_pii",
    trainsOnInputs: "depends_on_tier",
    retention: "Up to 55 days on a billed key; free-tier content is retained and reviewed",
    euRegion: "not_offered",
    transferBasis: "dpf",
    verifiedOn: "2026-09-08",
    note: "Read this row before uploading a real CV. On a FREE API key Google may use submitted content — including the CV file — to improve its products, and human reviewers may read it; operators in the EEA, Switzerland and the UK are covered by the paid terms even on a free key, and everyone else is not. KandiDate cannot tell the two kinds of key apart. This is also the one route that carries the whole CV file, and the web-grounded lookups on that path cannot be placed under a zero-retention agreement.",
    providers: ["gemini"],
  },
  {
    name: "Azure OpenAI",
    purpose: "Text model on the customer's own Azure deployment",
    optional: true,
    dataClass: "candidate_pii",
    trainsOnInputs: "no",
    retention: "30 days for abuse monitoring, or none under approved modified abuse monitoring",
    euRegion: "customer_tenant",
    transferBasis: "customer_owned",
    verifiedOn: "2026-09-08",
    note: "The strongest posture available here: the deployment is the customer's own, in the region they choose, under their own agreement with Microsoft. Candidate data never touches a KandiDate contract.",
    providers: ["azure_openai"],
  },
  {
    name: "OpenRouter",
    purpose: "Model proxy when the customer routes through it",
    optional: true,
    dataClass: "candidate_pii",
    trainsOnInputs: "no",
    retention: "Set by whichever provider serves the request, not by OpenRouter",
    euRegion: "enterprise_only",
    transferBasis: "unknown",
    verifiedOn: "2026-09-08",
    note: "A router, not a destination. It forwards to one of many upstream providers, so naming it does not name the company that actually processed a candidate's CV; an operator who routes through it has to enumerate and permit the downstream providers themselves.",
    providers: ["openrouter"],
  },
  // The disclosure gap the coverage test below this list was written for: a `qwen`
  // adapter shipped with a configurable remote endpoint and never reached the table.
  {
    name: "Qwen Cloud (Alibaba Cloud)",
    purpose:
      "Text model on the OpenAI-compatible endpoint the customer configures; pointed at a self-hosted Qwen endpoint it engages no third party",
    optional: true,
    dataClass: "candidate_pii",
    trainsOnInputs: "no",
    retention: "Not published in a form we could verify",
    euRegion: "available",
    transferBasis: "scc",
    verifiedOn: "2026-09-08",
    note: "The endpoint decides the jurisdiction. There is a Frankfurt region that keeps processing inside the EU; the mainland-China endpoints do not, and an operator pointing there should expect to justify it in their own transfer assessment.",
    providers: ["qwen"],
  },
  {
    name: "ElevenLabs",
    purpose: "Voice interview speech",
    optional: true,
    dataClass: "candidate_pii",
    trainsOnInputs: "yes_unless_opted_out",
    retention: "Two years by default for interview audio and transcripts, configurable per agent",
    euRegion: "enterprise_only",
    transferBasis: "scc",
    verifiedOn: "2026-09-08",
    note: "Interview audio lives in the operator's ElevenLabs account, not in KandiDate, so an erasure inside KandiDate does not reach it. Lower the agent's retention to match your consent window and turn audio saving off, or use the self-hosted voice route below.",
    providers: [],
  },
  {
    // Named because it answers the two ElevenLabs rows above outright, and because a
    // page that lists a processor without naming its substitute is only half honest.
    name: "Self-hosted voice server",
    purpose: "Speech recognition and synthesis on the operator's own hardware, in place of a hosted voice provider",
    optional: true,
    dataClass: "none",
    trainsOnInputs: "no",
    retention: "Whatever the operator's own storage keeps",
    euRegion: "self_hosted",
    transferBasis: "eea",
    verifiedOn: "2026-09-08",
    note: "Engages no third party. Voice interviews run against a local speech stack instead of a hosted one.",
    providers: [],
  },
  {
    name: "Polar",
    purpose: "Subscription billing and checkout",
    optional: true,
    dataClass: "operator_only",
    trainsOnInputs: "no",
    retention: "As their billing terms provide",
    euRegion: "not_offered",
    transferBasis: "scc",
    verifiedOn: "2026-09-08",
    note: "Sees the account holder's billing identity and never candidate data. It engages a payment processor of its own, in the United States and Ireland. Self-hosted installs are unmetered and engage it not at all.",
    providers: [],
  },
  {
    name: "Customer-configured mail relay",
    purpose: "Candidate email delivery; with none configured, messages stay in a local outbox and are never sent",
    optional: true,
    dataClass: "candidate_pii",
    trainsOnInputs: "no",
    retention: "Set by whichever relay the operator configures",
    euRegion: "customer_tenant",
    transferBasis: "customer_owned",
    verifiedOn: "2026-09-08",
    providers: [],
  },
  {
    name: "Self-hosted model server",
    purpose: "On-box or in-VPC model (Ollama, vLLM, an OpenAI-compatible proxy)",
    optional: true,
    dataClass: "none",
    trainsOnInputs: "no",
    retention: "Whatever the operator's own storage keeps",
    euRegion: "self_hosted",
    transferBasis: "eea",
    verifiedOn: "2026-09-08",
    note: "No candidate data leaves the operator's infrastructure. Pointing the same setting at a HOSTED endpoint instead re-engages a third party that this table cannot name for you.",
    providers: ["ollama"],
  },
];

/** The day a human last read this page against the code. A compliance posture with
 *  no date is a claim about an unknown moment: the reader cannot tell a page
 *  reviewed this month from one abandoned two years ago, and "2 August 2026" on the
 *  page is the AI Act's application date, not ours. Bump it when the posture rows,
 *  the classification or the subprocessor table are re-checked — not on a refactor. */
export const LAST_REVIEWED = "2026-09-08";

/** The day the REGULATION was last read, as opposed to the code. These are two
 *  different acts of review and conflating them is how this page kept publishing a
 *  superseded applicability date through a code review that was itself honest: the
 *  reviewer checked the claims against the repository, which had not changed, while
 *  the law underneath them had. Each subprocessor row carries its own `verifiedOn`
 *  for the same reason. */
export const REGULATION_CHECKED = "2026-09-08";

export const DATA_RIGHTS = [
  "Candidate data is never sold, and KandiDate itself never trains models on it. What a model provider does with what it is sent is that provider's policy, and the table below states it per provider — including the one case where a free API key means the provider may.",
  "Provider API keys are stored write-only and encrypted at rest; they never round-trip to a browser.",
  "Every candidate gets a token link to see the data and the decisions held about them, and to request erasure.",
  // SCOPED, because it was not true of voice. The erasure transaction is genuinely
  // single-transaction and genuinely reaches every table it names — but a hosted voice
  // provider holds its own copy of the interview in the operator's account, and no
  // transaction inside this product can reach into that.
  "Erasure runs as a single transaction across everything KandiDate stores: the profile, transcripts, scorecards, offers and the outbox. It cannot reach a copy held by a third party — a hosted voice provider keeps its own recording of an interview under its own retention setting, which the operator must configure separately or avoid by running voice locally.",
  "The usage ledger records how many tokens a call cost and what it was for. It stores no prompt, no model response and no candidate reference.",
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

/** Plain-English labels for the posture columns. Kept beside the data rather than in
 *  the component so the wording is reviewable as text, like everything else here. */
export const TRAINS_LABEL: Record<TrainsOnInputs, string> = {
  no: "No",
  yes: "Yes",
  yes_unless_opted_out: "Yes, unless you opt out",
  depends_on_tier: "Depends on your plan",
};

export const EU_REGION_LABEL: Record<EuRegion, string> = {
  available: "Available",
  enterprise_only: "Enterprise plans only",
  not_offered: "Not offered",
  customer_tenant: "Your own tenant",
  self_hosted: "Your own hardware",
  "n/a": "—",
};

export const DATA_CLASS_LABEL: Record<DataClass, string> = {
  candidate_pii: "Candidate data",
  operator_only: "Billing details only",
  none: "Stays on your infrastructure",
};

/** True where a row's answer is one a reader should not skim past — it drives the
 *  emphasis on the page. Anything that may train on candidate data, or whose posture
 *  we could not establish, is worth a second look by definition. */
export function needsAttention(s: Subprocessor): boolean {
  return s.dataClass === "candidate_pii" && (s.trainsOnInputs !== "no" || s.transferBasis === "unknown");
}

/** The oldest per-row verification date — the honest headline for the table, since a
 *  table is only as current as its stalest row. */
export function subprocessorsVerifiedSince(rows: readonly Subprocessor[] = SUBPROCESSORS): string {
  return rows.map((r) => r.verifiedOn).sort()[0] ?? LAST_REVIEWED;
}

/** Weakest first. A trust page that opens with its strongest row is a sales page; the
 *  reader's question is "what is missing", so answer it first. */
export function byWeakestFirst(rows: readonly ObligationRow[] = OBLIGATIONS): ObligationRow[] {
  return [...rows].sort((a, b) => ORDER[a.posture] - ORDER[b.posture] || a.article.localeCompare(b.article));
}
