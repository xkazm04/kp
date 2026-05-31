"use client";

import { useJsonFetch } from "@/app/_lib/useJsonFetch";

type Rating = { competency: string; rating: number; evidence?: string };
type Candidate = {
  entryId: string | null;
  candidateLabel: string | null;
  recommendation: string | null;
  summary: string | null;
  ratings: Rating[];
};
type Rubric = { competency: string; description: string }[];

const REC_STYLE: Record<string, string> = {
  advance: "bg-moss/15 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  reject: "bg-coral/10 text-coral",
};
const ratingColor = (r: number) =>
  r >= 4 ? "bg-moss/15 text-moss" : r <= 2 ? "bg-coral/10 text-coral" : "bg-stone-100 text-ink";

export function CompareInterviews({ jobId }: { jobId: string }) {
  const { data, error } = useJsonFetch<{ rubric: Rubric; candidates: Candidate[] }>(
    `/api/interview/compare?job=${encodeURIComponent(jobId)}`,
    "Couldn't load interviews."
  );

  if (error) return <p className="text-base text-coral">{error}</p>;
  if (!data) return <p className="text-base text-steel">Loading interviews…</p>;
  if (data.candidates.length === 0) {
    return (
      <p className="text-base text-steel">
        No completed voice interviews for this role yet. Run a voice screen from the pipeline — finished interviews line
        up here, scored on the same rubric for side-by-side comparison.
      </p>
    );
  }

  const ratingOf = (c: Candidate, comp: string) =>
    c.ratings.find((r) => r.competency.toLowerCase() === comp.toLowerCase());

  return (
    <div>
      <p className="text-base text-steel">Every interview scored on the same rubric — compare like for like.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">Competency</th>
              {data.candidates.map((c, i) => (
                <th key={i} className="min-w-[140px] p-2 text-left align-bottom">
                  <p className="font-medium text-ink">{c.candidateLabel}</p>
                  {c.recommendation ? (
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${
                        REC_STYLE[c.recommendation] ?? "bg-stone-100 text-steel"
                      }`}
                    >
                      {c.recommendation}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rubric.map((comp) => (
              <tr key={comp.competency} className="border-t border-stone-100">
                <td className="sticky left-0 bg-white p-2 text-ink" title={comp.description}>
                  {comp.competency}
                </td>
                {data.candidates.map((c, i) => {
                  const r = ratingOf(c, comp.competency);
                  return (
                    <td key={i} className="p-2">
                      {r ? (
                        <span
                          className={`inline-flex h-7 w-9 items-center justify-center rounded-md font-semibold tabular-nums ${ratingColor(
                            r.rating
                          )}`}
                          title={r.evidence || ""}
                        >
                          {r.rating}
                        </span>
                      ) : (
                        <span className="text-steel">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-5 text-meta uppercase text-steel">Highlights</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {data.candidates.map((c, i) => (
          <div key={i} className="rounded-md border border-stone-200 bg-paper/40 p-3">
            <p className="font-medium text-ink">{c.candidateLabel}</p>
            {c.summary ? <p className="mt-0.5 text-sm text-steel">{c.summary}</p> : null}
            <ul className="mt-2 space-y-1">
              {c.ratings
                .filter((r) => r.evidence && r.evidence !== "Not assessed.")
                .slice(0, 3)
                .map((r, j) => (
                  <li key={j} className="text-sm text-ink">
                    <span className="font-medium">{r.competency}:</span> <span className="text-steel">{r.evidence}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
