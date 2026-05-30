"use client";

import { useState } from "react";
import { MessagesSquare, Wrench, ShieldAlert, Filter } from "lucide-react";
import type { Analysis } from "@/app/_lib/schemas";

type InterviewQuestion = NonNullable<Analysis["interviewKit"]>["questions"][number];
type Bucket = "all" | "behavioral" | "technical" | "red-flag-defense";

const BUCKET_META: Record<
  Exclude<Bucket, "all">,
  { label: string; tone: string; chip: string; icon: React.ComponentType<{ className?: string }> }
> = {
  behavioral: {
    label: "Behavioral",
    tone: "border-moss/40 bg-moss/10 text-moss",
    chip: "bg-moss text-white",
    icon: MessagesSquare
  },
  technical: {
    label: "Technical",
    tone: "border-steel/40 bg-paper text-steel",
    chip: "bg-steel text-white",
    icon: Wrench
  },
  "red-flag-defense": {
    label: "Red-flag defense",
    tone: "border-coral/40 bg-coral/10 text-coral",
    chip: "bg-coral text-white",
    icon: ShieldAlert
  }
};

const BUCKET_ORDER: Array<Exclude<Bucket, "all">> = ["behavioral", "technical", "red-flag-defense"];

export function InterviewTab({ analysis }: { analysis: Analysis }) {
  const [bucket, setBucket] = useState<Bucket>("all");

  if (!analysis.interviewKit) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <h3 className="font-serif text-h3 text-ink">Mock Interview</h3>
        <p className="mt-3 text-base leading-6 text-steel">
          Attach a job description so we can generate questions tied to your specific evidence gaps and a STAR scaffold for each.
        </p>
      </div>
    );
  }

  const { summary, questions } = analysis.interviewKit;
  const counts = countBuckets(questions);
  const filtered = bucket === "all" ? questions : questions.filter((question) => question.bucket === bucket);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <MessagesSquare className="h-5 w-5 text-coral" aria-hidden />
              <h3 className="font-serif text-h3 text-ink">Mock Interview</h3>
            </div>
            <p className="mt-2 text-base leading-6 text-ink">{summary}</p>
            <p className="mt-1 text-sm leading-5 text-steel">
              Every question is tied to a specific evidence gap from this job description, with a STAR scaffold drawn from your profile.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
            {BUCKET_ORDER.map((key) => {
              const meta = BUCKET_META[key];
              return (
                <div key={key} className={`rounded-md border px-3 py-2 text-sm font-medium ${meta.tone}`}>
                  <div className="text-lg font-semibold">{counts[key] ?? 0}</div>
                  <div className="mt-0.5 leading-tight">{meta.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-sm font-medium uppercase tracking-wide text-steel">
            <Filter className="h-3.5 w-3.5" aria-hidden />
            Filter
          </span>
          <FilterButton active={bucket === "all"} label={`All (${questions.length})`} onClick={() => setBucket("all")} />
          {BUCKET_ORDER.map((key) => (
            <FilterButton
              key={key}
              active={bucket === key}
              disabled={!counts[key]}
              label={`${BUCKET_META[key].label} (${counts[key] ?? 0})`}
              onClick={() => setBucket(key)}
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
  const meta = BUCKET_META[question.bucket as Exclude<Bucket, "all">];
  const Icon = meta?.icon ?? MessagesSquare;
  const tone = meta?.tone ?? "border-stone-200 bg-paper text-steel";
  const chip = meta?.chip ?? "bg-ink text-white";
  const label = meta?.label ?? question.bucket;

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
        <span className="font-semibold uppercase tracking-wide">Tied to:</span> {question.evidenceGap}
      </div>
      <dl className="mt-4 space-y-3">
        <ScaffoldRow label="S" title="Situation" body={question.starScaffold.situation} />
        <ScaffoldRow label="T" title="Task" body={question.starScaffold.task} />
        <ScaffoldRow label="A" title="Action" body={question.starScaffold.action} />
        <ScaffoldRow label="R" title="Result" body={question.starScaffold.result} />
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

function countBuckets(questions: InterviewQuestion[]) {
  const counts: Record<string, number> = {};
  for (const question of questions) {
    counts[question.bucket] = (counts[question.bucket] ?? 0) + 1;
  }
  return counts;
}
