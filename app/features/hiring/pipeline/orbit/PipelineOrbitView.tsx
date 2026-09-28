"use client";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { KitSurface, Note, PageHead, Segmented } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";
import { canonicalScoreOf } from "@/app/_lib/match-score";
import { daysSince, slaForStage, type Entry, type PipelineEvent } from "@/app/features/shared/pipelineTypes";
import { useSetupUnfinished } from "@/app/features/shell/setup/useSetupUnfinished";
import { requestOnboardingReopen } from "@/app/features/shell/setup/onboardingReopen";
import { PipelineEmptyState } from "../empty/PipelineEmptyState";
import { useEventVerb, useRelativeTime } from "../PipelineShared";
import { boardPopulation } from "../pipelineBoardPopulation";
import { usePipelineTabState } from "../usePipelineTabState";
import { PipelineKitToday } from "../kit/PipelineKitToday";
import { PipelineKitOffBoard } from "../kit/PipelineKitOffBoard";
import { PipelineKitActivity } from "../kit/PipelineKitActivity";
import { PipelineKitSla } from "../kit/PipelineKitSla";
import { buildOrbit, byUrgency, groupsFor, isLens, ladderOf, lensKey, LENSES, type LensId, type OrbitPerson, type SearchHit } from "./orbitModel";
import { readPalette, runFlight, type Part } from "./orbitPaint";
import { OrbitStage, type Arrival, type OrbitStageHandle } from "./OrbitStage";
import { OrbitLanes } from "./OrbitLanes";
import { OrbitSearch } from "./OrbitSearch";
import { OrbitPortal } from "./OrbitPortal";
import { useOrbitJobs } from "./useOrbitJobs";
import { usePersistedChoice } from "./usePersistedChoice";
import { useOrbitWords } from "./orbitWords";
import type { LadderProps } from "./ladder/ladderParts";
import { OrbitMatches } from "./OrbitMatches";
import { OrbitLadderCompare } from "./ladder/OrbitLadderCompare";
import "./pipelineOrbit.css";

const CandidateModal = dynamic(() => import("../candidate/CandidateModal").then((m) => ({ default: m.CandidateModal })), {
  loading: () => <LoadingGap className="fixed inset-0 z-50 bg-scrim" />,
});

const LENS_KEY = "kp-orbit-lens";
const EASE = "cubic-bezier(.2,.8,.2,1)";


/*
 * Hiring > Pipeline (the /contest pipeline-l0-l1 winner, B/3 "The Orbit", promoted 2026-09-28; it
 * replaced the kit roles board). Three levels over usePipelineTabState, plus the job list for what
 * entries do not carry:
 *   L0  the orbit: every active person a dot, rings = stages, sectors = groups under a lens (family,
 *       city, seniority), the most-waiting sector nearest 12 o'clock, empty roles on the rim;
 *   L1  a group unrolled into lanes: a row per role, a cell per stage (the dots fly to their beads);
 *   L2  a role's bench (OrbitLadderCompare), opened by its title (every stage) or by a cell (that stage):
 *       the ladder as a picker and the picked people side by side.
 * Around them: the head's figures, Today (its stage rows focus a ring), Off the board, the matches
 * table for any URL filter a link brought (`?q=` and friends), Activity, the stage SLA editor and the
 * full candidate record.
 */
