import { createPosting, createSubmission, listSubmissions, type DevCaseRecord, type DevSubmission, type Posting } from "./db";

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

function token(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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
  return createSubmission(input);
}
