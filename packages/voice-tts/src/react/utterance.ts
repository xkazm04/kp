// Pure resumable utterance driver with no React and no DOM.
//
// Owns the chunk pipeline for one utterance: lookahead prefetch, playback
// progression, object-URL lifecycle, and the generation token that makes
// superseding an utterance instant and leak-free.
//
// One driver serves both auto-speak unblocking (browser blocked autoplay) and
// mid-utterance continuation after a transient engine/network failure.

export const NON_RESUMABLE_TTS_CODES = new Set([
  "TTS_UNAVAILABLE",
  "TTS_VOICE_INVALID",
  "TTS_TEXT_TOO_LONG",
]);

export type UtteranceOutcome =
  | { state: "done" }
  | { state: "blocked"; at: number }
  | {
      state: "failed";
      at: number;
      spoken: number;
      total: number;
      error: Error;
      code: string | null;
      resumable: boolean;
    }
  | { state: "interrupted" };

export type CreateUtteranceOptions<TChunk extends { url: string }> = {
  chunks: readonly string[];
  fetchChunk: (text: string, index: number, signal: AbortSignal) => Promise<TChunk>;
  play: (chunk: TChunk, index: number) => Promise<"done" | "blocked">;
  lookahead?: number;
  revoke?: (url: string) => void;
  onChunkStart?: (index: number, chunk: TChunk) => void;
  onChunkSpoken?: (index: number, chunk: TChunk) => void;
};

export type Utterance = {
  run: () => Promise<UtteranceOutcome>;
  resume: () => Promise<UtteranceOutcome>;
  stop: () => void;
  readonly outcome: UtteranceOutcome | null;
  readonly cursor: number;
  readonly spoken: number;
  readonly total: number;
  readonly resumable: boolean;
};

export function createUtterance<TChunk extends { url: string }>({
  chunks,
  fetchChunk,
  play,
  lookahead = 2,
  revoke,
  onChunkStart,
  onChunkSpoken,
}: CreateUtteranceOptions<TChunk>): Utterance {
  let cursor = 0;
  let spoken = 0;
  let generation = 0;
  let isStopped = false;
  let outcome: UtteranceOutcome | null = null;
  let abortController: AbortController | null = null;

  const pending: (Promise<TChunk> | undefined)[] = [];
  const createdUrls = new Set<string>();
  const revokedUrls = new Set<string>();

  function releaseUrls() {
    if (!revoke) return;
    for (const url of createdUrls) {
      if (!revokedUrls.has(url)) {
        revokedUrls.add(url);
        try {
          revoke(url);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }

  function fetchOne(index: number, signal: AbortSignal): Promise<TChunk> {
    const text = chunks[index];
    const p = fetchChunk(text, index, signal)
      .then((chunk) => {
        createdUrls.add(chunk.url);
        return chunk;
      });
    p.catch(() => {
      /* avoid unhandled rejection in background lookahead */
    });
    return p;
  }

  function ensure(fromIndex: number, signal: AbortSignal) {
    if (!pending[fromIndex] && fromIndex < chunks.length) {
      pending[fromIndex] = fetchOne(fromIndex, signal);
    }
    while (pending.length < chunks.length && pending.length <= fromIndex + lookahead) {
      const k = pending.length;
      pending.push(fetchOne(k, signal));
    }
  }

  async function drive(): Promise<UtteranceOutcome> {
    if (isStopped) {
      return outcome ?? { state: "interrupted" };
    }
    const currentGen = ++generation;
    abortController = new AbortController();
    const signal = abortController.signal;

    try {
      for (let i = cursor; i < chunks.length; i++) {
        cursor = i;
        ensure(i, signal);

        let chunk: TChunk;
        try {
          chunk = await (pending[i] as Promise<TChunk>);
        } catch (err) {
          if (currentGen !== generation || (err as Error)?.name === "AbortError" || signal.aborted) {
            outcome = { state: "interrupted" };
            return outcome;
          }
          // Remove the failed chunk promise so resume() refetches ONLY this chunk.
          pending[i] = undefined;
          const code = (err as { code?: string | null })?.code ?? null;
          const resumable = !NON_RESUMABLE_TTS_CODES.has(code ?? "");
          const failedOutcome: UtteranceOutcome = {
            state: "failed",
            at: i,
            spoken,
            total: chunks.length,
            error: err as Error,
            code,
            resumable,
          };
          outcome = failedOutcome;
          return failedOutcome;
        }

        if (currentGen !== generation || signal.aborted) {
          outcome = { state: "interrupted" };
          return outcome;
        }

        onChunkStart?.(i, chunk);

        const playResult = await play(chunk, i);

        if (currentGen !== generation || signal.aborted) {
          outcome = { state: "interrupted" };
          return outcome;
        }

        if (playResult === "blocked") {
          const blockedOutcome: UtteranceOutcome = {
            state: "blocked",
            at: i,
          };
          outcome = blockedOutcome;
          return blockedOutcome;
        }

        spoken = i + 1;
        cursor = i + 1;
        onChunkSpoken?.(i, chunk);
      }

      // All chunks successfully played
      releaseUrls();
      const doneOutcome: UtteranceOutcome = { state: "done" };
      outcome = doneOutcome;
      return doneOutcome;
    } catch (err) {
      if (currentGen !== generation || (err as Error)?.name === "AbortError" || signal.aborted) {
        outcome = { state: "interrupted" };
        return outcome;
      }
      const code = (err as { code?: string | null })?.code ?? null;
      const resumable = !NON_RESUMABLE_TTS_CODES.has(code ?? "");
      const failedOutcome: UtteranceOutcome = {
        state: "failed",
        at: cursor,
        spoken,
        total: chunks.length,
        error: err as Error,
        code,
        resumable,
      };
      outcome = failedOutcome;
      return failedOutcome;
    } finally {
      if (currentGen === generation) {
        abortController = null;
      }
    }
  }

  function run(): Promise<UtteranceOutcome> {
    if (isStopped) {
      return Promise.resolve(outcome ?? { state: "interrupted" });
    }
    cursor = 0;
    spoken = 0;
    return drive();
  }

  function resume(): Promise<UtteranceOutcome> {
    if (isStopped) {
      return Promise.resolve(outcome ?? { state: "interrupted" });
    }
    if (outcome?.state === "done") {
      return Promise.resolve(outcome);
    }
    if (outcome?.state === "failed" && !outcome.resumable) {
      return Promise.resolve(outcome);
    }
    return drive();
  }

  function stop() {
    isStopped = true;
    generation += 1;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    releaseUrls();
    outcome = { state: "interrupted" };
  }

  return {
    run,
    resume,
    stop,
    get outcome() {
      return outcome;
    },
    get cursor() {
      return cursor;
    },
    get spoken() {
      return spoken;
    },
    get total() {
      return chunks.length;
    },
    get resumable() {
      if (isStopped) return false;
      if (outcome?.state === "blocked") return true;
      if (outcome?.state === "failed") return outcome.resumable;
      return false;
    },
  };
}
