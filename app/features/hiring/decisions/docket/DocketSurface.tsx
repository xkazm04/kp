"use client";

// The Docket surface: level 0 (head, the board of role groups, the key-decision rows, then the
// reconsider queue and the feedback letters the shell hands in as `extras`) and level 1 (one role),
// each inside a kit LevelTransition so a role opens as a circle growing from the touched element
// and closes back onto it. Owns the 8-second commit window overlay (a rejecting row leaves at
// once; the strip names who and counts the seconds; the write happens only when the window
// closes) and the batch bar, exactly as the section it replaces did.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { NOTICE } from "@/app/_components/ui/recipes";
import { KitTipLayer } from "@/app/_components/kit/KitTipLayer";
import { LevelTransition, layerModeAt } from "@/app/_components/kit/scene";
import { Empty } from "../DecisionsShared";
import { DecisionsBatchBar, type DecisionsBatchBarProps } from "../DecisionsBatchBar";
import { DecisionsEmptyHandoff } from "../DecisionsEmptyHandoff";
import { DecisionsUndoStrip } from "../DecisionsUndoStrip";
import { RoleDecisionRow } from "../DecisionsRoleRow";
import { hiddenIds } from "../decisionsCommitWindow";
import { roleKeyOf, type Group } from "../decisionsQueueTypes";
import { armDecision, dismissDecisionFailure, pruneLandedDecisions, undoDecision, useDecisionCommitWindow } from "../useDecisionCommitWindow";
import { ledgerRowOf } from "../ledger/decisionsLedgerModel";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { DocketBoard, type DocketRowHandlers } from "./DocketBoard";
import { DocketHead } from "./DocketHead";
import { DocketRoleLevel } from "./DocketRoleLevel";
import { docketGroups, docketHeadline } from "./docketModel";
import { topOf, useDocketNav } from "./useDocketNav";
import "./docket.css";

type Props = DecisionsBatchBarProps & {
  entries: Entry[] | null;
  error: string | null;
  pending: Entry[];
  pendingHeaderCount: number;
  visibleAiReviews: Entry[];
  visibleGroups: Group[];
  jobOptions: { key: string; label: string }[];
  activeFilter: string | null;
  setJobFilter: (v: string | null) => void;
  evalMode: "recommendation" | "committee" | "eligibility_list";
  setEvalMode: (v: "recommendation" | "committee" | "eligibility_list") => void;
  reconsiderCount: number;
  onRevealReconsider: () => void;
  onOpenRules: () => void;
  selectMode: boolean;
  setSelectMode: (v: boolean) => void;
  exitSelectMode: () => void;
  selectedReviewIds: ReadonlySet<string>;
  toggleReviewSelect: (e: Entry) => void;
  leavingWrapClass: (e: Entry) => string;
  act: (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string, ttlDays?: number) => void;
  staleSinceOf: (e: Entry) => string | null;
  /** Open the candidate modal with this recommendation to rule on. */
  onDecide: (e: Entry) => void;
  /** Key decisions: the compare / screening-wave row of one role. */
  evaluated: Record<string, string>;
  isBusy: (roleKey: string) => boolean;
  onCandidate: (e: Entry) => void;
  onGroupEval: (g: Group, selection?: string[]) => void;
  onScreenWave: (jobId: string, title: string) => void;
  armIds: readonly string[] | null | undefined;
  armJobId: string | null | undefined;
  /** The caught-up empty state's own needs. */
  recordCount: number;
  onArrivalLanded: () => void;
  /** Reconsider queue and feedback letters: level-0 footer content. */
  extras: ReactNode;
};

