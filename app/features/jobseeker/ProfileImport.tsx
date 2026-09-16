"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Check } from "lucide-react";
import { BTN_GHOST, BTN_PRIMARY, CARD_PAD, EYEBROW, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { Skeleton } from "@/app/_components/Skeleton";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { AnalyzeFileDropZone } from "@/app/features/tools/analyze/AnalyzeFileDropZone";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";

// The import: a CV file → text (POST /api/extract-text, the extractor the CV
// pipeline uses) → a structured profile draft (POST /api/profile/draft, the SAME
// profile_draft the recruiter-side intake uses, so a seeker's profile is the shape
// the matcher already scores) → the seeker's row (PUT /api/jobseeker/profile, with
// the raw text kept as the polish dialog's source).
//
// Five states, drawn as a checklist rather than a spinner: each stage is a line that
// ticks, so a stall says WHERE. Every refusal is rendered from its CODE
// (useErrorMessage); the draft route still answers English prose with no code, so
// its fallback is this page's own localized line.

type Stage = "idle" | "extracting" | "drafting" | "saving" | "saved" | "error";
const STAGES = ["extracting", "drafting", "saving"] as const;

export function ProfileImport({
  existing,
  onSaved,
  onCancel,
}: {
  /** A profile already exists: the import REPLACES its extraction, keeps its CV polish. */
  existing: JobseekerProfile | null;
  onSaved(profile: JobseekerProfile): void;
  onCancel?: () => void;
}) {
  const t = useTranslations("me.import");
  const resolveError = useErrorMessage();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = stage === "extracting" || stage === "drafting" || stage === "saving";

  async function run() {
    if (!file || busy) return;
    setError(null);
    try {
      setStage("extracting");
      const form = new FormData();
      form.append("file", file);
      const extracted = await fetch("/api/extract-text", { method: "POST", body: form });
      const extractedBody = (await extracted.json().catch(() => null)) as { text?: string; code?: string } | null;
      if (!extracted.ok || !extractedBody?.text?.trim()) {
        throw { code: extractedBody?.code ?? null, fallback: t("errExtract") };
      }
      const text = extractedBody.text;

      setStage("drafting");
      const drafted = await fetch("/api/profile/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const draft = (await drafted.json().catch(() => null)) as { profile?: ProfilePayload; code?: string } | null;
      if (!drafted.ok || !draft?.profile) throw { code: draft?.code ?? null, fallback: t("errDraft") };

      setStage("saving");
      const saved = await fetch("/api/jobseeker/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: draft.profile, cvSourceText: text }),
      });
      const profile = (await saved.json().catch(() => null)) as (JobseekerProfile & { code?: string }) | null;
      if (!saved.ok || !profile?.id) throw { code: profile?.code ?? null, fallback: t("errSave") };
      setStage("saved");
      onSaved(profile);
    } catch (err) {
      const e = (err ?? {}) as { code?: string | null; fallback?: string };
      setError(resolveError({ code: e.code ?? null }, e.fallback ?? t("errSave")));
      setStage("error");
    }
  }

  const reached = (s: (typeof STAGES)[number]) => STAGES.indexOf(s) <= STAGES.indexOf(stage as (typeof STAGES)[number]);

  return (
    <section className={`${PANEL} ${CARD_PAD} max-w-2xl space-y-5`}>
      <div>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-h2 text-ink">{existing ? t("titleAgain") : t("title")}</h2>
      </div>

      <AnalyzeFileDropZone inputId="me-cv-file" inputRef={inputRef} file={file} onFileChange={setFile} onRemove={() => setFile(null)} />

      {busy || stage === "saved" ? (
        <ol className="space-y-2" aria-live="polite">
          {STAGES.map((s) => {
            const done = stage === "saved" || STAGES.indexOf(s) < STAGES.indexOf(stage as (typeof STAGES)[number]);
            const active = stage === s;
            return (
              <li key={s} className={`flex items-center gap-2 text-sm ${done ? "text-moss" : active ? "text-ink" : "text-stone-400"}`}>
                <span className="grid h-5 w-5 shrink-0 place-items-center">
                  {done ? <Check size={14} aria-hidden /> : active ? <Skeleton className="h-3 w-3 rounded-full" /> : <span className="h-1.5 w-1.5 rounded-full bg-stone-300" aria-hidden />}
                </span>
                <span className={reached(s) ? "" : META_LABEL}>{t(`stage.${s}`)}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {error ? (
        <p className="text-sm text-coral" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${BTN_PRIMARY} h-10 px-5`} disabled={!file || busy} onClick={() => void run()}>
          {t("cta")} <ArrowRight size={16} aria-hidden />
        </button>
        {onCancel ? (
          <button type="button" className={`${BTN_GHOST} h-10 px-3`} disabled={busy} onClick={onCancel}>
            {t("cancel")}
          </button>
        ) : null}
        <span className="text-sm text-steel">{t("privacy")}</span>
      </div>
    </section>
  );
}
