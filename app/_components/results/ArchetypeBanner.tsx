"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles, UserPlus } from "lucide-react";
import { ARCHETYPE_LABEL } from "@/app/_lib/archetypes";
import { GAP_FIELDS, mergeGapAnswers, type CompletenessGap } from "@/app/_lib/completeness-followup";
import { TextInput } from "@/app/_components/TextInput";
import { TextArea } from "@/app/_components/TextArea";
import { formatOptionalFraction } from "./archetypeBannerView";

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
  // The archetype checklist's unmet items (profile.completeness_gaps), riding
  // transiently on the dump — drives the targeted "fill the gaps" follow-up.
  completenessGaps?: CompletenessGap[];
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; id: string }
  | { kind: "error"; message: string };

export function ArchetypeBanner({
  v2Profile,
  sourceAnalysisSlug,
}: {
  v2Profile: Record<string, unknown>;
  // Lineage: the saved analysis this banner's profile came from. When present,
  // "Save as profile" stamps source lineage server-side (/api/profile resolves the
  // authoritative cv_hash from the slug — never client-supplied), enabling
  // staleness detection. Absent (unsaved run) → lineage-less save, old behavior.
  sourceAnalysisSlug?: string;
}) {
  const v2 = v2Profile as V2;
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  // Answers to the completeness follow-up, keyed by check id. Optional: saving
  // with everything blank is the old behavior exactly.
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});

  if (!v2.archetype) return null;

  const label = ARCHETYPE_LABEL[v2.archetype] ?? v2.archetype;
  // bug-ui-scan-2026-07-09 (analysis-result-panels #2): absent confidence/completeness
  // must read as "unknown" (chip omitted), not a definite "0%". formatOptionalFraction
  // returns null for absent/non-finite and a range-guarded "NN%" otherwise.
  const confidence = formatOptionalFraction(v2.archetypeConfidence, "archetypeConfidence");
  const completeness = formatOptionalFraction(v2.completeness, "completeness");
  const reasons = v2.archetypeReasons ?? [];
  // Only gaps the form knows how to collect for (an unknown/new check id has no
  // field and must not render as a label with no input).
  const gaps = (v2.completenessGaps ?? []).filter((g) => GAP_FIELDS[g.check]);

  const saveAsProfile = async () => {
    setSave({ kind: "saving" });
    try {
      // Fold the answered follow-up fields into the analyzed profile, then pin
      // the inferred archetype as the self-declaration so the re-route is
      // deterministic; profile_cli re-validates + re-scores completeness on save.
      const profile = mergeGapAnswers(v2Profile, gapAnswers);
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          signals: { selfDeclared: v2.archetype },
          persist: true,
          ...(sourceAnalysisSlug ? { sourceAnalysisSlug } : {}),
        }),
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
        {confidence != null ? <span className="text-sm text-steel">confidence {confidence}</span> : null}
        {completeness != null ? (
          <span className="text-sm text-steel">
            {confidence != null ? "· " : ""}completeness {completeness}
          </span>
        ) : null}

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

      {gaps.length > 0 && save.kind !== "saved" ? (
        // The completeness-driven follow-up: one targeted field per unmet
        // checklist item (the CV simply didn't carry these), biggest gap first.
        // Optional — saving with blanks is fine; answers merge into the profile.
        <div className="mt-3 border-t border-coral/20 pt-3">
          <p className="text-meta uppercase tracking-wide text-coral">
            Fill the gaps the CV left ({gaps.length}) — optional, raises completeness
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {gaps.map((gap) => {
              const field = GAP_FIELDS[gap.check];
              const shared = {
                value: gapAnswers[gap.check] ?? "",
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  setGapAnswers((a) => ({ ...a, [gap.check]: e.target.value })),
                placeholder: field.placeholder,
                disabled: save.kind === "saving",
              };
              return (
                <label key={gap.check} className="block text-sm text-ink">
                  <span className="text-steel">{field.prompt}</span>
                  {field.multiline ? (
                    <TextArea {...shared} rows={2} sizeVariant="sm" className="mt-1" />
                  ) : (
                    <TextInput {...shared} sizeVariant="sm" className="mt-1" />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      {save.kind === "error" ? (
        <p className="mt-1.5 text-sm text-red-700" role="alert">
          {save.message}
        </p>
      ) : null}
    </div>
  );
}
