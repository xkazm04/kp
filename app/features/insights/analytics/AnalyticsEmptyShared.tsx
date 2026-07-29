"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";

// Shared surface between the Analytics first-run empty-state variants.
//
// The chain-aware contract of `ChainEmptyState` is the thing that must NOT be
// lost when a variant takes over the layout: an empty Analytics tab has to say
// where its numbers come from and hand the recruiter the upstream step. Both
// variants therefore take the SAME props the baseline `ChainEmptyState` call
// site passes, and route through the same `buildTabSwitchUrl` so the
// destination tab opens clean (tab-scoped params cleared).

export type AnalyticsEmptyLink = { tab: WorkspaceTabId; label: string };

export type AnalyticsEmptyProps = {
  title: string;
  body?: string;
  links: AnalyticsEmptyLink[];
};

/** Navigate to an upstream tab exactly the way `ChainEmptyState` does. */
export function useUpstreamNav() {
  const router = useRouter();
  const search = useSearchParams();
  return (tab: WorkspaceTabId) => router.push(buildTabSwitchUrl(tab, search.toString()));
}

/** The baseline's trailing link row, hoisted so both variants share one behaviour. */
export function UpstreamLinks({ links, className = "" }: { links: AnalyticsEmptyLink[]; className?: string }) {
  const go = useUpstreamNav();
  if (links.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className}`}>
      {links.map((link) => (
        <button
          key={link.tab}
          type="button"
          onClick={() => go(link.tab)}
          className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
        >
          {link.label} <ArrowRight size={13} aria-hidden />
        </button>
      ))}
    </div>
  );
}
