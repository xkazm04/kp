import { test } from "node:test";
import assert from "node:assert/strict";
import { createUtterance } from "./utterance.ts";
import { TtsRequestError } from "./useTts.ts";

test("3 chunks, play() answers 'blocked' for chunk 0 -> run() settles blocked; after resume() plays 0,1,2 in order, settles done, fetchChunk called exactly 3 times", async () => {
  const fetchCalls: number[] = [];
  const playCalls: number[] = [];
  let playShouldBlock = true;

  const utt = createUtterance({
    chunks: ["chunk0", "chunk1", "chunk2"],
    fetchChunk: async (text, index) => {
      fetchCalls.push(index);
      return { url: `blob:${text}`, text };
    },
    play: async (_chunk, index) => {
      playCalls.push(index);
      if (index === 0 && playShouldBlock) {
        return "blocked";
      }
      return "done";
    },
  });

  const runOutcome = await utt.run();
  assert.equal(runOutcome.state, "blocked");
  assert.equal(runOutcome.at, 0);
  assert.equal(utt.resumable, true);

  // Resume: play now answers done
  playShouldBlock = false;
  const resumeOutcome = await utt.resume();
  assert.equal(resumeOutcome.state, "done");
  assert.equal(utt.resumable, false);

  // Play was called for 0 (blocked), then after resume: 0 (done), 1 (done), 2 (done)
  assert.deepEqual(playCalls, [0, 0, 1, 2]);

  // fetchChunk was called exactly once per chunk (3 times total, no refetch)
  assert.deepEqual(fetchCalls, [0, 1, 2]);
});

test("1 chunk, blocked then resumed -> utterance settles done and spoken count is 1", async () => {
  let playBlock = true;
  const utt = createUtterance({
    chunks: ["single chunk"],
    fetchChunk: async (text) => ({ url: `blob:${text}` }),
    play: async () => {
      if (playBlock) return "blocked";
      return "done";
    },
  });

  const out1 = await utt.run();
  assert.equal(out1.state, "blocked");
  assert.equal(utt.spoken, 0);

  playBlock = false;
  const out2 = await utt.resume();
  assert.equal(out2.state, "done");
  assert.equal(utt.spoken, 1);
});

test("4 chunks, fetchChunk for chunk 2 rejects with TTS_FAILED -> settles failed, resumable; resume fetches only chunk 2 again, plays 2 and 3, settles done", async () => {
  const fetchCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const playCalls: number[] = [];
  let chunk2Fail = true;

  const utt = createUtterance({
    chunks: ["c0", "c1", "c2", "c3"],
    lookahead: 2,
    fetchChunk: async (text, index) => {
      fetchCounts[index] = (fetchCounts[index] || 0) + 1;
      if (index === 2 && chunk2Fail) {
        throw new TtsRequestError("Synthesis engine timed out", "TTS_FAILED");
      }
      return { url: `blob:${text}` };
    },
    play: async (_chunk, index) => {
      playCalls.push(index);
      return "done";
    },
  });

  const runOutcome = await utt.run();
  assert.equal(runOutcome.state, "failed");
  if (runOutcome.state === "failed") {
    assert.equal(runOutcome.spoken, 2);
    assert.equal(runOutcome.total, 4);
    assert.equal(runOutcome.code, "TTS_FAILED");
    assert.equal(runOutcome.resumable, true);
  }

  // Resume: chunk 2 succeeds now
  chunk2Fail = false;
  const resumeOutcome = await utt.resume();
  assert.equal(resumeOutcome.state, "done");

  // Chunks 0 and 1 were fetched once each
  assert.equal(fetchCounts[0], 1);
  assert.equal(fetchCounts[1], 1);
  // Chunk 2 was fetched twice (once failed, once on resume)
  assert.equal(fetchCounts[2], 2);
  // Chunk 3 was prefetched and reused (fetched once)
  assert.equal(fetchCounts[3], 1);

  // Play was called for 0, 1, then on resume: 2, 3
  assert.deepEqual(playCalls, [0, 1, 2, 3]);
});

