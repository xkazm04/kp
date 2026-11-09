// Is the AI voice interview part of THIS install? The one place that question is answered.
//
// Product ruling (owner, 2026-11-09, docs/product/oss-1.0-cut.md section 3, Q8/Q9): the AI
// voice interview is OUT of the 1.0 cut. Human interviews remain the path. The code is kept
// and ships SWITCHED OFF: unless the install says `KP_VOICE_INTERVIEW=1` — exactly "1";
// unset, "0", "true" or anything else is off — no door that starts or serves a live voice
// session answers, and no candidate is sent a voice-interview link.
//
// Every door reads it here and nowhere else:
//   - proxy.ts                    isVoiceInterviewPath() answers what an unknown route answers
//   - app/interview/[token]       notFound() (defence in depth under the proxy)
//   - app/_lib/stage-hooks.ts     an AI-round column mints no link and sends no invite
//   - app/_lib/voice/readiness.ts the operator's strip reports voice as switched off
//
// READ routes for sessions already recorded (/api/interview/sessions, .../evidence,
// /recording, /by-entry), plus /compare, /revoke and /complete, are deliberately NOT gated:
// a past record and its erasure/revocation must stay reachable whatever the flag says, and
// none of them starts a session or mints a provider credential. GET /api/voice/readiness
// stays open for the same reason (the strip reports voice as off from it); its POST mints
// one credential per provider to prove them, so that METHOD is gated.
//
// Pure and dependency-free (no node:*, no next/*), because proxy.ts imports it. The env is
// a parameter so tests can drive both states without mutating process.env.

type Env = Readonly<Record<string, string | undefined>>;

/** The install's switch. Default OFF. */
export function voiceInterviewEnabled(env: Env = process.env): boolean {
  return env.KP_VOICE_INTERVIEW === "1";
}

/** `/api/interview/<name>` doors that start or serve a live session (and sub-paths). */
const GATED_INTERVIEW_API = new Set(["connect", "create", "director", "simulate"]);
/** `/api/intake/<id>/<name>` voice doors. */
const GATED_INTAKE_VOICE = new Set(["voice-connect", "voice-turn", "voice-complete"]);

/** The path as Next will route it. `nextUrl.pathname` keeps percent-escapes while the router
 *  resolves the decoded path, so `/api/interview/%63onnect` reaches the connect handler. The
 *  case fold is fail-closed (a differently-cased path has no route anyway, so hiding it costs
 *  nothing). Empty segments drop out, which also covers a trailing or doubled slash. */
function routedSegments(pathname: string): string[] {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* a malformed escape decodes to nothing Next could route: judge it as written */
  }
  return decoded.toLowerCase().split("/").filter(Boolean);
}

/** Every request that starts or serves a live voice session or mints a provider credential
 *  — whole segments only, so `/interviews`, `/api/interview/sessions` and
 *  `/api/interview/connection` are never caught. `method` matters for one door only. */
export function isVoiceInterviewPath(pathname: string, method: string = "GET"): boolean {
  const seg = routedSegments(pathname);
  if (seg[0] === "interview") return true;
  if (seg[0] !== "api") return false;
  if (seg[1] === "interview") return seg[2] !== undefined && GATED_INTERVIEW_API.has(seg[2]);
  if (seg[1] === "intake") return seg[3] !== undefined && GATED_INTAKE_VOICE.has(seg[3]);
  if (seg[1] === "jobs") return seg[3] === "interview-kit" && seg[4] === "rehearse";
  if (seg[1] === "voice") return seg[2] === "readiness" && method.toUpperCase() === "POST";
  return false;
}

/** Should a recruiter surface that STARTS a voice interview be drawn? `enabled` is the
 *  readiness report's field (GET /api/voice/readiness); `null` is "not answered yet" and
 *  reads as hidden, so a switched-off install never flashes a button that would 404.
 *  Records of past interviews do not ask this — they stay readable either way. */
export function voiceSurfaceVisible(enabled: boolean | null | undefined): boolean {
  return enabled === true;
}

/** Thrown by the two code paths that put a voice-interview link in front of a candidate. */
export class VoiceInterviewOffError extends Error {
  constructor() {
    super("the AI voice interview is switched off (KP_VOICE_INTERVIEW is not 1)");
    this.name = "VoiceInterviewOffError";
  }
}

/** Fail-closed backstop under the doors: no invite is minted or mailed with the flag off,
 *  whatever caller reached the function. The env is a parameter for tests. */
export function assertVoiceInterviewEnabled(env: Env = process.env): void {
  if (!voiceInterviewEnabled(env)) throw new VoiceInterviewOffError();
}
