"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Bookmark, BookmarkCheck, ExternalLink, RotateCcw, XCircle } from "lucide-react";
import { Badge, FitTierBadge } from "@/app/_components/Badge";
import { IconAction } from "@/app/_components/IconAction";
import { Tooltip } from "@/app/_components/Tooltip";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { DismissReason, JobseekerPostingSummary } from "@/app/_lib/jobseeker/types";
import { useFitTierLabels } from "@/app/features/shared/matchLabels";
import { DismissPicker } from "./DismissPicker";
import { EligibilityChips } from "./EligibilityChips";

// ONE FEED ROW, as a ledger row.
//
// It was a `${PANEL} p-4` card in a `space-y-3` stack: thirty stacked panels, each
// with a `w-20` score gutter, a wrapping meta paragraph and three always-visible
// captioned buttons, so nothing lined up column to column and a reader comparing two
// postings had to re-find every fact on every card. This is the house LEDGER ROW
// instead — the same register as `ProfileRosterRow` and `JdsIntakeSessionsTable`:
// `border-b border-stone-100 … hover:bg-paper/70`, `px-3 py-2.5` cells, the title
// cell `max-w-0 truncate font-semibold text-ink`, responsive `hidden md:table-cell`
// on the columns a phone cannot afford, and ONE trailing action cell of `IconAction`
// glyphs that carry their own names (surface-doctrine §1: no sentence occupies
// layout).
//
// It is a `motion.tr` rather than a plain `<tr>` because arrival is per row and a
// table row cannot be wrapped: `ArrivalList` (IntakeArrivalMotion.tsx) renders
// `motion.li` and cannot host a `<tr>`, so this mirrors its contract — the same
// spring, the same 40 ms stagger capped at 12, the same reduced-motion collapse, the
// same "cascade on FIRST appearance, never replay" rule — with `<tr>` as the element.
// `arrivalOrder` is the caller's diff-by-id position; -1 means "was already here".
//
// An UNSCORED posting (KO'd by the hard filter, or not yet matched) still says "not
// scored", never "0 %": a posting the filter dropped is not comparable, and the feed
// must not read it as a bad match.

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
const STAGGER_MS = 40;
const STAGGER_CAP = 12;

