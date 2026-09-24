"use client";

import { useEffect, useRef, useState } from "react";

// Opt-in candidate microphone recording during the AI interview (spark
// ai-interview-parity, WP3).
//
// THE ONE RULE THIS FILE OBEYS: recording may never interrupt, delay or alter the
// interview. Every failure path — no MediaRecorder, a denied second getUserMedia, a
// refused upload, a dead network — lands on state `"failed"` and stops. Nothing throws
// out of here, nothing awaits on the call's own path, and no error reaches the
// candidate as an interruption. The audio is an observation aid; the conversation is
// the product (registry: recruiting/voice-interview-fidelity).
//
// HOW IT RUNS. MediaRecorder over the CANDIDATE'S MICROPHONE ONLY — the transport's own
// stream when it exposes one (OpenAI), otherwise a stream this hook acquires and stops
// itself (ElevenLabs owns the SDK's). A 10 s timeslice, so a dropped tab loses at most
// ten seconds rather than the whole call. Chunks upload STRICTLY SEQUENTIALLY with a
// monotonic index: the server appends to one file and acknowledges any index at or
// below its cursor as a replay, so an overlapping retry could otherwise write the same
// audio twice or leave a hole. The counter lives in a ref keyed by ATTEMPT, so a
// restart inside one attempt continues the sequence instead of rewinding into the
// server's duplicate window.
//
// THE FALLING EDGE of `active` is the final flush: `recorder.stop()` fires one last
// `dataavailable` after teardown, which is why the upload door keeps accepting chunks
// for two minutes after a session finalizes.

export type InterviewRecordingState = "off" | "recording" | "uploading" | "failed" | "done";

export type UseInterviewRecordingArgs = {
  /** The workspace offers recording (server-decided, passed down by the portal page). */
  offered: boolean;
  /** The candidate ticked the separate recording checkbox. */
  consent: boolean;
  /** The session token — the upload's only credential. */
  token: string | null;
  sessionId: string | null;
  /** interview_sessions.attempts for the connected call. */
  attempt: number;
  /** The call's own microphone stream when the transport exposes one (OpenAI); null
   *  makes the hook acquire its own (ElevenLabs owns the SDK's stream). */
  micStream: MediaStream | null;
  /** True while the call is live; the falling edge flushes the final chunk. */
  active: boolean;
};

/** How much audio one `dataavailable` covers. Ten seconds bounds what an abrupt tab
 *  close can lose, and keeps every chunk far inside the door's 2 MB per-chunk cap. */
const TIMESLICE_MS = 10_000;

/** Container formats, best first. `audio/webm;codecs=opus` is what Chrome/Firefox give
 *  and what the server prefers; `audio/mp4` is Safari's only answer; ogg is the older
 *  Firefox fallback. Anything outside the server's allow-list is not offered here, so a
 *  browser we cannot store is detected BEFORE a stream is opened rather than by a 415. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

function pickRecordingMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      /* a browser whose isTypeSupported throws on an unknown type — try the next */
    }
  }
  return null;
}