test("failure codes TTS_UNAVAILABLE, TTS_VOICE_INVALID, TTS_TEXT_TOO_LONG -> resumable is false, resume is no-op", async () => {
  const nonResumableCodes = ["TTS_UNAVAILABLE", "TTS_VOICE_INVALID", "TTS_TEXT_TOO_LONG"];

  for (const code of nonResumableCodes) {
    let fetchCount = 0;
    const utt = createUtterance({
      chunks: ["text"],
      fetchChunk: async () => {
        fetchCount += 1;
        throw new TtsRequestError(`Error ${code}`, code);
      },
      play: async () => "done",
    });

    const runOut = await utt.run();
    assert.equal(runOut.state, "failed");
    if (runOut.state === "failed") {
      assert.equal(runOut.code, code);
      assert.equal(runOut.resumable, false);
    }
    assert.equal(utt.resumable, false);

    // resume() is a no-op that leaves the failed outcome unchanged
    const resumeOut = await utt.resume();
    assert.equal(resumeOut, runOut);
    assert.equal(fetchCount, 1, "fetchChunk must not be called on non-resumable resume");
  }
});

test("stop() during a resumed run -> no further play or fetchChunk calls, superseded utterance resume is no-op", async () => {
  let playCalledAfterStop = false;
  let playBlock = true;

  const utt = createUtterance({
    chunks: ["c0", "c1", "c2", "c3"],
    fetchChunk: async (text) => {
      return { url: `blob:${text}` };
    },
    play: async (_chunk, index) => {
      if (index === 0 && playBlock) return "blocked";
      if (index === 1) {
        // Stop the utterance while playing chunk 1
        utt.stop();
      }
      if (index > 1) {
        playCalledAfterStop = true;
      }
      return "done";
    },
  });

  const out1 = await utt.run();
  assert.equal(out1.state, "blocked");

  playBlock = false;
  const resumePromise = utt.resume();
  const out2 = await resumePromise;
  assert.equal(out2.state, "interrupted");
  assert.equal(playCalledAfterStop, false);

  // Calling resume on a stopped/superseded utterance is a no-op
  const out3 = await utt.resume();
  assert.equal(out3.state, "interrupted");
});

test("every object URL created is revoked exactly once on done, on stop, and on a failed utterance that is then stopped or superseded", async () => {
  // Case A: done revokes all URLs exactly once
  const revokedA: string[] = [];
  const utta = createUtterance({
    chunks: ["a0", "a1"],
    fetchChunk: async (text) => ({ url: `blob:${text}` }),
    play: async () => "done",
    revoke: (url) => revokedA.push(url),
  });
  await utta.run();
  assert.deepEqual(revokedA.sort(), ["blob:a0", "blob:a1"]);

  // Case B: stop revokes all created URLs
  const revokedB: string[] = [];
  const uttb = createUtterance({
    chunks: ["b0", "b1"],
    fetchChunk: async (text) => ({ url: `blob:${text}` }),
    play: async () => "done",
    revoke: (url) => revokedB.push(url),
  });
  uttb.stop();
  assert.deepEqual(revokedB, []); // none created yet before run
  // If run had fetched:
  const revokedB2: string[] = [];
  const blockB = true;
  const uttb2 = createUtterance({
    chunks: ["b0", "b1"],
    fetchChunk: async (text) => ({ url: `blob:${text}` }),
    play: async () => {
      if (blockB) return "blocked";
      return "done";
    },
    revoke: (url) => revokedB2.push(url),
  });
  await uttb2.run();
  assert.equal(revokedB2.length, 0); // blocked, not revoked yet
  uttb2.stop();
  assert.deepEqual(revokedB2.sort(), ["blob:b0", "blob:b1"]);

  // Case C: failed utterance that is then stopped or superseded revokes all URLs
  const revokedC: string[] = [];
  const uttc = createUtterance({
    chunks: ["c0", "c1", "c2"],
    fetchChunk: async (text, idx) => {
      if (idx === 1) throw new Error("fetch fail");
      return { url: `blob:${text}` };
    },
    play: async () => "done",
    revoke: (url) => revokedC.push(url),
  });
  const failOutcome = await uttc.run();
  assert.equal(failOutcome.state, "failed");
  // Before stop: c0 was created and NOT yet revoked
  assert.equal(revokedC.length, 0);
  // After stop: both c0 and prefetched c2 are revoked
  uttc.stop();
  assert.deepEqual(revokedC.sort(), ["blob:c0", "blob:c2"]);
  // Multiple stop() calls do not revoke twice
  uttc.stop();
  assert.deepEqual(revokedC.sort(), ["blob:c0", "blob:c2"]);
});
