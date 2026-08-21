// Pure types + helpers for the interview transcript modal (Schedule), split
// out of ScheduleInterviewTranscriptModal.tsx so the modal file stays under
// the 200-line cap.

import { RATING_MAX } from "@/app/_lib/format";
import type { Scorecard } from "@/app/_lib/interview-scorecard";
import type { VoiceTurn } from "@/app/_lib/voice/types";

// Mirrors the /api/interview/by-entry response (a serialized InterviewSession):
// the transcript is the same canonical VoiceTurn[] the server persists and the
// browser produces, so the modal's row type can't drift from what it renders.
export type Session = {
  provider?: string;
  status?: string;
  endedAt?: string | null;
  transcript?: VoiceTurn[] | null;
  scorecard?: Scorecard | null;
};

// Defense-in-depth at the trust boundary: latestInterviewByEntry returns the stored
// scorecard JSON verbatim (no per-rating validation), so a legacy row, a partial/
// failed synthesis, or a non-Python provider can carry a rating that is a string,
// null, or out of range. Coerce to a finite int clamped to [1, RATING_MAX]; return
// null ("Not assessed") for anything non-numeric so the meter and N/RATING_MAX label
// never render NaN. Mirrors the clamp already enforced on the Python path.
export const cleanRating = (raw: unknown): number | null => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(RATING_MAX, Math.max(1, Math.round(n)));
};

const normText = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

// Anchor a scorecard evidence quote to the transcript turn it came from (VOX3).
// The quote is usually a verbatim (or near-verbatim) candidate line, so prefer
// containment either way; otherwise fall back to the turn sharing the most
// distinctive words. Returns -1 when nothing matches well enough, so a
// paraphrased / synthesized quote isn't mis-anchored to an unrelated turn.
export function findEvidenceTurn(evidence: string, turns: VoiceTurn[]): number {
  const e = normText(evidence);
  if (e.length < 8) return -1;
  for (let i = 0; i < turns.length; i++) {
    const t = normText(turns[i].text ?? "");
    if (t.length >= 8 && (t.includes(e) || e.includes(t))) return i;
  }
  const eWords = new Set(e.split(" ").filter((w) => w.length >= 4));
  if (eWords.size === 0) return -1;
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < turns.length; i++) {
    // DISTINCT words on both sides. Counting occurrences (a plain array) let one
    // repeated word stand in for several: a turn saying "platform" three times
    // scored 3/4 against a four-word quote — beating the turn that actually shared
    // two of them, and pushing the score above the 1.0 the ratio is supposed to cap
    // at. The gate below says "a majority of DISTINCT words", so the numerator has
    // to be counted the same way as the denominator (eWords is already a Set).
    const tWords = new Set(normText(turns[i].text ?? "").split(" ").filter((w) => w.length >= 4));
    let shared = 0;
    for (const w of tWords) if (eWords.has(w)) shared += 1;
    const score = shared / eWords.size;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 0.5 ? best : -1; // require a majority of distinctive words to overlap
}
