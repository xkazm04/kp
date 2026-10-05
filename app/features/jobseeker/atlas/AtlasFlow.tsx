"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { KeyHints, LevelFrame, LevelTransition, LevelTrail, layerModeAt, type Crumb, type LevelTone } from "@/app/_components/kit/scene";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { JobseekerDialog, JobseekerProfile, KoReasonKey } from "@/app/_lib/jobseeker/types";
import { RailPreferences } from "@/app/features/shell/nav/NavRailPreferences";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "../apiFailure";
import { CvStudio, type StudioDegradation } from "../CvStudio";
import { EnableEuresButton } from "../EnableEuresButton";
import { FailureNotice } from "../FailureNotice";
import { renderedAnchor, type FeedTuple } from "../feedModel";
import { recallDraftSource, type DraftSource } from "../importOutcome";
import { sourceDisplayLabel } from "../sourcesApi";
import { useScanTask } from "../useScanTask";
import { ViewSwitch } from "../ViewSwitch";
import { EraseMeDoor } from "../sieve/EraseMeDoor";
import { MarketMix } from "../sieve/MarketMix";
import { ScanDoor } from "../sieve/ScanDoor";
import type { SieveInitial } from "../sieve/SieveFlow";
import { deriveSieve, initialsOf, sourceIsOn } from "../sieve/sieveModel";
import { StepArrive } from "../sieve/StepArrive";
import { StepEvening } from "../sieve/StepEvening";
import { StepSieve } from "../sieve/StepSieve";
import { StepSources } from "../sieve/StepSources";
import { StepWant } from "../sieve/StepWant";
import { StepWeigh } from "../sieve/StepWeigh";
import { StepYou } from "../sieve/StepYou";
import { useGithubEvidence, useRoleResearch } from "../sieve/useSeekerEvidence";
import { useSieveData } from "../sieve/useSieveData";
import { AtlasSide } from "./AtlasSide";
import { AtlasSky, type Headline, type Pointed, type PointSource } from "./AtlasSky";
import { lockOf, rimLayout, skyLayout, wantsSet, WANT_KEYS, type WantKey } from "./atlasModel";
import { arrivalStack, depthOf, isSetupLens, layerKey, topOf, type AtlasEntry, type AtlasStack, type Lens } from "./atlasNav";
import { AT_ROOT } from "./atlasRecipes";
import { useAtlasKeys } from "./useAtlasKeys";
import { useAtlasNav } from "./useAtlasNav";
import "../sieve/sieve.css";
import "./atlas.css";

// /me/atlas — THE SKY ATLAS, the job seeker's flow as a hub with levels instead of one long
// page (docs/features/jobseeker/README.md, "The Sky Atlas"; the contest winner me-hub A/3).
//
// It is a SECOND VIEW of the same search, beside the Sieve (/me): the same rows, the same
// profile, the same decisions through the same API. Nothing here re-implements a behaviour:
// every level mounts the Sieve's own step (import, the CV read, the six wants, the sieve,
// worth your evening, weigh, sources) and only the composition around them is new.
//
//   L0  the sky: every posting a mark, the dome that keeps the market shut until a CV and the
//       five wants are set, the top five, four lenses, setup folded to a strip once ready
//   L1  a lens: Your CV · What it reads as · What you want · The sieve · Worth your evening · Sources
//   L2  one posting, weighed
//
// Everything on the page is re-derived from the rows (sieveModel.deriveSieve, atlasModel), so a
// decision or a saved want moves the sky, the top five and the gate together.

const noSubscription = () => () => undefined;

const ANCHOR_LENS: Record<string, Lens | undefined> = { arrive: "cv", cv: "read", you: "read", want: "want", sieve: "sieve", evening: "evening", sources: "sources" };
const LENS_TONE: Record<Lens, LevelTone> = { cv: "coral", read: "coral", want: "coral", sieve: "steel", evening: "amber", sources: "stone" };

