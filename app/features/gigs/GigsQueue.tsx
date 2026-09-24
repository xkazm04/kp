"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { BTN_GHOST, CHIP_QUIET, KBD, META_LABEL, NOTICE, PANEL, PANEL_SUNKEN, STAT_VALUE } from "@/app/_components/ui/recipes";
import { lintDraft, lintGate } from "@/app/_lib/gigs/draft-lint";
import type { Gig, GigArena, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import {
  AGENT_KINDS,
  deriveQueue,
  OPERATOR_KINDS,
  queueCounts,
  QUEUE_KINDS,
  selectionAfter,
  stepSelection,
  type AfterWrite,
  type QueueItem,
  type QueueKind,
  type SourceRow,
  type SpecialistRow,
} from "./gigsLogic";
import { GigsDesk, type DeskStore } from "./GigsDesk";
import { RewardText } from "./GigsFacts";
import { AgentWorkView, RecordView, SuspectView, TriageView } from "./GigsWorkViews";
import { useBareKeys } from "./useBareKeys";
import { useGigsFormat } from "./useGigsFormat";

// The home screen: the judgements the operator owes, as four count tiles that are also
// the navigation, a queue rail grouped by who acts next, and the workspace for the
// selected item. Work sitting with the agents is listed under its own line and in its
// own box - it never pads the operator's count.

type Filter = "all" | (typeof OPERATOR_KINDS)[number] | "agents";

const TILE_TONE: Record<(typeof OPERATOR_KINDS)[number], string> = {
  review: "text-coral",
  suspect: "text-red-700",
  record: "text-blue-700",
  triage: "text-steel",
};

export function GigsQueue({
  gigs,
  attemptsByGig,
  kpi,
  sources,
  specialists,
  now,
  reloadWork,
  onHire,
  store,
  request,
}: {
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  kpi: GigKpi | null;
  sources: readonly SourceRow[];
  specialists: readonly SpecialistRow[];
  now: Date;
  reloadWork: () => Promise<GigKpi | null>;
  onHire: (arena: GigArena) => void;
  /** The tab's desk memory, kept above the queue so a trip to the board keeps ticks. */
  store: DeskStore;
  /** An item another screen asked to open ("Open in the queue"); nonce re-asks. */
  request: { key: string; nonce: number } | null;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const items = useMemo(() => deriveQueue(gigs, attemptsByGig), [gigs, attemptsByGig]);
  const counts = queueCounts(items);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(() => request?.key ?? items.find((i) => i.kind === "review")?.key ?? items.find((i) => (OPERATOR_KINDS as readonly string[]).includes(i.kind))?.key ?? null);
  const [flash, setFlash] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState(request);
  if (request !== lastRequest) {
    setLastRequest(request);
    if (request) {
      setFilter("all");
      setSelected(request.key);
    }
  }

  // When a write moved the selected item out of its queue, open what took its place.
  // Derived-state-from-props, done during render as React documents it.
  const [lastItems, setLastItems] = useState(items);
  if (lastItems !== items) {
    setLastItems(items);
    if (selected && !items.some((i) => i.key === selected)) setSelected(selectionAfter(lastItems, items, selected));
  }

  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const specialistById = useMemo(() => new Map(specialists.map((s) => [s.id, s])), [specialists]);
  const visible = items.filter((i) => filter === "all" || i.kind === filter || (filter === "agents" && (AGENT_KINDS as readonly string[]).includes(i.kind)));
  const current = items.find((i) => i.key === selected) ?? null;

  const afterWrite: AfterWrite = useCallback(
    async (_left, message) => {
      const next = await reloadWork();
      if (message) setFlash(message);
      return next;
    },
    [reloadWork]
  );

  useBareKeys((key) => {
    if (key === "j" || key === "k") {
      setSelected((s) => stepSelection(visible, s, key === "j" ? 1 : -1));
      return true;
    }
    if (key === "escape" && filter !== "all") {
      setFilter("all");
      return true;
    }
    return false;
  });

  function pickFilter(f: Filter) {
    const next = filter === f ? "all" : f;
    setFilter(next);
    const first = items.find((i) => (next === "agents" ? (AGENT_KINDS as readonly string[]).includes(i.kind) : next === "all" || i.kind === next));
    if (first) setSelected(first.key);
  }

  const agentTotal = counts.running + counts.revision + counts.failed;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.3fr)]" role="group" aria-label={t("queue.tilesLabel")}>
        {OPERATOR_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => pickFilter(k)}
            className={`${PANEL} focus-ring grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 px-4 py-3 text-left transition-transform hover:-translate-y-px dark:hover:rotate-0 ${
              filter === k ? "outline outline-2 outline-ink" : ""
            }`}
          >
            <span className={`${STAT_VALUE} row-span-2 text-display ${counts[k] ? TILE_TONE[k] : "text-steel"}`}>{counts[k]}</span>
            <span className="text-sm font-semibold text-ink">{t(`queue.tile.${k}` as Parameters<typeof t>[0], { count: counts[k] })}</span>
            <span className="text-sm text-steel">{t(`queue.tileSub.${k}` as Parameters<typeof t>[0])}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={filter === "agents"}
          onClick={() => pickFilter("agents")}
          className={`focus-ring rounded-lg border-2 border-dashed border-stone-300 px-4 py-3 text-left text-sm text-steel dark:rounded-2xl ${filter === "agents" ? "outline outline-2 outline-ink" : ""}`}
        >
          <span className="block font-semibold text-ink">{t("queue.agentsTitle")}</span>
          <span className="block">{t("queue.agentsLine", { running: counts.running, revision: counts.revision, failed: counts.failed })}</span>
          {agentTotal === 0 ? <span className="block">{t("queue.agentsNone")}</span> : null}
        </button>
      </div>

      {flash ? (
        <div role="status" className={`${NOTICE("info")} flex items-start justify-between gap-3 px-3 py-2 text-sm`}>
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} className={`${BTN_GHOST} h-6 px-1`} aria-label={t("queue.dismiss")}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label={t("queue.railLabel")} className={`${PANEL} overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto`}>
          {QUEUE_KINDS.filter((k) => filter === "all" || filter === k || (filter === "agents" && (AGENT_KINDS as readonly string[]).includes(k))).map((k) => {
            const group = items.filter((i) => i.kind === k);
            const isAgents = (AGENT_KINDS as readonly string[]).includes(k);
            return (
              <section key={k}>
                <h3 className={`sticky top-0 z-10 flex justify-between border-b border-stone-200 bg-stone-50 px-3 py-1.5 ${META_LABEL} ${isAgents ? "opacity-80" : ""}`}>
                  <span>{t(`queue.group.${k}` as Parameters<typeof t>[0])}</span>
                  <span className="nums">{group.length}</span>
                </h3>
                {group.length === 0 ? (
                  <p className="px-3 py-2 text-sm italic text-steel">{t(`queue.empty.${k}` as Parameters<typeof t>[0])}</p>
                ) : (
                  <ul>
                    {group.map((i) => (
                      <li key={i.key}>
                        <RailItem item={i} active={i.key === selected} onPick={() => setSelected(i.key)} source={i.gig.sourceId ? (sourceById.get(i.gig.sourceId) ?? null) : null} specialist={specialistFor(i, specialistById)} now={now} passive={isAgents} fmt={fmt} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          <p className="border-t border-stone-200 px-3 py-2 text-sm text-steel">
            {t.rich("queue.keys", { kbd: (chunks) => <kbd className={`${KBD} text-xs`}>{chunks}</kbd> })}
          </p>
        </nav>

        <section aria-label={t("queue.workspaceLabel")} className={`${PANEL} min-h-[24rem] min-w-0`}>
          {current ? (
            <Workspace
              key={current.key + (current.attempt?.id ?? "")}
              item={current}
              source={current.gig.sourceId ? (sourceById.get(current.gig.sourceId) ?? null) : null}
              specialist={specialistFor(current, specialistById)}
              specialists={specialists}
              kpi={kpi}
              now={now}
              store={store}
              onChanged={afterWrite}
              onFlash={setFlash}
              onHire={onHire}
            />
          ) : (
            <div className={`${PANEL_SUNKEN} m-6 px-6 py-10 text-center`}>
              <p className="font-serif text-h3 text-ink">{items.length ? t("queue.pickTitle") : t("queue.emptyTitle")}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-steel">{items.length ? t("queue.pickBody") : t("queue.emptyBody")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function specialistFor(item: QueueItem, byId: ReadonlyMap<string, SpecialistRow>): SpecialistRow | null {
  const id = item.attempt?.specialistId ?? item.gig.specialistId;
  return id ? (byId.get(id) ?? null) : null;
}

function RailItem({
  item,
  active,
  onPick,
  source,
  specialist,
  now,
  passive,
  fmt,
}: {
  item: QueueItem;
  active: boolean;
  onPick: () => void;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  now: Date;
  passive: boolean;
  fmt: ReturnType<typeof useGigsFormat>;
}) {
  const t = useTranslations("gigs");
  const { gig, attempt } = item;
  let flags: { text: string; severe: boolean } | null = null;
  if (item.kind === "review" && attempt) {
    const g = lintGate(lintDraft({ gig, attempt, source, now }), new Set());
    if (g.blockers) flags = { text: t("queue.flagBlockers", { blockers: g.blockers, warns: g.warns }), severe: true };
    else if (g.warns) flags = { text: t("queue.flagWarns", { count: g.warns }), severe: false };
  }
  if (item.kind === "suspect") flags = { text: gig.suspectReasons.map((r) => fmt.suspect(r)).join(", "), severe: true };

  const meta = (() => {
    switch (item.kind) {
      case "review":
        return attempt?.status === "approved"
          ? t("queue.meta.approved")
          : t("queue.meta.review", { name: specialist?.name ?? t("desk.theAgent"), when: fmt.relative(attempt?.createdAt ?? null, now) ?? "" });
      case "record":
        return t("queue.meta.record", { date: fmt.date(attempt?.sentAt ?? null), when: fmt.relative(attempt?.sentAt ?? null, now) ?? "" });
      case "triage":
        return gig.status === "qualified" ? t("queue.meta.qualified") : t("queue.meta.belowBar");
      case "running":
        return t("queue.meta.running", { date: fmt.date(attempt?.createdAt ?? null) });
      case "revision":
        return t("queue.meta.revision");
      case "failed":
        return t("queue.meta.failed");
      default:
        return "";
    }
  })();

  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={active ? "true" : undefined}
      className={`focus-ring block w-full border-b border-l-4 border-b-stone-200 px-3 py-2 text-left hover:bg-stone-50 ${active ? "border-l-coral bg-stone-50" : "border-l-transparent"}`}
    >
      <span className={`block text-sm leading-snug ${passive ? "font-medium text-steel" : "font-semibold text-ink"}`}>{gig.title}</span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-steel">
        <span className={`${CHIP_QUIET} text-xs`}>{fmt.arena(gig.arena)}</span>
        <RewardText gig={gig} />
      </span>
      <span className="mt-0.5 block text-sm text-steel">{meta}</span>
      {flags ? <span className={`mt-0.5 block text-sm font-semibold ${flags.severe ? "text-coral" : "text-amber-700"}`}>{flags.text}</span> : null}
    </button>
  );
}

function Workspace(props: {
  item: QueueItem;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  specialists: readonly SpecialistRow[];
  kpi: GigKpi | null;
  now: Date;
  store: DeskStore;
  onChanged: AfterWrite;
  onFlash: (m: string) => void;
  onHire: (arena: GigArena) => void;
}) {
  const { item } = props;
  const kind: QueueKind = item.kind;
  if (kind === "review") return <GigsDesk item={item} source={props.source} specialist={props.specialist} now={props.now} store={props.store} onChanged={props.onChanged} />;
  if (kind === "suspect") return <SuspectView item={item} source={props.source} specialist={props.specialist} now={props.now} onChanged={props.onChanged} />;
  if (kind === "record") return <RecordView item={item} source={props.source} specialist={props.specialist} now={props.now} onChanged={props.onChanged} onFlash={props.onFlash} kpi={props.kpi} />;
  if (kind === "triage")
    return <TriageView item={item} source={props.source} specialist={props.specialist} now={props.now} onChanged={props.onChanged} kpi={props.kpi} specialists={props.specialists} onHire={props.onHire} />;
  return <AgentWorkView item={item} source={props.source} specialist={props.specialist} now={props.now} onChanged={props.onChanged} />;
}
