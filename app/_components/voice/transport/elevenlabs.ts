// ElevenLabs Agents transport for the voice interview — everything that goes
// through the @elevenlabs/react SDK. Extracted verbatim from VoiceInterview.tsx.
//
// This one IS a hook (useConversation must be called from a component/hook), so
// it is called at exactly the position the raw useConversation call occupied in
// VoiceInterviewInner, keeping hook order and effect order unchanged. Its
// callbacks are rebuilt every render exactly as they were before, and every
// value they touch is either a ref or a stable callback.

import { useRef } from "react";
import { useConversation } from "@elevenlabs/react";
import type { VoiceTurn } from "@/app/_lib/voice/types";
import { DIRECTOR_TOOL_NAMES } from "@/app/_lib/voice/director-types";
import type { LangHint } from "../ui-types";

/** VAD score above which the candidate counts as speaking, and below which they
 *  count as stopped. Two thresholds, not one: a single line makes the flag chatter
 *  on every consonant, and the timing observation would then record a 200 ms
 *  "answer" (`onVadScore` fires continuously while the socket is open). */
const EL_VAD_SPEAKING = 0.6;
const EL_VAD_SILENT = 0.25;

// Everything crosses this boundary as a callback rather than as a ref box: the
// React Compiler's `react-hooks/immutability` rule forbids a hook from writing
// through its own arguments, so the ref latches (reachedLive, errored) stay
// component-side and this module only says WHEN they happen.
export type ElevenLabsTransportCtx = {
  /** finalizedRef.current — read-only. */
  isFinalized: () => boolean;
  /** Whether this SDK session is the transport serving the current call (the shell
   *  compares the serving CallTransport's handle, never the provider name). */
  isActiveProvider: () => boolean;
  /** The call is up: clear the connect timer, latch reachedLive, phase → live. */
  onConnected: () => void;
  /** A socket close that belongs to this provider — the component owns the
   *  completed-vs-failed verdict (interviewFinalStatus) and finalize. */
  onClosed: () => void;
  /** Provider error: clear the connect timer, latch errored, show the message
   *  (falling back to t("errVoiceSession")), phase → error. `cause` is the SDK's
   *  ORIGINAL throwable, forwarded because it is the only thing that identifies a
   *  microphone failure: the SDK acquires the mic itself (MediaDeviceInput.create
   *  rethrows the raw getUserMedia rejection) and ConversationProvider reports a
   *  rejected startSession through this callback as `(error.message, error)`. The
   *  component maps the DOMException to actionable recovery copy — matching on the
   *  message alone would be guesswork against provider/transport errors. */
  onError: (message: string, cause?: unknown) => void;
  pushTurn: (role: VoiceTurn["role"], text: string) => void;
  /** The directed call's hooks (spark ai-interview-parity). All optional: an
   *  undirected session passes none and the transport behaves as it did before. */
  hooks?: ElevenLabsCallHooks;
};

export type ElevenLabsCallHooks = {
  /** `speaking` ⇒ the agent's audio is playing; `listening` ⇒ it is not. The SDK's
   *  own mode, which is also how we learn the interviewer's audio FINISHED (the
   *  pre-answer silence is measured from it). */
  onMode?: (mode: "speaking" | "listening") => void;
  /** VAD-derived candidate speech boundaries, debounced by the two thresholds above. */
  onCandidateSpeech?: (state: "started" | "stopped") => void;
  /** The agent's line as it streams, when this account/agent streams text at all
   *  (`text_response_part`). Empty string clears the provisional caption. */
  onInterviewerPartial?: (text: string) => void;
};

export type ElevenLabsConversation = ReturnType<typeof useConversation>;

export function useElevenLabsTransport(ctx: ElevenLabsTransportCtx): ElevenLabsConversation {
  // VAD state lives across renders without causing any: `onVadScore` fires many
  // times a second and nothing about it belongs in React state.
  const vadSpeakingRef = useRef(false);
  const conversation = useConversation({
    onModeChange: ({ mode }: { mode: "speaking" | "listening" }) => {
      if (!ctx.isActiveProvider()) return;
      ctx.hooks?.onMode?.(mode);
    },
    onVadScore: ({ vadScore }: { vadScore: number }) => {
      if (!ctx.isActiveProvider() || typeof vadScore !== "number") return;
      if (!vadSpeakingRef.current && vadScore >= EL_VAD_SPEAKING) {
        vadSpeakingRef.current = true;
        ctx.hooks?.onCandidateSpeech?.("started");
      } else if (vadSpeakingRef.current && vadScore <= EL_VAD_SILENT) {
        vadSpeakingRef.current = false;
        ctx.hooks?.onCandidateSpeech?.("stopped");
      }
    },
    // Streaming interviewer caption. Whether an ElevenLabs VOICE agent emits
    // `text_response_part` at all depends on the agent's configuration, so this is
    // an enhancement over the turn-final `onMessage` below, never a replacement:
    // when nothing streams, the caption simply never appears and the transcript
    // still fills on each finalized turn.
    onAgentChatResponsePart: ({ text, type }: { text: string; type: "start" | "delta" | "stop" }) => {
      if (!ctx.isActiveProvider()) return;
      if (type === "stop") ctx.hooks?.onInterviewerPartial?.("");
      else ctx.hooks?.onInterviewerPartial?.(text);
    },
    // A director tool the agent is not configured for (the workspace tools were
    // never deployed — see scripts/setup-eleven-agent.mjs). The platform answers
    // the model itself; we only make the misconfiguration visible to the operator,
    // because from the candidate's side it looks like an interviewer that quietly
    // stopped keeping the record.
    onUnhandledClientToolCall: (call: { tool_name?: string }) => {
      console.warn(
        `[voice] ElevenLabs called an unregistered client tool "${call?.tool_name ?? "?"}" — ` +
          "the agent references tools this browser does not implement (run scripts/setup-eleven-agent.mjs --check).",
      );
    },
    onConnect: () => {
      // A late onConnect after the 30s connect timeout (which latched finalizedRef
      // and tore down) must NOT flip to "live": the candidate would talk into a
      // call whose transcript can never be POSTed. Abandon it instead.
      if (ctx.isFinalized()) {
        try {
          conversation.endSession();
        } catch {
          /* noop */
        }
        return;
      }
      ctx.onConnected();
    },
    onDisconnect: () => {
      // ElevenLabs fires this on every socket close, including the one that
      // follows onError. Finalize as "completed" ONLY when the call actually
      // held a real conversation; an error blip or a never-live connect becomes
      // "failed" so /api/interview/complete skips scoring (and never sets the
      // Interview→Offer approval) and the candidate can retry the link.
      if (!ctx.isActiveProvider()) return;
      ctx.onClosed();
    },
    onError: (message: string, cause?: unknown) => {
      ctx.onError(message, cause);
    },
    onMessage: ({ message, source }: { message: string; source: "user" | "ai" }) =>
      ctx.pushTurn(source === "user" ? "candidate" : "interviewer", message),
  });
  return conversation;
}

