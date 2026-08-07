import { randomBytes } from "node:crypto";
import { createPosting, createSubmission, getPosting, listOutboxFiltered, listSubmissions, type DevCaseRecord, type DevSubmission, type Posting } from "./db/devcase";
import { sendComm } from "./comms";
import { commsTranslator } from "./comms-translator";

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

/** Thrown when a caller asks for a distribution channel that isn't registered.
 *  getAdapter used to silently fall back to the LOCAL stub for ANY unknown value,
 *  so a typo'd or not-yet-implemented channel ("email", "ats", …) looked configured
 *  but published only a local posting no external candidate ever saw — and the route
 *  answered 200 as if the requested channel had succeeded. Surfacing it lets the
 *  publish route reject the request instead of reporting a false success. */
export class UnknownChannelError extends Error {
  constructor(public readonly channel: string) {
    super(`Unsupported distribution channel "${channel}". Registered channels: ${Object.keys(ADAPTERS).join(", ")}.`);
    this.name = "UnknownChannelError";
  }
}

/**
 * Resolve a distribution channel to its adapter. The DEFAULT (no argument) is the
 * local stub — the genuinely-local, always-implemented channel. An explicit but
 * UNREGISTERED channel throws {@link UnknownChannelError} rather than silently
 * degrading to local: conflating "channel not implemented" with "use local" hid a
 * mis-typed/unavailable channel behind a successful-looking local publish. The
 * fallback stays strictly for the omitted-argument case.
 */
export function getAdapter(channel = "local"): DistributionAdapter {
  const adapter = ADAPTERS[channel];
  if (!adapter) throw new UnknownChannelError(channel);
  return adapter;
}

// Intake one submission (form OR inbound webhook): idempotent on (posting, candidate, repo),
// and auto-acknowledges the candidate over the active comms channel (non-adverse, safe to
// automate). Returns the submission + whether it was newly created (so the caller can decide
// to fire the lifecycle only for genuinely new arrivals).
// Thrown when a submission targets a closed posting. Routes map it to 410 so a
// candidate learns the intake closed instead of getting a false acknowledgement.
export class PostingClosedError extends Error {
  constructor() {
    super("This role's intake has closed and is no longer accepting submissions.");
    this.name = "PostingClosedError";
  }
}

export async function intakeSubmission(input: {
  postingId: string;
  candidateRef: string;
  repoRef: string;
  notes?: string;
  contact?: string;
  /** The candidate's language, so the acknowledgement is written in it. */
  locale?: string | null;
}): Promise<{ submission: DevSubmission; isNew: boolean }> {
  // Closed-posting guard in the SHARED core, not just the public inbound route:
  // the internal /api/devcase/submit route bypassed inbound's status check and
  // silently re-ghosted candidates the close-out exists to protect. Gating here
  // covers every caller (and any future one). Loaded once and reused for the ack.
  const posting = getPosting(input.postingId);
  if (!posting) throw new Error("Posting not found.");
  if (posting.status === "closed") throw new PostingClosedError();

  // Atomic dedup at the DB layer (UNIQUE index + ON CONFLICT DO NOTHING) — no
  // read-then-write TOCTOU window, so concurrent double-submits coalesce to one
  // row and only the genuine first arrival is treated as new.
  const { submission, created } = createSubmission(input);

  // Drive the acknowledgement off a DURABLE marker — whether an acknowledgement
  // outbox row already exists for this submission — NOT the one-shot `created`
  // flag. sendComm records that outbox row as its LAST step, so a row exists iff a
  // prior ack actually completed; if the first attempt's sendComm threw (its
  // recordOutbox write failed, or the webhook path's envelope build raised) the row
  // is absent and the submission was persisted un-acknowledged. The old
  // `if (!created) return` fired the ack ONLY on the first insert, so that retry —
  // now `created === false` — returned before sendComm and dropped the ack forever.
  // Gating on the outbox instead makes it "send if new-or-unacked": a retry that
  // finds an existing-but-unacked row still fires the ack. (At-least-once for the
  // candidate ack — a rare concurrent double-submit may send twice, a benign
  // duplicate, unlike the silent permanent drop it replaces.)
  const alreadyAcknowledged =
    listOutboxFiltered({ ref: submission.id, kind: "acknowledgement", limit: 1 }).length > 0;
  if (!alreadyAcknowledged) {
    // The acknowledgement goes to the CANDIDATE, so it is written in their
    // language via the locale-pinned comms translator, not the recruiter's
    // request locale. It was hardcoded English in all four locales.
    const t = await commsTranslator(input.locale);
    const role = (posting.roleTitle ?? "").trim();
    await sendComm({
      to: input.contact || input.candidateRef,
      subject: role ? t("ack.subjectRole", { role }) : t("ack.subject"),
      body: [
        t("ack.greeting", { name: input.candidateRef }),
        "",
        role ? t("ack.bodyRole", { role }) : t("ack.body"),
        "",
        t("ack.signoff"),
      ].join("\n"),
      kind: "acknowledgement",
      ref: submission.id,
    });
  }
  return { submission, isNew: created };
}
