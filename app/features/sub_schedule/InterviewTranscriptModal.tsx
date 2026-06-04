"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { InterviewRecommendationBadge } from "@/app/_components/Badge";
import { Meter } from "@/app/_components/Meter";
import { scoreTone } from "@/app/_lib/format";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import type { SchedEntry } from "./ScheduleTypes";

type Turn = { role: string; text: string };
type Rating = { competency: string; rating: number; evidence?: string };
type Scorecard = { ratings?: Rating[]; summary?: string; recommendation?: InterviewRecommendation };
type Session = {
  provider?: string;
  status?: string;
  endedAt?: string | null;
  transcript?: Turn[] | null;
  scorecard?: Scorecard | null;
};

// Rating tone tracks strength, not just bar length, on the app-wide score scale:
// the 1-5 rating is mapped to 0-100 and run through scoreTone (75/50 cutoffs), so
// a 4-5 reads strong, a 3 mid, and a 1-2 weak — the scorecard's shape is legible
// at a glance and matches the colors every other ranked surface uses.
const ratingTone = (r: number) => scoreTone((r / 5) * 100);

// Defense-in-depth at the trust boundary: latestInterviewByEntry returns the stored
// scorecard JSON verbatim (no per-rating validation), so a legacy row, a partial/
// failed synthesis, or a non-Python provider can carry a rating that is a string,
// null, or out of range. Coerce to a finite int clamped to [1,5]; return null
// ("Not assessed") for anything non-numeric so the meter and N/5 label never render
// NaN. Mirrors the clamp already enforced on the Python path.
const cleanRating = (raw: unknown): number | null => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
};

export function InterviewTranscriptModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  // The shared hook captures a non-OK status / {error} body that the old bare
  // .then(r => r.json()) swallowed — a 500 now reads as an error rather than an
  // empty "no interview recorded" — and ignores results after unmount.
  const { data, error, reload } = useJsonFetch<{ session?: Session }>(
    `/api/interview/by-entry?entry=${encodeURIComponent(entry.id)}`,
    "Couldn't load the interview."
  );
  const loading = data === null && error === null;
  const session = data?.session ?? null;

  const sc = session?.scorecard ?? null;
  const transcript = session?.transcript ?? [];

  return (
    <Modal title={`Interview transcript · ${entry.candidateLabel}`} subtitle={entry.jobTitle ?? undefined} onClose={onClose} size="3xl">
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-steel">
          <Loader2 size={16} className="animate-spin text-coral" /> Loading…
        </p>
      ) : error ? (
        // Distinct failure state with a retry: a 500 / DB lock / parse error must
        // never read as the reassuring "no interview recorded" empty state below.
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-coral">
            <AlertTriangle size={15} /> {error}
          </p>
          <button
            type="button"
            onClick={reload}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : !session ? (
        <p className="text-sm text-steel">No interview has been recorded for this candidate yet.</p>
      ) : (
        <div className="space-y-5">
          {sc ? (
            <section className="rounded-md border border-stone-200 bg-paper p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-meta uppercase tracking-wide text-steel">AI scorecard</p>
                {sc.recommendation ? <InterviewRecommendationBadge rec={sc.recommendation} /> : null}
              </div>
              {sc.summary ? <p className="mt-1.5 text-base text-ink">{sc.summary}</p> : null}
              {sc.ratings && sc.ratings.length ? (
                <ul className="mt-2.5 space-y-2.5">
                  {sc.ratings.map((r, i) => {
                    const rating = cleanRating(r.rating);
                    return (
                      <li key={i} className="text-sm text-ink">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold">{r.competency}</span>
                          <span className="shrink-0 nums text-steel">{rating != null ? `${rating}/5` : "Not assessed"}</span>
                        </div>
                        {rating != null ? (
                          <Meter
                            value={(rating / 5) * 100}
                            tone={ratingTone(rating)}
                            className="mt-1"
                            aria-label={`${r.competency} rating ${rating} out of 5`}
                          />
                        ) : null}
                        {r.evidence ? <p className="mt-1 text-meta text-steel">{r.evidence}</p> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <p className="mt-2 text-meta text-steel">Feeds the scorecard review in Decisions and the candidate&apos;s analysis.</p>
            </section>
          ) : null}

          <section>
            <p className="text-meta uppercase tracking-wide text-steel">
              Transcript {session.provider ? `· ${session.provider}` : ""}
            </p>
            {transcript.length === 0 ? (
              <p className="mt-2 text-sm text-steel">No transcript captured.</p>
            ) : (
              <div className="mt-2 space-y-2.5">
                {transcript.map((t, i) => (
                  <div key={i} className={t.role === "candidate" ? "text-right" : ""}>
                    <p className="text-meta uppercase text-steel">
                      {t.role === "candidate" ? "Candidate" : t.role === "interviewer" ? "Interviewer (AI)" : "System"}
                    </p>
                    <p
                      className={`mt-0.5 inline-block max-w-[85%] rounded-lg px-3 py-2 text-base leading-6 ${
                        t.role === "candidate" ? "bg-limewash text-ink" : "bg-paper text-ink"
                      }`}
                    >
                      {t.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
