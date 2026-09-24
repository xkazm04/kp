"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical, RefreshCw, Radar } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INTRO, NOTICE, PANEL_SUNKEN, SECTION, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { GigArena } from "@/app/_lib/gigs/types";
import type { DeskStore } from "./GigsDesk";
import { GigsBoard } from "./GigsBoard";
import { GigsQueue } from "./GigsQueue";
import { GigsScorecard } from "./GigsScorecard";
import { GigsScoreRail } from "./GigsScoreRail";
import { GigsSources } from "./GigsSources";
import { GigsSpecialists } from "./GigsSpecialists";
import { sendJson, useGigsData } from "./useGigsData";

// The Gigs tab: real paid work found in the world, drafted by specialist agents, judged
// and SENT by the operator under their own account - kp never submits anywhere itself
// (docs/features/gigs/README.md). Built from the owner's pick of a blind contest: the
// "Judgement Queue" (home is the judgements owed, not a pipeline), with the Bench's
// always-visible scorecard rail and the Proof Room's margin marks on the draft.
//
// Behind the same flag as the Agents tab (NEXT_PUBLIC_KP_AGENT_HIRING, tabs.ts): the
// module is in development and says so on the surface.

const VIEWS = ["queue", "board", "specialists", "scorecard", "sources"] as const;
type View = (typeof VIEWS)[number];

export function GigsTab() {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const data = useGigsData();
  const [view, setView] = useState<View>("queue");
  const [hireArena, setHireArena] = useState<GigArena | null>(null);
  const [request, setRequest] = useState<{ key: string; nonce: number } | null>(null);
  const [scanNote, setScanNote] = useState<{ tone: "info" | "critical"; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // The desk memory outlives a trip to another screen; one Map for the tab's life.
  const [store] = useState<DeskStore>(() => new Map());
  const { tablistProps, tabProps, panelProps } = useTablist({ ids: VIEWS, active: view, onSelect: setView });

  // "Now" for deadlines and waits: refreshed each minute, not each render.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { reloadAll, reloadWork, reloadSpecialists, reloadSources } = data;
  const refreshAll = useCallback(async () => {
    await reloadAll();
    setNow(new Date());
  }, [reloadAll]);

  async function scan() {
    setScanning(true);
    setScanNote(null);
    const res = await sendJson("/api/gigs/scan", "POST", {});
    setScanning(false);
    if (!res.ok) {
      setScanNote({ tone: "critical", text: resolveError(res.body as ApiErrorPayload | null, t("scan.failed")) });
      return;
    }
    setScanNote({ tone: "info", text: t("scan.started") });
  }

  const onHire = useCallback((arena: GigArena) => {
    setHireArena(arena);
    setView("specialists");
  }, []);
  const onOpenInQueue = useCallback((key: string) => {
    setRequest((r) => ({ key, nonce: (r?.nonce ?? 0) + 1 }));
    setView("queue");
  }, []);

  const loaded = data.gigs !== null && data.sources !== null && data.specialists !== null;
  const loadError = data.failure ? resolveError(data.failure as ApiErrorPayload, t("loadFailed")) : null;

  return (
    <section className={`stagger-children ${SECTION}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <SectionTitle>{t("title")}</SectionTitle>
            <span className={`${NOTICE("amber")} inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold`}>
              <FlaskConical size={11} aria-hidden /> {t("inDevelopment")}
            </span>
          </div>
          <p className={`mt-2 max-w-3xl ${INTRO}`}>{t("intro")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void refreshAll()} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            <RefreshCw size={14} aria-hidden /> {t("refresh")}
          </button>
          <button type="button" disabled={scanning} onClick={() => void scan()} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
            <Radar size={14} aria-hidden /> {t("scan.button")}
          </button>
        </div>
      </header>

      {scanNote ? (
        <p role={scanNote.tone === "critical" ? "alert" : "status"} className={`${NOTICE(scanNote.tone)} px-3 py-2 text-sm`}>
          {scanNote.text}
        </p>
      ) : null}

      <div {...tablistProps} aria-label={t("views.label")} className={`${TOGGLE_GROUP} flex-wrap`}>
        {VIEWS.map((v) => (
          <button key={v} type="button" {...tabProps(v)} className={`focus-ring rounded px-3 py-1.5 text-sm font-semibold ${toggleBtn(view === v)}`}>
            {t(`views.${v}`)}
          </button>
        ))}
      </div>

      {loadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-base text-coral">
            {loadError}
          </p>
          <button type="button" onClick={() => void refreshAll()} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="2xl:order-2 2xl:sticky 2xl:top-4">
          <GigsScoreRail kpi={data.kpi} gigs={data.gigs} attemptsByGig={data.attemptsByGig} specialists={data.specialists} />
        </div>
        <div {...panelProps} className="min-w-0 2xl:order-1">
          {!loaded ? (
            loadError ? null : <LoadingGap className="min-h-[24rem]" label={t("loading")} />
          ) : view === "queue" ? (
            data.gigs!.length === 0 ? (
              <div className={`${PANEL_SUNKEN} px-6 py-10 text-center`}>
                <p className="font-serif text-h3 text-ink">{t("empty.title")}</p>
                <p className="mx-auto mt-1 max-w-lg text-sm text-steel">{data.sources!.length === 0 ? t("empty.noSources") : t("empty.noGigs")}</p>
                <button type="button" onClick={() => setView("sources")} className="focus-ring mt-3 text-sm font-semibold text-coral hover:underline">
                  {t("empty.toSources")}
                </button>
              </div>
            ) : (
              <GigsQueue
                gigs={data.gigs!}
                attemptsByGig={data.attemptsByGig}
                kpi={data.kpi}
                sources={data.sources!}
                specialists={data.specialists!}
                now={now}
                reloadWork={reloadWork}
                onHire={onHire}
                store={store}
                request={request}
              />
            )
          ) : view === "board" ? (
            <GigsBoard
              gigs={data.gigs!}
              attemptsByGig={data.attemptsByGig}
              truncated={data.truncated}
              sources={data.sources!}
              specialists={data.specialists!}
              now={now}
              onOpenInQueue={onOpenInQueue}
              onChanged={reloadWork}
            />
          ) : view === "specialists" ? (
            <GigsSpecialists
              key={hireArena ?? "none"}
              specialists={data.specialists!}
              kpi={data.kpi}
              gigs={data.gigs!}
              attemptsByGig={data.attemptsByGig}
              initialArena={hireArena}
              onChanged={async () => {
                await Promise.all([reloadSpecialists(), reloadWork()]);
              }}
            />
          ) : view === "scorecard" ? (
            <GigsScorecard kpi={data.kpi} gigs={data.gigs!} attemptsByGig={data.attemptsByGig} specialists={data.specialists!} />
          ) : (
            <GigsSources sources={data.sources!} catalog={data.catalog ?? []} onChanged={reloadSources} />
          )}
        </div>
      </div>
    </section>
  );
}
