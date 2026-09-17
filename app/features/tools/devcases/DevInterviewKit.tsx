"use client";

import { useState } from "react";
import { Check, Copy, Download, MicVocal } from "lucide-react";
import { useTranslations } from "next-intl";
import { downloadFile } from "@/app/_lib/export-utils";
import {
  buildInterviewKitStrings,
  interviewKitMarkdownMany,
  orderInterviewKitInputs,
} from "@/app/_lib/devcase-interview-kit";
import { FollowupQuestionItem } from "./DevShared";
import type { Submission } from "./DevTypes";

// 8d4f38b9 — auto-generated interview kit. The evaluator already minted
// candidate-specific follow-up questions (each anchored to a real decision in
// their work, with internal listen-for / red-flag notes); this surfaces every
// evaluated set at the case level — held/suspect first — copy/exportable —
// instead of leaving it buried in one submission's expanded EvalPanel.
export function InterviewKit({ caseTitle, submissions }: { caseTitle: string; submissions: Submission[] }) {
  const t = useTranslations("devcase.interviewKit");
  const [copied, setCopied] = useState(false);
  const rows = submissions
    .map((s) => ({
      caseTitle,
      candidateRef: s.candidateRef ?? "—",
      transferScore: s.transferScore ?? null,
      questions: s.evaluation?.followups?.questions ?? [],
      authenticityBand: s.evaluation?.authenticity?.band ?? null,
    }))
    .filter((row) => row.questions.some((q) => (q.question ?? "").trim()));
  if (rows.length === 0) return null;
  const ordered = orderInterviewKitInputs(rows);

  // F15 — the exported/copied Markdown is read by the panel, i.e. colleagues in this
  // tenant, so its scaffolding is the UI user's language. next-intl rejects the
  // template-literal keys the builder uses, so the bound `t` is widened to the
  // module's structural lookup type (every key it asks for exists in the catalog,
  // pinned by devcase-interview-kit.test.ts).
  const markdown = interviewKitMarkdownMany(
    ordered,
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
        <span className="min-w-0 truncate text-micro text-steel">
          {ordered[0].candidateRef}
          {ordered[0].transferScore != null ? ` ${t("fit", { score: ordered[0].transferScore })}` : ""}
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
      {ordered.map((row, ri) => (
        <div key={`${row.candidateRef}|${ri}`}>
          {ordered.length > 1 ? (
            <p className="mt-3 min-w-0 truncate text-micro font-semibold text-ink">
              {row.candidateRef}
              {row.transferScore != null ? ` ${t("fit", { score: row.transferScore })}` : ""}
            </p>
          ) : null}
          <ol className="mt-2 space-y-2">
            {row.questions
              .filter((q) => (q.question ?? "").trim())
              .map((q, i) => (
                <li key={q.id ?? i} className="rounded-md border border-stone-200 bg-white p-2.5 text-micro">
                  <FollowupQuestionItem q={q} index={i} />
                </li>
              ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
