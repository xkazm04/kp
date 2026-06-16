"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, X } from "lucide-react";
import { buildUrl, clearedTabScopedParams, type TabScopedParamKey, type WorkspaceTabId } from "@/app/features/tabs";

export type CompletionLink = {
  label: string;
  tab: WorkspaceTabId;
  // Optional deep-link params carried INTO the destination (e.g. { job: id }
  // to auto-open a posting, { q: label } to pre-filter the board). All other
  // tab-scoped params are cleared so the destination opens on exactly this.
  params?: Partial<Record<TabScopedParamKey, string>>;
};

// Completion CTA — the "every silent success gets a destination" primitive.
// Render it where a mutation just succeeded whose result lives on ANOTHER tab
// (ingest-as-job → Jobs, bulk-add → Pipeline, screening accept → Schedule…):
// a quiet success band naming what happened plus deep link(s) to where the
// proof landed. One shared shape so future actions adopt the connected
// behavior in one line instead of re-inventing (or skipping) it per feature.
export function CompletionCta({
  message,
  links,
  onDismiss,
  dismissLabel,
  className = "",
}: {
  message: string;
  links: CompletionLink[];
  onDismiss?: () => void;
  // Required alongside onDismiss — localized aria-label for the X.
  dismissLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-moss/40 bg-moss/5 px-4 py-2.5 ${className}`}
    >
      <p className="text-sm text-ink">
        <Check size={14} className="-mt-0.5 mr-1 inline text-moss" aria-hidden />
        {message}
      </p>
      <span className="flex items-center gap-3">
        {links.map((link) => (
          <button
            key={`${link.tab}:${link.label}`}
            type="button"
            onClick={() =>
              router.push(buildUrl({ tab: link.tab, ...clearedTabScopedParams(), ...link.params }, search.toString()))
            }
            className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
          >
            {link.label} <ArrowRight size={13} aria-hidden />
          </button>
        ))}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel}
            className="focus-ring rounded p-0.5 text-steel hover:text-ink"
          >
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </span>
    </div>
  );
}
