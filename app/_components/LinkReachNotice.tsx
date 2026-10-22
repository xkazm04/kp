"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { NOTICE } from "@/app/_components/ui/recipes";
import { linkReach, type LinkReach } from "@/app/_lib/link-reach";
import { publicBaseUrl } from "@/app/_lib/public-base-url";

// "Who can open the link you just copied?" (CX S39). The candidate-link base a copy
// surface uses is `publicBaseUrl(window.location.origin)`; when nothing is configured
// and the owner works on localhost, every apply / schedule link points at their own
// laptop and a candidate's phone cannot open it. This notice says so beside the copy
// action — quietly, in the advisory tone, never blocking the copy (a network-only link
// is still right for a colleague in the same office).
//
// The reach is read from the SAME base the links are built on, once per page (the
// origin does not change under a mounted page), and is `null` on the server so the
// first paint matches hydration: a notice appears after mount, never a flash of one.

let cached: LinkReach | null = null;
const noSubscribe = () => () => {};
function readReach(): LinkReach {
  if (cached === null) cached = linkReach(publicBaseUrl(window.location.origin));
  return cached;
}

/** The reach of this page's candidate links; null until mounted (and on the server). */
export function useCandidateLinkReach(): LinkReach | null {
  return useSyncExternalStore(noSubscribe, readReach, () => null);
}

export type LinkReachAudience = "candidates" | "sources";

const REACH_KEY = { "this-computer": "thisComputer", "local-network": "localNetwork", nowhere: "nowhere" } as const;

/** The notice's two sentences for a reach that is not public, else null. */
export function useLinkReachWords(reach: LinkReach | null, audience: LinkReachAudience = "candidates") {
  const t = useTranslations("linkReach");
  if (reach === null || reach === "public") return null;
  return { line: t(`${audience}.${REACH_KEY[reach]}`), howToFix: t("howToFix"), fix: t(`fix.${audience}`) };
}

/**
 * One line naming who can open the link, plus a "How to fix" disclosure. Renders nothing
 * for a public base (or before mount). Pass `reach` to judge a base other than this page's.
 */
export function LinkReachNotice({
  audience = "candidates",
  reach,
  className = "",
}: {
  audience?: LinkReachAudience;
  reach?: LinkReach | null;
  className?: string;
}) {
  const page = useCandidateLinkReach();
  const words = useLinkReachWords(reach === undefined ? page : reach, audience);
  if (!words) return null;
  return (
    <div role="status" className={`${NOTICE("amber")} px-3 py-1.5 text-meta ${className}`}>
      <p>{words.line}</p>
      <details className="mt-0.5">
        <summary className="focus-ring cursor-pointer rounded-md font-semibold">{words.howToFix}</summary>
        <p className="mt-1">{words.fix}</p>
      </details>
    </div>
  );
}