export function useInterviewRecording(args: UseInterviewRecordingArgs): { state: InterviewRecordingState } {
  const { offered, consent, token, sessionId, attempt, micStream, active } = args;
  const [state, setState] = useState<InterviewRecordingState>("off");

  // The transport's stream, read at START time only. Deliberately NOT an effect
  // dependency: re-running on a new stream identity would stop and restart
  // MediaRecorder mid-call, and a second container header spliced into the middle of
  // one file is a file most players stop at.
  const micStreamRef = useRef<MediaStream | null>(micStream);
  // Declared BEFORE the capture effect below, so within one commit the ref is already
  // current when that effect (re-)runs. A ref write during render is a cascading-render
  // hazard React's own lint rule refuses, and this value is only ever read from an
  // effect anyway.
  useEffect(() => {
    micStreamRef.current = micStream;
  }, [micStream]);

  // The chunk cursor, per attempt. A remount or a restart inside the same attempt MUST
  // continue the sequence: an index the server has already stored is treated as a
  // replay and dropped, so a rewind would silently discard real audio.
  const chunkRef = useRef(0);
  const attemptRef = useRef<number | null>(null);

  const enabled = Boolean(offered && consent && active && token && sessionId);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (attemptRef.current !== attempt) {
      attemptRef.current = attempt;
      chunkRef.current = 0;
    }

    // Captured per run so a teardown cannot touch a later one's recorder or queue.
    const queue: Blob[] = [];
    let recorder: MediaRecorder | null = null;
    let owned: MediaStream | null = null;
    let failed = false;
    let stopping = false;
    let draining = false;
    let disposed = false;

    const releaseOwnStream = () => {
      if (!owned) return;
      for (const track of owned.getTracks()) {
        try {
          track.stop();
        } catch {
          /* the track is already ended — releasing the mic is best-effort by nature */
        }
      }
      owned = null;
    };

    const fail = (why: string, error?: unknown) => {
      if (failed) return;
      failed = true;
      queue.length = 0;
      // A console line, never a thrown error and never a candidate-facing message: the
      // interview is mid-flight and this is the one subsystem allowed to just stop.
      console.warn(`[interview-recording] ${why}`, error ?? "");
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        /* already torn down — nothing to stop */
      }
      releaseOwnStream();
      setState("failed");
    };

    const settle = () => {
      if (failed || !stopping || queue.length > 0 || draining) return;
      releaseOwnStream();
      setState("done");
    };

    const uploadOne = async (blob: Blob, index: number, mime: string): Promise<void> => {
      const res = await fetch("/api/interview/recording", {
        method: "POST",
        headers: {
          "content-type": mime,
          // The token rides in a HEADER, never the URL: it is a live interview's bearer
          // credential and a URL lands in access logs, Referer and history.
          "x-kp-token": token!,
          "x-kp-session": sessionId!,
          "x-kp-attempt": String(attempt),
          "x-kp-chunk": String(index),
        },
        body: blob,
      });
      if (!res.ok) throw new Error(`upload refused: HTTP ${res.status}`);
    };

    const drain = async (mime: string) => {
      if (draining || failed) return;
      draining = true;
      try {
        while (queue.length > 0 && !failed) {
          const blob = queue[0]!;
          // SEQUENTIAL: the index is only consumed once the append is acknowledged, so
          // a retried chunk keeps its number and the server's replay guard can see it.
          await uploadOne(blob, chunkRef.current, mime);
          queue.shift();
          chunkRef.current += 1;
          if (!stopping) setState("recording");
          else setState("uploading");
        }
      } catch (error) {
        fail("chunk upload failed — recording stops, the interview continues", error);
      } finally {
        draining = false;
        settle();
      }
    };

    const start = async () => {
      const mime = pickRecordingMime();
      if (!mime) {
        fail("this browser has no audio container the server can store");
        return;
      }
      let stream = micStreamRef.current;
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          owned = stream;
        } catch (error) {
          // The candidate already granted the mic to the CALL; a second prompt being
          // denied (or an OS that will not share the device twice) is not an error worth
          // showing them.
          fail("could not open a microphone stream for recording", error);
          return;
        }
      }
      if (disposed) {
        releaseOwnStream();
        return;
      }
      try {
        recorder = new MediaRecorder(stream, { mimeType: mime });
      } catch (error) {
        fail("MediaRecorder refused this stream", error);
        return;
      }
      recorder.ondataavailable = (event) => {
        if (failed || !event.data || event.data.size === 0) return;
        queue.push(event.data);
        void drain(mime);
      };
      recorder.onerror = (event) => fail("MediaRecorder error", event);
      // The recorder is DONE. `ondataavailable` is not guaranteed to fire on stop (a
      // recorder with nothing buffered simply stops), so without this the state would
      // sit on "recording" forever and — worse — a microphone this hook opened itself
      // would never be released. `settle` is a no-op until the queue has drained, so
      // the final flush still finishes first.
      recorder.onstop = () => settle();
      try {
        recorder.start(TIMESLICE_MS);
      } catch (error) {
        fail("MediaRecorder would not start", error);
        return;
      }
      setState("recording");
    };

    void start();

    return () => {
      disposed = true;
      stopping = true;
      // stop() emits ONE more `dataavailable` with whatever is buffered — the final
      // flush. The queue and the drain loop deliberately outlive this cleanup so that
      // last chunk still reaches the door (which accepts it for two minutes past the
      // end of the call); the owned stream is released once the drain settles.
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
        else settle();
      } catch {
        /* already inactive — the queue below is all that is left to flush */
        settle();
      }
    };
    // `micStream` is intentionally absent: see micStreamRef above. `offered`/`consent`/
    // `active` are folded into `enabled`.
  }, [enabled, token, sessionId, attempt]);

  // DERIVED, not a second effect: with no offer and no tick there is nothing to report,
  // and a candidate who un-ticks the box must not be left reading a stale "done" from an
  // earlier attempt. (Written as a derivation because a setState inside an effect is a
  // cascading render for a value that is a pure function of the props.)
  return { state: offered && consent ? state : "off" };
}
