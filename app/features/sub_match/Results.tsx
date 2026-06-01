"use client";

import { useState } from "react";
import type { MatchRef, MatchResponse, MatchResult } from "./MatchTypes";
import { ARCHETYPE_LABEL, EARLY_CAREER } from "./MatchTypes";
import { Chip, KoReasonsNote, NoMatchesExplainer } from "./MatchShared";
import { MatchCard } from "./MatchCard";

// Below this many survivors the result reads as "thin", so we name the dominant KO
// blocker inline; a full corpus that simply hits the limit shouldn't trigger it.
const THIN_RESULT_MAX = 4;

export function Results({ result, matchRef }: { result: MatchResponse; matchRef: MatchRef }) {
  const { candidate, meta, matches } = result;
  const archetype = candidate.archetype ?? "bau";
  const early = EARLY_CAREER.has(archetype);

  const candidateId = matchRef.profileId ?? matchRef.analysisSlug ?? "";
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  const addToPipeline = async (m: MatchResult) => {
    if (!candidateId || added.has(m.jobId) || adding.has(m.jobId)) return;
    setAdding((s) => new Set(s).add(m.jobId));
    // Clear any prior failure so a retry doesn't show a stale banner.
    setErrors((e) => {
      if (!e.has(m.jobId)) return e;
      const n = new Map(e);
      n.delete(m.jobId);
      return n;
    });
    try {
      const r = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          candidateLabel: candidate.label,
          archetype,
          roleFamily: m.roleFamily,
          jobId: m.jobId,
          jobTitle: m.title,
          matchScore: m.total,
          stage: "AI-matched",
        }),
      });
      if (r.ok) {
        setAdded((s) => new Set(s).add(m.jobId));
      } else {
        const payload = await r.json().catch(() => null);
        const message = (payload as { error?: string } | null)?.error ?? `Couldn't add to pipeline (${r.status}).`;
        setErrors((e) => new Map(e).set(m.jobId, message));
      }
    } catch {
      setErrors((e) => new Map(e).set(m.jobId, "Couldn't add to pipeline — network error. Try again."));
    } finally {
      setAdding((s) => {
        const n = new Set(s);
        n.delete(m.jobId);
        return n;
      });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="Candidate" value={candidate.label ?? "—"} />
        <Chip label="Archetype" value={ARCHETYPE_LABEL[archetype] ?? archetype} tone={early ? "green" : "neutral"} />
        <Chip label="Profile" value={`${candidate.roleFamily ?? "—"} / ${candidate.seniority ?? "—"}`} />
        <Chip label="Evaluated" value={meta.evaluated ?? 0} />
        <Chip label="KO-filtered" value={meta.koFiltered ?? 0} tone="amber" />
        <Chip label="Ranked" value={meta.returned ?? matches.length} tone="green" />
      </div>
      {early ? (
        <p className="mt-2 text-sm text-steel">
          Early-career scoring profile: the <strong>Potential</strong> bar is the readiness model (replacing years of
          experience), and only entry-eligible roles survive the KO filter. Scores are not comparable to experienced
          candidates&apos; numbers.
        </p>
      ) : null}
      {candidate.assumptions?.length ? (
        <p className="mt-1 text-sm text-steel">
          <span className="font-semibold uppercase">Assumptions:</span> {candidate.assumptions.join(" · ")}
        </p>
      ) : null}

      {matches.length === 0 ? (
        <div className="mt-4">
          <NoMatchesExplainer meta={meta} archetype={archetype} />
        </div>
      ) : (
        <>
          {matches.length <= THIN_RESULT_MAX ? (
            <KoReasonsNote koFiltered={meta.koFiltered ?? 0} reasons={meta.koReasons ?? []} />
          ) : null}
          <ol className="mt-4 space-y-2">
            {matches.map((m, i) => (
              <MatchCard
                key={m.jobId}
                m={m}
                index={i}
                matchRef={matchRef}
                archetype={archetype}
                canAdd={Boolean(candidateId)}
                added={added.has(m.jobId)}
                adding={adding.has(m.jobId)}
                addError={errors.get(m.jobId)}
                onAdd={() => addToPipeline(m)}
              />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
