"use client";

import { useState } from "react";
import { Check, Copy, Download, MicVocal } from "lucide-react";
import { useTranslations } from "next-intl";
import { downloadFile } from "@/app/_lib/export-utils";
import { interviewKitMarkdown } from "@/app/_lib/devcase-interview-kit";
import { FollowupQuestionItem } from "./DevShared";
import type { Submission } from "./DevTypes";

// 8d4f38b9 — auto-generated interview kit from the winning submission. The
// evaluator already minted candidate-specific follow-up questions (each anchored
// to a real decision in their work, with internal listen-for / red-flag notes);
// this surfaces the TOP candidate's set at the case level — copy/exportable —
// instead of leaving it buried in one submission's expanded EvalPanel.
export function InterviewKit({ caseTitle, top }: { caseTitle: string; top: Submission }) {
  const t = useTranslations("devcase.interviewKit");
  const [copied, setCopied] = useState(false);
  const questions = top.evaluation?.followups?.questions ?? [];
  // No minted questions → nothing to assemble (an unevaluated or empty bundle).
  if (questions.length === 0) return null;

  const candidateRef = top.candidateRef ?? "—";
  const markdown = interviewKitMarkdown({
    caseTitle,
    candidateRef,
    transferScore: top.transferScore ?? null,
    questions,
  });

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
        <span className="min-w-0 truncate text-micro text-steel">
          {candidateRef}
          {top.transferScore != null ? ` ${t("fit", { score: top.transferScore })}` : ""}
        </span>
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
