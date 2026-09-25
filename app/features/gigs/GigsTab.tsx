"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical, RefreshCw, Radar, X } from "lucide-react";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INTRO, NOTICE, PANEL_SUNKEN, SECTION, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { GigArena } from "@/app/_lib/gigs/types";
import { columnNeighbours, lineRows, type AfterWrite } from "./gigsLogic";
import type { DeskStore } from "./GigsDesk";
import { GigsDetail } from "./GigsDetail";
import { GigsScorecard } from "./GigsScorecard";
import { GigsSources } from "./GigsSources";
import { GigsSpecialists } from "./GigsSpecialists";
import { EMPTY_WALL, GigsWall, type WallMemo, type WallState } from "./GigsWall";
import { sendJson, useGigsData } from "./useGigsData";

// The Gigs tab: real paid work found in the world, drafted by specialist agents, judged
// and SENT by the operator under their own account - kp never submits anywhere itself
// (docs/features/gigs/README.md).
//
// Built from the owner's verdict on a blind contest: "The Line" is what the tab opens on
// (arenas as rows, the lifecycle steps as columns - GigsWall.tsx), and the Judgement
// Queue's screens are its full pages - a gig's page with the review desk (GigsDetail.tsx),
// the scorecard, the specialists, the sources. Every page REPLACES the one before it;
// nothing slides over the wall. The wall's state (search, filter, opened-out cells, its
// scroll) lives here, above it, so the way back lands exactly where the operator left.
//
// Behind the same flag as the Agents tab (NEXT_PUBLIC_KP_AGENT_HIRING, tabs.ts): the
// module is in development and says so on the surface.

const VIEWS = ["line", "scorecard", "specialists", "sources"] as const;
type View = (typeof VIEWS)[number];

type Focus = { arena?: GigArena; specialistId?: string } | null;

