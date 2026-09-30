"use client";

import { useTranslations } from "next-intl";
import { planSeatLabel } from "@/app/_lib/gigs/plan-seats";
import type { Gig, GigProposal } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../../data/useGigsFormat";
import type { MoveId } from "../../../logic/moves";
import { proposalBasisNote, proposalHasFile } from "../../../logic/proposal";
import type { ReportSection } from "../../../logic/report";
import { useFallbackWhy, type GigFileState } from "../useGigFile";
import type { SummaryKit } from "./useSummaryKit";

// The Moves block's content, grouped by the object each move acts on: the report, the client
// proposal (a freelance bid only), the plans, the research, and the draft when one is on the
// desk. Every group carries its moves and its state as a quiet line (Writing, why the last
// write failed, what is not there yet). The move that matches the gig's next move
// (logic/moves.ts) is the ONE primary; its group is listed first. MovesBlock.tsx sets it.

export type MoveItem = {
  key: string;
  /** The next-move id this item carries out, when it is one. */
  move?: MoveId;
  label: string;
  href?: string;
  download?: boolean;
  icon?: "open" | "down";
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  tip?: string;
};
export type MoveState = { tone: "writing" | "quiet" | "fail"; text: string };
export type MoveGroup = { key: string; title: string; items: MoveItem[]; states: MoveState[] };

export function useMoveGroups(gig: Gig, kit: SummaryKit, proposalFile: GigFileState<GigProposal>, onGo: (s: ReportSection) => void): MoveGroup[] {
  const t = useTranslations("gigs");
  const why = useFallbackWhy();
  const fmt = useGigsFormat();
  const { research, report, view, planAct, facts } = kit;
  const brief = research.brief !== null;
  const base = `/api/gigs/${encodeURIComponent(gig.id)}`;
  const fail = (text: string | null | undefined): MoveState[] => (text ? [{ tone: "fail", text }] : []);
  const groups: MoveGroup[] = [];

  if (facts.draftOnDesk) {
    const bid = facts.kpDraft;
    groups.push({
      key: "draft",
      title: t(bid ? "moves.group.bid" : "moves.group.draft"),
      items: [{ key: "go", move: bid ? "goBid" : "goDraft", label: t(bid ? "moves.goBid" : "moves.goDraft"), onClick: () => onGo(bid ? "bid" : "draft") }],
      states: [{ tone: "quiet", text: t(bid ? "moves.bidLine" : "moves.draftLine") }],
    });
  }

  const r = report.file;
  groups.push({
    key: "report",
    title: t("moves.group.report"),
    items: [
      ...(r ? [{ key: "open", move: "openReport" as const, label: t("report.file.open"), href: `${base}/report`, icon: "open" as const }] : []),
      { key: "write", move: "writeReport", label: r ? t("report.file.regenerate") : t("report.file.write"), tip: brief ? t("report.file.regenerateTip") : t("report.file.regenerateNeedsBrief"), disabled: !brief || report.writing, loading: report.busy, loadingLabel: t("report.file.regenerating"), onClick: () => void report.write() },
    ],
    states: [
      ...(report.writing ? [{ tone: "writing" as const, text: r ? t("report.file.status.writing") : t("report.file.firstWriting") }] : !r ? [{ tone: "quiet" as const, text: brief ? t("report.file.noneYet") : t("report.file.none") }] : []),
      ...fail(r?.status === "failed" && !report.writing ? t("report.file.failed", { reason: why(r.fallbackReason) }) : null),
      ...fail(report.error),
    ],
  });

  if (kit.bidTrack) {
    const p = proposalFile.file;
    const has = proposalHasFile(p);
    const note = proposalBasisNote(p, view.accepted !== null);
    groups.push({
      key: "proposal",
      title: t("moves.group.proposal"),
      items: [
        ...(has ? [{ key: "open", move: "openProposal" as const, label: t("proposal.hero.open"), href: `${base}/proposal`, icon: "open" as const }, { key: "down", label: t("proposal.hero.download"), href: `${base}/proposal?download=1`, download: true, icon: "down" as const }] : []),
        { key: "write", move: "prepareProposal", label: has ? t("proposal.hero.rewrite") : t("proposal.hero.prepare"), tip: brief ? t("proposal.hero.tip") : t("proposal.hero.needsBrief"), disabled: !brief || proposalFile.writing, loading: proposalFile.busy, loadingLabel: t("proposal.hero.asking"), onClick: () => void proposalFile.write() },
      ],
      states: [
        ...(proposalFile.writing ? [{ tone: "writing" as const, text: has ? t("proposal.hero.writing") : t("proposal.hero.firstWriting") }] : !p ? [{ tone: "quiet" as const, text: brief ? t("proposal.hero.none") : t("proposal.hero.needsBrief") }] : []),
        ...fail(p?.status === "failed" && !proposalFile.writing ? t("proposal.hero.failed", { reason: why(p.fallbackReason) }) : null),
        ...(note && brief && !proposalFile.writing ? [{ tone: "quiet" as const, text: t(`proposal.hero.basis.${note}`) }] : []),
        ...fail(proposalFile.error),
      ],
    });
  }

  const rows = view.shown?.rows.length ?? 0;
  const go: MoveItem = { key: "go", move: "goPlans", label: t("moves.goPlans"), onClick: () => onGo("plans") };
  const propose = () => void planAct.propose();
  groups.push({
    key: "plans",
    title: t("moves.group.plans"),
    items: view.accepted
      ? [go]
      : rows
        ? [go, { key: "again", label: t("plans.proposeAgain"), onClick: propose, disabled: planAct.busy || view.busy || !brief }]
        : [{ key: "gen", move: "generatePlans", label: t("report.choose.generate"), onClick: propose, disabled: planAct.busy || view.busy || !brief, tip: brief ? undefined : t("report.file.regenerateNeedsBrief") }],
    states: [
      view.accepted
        ? { tone: "quiet", text: t("report.choose.acceptedLine", { seat: planSeatLabel(view.accepted) }) }
        : kit.plansState.plans === null && !kit.plansState.failure
          ? { tone: "quiet", text: t("plans.loading") }
          : view.busy
            ? { tone: "writing", text: t("moves.plansWriting") }
            : { tone: "quiet", text: view.ready ? t("plans.readyTip", { count: view.ready }) : t("moves.plansNone") },
      ...fail(planAct.error),
    ],
  });

  groups.push({
    key: "research",
    title: t("moves.group.research"),
    items: [{ key: "run", move: "research", label: brief ? t("brief.researchAgain") : t("brief.research"), loading: research.busy, loadingLabel: t("brief.researching"), onClick: () => void research.research() }],
    states: [{ tone: "quiet", text: research.brief ? t("brief.researchedAt", { date: fmt.dateTime(research.brief.createdAt) }) : t("moves.researchNone") }, ...fail(research.error)],
  });

  // The group that carries the next move reads first.
  const first = groups.findIndex((g) => g.items.some((i) => i.move && i.move === kit.next));
  return first > 0 ? [groups[first], ...groups.filter((_, i) => i !== first)] : groups;
}
