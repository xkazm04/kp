"use client";

import { useState } from "react";
import { Check, UserPlus } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";

type Rediscovered = {
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  prior: { kind: "rejected" | "closed" | "elsewhere"; label: string };
};

const PRIOR_STYLE: Record<string, string> = {
  rejected: "bg-coral/10 text-coral",
  closed: "bg-dial-amber/20 text-ink",
  elsewhere: "bg-steel/10 text-steel",
};

export function RediscoverPanel({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const { data: body, error } = useJsonFetch<{ rediscovered?: Rediscovered[] }>(
    `/api/jobs/${encodeURIComponent(jobId)}/rediscover`,
    "Couldn't run rediscovery."
  );
  const data = body ? body.rediscovered ?? [] : null;
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);

  const add = async (c: Rediscovered) => {
    setAdding(c.candidateId);
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: c.candidateId,
          candidateLabel: c.label,
          archetype: c.archetype,
          jobId,
          jobTitle,
          matchScore: c.score,
          stage: "AI-matched",
        }),
      });
      if (res.ok) setAdded((p) => ({ ...p, [c.candidateId]: true }));
    } finally {
      setAdding(null);
    }
  };

  if (error) return <p className="text-base text-coral">{error}</p>;
  if (!data) return <p className="text-base text-steel">Scanning past candidates for a fit…</p>;
  if (data.length === 0) {
    return (
      <p className="text-base text-steel">
        No past candidates resurface for this role yet. As people are rejected or hired elsewhere, strong cross-role
        fits will appear here.
      </p>
    );
  }

  return (
    <div>
      <p className="text-base text-steel">
        Past candidates who clear the bar for <span className="font-medium text-ink">{jobTitle}</span> but aren&apos;t in
        its pipeline — worth a second look.
      </p>
      <ul className="mt-3 space-y-2">
        {data.map((c) => (
          <li key={c.candidateId} className="flex items-center gap-3 rounded-md border border-stone-200 bg-white px-3 py-2">
            <span className="w-9 shrink-0 text-center font-serif text-lg tabular-nums text-ink">{c.score}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium text-ink">{c.label}</p>
              <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-meta ${PRIOR_STYLE[c.prior.kind]}`}>
                {c.prior.label}
              </span>
            </div>
            {added[c.candidateId] ? (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-moss">
                <Check size={14} /> Added
              </span>
            ) : (
              <button
                type="button"
                onClick={() => add(c)}
                disabled={adding === c.candidateId}
                className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
              >
                <UserPlus size={14} className="text-coral" /> {adding === c.candidateId ? "Adding…" : "Add to pipeline"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
