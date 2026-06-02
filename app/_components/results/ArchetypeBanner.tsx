"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles, UserPlus } from "lucide-react";
import { ARCHETYPE_LABEL } from "@/app/_lib/archetypes";

// Reads the archetype-relevant fields off the analysis's best-effort v2Profile
// (a normalized CandidateProfileV2 dump, by_alias camelCase). The pipeline
// already computes this on every CV analysis — this surfaces it (it was
// previously computed and thrown away in the UI) and lets the recruiter promote
// the analyzed CV into a real, matchable profile.
type V2 = {
  archetype?: string;
  archetypeConfidence?: number;
  archetypeReasons?: string[];
  completeness?: number;
  displayName?: string;
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; id: string }
  | { kind: "error"; message: string };

export function ArchetypeBanner({ v2Profile }: { v2Profile: Record<string, unknown> }) {
  const v2 = v2Profile as V2;
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  if (!v2.archetype) return null;

  const label = ARCHETYPE_LABEL[v2.archetype] ?? v2.archetype;
  const confidence = Math.round((v2.archetypeConfidence ?? 0) * 100);
  const completeness = Math.round((v2.completeness ?? 0) * 100);
  const reasons = v2.archetypeReasons ?? [];

  const saveAsProfile = async () => {
    setSave({ kind: "saving" });
    try {
      // Pin the inferred archetype as the self-declaration so the re-route is
      // deterministic; profile_cli re-validates + re-scores completeness on save.
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: v2Profile, signals: { selfDeclared: v2.archetype }, persist: true }),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `Save failed (${r.status}).`);
      setSave({ kind: "saved", id: (payload.saved as { id?: string } | null)?.id ?? "" });
    } catch (caught) {
      setSave({ kind: "error", message: caught instanceof Error ? caught.message : "Save failed." });
    }
  };

  return (
    <div className="rounded-lg border border-coral/30 bg-coral/5 p-4 shadow-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={16} className="text-coral" aria-hidden />
        <span className="text-meta uppercase tracking-wide text-coral">Detected archetype</span>
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-sm font-semibold text-white">{label}</span>
        <span className="text-sm text-steel">confidence {confidence}%</span>
        <span className="text-sm text-steel">· completeness {completeness}%</span>

        <span className="ml-auto">
          {save.kind === "saved" ? (
            <Link
              href="/?tab=profile"
              className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-moss/10 px-3 py-1.5 text-sm font-semibold text-moss hover:bg-moss/20"
            >
              <Check size={14} /> Saved · open in Profile <ArrowRight size={13} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={saveAsProfile}
              disabled={save.kind === "saving"}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-steel disabled:opacity-40"
            >
              <UserPlus size={14} /> {save.kind === "saving" ? "Saving…" : "Save as profile"}
            </button>
          )}
        </span>
      </div>

      {reasons.length ? (
        <p className="mt-1.5 text-sm text-steel">Routing: {reasons.join("; ")}</p>
      ) : null}
      <p className="mt-1 text-sm text-steel">
        Early-career CVs are routed so potential replaces years of experience — saving promotes this candidate into the
        pool Match, Jobs, and the pipeline rank.
      </p>
      {save.kind === "error" ? (
        <p className="mt-1.5 text-sm text-red-700" role="alert">
          {save.message}
        </p>
      ) : null}
    </div>
  );
}