export function AtlasFlow({ initial }: { initial: SieveInitial }) {
  const t = useTranslations("me.atlas");
  const tSieve = useTranslations("me.sieve");
  const tCv = useTranslations("me.cv");
  const tGate = useTranslations("me.sieve.gate.label");
  const locale = useLocale();
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const data = useSieveData(initial);
  const research = useRoleResearch(data.profile, locale);
  const github = useGithubEvidence(data.profile?.id ?? null);
  const { profile, rows, sources, catalog } = data;

  const set = useMemo(() => wantsSet(profile?.preferences ?? null), [profile]);
  const lock = useMemo(() => lockOf(!!profile, set), [profile, set]);
  const facts = useMemo(() => (rows ? deriveSieve(rows, sources) : null), [rows, sources]);
  const layout = useMemo(() => (rows && facts ? skyLayout(rows, facts.scored) : null), [rows, facts]);
  const rim = useMemo(() => (facts ? rimLayout(facts) : null), [facts]);
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
    [sources, catalog],
  );
  const gateLabel = useCallback((k: KoReasonKey) => tGate(k), [tGate]);

  const [lastScanAt, setLastScanAt] = useState<string | null>(initial.lastScanAt);
  const [order, setOrder] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [lockNote, setLockNote] = useState<string | null>(null);
  const [importedSource, setImportedSource] = useState<{ id: string; source: DraftSource } | null>(null);
  const [studio, setStudio] = useState<{ dialog: JobseekerDialog; degradation: StudioDegradation | null } | null>(null);
  const [opening, setOpening] = useState(false);
  const [studioError, setStudioError] = useState<ClassifiedFailure | null>(null);
  const [pointed, setPointedState] = useState<Pointed>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [ceremony, setCeremony] = useState(false);
  const [eveningSeen, setEveningSeen] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const pointedSrc = useRef<PointSource | null>(null);

  const storedSource = useSyncExternalStore(noSubscription, () => (profile ? recallDraftSource(profile.id) : null), () => null);
  const draftSource: DraftSource = importedSource && profile && importedSource.id === profile.id ? importedSource.source : storedSource;

  const say = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  const announce = useCallback((message: string) => setLive(message), []);

  const scan = useScanTask((summary) => {
    if (summary) setLastScanAt(summary.finishedAt);
    void data.reloadRows();
    void data.reloadSources();
    say(summary ? tSieve("toast.scanned", { n: summary.matched }) : tSieve("toast.scanEnded"));
  });

  // ── the level stack. A deep link (?open=) lands on its posting only when the market is open.
  const nav = useAtlasNav(rootRef, arrivalStack(lockOf(!!initial.profile, wantsSet(initial.profile?.preferences ?? null)).gate === "ready" ? initial.openId : null));
  const top = topOf(nav.stack);
  const depth = depthOf(nav.stack);
  useAtlasKeys(rootRef, { level: top.level, onBack: nav.pop, blocked: !!studio });

  // A profile arriving (import, a saved want) may open the dome: the level closes onto the sky
  // and the marks fly to their score. Event-driven, never an effect on the gate.
  const gateRef = useRef(lock.gate);
  useEffect(() => {
    gateRef.current = lock.gate;
  });
  const adoptProfile = useCallback(
    (p: JobseekerProfile | null) => {
      const next = lockOf(!!p, wantsSet(p?.preferences ?? null)).gate;
      const was = gateRef.current;
      data.setProfile(p);
      gateRef.current = next;
      if (was !== "ready" && next === "ready") {
        nav.popTo(0);
        setCeremony(true);
      }
    },
    [data, nav],
  );
  useEffect(() => {
    if (!ceremony) return;
    const done = window.setTimeout(() => setCeremony(false), 2900);
    const skip = () => setCeremony(false);
    window.addEventListener("keydown", skip, true);
    window.addEventListener("pointerdown", skip, true);
    return () => {
      window.clearTimeout(done);
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("pointerdown", skip, true);
    };
  }, [ceremony]);

  // ── pointing: the name of what is under the pointer is set at the centre.
  const point = useCallback((p: Pointed, src: PointSource) => {
    if (p === null) {
      if (pointedSrc.current !== src && pointedSrc.current !== "card") return;
      pointedSrc.current = null;
      setPointedState(null);
      return;
    }
    pointedSrc.current = src;
    setPointedState((prev) => (prev && prev.kind === p.kind && JSON.stringify(prev) === JSON.stringify(p) ? prev : p));
  }, []);

  const firstStar = facts?.top5[0]?.id ?? facts?.scored[0]?.id ?? null;
  const roving = focusId && facts?.scored.some((r) => r.id === focusId) ? focusId : firstStar;
  const focusMark = useCallback((id: string) => {
    setFocusId(id);
    window.requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<SVGGElement>(`g.m[data-id="${CSS.escape(id)}"]`);
      el?.focus({ preventScroll: true });
    });
  }, []);

  // ── opening things
  const openLens = useCallback(
    (lens: Lens, opener: HTMLElement | null) => {
      if (lens === "evening") setEveningSeen(true);
      nav.push({ level: 1, lens }, opener);
    },
    [nav],
  );
  const openPosting = useCallback((id: string, opener: HTMLElement | null) => nav.push({ level: 2, id }, opener), [nav]);
  const openWeighLens = useCallback(
    (opener: HTMLElement | null) => {
      const id = facts?.top5[0]?.id ?? facts?.scored[0]?.id;
      if (id) nav.push({ level: 2, id }, opener);
      else say(t("lenses.weighEmpty"));
    },
    [facts, nav, say, t],
  );
  const onLockedLens = useCallback(
    (name: "sieve" | "evening" | "weigh" | "sources", opener: HTMLElement | null) => {
      void opener;
      const long = t(`lenses.${name}.long`);
      const text = lock.gate === "no-cv" ? t("unlock.noCvText") : t("lenses.lockedMissing", { n: lock.n, total: lock.total, list: lock.missing.map((k) => t(`wants.name.${k}`).toLowerCase()).join(", ") });
      const msg = t("lenses.lockedExplain", { name: long, text });
      setLockNote(msg);
      announce(msg);
    },
    [lock, t, announce],
  );
  // The Sieve's steps link to each other by anchor (`#s-evening`, `/me#s-want`); in the Atlas an
  // anchor names a LENS. A market lens stays shut until the dome is open.
  const onAnchor = useCallback(
    (e: React.MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]");
      const m = a ? /^(?:\/me)?#s-([a-z]+)$/.exec(a.getAttribute("href") ?? "") : null;
      if (!a || !m) return;
      const lens = ANCHOR_LENS[m[1]!];
      if (!lens) return;
      e.preventDefault();
      if (!isSetupLens(lens) && lock.gate !== "ready") {
        onLockedLens(lens as "sieve" | "evening" | "sources", null);
        return;
      }
      openLens(lens, a as HTMLElement);
    },
    [lock.gate, openLens, onLockedLens],
  );
  const onPlateLocked = useCallback((opener: HTMLElement | null) => openLens(lock.gate === "no-cv" ? "cv" : "want", opener), [lock.gate, openLens]);

  // ── the last-seen anchor (docs/features/jobseeker/README.md, "New since your last visit"):
  // advanced only from rows actually rendered as rows - here, once the ranking lens was opened.
  const seenAnchor = useRef<FeedTuple | null>(null);
  useEffect(() => {
    if (eveningSeen && facts && facts.scored.length > 0 && !data.rowsError) seenAnchor.current = renderedAnchor(facts.scored);
  }, [eveningSeen, facts, data.rowsError]);
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

  // ── the CV studio (the polish conversation), an overlay over whatever level is open.
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

  // ── the words
  const first = profile?.profile.displayName?.trim().split(/\s+/)[0] ?? "";
  const headline = useMemo<Headline>(() => {
    if (lock.gate === "no-cv") return { hero: t("headline.closed"), text: t("headline.noCvText", { total: lock.total }), sub: rows ? t("headline.noCvSub", { n: rows.length }) : "" };
    if (lock.gate === "cv-in") {
      const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(lock.missing.map((k) => t(`wants.name.${k}`).toLowerCase()));
      return { hero: t("headline.toGo", { n: lock.total - lock.n }), text: t("headline.toGoText", { total: lock.total }), sub: t("headline.missing", { list }) };
    }
    if (!facts) return { hero: t("headline.reading"), text: "", sub: data.rowsError ? t("headline.loadFailed") : "" };
    const worth = facts.strong + facts.promising;
    const S = facts.scored.length;
    if (S === 0 && facts.all.length === 0) return { hero: t("headline.nothing"), text: t("headline.emptyText"), sub: "" };
    if (S === 0) return { hero: t("headline.nothing"), text: t("headline.nothingText"), sub: "" };
    if (worth > 0) return { hero: String(worth), text: t("headline.worthText", { total: S, name: first }), sub: t("headline.worthSub", { strong: facts.strong, promising: facts.promising }) };
    const best = facts.open[0] ?? facts.scored[0]!;
    return { hero: t("headline.none"), text: t("headline.noneText", { best: best.matchTotal ?? 0 }), sub: t("headline.noneSub", { n: S }) };
  }, [lock, facts, rows, first, locale, t, data.rowsError]);

  const crumbLabel = (e: AtlasEntry): string => {
    if (e.level === 0) return t("crumb.sky");
    if (e.level === 1) return t(`levels.${e.lens}.name`);
    const r = rows?.find((x) => x.id === e.id);
    return r?.title ?? t("levels.weigh.name");
  };
  const crumbsFor = (stack: AtlasStack, d: number): Crumb[] => stack.slice(0, d + 1).map((e, i) => ({ label: crumbLabel(e), onSelect: i < d ? () => nav.popTo(i) : undefined }));

  const scanDoor = <ScanDoor scan={scan} small />;
  const loadError = data.rowsError ? <FailureNotice failure={data.rowsError} fallback={tSieve("loadError")} onRetry={() => void data.reloadRows()} /> : null;

  const renderLens = (lens: Lens): ReactElement => {
    switch (lens) {
      case "cv":
        return (
          <StepArrive
            profile={profile}
            sourcesOn={sourcesOn}
            onSaved={(p, source) => {
              setImportedSource({ id: p.id, source });
              adoptProfile(p);
              void data.reloadRows();
              if (lockOf(true, wantsSet(p.preferences)).gate !== "ready") nav.replaceTop({ level: 1, lens: "read" });
            }}
          />
        );
      case "read":
        return (
          <>
            <StepYou
              profile={profile}
              draftSource={draftSource}
              cvDialog={data.cvDialog}
              postingsWaiting={facts?.all.length ?? 0}
              postings={data.rows}
              polishing={opening}
              onPolish={() => void openStudio()}
              reduceMotion={reduced}
              github={profile ? github : undefined}
              research={research.record?.research ?? null}
            />
            {studioError ? <FailureNotice failure={studioError} fallback={tCv("createError")} onRetry={() => void openStudio()} retrying={opening} onDismiss={() => setStudioError(null)} /> : null}
          </>
        );
      case "want":
        return (
          <StepWant
            profile={profile}
            locale={locale}
            onSaved={adoptProfile}
            scanDoor={scanDoor}
            reduceMotion={reduced}
            market={profile ? <MarketMix api={research} profile={profile} github={github.state} /> : null}
          />
        );
      case "sieve":
        return (
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
                onProfileSaved={adoptProfile}
                onEnabled={() => {
                  void data.reloadSources();
                  void data.reloadRows();
                }}
              />
            }
            scanDoor={scanDoor}
            loadError={loadError}
            onOpen={(id) => openPosting(id, null)}
            reduceMotion={reduced}
          />
        );
      case "evening":
        return (
          <StepEvening
            facts={facts}
            hasProfile={!!profile}
            loading={!rows}
            locale={locale}
            openId={top.level === 2 ? top.id : null}
            guidedId={null}
            newSince={seenNow ? null : data.newSince}
            onMarkSeen={markSeen}
            onOpen={(id) => openPosting(id, null)}
            onOrderChange={setOrder}
            loadError={loadError}
            targetTitles={profile?.preferences.targetTitles.length ?? 0}
            skillless={!!profile && (profile.profile.skillClaims ?? []).length === 0}
            polishing={opening}
            onPolish={() => void openStudio()}
          />
        );
      case "sources":
        return (
          <StepSources
            catalog={catalog}
            sources={sources}
            postingCounts={postingCounts}
            hasProfile={!!profile}
            countries={profile?.preferences.countries ?? []}
            onSourcesChange={data.setSources}
            onProfileSaved={adoptProfile}
            onToast={say}
          />
        );
    }
  };

  const escKeys = [{ id: "esc", keys: [t("keys.esc")], act: t("keys.back") }];

  const renderLevel = (entry: AtlasEntry, d: number, stack: AtlasStack): ReactElement => {
    const crumbs = crumbsFor(stack, d);
    const trail = <LevelTrail crumbs={crumbs} onBack={nav.pop} backLabel={t("crumb.back", { place: crumbs[crumbs.length - 2]?.label ?? "" })} label={t("crumb.label")} />;
    if (entry.level === 0) {
      return (
        <main className="hub" id="at-hub" aria-label={t("frame.hubLabel")} data-role="hub">
          <h1 className="sr-only" tabIndex={-1} data-role="hub-heading" data-level-heading="">{t("frame.hubHeading")}</h1>
          <AtlasSky
            rows={rows ?? []}
            facts={facts}
            layout={layout}
            rim={rim}
            lock={lock}
            pointed={pointed}
            focusId={roving}
            headline={headline}
            sectorLabel={sourceLabel}
            ceremony={ceremony}
            reduced={reduced}
            onPoint={point}
            onFocusMark={focusMark}
            onOpenStar={openPosting}
            onOpenGate={(_key, opener) => openLens("sieve", opener)}
            onLocked={onPlateLocked}
            onSkipCeremony={() => setCeremony(false)}
            gateLabel={gateLabel}
            plateActions={{ openStar: t("plate.openStar"), openSieve: t("plate.openSieve") }}
          >
            <ul className="lg" aria-label={t("legend.label")}>
              {lock.gate === "ready" ? (
                <>
                  <li><span className="lg-dot t-strong" />{tSieve("tier.strong")}</li>
                  <li><span className="lg-dot t-promising" />{tSieve("tier.promising")}</li>
                  <li><span className="lg-dot t-partial" />{tSieve("tier.partial")}</li>
                  <li><span className="lg-ring" />{t("legend.rim")}</li>
                </>
              ) : (
                <li><span className="lg-stone" />{t("legend.unread")}</li>
              )}
            </ul>
            <div className="stage-note"><p className="k-hand">{lock.gate === "ready" ? t("note.ready") : lock.gate === "no-cv" ? t("note.shut") : t("note.half")}</p></div>
            <div className="plate-t"><span className="k-eyebrow">{t("plate.eyebrow")}</span><span className="plate-t-n">{t("plate.title")}</span><span className="plate-t-s">{t("plate.stylised")}</span></div>
            <div className="keys" hidden={lock.gate !== "ready"}>
              <KeyHints label={t("keys.label")} hints={[
                { id: "arrows", keys: [t("keys.arrows")], act: t("keys.arrowsAct") },
                { id: "enter", keys: [t("keys.enter")], act: t("keys.enterAct") },
                { id: "esc", keys: [t("keys.esc")], act: t("keys.back") },
              ]} />
            </div>
          </AtlasSky>
          <aside className={`side${lock.gate === "ready" ? "" : " is-locked"}`} data-gate={lock.gate} aria-label={t("frame.sideLabel")} id="side">
            <AtlasSide
              lock={lock}
              set={set}
              profile={profile}
              facts={facts}
              loading={!rows && !data.rowsError}
              sourcesOn={sourcesOn}
              lockNote={lockNote}
              hotDeck
              scanDoor={scanDoor}
              onOpenLens={openLens}
              onOpenWeigh={openWeighLens}
              onOpenPosting={openPosting}
              onPointCard={(id) => point(id ? { kind: "star", id } : null, "card")}
              onLockedLens={onLockedLens}
            />
            {profile ? loadError : null}
          </aside>
        </main>
      );
    }
    if (entry.level === 1) {
      const lens = entry.lens;
      return (
        <LevelFrame tone={LENS_TONE[lens]} kicker={t(`levels.${lens}.kicker`)} title={t(`levels.${lens}.name`)} lead={t(`levels.${lens}.lead`)} trail={trail} keys={<KeyHints label={t("keys.label")} hints={escKeys} />}>
          <div className="sv at-embed" data-role={`embed-${lens}`}>{renderLens(lens)}</div>
        </LevelFrame>
      );
    }
    const row = rows?.find((r) => r.id === entry.id) ?? null;
    const ids = order.length ? order : (facts?.scored.map((r) => r.id) ?? []);
    const at = ids.indexOf(entry.id);
    return (
      <LevelFrame tone="moss" kicker={t("levels.weigh.kicker")} title={row?.title ?? t("levels.weigh.name")} lead={row?.company ?? undefined} trail={trail}
        keys={<KeyHints label={t("keys.label")} hints={[{ id: "decide", keys: ["A", "S", "D"], act: t("keys.decide") }, { id: "walk", keys: ["J", "K"], act: t("keys.walk") }, ...escKeys]} />}>
        <div className="sv at-embed" data-role="embed-weigh">
          <StepWeigh
            openId={entry.id}
            row={row}
            rank={facts ? (facts.rank[entry.id] ?? null) : null}
            total={facts?.scored.length ?? 0}
            order={at >= 0 ? ids : [entry.id]}
            profileId={profile?.id ?? null}
            salaryFloor={profile?.preferences.salaryFloor ?? null}
            locale={locale}
            navActive={d === depth}
            decideActive={d === depth}
            onOpen={(id) => nav.replaceTop({ level: 2, id })}
            onRowUpdate={data.replaceRow}
            onToast={say}
            suggestions={facts?.top5 ?? []}
          />
        </div>
      </LevelFrame>
    );
  };

  const layers = nav.stack.map((entry, d) => (
    <LevelTransition key={layerKey(entry, d)} depth={d} mode={layerModeAt(d, depth, nav.kind)} opener={d === depth ? (nav.openers[d] ?? null) : null} onSettled={d === depth ? nav.settle : undefined}>
      {renderLevel(entry, d, nav.stack)}
    </LevelTransition>
  ));
  const tr = nav.transition;
  if (tr?.kind === "close") {
    layers.push(
      <LevelTransition key={layerKey(tr.ghost, tr.ghostDepth)} depth={tr.ghostDepth} mode="leaving" opener={tr.opener} onSettled={nav.settle}>
        {renderLevel(tr.ghost, tr.ghostDepth, tr.from)}
      </LevelTransition>,
    );
  }

  return (
    <div ref={rootRef} className={AT_ROOT} onClickCapture={onAnchor} data-gate={lock.gate} data-level={top.level} data-wants={WANT_KEYS.filter((k: WantKey) => set[k]).join(" ")} aria-busy={(!rows && !data.rowsError) || undefined}>
      <a className="skip-link" href="#at-hub">{t("frame.skip")}</a>
      <header className="top" id="top">
        <Link className="brand" href="/me/atlas" aria-label={t("frame.brandLabel")}>
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <circle className="bm-ring" cx="16" cy="16" r="13.4" />
            <circle className="bm-ring2" cx="16" cy="16" r="9" />
            <path className="bm-star" d="M16 6.4l2 6.4 6.4 2-6.4 2-2 6.4-2-6.4-6.4-2 6.4-2Z" />
          </svg>
          <span className="brand-t">{tSieve("frame.brand")}</span>
          <span className="brand-s">{t("frame.sub")}</span>
        </Link>
        {profile ? (
          <span className="who">
            <span className="av" aria-hidden="true">{initialsOf(profile.profile.displayName)}</span>
            <span>{tSieve.rich("frame.who", { name: profile.profile.displayName?.trim() || tSieve("rail.you"), b: (c) => <b>{c}</b> })}</span>
          </span>
        ) : null}
        <div className="top-fill" />
        <ViewSwitch current="atlas" />
        <div className="top-prefs"><RailPreferences /></div>
      </header>
      <p className="sr-only" role="status">{crumbsFor(nav.stack, depth).map((c) => c.label).join(" › ")}</p>
      <p className="sr-only" role="status" aria-live="polite">{live}</p>
      {layers}
      <div className="sv at-embed at-foot" data-role="foot">
        <footer className="foot">
          {tSieve("foot")}
          <div className="mt-3"><EraseMeDoor /></div>
        </footer>
        <div className={toast ? "toast show" : "toast"} role="status" aria-live="polite">{toast}</div>
      </div>
      {studio && profile ? (
        <CvStudio
          dialog={studio.dialog}
          profile={profile}
          initialDegradation={studio.degradation}
          onDialogChange={(dialog) => setStudio((s) => (s ? { ...s, dialog } : s))}
          onProfileChange={(p) => {
            adoptProfile(p);
            void data.reloadDialogs();
          }}
          onClose={() => {
            setStudio(null);
            void data.reloadDialogs();
          }}
        />
      ) : null}
    </div>
  );
}
