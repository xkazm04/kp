"use client";

import { Check, Loader2 } from "lucide-react";

export type StageId =
  | "extract"
  | "gemini"
  | "profile"
  | "scoring"
  | "salary"
  | "insights";

export type StageStatus = "pending" | "active" | "done";

export type StageState = Record<StageId, StageStatus>;

export const STAGE_ORDER: StageId[] = [
  "extract",
  "gemini",
  "profile",
  "scoring",
  "salary",
  "insights"
];

const STAGE_LABEL: Record<StageId, { title: string; subtitle: string }> = {
  extract: {
    title: "Extracting CV text",
    subtitle: "Parsing PDF / DOCX content and repairing diacritics."
  },
  gemini: {
    title: "Calling Gemini",
    subtitle: "The model is reading the profile, this is the longest step."
  },
  profile: {
    title: "Building profile signals",
    subtitle: "Mapping years, role family, skills, languages, traits."
  },
  scoring: {
    title: "Scoring candidate",
    subtitle: "Combining experience, skills, seniority, education, traits."
  },
  salary: {
    title: "Estimating salary",
    subtitle: "Blending Czech tech benchmarks with company context."
  },
  insights: {
    title: "Generating insights",
    subtitle: "Job-fit, ATS check, interview kit, application strategy."
  }
};

export function initialStageState(): StageState {
  return {
    extract: "pending",
    gemini: "pending",
    profile: "pending",
    scoring: "pending",
    salary: "pending",
    insights: "pending"
  };
}

export function applyStageEvent(state: StageState, stage: StageId, status: StageStatus): StageState {
  if (status === "done" && state[stage] === "done") return state;
  if (status === "active" && state[stage] === "active") return state;
  const next: StageState = { ...state, [stage]: status };
  if (status === "active") {
    const idx = STAGE_ORDER.indexOf(stage);
    for (let i = 0; i < idx; i += 1) {
      const earlier = STAGE_ORDER[i];
      if (next[earlier] === "pending") {
        next[earlier] = "done";
      }
    }
  }
  return next;
}

export function AnalysisProgress({
  stages,
  complete,
  fileName,
  variantCount
}: {
  stages: StageState;
  complete: boolean;
  fileName?: string;
  variantCount?: number;
}) {
  const completedCount = STAGE_ORDER.filter((id) => stages[id] === "done").length;
  const totalCount = STAGE_ORDER.length;
  const percent = complete
    ? 100
    : Math.round((completedCount / totalCount) * 100);

  const headlineStage = complete
    ? null
    : STAGE_ORDER.find((id) => stages[id] === "active") ?? null;

  return (
    <div
      aria-label="Analysis progress"
      role="status"
      aria-live="polite"
      className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">
            {complete ? "Compiling result" : "Live pipeline"}
          </p>
          <h2 className="mt-1 font-serif text-h2 text-ink">
            {complete
              ? "Almost there — packaging your report"
              : headlineStage
                ? STAGE_LABEL[headlineStage].title
                : "Starting analysis"}
          </h2>
          <p className="mt-1 text-base text-steel">
            {variantCount && variantCount > 1
              ? `Comparing ${variantCount} CV variants in parallel.`
              : fileName
                ? `Working on ${fileName}.`
                : "Working on your profile."}
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end">
          <span className="text-meta uppercase tracking-wide text-steel">Progress</span>
          <span className="font-serif text-h2 text-ink">{percent}%</span>
        </div>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
        <div
          className="h-full rounded-full bg-coral transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-2">
        {STAGE_ORDER.map((stage) => (
          <StageRow
            key={stage}
            id={stage}
            status={complete && stages[stage] !== "done" ? "done" : stages[stage]}
          />
        ))}
      </ol>
    </div>
  );
}

function StageRow({ id, status }: { id: StageId; status: StageStatus }) {
  const label = STAGE_LABEL[id];
  return (
    <li
      className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${
        status === "active"
          ? "border-coral bg-coral/5"
          : status === "done"
            ? "border-stone-200 bg-paper"
            : "border-stone-200 bg-white"
      }`}
    >
      <StageIndicator status={status} />
      <div className="min-w-0 flex-1">
        <p
          className={`text-base font-semibold ${
            status === "pending" ? "text-steel" : "text-ink"
          }`}
        >
          {label.title}
        </p>
        <p className="mt-0.5 text-sm leading-5 text-steel">{label.subtitle}</p>
      </div>
    </li>
  );
}

function StageIndicator({ status }: { status: StageStatus }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-moss text-white">
        <Check className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-coral bg-white text-coral">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white">
      <span className="h-1.5 w-1.5 rounded-full bg-stone-300" aria-hidden />
    </span>
  );
}
