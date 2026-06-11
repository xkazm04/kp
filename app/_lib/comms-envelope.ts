// E8 (Erika gap) — the versioned wire envelope the WebhookChannel POSTs to
// COMMS_WEBHOOK_URL. This is kp's outbound EXPORT SCHEMA: one documented JSON
// shape a relay maps onto any ATS / mail provider, instead of per-vendor
// connectors. Full contract in docs/OUTBOUND_EXPORT.md.
//
// Stability rules:
//   - `schema` names the version; kp.comm.v1 evolves ADDITIVELY only (new
//     optional fields). A breaking change bumps the version string.
//   - The flat to/subject/body/kind/ref fields are the legacy wire shape,
//     preserved verbatim so a relay written against the pre-envelope payload
//     keeps working unchanged.
//   - `candidate`/`job`/`stage` context is enriched from the pipeline entry the
//     message references (`ref`); a message whose ref is not a pipeline entry
//     (dev-case comms, slot refs) carries them as null — the flat fields are
//     always sufficient to deliver.
//
// Pure and DB-free: the channel does the entry lookup, this module only shapes
// the payload — so the contract is pinned by comms-envelope.test.ts.

export const COMM_SCHEMA = "kp.comm.v1" as const;

// The kind vocabulary the pipeline dispatchers emit today (comms-dispatch.ts).
// Documentation-adjacent, not enforcement: unknown kinds (e.g. dev-case comms)
// pass through verbatim, and a relay should treat this list as open.
export const KNOWN_COMM_KINDS = [
  "acknowledgement",
  "outreach",
  "rejection",
  "offer",
  "interview_confirmation",
  "interview_reminder",
  "interview_invite",
  "onboarding",
] as const;

// Structural subset of PipelineEntry (kept import-free so the module stays
// registry-free; PipelineEntry satisfies it as-is).
export type CommEnvelopeContext = {
  candidateId: string | null;
  candidateLabel: string;
  contact: string | null;
  locale: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  sourceChannel: string | null;
};

export type CommEnvelope = {
  schema: typeof COMM_SCHEMA;
  // Legacy flat message fields — the pre-envelope wire shape, preserved.
  to: string;
  subject: string;
  body: string;
  kind: string;
  ref: string | null;
  sentAt: string;
  // Entry-derived context (null when ref doesn't resolve to a pipeline entry).
  candidate: {
    id: string | null;
    label: string | null;
    /** The captured contact address (E4) — the directly-deliverable recipient
     *  when present; `to` may hold a mere identifier (see the recipient
     *  contract in docs/COMMS_DELIVERY.md). */
    email: string | null;
    locale: string | null;
    sourceChannel: string | null;
  } | null;
  job: { id: string | null; title: string | null } | null;
  stage: string | null;
};

export function buildCommEnvelope(
  msg: { to: string; subject: string; body: string; kind: string; ref?: string },
  entry: CommEnvelopeContext | null,
  sentAt: string
): CommEnvelope {
  return {
    schema: COMM_SCHEMA,
    to: msg.to,
    subject: msg.subject,
    body: msg.body,
    kind: msg.kind,
    ref: msg.ref ?? null,
    sentAt,
    candidate: entry
      ? {
          id: entry.candidateId,
          label: entry.candidateLabel.trim() || null,
          email: entry.contact,
          locale: entry.locale,
          sourceChannel: entry.sourceChannel,
        }
      : null,
    job: entry ? { id: entry.jobId, title: entry.jobTitle } : null,
    stage: entry ? entry.stage : null,
  };
}
