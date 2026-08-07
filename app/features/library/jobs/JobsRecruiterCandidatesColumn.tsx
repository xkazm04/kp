"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CandRow } from "./JobsTypes";
import { EmptyState } from "./JobsShared";
import { JobsRecruiterCandidatesCard } from "./JobsRecruiterCandidatesCard";

export function CandidateColumn({
  title,
  rows,
  highlight,
  added,
  adding,
  error,
  onAdd,
  reached,
  reaching,
  reachError,
  onReach,
  fair,
}: {
  title: string;
  rows: CandRow[];
  highlight?: boolean;
  added: (id: string) => boolean;
  adding: (id: string) => boolean;
  error: (id: string) => string | null;
  onAdd: (c: CandRow) => void;
  reached: (id: string) => boolean;
  reaching: (id: string) => boolean;
  reachError: (id: string) => string | null;
  onReach: (c: CandRow) => void;
  // e1e4e0ea — robust-mean lookup when Fair Rank is active; undefined otherwise.
  fair?: (id: string) => { own: number; mean: number; delta: number } | undefined;
}) {
  const t = useTranslations("jobs.candidates");
  return (
    <div className={`rounded-md border p-2 ${highlight ? "border-green-200 bg-green-50/40" : "border-stone-200"}`}>
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">
        {`${title} (${rows.length})`}
      </p>
      {highlight ? (
        // The fairness guarantee, stated where the candidates actually are — not
        // only in the policy modal: this cohort is scored on potential and is
        // structurally shielded from automated rejection.
        <p className="mt-0.5 text-sm text-steel">{t("fairnessShielded")}</p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={Users} title={t("noCandidatesInGroup")} compact />
      ) : (
        <ol className="mt-2 space-y-2">
          {rows.map((c, i) => (
            <JobsRecruiterCandidatesCard
              key={c.candidateId || `${c.label}-${i}`}
              c={c}
              added={added(c.candidateId)}
              adding={adding(c.candidateId)}
              error={error(c.candidateId)}
              onAdd={() => onAdd(c)}
              reached={reached(c.candidateId)}
              reaching={reaching(c.candidateId)}
              reachError={reachError(c.candidateId)}
              onReach={() => onReach(c)}
              fair={fair?.(c.candidateId)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
