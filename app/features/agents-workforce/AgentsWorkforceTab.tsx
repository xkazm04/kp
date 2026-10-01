"use client";

import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LevelTransition, KeyHints, layerModeAt, type Crumb, type KeyHint } from "@/app/_components/kit/scene";
import { Button, PageHead } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { BridgeConfigPublic } from "@/app/_lib/agent-hire/bridge-store";
import { buildUrl } from "@/app/features/shell/tabs";
import { nextAction, type AgentRosterEntry, type NextAction, type NextActionKind } from "./agentsWorkforceLogic";
import { WorkforceDrawer } from "./WorkforceDrawer";
import { WorkforceBack, WorkforceFront } from "./WorkforceHire";
import { WorkforceNeeds, type NeedsFilter } from "./WorkforceNeeds";
import { WorkforceWheel, type WheelFilter } from "./WorkforceWheel";
import { WorkforceStats } from "./WorkforceStats";
import type { Speak } from "./WorkforceBits";
import { useHireControl } from "./useHireControl";
import { useWorkforceFormat } from "./useWorkforceFormat";
import { useWorkforceKeys } from "./useWorkforceKeys";
import { useWorkforceNav } from "./useWorkforceNav";
import { useWorkforceWords } from "./useWorkforceWords";
import { bridgeView, drawerOf, groupDrawers, needing, wheelOf, type Moves, type Phase } from "./workforceModel";
import { depthOf, layerKey, stepDrawer, stepWalk, topOf, type WorkforceEntry, type WorkforceStack } from "./workforceNav";
import "./workforce.css";

// Agent-candidate bridge — the workforce module: every AI agent hired through a role, as "The Time-Card Rack" (the
// agents-workforce contest winner, workforce/README in docs/features/agents/README.md): the Personas bridge is the
// time clock at the centre of a wheel, every hire a time card standing on its drawer's sector of the rim, and you
// walk into a drawer, a card's front and its back (the evidence). Live aggregates (runs, success, spend vs budget,
// connector use), the client-computed "expectations met" verdict and each hire's next move with its ONE control all
// come from agentsWorkforceLogic.ts; this shell owns the data, the level stack, the keys and the one control instance.
// Empty states are chain-aware: unpaired points at Settings → Integrations, connected-but-empty points at a job's
// Agent fit tab. The module is unfinished and reachable only behind NEXT_PUBLIC_KP_AGENT_HIRING (tabs.ts); the tag says
// so ON the surface.

