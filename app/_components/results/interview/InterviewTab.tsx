"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MessagesSquare, Wrench, ShieldAlert, HelpCircle, Filter, Check, ClipboardCheck, CalendarPlus, Loader2 } from "lucide-react";
import type { Analysis } from "@/app/_lib/schemas";
import { tabHref } from "@/app/features/tabs";
import { dedupe } from "@/app/_lib/dedupe";
import { SoftSignalsSection } from "./SoftSignalsSection";
import {
  classifyBucket,
  groupBuckets,
  OTHER_BUCKET,
  type FilterKey,
  type GroupKey,
  type KnownBucket
} from "./buckets.ts";

type InterviewQuestion = NonNullable<Analysis["interviewKit"]>["questions"][number];

type BucketMeta = {
  // i18n key (localized at render); the English literal lives in messages.report.panel.
  labelKey: string;
  tone: string;
  chip: string;
  icon: React.ComponentType<{ className?: string }>;
};

const BUCKET_META: Record<KnownBucket, BucketMeta> = {
  behavioral: {
    labelKey: "panel.bucketBehavioral",
    tone: "border-moss/40 bg-moss/10 text-moss",
    chip: "bg-moss text-white",
    icon: MessagesSquare
  },
  technical: {
    labelKey: "panel.bucketTechnical",
    tone: "border-steel/40 bg-paper text-steel",
    chip: "bg-steel text-white",
    icon: Wrench
  },
  "red-flag-defense": {
    labelKey: "panel.bucketRedFlag",
    tone: "border-coral/40 bg-coral/10 text-coral",
    chip: "bg-coral text-white",
    icon: ShieldAlert
  }
};

// Catch-all styling for buckets the LLM emitted outside the known vocabulary.
const OTHER_META: BucketMeta = {
  labelKey: "panel.bucketOther",
  tone: "border-stone-200 bg-paper text-steel",
  chip: "bg-ink text-white",
  icon: HelpCircle
};

function metaFor(group: GroupKey): BucketMeta {
  return group === OTHER_BUCKET ? OTHER_META : BUCKET_META[group];
}

// Tailwind needs whole class strings present in source, so map tile counts to
// literal column classes rather than interpolating the number.
function tileGridCols(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-3";
  return "grid-cols-2 sm:grid-cols-4";
}