export function GigsTab() {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const data = useGigsData();
  const [view, setView] = useState<View>("line");
  /** The gig whose full page replaces the wall; null = the wall. */
  const [openGig, setOpenGig] = useState<string | null>(null);
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const [arenaFocus, setArenaFocus] = useState<GigArena | null>(null);
  const [wall, setWall] = useState<WallState>(EMPTY_WALL);
  const wallMemo = useRef<WallMemo | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [hireArena, setHireArena] = useState<GigArena | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<{ tone: "info" | "critical"; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // The desk memory outlives a trip back to the line; one Map for the tab's life.
  const [store] = useState<DeskStore>(() => new Map());

  const goTo = useCallback((v: View) => {
    setView(v);
    setOpenGig(null);
    setFlash(null);
    if (v !== "line") setArenaFocus(null);
  }, []);
  const { tablistProps, tabProps, panelProps } = useTablist({
    ids: VIEWS,
    active: view,
    onSelect: (v) => {
      setFocus(null);
      goTo(v);
    },
  });

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

  const openGigPage = useCallback((gigId: string) => {
    setView("line");
    setFlash(null);
    setArenaFocus(null);
    setLastOpened(gigId);
    setOpenGig(gigId);
  }, []);
  const backToLine = useCallback((arena?: GigArena) => {
    setOpenGig(null);
    setFlash(null);
    setArenaFocus(arena ?? null);
  }, []);
  /** Left / Right on a gig's page: the neighbour replaces it, and becomes the card the
   *  wall outlines when the operator goes back. */
  const stepToGig = useCallback((gigId: string) => {
    setFlash(null);
    setLastOpened(gigId);
    setOpenGig(gigId);
  }, []);
  /** After a quick decline: the next page (or the wall), with the flash that names it. */
  const afterDecline = useCallback((nextGigId: string | null, message: string) => {
    if (nextGigId) {
      setLastOpened(nextGigId);
      setOpenGig(nextGigId);
    } else {
      setOpenGig(null);
      setArenaFocus(null);
    }
    setFlash(message);
  }, []);
  const openSpecialist = useCallback(
    (id: string) => {
      setFocus({ specialistId: id });
      setHireArena(null);
      goTo("specialists");
    },
    [goTo]
  );
  const openScorecard = useCallback(
    (arena: GigArena) => {
      setFocus({ arena });
      goTo("scorecard");
    },
    [goTo]
  );
  const onHire = useCallback(
    (arena: GigArena) => {
      setFocus(null);
      setHireArena(arena);
      goTo("specialists");
    },
    [goTo]
  );
  const afterWrite: AfterWrite = useCallback(
    async (message) => {
      const next = await reloadWork();
      setNow(new Date());
      if (message) setFlash(message);
      return next;
    },
    [reloadWork]
  );

  const loaded = data.gigs !== null && data.sources !== null && data.specialists !== null;
  const loadError = data.failure ? resolveError(data.failure as ApiErrorPayload, t("loadFailed")) : null;
  const detailGig = openGig && data.gigs ? (data.gigs.find((g) => g.id === openGig) ?? null) : null;
  // The wall's own rows, so a gig page walks its column in exactly the wall's order.
  const rows = useMemo(() => (data.gigs ? lineRows(data.gigs, data.attemptsByGig) : []), [data.gigs, data.attemptsByGig]);
  const neighbours = openGig ? columnNeighbours(rows, openGig) : null;

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

      <div className="space-y-4">
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

        {flash && !openGig ? (
          <div role="status" className={`${NOTICE("info")} flex items-start justify-between gap-3 px-3 py-2 text-sm`}>
            <span>{flash}</span>
            <button type="button" onClick={() => setFlash(null)} className={`${BTN_GHOST} h-6 px-1`} aria-label={t("detail.dismiss")}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ) : null}

        <div {...panelProps} className="min-w-0">
          {!loaded ? (
            loadError ? null : <LoadingGap className="min-h-[24rem]" label={t("loading")} />
          ) : view === "line" ? (
            openGig ? (
              <GigsDetail
                gigId={openGig}
                gig={detailGig}
                latest={detailGig ? (data.attemptsByGig[detailGig.id] ?? null) : null}
                sources={data.sources!}
                specialists={data.specialists!}
                kpi={data.kpi}
                now={now}
                store={store}
                flash={flash}
                neighbours={neighbours}
                onDismissFlash={() => setFlash(null)}
                onBack={backToLine}
                onStep={stepToGig}
                onDeclined={afterDecline}
                onChanged={afterWrite}
                onRated={setFlash}
                onHire={onHire}
              />
            ) : data.gigs!.length === 0 ? (
              <div className={`${PANEL_SUNKEN} px-6 py-10 text-center`}>
                <p className="font-serif text-h3 text-ink">{t("empty.title")}</p>
                <p className="mx-auto mt-1 max-w-lg text-sm text-steel">{data.sources!.length === 0 ? t("empty.noSources") : t("empty.noGigs")}</p>
                <button type="button" onClick={() => goTo("sources")} className="focus-ring mt-3 text-sm font-semibold text-coral hover:underline">
                  {t("empty.toSources")}
                </button>
              </div>
            ) : (
              <GigsWall
                gigs={data.gigs!}
                attemptsByGig={data.attemptsByGig}
                truncated={data.truncated}
                kpi={data.kpi}
                sources={data.sources!}
                specialists={data.specialists!}
                now={now}
                state={wall}
                onState={setWall}
                memoRef={wallMemo}
                lastOpened={lastOpened}
                arenaFocus={arenaFocus}
                onOpen={openGigPage}
                onOpenSpecialist={openSpecialist}
                onOpenScorecard={openScorecard}
                onHire={onHire}
                onNothingNeeded={() => setFlash(t("line.needNone"))}
              />
            )
          ) : view === "specialists" ? (
            <GigsSpecialists
              key={`${hireArena ?? "none"}:${focus?.specialistId ?? ""}`}
              specialists={data.specialists!}
              kpi={data.kpi}
              gigs={data.gigs!}
              attemptsByGig={data.attemptsByGig}
              initialArena={hireArena}
              focusId={focus?.specialistId ?? null}
              onOpenGig={openGigPage}
              onChanged={async () => {
                await Promise.all([reloadSpecialists(), reloadWork()]);
              }}
            />
          ) : view === "scorecard" ? (
            <GigsScorecard kpi={data.kpi} gigs={data.gigs!} attemptsByGig={data.attemptsByGig} specialists={data.specialists!} focus={focus} />
          ) : (
            <GigsSources
              sources={data.sources!}
              catalog={data.catalog ?? []}
              onChanged={reloadSources}
              onScanned={async () => {
                await Promise.all([reloadSources(), reloadWork()]);
                setNow(new Date());
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
