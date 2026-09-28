"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical, Keyboard, Radar, RefreshCw, X } from "lucide-react";
import { Tooltip } from "@/app/_components/Tooltip";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { GigArena } from "@/app/_lib/gigs/types";
import {
  EMPTY_FILE,
  foldNiches,
  frontColumns,
  nextInQueue,
  nicheBySpecialistMap,
  urgencyQueue,
  waitCounts,
  type FileFilter,
  type FileStatus,
} from "./deskLogic";
import { deadlineView, overallCell, rateView } from "./gigsLogic";
import type { DeskStore } from "./GigsSignoff";
import { GigsFront } from "./GigsFront";
import { GigsLanes } from "./GigsLanes";
import { GigsProof, type ProofList } from "./GigsProof";
import { GigsReception } from "./GigsReception";
import { GigsWires } from "./GigsWires";
import { useBareKeys } from "./useBareKeys";
import { sendJson, useGigsData } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";
import "./gigs.css";

// The Gigs tab: real paid work found in the world, drafted by specialist agents, judged
// and SENT by the operator under their own account - kp never submits anywhere itself
// (docs/features/gigs/README.md).
//
// Built from the owner's combined verdict on the gigs-calm contest (2026-09-28): B/3 "The
// Proof" gives the front page (a headline built from the data, the lead proof, the index
// columns by next move, the whole file), the proof itself (a gig's full page), Reception
// (the scorecard) and Wires (the sources); B/2 "The Line" gives Lanes (niches by lifecycle
// stage) and the three figures that decide the day, which the owner asked to sit in THIS
// header: what waits on you, the first thing to do, how much is judged.
//
// Every section and the proof REPLACE the one before; the section's own state (the file's
// filter and page, the scroll) lives here, above them, so the way back from a proof lands
// where the operator left. Nothing is written to the URL: `?tab=` is an inbox the shell
// consumes. Behind the Agents flag (NEXT_PUBLIC_KP_AGENT_HIRING, tabs.ts), tagged
// "In development" on the surface.

const SECTIONS = ["front", "lanes", "reception", "wires"] as const;
type Section = (typeof SECTIONS)[number];

type Proof = ProofList & { gigId: string; from: Section };
type Flash = { tone: "info" | "critical"; text: string };

