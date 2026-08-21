// ElevenLabs Agents transport for the voice interview — everything that goes
// through the @elevenlabs/react SDK. Extracted verbatim from VoiceInterview.tsx.
//
// This one IS a hook (useConversation must be called from a component/hook), so
// it is called at exactly the position the raw useConversation call occupied in
// VoiceInterviewInner, keeping hook order and effect order unchanged. Its
// callbacks are rebuilt every render exactly as they were before, and every
// value they touch is either a ref or a stable callback.

import { useConversation } from "@elevenlabs/react";
import type { VoiceTurn } from "@/app/_lib/voice/types";

// Everything crosses this boundary as a callback rather than as a ref box: the
// React Compiler's `react-hooks/immutability` rule forbids a hook from writing
// through its own arguments, so the ref latches (reachedLive, errored) stay
// component-side and this module only says WHEN they happen.
export type ElevenLabsTransportCtx = {
  /** finalizedRef.current — read-only. */
  isFinalized: () => boolean;
  /** Whether ElevenLabs is the provider that actually served this call. */
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
};

export type ElevenLabsConversation = ReturnType<typeof useConversation>;

export function useElevenLabsTransport(ctx: ElevenLabsTransportCtx): ElevenLabsConversation {
  const conversation = useConversation({
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
 *  session config. phase → live via onConnect. */
export function startElevenLabsSession(args: {
  conversation: ElevenLabsConversation;
  signedUrl: string;
  agentPrompt?: string;
  language: "auto" | "cs" | "en";
  /** Some SDK versions return a promise; a rejection is surfaced here instead of hanging. */
  onAsyncError: (err: unknown) => void;
}) {
  const { conversation, signedUrl, agentPrompt, language, onAsyncError } = args;
  // Pin the agent's LANGUAGE to the candidate's, not just via the prompt. The EL agent's
  // dashboard default is Czech (setup-eleven-agent.mjs), and the prompt's "follow the
  // candidate's language" rule loses to that config over voice (the voice-harness caught the
  // agent replying in Czech to an English candidate ~2/3 of the time). The agent allows the
  // language override, so send it whenever we have a concrete hint (candidate portal seeds it
  // from the visitor's locale; the lab's "auto" leaves detection to the agent).
  const agentOverride: { prompt?: { prompt: string }; language?: "cs" | "en" } = {};
  if (agentPrompt) agentOverride.prompt = { prompt: agentPrompt };
  if (language !== "auto") agentOverride.language = language;
  const maybe = conversation.startSession({
    signedUrl,
    connectionType: "websocket",
    ...(Object.keys(agentOverride).length ? { overrides: { agent: agentOverride } } : {}),
  }) as unknown;
  // Some SDK versions return a promise; surface a rejection instead of hanging.
  if (maybe && typeof (maybe as { then?: unknown }).then === "function") {
    (maybe as Promise<unknown>).catch(onAsyncError);
  }
}
