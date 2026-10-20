"use client";

import { useTranslations } from "next-intl";
import { Mark, Section } from "@/app/_components/kit";
import { GIG_TYPE_KNOWLEDGE, gigTypeOf } from "@/app/_lib/gigs/gig-type";
import type { Gig, GigPlanRow } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { milestoneRows, milestoneTotals, personaModelLabel } from "../../logic/pairing";
import type { AfterWrite, SourceRow, SpecialistRow } from "../../logic/wire";
import { MilestoneList } from "./MilestoneList";
import { Panel } from "./Panel";
import { WorkspaceSection } from "./WorkspaceSection";

// Pairing (gig-mastery S2, docs/features/gigs/README.md "Pairing"): the gig's OWN persona -
// created in Personas when the accepted plan is dispatched, on Opus 5.5 at high effort -
// its hire state, the kind-of-work recipes it adopted and the registry knowledge its gig
// type hires it with (recomputed from the type, not stored on the row), the workspace
// folder, and the milestone: each accepted-plan step as a goal with the state the agent
// reports. A gig worked by a niche specialist before pairing keeps RoutingPanel.tsx.

const HIRE_MARK: Readonly<Record<string, "ok" | "wait" | "fail" | "unknown">> = {
  active: "ok",
  dispatched: "wait",
  pending_approval: "wait",
  onboarding: "wait",
  failed: "fail",
  rejected: "fail",
  retired: "unknown",
};

export function PairingPanel({
  gig,
  source,
  persona,
  accepted,
  onChanged,
  onOpenPlans,
}: {
  gig: Gig;
  source: SourceRow | null;
  persona: SpecialistRow | null;
  accepted: GigPlanRow | null;
  onChanged: AfterWrite;
  onOpenPlans: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const type = gigTypeOf(gig);
  const typeLabel = t(`lanes.type.${type}`);
  const knowledge = GIG_TYPE_KNOWLEDGE[type];
  const rows = milestoneRows(accepted);
  const totals = milestoneTotals(rows);
  const hire = persona?.hire ?? null;
  const hireWords = hire ? fmt.hireStatus(hire.status) : t("pairing.noHire");

  return (
    <Panel title={t("pairing.title")}>
      <div className="route-grid">
        <section className="route-card">
          <span className="caps dim">{t("pairing.personaTitle")}</span>
          {persona ? (
            <>
              <p className="route-big">{hire?.personaName ?? persona.name}</p>
              <p className="pair-line">
                <Mark kind={hire ? (HIRE_MARK[hire.status] ?? "unknown") : "unknown"} tip={hireWords} />
                <span>{hireWords}</span>
              </p>
            </>
          ) : (
            <>
              <p className="route-big absent">{t("pairing.notPaired")}</p>
              <p className="route-quiet">{accepted ? t("pairing.notPairedBody") : t("pairing.notPairedNoPlan")}</p>
              {accepted ? null : (
                <button type="button" className="linkbtn pair-link" onClick={onOpenPlans}>
                  {t("plans.openPlans")}
                </button>
              )}
            </>
          )}
          <dl className="pair-facts">
            <dt>{t("pairing.model")}</dt>
            <dd>{personaModelLabel()}</dd>
            <dt>{t("pairing.type")}</dt>
            <dd>{typeLabel}</dd>
          </dl>
        </section>
        <section className="route-card">
          <span className="caps dim">{t("pairing.knowledgeTitle", { type: typeLabel })}</span>
          {knowledge.length ? (
            <ul className="pair-slugs">
              {knowledge.map((k) => (
                <li key={`${k.bundle}/${k.subject}`}>
                  <code>{k.subject}</code> <span className="route-quiet">{k.bundle}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="route-quiet">{t("pairing.noKnowledge")}</p>
          )}
          <span className="caps dim pair-gap">{t("pairing.recipesTitle")}</span>
          {persona && persona.spec.recipes.length ? (
            <ul className="pair-slugs">
              {persona.spec.recipes.map((r) => (
                <li key={r.slug}>
                  <code>{`${r.slug}@${r.version}`}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="route-quiet">{persona ? t("pairing.noRecipes") : t("pairing.recipesAtHire")}</p>
          )}
        </section>
      </div>

      <Section title={t("pairing.milestoneTitle")} count={rows.length || undefined} state={rows.length ? t("pairing.milestoneCount", { done: totals.done, total: totals.total }) : undefined}>
        {rows.length === 0 ? (
          <p className="panel-empty">{t("pairing.noMilestone")}</p>
        ) : (
          <MilestoneList
            rows={rows}
            pct={totals.pct}
            updated={accepted?.progress?.updatedAt ? t("pairing.updated", { when: fmt.dateTime(accepted.progress.updatedAt) }) : null}
            localOnly={accepted?.progress ? accepted.progress.milestoneId === null : false}
          />
        )}
      </Section>

      <WorkspaceSection gig={gig} source={source} onChanged={onChanged} />
    </Panel>
  );
}
