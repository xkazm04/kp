// What POST /api/jobs/[id]/publish actually answers, and the sentences a
// recruiter should read back.
//
// The route returns six facts — `{ sourced, skipped, sourcingWarning,
// silverMedalists, alreadyPublished, reopened }` — and both publish surfaces read
// two of them (`sourced` + `sourcingWarning`). The cost was not cosmetic: an
// idempotent re-publish skips sourcing entirely, so its `sourced: 0` was rendered
// as "Sourced 0 candidates into the Pipeline." — a fresh go-live that matched
// nobody, which is a different and alarming event. The rediscovery alerts a
// genuine go-live raises ("a candidate you passed on clears the bar for this
// role") were never mentioned at all, and a reopen looked like a first publish.
//
// Pure and store-free below the memo at the bottom, so the selection is pinned by
// jobsPublishResult.test.ts rather than described in a comment.

export type PublishResponse = {
  sourced?: number;
  skipped?: number;
  /** Non-null when the sourcing step itself errored. Server prose (an Error
   *  message, sometimes a Python traceback) — NEVER rendered; it only selects
   *  the localized "sourcing failed" sentence. */
  sourcingWarning?: string | null;
  silverMedalists?: number;
  alreadyPublished?: boolean;
  reopened?: number;
};

export const PUBLISH_SENTENCE_KEYS = [
  "wentLive",
  "reopened",
  "alreadyLive",
  "sourced",
  "skipped",
  "silverMedalists",
  "sourcingFailed",
] as const;
export type PublishSentenceKey = (typeof PUBLISH_SENTENCE_KEYS)[number];

/** One localized line. `count` is the ICU plural argument where the key takes one. */
export type PublishSentence = { key: PublishSentenceKey; count?: number };
export type PublishNote = { tone: "ok" | "warn"; sentences: PublishSentence[] };

export function publishNoteSentences(p: PublishResponse): PublishNote {
  const sentences: PublishSentence[] = [];
  const reopened = p.reopened ?? 0;
  // The lead states which transition this was. `alreadyPublished` is the
  // idempotent case: the role was already live and NOTHING was re-sourced, so it
  // must not be followed by a sourcing claim of any kind.
  if (reopened > 0) sentences.push({ key: "reopened", count: reopened });
  else if (p.alreadyPublished) sentences.push({ key: "alreadyLive" });
  else sentences.push({ key: "wentLive" });

  if (p.alreadyPublished && !p.sourcingWarning) return { tone: "ok", sentences };

  if (p.sourcingWarning) {
    // Amber, and it REPLACES the sourced count: "sourced 0 because sourcing broke"
    // and "sourced 0 because nobody matched" are different answers to the question
    // the recruiter is actually asking.
    sentences.push({ key: "sourcingFailed" });
    return { tone: "warn", sentences };
  }

  sentences.push({ key: "sourced", count: p.sourced ?? 0 });
  if ((p.skipped ?? 0) > 0) sentences.push({ key: "skipped", count: p.skipped });
  if ((p.silverMedalists ?? 0) > 0) sentences.push({ key: "silverMedalists", count: p.silverMedalists });
  return { tone: "ok", sentences };
}

/* ── Surviving the modal ─────────────────────────────────────────────────────
 * Publishing runs a sourcing child for up to three minutes; closing the modal
 * threw the answer away, and reopening the role showed nothing at all. This is
 * the cheapest honest memory for it: a module-scope map, so the result survives
 * the modal's unmount for the rest of the session. It is deliberately NOT
 * storage-backed — a publish result is about a run that just happened, and a
 * week-old sentence restored after a reload would be a worse lie than silence.
 * The surface labels a restored result as the LAST publish, not a fresh one. */
const lastByJob = new Map<string, PublishResponse>();

export function rememberPublishResult(jobId: string, result: PublishResponse): void {
  lastByJob.set(jobId, result);
}

export function lastPublishResult(jobId: string): PublishResponse | null {
  return lastByJob.get(jobId) ?? null;
}

/** Test seam — the map is module state, so a test that asserts on absence has to
 *  be able to start from empty. */
export function forgetPublishResults(): void {
  lastByJob.clear();
}
