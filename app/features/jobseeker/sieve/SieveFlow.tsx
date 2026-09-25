"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { JobseekerDialog, JobseekerProfile, JobseekerSource } from "@/app/_lib/jobseeker/types";
import { CvStudio, type StudioDegradation } from "../CvStudio";
import { EnableEuresButton } from "../EnableEuresButton";
import { FailureNotice } from "../FailureNotice";
import { renderedAnchor, type FeedTuple } from "../feedModel";
import { recallDraftSource, type DraftSource } from "../importOutcome";
import { sourceDisplayLabel, type CatalogEntryView } from "../sourcesApi";
import { useScanTask } from "../useScanTask";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "../apiFailure";
import { ScanDoor } from "./ScanDoor";
import { SieveFrame, type RailStep } from "./SieveFrame";
import { deriveSieve, initialsOf, provenanceOf, sourceIsOn } from "./sieveModel";
import { StepArrive } from "./StepArrive";
import { StepEvening } from "./StepEvening";
import { StepSieve } from "./StepSieve";
import { StepSources } from "./StepSources";
import { StepWant } from "./StepWant";
import { StepWeigh } from "./StepWeigh";
import { StepYou } from "./StepYou";
import { useSieveData } from "./useSieveData";

// /me — THE SIEVE, the job seeker's whole flow on one scrolling page
// (docs/features/jobseeker/README.md, "The flow"; the contest winner me-seeker-flow A/2).
//
//   1 Arrive   the CV goes in              5 The sieve     every posting as a dot, poured
//   2 Your CV  the CV, lit and read        6 Worth your    the ranking: skyline, top
//   3 You      the person read out of it     evening       five, the whole list
//   4 What you five answers, tapped        7 Weigh         one posting, and the decision
//     want                                  8 Sources       where the postings come from
//
// The rail is the wayfinding: every step on one line with its live count and a bar that
// narrows as the sieve works. Every number on the page is RE-DERIVED from the rows
// (sieveModel.ts), so a decision moves the rail, the sieve and the ranking together.

export type SieveInitial = {
  profile: JobseekerProfile | null;
  sources: JobseekerSource[];
  catalog: CatalogEntryView[];
  lastScanAt: string | null;
  openId: string | null;
};

const STEP_IDS = ["arrive", "cv", "want", "sieve", "evening", "weigh", "sources"] as const;
const noSubscription = () => () => undefined;

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
      mq?.addEventListener?.("change", cb);
      return () => mq?.removeEventListener?.("change", cb);
    },
    () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