/** Open the agent session. Candidate sessions push a CANDIDATE-SAFE agent prompt
 *  as an override (requires the ElevenLabs agent to allow overrides; otherwise it
 *  falls back to the dashboard prompt). The recruiter's private interviewer brief
 *  never reaches this response — the server sends only a generic role-title prompt
 *  (backlog #29 / TP-L2-VOICE-01); OpenAI receives its full brief server-side in the
 *  session config. phase → live via onConnect.
 *
 *  `asrKeywords` is the per-JOB recognizer bias the server built from public job
 *  terms (interviewAsrKeywords). It replaces the agent's account-wide list for
 *  this conversation only — the agent must have the `asr.keywords` override
 *  ENABLED (setup-eleven-agent.mjs OVERRIDE_INTENT), or the platform silently
 *  ignores it and the call runs on the account list. */
export function startElevenLabsSession(args: {
  conversation: ElevenLabsConversation;
  signedUrl: string;
  agentPrompt?: string;
  asrKeywords?: string[];
  language: LangHint;
  /** Some SDK versions return a promise; a rejection is surfaced here instead of hanging. */
  onAsyncError: (err: unknown) => void;
  /** Runs one director tool call and resolves the string the model receives. Given
   *  ⇒ all five tools are registered as CLIENT tools for this session; absent ⇒ the
   *  session runs undirected, exactly as before. */
  onToolCall?: (call: { callId: string; name: string; args: unknown }) => Promise<string>;
}) {
  const { conversation, signedUrl, agentPrompt, asrKeywords, language, onAsyncError, onToolCall } = args;
  // Pin the agent's LANGUAGE to the candidate's, not just via the prompt. The EL agent's
  // dashboard default is Czech (setup-eleven-agent.mjs), and the prompt's "follow the
  // candidate's language" rule loses to that config over voice (the voice-harness caught the
  // agent replying in Czech to an English candidate ~2/3 of the time). The agent allows the
  // language override, so send it whenever we have a concrete hint (candidate portal seeds it
  // from the visitor's locale; the lab's "auto" leaves detection to the agent).
  const agentOverride: { prompt?: { prompt: string }; language?: Exclude<LangHint, "auto"> } = {};
  if (agentPrompt) agentOverride.prompt = { prompt: agentPrompt };
  if (language !== "auto") agentOverride.language = language;
  // Built once so an empty keyword list sends no `asr` branch at all rather than
  // an empty one — an empty override reads as "bias the recognizer toward
  // nothing", which is not what a missing list means.
  const overrides: {
    agent?: typeof agentOverride;
    asr?: { keywords: string[] };
  } = {};
  if (Object.keys(agentOverride).length) overrides.agent = agentOverride;
  if (asrKeywords && asrKeywords.length) overrides.asr = { keywords: asrKeywords };
  // THE DIRECTOR'S TOOLS, as CLIENT tools (spark ai-interview-parity). The agent
  // references them by id in its workspace config (scripts/setup-eleven-agent.mjs
  // --deploy); the browser is what actually answers them, by asking our director.
  // One handler for every name in the vocabulary — the director validates the name, so a tool the
  // agent has and we have not is impossible by construction, and a call we cannot
  // route still gets an answer rather than a 10-second platform timeout.
  //
  // The SDK gives a client tool no call id of its own, so we mint one: the director
  // stores it on the event for the audit trail, and the channel posts each call
  // exactly once, so nothing depends on the provider's numbering.
  let toolSeq = 0;
  const clientTools: Record<string, (parameters: Record<string, unknown>) => Promise<string>> | null = onToolCall
    ? Object.fromEntries(
        DIRECTOR_TOOL_NAMES.map((name) => [
          name,
          async (parameters: Record<string, unknown>) => {
            toolSeq += 1;
            return onToolCall({ callId: `el-${toolSeq}`, name, args: parameters });
          },
        ]),
      )
    : null;
  const maybe = conversation.startSession({
    signedUrl,
    connectionType: "websocket",
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(clientTools ? { clientTools } : {}),
  }) as unknown;
  // Some SDK versions return a promise; surface a rejection instead of hanging.
  if (maybe && typeof (maybe as { then?: unknown }).then === "function") {
    (maybe as Promise<unknown>).catch(onAsyncError);
  }
}

// Stage directions, mute, volume, levels and the end request for a LIVE ElevenLabs
// call go through the call-transport contract (transport/call-transport.ts:
// elevenLabsCallTransport), which takes this hook's conversation structurally.
