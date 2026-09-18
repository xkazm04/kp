"use client";

// Opt-in candidate microphone recording during the AI interview (spark
// ai-interview-parity).
//
// STUB — WP3 replaces the body with MediaRecorder capture (candidate mic only, both
// providers, 10 s chunks) uploaded to POST /api/interview/recording. The signature is
// the contract the call shell (VoiceInterview) mounts against; until then it records
// nothing, which is exactly today's behaviour.

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

export function useInterviewRecording(args: UseInterviewRecordingArgs): { state: InterviewRecordingState } {
  void args;
  return { state: "off" };
}