export function GigsTab() {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const data = useGigsData();
  const [section, setSection] = useState<Section>("front");
  const [proof, setProof] = useState<Proof | null>(null);
  const [file, setFile] = useState<FileFilter>(EMPTY_FILE);
  const [page, setPage] = useState(0);
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [scanning, setScanning] = useState(false);
  const [focusLane, setFocusLane] = useState<string | null>(null);
  const [hireArena, setHireArena] = useState<GigArena | null>(null);
  const [now, setNow] = useState(() => new Date());
  // The desk memory (ticks, seen marks, the note, when the review started) outlives a trip
  // back to the front page; one Map for the tab's life.
  const [store] = useState<DeskStore>(() => new Map());
  const rootRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const frontScroll = useRef<number | null>(null);
  const keysRef = useRef<HTMLDivElement | null>(null);

  // "Now" for deadlines and waits: refreshed each minute, not each render.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { gigs, attemptsByGig, specialists, kpi, sources, tallies } = data;
  const niches = useMemo(() => foldNiches(specialists ?? []), [specialists]);
  const nicheMap = useMemo(() => nicheBySpecialistMap(niches), [niches]);
  const queue = useMemo(() => urgencyQueue(gigs ?? [], attemptsByGig, now), [gigs, attemptsByGig, now]);
  const columns = useMemo(() => frontColumns(gigs ?? [], attemptsByGig, now), [gigs, attemptsByGig, now]);
  const counts = waitCounts(columns);
  const overall = kpi ? overallCell(kpi) : null;

  /** The page scroller this tab sits in (the workspace scrolls a panel, not the window). */
  const scroller = useCallback((): HTMLElement | null => {
    for (let n = rootRef.current?.parentElement ?? null; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
    }
    return (document.scrollingElement as HTMLElement | null) ?? null;
  }, []);
  const toTop = useCallback(() => {
    const s = scroller();
    if (s) s.scrollTop = Math.max(0, (rootRef.current?.offsetTop ?? 0) - 16);
  }, [scroller]);

  const goSection = useCallback(
    (s: Section) => {
      setProof(null);
      setFlash(null);
      setSection(s);
      if (s !== "lanes") {
        setFocusLane(null);
        setHireArena(null);
      }
      window.requestAnimationFrame(toTop);
    },
    [toTop]
  );
  const { tablistProps, tabProps } = useTablist({ ids: SECTIONS, active: section, onSelect: goSection, controlsPanel: false });

  const openProof = useCallback(
    (gigId: string, list: ProofList) => {
      if (!proof && section === "front") frontScroll.current = scroller()?.scrollTop ?? null;
      setFlash(null);
      setLastOpened(gigId);
      setProof({ ...list, gigId, from: proof?.from ?? section });
      window.requestAnimationFrame(toTop);
    },
    [proof, section, scroller, toTop]
  );
  const closeProof = useCallback(() => {
    const from = proof?.from ?? "front";
    setProof(null);
    setSection(from);
    // Back where the operator left the front page; the row they opened stays marked.
    window.requestAnimationFrame(() => {
      const s = scroller();
      if (from === "front" && s && frontScroll.current !== null) s.scrollTop = frontScroll.current;
    });
  }, [proof, scroller]);

  const openNext = useCallback(() => {
    const next = nextInQueue(queue, lastOpened);
    if (next) openProof(next.id, { ids: queue.map((g) => g.id), label: t("head.waitList") });
    else setFlash({ tone: "info", text: t("head.nothingWaits") });
  }, [queue, lastOpened, openProof, t]);

  /** Lanes → the whole file, filtered to one lane and stage. An empty lane string is
   *  "every lane" (the exit row). */
  const openCell = useCallback(
    (lane: string, status: FileStatus) => {
      setFile({ ...EMPTY_FILE, lane: lane === "" ? null : lane, status });
      setPage(0);
      goSection("front");
      window.requestAnimationFrame(() => document.getElementById("gd-file")?.scrollIntoView({ block: "start" }));
    },
    [goSection]
  );
  const openLane = useCallback(
    (lane: string | null, arena: GigArena | null) => {
      setFocusLane(lane);
      setHireArena(arena);
      goSection("lanes");
    },
    [goSection]
  );

  // The tab's own keys: `/` finds (from any section), `N` opens the next thing that waits,
  // `?` lists the keys. A proof adds its own (←/→, Esc, D, 1-6) in GigsProof.
  useBareKeys((key) => {
    if (key === "/") {
      if (proof || section !== "front") goSection("front");
      window.requestAnimationFrame(() => {
        document.getElementById("gd-file")?.scrollIntoView({ block: "start" });
        searchRef.current?.focus();
        searchRef.current?.select();
      });
      return true;
    }
    if (key === "n" && !proof) {
      openNext();
      return true;
    }
    if (key === "?") {
      const el = keysRef.current as (HTMLDivElement & { togglePopover?: () => void }) | null;
      el?.togglePopover?.();
      return true;
    }
    return false;
  });

  const refreshAll = useCallback(async () => {
    await data.reloadAll();
    setNow(new Date());
  }, [data]);

  async function scan() {
    setScanning(true);
    setFlash(null);
    const res = await sendJson("/api/gigs/scan", "POST", {});
    setScanning(false);
    setFlash(res.ok ? { tone: "info", text: t("scan.started") } : { tone: "critical", text: resolveError(res.body as ApiErrorPayload | null, t("scan.failed")) });
  }

  const afterWrite = useCallback(
    async (message?: string | null) => {
      const next = await data.reloadWork();
      setNow(new Date());
      if (message) setFlash({ tone: "info", text: message });
      return next;
    },
    [data]
  );

  const loaded = gigs !== null && sources !== null && specialists !== null;
  const loadError = data.failure ? resolveError(data.failure as ApiErrorPayload, t("loadFailed")) : null;
  const first = queue[0] ?? null;
  const firstDeadline = first ? deadlineView(first.deadlineAt, now) : null;
  const rate = rateView(overall);
  const judged = overall ? overall.resolved + overall.pending : 0;

  const sectionCount: Record<Section, string> = {
    front: String(counts.total),
    lanes: String(niches.length),
    reception: rate.measured && rate.percent !== null ? fmt.percent(rate.percent) : "—",
    wires: String(sources?.length ?? 0),
  };

  return (
    <section ref={rootRef} className="gd">
      <header className="gd-head">
        <div className="gd-title">
          <span className="eyebrow">{t("eyebrow")}</span>
          <div className="name">
            <h1>{t("title")}</h1>
            <span className="devtag">
              <FlaskConical size={13} aria-hidden /> {t("inDevelopment")}
            </span>
          </div>
        </div>

        <div className="strip" aria-label={t("head.stripLabel")} role="group">
          <div>
            <span className={`fig-n${counts.total ? " needs" : ""}`}>{counts.total}</span>
            <span className="fig-l">
              <b>{t("head.waitOnYou", { count: counts.total })}</b>
              <br />
              {t("head.waitParts", { clear: counts.clear, review: counts.review, send: counts.send })}
              {counts.record ? ` · ${t("head.toRecord", { count: counts.record })}` : null}
            </span>
          </div>
          {first ? (
            <div>
              <button type="button" className="firstbtn" onClick={() => openProof(first.id, { ids: queue.map((g) => g.id), label: t("head.waitList") })}>
                <i className="mk you" aria-hidden />
                <span className="min-w-0">
                  <span className="fig-l">{t("head.first")}</span>
                  <span className="t">{first.title}</span>
                  <span className="s">
                    {firstDeadline?.state === "soon" || firstDeadline?.state === "open"
                      ? t("head.daysLeft", { days: Math.max(0, firstDeadline.days) })
                      : t("head.noDeadline")}
                    {" · "}
                    {t(`head.move.${first.status === "in_review" ? "send" : first.status === "drafted" ? "review" : first.status === "suspect" ? "clear" : "record"}`)}
                  </span>
                </span>
              </button>
            </div>
          ) : null}
          <div>
            <button type="button" className="firstbtn" onClick={() => goSection("reception")} aria-label={t("head.judgedAria", { resolved: overall?.resolved ?? 0, sent: judged })}>
              <span className={`hollow${rate.measured ? " measured" : ""}`} aria-hidden>
                {rate.measured && rate.percent !== null ? rate.percent : "—"}
              </span>
              <span className="fig-l">
                <b>{t("head.judged", { resolved: overall?.resolved ?? 0, sent: judged })}</b>
                {overall && overall.pending ? ` · ${t("rate.pending", { count: overall.pending })}` : null}
                <br />
                {rate.measured && rate.percent !== null
                  ? t("head.rateMeasured", { percent: fmt.percent(rate.percent), small: rate.small ? "yes" : "no" })
                  : t("head.rateUnmeasured")}
              </span>
            </button>
          </div>
        </div>

        <div className="tools">
          <Tooltip label={t("refresh")}>
            <button type="button" className="btn iconbtn" aria-label={t("refresh")} onClick={() => void refreshAll()}>
              <RefreshCw size={16} aria-hidden />
            </button>
          </Tooltip>
          <button type="button" className="btn primary" disabled={scanning} onClick={() => void scan()}>
            <Radar size={16} aria-hidden /> {t("scan.button")}
          </button>
          <Tooltip label={t("keys.title")}>
            <button type="button" className="btn iconbtn" aria-label={t("keys.title")} popoverTarget="gd-keys">
              <Keyboard size={16} aria-hidden />
            </button>
          </Tooltip>
          <div id="gd-keys" ref={keysRef} popover="auto" className="pop">
            <h3 className="t-h3">{t("keys.title")}</h3>
            <dl className="keys">
              <dt>
                <kbd>N</kbd>
              </dt>
              <dd>{t("keys.next")}</dd>
              <dt>
                <kbd>/</kbd>
              </dt>
              <dd>{t("keys.find")}</dd>
              <dt>
                <kbd>←</kbd> <kbd>→</kbd>
              </dt>
              <dd>{t("keys.step")}</dd>
              <dt>
                <kbd>{t("detail.escKey")}</kbd>
              </dt>
              <dd>{t("keys.back")}</dd>
              <dt>
                <kbd>D</kbd>
              </dt>
              <dd>{t("keys.decline")}</dd>
              <dt>
                <kbd>1</kbd>–<kbd>6</kbd>
              </dt>
              <dd>{t("keys.checklist")}</dd>
              <dt>
                <kbd>?</kbd>
              </dt>
              <dd>{t("keys.help")}</dd>
            </dl>
          </div>
        </div>
      </header>

      <nav className="sections" aria-label={t("nav.label")} {...tablistProps}>
        {SECTIONS.map((s) => (
          <button key={s} type="button" {...tabProps(s)} className={s === "front" && counts.total ? "needs" : undefined}>
            {t(`nav.${s}`)} <b>{sectionCount[s]}</b>
          </button>
        ))}
      </nav>

      {flash ? (
        <div role={flash.tone === "critical" ? "alert" : "status"} className={`flash${flash.tone === "critical" ? " critical" : ""}`}>
          <span>{flash.text}</span>
          <button type="button" className="btn ghost iconbtn quiet" aria-label={t("detail.dismiss")} onClick={() => setFlash(null)}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}

      {loadError ? (
        <div className="flash critical" role="alert">
          <span>{loadError}</span>
          <button type="button" className="btn quiet" onClick={() => void refreshAll()}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!loaded ? (
        loadError ? null : <LoadingGap className="min-h-[24rem]" label={t("loading")} />
      ) : proof ? (
        <GigsProof
          key={`${proof.gigId}:${attemptsByGig[proof.gigId]?.id ?? ""}`}
          gigId={proof.gigId}
          list={proof}
          gigs={gigs}
          attemptsByGig={attemptsByGig}
          sources={sources}
          specialists={specialists}
          niches={niches}
          kpi={kpi}
          now={now}
          store={store}
          onStep={(id) => {
            setLastOpened(id);
            setProof((p) => (p ? { ...p, gigId: id } : p));
            window.requestAnimationFrame(toTop);
          }}
          onBack={closeProof}
          onLeft={(nextId, message) => {
            if (nextId) {
              setLastOpened(nextId);
              setProof((p) => (p ? { ...p, gigId: nextId } : p));
              window.requestAnimationFrame(toTop);
            } else closeProof();
            setFlash({ tone: "info", text: message });
          }}
          onChanged={afterWrite}
          onFlash={(text) => setFlash({ tone: "info", text })}
          onOpenLane={openLane}
        />
      ) : section === "front" && gigs.length === 0 ? (
        <div className="stamp-wrap">
          <div className="stamp calm" role="note">
            <span className="s1">{t("empty.title")}</span>
            <span className="s2">{sources.length === 0 ? t("empty.noSources") : t("empty.noGigs")}</span>
          </div>
          <button type="button" className="btn" onClick={() => goSection("wires")}>
            {t("empty.toSources")}
          </button>
        </div>
      ) : section === "front" ? (
        <GigsFront
          gigs={gigs}
          attemptsByGig={attemptsByGig}
          sources={sources}
          columns={columns}
          queue={queue}
          nicheMap={nicheMap}
          niches={niches}
          truncated={data.truncated}
          now={now}
          filter={file}
          onFilter={(f) => {
            setFile(f);
            setPage(0);
          }}
          page={page}
          onPage={setPage}
          searchRef={searchRef}
          lastOpened={lastOpened}
          onOpen={openProof}
          onToWires={() => goSection("wires")}
        />
      ) : section === "lanes" ? (
        <GigsLanes
          gigs={gigs}
          attemptsByGig={attemptsByGig}
          specialists={specialists}
          tallies={tallies}
          kpi={kpi}
          focusLane={focusLane}
          hireArena={hireArena}
          onOpenCell={openCell}
          onHired={data.reloadSpecialists}
        />
      ) : section === "reception" ? (
        <GigsReception gigs={gigs} attemptsByGig={attemptsByGig} specialists={specialists} tallies={tallies} kpi={kpi} onOpenGig={(id, ids, label) => openProof(id, { ids, label })} />
      ) : (
        <GigsWires
          sources={sources}
          catalog={data.catalog ?? []}
          gigs={gigs}
          onChanged={data.reloadSources}
          onScanned={async () => {
            await Promise.all([data.reloadSources(), data.reloadWork()]);
            setNow(new Date());
          }}
        />
      )}
    </section>
  );
}
