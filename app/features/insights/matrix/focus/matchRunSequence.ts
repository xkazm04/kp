// grid-narrative-says-what-it-is (b). A last-write-wins guard for the candidate-focus
// match run.
//
// `runMatchFor` is fired by the candidate <select>, by the weights panel's re-rank and
// by the deep-link auto-run, and nothing ordered the responses: /api/match spawns the
// Python pipeline, so a run over a big role set can take several seconds while the next
// candidate's run takes one. Switch candidate mid-flight and the SLOWER, EARLIER
// response arrived last and called setResult — the recruiter read one candidate's name
// over another candidate's ranking, with no error and nothing on screen to suspect.
//
// Deliberately a counter and not an AbortController: the in-flight run may already have
// paid for its Python spawn, and its answer is still worth writing to the server-side
// cache. What must not happen is it reaching the SCREEN after a newer run started.
export type RunSequence = {
  /** Claim the next ticket. Call once, synchronously, before starting a run. */
  start: () => number;
  /** True only for the most recently claimed ticket. */
  isCurrent: (ticket: number) => boolean;
};

export function createRunSequence(): RunSequence {
  // Tickets are 1-based and `latest` starts at 0, so `ticket > 0` is what keeps a
  // never-issued 0 — the value a `useRef(0)` hands you before the first run — from
  // reading as current and waving a response through.
  let latest = 0;
  return {
    start: () => (latest += 1),
    isCurrent: (ticket: number) => ticket > 0 && ticket === latest,
  };
}
