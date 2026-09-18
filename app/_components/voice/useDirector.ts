"use client";

// The candidate browser's producer channel (spark ai-interview-parity; ADR 0010).
//
// This is the React half of the director loop: the fetch, the 20-second heartbeat,
// the end-of-call handshake and the client hard stop. Everything that is a RULE
// rather than a lifecycle lives next door in `director-channel.ts` (pure, tested) —
// this file only wires that rule set to a session, a transport and a clock.
//
// Three behaviours here are worth reading before changing anything:
//
//  1. A FAILED EXCHANGE IS NOT AN ERROR THE CANDIDATE SEES. Every non-2xx — 409
//     INTERVIEW_NOT_LIVE, 429, a coded 500, an offline fetch — resolves null, the
//     waiting model is answered "Continue with the agenda." by us, and the call runs
//     undirected. Nothing is rendered, nothing is logged at the candidate.
//  2. endCall WAITS FOR THE VOICE TO FINISH. The director asks for the end after the
//     model has already been told to say its closing line; cutting the socket the
//     moment the answer arrives would hang up mid-goodbye. We wait for the
//     interviewer to be quiet for END_QUIET_MS and then end through the SAME path the
//     End button uses, so there is exactly one teardown in the component.
//  3. THE HARD STOP DOES NOT NEED THE SERVER. hardCap + 2 min of live time (resumed
//     attempts included) ends the call from the browser even if the director has been
//     unreachable the whole time — the one thing that must not depend on the channel
//     that may be down.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CandidateAgendaView,
  DirectorAgendaState,
  DirectorClientEvent,
  DirectorRequest,
  DirectorResponse,
  DirectorTurn,
  ResumeContext,
} from "@/app/_lib/voice/director-types";
import { endHandshakeDone, hardStopDelayMs } from "./call-observations";
import {
  TOOL_RESULT_FALLBACK,
  createDirectorChannel,
  type DirectorChannel,
  type DirectorToolCall,
} from "./director-channel";
import type { TimerRegistry } from "./timer-registry";

/** How often the browser posts with nothing queued. The clock-driven directives
 *  (`close_now`, `end_now`) and `endCall` only reach the browser in a response, so
 *  without a keep-alive a silent stretch of call is an undirected one. 20 s sits
 *  well inside the per-token budget (240/10 min) with room for real traffic. */
export const DIRECTOR_HEARTBEAT_MS = 20_000;
/** How often the end handshake samples the speaking flag. The decision itself is
 *  `endHandshakeDone` in call-observations.ts — pure, and pinned by a test. */
const END_POLL_MS = 200;

export type DirectorSession = {
  token: string;
  sessionId: string;
  /** interview_sessions.attempts for THIS connect. */
  attempt: number;
  /** The candidate projection of the agenda, or null for an undirected call. */
  agenda: CandidateAgendaView | null;
  resume: ResumeContext | null;
};

export type UseDirectorArgs = {
  /** Inject one stage direction into the live provider session, VERBATIM (the text
   *  already carries the server's `[Director] ` prefix). */
  injectDirective: (text: string) => void;
  /** Is the interviewer's audio playing right now? */
  isInterviewerSpeaking: () => boolean;
  /** End the call through the component's ONE teardown path (the End button's). */
  requestEnd: () => void;
  /** The call's timer registry, so unmount empties every timer this hook schedules. */
  timers: { current: TimerRegistry };
};

export type UseDirector = {
  /** Arm the loop for a connected call. Safe to call with a null agenda: the loop
   *  still records turns and answers tool calls, there is simply nothing to direct. */
  begin: (session: DirectorSession) => void;
  /** Disarm (hang-up, error, unmount). Queued tool calls are answered. */
  stop: () => void;
  /** A finalized turn. Returns the seq it was given — `answer_timing` needs it. */
  recordTurn: (role: DirectorTurn["role"], text: string) => number;
  recordEvent: (event: DirectorClientEvent) => void;
  /** Run one tool call end to end. ALWAYS resolves with the string to hand the
   *  model. `awaitTurn` is the transcription race: the shell passes a waiter for a
   *  candidate utterance still being transcribed, and the turn then rides the same
   *  exchange as the tool call, so a true quote is checked against a record that
   *  already contains it. */
  callTool: (call: DirectorToolCall, awaitTurn?: () => Promise<void>) => Promise<string>;
  /** Live agenda state for the sidebar. */
  agendaState: DirectorAgendaState;
  /** True once a connect returned an agenda — i.e. the call is being directed. */
  directed: boolean;
};

