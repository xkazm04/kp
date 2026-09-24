"use client";

import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";

// Outcome marks. Each verdict differs by SHAPE, not only by colour, so the record reads
// in greyscale and to a colour-blind reader: accepted is a filled disc, rejected a ring
// struck through, duplicate two rings, no response a dotted ring, pending a dashed ring.
// Colour rides along (moss / coral / amber / steel) as a second channel.

export const MARK_KINDS = ["accepted", "rejected", "duplicate", "no_response", "pending"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

const TONE: Record<MarkKind, string> = {
  accepted: "text-moss",
  rejected: "text-coral",
  duplicate: "text-dial-amber",
  no_response: "text-steel",
  pending: "text-steel",
};

export function OutcomeMark({ kind, className = "" }: { kind: MarkKind; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={`inline-block h-3 w-3 shrink-0 ${TONE[kind]} ${className}`} aria-hidden focusable="false">
      {kind === "accepted" ? <circle cx="6" cy="6" r="5" fill="currentColor" /> : null}
      {kind === "rejected" ? (
        <>
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <line x1="2.5" y1="9.5" x2="9.5" y2="2.5" stroke="currentColor" strokeWidth="1.6" />
        </>
      ) : null}
      {kind === "duplicate" ? (
        <>
          <circle cx="4.5" cy="6" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="7.5" cy="6" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </>
      ) : null}
      {kind === "no_response" ? <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="0.1 2.4" strokeLinecap="round" /> : null}
      {kind === "pending" ? <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 1.6" /> : null}
    </svg>
  );
}

/** The mark a gig's latest SENT attempt earns, read off the gig's status (the verdict
 *  path moves sent -> accepted | rejected | expired). A duplicate is stored as a
 *  rejection, so at this level it reads as one; the gig detail shows the verdict itself. */
export function markForGig(gig: Gig, latest: GigAttempt | null): MarkKind | null {
  if (!latest || latest.status !== "sent") return null;
  if (gig.status === "accepted") return "accepted";
  if (gig.status === "rejected") return "rejected";
  if (gig.status === "expired") return "no_response";
  if (gig.status === "sent") return "pending";
  return null;
}

/** A row of marks, oldest first, with one spoken summary for assistive tech. */
export function MarkRow({ marks, emptyLabel }: { marks: MarkKind[]; emptyLabel: string }) {
  const t = useTranslations("gigs");
  if (marks.length === 0) return <span className="text-sm text-steel">{emptyLabel}</span>;
  const spoken = marks.map((m) => t(`mark.${m}` as Parameters<typeof t>[0])).join(", ");
  return (
    <span className="inline-flex flex-wrap items-center gap-1" role="img" aria-label={spoken}>
      {marks.map((m, i) => (
        <OutcomeMark key={i} kind={m} />
      ))}
    </span>
  );
}

export function MarkLegend() {
  const t = useTranslations("gigs");
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-steel" aria-label={t("mark.legend")}>
      {MARK_KINDS.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <OutcomeMark kind={k} />
          {t(`mark.${k}` as Parameters<typeof t>[0])}
        </li>
      ))}
    </ul>
  );
}