export function AgentsWorkforceTab() {
  const t = useTranslations("agentsWorkforce");
  const router = useRouter();
  const search = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);
  const { data, error, reload } = useJsonFetch<{ agents: AgentRosterEntry[] }>("/api/agents", t("loadFailed"));
  const { data: bridgeData } = useJsonFetch<{ bridge: BridgeConfigPublic }>("/api/agents/bridge", t("loadFailed"));
  const fmt = useWorkforceFormat();
  const words = useWorkforceWords();
  const nav = useWorkforceNav(rootRef);
  const control = useHireControl(reload);
  const [filter, setFilter] = useState<WheelFilter>({ need: null, phase: null });

  const agents = useMemo(() => data?.agents ?? [], [data]);
  const bridge = useMemo(() => bridgeView(bridgeData ? bridgeData.bridge : null), [bridgeData]);
  // One clock per roster read so every card, queue and level agree on "now"; the moves read the bridge only once it is KNOWN
  // (a dead bridge outranks every other move, and absence of evidence is not a dead bridge).
  const { moves, now } = useMemo(() => {
    const at = new Date();
    const b = bridge.state === "unknown" ? null : { paired: bridge.state === "paired" };
    return { now: at, moves: new Map<string, NextAction>(agents.map((a) => [a.id, nextAction(a, b, at)])) as Moves };
  }, [agents, bridge.state]);
  const drawers = useMemo(() => groupDrawers(agents, moves), [agents, moves]);
  const wheel = useMemo(() => wheelOf(drawers, moves), [drawers, moves]);

  const goIntegrations = useCallback(() => router.push(buildUrl({ tab: "integrations" }, search.toString())), [router, search]);
  const goRoles = useCallback(() => router.push(buildUrl({ tab: "jobs" }, search.toString())), [router, search]);
  const run = useCallback(
    (agent: AgentRosterEntry, move: NextAction) => {
      if (move.kind === "none") return;
      const ctl = move.kind === "repair_bridge" ? "integrations" : move.kind === "redispatch" ? "redispatch" : move.kind === "check_reporter" ? "explain" : "refresh";
      if (ctl === "integrations") goIntegrations();
      else if (ctl === "redispatch" && move.kind === "redispatch") void control.redispatch(agent.id, move);
      else if (ctl === "refresh") void control.refresh(agent.id);
    },
    [control, goIntegrations],
  );
  const speak: Speak = useMemo(() => ({ fmt, words, control, run }), [fmt, words, control, run]);

  const depth = depthOf(nav.stack);
  const top = topOf(nav.stack);
  const lastOkAgo = bridge.lastOkAt ? fmt.ago(bridge.lastOkAt) : null;
  const settled = (data !== null || error !== null) && bridgeData !== null;

  const needsKinds = useMemo(() => {
    const seen: NextActionKind[] = [];
    for (const m of moves.values()) if (m.kind !== "none" && !seen.includes(m.kind)) seen.push(m.kind);
    return ["repair_bridge", "approval_lapsed", "approve_in_personas", "review_probation", "check_reporter", "redispatch"].filter((k) => seen.includes(k as NextActionKind)) as NextActionKind[];
  }, [moves]);

  useWorkforceKeys(rootRef, {
    level: top.level,
    onBack: nav.pop,
    onEscapeAtRoot: () => {
      if (!filter.need && !filter.phase) return false;
      setFilter({ need: null, phase: null });
      return true;
    },
    onDigit: top.level === 0 ? (n) => {
      const kind = needsKinds[n - 1];
      if (kind) setFilter((f) => ({ need: f.need === kind ? null : kind, phase: null }));
    } : undefined,
    onStep:
      top.level === 1 && top.drawer !== "all"
        ? (d) => {
            const next = stepDrawer(drawers.map((x) => x.key), top.drawer, d);
            if (next) nav.replaceTop({ level: 1, drawer: next, need: null });
          }
        : top.level === 2
          ? (d) => {
              const id = stepWalk(top.walk, top.id, d);
              if (id) nav.replaceTop({ ...top, id });
            }
          : undefined,
  });

  const findAgent = (id: string) => agents.find((a) => a.id === id) ?? null;
  const labelOf = (e: WorkforceEntry): string => {
    if (e.level === 0) return t("wk.crumbRoot");
    if (e.level === 1) return words.drawerNameOf(e.drawer, drawers);
    if (e.level === 2) return nameOfSafe(findAgent(e.id));
    return t("wk.crumbEvidence");
  };
  const crumbsFor = (stack: WorkforceStack, d: number): Crumb[] =>
    stack.slice(0, d + 1).map((e, i) => ({ label: labelOf(e), onSelect: i < d ? () => nav.popTo(i) : undefined }));

  const render = (entry: WorkforceEntry, d: number, stack: WorkforceStack): ReactElement => {
    const isTop = d === depthOf(stack) && nav.transition?.kind !== "close";
    if (entry.level === 0) {
      return (
        <WorkforceHome
          error={error}
          loaded={settled}
          reload={reload}
          agents={agents}
          moves={moves}
          bridge={bridge}
          lastOkAgo={lastOkAgo}
          drawers={drawers}
          wheel={wheel}
          filter={filter}
          setFilter={setFilter}
          speak={speak}
          now={now}
          onOpenDrawer={(key, el) => nav.push({ level: 1, drawer: key, need: null }, el)}
          onOpenCard={(id, walk, el) => nav.push({ level: 2, id, walk }, el)}
          onShowInRack={(kind, el) => nav.push({ level: 1, drawer: "all", need: kind }, el)}
          onIntegrations={goIntegrations}
          onBrowseRoles={goRoles}
        />
      );
    }
    const crumbs = crumbsFor(stack, d);
    if (entry.level === 1) {
      const keys = drawers.map((x) => x.key);
      const at = entry.drawer === "all" ? -1 : keys.indexOf(entry.drawer);
      return (
        <WorkforceDrawer
          drawerRef={entry.drawer}
          preset={entry.need}
          agents={agents}
          drawers={drawers}
          wheel={wheel}
          moves={moves}
          bridge={bridge}
          speak={speak}
          now={now}
          active={isTop}
          crumbs={crumbs}
          position={at >= 0 ? { index: at + 1, of: keys.length } : null}
          onBack={nav.pop}
          onStep={(dx) => {
            const next = stepDrawer(keys, entry.drawer, dx);
            if (next) nav.replaceTop({ level: 1, drawer: next, need: null });
          }}
          onOpenCard={(id, walk, el) => nav.push({ level: 2, id, walk }, el)}
          onIntegrations={goIntegrations}
        />
      );
    }
    const agent = findAgent(entry.id);
    if (!agent) {
      return (
        <section className="k-lvl" data-tone="stone">
          <div className="k-lvl__bar k-trail"><Button label={t("wk.back.generic")} icon="left" size="sm" onClick={nav.pop} /></div>
          <p className="k-lvl__lead" data-level-heading="" tabIndex={-1}>{t("wk.card.gone")}</p>
        </section>
      );
    }
    const move = moves.get(agent.id) ?? { kind: "none" as const };
    if (entry.level === 2) {
      return (
        <WorkforceFront
          agent={agent}
          move={move}
          drawer={drawerOf(agent, drawers)}
          speak={speak}
          now={now}
          crumbs={crumbs}
          walk={entry.walk}
          onBack={nav.pop}
          onStep={(dx) => {
            const id = stepWalk(entry.walk, entry.id, dx);
            if (id) nav.replaceTop({ ...entry, id });
          }}
          onFlip={(el) => nav.push({ level: 3, id: entry.id, walk: entry.walk }, el)}
          onOpenRole={agent.jobId ? () => router.push(buildUrl({ tab: "jobs", job: agent.jobId }, search.toString())) : null}
        />
      );
    }
    return <WorkforceBack agent={agent} speak={speak} now={now} crumbs={crumbs} onBack={nav.pop} />;
  };

  const layers = nav.stack.map((entry, d) => (
    <LevelTransition key={layerKey(entry, d)} depth={d} mode={layerModeAt(d, depth, nav.kind)} opener={d === depth ? nav.openers[d] ?? null : null} onSettled={d === depth ? nav.settle : undefined}>
      {render(entry, d, nav.stack)}
    </LevelTransition>
  ));
  const tr = nav.transition;
  if (tr?.kind === "close") {
    // The closing level keeps its key, so React keeps its instance while the circle closes.
    layers.push(
      <LevelTransition key={layerKey(tr.ghost, tr.ghostDepth)} depth={tr.ghostDepth} mode="leaving" opener={tr.opener} onSettled={nav.settle}>
        {render(tr.ghost, tr.ghostDepth, tr.from)}
      </LevelTransition>,
    );
  }

  return (
    <div ref={rootRef} className="k-kit wk" data-density="compact" data-level={top.level} data-sim="agents" aria-busy={!settled || undefined}>
      <p className="sr-only" role="status">{crumbsFor(nav.stack, depth).map((c) => c.label).join(" › ")}</p>
      {layers}
    </div>
  );
}

