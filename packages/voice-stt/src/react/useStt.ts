"use client";
// The browser side of transcription, the sibling of voice-tts/src/react/useTts.ts
// and deliberately the same shape: a headless hook that talks to whatever route
// the host mounts the package behind (README "Host wrapper"), carries the host's
// machine CODE beside the sentence so a localizing surface can resolve it, and
// owns its own abort.
//
// Without it, the FIRST consumer of this package has to invent four things that
// are not about its feature at all: the permission dance, MediaRecorder's
// container negotiation, the encode to what the on-device engine reads
// (../browser/wav-encode.ts), and the mapping from a refusal body to something a
// person can read. Each of those has one right answer, and each was going to be
// re-derived per surface.
//
// The pure half is `sttPhaseNext` and `sttErrorFrom`, exported and tested
// without a DOM. That split is not tidiness: the parts of this hook that decide
// whether a recording is lost -- a second press while a request is in flight, a
// stop that arrives after a failure, a 503 answered by recording again anyway --
// are all transitions, and a transition table can be proven where a MediaRecorder
// cannot.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SttProviderId, SttStatus } from "../types.ts";
import { encodeWavFromBlob } from "../browser/wav-encode.ts";

/** Where a capture is, in one word a surface can paint.
 *
 *  `requesting` is its own phase rather than part of `recording` because the two
 *  need opposite affordances: the browser is showing its own permission prompt
 *  and the only honest thing the page can say is "waiting for you", while a
 *  recording indicator at that moment claims a capture that has not begun. */
export const STT_PHASES = ["idle", "requesting", "recording", "encoding", "transcribing", "error"] as const;
export type SttPhase = (typeof STT_PHASES)[number];

/** What can happen to a capture. Named for the EVENT, not for the phase it
 *  usually leads to, so an event arriving in the wrong phase is a question the
 *  table answers rather than a branch each caller re-invents. */
export type SttEvent = "press" | "granted" | "denied" | "stop" | "encoded" | "transcribed" | "failed" | "cancel";

/** The whole state machine, pure.
 *
 *  Unknown pairs return the CURRENT phase — the machine never throws and never
 *  lands somewhere it was not sent. That matters most for the late arrivals:
 *  `MediaRecorder.onstop` fires after a failure has already been recorded, and a
 *  table that treated `stop` as universally meaning "encode now" would send a
 *  failed capture back into the upload path and overwrite the error the operator
 *  is reading. */
export function sttPhaseNext(phase: SttPhase, event: SttEvent): SttPhase {
  // A cancel and a failure are the two events that mean the same thing from
  // anywhere: stop what you are doing. Everything else is position-dependent.
  if (event === "cancel") return "idle";
  if (event === "failed") return "error";
  switch (phase) {
    // A press from `error` starts a new capture: the previous failure is read
    // and dismissed by the act of pressing again, so an operator is never stuck
    // with a mic that needs a reload.
    case "idle":
    case "error":
      return event === "press" ? "requesting" : phase;
    case "requesting":
      if (event === "granted") return "recording";
      if (event === "denied") return "error";
      return phase;
    case "recording":
      return event === "stop" ? "encoding" : phase;
    case "encoding":
      return event === "encoded" ? "transcribing" : phase;
    case "transcribing":
      return event === "transcribed" ? "idle" : phase;
    default:
      return phase;
  }
}

/** True while a press must not start a NEW capture. Derived here rather than
 *  spelled out per surface, so a disabled button and the hook cannot disagree
 *  about whether the mic is free. */
export function sttBusy(phase: SttPhase): boolean {
  return phase === "requesting" || phase === "encoding" || phase === "transcribing";
}

/** A refusal the HOST ROUTE coded. Twin of `TtsRequestError`, for the reason
 *  that one exists: `message` is canonical English a non-kp host may have
 *  nothing else to print, `code` is what a localizing host resolves in the
 *  reader's language, and a package that threw only one of them forces every
 *  surface into the wrong half. */
export class SttRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "SttRequestError";
  }
}

/** What a non-2xx answer from the host route MEANS. Pure and exported so the
 *  contract is pinned without a DOM.
 *
 *  Status 499 is the one shape a caller must not read as a fault: it is what the
 *  route answers when THIS client aborted (app/api/stt/route.ts), the socket the
 *  body would have been written to is the one that just closed, and the honest
 *  message is that nothing failed. It still returns an error object rather than
 *  null because the caller is in a catch; `code` of `ABORTED` is what tells it
 *  to go quiet instead of painting red. */
export function sttErrorFrom(body: { error?: string; code?: string | null } | null | undefined, status: number): SttRequestError {
  if (status === 499) return new SttRequestError("aborted", "ABORTED");
  return new SttRequestError(body?.error || `status ${status}`, body?.code ?? null);
}

