// E8 (Erika gap) — the versioned wire envelope the WebhookChannel POSTs to
// COMMS_WEBHOOK_URL. This is kp's outbound EXPORT SCHEMA: one documented JSON
// shape a relay maps onto any ATS / mail provider, instead of per-vendor
// connectors. Full contract in docs/features/comms/outbound-export.md.
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
//   - `messageId` (additive, still v1) is the DELIVERY IDENTITY: one id per
//     logical message, stable across every retry attempt of that message. It
//     also rides as the `Idempotency-Key` request header, so a receiver can
//     dedupe on either. `ref` is NOT that identity — it names the pipeline entry
//     and repeats across every message about the same candidate.
//
// Pure and DB-free: the channel does the entry lookup, this module only shapes
// the payload — so the contract is pinned by comms-envelope.test.ts.

export const COMM_SCHEMA = "kp.comm.v1" as const;

/** The request header carrying `messageId` on every relay POST. The de-facto
 *  standard spelling (IETF draft-ietf-httpapi-idempotency-key-header), so a
 *  receiver built on an off-the-shelf idempotency middleware needs no mapping.
 *  Lives here, beside the field it mirrors, so the delivery path and the
 *  contract test cannot drift apart. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

// The kind vocabulary the pipeline dispatchers emit today (comms-dispatch.ts).
// Documentation-adjacent, not enforcement: unknown kinds (e.g. dev-case comms)
// pass through verbatim, and a relay should treat this list as open.
//
// PINNED TO THE SOURCE, not to a snapshot: this list claimed to be "the kinds the
// dispatchers emit today" while listing 8 of 13 — a hand-maintained list drifts the
// moment a dispatcher is added, and it is part of a PUBLISHED export contract an
// integrator maps against, so the drift lands on them. comms-envelope.test.ts now
// greps every `kind: "…"` passed to sendComm/sendCandidateComm in comms-dispatch.ts
// and asserts SET EQUALITY with this array: a new dispatcher fails the test until it
// is documented here, and a removed one fails it until it is dropped.
export const KNOWN_COMM_KINDS = [
  "acknowledgement",
  "outreach",
  "rejection",
  "ko_decline",
  "offer",
  "offer_reminder",
  "interview_confirmation",
  "interview_reminder",
  "interview_invite",
  "interviewer_brief",
  "schedule_invite",
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
  /** Stable per-message delivery identity — see the stability rules above. Sent
   *  again verbatim on every retry of the SAME message, and mirrored in the
   *  `Idempotency-Key` header, so a receiver that already accepted attempt 1
   *  can drop attempt 2 instead of delivering the offer twice. Null only for a
   *  caller that built an envelope without one (the probe pings). */
  messageId: string | null;
  sentAt: string;
  // Entry-derived context (null when ref doesn't resolve to a pipeline entry).
  candidate: {
    id: string | null;
    label: string | null;
    /** The captured contact address (E4) — the directly-deliverable recipient
     *  when present; `to` may hold a mere identifier (see the recipient
     *  contract in docs/features/comms/README.md). */
    email: string | null;
    locale: string | null;
    sourceChannel: string | null;
  } | null;
  job: { id: string | null; title: string | null } | null;
  stage: string | null;
  /** THE UNSUBSCRIBE CONTRACT (additive, still v1).
   *
   *  ePrivacy Art. 13(4) — and, in this product's primary market, § 7(4)(c) with
   *  § 11(2)(a)(4) of the Czech zák. č. 480/2004 Sb. (a standalone offence, fine up to
   *  10,000,000 Kč) — require every commercial message to carry a valid address at
   *  which the recipient can decline further messages. In mail that address is the
   *  `List-Unsubscribe` header (RFC 2369) plus, for one-click, `List-Unsubscribe-Post`
   *  (RFC 8058).
   *
   *  KP CANNOT SET THOSE HEADERS, and saying so plainly is more useful than faking it:
   *  kp's relay abstraction is an HTTP POST of this JSON document to an operator-
   *  configured receiver (comms.ts WebhookChannel) — there is no SMTP client and no MIME
   *  header seam anywhere in the tree. The HTTP request headers on that POST are a
   *  conversation with the RELAY, not with the recipient's mail client; writing
   *  `List-Unsubscribe` among them would put the value somewhere no mail agent will ever
   *  read it, which is worse than not shipping it, because it looks done.
   *
   *  So the values travel as DATA, pre-formatted exactly as the two headers must appear,
   *  and the relay copies them onto the message it composes:
   *
   *      List-Unsubscribe: <https://…/api/stop/ob-…>
   *      List-Unsubscribe-Post: List-Unsubscribe=One-Click
   *
   *  `listUnsubscribe` is angle-bracketed per RFC 2369 §2. The URL is a POST endpoint
   *  that records the opt-out and answers 200 — the RFC 8058 requirement — and is
   *  idempotent, so a mail provider's unattended POST and a human's click cannot
   *  disagree. Both are null for an entry-less comm (no candidate identity to opt out)
   *  and for an anonymized entry (already unreachable). A receiver that only knows the
   *  legacy flat shape ignores them, as with every other additive v1 field. */
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
};

/** The exact `List-Unsubscribe-Post` value RFC 8058 §3 defines. A constant rather than a
 *  literal at the use site so the relay contract, the docs and the envelope test all
 *  name the same string. */
export const LIST_UNSUBSCRIBE_POST_ONE_CLICK = "List-Unsubscribe=One-Click";

export function buildCommEnvelope(
  msg: { to: string; subject: string; body: string; kind: string; ref?: string; unsubscribeUrl?: string },
  entry: CommEnvelopeContext | null,
  sentAt: string,
  messageId: string | null = null
): CommEnvelope {
  const unsubscribe = (msg.unsubscribeUrl ?? "").trim();
  return {
    schema: COMM_SCHEMA,
    to: msg.to,
    subject: msg.subject,
    body: msg.body,
    kind: msg.kind,
    ref: msg.ref ?? null,
    messageId,
    sentAt,
    listUnsubscribe: unsubscribe ? `<${unsubscribe}>` : null,
    // Paired: One-Click is only meaningful beside an address, and a receiver that saw
    // the POST directive with no target would have nothing to POST to.
    listUnsubscribePost: unsubscribe ? LIST_UNSUBSCRIBE_POST_ONE_CLICK : null,
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
