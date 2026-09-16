"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Check } from "lucide-react";
import { BTN_GHOST, BTN_PRIMARY, CARD_PAD, EYEBROW, META_LABEL, NOTICE, PANEL } from "@/app/_components/ui/recipes";
import { Skeleton } from "@/app/_components/Skeleton";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { AnalyzeFileDropZone } from "@/app/features/tools/analyze/AnalyzeFileDropZone";
import {
  classifyDraft,
  classifyExtract,
  classifySave,
  rememberDraftSource,
  IMPORT_STAGES,
  type DraftSource,
  type ImportFailure,
  type ImportStage,
  type ResponseLike,
} from "./importOutcome";

// The import: a CV file → text (POST /api/extract-text, the extractor the CV
// pipeline uses) → a structured profile draft (POST /api/profile/draft, the SAME
// profile_draft the recruiter-side intake uses, so a seeker's profile is the shape
// the matcher already scores) → the seeker's row (PUT /api/jobseeker/profile, with
// the raw text kept as the polish dialog's source).
//
// Five states, drawn as a checklist rather than a spinner: each stage is a line that
// ticks, so a stall says WHERE. WHAT ended a hop is decided in importOutcome.ts and
// only painted here: a coded refusal renders from its CODE (useErrorMessage), a PDF
// that extracted to nothing gets the sentence its own remedy needs, and an
// unreachable server says so instead of blaming the file.
//
// The drafting line also says WHO READ THE CV. `profile_draft_cli` answers
// `source: "deterministic"` when no model could serve, and the fixed parser records
// skills exactly as the CV states them — a materially different reading that used to
// be invisible. It is an amber caveat, never an error: the import succeeded.

type Stage = "idle" | ImportStage | "saved" | "error";
const STAGES = IMPORT_STAGES;

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
  const tCommon = useTranslations("me.common");
  const tProfile = useTranslations("me.profile");
  const resolveError = useErrorMessage();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [source, setSource] = useState<DraftSource>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = stage === "extracting" || stage === "drafting" || stage === "saving";

  /** One JSON hop. A rejected fetch and a body that is not JSON arrive at the
   *  classifier the same way — as `null` — because they are the same fact: nothing
   *  the server said reached us. */
  async function postJson(url: string, init: RequestInit): Promise<{ res: ResponseLike; body: Record<string, unknown> | null }> {
    try {
      const res = await fetch(url, init);
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { res, body };
    } catch {
      /* offline, DNS, a killed tab: not a verdict on the file, so it is classified
         as transport rather than folded into "that file could not be read" */
      return { res: { ok: false }, body: null };
    }
  }

  async function run() {
    if (!file || busy) return;
    setFailure(null);
    setSource(null);
    const stop = (f: ImportFailure) => {
      setFailure(f);
      setStage("error");
    };

    setStage("extracting");
    const form = new FormData();
    form.append("file", file);
    const extracted = await postJson("/api/extract-text", { method: "POST", body: form });
    const extract = classifyExtract(extracted.res, extracted.body);
    if (!extract.ok) return stop(extract);

    setStage("drafting");
    const drafted = await postJson("/api/profile/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: extract.text }),
    });
    const draft = classifyDraft(drafted.res, drafted.body);
    if (!draft.ok) return stop(draft);
    setSource(draft.source);

    setStage("saving");
    const saved = await postJson("/api/jobseeker/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: draft.profile, cvSourceText: extract.text }),
    });
    const stored = classifySave(saved.res, saved.body);
    if (!stored.ok) return stop(stored);

    // Which reader produced the draft is a property of the RUN, so it is kept for
    // the profile it produced before the page swaps to the summary.
    rememberDraftSource(stored.profile.id, draft.source);
    setStage("saved");
    onSaved(stored.profile);
  }

  const stageFallback: Record<ImportStage, string> = {
    extracting: t("errExtract"),
    drafting: t("errDraft"),
    saving: t("errSave"),
  };
  const errorLine = !failure
    ? null
    : failure.reason === "noTextLayer"
      ? t("errNoTextLayer")
      : failure.reason === "transport"
        ? // ONE transport sentence for the whole seeker module: the hop that failed does
          // not change what a reader whose server is unreachable has to do about it.
          tCommon("unreachable")
        : resolveError({ code: failure.code }, stageFallback[failure.stage]);

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

      {source === "deterministic" && (busy || stage === "saved") ? (
        <div className={`${NOTICE("amber")} px-3 py-2`} role="status">
          <p className="text-sm font-semibold">{tProfile("readWithoutAiTitle")}</p>
          <p className="mt-0.5 text-sm">{tProfile("readWithoutAiBody")}</p>
        </div>
      ) : null}

      {errorLine ? (
        <p className="text-sm text-coral" role="alert">
          {errorLine}
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
