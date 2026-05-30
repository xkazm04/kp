"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import type { Entry } from "./DecisionsTypes";

type SkillClaim = { skill?: string; level?: string; provenance?: string };
type Payload = {
  seniority?: string;
  archetype?: string;
  roleFamily?: string;
  yearsExperience?: number;
  educationLevel?: string;
  educationDetail?: string;
  location?: string;
  languages?: string[];
  aspirations?: string[];
  skillClaims?: SkillClaim[];
};

const scoreTone = (s: number | null) =>
  s == null ? "bg-stone-100 text-steel" : s >= 72 ? "bg-moss/20 text-moss" : s >= 55 ? "bg-amber-100 text-amber-700" : "bg-coral/15 text-coral";

// Read-only analysis summary derived from the profile data already gathered for
// this candidate (no new AI call) + their match score for the role, with the
// advance/reject decision in the footer.
export function AnalysisSummaryModal({
  entry,
  onClose,
  onAccept,
  onReject,
}: {
  entry: Entry;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(Boolean(entry.candidateId));

  useEffect(() => {
    if (!entry.candidateId) return;
    let alive = true;
    fetch(`/api/profile?id=${encodeURIComponent(entry.candidateId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p) => alive && setPayload((p.profile?.payload as Payload) ?? null))
      .catch(() => alive && setPayload(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entry.candidateId]);

  const skills = (payload?.skillClaims ?? []).map((c) => c.skill).filter(Boolean).slice(0, 12) as string[];

  return (
    <Modal
      title={entry.candidateLabel}
      subtitle={entry.jobTitle ?? undefined}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onReject}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-coral hover:bg-coral/5"
          >
            <X size={15} /> Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:opacity-90"
          >
            <Check size={15} /> Advance
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-1 text-sm font-semibold ${scoreTone(entry.matchScore)}`}>
          Fit {entry.matchScore ?? "—"}/100
        </span>
        {payload?.seniority ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{payload.seniority}</span> : null}
        {payload?.yearsExperience != null ? (
          <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{payload.yearsExperience} yrs</span>
        ) : null}
        {payload?.educationLevel ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{payload.educationLevel}</span> : null}
        {payload?.location ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-steel">{payload.location}</span> : null}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-steel">Loading analysis…</p>
      ) : (
        <div className="mt-4 space-y-4">
          {skills.length ? (
            <div>
              <p className="text-meta uppercase tracking-wide text-steel">Skills</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <span key={s} className="rounded-md bg-green-50 px-2 py-0.5 text-sm text-green-700">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {payload?.aspirations?.length ? (
            <div>
              <p className="text-meta uppercase tracking-wide text-steel">Aspirations</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
                {payload.aspirations.slice(0, 4).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload?.languages?.length ? (
            <p className="text-sm text-steel">
              <span className="font-semibold text-ink">Languages:</span> {payload.languages.join(", ")}
            </p>
          ) : null}
          {payload?.educationDetail ? (
            <p className="text-sm text-steel">
              <span className="font-semibold text-ink">Education:</span> {payload.educationDetail}
            </p>
          ) : null}

          <p className="text-sm text-steel">Summary derived from the candidate&apos;s gathered profile data and their match score for this role.</p>
        </div>
      )}
    </Modal>
  );
}
