"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import type { SchedEntry } from "./ScheduleTypes";

type Turn = { role: string; text: string };
type Rating = { competency: string; rating: number; evidence?: string };
type Scorecard = { ratings?: Rating[]; summary?: string; recommendation?: string };
type Session = {
  provider?: string;
  status?: string;
  endedAt?: string | null;
  transcript?: Turn[] | null;
  scorecard?: Scorecard | null;
};

const REC_STYLE: Record<string, string> = {
  advance: "bg-moss/15 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  reject: "bg-coral/10 text-coral",
};

export function InterviewTranscriptModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/interview/by-entry?entry=${encodeURIComponent(entry.id)}`)
      .then((r) => r.json())
      .then((d) => alive && setSession((d.session as Session) ?? null))
      .catch(() => alive && setSession(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entry.id]);

  const sc = session?.scorecard ?? null;
  const transcript = session?.transcript ?? [];

  return (
    <Modal title={`Interview transcript · ${entry.candidateLabel}`} subtitle={entry.jobTitle ?? undefined} onClose={onClose} size="3xl">
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-steel">
          <Loader2 size={16} className="animate-spin text-coral" /> Loading…
        </p>
      ) : !session ? (
        <p className="text-sm text-steel">No interview has been recorded for this candidate yet.</p>
      ) : (
        <div className="space-y-5">
          {sc ? (
            <section className="rounded-md border border-stone-200 bg-paper p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-meta uppercase tracking-wide text-steel">AI scorecard</p>
                {sc.recommendation ? (
                  <span className={`rounded-full px-2.5 py-0.5 text-meta font-semibold uppercase ${REC_STYLE[sc.recommendation] ?? "bg-stone-100 text-steel"}`}>
                    {sc.recommendation}
                  </span>
                ) : null}
              </div>
              {sc.summary ? <p className="mt-1.5 text-base text-ink">{sc.summary}</p> : null}
              {sc.ratings && sc.ratings.length ? (
                <ul className="mt-2 space-y-1">
                  {sc.ratings.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink">
                      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-semibold tabular-nums text-coral">{r.rating}/5</span>
                      <span>
                        <span className="font-semibold">{r.competency}</span>
                        {r.evidence ? <span className="text-steel"> — {r.evidence}</span> : null}
                      </span>
                    </li>
                  ))}
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