export function PipelineOrbitView() {
  const s = usePipelineTabState();
  const jobs = useOrbitJobs();
  const t = useTranslations("pipeline.orbit");
  const tt = useTranslations("pipeline.tab");
  const words = useOrbitWords(s.axis);
  const reduced = useReducedMotion() ?? false;
  const fmt = useDateFormat();
  const verb = useEventVerb();
  const ago = useRelativeTime();
  const setupUnfinished = useSetupUnfinished();
  const [now] = useState(() => Date.now());

  const [lensPick, setLensPick] = usePersistedChoice<LensId>(LENS_KEY, isLens, "family");
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [roleKey, setRoleKey] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [ring, setRing] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [slaOpen, setSlaOpen] = useState(false);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [flying, setFlying] = useState(false);
  const stageRef = useRef<OrbitStageHandle>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const nonce = useRef(0);
  const pendingDown = useRef<{ key: string; snap: NonNullable<ReturnType<OrbitStageHandle["snapshot"]>>; from: DOMRect | null } | null>(null);

  const status = s.error ? "error" : s.entries == null ? "loading" : "ready";
  const empty = status === "ready" && s.entries?.length === 0;
  const lens: LensId = jobs.jobs ? lensPick : "family";

  // The product's one aging clock (usePipelineTabState.isStale), over the same axis and team cadences.
  const isStale = useCallback((e: Entry) => (daysSince(e.stageChangedAt) ?? 0) >= slaForStage(e.stage, s.slaOverrides, s.axis), [s.slaOverrides, s.axis]);
  const population = useMemo(() => boardPopulation(s.entries).active, [s.entries]);
  const model = useMemo(
    () => (s.entries == null ? null : buildOrbit({ entries: population, jobs: jobs.jobs, axis: s.axis, isStale, score: canonicalScoreOf })),
    [s.entries, population, jobs.jobs, s.axis, isStale]
  );
  const groups = useMemo(() => (model ? groupsFor(model, lens) : []), [model, lens]);
  const group = groupKey != null ? groups.find((g) => g.key === groupKey) ?? null : null;
  const role = roleKey && model ? model.roleByKey.get(roleKey) ?? null : null;
  const sla = useMemo(() => s.axis.map((st) => (st.role === "terminal" ? 0 : slaForStage(st.id, s.slaOverrides, s.axis))), [s.axis, s.slaOverrides]);
  const ranked = useMemo(() => [...groups].sort(byUrgency), [groups]);
  const gi = group ? ranked.indexOf(group) : -1;
  const rungs = useMemo(() => (role ? ladderOf(role, s.axis, words.locale, stage) : []), [role, s.axis, words.locale, stage]);
  const lastEvent = useMemo(() => {
    const m = new Map<string, PipelineEvent>();
    for (const ev of s.events) if (ev.entryId && (!m.get(ev.entryId) || ev.createdAt > (m.get(ev.entryId)?.createdAt ?? ""))) m.set(ev.entryId, ev);
    return m;
  }, [s.events]);

  /* ---------------------------------------------------------------- level moves */

  const openGroup = (key: string, then?: { role?: string; stage?: string | null; highlight?: string | null }) => {
    if (flying) return;
    const into = () => {
      setGroupKey(key);
      setRoleKey(then?.role ?? null);
      setStage(then?.stage ?? null);
      setHighlight(then?.highlight ?? null);
    };
    if (groupKey != null) return into();
    const snap = reduced ? null : stageRef.current?.snapshot() ?? null;
    const co = document.querySelector<HTMLElement>(`[data-role="orbit-callout"][data-key="${CSS.escape(key)}"]`);
    pendingDown.current = snap ? { key, snap, from: co?.getBoundingClientRect() ?? null } : null;
    into();
  };

  // The unroll: after the lanes mount, every dot of the opened group flies to its bead; the rest drift out.
  useLayoutEffect(() => {
    const pend = pendingDown.current;
    if (!pend || pend.key !== groupKey) return;
    pendingDown.current = null;
    const lanes = lanesRef.current;
    const overlay = flyRef.current;
    if (!lanes || !overlay) return;
    const to = new Map<string, { x: number; y: number; r: number }>();
    lanes.querySelectorAll<HTMLElement>("[data-p]").forEach((b) => {
      const r = b.getBoundingClientRect();
      to.set(b.dataset.p ?? "", { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 });
    });
    const { center } = pend.snap;
    const parts: Part[] = pend.snap.dots.map((sd) => {
      const target = sd.d.g === pend.key ? to.get(sd.d.p.id) : undefined;
      if (target) {
        const dx = target.x - sd.x;
        const dy = target.y - sd.y;
        const dl = Math.hypot(dx, dy) || 1;
        return {
          d: sd.d, fx: sd.x, fy: sd.y, tx: target.x, ty: target.y, fr: sd.r, tr: target.r, fa: 1, ta: 1,
          delay: Math.min(0.32, (4 - sd.d.p.si) * 0.05 + (sd.d.th % 0.5) * 0.12), arc: Math.min(90, dl * 0.18), nx: -dy / dl, ny: dx / dl,
        };
      }
      const ox = sd.x - center.x;
      const oy = sd.y - center.y;
      const len = Math.hypot(ox, oy) || 1;
      return { d: sd.d, fx: sd.x, fy: sd.y, tx: sd.x + (ox / len) * 260, ty: sd.y + (oy / len) * 260, fr: sd.r, tr: sd.r, fa: 0.9, ta: 0, delay: 0, fast: true };
    });
    const title = document.getElementById("ob-gtitle");
    if (title && pend.from) {
      const tr = title.getBoundingClientRect();
      title.animate(
        [{ transform: `translate(${pend.from.left - tr.left}px, ${pend.from.top - tr.top}px) scale(.55)`, transformOrigin: "left top", opacity: 0.4 }, { transform: "none", transformOrigin: "left top", opacity: 1 }],
        { duration: 900, easing: EASE }
      );
    }
    lanes.querySelectorAll<HTMLElement>(".ob-chead > span").forEach((h, i) =>
      h.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: 300 + i * 60, fill: "backwards" })
    );
    setFlying(true);
    runFlight(overlay, readPalette(), parts, 1250, () => {
      setFlying(false);
      lanes.querySelectorAll<HTMLElement>(".ob-lane__name, .ob-cell__n, .ob-abs").forEach((el, i) =>
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: Math.min(i, 40) * 6, fill: "backwards" })
      );
    });
  }, [groupKey]);

  const snapshotMap = () => {
    const m = new Map<string, { x: number; y: number; r: number }>();
    for (const sd of stageRef.current?.snapshot()?.dots ?? []) m.set(sd.d.p.id, { x: sd.x, y: sd.y, r: sd.r });
    return m;
  };

  const goUp = () => {
    if (flying || groupKey == null) return;
    const from = new Map<string, { x: number; y: number; r: number }>();
    if (!reduced) {
      lanesRef.current?.querySelectorAll<HTMLElement>("[data-p]").forEach((b) => {
        const r = b.getBoundingClientRect();
        if (r.bottom > -40 && r.top < window.innerHeight + 40) from.set(b.dataset.p ?? "", { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 });
      });
    }
    setArrival({ nonce: ++nonce.current, mode: "up", from, key: groupKey });
    setGroupKey(null);
    setRoleKey(null);
    setStage(null);
    setHighlight(null);
  };

  const changeLens = (next: string) => {
    if (!isLens(next) || next === lens || flying) return;
    const from = groupKey == null && !reduced ? snapshotMap() : new Map();
    setLensPick(next);
    setGroupKey(null);
    setRoleKey(null);
    setStage(null);
    setArrival({ nonce: ++nonce.current, mode: "resector", from, key: null });
  };

  const openLadder = (key: string, st: string | null, person: string | null = null) => {
    if (key === roleKey && st === stage && !person) return closeLadder();
    setRoleKey(key);
    setStage(st);
    setHighlight(person);
    sheetRef.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  };
  const closeLadder = () => {
    const key = roleKey;
    setRoleKey(null);
    setStage(null);
    setHighlight(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-role-key="${CSS.escape(key ?? "")}"] .ob-lane__title`)?.focus({ preventScroll: true }));
  };
  // Stepping walks the live roles from a live role, and the empty ones from an empty one.
  const stepOrder = group && role ? group.roles.filter((r) => (r.act > 0) === (role.act > 0)) : [];
  const stepRole = (d: 1 | -1) => {
    if (!group || !role) return;
    const order = stepOrder;
    const i = order.indexOf(role);
    const next = order[(i + d + order.length) % order.length];
    if (next) { setRoleKey(next.key); setHighlight(null); }
  };

  const onSearch = (h: SearchHit) => {
    const r = h.role;
    const key = lensKey(r, lens);
    const st = h.type === "person" ? s.axis[h.person.si]?.id ?? null : null;
    const pid = h.type === "person" ? h.person.id : null;
    if (groupKey !== key) openGroup(key, { role: r.key, stage: st, highlight: pid });
    else { setRoleKey(r.key); setStage(st); setHighlight(pid); }
    // The pick lands the keyboard on the ladder it opened, so Esc climbs from there.
    requestAnimationFrame(() => document.getElementById("ob-ladder-title")?.focus({ preventScroll: true }));
  };

  const focusRing = (stageId: string) => {
    const i = s.axis.findIndex((x) => x.id === stageId);
    setRing((cur) => (cur === i ? null : i >= 0 ? i : null));
    sheetRef.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  };

  // Esc climbs one level (ladder -> lanes -> orbit -> clear the ring); j / k step roles while a ladder is open.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || s.candidate || slaOpen || isAnyModalOpen()) return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "Escape") {
      if (roleKey) { e.preventDefault(); closeLadder(); }
      else if (groupKey != null) { e.preventDefault(); goUp(); }
      else if (ring != null) { e.preventDefault(); setRing(null); }
    } else if (roleKey && (e.key === "j" || e.key === "k") && !e.altKey && !e.ctrlKey && !e.metaKey) {
      stepRole(e.key === "j" ? 1 : -1);
    }
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  /* ---------------------------------------------------------------- render */

  const openPerson = (p: OrbitPerson, cohort: readonly OrbitPerson[]) => s.openCandidate(p.entry, cohort.map((x) => x.entry), "overview");
  const ladder: LadderProps | null =
    role && group
      ? {
          role, groupLabel: words.group(lens, group.key), axis: s.axis, words, sla, stage, rungs,
          onStage: setStage, onPerson: openPerson, onClose: closeLadder, onStep: stepRole,
          index: stepOrder.indexOf(role), total: stepOrder.length, highlight,
          lastEvent: (id) => lastEvent.get(id) ?? null, eventWord: (ev) => verb(ev), ago,
          picked, onPick: setPicked, now,
          source: (p) => (p.entry.sourceChannel ? s.channelName(p.entry.sourceChannel) : null),
          date: (iso) => fmt.date(iso),
        }
      : null;

  const T = model?.total;
  const emptyRoles = T ? T.abs.vacant + T.abs.draft : 0;
  const inFlight = T ? T.act - T.hired : 0;

  const trail = (
    <nav className="ob-trail" aria-label={t("trailAria")}>
      {group ? (
        <>
          <button type="button" className={TRAIL_BTN} onClick={goUp}>{t("orbitName")}</button>
          <span aria-hidden>›</span>
          {role ? (
            <>
              <button type="button" className={TRAIL_BTN} onClick={closeLadder}>{words.group(lens, group.key)}</button>
              <span aria-hidden>›</span>
              <span className="ob-trail__here">{role.title}</span>
            </>
          ) : (
            <span className="ob-trail__here">{words.group(lens, group.key)}</span>
          )}
        </>
      ) : (
        <span className="ob-trail__here">{t("trailTop", { lens: t(`lens.${lens}`) })}</span>
      )}
    </nav>
  );

  return (
    <>
      <KitSurface>
        <div aria-busy={status === "loading"} aria-label={t("surfaceAria")} role="region" data-role="pipeline-orbit" data-sim="pipeline-board">
          <PageHead
            eyebrow={tt("eyebrow")}
            title={tt("title")}
            figures={
              T
                ? [
                    { label: t("figWaitingHuman"), value: T.wait, tone: T.wait > 0 ? "needs" : "default" },
                    { label: t("figOverSla"), value: T.aging, of: inFlight },
                    { label: t("figHired"), value: T.hired, ...(T.target ? { of: T.target } : {}) },
                    jobs.jobs ? { label: t("figEmptyRoles"), value: emptyRoles } : { label: t("figEmptyRoles"), value: null, tip: t("jobsFailed") },
                  ]
                : []
            }
            state={status}
            errorText={tt("loadFailed")}
            onRetry={() => void s.load()}
          />
          {empty ? (
            <PipelineEmptyState axis={s.axis} setupUnfinished={setupUnfinished} onResumeSetup={requestOnboardingReopen} onStartTour={s.sim.running ? undefined : s.sim.start} />
          ) : (
            <>
              <PipelineKitToday s={s} onShowStage={focusRing} />
              <PipelineKitOffBoard s={s} />
              {s.filtering ? <OrbitMatches s={s} words={words} now={now} /> : null}
              {jobs.failed ? <Note tone="caution">{t("jobsFailed")}</Note> : null}
              {jobs.truncated ? <Note tone="caution">{t("jobsTruncated")}</Note> : null}
              <div ref={sheetRef} className="ob-toolbar">
                {trail}
                <Segmented
                  lead={t("lensLead")}
                  label={t("lensLabel")}
                  value={lens}
                  onChange={changeLens}
                  items={LENSES.map((l) => ({ value: l, label: t(`lens.${l}`), disabled: l !== "family" && !jobs.jobs, tip: l !== "family" && !jobs.jobs ? t("jobsFailed") : undefined }))}
                />
                <OrbitSearch model={model} words={words} onPick={onSearch} />
              </div>
              {ring != null ? (
                <div className="ob-ringnote">
                  <span>{t("ringNote", { stage: words.stage(s.axis[ring]?.id ?? ""), count: T?.st[ring]?.n ?? 0 })}</span>
                  <button type="button" className={TRAIL_BTN} onClick={() => setRing(null)}>{t("ringClear")}</button>
                </div>
              ) : null}
              {status === "loading" || !model ? (
                <LoadingGap label={t("placing")} className="ob-gap" />
              ) : group == null ? (
                <OrbitStage
                  ref={stageRef}
                  groups={groups}
                  lens={lens}
                  axis={s.axis}
                  words={words}
                  ring={ring}
                  onOpen={(k) => openGroup(k)}
                  arrival={arrival}
                  fly={flyRef}
                  reduced={reduced}
                  closedEmpty={model.closedEmpty}
                  jobsMissing={!jobs.jobs}
                />
              ) : (
                <div className="ob-l1">
                  {ladder ? (
                    <OrbitLadderCompare {...ladder} />
                  ) : (
                    <OrbitLanes
                      group={group}
                      lens={lens}
                      axis={s.axis}
                      words={words}
                      sla={sla}
                      ring={ring}
                      selRole={roleKey}
                      selStage={stage}
                      prev={gi > 0 ? ranked[gi - 1] : null}
                      next={gi >= 0 && gi < ranked.length - 1 ? ranked[gi + 1] : null}
                      flying={flying}
                      lanesRef={lanesRef}
                      onRole={(k) => openLadder(k, null)}
                      onCell={(k, st) => openLadder(k, st)}
                      onBack={goUp}
                      onSibling={(k) => openGroup(k)}
                      onEditSla={() => setSlaOpen(true)}
                    />
                  )}
                </div>
              )}
              <PipelineKitActivity s={s} />
            </>
          )}
        </div>
      </KitSurface>
      <OrbitPortal>
        <canvas ref={flyRef} className="ob-fly" aria-hidden />
      </OrbitPortal>
      {slaOpen ? <PipelineKitSla s={s} onClose={() => setSlaOpen(false)} /> : null}
      {s.candidate ? (
        <CandidateModal
          key="candidate-modal"
          view={s.candidate}
          boardCohort={ladder ? ladder.rungs.flatMap((r) => r.people.map((p) => p.entry)) : population}
          axis={s.axis}
          onClose={s.closeCandidate}
          onChanged={s.load}
          onOpenEntry={s.openEntryById}
          onOpenProfile={s.openProfile}
          onNavigate={s.showCandidate}
          onTab={s.setCandidateTab}
        />
      ) : null}
    </>
  );
}

/** The trail's and the ring note's text buttons (painted by pipelineOrbit.css). */
const TRAIL_BTN = "ob-trail__btn";