export function InterviewTab({ analysis, prepEntryId }: { analysis: Analysis; prepEntryId?: string }) {
  const t = useTranslations("report");
  const bucketLabel = (group: GroupKey) => t(metaFor(group).labelKey as Parameters<typeof t>[0]);
  const [bucket, setBucket] = useState<FilterKey>("all");

  // The soft-signal panel is deterministic (no JD/LLM needed), so it renders
  // even when the LLM interview kit is absent — the kit placeholder card moves
  // below it instead of early-returning past it.
  if (!analysis.interviewKit) {
    return (
      <div className="space-y-5">
        <SoftSignalsSection panel={analysis.softSignals} />
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">{t("panel.mockInterview")}</h3>
          <p className="mt-3 text-base leading-6 text-steel">{t("panel.mockPlaceholder")}</p>
        </div>
      </div>
    );
  }

  const { summary, questions } = analysis.interviewKit;
  // Derive tiles/chips from the buckets actually present (known buckets first,
  // then an "Other" group for anything off-taxonomy) so the per-group counts
  // sum to the total and no question can be silently filtered out of view.
  const groups = groupBuckets(questions);
  const filtered =
    bucket === "all" ? questions : questions.filter((question) => classifyBucket(question.bucket) === bucket);

  return (
    <div className="space-y-5">
      <SoftSignalsSection panel={analysis.softSignals} />
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <MessagesSquare className="h-5 w-5 text-coral" aria-hidden />
              <h3 className="font-serif text-h3 text-ink">{t("panel.mockInterview")}</h3>
            </div>
            <p className="mt-2 text-base leading-6 text-ink">{summary}</p>
            <p className="mt-1 text-sm leading-5 text-steel">{t("panel.mockSubhead")}</p>
          </div>
          <div className={`grid gap-2 text-center sm:gap-3 ${tileGridCols(groups.length)}`}>
            {groups.map((group) => {
              const meta = metaFor(group.key);
              return (
                <div key={group.key} className={`rounded-md border px-3 py-2 text-sm font-medium ${meta.tone}`}>
                  <div className="text-lg font-semibold">{group.count}</div>
                  <div className="mt-0.5 leading-tight">{bucketLabel(group.key)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Direction 2 — when the candidate is live on the board, push this kit's
            questions into their real interview-prep pack instead of leaving the
            recruiter to re-type them. Absent off-pipeline (no entry handle). */}
        {prepEntryId ? (
          <ImportToPrepButton entryId={prepEntryId} questions={questions.map((q) => q.question)} />
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-sm font-medium uppercase tracking-wide text-steel">
            <Filter className="h-3.5 w-3.5" aria-hidden />
            {t("panel.filter")}
          </span>
          <FilterButton active={bucket === "all"} label={`${t("panel.filterAll")} (${questions.length})`} onClick={() => setBucket("all")} />
          {groups.map((group) => (
            <FilterButton
              key={group.key}
              active={bucket === group.key}
              label={`${bucketLabel(group.key)} (${group.count})`}
              onClick={() => setBucket(group.key)}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((question, index) => (
          <QuestionCard key={`${question.bucket}-${index}`} question={question} index={index} />
        ))}
      </div>
    </div>
  );
}

function QuestionCard({ question, index }: { question: InterviewQuestion; index: number }) {
  const t = useTranslations("report");
  const group = classifyBucket(question.bucket);
  const meta = metaFor(group);
  const Icon = meta.icon;
  const tone = meta.tone;
  const chip = meta.chip;
  const metaLabel = t(meta.labelKey as Parameters<typeof t>[0]);
  // For off-taxonomy buckets show the raw value the model emitted (so the user
  // sees what it actually was), falling back to the generic "Other" label.
  const label = group === OTHER_BUCKET ? question.bucket || metaLabel : metaLabel;

  return (
    <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold uppercase tracking-wide ${chip}`}>
            <Icon className="h-3 w-3" aria-hidden />
            {label}
          </span>
          <span className="text-sm font-medium text-steel">Q{index + 1}</span>
        </div>
      </div>
      <p className="mt-3 text-base font-semibold leading-6 text-ink">{question.question}</p>
      <div className={`mt-3 rounded-md border px-3 py-2 text-sm leading-5 ${tone}`}>
        <span className="font-semibold uppercase tracking-wide">{t("panel.tiedTo")}</span> {question.evidenceGap}
      </div>
      <dl className="mt-4 space-y-3">
        <ScaffoldRow label="S" title={t("panel.starSituation")} body={question.starScaffold.situation} />
        <ScaffoldRow label="T" title={t("panel.starTask")} body={question.starScaffold.task} />
        <ScaffoldRow label="A" title={t("panel.starAction")} body={question.starScaffold.action} />
        <ScaffoldRow label="R" title={t("panel.starResult")} body={question.starScaffold.result} />
      </dl>
    </article>
  );
}

function ScaffoldRow({ label, title, body }: { label: string; title: string; body: string }) {
  if (!body) {
    return null;
  }
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink text-sm font-bold text-white">
        {label}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
        <p className="mt-0.5 text-base leading-6 text-ink">{body}</p>
      </div>
    </div>
  );
}

// Pushes the report's interview-kit questions into the candidate's EXISTING prep
// pack via POST /api/interview-prep. The server dedupes by content, so re-clicking
// is idempotent (no stacked copies); a 404 means the pack hasn't been generated yet
// and is surfaced as an honest hint rather than a silent failure.
function ImportToPrepButton({ entryId, questions }: { entryId: string; questions: string[] }) {
  const t = useTranslations("report");
  const [state, setState] = useState<"idle" | "importing" | "imported" | "noprep" | "error">("idle");
  const payload = dedupe(questions.map((q) => q.trim()).filter(Boolean));

  const onClick = async () => {
    if (state === "importing" || state === "imported" || payload.length === 0) return;
    setState("importing");
    try {
      const res = await fetch(`/api/interview-prep?entry=${encodeURIComponent(entryId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: payload }),
      });
      if (res.ok) setState("imported");
      else if (res.status === 404) setState("noprep");
      else setState("error");
    } catch {
      setState("error");
    }
  };

  const done = state === "imported";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "importing" || done || payload.length === 0}
        className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors ${
          done
            ? "cursor-default border-moss/40 bg-moss/10 text-moss"
            : "border-stone-200 text-steel hover:bg-paper hover:text-ink disabled:opacity-50"
        }`}
      >
        {state === "importing" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : done ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
        )}
        {done ? t("importToPrepDone") : state === "importing" ? t("importToPrepBusy") : t("importToPrep")}
      </button>
      {/* Direction 2 (saved-report-whole-truth) — a 404 means the prep pack hasn't
          been generated yet. Instead of a dead-end hint, offer the honest next step:
          a deep-link to the Schedule tab (the prep-pack generation home), reusing the
          shared tabHref grammar. No auto-generation — the recruiter acts there. */}
      {state === "noprep" ? (
        <span role="status" className="inline-flex flex-wrap items-center gap-1.5 text-sm text-steel">
          {t("importToPrepNoPrep")}{" "}
          <Link
            href={tabHref("schedule")}
            className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline"
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            {t("importToPrepGoTo")}
          </Link>
        </span>
      ) : null}
      {state === "error" ? (
        <span role="status" className="text-sm text-red-700">
          {t("importToPrepFailed")}
        </span>
      ) : null}
    </div>
  );
}

function FilterButton({
  active,
  disabled,
  label,
  onClick
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`focus-ring inline-flex h-7 items-center rounded-full px-3 text-sm font-medium transition-colors ${
        active
          ? "bg-ink text-white"
          : disabled
            ? "cursor-not-allowed bg-paper text-steel/50"
            : "bg-paper text-steel hover:bg-stone-100 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
