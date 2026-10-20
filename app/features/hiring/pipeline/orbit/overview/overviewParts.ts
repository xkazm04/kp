"use client";

import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { labelWidths } from "@/app/_components/kit/scene";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import type { Entry, StageDef } from "@/app/features/shared/pipelineTypes";
import { boardPopulation, deriveRailRows } from "../../pipelineBoardPopulation";
import type { PipelineTabState } from "../../usePipelineTabState";
import type { LensId, OrbitGroup, OrbitModel } from "../orbitModel";
import { layoutOrbit, type OrbitGeo } from "../orbitLayout";
import type { OrbitWords } from "../orbitWords";
import { mainStage, overviewQueues, urgentFirst, type OverviewQueue } from "./overviewModel";

/** Every dot where it sits on screen, and the orbit's centre and radius: what a grow flight starts from. */
export type OverviewSnap = { from: Map<string, { x: number; y: number; r: number }>; origin: { cx: number; cy: number; R: number } };

/** People the orbit brings forward (a queue, the waiting count, one person): lit, the rest dimmed. */
export type LitSet = { key: string; label: string; ids: ReadonlySet<string>; entries: readonly Entry[]; needs: boolean };

/** Where an Overview click lands in the opened orbit: a focused ring and/or a lit set. */
export type ExpandTo = { stage?: string | null; lit?: LitSet | null };

/** One queue as the Overview draws it. */
export type QueueView = OverviewQueue & {
  /** The full sentence ("17 new applications"), for the accessible name and the lit strip. */
  label: string;
  /** The words after the numeral ("new applications"). */
  noun: string;
  ids: ReadonlySet<string>;
  /** Its people, the most urgent first. */
  people: Entry[];
  /** The ring its wire goes to (the stage most of its people stand on), as an axis index. */
  si: number | null;
  /** The stages its people stand on, in axis order ("Accepted · Interview"). */
  stages: string;
  /** The door's words: "Show on the board", "Open Decisions", "Open Schedule". */
  door: string;
};

/** Today's queues (deriveRailRows + the decisions queue) and the door to each (a real tab switch). */
export function useOverviewToday(s: PipelineTabState, axis: readonly StageDef[], model: OrbitModel | null, words: OrbitWords) {
  const t = useTranslations("pipeline.today");
  const tl = useTranslations("overviewLit.queue");
  const nav = useShellNavigate();
  const search = useSearchParams();
  const [now] = useState(() => Date.now());
  const queues = useMemo<QueueView[]>(() => {
    if (!model) return [];
    const rows = deriveRailRows(s.entries, axis, now);
    return overviewQueues(rows, boardPopulation(s.entries).active, axis).map((q) => {
      const count = q.entries.length;
      const at = q.stage ? axis.findIndex((x) => x.id === q.stage) : -1;
      const on = new Set(q.entries.map((e) => model.byId.get(e.id)?.si).filter((i): i is number => i != null));
      return {
        ...q,
        label: q.key === "decisions" ? tl("decisions", { count }) : t(q.key, { count }),
        noun: tl(`label.${q.key}`, { count }),
        ids: new Set(q.entries.map((e) => e.id)),
        people: urgentFirst(q.entries, model),
        si: mainStage(q.entries, model, at >= 0 ? at : null),
        stages: axis.filter((_, i) => on.has(i)).map((x) => words.stage(x.id)).join(" · "),
        door: t(q.stage ? "showBoard" : q.tab === "schedule" ? "openSchedule" : "openDecisions"),
      };
    });
  }, [s.entries, axis, now, t, tl, model, words]);
  const openTab = (q: QueueView) => {
    if (q.tab) nav.push(buildUrl({ tab: q.tab, ...clearedTabScopedParams() }, search.toString()));
  };
  return { queues, openTab };
}

/** The folded orbit's diameter: its column's width, no taller than the window leaves room for. */
export function useDialSize(ref: RefObject<HTMLElement | null>): number {
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const room = Math.max(340, Math.min(640, window.innerHeight - 300));
      setSize(Math.round(Math.min(el.getBoundingClientRect().width, room)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [ref]);
  return size;
}

/** The folded orbit's geometry: THE orbit's layout (same groups, same lens), cut by its people, at `size`. */
export function useDialGeo(groups: readonly OrbitGroup[], model: OrbitModel, axisLength: number, size: number, labels: readonly string[]): OrbitGeo | null {
  return useMemo(() => {
    if (size <= 0) return null;
    return layoutOrbit(groups, axisLength, size, size, { counts: model.total.st.map((x) => x.n), labels: labelWidths(labels) });
  }, [groups, model, axisLength, size, labels]);
}

/** Everything the Overview reads. */
export type OverviewProps = {
  model: OrbitModel;
  groups: OrbitGroup[];
  lens: LensId;
  axis: readonly StageDef[];
  words: OrbitWords;
  /** Each column's aging cadence in days (0 = never ages), in axis order. */
  sla: readonly number[];
  queues: QueueView[];
  /** Open the orbit (L0) out of the Overview's own: its dots fly to their full-size places. */
  onExpand: (snap: OverviewSnap | null, to?: ExpandTo) => void;
  /** A queue worked on another tab (Decisions, Schedule): switch to it. */
  onOpenTab: (q: QueueView) => void;
  /** Open one person's full record, with `cohort` as its prev / next. */
  onPerson: (e: Entry, cohort: readonly Entry[]) => void;
  /** The job list loaded, so empty roles can be counted. */
  jobsOk: boolean;
};