export function SieveFlow({ initial }: { initial: SieveInitial }) {
  const t = useTranslations("me.sieve");
  const tCv = useTranslations("me.cv");
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const data = useSieveData(initial);
  const { profile, rows, sources, catalog } = data;
  const [lastScanAt, setLastScanAt] = useState<string | null>(initial.lastScanAt);
  const [openId, setOpenId] = useState<string | null>(initial.openId);
  const [order, setOrder] = useState<string[]>([]);
  const [active, setActive] = useState<string>("arrive");
  const [toast, setToast] = useState<string | null>(null);
  const [importedSource, setImportedSource] = useState<{ id: string; source: DraftSource } | null>(null);
  const [studio, setStudio] = useState<{ dialog: JobseekerDialog; degradation: StudioDegradation | null } | null>(null);
  const [opening, setOpening] = useState(false);
  const [studioError, setStudioError] = useState<ClassifiedFailure | null>(null);
  const toastTimer = useRef<number | null>(null);

  const storedSource = useSyncExternalStore(noSubscription, () => (profile ? recallDraftSource(profile.id) : null), () => null);
  const draftSource: DraftSource = importedSource && profile && importedSource.id === profile.id ? importedSource.source : storedSource;

  const facts = useMemo(() => (rows ? deriveSieve(rows, sources) : null), [rows, sources]);
  const sourcesOn = sources.filter((s) => sourceIsOn(s)).length;
  const postingCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.sourceId, (m.get(r.sourceId) ?? 0) + 1);
    return m;
  }, [rows]);
  const sourceLabel = useCallback(
    (id: string) => {
      const s = sources.find((x) => x.id === id);
      return s ? sourceDisplayLabel(catalog, s, { short: true }) : id;
    },
    [sources, catalog]
  );

  const say = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const scan = useScanTask((summary) => {
    if (summary) setLastScanAt(summary.finishedAt);
    void data.reloadRows();
    void data.reloadSources();
    say(summary ? t("toast.scanned", { n: summary.matched }) : t("toast.scanEnded"));
  });

  // Where the reader is: the section crossing the band a little above the middle. The
  // observer re-attaches when a step swaps between its empty and its full markup.
  const hasProfile = profile !== null;
  const hasRows = rows !== null;
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive((e.target as HTMLElement).dataset.step ?? "arrive");
      },
      { rootMargin: "-38% 0px -58% 0px" }
    );
    for (const id of STEP_IDS) {
      const el = document.getElementById(`s-${id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [hasProfile, hasRows]);

  // A deep link (?open=) lands on the Weigh step once the page has painted.
  useEffect(() => {
    if (initial.openId) document.getElementById("s-weigh")?.scrollIntoView({ block: "start" });
  }, [initial.openId]);

  const open = useCallback(
    (id: string) => {
      setOpenId(id);
      window.setTimeout(() => document.getElementById("s-weigh")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }), 0);
    },
    [reduceMotion]
  );

  // ── the last-seen anchor (docs/features/jobseeker/README.md, "New since your last
  // visit"): advanced only from rows actually rendered and settled, on departure and on
  // the explicit acknowledgement; the store refuses to move it backwards.
  const seenAnchor = useRef<FeedTuple | null>(null);
  useEffect(() => {
    if (facts && facts.scored.length > 0 && !data.rowsError) seenAnchor.current = renderedAnchor(facts.scored);
  }, [facts, data.rowsError]);
  const sendSeen = useCallback((tuple: FeedTuple | null) => {
    if (!tuple) return;
    const body = JSON.stringify({ at: tuple.at, id: tuple.id });
    try {
      if (navigator.sendBeacon?.("/api/jobseeker/profile/seen", new Blob([body], { type: "application/json" }))) return;
    } catch {
      /* best-effort: the anchor is a convenience, never the request the reader is making */
    }
    void fetch("/api/jobseeker/profile/seen", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") sendSeen(seenAnchor.current);
    };
    const onPageHide = () => sendSeen(seenAnchor.current);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [sendSeen]);
  const [seenNow, setSeenNow] = useState(false);
  const markSeen = useCallback(() => {
    sendSeen(seenAnchor.current);
    setSeenNow(true);
  }, [sendSeen]);

  // ── the CV studio (the polish conversation), an overlay over the flow.
  const openStudio = useCallback(async () => {
    if (!profile || opening) return;
    setOpening(true);
    setStudioError(null);
    try {
      const list = await fetch(`/api/jobseeker/dialogs?profileId=${encodeURIComponent(profile.id)}`);
      const listed = (await list.json().catch(() => null)) as { dialogs?: JobseekerDialog[] } | null;
      const existing = (listed?.dialogs ?? []).find((d) => d.kind === "cv_polish" && d.status === "open");
      if (existing) {
        setStudio({ dialog: existing, degradation: null });
        return;
      }
      const res = await fetch("/api/jobseeker/dialogs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "cv_polish", lang: locale }) });
      const body = (await res.json().catch(() => null)) as { dialog?: JobseekerDialog; fallbackReason?: string | null; fallbackLang?: string | null; code?: string } | null;
      if (!res.ok || !body?.dialog) {
        setStudioError(classifyApiFailure(res, body));
        return;
      }
      setStudio({ dialog: body.dialog, degradation: body.fallbackReason ? { reason: body.fallbackReason, lang: body.fallbackLang ?? null } : null });
    } catch {
      setStudioError(TRANSPORT_FAILURE);
    } finally {
      setOpening(false);
    }
  }, [profile, opening, locale]);

  // ── the rail
  const first = profile?.profile.displayName?.trim().split(/\s+/)[0] ?? null;
  const cvArtifact = data.cvDialog?.artifact && "cvMarkdown" in data.cvDialog.artifact ? data.cvDialog.artifact : null;
  const prefs = profile?.preferences;
  const wantsSet = prefs ? [prefs.locations.length + prefs.countries.length > 0, !!prefs.salaryFloor, prefs.targetTitles.length > 0, prefs.workModes.length > 0, !!prefs.seniority].filter(Boolean).length : 0;
  const found = facts?.all.length ?? 0;
  // The SAME rule the tiles draw with (provenanceOf), so the rail and the legend agree.
  const stated = (profile?.profile.skillClaims ?? []).filter((c) => provenanceOf(c.provenance).stated).length;
  const steps: RailStep[] = [
    { id: "arrive", anchor: "s-arrive", label: t("rail.arrive"), count: profile ? t("rail.arriveIn", { name: first ?? t("rail.you") }) : t("rail.arriveOut"), state: profile ? "done" : "reached" },
    {
      id: "cv",
      anchor: "s-cv",
      label: t("rail.cv"),
      count: profile ? (cvArtifact ? (cvArtifact.unreadable.length ? t("rail.cvUnread", { n: cvArtifact.unreadable.length }) : t("rail.cvClean")) : t("rail.cvRead")) : t("rail.notReached"),
      state: profile ? "done" : "gap",
    },
    {
      id: "you",
      anchor: "s-you",
      label: t("rail.you"),
      count: profile ? t("rail.youCount", { n: (profile.profile.skillClaims ?? []).length, stated }) : t("rail.notReached"),
      state: profile ? "done" : "gap",
    },
    { id: "want", anchor: "s-want", label: t("rail.want"), count: profile ? t("rail.wantCount", { set: wantsSet }) : t("rail.notReached"), state: profile ? (wantsSet === 5 ? "done" : "reached") : "gap" },
    {
      id: "sieve",
      anchor: "s-sieve",
      label: t("rail.sieve"),
      count: !profile ? t("rail.notReached") : !facts ? (data.rowsError ? t("rail.loadFailed") : t("rail.loading")) : found ? t("rail.sieveCount", { found, through: facts.scored.length, held: facts.held.length }) : t("rail.sieveEmpty"),
      state: !profile ? "gap" : found ? "done" : "reached",
      bar: facts && found ? { tone: "b-pass", value: facts.scored.length / found } : null,
      emptyBar: !facts || !found,
    },
    {
      id: "evening",
      anchor: "s-evening",
      label: t("rail.evening"),
      count:
        !facts || !facts.scored.length
          ? t("rail.notReached")
          : facts.strong + facts.promising
            ? t("rail.eveningCount", { strong: facts.strong, promising: facts.promising })
            : t("rail.eveningPartial", { score: facts.open[0]?.matchTotal ?? 0 }),
      state: facts && facts.scored.length ? "done" : "gap",
      bar: facts && found ? { tone: "b-worth", value: Math.max(facts.strong + facts.promising, facts.top5.length) / found } : null,
      emptyBar: !facts || !found,
    },
    {
      id: "weigh",
      anchor: "s-weigh",
      label: t("rail.weigh"),
      count: facts && profile ? t("rail.weighCount", { open: openId ? 1 : 0, decided: facts.decided }) : t("rail.notReached"),
      state: openId ? "done" : facts && facts.decided ? "reached" : "gap",
      bar: facts && found ? { tone: "b-dec", value: facts.decided / found } : null,
      emptyBar: !facts || !found,
    },
    { id: "sources", anchor: "s-sources", label: t("rail.sources"), count: t("rail.sourcesCount", { on: sourcesOn, held: facts?.held.length ?? 0 }), state: sourcesOn ? "done" : "reached" },
  ];
  const railActive = active === "cv" ? "cv" : active;

  const tally = facts && profile ? (
    <>
      <span>{t.rich("tally.found", { n: found, b: (c) => <b>{c}</b> })}</span>
      <span>{t.rich("tally.through", { n: facts.scored.length, b: (c) => <b>{c}</b> })}</span>
      <span>{t.rich("tally.decided", { n: facts.decided, b: (c) => <b>{c}</b> })}</span>
    </>
  ) : profile ? null : (
    <span>{t("tally.noCv")}</span>
  );

  const scanDoor = <ScanDoor scan={scan} small />;
  const openRow = openId ? rows?.find((x) => x.id === openId) ?? null : null;
  const loadError = data.rowsError ? <FailureNotice failure={data.rowsError} fallback={t("loadError")} onRetry={() => void data.reloadRows()} /> : null;

  return (
    <SieveFrame
      who={profile ? { name: profile.profile.displayName?.trim() || t("rail.you"), initials: initialsOf(profile.profile.displayName) } : null}
      tally={tally}
      steps={steps}
      active={railActive}
      note={facts && found ? t.rich("rail.note", { found, through: facts.scored.length, worth: facts.strong + facts.promising, decided: facts.decided, b: (c) => <b>{c}</b> }) : null}
    >
      <StepArrive
        profile={profile}
        sourcesOn={sourcesOn}
        onSaved={(p, source) => {
          setImportedSource({ id: p.id, source });
          data.setProfile(p);
          void data.reloadRows();
          window.setTimeout(() => document.getElementById("s-cv")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }), 60);
        }}
      />
      <StepYou profile={profile} draftSource={draftSource} cvDialog={data.cvDialog} postingsWaiting={found} polishing={opening} onPolish={() => void openStudio()} reduceMotion={reduceMotion} />
      {studioError ? (
        <div className="frame-main">
          <FailureNotice failure={studioError} fallback={tCv("createError")} onRetry={() => void openStudio()} retrying={opening} onDismiss={() => setStudioError(null)} />
        </div>
      ) : null}
      <StepWant profile={profile} locale={locale} onSaved={data.setProfile} scanDoor={scanDoor} reduceMotion={reduceMotion} />
      <StepSieve
        facts={facts}
        hasProfile={!!profile}
        loading={!rows && !data.rowsError}
        sourceLabel={sourceLabel}
        sourcesOn={sourcesOn}
        lastScanAt={lastScanAt}
        emptyDoor={
          <EnableEuresButton
            countries={profile?.preferences.countries ?? []}
            scan={scan}
            onProfileSaved={data.setProfile}
            onEnabled={() => {
              void data.reloadSources();
              void data.reloadRows();
            }}
          />
        }
        scanDoor={scanDoor}
        loadError={loadError}
        onOpen={open}
        reduceMotion={reduceMotion}
      />
      <StepEvening
        facts={facts}
        hasProfile={!!profile}
        loading={!rows}
        locale={locale}
        openId={openId}
        guidedId={null}
        newSince={seenNow ? null : data.newSince}
        onMarkSeen={markSeen}
        onOpen={open}
        onOrderChange={setOrder}
        loadError={loadError}
        targetTitles={prefs?.targetTitles.length ?? 0}
      />
      <StepWeigh
        openId={openId}
        row={openRow}
        rank={openId && facts ? facts.rank[openId] ?? null : null}
        total={facts?.scored.length ?? 0}
        order={order}
        profileId={profile?.id ?? null}
        salaryFloor={profile?.preferences.salaryFloor ?? null}
        locale={locale}
        navActive={active === "weigh" || active === "evening"}
        decideActive={active === "weigh"}
        onOpen={open}
        onRowUpdate={data.replaceRow}
        onToast={say}
        suggestions={facts?.top5 ?? []}
      />
      <StepSources catalog={catalog} sources={sources} postingCounts={postingCounts} hasProfile={!!profile} onSourcesChange={data.setSources} onToast={say} />
      <footer className="foot">{t("foot")}</footer>
      <div className={toast ? "toast show" : "toast"} role="status" aria-live="polite">
        {toast}
      </div>
      {studio && profile ? (
        <CvStudio
          dialog={studio.dialog}
          profile={profile}
          initialDegradation={studio.degradation}
          onDialogChange={(dialog) => setStudio((s) => (s ? { ...s, dialog } : s))}
          onProfileChange={(p) => {
            data.setProfile(p);
            void data.reloadDialogs();
          }}
          onClose={() => {
            setStudio(null);
            void data.reloadDialogs();
          }}
        />
      ) : null}
    </SieveFrame>
  );
}