/** Did the conversation reach its ending? `role_qa` / `close` are the two fixed
 *  closing blocks every agenda ends with (interview-agenda.ts). Exported for the
 *  finalize rule, which treats a drop before them as resumable rather than done. */
export function closingBegun(agenda: CandidateAgendaView | null, state: DirectorAgendaState): boolean {
  if (!agenda) return false;
  const touched = new Set([...state.coveredBlockIds, ...(state.activeBlockId ? [state.activeBlockId] : [])]);
  return agenda.blocks.some((b) => (b.kind === "role_qa" || b.kind === "close") && touched.has(b.id));
}

const EMPTY_AGENDA_STATE: DirectorAgendaState = { activeBlockId: null, coveredBlockIds: [] };

/** Narrow an untrusted body to a DirectorResponse. A public route's answer is still
 *  a parse, not a cast: a proxy's error page must not become an `endCall`. */
function asDirectorResponse(body: unknown): DirectorResponse | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.ok !== true || typeof b.ackSeq !== "number") return null;
  const agenda = b.agenda as Record<string, unknown> | undefined;
  return {
    ok: true,
    ackSeq: b.ackSeq,
    toolResult: typeof b.toolResult === "string" ? b.toolResult : null,
    directive:
      b.directive && typeof b.directive === "object" && typeof (b.directive as { text?: unknown }).text === "string"
        ? (b.directive as DirectorResponse["directive"])
        : null,
    agenda: {
      activeBlockId: typeof agenda?.activeBlockId === "string" ? agenda.activeBlockId : null,
      coveredBlockIds: Array.isArray(agenda?.coveredBlockIds)
        ? (agenda.coveredBlockIds as unknown[]).filter((id): id is string => typeof id === "string")
        : [],
    },
    endCall: b.endCall === true,
  };
}