/** The containers to ask `MediaRecorder` for, best first. Order is not taste:
 *  Opus in WebM is what Chrome and Firefox produce natively, mp4 is Safari's
 *  only answer, and an empty string means "whatever you would have chosen" —
 *  the last resort that keeps a browser we have not met from failing at the
 *  constructor. Every one of them is decoded by the SAME browser a moment later
 *  (../browser/wav-encode.ts), which is why the list can afford to be permissive. */
const RECORDER_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", ""] as const;

function pickRecorderMime(): string {
  const supported = (globalThis as { MediaRecorder?: { isTypeSupported?(t: string): boolean } }).MediaRecorder;
  for (const candidate of RECORDER_MIME_TYPES) {
    if (!candidate) return "";
    if (supported?.isTypeSupported?.(candidate)) return candidate;
  }
  return "";
}

export type UseSttOptions = {
  /** The host route, e.g. "/api/stt". GET returns { providers: SttStatus[] }. */
  endpoint: string;
  /** Fetch wrapper if the host needs credentials/headers. */
  fetcher?: typeof fetch;
  /** BCP-47 hint passed to the engine. Null lets it detect, where it can. */
  language?: string | null;
  /** Refuse any engine that would send the audio off the machine. A per-request
   *  FLOOR: it cannot admit a provider the deployment excludes. */
  onDevice?: boolean;
  /** Hard ceiling on one capture. A mic left open is a bill (the cloud path is
   *  billed per audio hour) and, past the engine's own ceiling, a `STT_TOO_LONG`
   *  after the upload rather than a stop before it. */
  maxSeconds?: number;
  /** Where the transcript goes. A callback rather than a state field the caller
   *  mirrors into its own: a composer appending text is an EVENT, and mirroring
   *  it through state is how the same transcript gets inserted twice. */
  onTranscript?: (text: string, meta: SttServed) => void;
};

export type SttServed = {
  provider: SttProviderId;
  /** What the caller asked for, when the deployment overruled the pick. */
  requestedProvider: SttProviderId | null;
  fallbackFrom: SttProviderId | null;
  language: string | null;
  durationMs: number | null;
  elapsedMs: number;
};

export type UseStt = {
  phase: SttPhase;
  /** True while a press must not start a new capture. */
  busy: boolean;
  /** Sticky: the host answered STT_UNAVAILABLE, so nothing on this install can
   *  listen. A surface disables the control rather than recording into a refusal
   *  a second time — the operator's fix is a server config, not another press.
   *  Cleared only by `refreshProviders` finding a ready engine. */
  unavailable: boolean;
  providers: SttStatus[] | null;
  refreshProviders: () => Promise<void>;
  served: SttServed | null;
  error: string | null;
  /** The host route's machine code for that failure (`STT_FAILED`,
   *  `STT_TOO_LONG`, `STT_UNAVAILABLE`, `AUDIO_*`, `TOO_MANY_REQUESTS`), when it
   *  sent one. Null for a transport or microphone fault. A localizing surface
   *  resolves THIS and keeps `error` for its log. */
  errorCode: string | null;
  /** Press: start when idle, finish when recording. One control, one meaning. */
  toggle: () => void;
  start: () => void;
  /** Finish the capture and transcribe it. */
  stop: () => void;
  /** Throw the capture away: no encode, no upload, no transcript. */
  cancel: () => void;
};

