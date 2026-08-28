"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Briefcase, Link2Off } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";

// ONE THREAD, the assignment's half of it: which role was this work sample cut for?
//
// Three honest states, and the middle one is the reason this component exists rather
// than a conditional chip inline:
//   - a resolved job  → a chip that OPENS it (?tab=jobs&job=<id> is the same deep link
//                       the Pipeline uses, and JobsTab point-fetches a job the current
//                       filters hide, so the link works from anywhere);
//   - a picked JD with no sourced role → said out loud. The JD → Job ingest is
//                       best-effort, so this is a real state, not a bug, and the store
//                       deliberately stores NULL rather than a link that goes nowhere;
//   - neither → nothing. A case defined free-hand has no role to point at.
export function DevCaseJobLink({
  jobId,
  jobTitle,
  jdSlug,
}: {
  jobId?: string | null;
  jobTitle?: string | null;
  jdSlug?: string | null;
}) {
  const t = useTranslations("devcase.jobLink");
  const router = useRouter();
  const search = useSearchParams();

  if (jobId) {
    return (
      <button
        type="button"
        title={t("openTitle")}
        onClick={() =>
          router.push(buildUrl({ tab: "jobs", ...clearedTabScopedParams(), job: jobId }, search.toString()))
        }
        className="focus-ring inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-micro font-semibold text-steel transition-colors hover:border-coral/40 hover:text-ink"
      >
        {/* jobTitle is null when the job row has since been removed — show the id
            rather than an empty label, which is the truthful residue of a stale link. */}
        <Briefcase size={11} aria-hidden /> {t("linked", { title: jobTitle ?? jobId })}
      </button>
    );
  }

  if (jdSlug) {
    return (
      <span
        title={t("unsourcedTitle")}
        className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-micro font-semibold text-steel"
      >
        <Link2Off size={11} aria-hidden /> {t("unsourced", { slug: jdSlug })}
      </span>
    );
  }

  return null;
}
