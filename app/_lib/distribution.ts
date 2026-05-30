import { randomBytes } from "node:crypto";
import { createPosting, createSubmission, getPosting, listSubmissions, type DevCaseRecord, type DevSubmission, type Posting } from "./db";
import { sendComm } from "./comms";

// Phase D4 — the distribution seam. Approved artifacts (role + case) leave the app
// through a channel (OUT) and candidates + submissions come back (IN). The interface
// is what 3rd-party channels (email / ATS / job board) plug into; only the local
// stub is implemented now (local-first), backed by the dev_postings/dev_submissions tables.

export interface DistributionAdapter {
  readonly channel: string;
  /** OUT: publish an approved role + case; returns a posting handle. */
  publish(devCase: DevCaseRecord): Promise<Posting>;
  /** IN: candidate submissions received for a posting. */
  pull(postingId: string): Promise<DevSubmission[]>;
}

// The apply token gates who may POST submissions to a posting — effectively a
// bearer credential — so it must be unguessable. Use a CSPRNG (16 random bytes
// = 128 bits), never Math.random()/Date.now() which are predictable.
function token(): string {
  return randomBytes(16).toString("hex");
}

// Local stub: "publishing" records a posting with a shareable apply token; "pulling"
// reads submissions delivered to the local submit endpoint. A real adapter would call
// out to the channel's API here instead.
export class LocalDistributionAdapter implements DistributionAdapter {
  readonly channel = "local";

  async publish(devCase: DevCaseRecord): Promise<Posting> {
    const role = (devCase.role ?? {}) as { title?: string };
    const kase = (devCase.case ?? {}) as { title?: string };
    return createPosting({
      caseId: devCase.id,
      channel: this.channel,
      token: token(),
      roleTitle: role.title ?? devCase.roleTitle ?? null,
      caseTitle: kase.title ?? devCase.title ?? null,
    });
  }

  async pull(postingId: string): Promise<DevSubmission[]> {
    return listSubmissions(postingId);
  }
}

const ADAPTERS: Record<string, DistributionAdapter> = {
  local: new LocalDistributionAdapter(),
};

/** Resolve a distribution channel. Unknown channels fall back to the local stub. */
export function getAdapter(channel = "local"): DistributionAdapter {
  return ADAPTERS[channel] ?? ADAPTERS.local;
}

/** Record an incoming submission (the IN side of the local stub / a webhook target). */
export function receiveSubmission(input: { postingId: string; candidateRef: string; repoRef: string; notes?: string }): DevSubmission {
  return createSubmission(input).submission;
}

// Intake one submission (form OR inbound webhook): idempotent on (posting, candidate, repo),
// and auto-acknowledges the candidate over the active comms channel (non-adverse, safe to
// automate). Returns the submission + whether it was newly created (so the caller can decide
// to fire the lifecycle only for genuinely new arrivals).
export async function intakeSubmission(input: {
  postingId: string;
  candidateRef: string;
  repoRef: string;
  notes?: string;
  contact?: string;
}): Promise<{ submission: DevSubmission; isNew: boolean }> {
  // Atomic dedup at the DB layer (UNIQUE index + ON CONFLICT DO NOTHING) — no
  // read-then-write TOCTOU window, so concurrent double-submits coalesce to one
  // row and only the genuine first arrival is treated as new.
  const { submission, created } = createSubmission(input);
  if (!created) return { submission, isNew: false };

  const role = getPosting(input.postingId)?.roleTitle ?? "the role";
  await sendComm({
    to: input.contact || input.candidateRef,
    subject: `We received your submission — ${role}`,
    body: `Hi ${input.candidateRef},\n\nThanks for submitting your work for ${role}. It's in our queue and will be reviewed shortly.\n\nBest,\nThe hiring team`,
    kind: "acknowledgement",
    ref: submission.id,
  });
  return { submission, isNew: true };
}
