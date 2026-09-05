// P1-5 — the NORMALIZED, ATS-portable candidate record. The only egress today is
// a whole-database JSON dump (app/api/workspace/export) — "not an integration,
// that's a backup" (Marcus #12). This is the per-candidate, vendor-neutral shape
// a Workday / Greenhouse / Lever connector (or an iPaaS like Merge.dev / Zapier)
// maps FROM: one candidate, one role, the pipeline state, the SEALED decision with
// its tamper-evident hash + auto/human attribution, and the offer comp.
//
// CEILING (revised by W1.1) — this file is still EGRESS-only, and the vendor-neutral
// webhook path above is unchanged: emit a stable, documented record, let the customer's
// connector or iPaaS land it. What HAS changed is the claim that "we don't hold each ATS's
// creds or field map" — we now do, for the ingest direction: `app/_lib/ats/` holds the
// per-provider token + field map (connections-store.ts), the inbound record shape
// (inbound.ts) and the external-id link table that makes a re-sync idempotent
// (links-store.ts).
//
// The two directions meet at `toAtsEntryInput`, which projects an inbound record onto the
// input this mapper reads — so a candidate imported from an ATS emits exactly the same
// kp.ats.v1 shape as one who applied directly. That round trip is pinned by
// app/_lib/ats/inbound.test.ts; keep it true if you change this record.
//
// Pure + dependency-free (structural input types, no DB import) so it loads under
// `node --test` and can't drag better-sqlite3 into a bundle.

import { consentStatus, consentWithholdsPii, maskCandidateName, type ConsentSnapshot } from "./consent.ts";

/** Bump on any breaking change to AtsCandidateRecord so consumers can pin a map. */
export const ATS_SCHEMA_VERSION = "kp.ats.v1";

/** The mapper REFUSED to build a record. Not a failure to fetch and not a transport
 *  problem: a standing decision that this candidate's data may not leave kp.
 *
 *  WHY THE MAPPER AND NOT THE CALLER. Nothing on this path consulted consent — the
 *  record carried displayName, contact and matchScore to a third-party endpoint on the
 *  strength of the row having been scrubbed by an unrelated sweep. Safety that is
 *  incidental to another feature's timing is not safety. Putting the gate INSIDE the one
 *  function every egress path funnels through means a future caller cannot forget it. */
export class AtsRecordRefusedError extends Error {
  /** A stable machine reason, so the ledger records WHY without parsing prose. */
  readonly reason: "anonymized";
  constructor(reason: "anonymized", message: string) {
    super(message);
    this.name = "AtsRecordRefusedError";
    this.reason = reason;
  }
}

// Minimal structural inputs — the real PipelineEntry / OfferRow / DecisionRecord
// satisfy these; we only name the fields the record actually carries.
export type AtsEntryInput = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  status: string;
  matchScore: number | null;
  roleFamily: string | null;
  archetype: string | null;
  contact: string | null;
  createdAt: string | null;
  stageChangedAt: string | null;
  /** The consent columns the PII gate reads (db/pipeline.ts rowToEntry carries all
   *  three). OPTIONAL because the inbound projection (ats/inbound.ts) and the unit
   *  fixtures build an entry that never had them — absent means "no consent record",
   *  which consentStatus reads as `none` and which does NOT withhold. That is the
   *  same stance db/pipeline.ts takes for a pre-consent-feature row. */
  consentGivenAt?: string | null;
  consentExpiresAt?: string | null;
  anonymizedAt?: string | null;
};

export type AtsJobInput = { id: string; title: string | null; company: string | null } | null | undefined;

export type AtsDecisionInput =
  | {
      kind: string;
      actor: string;
      reasonCode: string;
      /** The tamper-evident content hash — the reference a record can be audited by. */
      contentHash: string;
      policyVersion: string;
      createdAt: string;
    }
  | null
  | undefined;

export type AtsOfferInput =
  | { currency: string | null; salary: number | null; status: string }
  | null
  | undefined;