function nameOfSafe(a: AgentRosterEntry | null): string {
  if (!a) return "";
  const spec = a.spec as { name?: string } | null;
  return a.personaName ?? (spec?.name || a.jobTitle);
}

/** Level 0 = the head, the left "needs you" column with the wheel, the totals under it and the keys. */
function WorkforceHome({
  error, loaded, reload, agents, moves, bridge, lastOkAgo, drawers, wheel, filter, setFilter, speak, now,
  onOpenDrawer, onOpenCard, onShowInRack, onIntegrations, onBrowseRoles,
}: {
  error: string | null;
  loaded: boolean;
  reload: () => void;
  agents: readonly AgentRosterEntry[];
  moves: Moves;
  bridge: ReturnType<typeof bridgeView>;
  lastOkAgo: string | null;
  drawers: ReturnType<typeof groupDrawers>;
  wheel: ReturnType<typeof wheelOf>;
  filter: WheelFilter;
  setFilter: (f: WheelFilter) => void;
  speak: Speak;
  now: Date;
  onOpenDrawer: (key: ReturnType<typeof groupDrawers>[number]["key"], el: HTMLElement | null) => void;
  onOpenCard: (id: string, walk: string[], el: HTMLElement | null) => void;
  onShowInRack: (kind: NextActionKind, el: HTMLElement | null) => void;
  onIntegrations: () => void;
  onBrowseRoles: () => void;
}) {
  const t = useTranslations("agentsWorkforce");
  const needsFilter: NeedsFilter = { need: filter.need };
  const keys: KeyHint[] = agents.length
    ? [
        { id: "digits", keys: ["1", "6"], act: t("wk.keys.needsFilters") },
        { id: "arrows", keys: ["↑", "↓"], act: t("wk.keys.betweenDrawers") },
        { id: "enter", keys: ["Enter"], act: t("wk.keys.open") },
        { id: "esc", keys: ["Esc"], act: t("wk.keys.clearFilters") },
      ]
    : [
        { id: "tab", keys: ["Tab"], act: t("wk.keys.tab") },
        { id: "enter", keys: ["Enter"], act: t("wk.keys.press") },
      ];
  return (
    <section className="wk-home">
      <div className="wk-top">
        <PageHead
          eyebrow={t("eyebrow")}
          title={t("title")}
          context={t("intro")}
          state={error ? "error" : "ready"}
          errorText={error ?? undefined}
          onRetry={reload}
          actions={<span className="k-tag wk-dev">{t("inDevelopment")}</span>}
        />
      </div>
      {!loaded && !error ? <LoadingGap className="min-h-[16rem]" /> : null}
      {loaded ? (
        <>
          <section className="floor" aria-label={t("wk.floorLabel")}>
            <div className="floor__needs" id="wk-needs" tabIndex={-1}>
              <WorkforceNeeds
                agents={agents}
                moves={moves}
                bridge={bridge}
                lastOkAgo={lastOkAgo}
                drawers={drawers}
                filter={needsFilter}
                onFilter={(kind) => setFilter({ need: kind, phase: null })}
                onOpenCard={(id, kind, el) => onOpenCard(id, needing(agents, moves, kind).map((a) => a.id), el)}
                onShowInRack={(kind) => onShowInRack(kind, null)}
                onIntegrations={onIntegrations}
                onBrowseRoles={onBrowseRoles}
                speak={speak}
                now={now}
              />
            </div>
            <div className="floor__stage">
              <WorkforceWheel
                wheel={wheel}
                agents={agents}
                moves={moves}
                bridge={bridge}
                filter={filter}
                onPhase={(p: Phase | null) => setFilter({ need: null, phase: p })}
                onOpenDrawer={onOpenDrawer}
                onOpenCard={(id, el) => onOpenCard(id, wheel.cards.filter((c) => c.drawer.key === wheel.cards.find((x) => x.agent.id === id)?.drawer.key).map((c) => c.agent.id), el)}
                speak={speak}
                lastOkAgo={lastOkAgo}
              />
            </div>
          </section>
          <WorkforceStats agents={agents} moves={moves} />
          <div className="keysbar"><KeyHints hints={keys} label={t("wk.keys.wheelLabel")} /></div>
        </>
      ) : null}
    </section>
  );
}
