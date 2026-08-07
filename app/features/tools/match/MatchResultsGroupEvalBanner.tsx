"use client";

// shortlist-to-group-eval banner, split out of MatchResults.tsx — the composition
// moment: once ≥ 2 candidates from this session sit in the SAME role's pipeline,
// offer to compare them in the Decisions group eval. Deep-links with the explicit
// selection pre-armed (?job=&arm=, one-shot); the recruiter runs the (paid) eval
// there — this button only navigates. No qualifying role → no banner: a
// 1-candidate "comparison" is a dead affordance.
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { buildUrl } from "@/app/features/shell/tabs";
import { ARM_PARAM, buildArmParam } from "@/app/features/shared/groupEvalArm";
import { GROUP_EVAL_CAP } from "@/app/_lib/group-eval-cohort";

export function MatchResultsGroupEvalBanner({
  filed,
}: {
  filed?: Record<string, { jobTitle: string; entryIds: string[] }>;
}) {
  const t = useTranslations("match.results");
  const router = useRouter();
  const compareReady = Object.entries(filed ?? {}).filter(([, v]) => v.entryIds.length >= 2);
  if (compareReady.length === 0) return null;

  return (
    <div className="mt-4 space-y-2 rounded-md border border-moss/40 bg-moss/5 px-3 py-2">
      {compareReady.map(([jobId, v]) => {
        // Cap client-side like the picker does; the server re-enforces.
        const ids = v.entryIds.slice(0, GROUP_EVAL_CAP);
        return (
          <div key={jobId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 text-sm text-ink">
              <strong>{v.jobTitle}</strong>{" "}
              <span className="text-steel">· {t("groupEvalReady", { count: v.entryIds.length })}</span>
            </span>
            <button
              type="button"
              onClick={() =>
                router.push(buildUrl({ tab: "decisions", job: jobId, [ARM_PARAM]: buildArmParam(ids) }, ""))
              }
              className="focus-ring ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-moss/40 bg-white px-2.5 text-sm font-semibold text-moss hover:bg-moss/10"
            >
              <Sparkles size={14} /> {t("groupEvalCta", { count: ids.length })}
            </button>
          </div>
        );
      })}
      <p className="text-meta text-steel">{t("groupEvalHint")}</p>
    </div>
  );
}
