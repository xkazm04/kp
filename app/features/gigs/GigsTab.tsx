"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { gigTypeOf } from "@/app/_lib/gigs/gig-type";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { sendJson, useGigsData } from "./data/useGigsData";
import { useGigsFormat } from "./data/useGigsFormat";
import { GigsFront } from "./front/GigsFront";
import { GigsLanes } from "./lanes/GigsLanes";
import { frontColumns, urgencyQueue, waitCounts } from "./logic/front";
import { foldNiches, nicheBySpecialistMap } from "./logic/niches";
import { overallCell, rateView } from "./logic/rate";
import { GigsProof } from "./proof/GigsProof";
import type { DeskStore } from "./proof/signoff/GigsSignoff";
import { GigsReception } from "./reception/GigsReception";
import { GigsHeader } from "./tab/GigsHeader";
import { EmptyFront, TabNotices } from "./tab/TabNotices";
import { SECTIONS, useGigsNav, type Section } from "./tab/useGigsNav";
import { GigsWires } from "./wires/GigsWires";
// One stylesheet per surface, imported in the original cascade order (later files override earlier ones).
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/parts.css";
import "./styles/front.css";
import "./styles/proof.css";
import "./styles/panels.css";
import "./styles/records.css";
import "./styles/plans.css";
import "./styles/report.css";
import "./styles/lanes.css";
import "./styles/reception.css";
import "./styles/wires.css";
import "./styles/themes.css";

// The Gigs tab: real paid work found in the world, drafted by specialist agents, judged
// and SENT by the operator under their own account - kp never submits anywhere itself
// (docs/features/gigs/README.md).
// Built from the owner's combined verdict on the gigs-calm contest (2026-09-28): B/3 "The
// Proof" gives the front page (front/), the proof (proof/: a gig's full page), Reception
// (reception/) and Wires (wires/); B/2 "The Line" gives Lanes (lanes/: gig types by stage)
// and the three figures that decide the day, in THIS header (tab/GigsHeader.tsx).
//
// Every section and the proof REPLACE the one before; where the operator is lives in
// tab/useGigsNav.ts, above them, so the way back from a proof lands where they left. Behind
// the Agents flag (NEXT_PUBLIC_KP_AGENT_HIRING, tabs.ts), tagged "In development" on the
// surface. The pure derivations are logic/, the reads and writes data/.

export function GigsTab() {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const data = useGigsData();
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // The desk memory (ticks, seen marks, the note, when the review started) outlives a trip
  // back to the front page; one Map for the tab's life.
  const [store] = useState<DeskStore>(() => new Map());

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
  const { section, proof, file, page, lastOpened, flash, focusLane, rootRef, searchRef, keysRef, tablistProps, tabProps, ...go } = useGigsNav(queue);
  const { setFlash, goSection, openProof } = go;

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
    [data, setFlash]
  );

  const loaded = gigs !== null && sources !== null && specialists !== null;
  const loadError = data.failure ? resolveError(data.failure as ApiErrorPayload, t("loadFailed")) : null;
  const first = queue[0] ?? null;
  const rate = rateView(overall);
  const sectionCount: Record<Section, string> = {
    front: String(counts.total),
    lanes: String(new Set((gigs ?? []).map(gigTypeOf)).size),
    reception: rate.measured && rate.percent !== null ? fmt.percent(rate.percent) : "—",
    wires: String(sources?.length ?? 0),
  };

  return (
    <section ref={rootRef} className="gd">
      <GigsHeader
        counts={counts}
        first={first}
        overall={overall}
        now={now}
        scanning={scanning}
        keysRef={keysRef}
        onFirst={() => first && openProof(first.id, go.waitList())}
        onReception={() => goSection("reception")}
        onRefresh={() => void refreshAll()}
        onScan={() => void scan()}
      />

      <nav className="sections" aria-label={t("nav.label")} {...tablistProps}>
        {SECTIONS.map((s) => (
          <button key={s} type="button" {...tabProps(s)} className={s === "front" && counts.total ? "needs" : undefined}>
            {t(`nav.${s}`)} <b>{sectionCount[s]}</b>
          </button>
        ))}
      </nav>

      <TabNotices flash={flash} loadError={loadError} onDismiss={() => setFlash(null)} onRetry={() => void refreshAll()} />

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
          onStep={go.stepProof}
          onBack={go.closeProof}
          onLeft={go.leaveProof}
          onChanged={afterWrite}
          onFlash={(text) => setFlash({ tone: "info", text })}
          onOpenLane={go.openLane}
        />
      ) : section === "front" && gigs.length === 0 ? (
        <EmptyFront noSources={sources.length === 0} onToWires={() => goSection("wires")} />
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
          onFilter={go.filterFile}
          page={page}
          onPage={go.setPage}
          searchRef={searchRef}
          lastOpened={lastOpened}
          onOpen={openProof}
          onToWires={() => goSection("wires")}
          onChanged={afterWrite}
        />
      ) : section === "lanes" ? (
        <GigsLanes gigs={gigs} attemptsByGig={attemptsByGig} specialists={specialists} tallies={tallies} focusLane={focusLane} onOpenCell={go.openCell} />
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
