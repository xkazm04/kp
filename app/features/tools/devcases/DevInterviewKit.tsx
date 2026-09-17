"use client";

import { useState } from "react";
import { Check, Copy, Download, MicVocal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { downloadFile } from "@/app/_lib/export-utils";
import { buildInterviewKitStrings, interviewKitMarkdown } from "@/app/_lib/devcase-interview-kit";
import { FollowupQuestionItem } from "./DevShared";
import { pickKitSubmission } from "./DevInterviewKit.select";
import type { Submission } from "./DevTypes";

// 8d4f38b9 — auto-generated interview kit from a shortlist submission. The
// evaluator already minted candidate-specific follow-up questions (each anchored
// to a real decision in their work, with internal listen-for / red-flag notes);
// this surfaces them at the case level — copy/exportable — instead of leaving
// them buried in one submission's expanded EvalPanel. Default is the transfer
// leader; any followup-bearing shortlist row can be selected.
export function InterviewKit({ caseTitle, candidates }: { caseTitle: string; candidates: Submission[] }) {
  const t = useTranslations("devcase.interviewKit");
  const [copied, setCopied] = useState(false);
  const [kitSubmissionId, setKitSubmissionId] = useState(candidates[0]?.id ?? "");
  const selected = pickKitSubmission(candidates, kitSubmissionId);
  const questions = selected?.evaluation?.followups?.questions ?? [];
  // No minted questions → nothing to assemble (an unevaluated or empty bundle).
  if (!selected || questions.length === 0) return null;

  const candidateRef = selected.candidateRef ?? "—";
  const band = selected.evaluation?.authenticity?.band;
  // F15 — the exported/copied Markdown is read by the panel, i.e. colleagues in this
  // tenant, so its scaffolding is the UI user's language. next-intl rejects the
  // template-literal keys the builder uses, so the bound `t` is widened to the
  // module's structural lookup type (every key it asks for exists in the catalog,
  // pinned by devcase-interview-kit.test.ts).
  const markdown = interviewKitMarkdown(
    {
      caseTitle,
      candidateRef,
      transferScore: selected.transferScore ?? null,
      questions,
    },
    buildInterviewKitStrings((key, values) => t(key as Parameters<typeof t>[0], values))
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the Download button is the fallback */
    }
  };

  return (
    <section className="rounded-lg border border-moss/30 bg-moss/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-moss">
          <MicVocal size={13} /> {t("title")}
        </h3>
        {candidates.length > 1 ? (
          <Select
            sizeVariant="sm"
            ariaLabel={t("pickAria")}
            value={selected.id}
            onChange={setKitSubmissionId}
            options={candidates.map((s) => {
              const sBand = s.evaluation?.authenticity?.band;
              const auth = sBand ? ` · ${t(`band.${sBand}` as Parameters<typeof t>[0])}` : "";
              const fit = s.transferScore != null ? ` ${t("fit", { score: s.transferScore })}` : "";
              return { value: s.id, label: `${s.candidateRef ?? "—"}${fit}${auth}` };
            })}
          />
        ) : (
          <span className="min-w-0 truncate text-micro text-steel">
            {candidateRef}
            {selected.transferScore != null ? ` ${t("fit", { score: selected.transferScore })}` : ""}
          </span>
        )}
        {band ? (
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-micro font-semibold uppercase ${
              band === "suspect" ? "bg-coral/15 text-coral" : band === "mixed" ? "bg-amber-100 text-amber-700" : "bg-moss/15 text-moss"
            }`}
          >
            {t(`band.${band}` as Parameters<typeof t>[0])}
          </span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={copy}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-ink hover:border-coral/40"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t("copied") : t("copy")}
          </button>
          <button
            type="button"
            onClick={() => downloadFile("interview-kit.md", markdown, "text/markdown")}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-ink hover:border-coral/40"
          >
            <Download size={12} /> {t("export")}
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-micro text-steel">{t("intro")}</p>
      <ol className="mt-2 space-y-2">
        {questions
          .filter((q) => (q.question ?? "").trim())
          .map((q, i) => (
            <li key={q.id ?? i} className="rounded-md border border-stone-200 bg-white p-2.5 text-micro">
              <FollowupQuestionItem q={q} index={i} />
            </li>
          ))}
      </ol>
    </section>
  );
}
