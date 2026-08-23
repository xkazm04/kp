// The ONE validation door. Every synthesize() call passes through validateRequest
// (registry.ts enforces it) so no adapter ever receives an unbounded string or
// a voice id that could become a path or a URL segment.
import { TtsError, type TtsRequest } from "./types.ts";
import { speechReady } from "./text/normalize.ts";

/** Long enough for an interviewer's opening paragraph, short enough that a
 *  one-shot local sidecar returns inside its timeout. Hosts chunk above this. */
export const TTS_MAX_CHARS = 1200;
const VOICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function validateVoiceId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !VOICE_ID_RE.test(value)) {
    throw new TtsError("invalid_voice", "voiceId must be 1-64 chars of [A-Za-z0-9_-]");
  }
  return value;
}

export function validateRequest(req: TtsRequest): TtsRequest {
  const raw = typeof req.text === "string" ? req.text : "";
  const text = (req.format === "chat" ? speechReady(raw) : raw).replace(/\s+/g, " ").trim();
  if (!text) throw new TtsError("invalid_text", "text is empty");
  if (text.length > TTS_MAX_CHARS) throw new TtsError("invalid_text", `text exceeds ${TTS_MAX_CHARS} chars`);
  const language =
    typeof req.language === "string" && req.language.length <= 16 && LANG_RE.test(req.language)
      ? req.language.toLowerCase()
      : null;
  const speed = typeof req.speed === "number" && Number.isFinite(req.speed) ? Math.min(2, Math.max(0.5, req.speed)) : null;
  return { text, language, voiceId: validateVoiceId(req.voiceId), speed, format: req.format === "chat" ? "chat" : "plain" };
}

/** Primary subtag for voice matching: "cs-CZ" -> "cs". */
export function primaryLanguage(language: string | null | undefined): string | null {
  return language ? language.split("-")[0].toLowerCase() : null;
}
