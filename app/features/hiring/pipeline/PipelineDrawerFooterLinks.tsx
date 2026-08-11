"use client";

// The drawer's footer nav: "open full match" / "edit profile" — jumps out of
// the drawer to the full profile surfaces. Split out of PipelineCandidateDrawer.tsx.

import { ExternalLink, Pencil } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";

export function PipelineDrawerFooterLinks({ candidateId }: { candidateId: string | null | undefined }) {
  const router = useRouter();
  const search = useSearchParams();
  const t = useTranslations("pipeline.drawer");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {/* retire-erroring-bulk-control — "open full match" is gated on candidateId
          exactly like its "edit profile" sibling below. It used to render
          unconditionally and silently no-op for an entry with no linked candidate
          (an un-normalized intake stub): same defect class as a control that always
          errors, minus even the error. */}
      {candidateId ? (
        <button
          type="button"
          onClick={() => router.push(buildUrl({ tab: "matrix", profile: candidateId }, search.toString()))}
          className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-steel hover:text-coral"
        >
          <ExternalLink size={13} /> {t("openFullMatch")}
        </button>
      ) : null}
      {candidateId ? (
        <button
          type="button"
          onClick={() => router.push(buildUrl({ tab: "archetypes", edit: candidateId }, search.toString()))}
          className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-steel hover:text-coral"
        >
          <Pencil size={13} /> {t("editProfile")}
        </button>
      ) : null}
    </div>
  );
}
