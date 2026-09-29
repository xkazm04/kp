"use client";

import { useTranslations } from "next-intl";
import { Button, Mark, Section, Tag } from "@/app/_components/kit";
import type { GigMatchReason } from "@/app/_lib/gigs/match";
import type { GigArena } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import type { RankedCandidate, RoutingView } from "../../logic/routing";

// Every specialist by fit, as the matcher ranks them: readiness and the reasons in words,
// the score as a numeral and a track, and Route here where the gig may move to them.

type Translate = ReturnType<typeof useTranslations<"gigs">>;
function reasonText(t: Translate, r: GigMatchReason): string {
  return t(`routing.reason.${r.code}`, { evidence: r.evidence ?? "" });
}

export function RouteCandidates({ arena, view, busy, onRoute }: { arena: GigArena; view: RoutingView; busy: boolean; onRoute: (c: RankedCandidate) => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  return (
    <Section title={t("tabs.candidates")} count={view.ranked.length}>
      {view.ranked.length === 0 ? (
        <p className="panel-empty">{t("routing.noCandidates", { arena: fmt.arena(arena) })}</p>
      ) : (
        <ol className="cands">
          {view.ranked.map((c) => {
            const isCurrent = c.specialistId === view.current?.id;
            const reasons = c.reasons.filter((r) => r.code !== "hire_not_ready" && r.code !== "no_hire");
            const readiness = c.ready ? t("routing.ready") : t("routing.notReady", { status: c.specialist.hire?.status ? fmt.hireStatus(c.specialist.hire.status) : t("routing.reason.no_hire") });
            return (
              <li key={c.specialistId} className={isCurrent ? "is-current" : undefined}>
                <Mark kind={c.ready ? "ok" : "wait"} tip={readiness} />
                <div className="cand-main">
                  <span className="cand-name">
                    {c.specialist.name}
                    {isCurrent ? <Tag label={t("routing.current")} /> : null}
                  </span>
                  <span className="cand-why">{[readiness, ...reasons.map((r) => reasonText(t, r))].join(" · ")}</span>
                </div>
                <div className="cand-fit" role="img" aria-label={t("routing.fitLabel", { name: c.specialist.name, score: c.score })}>
                  <span className="cand-score">{c.score}</span>
                  <span className="cand-track">
                    <i style={{ width: `${Math.max(2, Math.min(100, c.score))}%` }} />
                  </span>
                </div>
                <div className="cand-act">
                  {c.ready && !isCurrent && !view.lock ? <Button label={t("routing.routeHere")} size="sm" variant="secondary" disabled={busy} onClick={() => onRoute(c)} /> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
