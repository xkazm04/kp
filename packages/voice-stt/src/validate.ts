// The ONE validation door. Every transcribe() call passes through
// validateRequest (registry.ts enforces it) so no adapter ever receives an
// unbounded payload, an unknown container, or a model id that could become a
// file path or a URL segment.
import { isSttMimeType, SttError, type SttRequest } from "./types.ts";

/** Package-wide ceiling. An adapter may declare a LOWER `capabilities.maxBytes`
 *  and the dispatch door enforces whichever is smaller — this one exists so a
 *  request is bounded before any provider is even resolved. 25 MB is roughly a
 *  25-minute mono 16 kHz WAV, comfortably past a first-round interview answer. */
export const STT_MAX_BYTES = 25 * 1024 * 1024;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function validateModelId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !MODEL_ID_RE.test(value)) {
    throw new SttError("invalid_model", "modelId must be 1-96 chars of [A-Za-z0-9._-]");
  }
  return value;
}

export function validateRequest(req: SttRequest): SttRequest {
  const audio = req.audio;
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
    throw new SttError("invalid_audio", "audio is empty");
  }
  if (audio.byteLength > STT_MAX_BYTES) {
    throw new SttError("invalid_audio", `audio exceeds ${STT_MAX_BYTES} bytes`);
  }
  if (!isSttMimeType(req.mimeType)) {
    throw new SttError("invalid_audio", `unsupported container ${String(req.mimeType)}`);
  }
  // A malformed language tag is its own refusal rather than a silent null: the
  // caller asked for a language and getting auto-detection instead is a
  // different result, not a lenient reading of the same one.
  if (req.language != null && req.language !== "") {
    if (typeof req.language !== "string" || req.language.length > 16 || !LANG_RE.test(req.language)) {
      throw new SttError("invalid_language", "language must be a BCP-47 tag like 'cs' or 'cs-CZ'");
    }
  }
  const language = req.language ? String(req.language).toLowerCase() : null;
  return {
    audio,
    mimeType: req.mimeType,
    language,
    modelId: validateModelId(req.modelId),
    diarize: req.diarize === true,
    redactPii: req.redactPii === true,
  };
}

/** Primary subtag for model matching: "cs-CZ" -> "cs". */
export function primaryLanguage(language: string | null | undefined): string | null {
  return language ? language.split("-")[0].toLowerCase() : null;
}

/** Whether an engine that declares `languages` can be asked for this language.
 *  "any" means the catalog is too large to enumerate here, not that every tag
 *  works — the engine still answers for itself at request time. */
export function speaksLanguage(languages: readonly string[] | "any", language: string | null): boolean {
  if (languages === "any" || !language) return true;
  return languages.includes(primaryLanguage(language)!);
}