export type AtsCandidateRecord = {
  schemaVersion: string;
  /** When this snapshot was produced (caller-stamped, so the mapper stays pure). */
  exportedAt: string | null;
  candidate: {
    /** Stable subject reference — the pipeline entry id (same as decision candidateRef). */
    ref: string;
    candidateId: string | null;
    displayName: string;
    contact: string | null;
    archetype: string | null;
    /** True when the consent gate withheld identifying fields: `displayName` is the
     *  masked handle ("Monika M.") and `contact` is null. Sent explicitly so a receiver
     *  can tell a redacted record from a candidate who simply has no email on file —
     *  silently shipping a masked name as if it were the real one is how a mirrored
     *  ATS row becomes wrong rather than merely partial. `buildAtsRecord` always sets
     *  it; OPTIONAL only so a hand-built fixture (and a record parsed from an older
     *  delivery) still satisfies the type — absent means false. */
    piiWithheld?: boolean;
  };
  role: {
    jobId: string | null;
    title: string | null;
    company: string | null;
    family: string | null;
  };
  pipeline: {
    stage: string;
    status: string;
    matchScore: number | null;
    enteredAt: string | null;
    stageChangedAt: string | null;
  };
  /** The latest SEALED decision for this candidate, or null if none recorded. */
  decision: {
    kind: string;
    reasonCode: string;
    actor: string;
    /** Derived: a "human:"-prefixed actor is a human decision; anything else automated. */
    automated: boolean;
    sealedRecordHash: string;
    policyVersion: string;
    decidedAt: string;
  } | null;
  offer: {
    currency: string | null;
    amount: number | null;
    status: string;
  } | null;
};

/** True unless the decision actor is explicitly a human (e.g. "human:recruiter").
 *  Mirrors decision-attribution's never-default-unknown-to-auto doctrine inverted:
 *  here we only call it human when it SAYS human; everything else is automated. */
function isAutomatedActor(actor: string): boolean {
  return !actor.toLowerCase().startsWith("human");
}

/** The entry's consent snapshot in the shape the shared predicates read. */
function snapshot(entry: AtsEntryInput): ConsentSnapshot {
  return {
    givenAt: entry.consentGivenAt ?? null,
    expiresAt: entry.consentExpiresAt ?? null,
    anonymizedAt: entry.anonymizedAt ?? null,
  };
}

/** Map kp's internal records into the portable ATS record. Pure: pass the already
 *  fetched entry/job/decision/offer + the export timestamp (no clock, no DB).
 *
 *  THE CONSENT GATE, through the shared predicates (consent.ts), never a local copy:
 *    • ANONYMIZED → {@link AtsRecordRefusedError}. The candidate's data is terminally
 *      scrubbed here; mirroring the husk into a third-party ATS would re-create a
 *      record the erasure was supposed to end, and there is no partial version of that
 *      answer — so it is a refusal, not a redaction.
 *    • consent EXPIRED (`consentWithholdsPii`) → the record still goes (the pipeline
 *      state and the sealed decision are the non-identifying recruitment record kp
 *      deliberately retains), but the identifying half is withheld: the name is masked
 *      to the readable handle and `contact` is dropped, with `piiWithheld: true` saying
 *      so on the wire.
 *  `nowMs` is injectable so this stays pure/testable; it only affects the expiry read. */
export function buildAtsRecord(input: {
  entry: AtsEntryInput;
  job?: AtsJobInput;
  decision?: AtsDecisionInput;
  offer?: AtsOfferInput;
  exportedAt?: string | null;
  nowMs?: number;
}): AtsCandidateRecord {
  const { entry, job, decision, offer, exportedAt = null, nowMs = Date.now() } = input;
  const snap = snapshot(entry);
  if (consentStatus(snap, nowMs) === "anonymized") {
    throw new AtsRecordRefusedError(
      "anonymized",
      `pipeline entry ${entry.id} is anonymized — its data may not be mirrored to an external ATS`
    );
  }
  const piiWithheld = consentWithholdsPii(snap, nowMs);
  return {
    schemaVersion: ATS_SCHEMA_VERSION,
    exportedAt,
    candidate: {
      ref: entry.id,
      candidateId: entry.candidateId,
      displayName: piiWithheld ? maskCandidateName(entry.candidateLabel) : entry.candidateLabel,
      contact: piiWithheld ? null : entry.contact,
      archetype: entry.archetype,
      piiWithheld,
    },
    role: {
      jobId: entry.jobId,
      title: job?.title ?? entry.jobTitle,
      company: job?.company ?? null,
      family: entry.roleFamily,
    },
    pipeline: {
      stage: entry.stage,
      status: entry.status,
      matchScore: entry.matchScore,
      enteredAt: entry.createdAt,
      stageChangedAt: entry.stageChangedAt,
    },
    decision: decision
      ? {
          kind: decision.kind,
          reasonCode: decision.reasonCode,
          actor: decision.actor,
          automated: isAutomatedActor(decision.actor),
          sealedRecordHash: decision.contentHash,
          policyVersion: decision.policyVersion,
          decidedAt: decision.createdAt,
        }
      : null,
    offer: offer
      ? {
          currency: offer.currency,
          amount: offer.salary,
          status: offer.status,
        }
      : null,
  };
}
