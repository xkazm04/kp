// Opt-in candidate audio recording for the AI interview (spark ai-interview-parity).
//
// STUB — WP3 replaces this module: the workspace setting (default OFF), the file store
// under the data dir, the per-attempt RecordingMeta records, and the retention sweep
// (terminal decision + 30 days, backstop 180 days after the call). Until then no
// workspace offers recording, which is exactly today's behaviour ("no audio is stored").

/** Whether this workspace offers candidates an audio recording of their interview. */
export function isInterviewRecordingOffered(workspaceId: string): boolean {
  void workspaceId;
  return false;
}