export function PostingRow({
  row,
  sourceLabel,
  busy,
  arrivalOrder,
  onShortlist,
  onApplied,
  onDismiss,
  onRestore,
}: {
  row: JobseekerPostingSummary;
  sourceLabel: string;
  busy: boolean;
  /** Stagger position among the rows that just arrived; -1 when the row was already there. */
  arrivalOrder: number;
  onShortlist(next: boolean): void;
  onApplied(): void;
  onDismiss(reason: DismissReason, note: string): void;
  onRestore(): void;
}) {
  const t = useTranslations("me.jobs");
  const rel = useRelativeTime();
  const tierLabels = useFitTierLabels();
  const reduced = useReducedMotion();
  const [dismissing, setDismissing] = useState(false);
  const live = row.status !== "dismissed" && row.status !== "gone";
  const isNew = arrivalOrder >= 0;
  const meta = [row.company, row.location, row.workMode ? t(`workMode.${row.workMode}`) : null].filter((x): x is string => !!x);
  const statusTone = row.status === "applied" ? "positive" : row.status === "shortlisted" ? "info" : row.status === "new" ? "neutral" : "caution";
  // The one sentence the status pill owes and cannot show: WHEN the seeker acted, or
  // WHY they dropped it. It rides on the pill as a tooltip instead of as a second line.
  const statusHint =
    row.status === "applied" && row.appliedAt
      ? t("card.applied", { when: rel(row.appliedAt) })
      : row.status === "dismissed" && row.dismissReason
        ? t("card.dismissed", { reason: t(`dismiss.reason.${row.dismissReason}`) }) + (row.dismissNote ? ` (${row.dismissNote})` : "")
        : null;

  return (
    <motion.tr
      className="border-b border-stone-100 text-sm transition-colors last:border-0 hover:bg-paper/70"
      initial={isNew && !reduced ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: reduced ? 1 : 0 }}
      transition={reduced ? { duration: 0 } : { ...SPRING, delay: isNew && arrivalOrder < STAGGER_CAP ? (arrivalOrder * STAGGER_MS) / 1000 : 0 }}
    >
      {/* FIT — the numeral leads, right-aligned under a right-aligned header, with the
          tier word beside it and the confidence band under it as figures, not prose. */}
      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top">
        {row.matchTotal !== null ? (
          <>
            <span className="flex items-center justify-end gap-2">
              <FitTierBadge tier={row.fitTier} labels={tierLabels} />
              <span className="nums font-serif text-h3 leading-none text-ink">{Math.round(row.matchTotal)}</span>
            </span>
            {row.confidence ? (
              <Tooltip
                label={t("card.confidence", {
                  level: t(`confidenceLevel.${row.confidence.level}`),
                  low: Math.round(row.confidence.low),
                  high: Math.round(row.confidence.high),
                })}
                side="bottom"
                className="mt-1 justify-end"
              >
                <span tabIndex={0} className="focus-ring nums hidden rounded text-meta text-steel md:inline">
                  {t("table.range", { low: Math.round(row.confidence.low), high: Math.round(row.confidence.high) })}
                </span>
              </Tooltip>
            ) : null}
          </>
        ) : (
          <span className={CHIP_QUIET}>{t("card.unscored")}</span>
        )}
      </td>

      {/* ROLE — the truncating title cell every ledger in the studio leads with. */}
      <td className="max-w-0 px-3 py-2.5 align-top">
        <span className="flex items-center gap-2">
          <Link href={`/me/jobs/${encodeURIComponent(row.id)}`} className="focus-ring min-w-0 truncate rounded font-semibold text-ink hover:underline">
            {row.title}
          </Link>
          {row.deepDived ? <span className={`${CHIP_QUIET} shrink-0`}>{t("card.deepDived")}</span> : null}
        </span>
        {meta.length > 0 ? <span className="mt-0.5 block truncate text-meta text-steel">{meta.join(" · ")}</span> : null}
        <div className="mt-1">
          <EligibilityChips flags={row.eligibility} />
        </div>
      </td>

      <td className="hidden max-w-0 truncate px-3 py-2.5 align-top text-steel md:table-cell">{sourceLabel}</td>

      <td className="hidden whitespace-nowrap px-3 py-2.5 align-top text-steel lg:table-cell">{row.postedAt ? rel(row.postedAt) : "—"}</td>

      <td className="hidden whitespace-nowrap px-3 py-2.5 align-top text-steel sm:table-cell">{rel(row.lastSeenAt)}</td>

      <td className="px-3 py-2.5 align-top">
        {statusHint ? (
          <Tooltip label={statusHint} side="left">
            <span tabIndex={0} className="focus-ring rounded">
              <Badge tone={statusTone} label={t(`status.${row.status}`)} />
            </span>
          </Tooltip>
        ) : (
          <Badge tone={statusTone} label={t(`status.${row.status}`)} />
        )}
      </td>

      {/* ONE trailing action cell. The dismiss reason picker opens as a POPOVER hung off
          it rather than as a panel pushed under the row — a ledger row must not grow. */}
      <td className="relative px-3 py-2.5 text-right align-top">
        <span className="inline-flex items-center justify-end gap-0.5">
          {live ? (
            <>
              <IconAction
                icon={row.status === "shortlisted" ? BookmarkCheck : Bookmark}
                label={row.status === "shortlisted" ? t("action.unshortlist") : t("action.shortlist")}
                on={row.status === "shortlisted"}
                toggle
                disabled={busy}
                side="left"
                size={15}
                onClick={() => onShortlist(row.status !== "shortlisted")}
              />
              {row.status !== "applied" ? (
                <IconAction icon={ExternalLink} label={t("action.applied")} disabled={busy} side="left" size={15} onClick={onApplied} />
              ) : null}
              <IconAction icon={XCircle} label={t("action.dismiss")} on={dismissing} toggle disabled={busy} side="left" size={15} onClick={() => setDismissing((v) => !v)} />
            </>
          ) : row.status === "dismissed" ? (
            <IconAction icon={RotateCcw} label={t("action.restore")} disabled={busy} side="left" size={15} onClick={onRestore} />
          ) : null}
        </span>
        {dismissing ? (
          <div className="absolute right-2 top-full z-30 w-72 text-left">
            <DismissPicker
              title={row.title}
              busy={busy}
              surface="popover"
              onConfirm={(reason, note) => {
                setDismissing(false);
                onDismiss(reason, note);
              }}
              onCancel={() => setDismissing(false)}
            />
          </div>
        ) : null}
      </td>
    </motion.tr>
  );
}