export function useStt({ endpoint, fetcher, language = null, onDevice = false, maxSeconds = 120, onTranscript }: UseSttOptions): UseStt {
  const f = useMemo(() => fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a)), [fetcher]);
  const [phase, setPhase] = useState<SttPhase>("idle");
  const [providers, setProviders] = useState<SttStatus[] | null>(null);
  const [served, setServed] = useState<SttServed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // The phase, mirrored where a callback can READ it. Every mutation goes
  // through `advance`, so the ref and the state cannot disagree — and no
  // transition runs inside a `setState` updater, which React is allowed to
  // invoke twice and which would fire the side effects beside it twice with it.
  const phaseRef = useRef<SttPhase>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by every cancel and every new press. A capture whose generation has
  // moved on writes nothing: the operator who pressed again is waiting for THIS
  // recording, not for the one they abandoned.
  const generation = useRef(0);
  // The latest callback without making it a dependency of `stop`: a caller that
  // passes an inline arrow would otherwise re-create the whole machine on every
  // keystroke in the composer it is appending to.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const advance = useCallback((event: SttEvent): SttPhase => {
    const next = sttPhaseNext(phaseRef.current, event);
    phaseRef.current = next;
    setPhase(next);
    return next;
  }, []);

  const releaseMic = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // The recorder's track is the browser's recording indicator. Leaving it live
    // between captures is a tab that looks like it is always listening, which is
    // the single most alarming thing a product can do with a microphone.
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const fail = useCallback(
    (err: unknown) => {
      releaseMic();
      const code = err instanceof SttRequestError ? err.code : null;
      // The caller's own abort is not a failure, and painting it red teaches an
      // operator to ignore the colour that matters.
      if (code === "ABORTED") {
        advance("cancel");
        return;
      }
      if (code === "STT_UNAVAILABLE") setUnavailable(true);
      setError(err instanceof Error ? err.message : String(err));
      setErrorCode(code);
      advance("failed");
    },
    [advance, releaseMic],
  );

  const cancel = useCallback(() => {
    generation.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    try {
      recorderRef.current?.stop();
    } catch {
      // Best-effort: a recorder already stopped by the browser (tab hidden, the
      // device unplugged) throws here, and the capture is being thrown away
      // anyway — there is nothing an operator would do about it.
    }
    releaseMic();
    advance("cancel");
    setError(null);
    setErrorCode(null);
  }, [advance, releaseMic]);

  // Unmounting mid-capture must release the microphone, or the recording
  // indicator survives the component that started it.
  useEffect(() => cancel, [cancel]);

  const refreshProviders = useCallback(async () => {
    try {
      const res = await f(endpoint, { method: "GET" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as { providers: SttStatus[] };
      setProviders(json.providers);
      // A ready engine is the only thing that can clear the sticky refusal: the
      // operator installed a model or added a key, and the probe is the proof.
      if (json.providers.some((p) => p.allowed && p.probe.state === "ready")) setUnavailable(false);
    } catch (e) {
      setProviders([]);
      setError((e as Error).message);
      // A probe that could not be read carries no route code: the failure is the
      // fetch, not a refusal the host named.
      setErrorCode(null);
    }
  }, [endpoint, f]);

  const upload = useCallback(
    async (clip: Blob, gen: number) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const form = new FormData();
      form.append("audio", new File([clip], "capture.wav", { type: "audio/wav" }));
      if (language) form.append("language", language);
      if (onDevice) form.append("onDevice", "true");
      const res = await f(endpoint, { method: "POST", body: form, signal: ctrl.signal });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        throw sttErrorFrom(body, res.status);
      }
      const json = (await res.json()) as {
        text: string;
        language: string | null;
        provider: SttProviderId;
        requestedProvider: SttProviderId | null;
        fallbackFrom: SttProviderId | null;
        elapsedMs: number;
        durationMs: number | null;
      };
      if (gen !== generation.current) return;
      const meta: SttServed = {
        provider: json.provider,
        requestedProvider: json.requestedProvider,
        fallbackFrom: json.fallbackFrom,
        language: json.language,
        durationMs: json.durationMs,
        elapsedMs: json.elapsedMs,
      };
      setServed(meta);
      advance("transcribed");
      // AFTER the phase moves: the callback typically writes into a composer,
      // and a surface that re-renders on that write must already see an idle mic.
      const text = json.text.trim();
      if (text) onTranscriptRef.current?.(text, meta);
    },
    [advance, endpoint, f, language, onDevice],
  );

  const start = useCallback(() => {
    generation.current += 1;
    const gen = generation.current;
    setError(null);
    setErrorCode(null);
    setServed(null);
    advance("press");
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        // A denial is not a coded refusal from the host: it is the browser's, and
        // the message is the browser's own name for it ("NotAllowedError").
        if (gen === generation.current) {
          setError(e instanceof Error ? e.message : String(e));
          setErrorCode(null);
          advance("denied");
        }
        return;
      }
      if (gen !== generation.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const mime = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        releaseMic();
        if (gen !== generation.current) return;
        void (async () => {
          try {
            const { blob } = await encodeWavFromBlob(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
            if (gen !== generation.current) return;
            advance("encoded");
            await upload(blob, gen);
          } catch (e) {
            if (gen === generation.current) fail(e);
          }
        })();
      };
      recorder.start();
      advance("granted");
      timerRef.current = setTimeout(() => {
        // The ceiling stops the capture and TRANSCRIBES it. Discarding a clip
        // for being long would throw away the words somebody just said.
        try {
          recorder.stop();
        } catch {
          // Best-effort: an already-stopped recorder has nothing left to do, and
          // its onstop has already run the encode path.
        }
        advance("stop");
      }, maxSeconds * 1000);
    })();
  }, [advance, fail, maxSeconds, releaseMic, upload]);

  const stop = useCallback(() => {
    // Guarded on the phase, not on the recorder: a second press, an Enter key
    // and the ceiling timer can all arrive at once, and stopping twice posts the
    // same capture twice.
    if (phaseRef.current !== "recording") return;
    try {
      recorderRef.current?.stop();
    } catch (e) {
      // The recorder refused to stop, so no onstop will arrive and no transcript
      // ever will: report it rather than leaving a mic that looks like it is
      // still recording.
      fail(e);
      return;
    }
    advance("stop");
  }, [advance, fail]);

  const toggle = useCallback(() => {
    if (sttBusy(phaseRef.current)) return;
    if (phaseRef.current === "recording") stop();
    else start();
  }, [start, stop]);

  return {
    phase,
    busy: sttBusy(phase),
    unavailable,
    providers,
    refreshProviders,
    served,
    error,
    errorCode,
    toggle,
    start,
    stop,
    cancel,
  };
}
