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
// A posting with no score is never "0 %". Two different states, told apart: one the
// hard filter REMOVED names its gate ("Filtered: work mode" — `row.blockedBy`, stored by
// the scan with the as-if score the detail page shows), and one the scan has not matched
// yet says "not scored". Neither is comparable, and the feed must not read either as a
// bad match.

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
  // The catalog labels are "<short> (<the full legal name>)" — the parenthetical is
  // provenance, not identity, and it belongs on hover rather than in a column.
  const shortSource = sourceLabel.split(" (")[0].trim() || sourceLabel;
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
      {/* FIT — a NARROW numeric column and nothing else. It used to carry the tier
          badge, the numeral and the confidence range on two lines, which cost ~230px at
          1440px and starved the one column a reader actually scans. The band is the
          numeral's tooltip now (surface-doctrine §4: evidence on hover/focus), and the
          tier word moved into the role cell's meta line. `w-20` is the hint; the column
          only grows past it for an unscored row, which says the words rather than
          printing a dash the reader has to hover to understand. */}
      <td className="w-20 whitespace-nowrap px-3 py-2.5 text-right align-top">
        {row.matchTotal !== null ? (
          row.confidence ? (
            <Tooltip
              label={t("card.confidence", {
                level: t(`confidenceLevel.${row.confidence.level}`),
                low: Math.round(row.confidence.low),
                high: Math.round(row.confidence.high),
              })}
              side="left"
            >
              <span tabIndex={0} className="focus-ring nums rounded font-serif text-h3 text-ink">
                {Math.round(row.matchTotal)}
              </span>
            </Tooltip>
          ) : (
            <span className="nums font-serif text-h3 text-ink">{Math.round(row.matchTotal)}</span>
          )
        ) : row.blockedBy.length > 0 ? (
          <span className="inline-flex flex-col items-end gap-1">
            {row.blockedBy.map((k) => (
              <Badge key={k} tone="caution" label={t(`card.filtered.${k}`)} />
            ))}
          </span>
        ) : (
          <span className={CHIP_QUIET}>{t("card.unscored")}</span>
        )}
      </td>

      {/* ROLE — the GREEDY column: `w-full` takes every pixel the fixed columns leave,
          `max-w-0` is what lets its children truncate inside a table cell at all (a cell
          with no computed max width sizes to its content and `truncate` never fires).
          Together they are "flexible, and it shrinks the TEXT, not the column".
          Exactly two lines, always: the title, then ONE meta line where the tier badge,
          the company/location text and the eligibility chips sit side by side. The line
          is `flex-nowrap` on purpose — wrapping is what turned a ledger row into a
          ~120px block — so the text truncates and the badges keep their width. */}
      <td className="w-full max-w-0 px-3 py-2.5 align-top">
        <span className="block truncate">
          <Link href={`/me/jobs/${encodeURIComponent(row.id)}`} className="focus-ring rounded font-semibold text-ink hover:underline">
            {row.title}
          </Link>
        </span>
        <span className="mt-0.5 flex min-w-0 flex-nowrap items-center gap-1.5">
          <span className="shrink-0">
            <FitTierBadge tier={row.fitTier} labels={tierLabels} />
          </span>
          {meta.length > 0 ? <span className="min-w-0 truncate text-sm text-steel">{meta.join(" · ")}</span> : null}
          {row.deepDived ? <span className={`${CHIP_QUIET} shrink-0`}>{t("card.deepDived")}</span> : null}
          <span className="shrink-0">
            {/* The row carries the MISMATCHES only. A real scan (smoke, 2026-09-16: 288 EURES
                matches) put five chips on every row because `ok` and `unknown` painted too,
                and the one amber chip the reader scans for drowned among four grey ones. The
                detail page keeps the full set with its evidence sentences. */}
            <EligibilityChips flags={row.eligibility.filter((f) => f.state === "flag")} />
          </span>
        </span>
      </td>

      {/* SOURCE — the catalog label's SHORT half ("EURES"), with the full name on hover
          and focus. It was the whole string ("EURES (European Labour Authority)") in a
          truncating cell, so every row read "EURES (Europe…" and spent 160px doing it. */}
      <td className="hidden whitespace-nowrap px-3 py-2.5 align-top text-steel md:table-cell">
        {shortSource !== sourceLabel ? (
          <Tooltip label={sourceLabel} side="bottom">
            <span tabIndex={0} className="focus-ring rounded">
              {shortSource}
            </span>
          </Tooltip>
        ) : (
          shortSource
        )}
      </td>

      <td className="hidden whitespace-nowrap px-3 py-2.5 align-top text-steel lg:table-cell">{row.postedAt ? rel(row.postedAt) : "—"}</td>

      <td className="hidden whitespace-nowrap px-3 py-2.5 align-top text-steel sm:table-cell">{rel(row.lastSeenAt)}</td>

      <td className="whitespace-nowrap px-3 py-2.5 align-top">
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
