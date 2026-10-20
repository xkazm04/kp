"use client";

import { useTranslations } from "next-intl";
import type { Gig, GigProposal } from "@/app/_lib/gigs/types";
import type { MoveId } from "../../logic/moves";
import { proposalBasisNote, proposalHasFile } from "../../logic/proposal";
import type { ReportSection } from "../../logic/report";
import { useFallbackWhy, type GigFileState } from "../report/useGigFile";
import type { SummaryKit } from "./useSummaryKit";

// The Moves block's content, grouped by the object each move acts on: the draft or kp's bid
// when one is on the desk, the report, the client proposal (a freelance bid only), the plans,
// the research. Every group carries its moves and, only when there is one, its state: Writing,
// why the last write failed, or the client proposal's basis note. A move that needs the brief
// is left out while there is none (MovesBlock says, once, that everything starts from the
// research) rather than shown disabled with the reason in a tooltip. The move that matches the
// gig's next move (logic/moves.ts) is the ONE primary; MovesBlock.tsx sets it.

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
export type MoveState = { tone: "writing" | "fail" | "note"; text: string };
export type MoveGroup = { key: string; title: string; items: MoveItem[]; states: MoveState[] };

export function useMoveGroups(gig: Gig, kit: SummaryKit, proposalFile: GigFileState<GigProposal>, onGo: (s: ReportSection) => void): MoveGroup[] {
  const t = useTranslations("gigs");
  const why = useFallbackWhy();
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
      states: [],
    });
  }

  const r = report.file;
  groups.push({
    key: "report",
    title: t("moves.group.report"),
    items: [
      ...(r ? [{ key: "open", move: "openReport" as const, label: t("report.file.open"), href: `${base}/report`, icon: "open" as const }] : []),
      ...(brief ? [{ key: "write", move: "writeReport" as const, label: r ? t("report.file.regenerate") : t("report.file.write"), tip: t("report.file.regenerateTip"), disabled: report.writing, loading: report.busy, loadingLabel: t("report.file.regenerating"), onClick: () => void report.write() }] : []),
    ],
    states: [
      ...(report.writing ? [{ tone: "writing" as const, text: r ? t("report.file.status.writing") : t("report.file.firstWriting") }] : []),
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
        ...(brief ? [{ key: "write", move: "prepareProposal" as const, label: has ? t("proposal.hero.rewrite") : t("proposal.hero.prepare"), tip: t("proposal.hero.tip"), disabled: proposalFile.writing, loading: proposalFile.busy, loadingLabel: t("proposal.hero.asking"), onClick: () => void proposalFile.write() }] : []),
      ],
      states: [
        ...(proposalFile.writing ? [{ tone: "writing" as const, text: has ? t("proposal.hero.writing") : t("proposal.hero.firstWriting") }] : []),
        ...fail(p?.status === "failed" && !proposalFile.writing ? t("proposal.hero.failed", { reason: why(p.fallbackReason) }) : null),
        ...(note && brief && !proposalFile.writing ? [{ tone: "note" as const, text: t(`proposal.hero.basis.${note}`) }] : []),
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
    items: view.accepted || !brief ? (rows ? [go] : []) : rows ? [go, { key: "again", label: t("plans.proposeAgain"), onClick: propose, disabled: planAct.busy || view.busy }] : [{ key: "gen", move: "generatePlans", label: t("report.choose.generate"), onClick: propose, disabled: planAct.busy || view.busy }],
    states: [...(view.busy && !view.accepted ? [{ tone: "writing" as const, text: t("moves.plansWriting") }] : []), ...fail(planAct.error)],
  });

  groups.push({
    key: "research",
    title: t("moves.group.research"),
    items: [{ key: "run", move: "research", label: brief ? t("brief.researchAgain") : t("brief.research"), loading: research.busy, loadingLabel: t("brief.researching"), onClick: () => void research.research() }],
    states: fail(research.error),
  });

  return groups;
}