export function DocketSurface(p: Props) {
  const t = useTranslations("decisions");
  const locale = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const nav = useDocketNav(rootRef);
  const commitWindow = useDecisionCommitWindow();
  const hidden = useMemo(() => hiddenIds(commitWindow), [commitWindow]);
  const shown = useMemo(() => p.visibleAiReviews.filter((e) => !hidden.has(e.id)), [p.visibleAiReviews, hidden]);
  // A landed reject's overlay is dropped once the queue's read no longer lists it.
  const presentKey = p.visibleAiReviews.map((e) => e.id).join(",");
  useEffect(() => {
    pruneLandedDecisions(new Set(presentKey ? presentKey.split(",") : []));
  }, [presentKey]);

  const { staleSinceOf } = p;
  const rows = useMemo(() => shown.map((e) => ledgerRowOf(e, staleSinceOf(e))), [shown, staleSinceOf]);
  const groups = useMemo(() => docketGroups(rows, locale), [rows, locale]);
  const headline = useMemo(() => docketHeadline(rows, p.pending), [rows, p.pending]);

  const handlers: DocketRowHandlers = {
    selectMode: p.selectMode,
    selectedIds: p.selectedReviewIds,
    onToggleSelect: p.toggleReviewSelect,
    leavingWrapClass: p.leavingWrapClass,
    onDecide: p.onDecide,
    // The reject doors ARM the shared commit window; the accept door applies the proposal at once.
    act: (e, action) => (action === "reject" ? armDecision({ entryId: e.id, action, label: e.candidateLabel, expectedStage: e.stage }) : p.act(e, action)),
  };

  const toolsFor = (roleKey: string): ReactNode => {
    const g = p.visibleGroups.find((x) => x.roleKey === roleKey);
    return g ? keyRow(g) : null;
  };
  const keyRow = (g: Group) => (
    <RoleDecisionRow
      key={g.roleKey}
      roleTitle={g.roleTitle}
      entries={g.entries}
      evaluated={Boolean(p.evaluated[g.roleKey])}
      busy={p.isBusy(g.roleKey)}
      onCandidate={p.onCandidate}
      onGroupEval={(selection) => p.onGroupEval(g, selection)}
      onScreenWave={g.jobId ? () => p.onScreenWave(g.jobId as string, g.roleTitle) : undefined}
      // The pre-armed selection lands only on the deep-linked role's row; the row consumes it once.
      initialSelection={p.armIds && p.armJobId && g.jobId === p.armJobId ? p.armIds : undefined}
    />
  );

  const rootLabel = t("eyebrow");
  const level0 = (
    <div className="dk-level0">
      <DocketHead
        headline={headline}
        groups={groups}
        count={p.pendingHeaderCount}
        jobOptions={p.jobOptions}
        activeFilter={p.activeFilter}
        pending={p.pending}
        setJobFilter={p.setJobFilter}
        evalMode={p.evalMode}
        setEvalMode={p.setEvalMode}
        reconsiderCount={p.reconsiderCount}
        onRevealReconsider={p.onRevealReconsider}
        onOpenRules={p.onOpenRules}
        selectMode={p.selectMode}
        canSelect={p.selectableReviews.length > 1}
        onToggleSelect={() => (p.selectMode ? p.exitSelectMode() : p.setSelectMode(true))}
      />
      <div className="mt-3">
        <DecisionsUndoStrip state={commitWindow} onUndo={undoDecision} onDismissFailure={dismissDecisionFailure} />
      </div>
      {p.error ? (
        <p role="alert" aria-live="assertive" className={`mt-3 p-3 text-body ${NOTICE("critical")}`}>
          {p.error}
        </p>
      ) : p.entries == null ? (
        // The queue's fetch is in flight and there is nothing to show yet: hold its rough height and
        // stay invisible for 150ms so a warm response never flashes a placeholder.
        <div className="reveal-quiet min-h-[24rem]" aria-hidden />
      ) : p.pending.length === 0 ? (
        <DecisionsEmptyHandoff
          title={t("caughtUpTitle")}
          body={t("caughtUpBody")}
          links={[
            { tab: "schedule", label: t("caughtUpCtaSchedule") },
            { tab: "pipeline", label: t("caughtUpCtaPipeline") },
          ]}
          recordCount={p.recordCount}
          reconsiderCount={p.reconsiderCount}
          onRevealReconsider={p.onRevealReconsider}
          onArrivalLanded={p.onArrivalLanded}
        />
      ) : (
        <>
          {p.selectMode ? <DecisionsBatchBar {...p} /> : null}
          <DocketBoard groups={groups} onOpenRole={nav.push} {...handlers} />
          <section className="mt-6">
            <h3 className="dk-tools-h">
              {t("keyDecisions")} <span className="text-coral">· {p.visibleGroups.length}</span>
            </h3>
            <p className="mt-1 text-micro text-steel">{t("keyDecisionsHelp")}</p>
            <div className="mt-3 space-y-3">
              {p.visibleGroups.map(keyRow)}
              {p.visibleGroups.length === 0 ? <Empty>{t("noKeyDecisions")}</Empty> : null}
            </div>
          </section>
        </>
      )}
      <div className="mt-6 space-y-6">{p.extras}</div>
    </div>
  );

  const renderLevel = (entryKey: string | null, depth: number) => {
    if (depth === 0) return level0;
    const key = entryKey ?? "";
    const group = groups.find((g) => g.key === key) ?? null;
    const title = group?.title ?? p.visibleGroups.find((g) => g.roleKey === key)?.roleTitle ?? p.pending.find((e) => roleKeyOf(e) === key)?.jobTitle ?? t("unassignedRole");
    return <DocketRoleLevel group={group} roleTitle={title} rootLabel={rootLabel} onBack={nav.pop} tools={toolsFor(key)} {...handlers} />;
  };

  const depth = nav.stack.length - 1;
  const layers = nav.stack.map((e, d) => (
    <LevelTransition key={`${d}-${e.roleKey ?? "root"}`} depth={d} mode={layerModeAt(d, depth, nav.kind)} opener={d === depth ? nav.opener : null} onSettled={d === depth ? nav.settle : undefined}>
      {renderLevel(e.roleKey, d)}
    </LevelTransition>
  ));
  const tr = nav.transition;
  if (tr?.kind === "close") {
    layers.push(
      <LevelTransition key={`${depth + 1}-${tr.ghost.roleKey ?? "root"}`} depth={depth + 1} mode="leaving" opener={tr.opener} onSettled={nav.settle}>
        {renderLevel(tr.ghost.roleKey, depth + 1)}
      </LevelTransition>,
    );
  }

  return (
    <div ref={rootRef} className="k-kit dk" data-density="compact" data-level={topOf(nav.stack).level}>
      <KitTipLayer root={rootRef} />
      <p className="sr-only" role="status">
        {depth === 0 ? rootLabel : `${rootLabel} › ${renderTitle(nav.stack, groups, p)}`}
      </p>
      {layers}
    </div>
  );
}

function renderTitle(stack: ReturnType<typeof useDocketNav>["stack"], groups: ReturnType<typeof docketGroups>, p: Props): string {
  const key = topOf(stack).roleKey ?? "";
  return groups.find((g) => g.key === key)?.title ?? p.visibleGroups.find((g) => g.roleKey === key)?.roleTitle ?? key;
}
