// P1-5 — the NORMALIZED, ATS-portable candidate record. The only egress today is
// a whole-database JSON dump (app/api/workspace/export) — "not an integration,
// that's a backup" (Marcus #12). This is the per-candidate, vendor-neutral shape
// a Workday / Greenhouse / Lever connector (or an iPaaS like Merge.dev / Zapier)
// maps FROM: one candidate, one role, the pipeline state, the SEALED decision with
// its tamper-evident hash + auto/human attribution, and the offer comp.
//
// CEILING — this is vendor-neutral EGRESS, not a certified per-vendor connector.
// We don't hold each ATS's OAuth creds or field map; we emit a stable, documented
// record + a signed webhook, and the customer's connector/iPaaS lands it in their
// system of record. The schemaVersion lets that mapping pin a contract.
//
// Pure + dependency-free (structural input types, no DB import) so it loads under
// `node --test` and can't drag better-sqlite3 into a bundle.

/** Bump on any breaking change to AtsCandidateRecord so consumers can pin a map. */
export const ATS_SCHEMA_VERSION = "kp.ats.v1";

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

/** Map kp's internal records into the portable ATS record. Pure: pass the already
 *  fetched entry/job/decision/offer + the export timestamp (no clock, no DB). */
export function buildAtsRecord(input: {
  entry: AtsEntryInput;
  job?: AtsJobInput;
  decision?: AtsDecisionInput;
  offer?: AtsOfferInput;
  exportedAt?: string | null;
}): AtsCandidateRecord {
  const { entry, job, decision, offer, exportedAt = null } = input;
  return {
    schemaVersion: ATS_SCHEMA_VERSION,
    exportedAt,
    candidate: {
      ref: entry.id,
      candidateId: entry.candidateId,
      displayName: entry.candidateLabel,
      contact: entry.contact,
      archetype: entry.archetype,
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
