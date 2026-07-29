"use client";

// rematch-story-navigable — the navigable tail of a re-engagement event. When the
// counterpart entry resolved server-side AND the drawer can open entries, render a
// link that opens the other side of the "one person, two roles" story; when it
// parsed but no longer resolves (deleted / other tenant), render honest muted text;
// when there's no parseable ref at all, render nothing (the verb already stands alone).
// Split out of PipelineCandidateDrawer.tsx.

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RematchLink } from "@/app/_lib/candidate-timeline";

export function PipelineRematchAffordance({
  link,
  onOpenEntry,
}: {
  link: RematchLink | undefined;
  onOpenEntry: ((entryId: string) => void) | undefined;
}) {
  const t = useTranslations("pipeline.drawer");
  if (!link) return null;
  if (link.resolved && onOpenEntry) {
    return (
      <>
        {" · "}
        <button
          type="button"
          onClick={() => onOpenEntry(link.entryId)}
          className="focus-ring inline-flex items-center gap-0.5 rounded font-semibold text-coral hover:underline"
        >
          <ExternalLink size={11} aria-hidden /> {t("rematchViewLinked")}
        </button>
      </>
    );
  }
  return <span className="text-steel"> · {t("rematchUnavailable")}</span>;
}
