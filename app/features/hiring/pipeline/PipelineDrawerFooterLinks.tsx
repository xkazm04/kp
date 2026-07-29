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
      <button
        type="button"
        onClick={() => {
          if (candidateId) router.push(buildUrl({ tab: "match", profile: candidateId }, search.toString()));
        }}
        className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-steel hover:text-coral"
      >
        <ExternalLink size={13} /> {t("openFullMatch")}
      </button>
      {candidateId ? (
        <button
          type="button"
          onClick={() => router.push(buildUrl({ tab: "profile", edit: candidateId }, search.toString()))}
          className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-steel hover:text-coral"
        >
          <Pencil size={13} /> {t("editProfile")}
        </button>
      ) : null}
    </div>
  );
}