export function useDirector({
  injectDirective,
  isInterviewerSpeaking,
  requestEnd,
  timers,
}: UseDirectorArgs): UseDirector {
  const [agendaState, setAgendaState] = useState<DirectorAgendaState>(EMPTY_AGENDA_STATE);
  const [directed, setDirected] = useState(false);
  // True while the heartbeat should run. State (not a ref) because the interval
  // lives in an effect, which is the one place React owns the teardown for us.
  const [live, setLive] = useState(false);

  const channelRef = useRef<DirectorChannel | null>(null);
  const endingRef = useRef(false);
  // Latest callbacks, so the channel built once in `begin` never closes over a
  // stale transport (the ElevenLabs conversation object is rebuilt every render).
  const injectRef = useRef(injectDirective);
  const speakingRef = useRef(isInterviewerSpeaking);
  const endRef = useRef(requestEnd);
  useEffect(() => {
    injectRef.current = injectDirective;
    speakingRef.current = isInterviewerSpeaking;
    endRef.current = requestEnd;
  });

  /** End the call once the interviewer's current utterance has finished. */
  const endAfterUtterance = useCallback(() => {
    if (endingRef.current) return;
    endingRef.current = true;
    const startedAt = Date.now();
    let quietSince: number | null = null;
    let spoke = false;
    const poll = () => {
      const now = Date.now();
      if (speakingRef.current()) {
        spoke = true;
        quietSince = null;
      } else if (quietSince === null) {
        quietSince = now;
      }
      if (
        endHandshakeDone({
          elapsedMs: now - startedAt,
          quietMs: quietSince === null ? null : now - quietSince,
          spoke,
        })
      ) {
        endRef.current();
        return;
      }
      timers.current.set(poll, END_POLL_MS);
    };
    timers.current.set(poll, END_POLL_MS);
  }, [timers]);

  const stop = useCallback(() => {
    channelRef.current?.close();
    channelRef.current = null;
    setLive(false);
  }, []);

  const begin = useCallback(
    (session: DirectorSession) => {
      channelRef.current?.close();
      endingRef.current = false;
      const agenda = session.agenda;
      setDirected(agenda !== null);
      // A reconnect continues from what the earlier attempts reached, so the sidebar
      // shows covered topics IMMEDIATELY rather than only after the first exchange.
      setAgendaState(
        session.resume
          ? { activeBlockId: session.resume.activeBlockId, coveredBlockIds: [...session.resume.coveredBlockIds] }
          : EMPTY_AGENDA_STATE,
      );

      channelRef.current = createDirectorChannel({
        token: session.token,
        sessionId: session.sessionId,
        attempt: session.attempt,
        post: async (req: DirectorRequest) => {
          try {
            const res = await fetch("/api/interview/director", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(req),
            });
            if (!res.ok) {
              // A 409 says this call is no longer the live one (completed, revoked,
              // a stale attempt after a reconnect). Posting again cannot help, and a
              // stale tab pounding a public door is exactly what the per-token budget
              // is there to stop — so close the channel and let the call finish
              // undirected. Every other status is transient: answer "continue" and
              // try again on the next trigger.
              if (res.status === 409) {
                console.warn("[voice] director: this call is no longer live — continuing undirected.");
                channelRef.current?.close();
              }
              return null;
            }
            return asDirectorResponse(await res.json());
          } catch {
            // Offline, aborted, unparseable. The channel's own policy answers the
            // model; there is nothing here the candidate could act on.
            return null;
          }
        },
        onResponse: (res: DirectorResponse) => {
          setAgendaState(res.agenda);
          // VERBATIM: `directive.text` already carries the `[Director] ` prefix
          // (director-types.ts). Adding it again would send "[Director] [Director] …",
          // which the brief never described.
          if (res.directive) injectRef.current(res.directive.text);
          if (res.endCall) endAfterUtterance();
        },
      });
      setLive(true);

      // The one rule that must survive the director being unreachable.
      const delay = hardStopDelayMs({
        hardCapMin: agenda?.hardCapMin ?? null,
        priorElapsedSec: session.resume?.elapsedSec ?? 0,
      });
      if (delay !== null) {
        timers.current.set(() => {
          console.warn("[voice] director: client hard stop reached — ending the call.");
          endAfterUtterance();
        }, delay);
      }
    },
    [endAfterUtterance, timers],
  );

  // The keep-alive. Every tick is also how `close_now` / `end_now` / endCall reach a
  // browser that has had nothing to say for a while.
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => channelRef.current?.heartbeat(), DIRECTOR_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [live]);

  // A component that unmounts mid-call must not leave a tool promise pending.
  useEffect(() => {
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  const recordTurn = useCallback((role: DirectorTurn["role"], text: string) => {
    return channelRef.current?.recordTurn(role, text) ?? -1;
  }, []);

  const recordEvent = useCallback((event: DirectorClientEvent) => {
    channelRef.current?.recordEvent(event);
  }, []);

  const callTool = useCallback(async (call: DirectorToolCall, awaitTurn?: () => Promise<void>) => {
    const channel = channelRef.current;
    if (!channel) return TOOL_RESULT_FALLBACK;
    if (!awaitTurn) return channel.callTool(call);
    // The transcription race (documented as a known gap before this): hold the
    // channel, let the in-flight utterance land as a turn, then send both together.
    channel.hold();
    try {
      await awaitTurn();
    } catch {
      /* the wait is best-effort: a quote checked against a slightly older record is
         still better than a tool call that never gets answered */
    }
    const answer = channel.callTool(call);
    channel.release();
    return answer;
  }, []);

  return { begin, stop, recordTurn, recordEvent, callTool, agendaState, directed };
}
