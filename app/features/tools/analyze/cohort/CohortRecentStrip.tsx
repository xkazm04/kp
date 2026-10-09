"use client";

// Recent comparisons (GET /api/analyze/cohort): reopen one without re-running it. Each ticket
// names its role, its status, how many it compared, and a leader ONLY where the comparison's
// overall claim clears (the route computes leaderLabel under that rule; null otherwise, and then
// the ticket says nobody leads clearly rather than naming the first in order).
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { BTN_GHOST, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import type { CohortStatus } from "./cohortTypes";
import { useCohortRecent } from "./useCohortLists";

const TICKET = `${PANEL} focus-ring flex w-72 flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:border-coral/50 aria-[current=true]:border-coral`;

export function CohortRecentStrip({
  rev,
  activeId,
  onOpen,
}: {
  rev: number;
  activeId: string | null;
  onOpen: (cohortId: string, jdSlug: string, jdTitle: string, memberCount: number, status: CohortStatus) => void;
}) {
  const t = useTranslations("analyzeCohort.shell.recent");
  const fmt = useDateFormat();
  const { list, failed, reload } = useCohortRecent(rev);
  // Before the first read lands the strip takes no room: it is a convenience, not the page.
  if (list === null && !failed) return null;
  if (list === null) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-micro text-steel">
        {t("failed")}
        <button type="button" onClick={reload} className={`${BTN_GHOST} h-9 px-2 text-body`}>
          {t("retry")}
        </button>
      </p>
    );
  }
  if (list.length === 0) return null;
  return (
    <section aria-label={t("label")} className="space-y-2">
      <h3 className={META_LABEL}>{t("label")}</h3>
      <ul className="cs-recent">
        {list.map((c) => (
          <li key={c.cohortId}>
            <button
              type="button"
              className={TICKET}
              aria-current={c.cohortId === activeId ? "true" : undefined}
              onClick={() => onOpen(c.cohortId, c.jdSlug, c.jdTitle, c.memberCount, c.status)}
            >
              <span className="w-full truncate text-h3 text-ink">{c.jdTitle}</span>
              <span className="text-micro text-steel">
                {t(`status.${c.status}`)} · {t("count", { n: c.memberCount })}
              </span>
              <span className="w-full truncate text-micro text-ink">
                {c.leaderLabel
                  ? t("leader", { name: c.leaderLabel })
                  : c.status === "done"
                    ? t("noLeader")
                    : c.status === "failed"
                      ? t("stoppedEarly")
                      : t("pending")}
              </span>
              <span className="text-micro text-steel">{fmt.dayTime(c.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
