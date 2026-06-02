"use client";

import { useState } from "react";
import { Check, History, RotateCcw, UserPlus } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { EmptyState } from "./JobsShared";

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
  const [addError, setAddError] = useState<Record<string, string>>({});
  const [announce, setAnnounce] = useState("");

  const add = async (c: Rediscovered) => {
    setAdding(c.candidateId);
    setAddError((p) => {
      if (!(c.candidateId in p)) return p;
      const next = { ...p };
      delete next[c.candidateId];
      return next;
    });
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
          stage: "Screened",
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? `Couldn't add (${res.status}).`);
      setAdded((p) => ({ ...p, [c.candidateId]: true }));
      setAnnounce(`${c.label} added to the pipeline.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Couldn't add to the pipeline.";
      setAddError((p) => ({ ...p, [c.candidateId]: message }));
      setAnnounce(`Couldn't add ${c.label} to the pipeline. ${message}`);
    } finally {
      setAdding(null);
    }
  };

  if (error) return <p className="text-base text-coral">{error}</p>;
  if (!data) return <p className="text-base text-steel">Scanning past candidates for a fit…</p>;
  if (data.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No past candidates resurface yet"
        body="As people are rejected or hired elsewhere, strong cross-role fits will appear here."
      />
    );
  }

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <p className="text-base text-steel">
        Past candidates who clear the bar for <span className="font-medium text-ink">{jobTitle}</span> but aren&apos;t in
        its pipeline — worth a second look.
      </p>
      <ul className="mt-3 space-y-2">
        {data.map((c) => (
          <li key={c.candidateId} className="flex items-center gap-3 rounded-md border border-stone-200 bg-white px-3 py-2">
            <span className="shrink-0"><ScoreBadge score={c.score} /></span>
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
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => add(c)}
                  disabled={adding === c.candidateId}
                  title={addError[c.candidateId] ?? undefined}
                  className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                    addError[c.candidateId]
                      ? "border-coral/50 bg-coral/5 text-coral hover:border-coral/70"
                      : "border-stone-200 text-ink hover:border-coral/40"
                  }`}
                >
                  {addError[c.candidateId] ? (
                    <RotateCcw size={14} className="text-coral" />
                  ) : (
                    <UserPlus size={14} className="text-coral" />
                  )}{" "}
                  {adding === c.candidateId ? "Adding…" : addError[c.candidateId] ? "Try again" : "Add to pipeline"}
                </button>
                {addError[c.candidateId] ? (
                  <span className="max-w-[12rem] text-right text-meta text-coral">
                    Couldn&apos;t add — {addError[c.candidateId]}
                  </span>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
