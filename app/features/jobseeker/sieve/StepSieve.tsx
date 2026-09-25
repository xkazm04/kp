"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { KoReasonKey } from "@/app/_lib/jobseeker/types";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { SieveFacts } from "./sieveModel";
import { asIf, sieveGeometry, type Dot } from "./sieveGeometry";
import { cx, SV_BTN_SM_GHOST, SV_CATCH_ROW } from "./sieveRecipes";

// Step 5 — The sieve. Every posting is a dot, and the seeker WATCHES them pour through:
// the ones held at the door (their source is off), the ones each named gate catches, the
// ones still waiting for a score, and the ones that fall through onto the score line,
// piled by score so the shape of the market is visible at a glance. The layer counters
// tick up as the dots land.
//
// Nothing caught is a zero. A gate's layer says what it caught and opens a list in which
// every row names its gate and states what it WOULD have scored, in a dashed box, never
// ranked. A posting failing two gates is drawn once (ringed) on the first and ghosted on
// the second, so 22 caught and 66 caught read the same way.
//
// When a decision or a source switch moves rows between layers, the dots MOVE from where
// they were to where they now belong — the sieve re-derives, it never re-deals.

export function StepSieve({
  facts,
  hasProfile,
  loading,
  sourceLabel,
  sourcesOn,
  lastScanAt,
  emptyDoor,
  scanDoor,
  loadError,
  onOpen,
  reduceMotion,
}: {
  facts: SieveFacts | null;
  hasProfile: boolean;
  loading: boolean;
  sourceLabel(id: string): string;
  sourcesOn: number;
  lastScanAt: string | null;
  /** What to offer when no source feeds the sieve (the one-click EURES door). */
  emptyDoor: ReactNode;
  scanDoor: ReactNode;
  /** The failed postings read, with its Retry: a failure is said here, never drawn as loading. */
  loadError: ReactNode;
  onOpen(id: string): void;
  reduceMotion: boolean;
}) {
  const t = useTranslations("me.sieve.sieve");
  const tGate = useTranslations("me.sieve.gate");
  const rel = useRelativeTime();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [W, setW] = useState(900);
  const [catchKey, setCatchKey] = useState<string | null>(null);
  // Whether the first pour ran: read only inside the layout effect, so a ref, not state.
  const poured = useRef(false);
  const [visible, setVisible] = useState(false);
  const positions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [pourRun, setPourRun] = useState(0);
  // The stage element exists only once the rows are in; the observers re-attach then.
  const staged = facts !== null && !loading && hasProfile;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setW(Math.max(320, Math.round(el.clientWidth || 900)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [staged]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { threshold: 0.18 });
    io.observe(el);
    return () => io.disconnect();
  }, [staged]);

  const model = useMemo(() => (facts ? sieveGeometry(facts, W) : null), [facts, W]);

  // The pour (first time the stage is seen) and the move (rows changed layer while it is
  // on screen). Attributes are written straight to the circles React already placed at
  // their final spot, so an interrupted animation still ends where the data says.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || !model) return;
    const final = new Map(model.dots.map((d) => [d.id, { x: d.x, y: d.y }]));
    const prev = positions.current;
    const firstPour = !poured.current;
    if (!visible && firstPour) return;
    positions.current = final;
    const counters = new Map<string, HTMLElement>();
    stageRef.current?.querySelectorAll<HTMLElement>("[data-lc]").forEach((el) => counters.set(el.dataset.lc ?? "", el));
    if (reduceMotion || (!firstPour && prev.size === 0)) {
      poured.current = true;
      return;
    }
    const circles = new Map<string, SVGCircleElement>();
    svg.querySelectorAll<SVGCircleElement>("circle.d").forEach((c) => circles.set(c.dataset.id ?? "", c));
    const counts = new Map<string, number>();
    const totals = new Map<string, number>();
    for (const d of model.dots) totals.set(d.layer, (totals.get(d.layer) ?? 0) + 1);
    type Anim = { d: Dot; c: SVGCircleElement; from: { x: number; y: number }; delay: number; dur: number; done: boolean };
    const anims: Anim[] = [];
    const order = model.dots.map((_, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((idx, k) => {
      const d = model.dots[idx]!;
      const c = circles.get(d.id);
      if (!c) return;
      const pv = firstPour ? null : prev.get(d.id) ?? null;
      if (pv && Math.abs(pv.x - d.x) < 0.5 && Math.abs(pv.y - d.y) < 0.5) {
        counts.set(d.layer, (counts.get(d.layer) ?? 0) + 1);
        return;
      }
      const from = pv ?? { x: model.x0 + Math.random() * (W - model.x0 - 24), y: -12 - Math.random() * 80 };
      anims.push({ d, c, from, delay: pv ? 60 + Math.random() * 500 : firstPour ? k * 13 : 60 + Math.random() * 400, dur: 600 + Math.abs(d.y - from.y) * 0.85, done: false });
    });
    if (anims.length === 0) {
      poured.current = true;
      return;
    }
    counters.forEach((el, key) => {
      el.textContent = String(counts.get(key) ?? 0);
    });
    anims.forEach((a) => {
      a.c.setAttribute("cx", String(a.from.x));
      a.c.setAttribute("cy", String(a.from.y));
    });
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      let live = false;
      for (const a of anims) {
        if (a.done) continue;
        const p = (now - t0 - a.delay) / a.dur;
        if (p < 0) {
          live = true;
          continue;
        }
        if (p >= 1) {
          a.done = true;
          a.c.setAttribute("cx", String(a.d.x));
          a.c.setAttribute("cy", String(a.d.y));
          counts.set(a.d.layer, (counts.get(a.d.layer) ?? 0) + 1);
          const el = counters.get(a.d.layer);
          if (el) el.textContent = String(counts.get(a.d.layer));
          continue;
        }
        live = true;
        const ty = p * p * (1.4 - 0.4 * p);
        const tx = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        a.c.setAttribute("cx", String(a.from.x + (a.d.x - a.from.x) * tx));
        a.c.setAttribute("cy", String(a.from.y + (a.d.y - a.from.y) * ty));
      }
      if (live) raf = requestAnimationFrame(frame);
      else counters.forEach((el, key) => (el.textContent = String(totals.get(key) ?? 0)));
    };
    raf = requestAnimationFrame(frame);
    poured.current = true;
    // A hidden tab never ticks rAF: land everything once the pour's own duration has
    // passed, so a sieve opened in a background tab is never left empty.
    const longest = anims.reduce((m, a) => Math.max(m, a.delay + a.dur), 0);
    const settle = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      for (const a of anims) {
        a.done = true;
        a.c.setAttribute("cx", String(a.d.x));
        a.c.setAttribute("cy", String(a.d.y));
      }
      counters.forEach((el, key) => (el.textContent = String(totals.get(key) ?? 0)));
    }, longest + 250);
    return () => {
      window.clearTimeout(settle);
      cancelAnimationFrame(raf);
      anims.forEach((a) => {
        a.c.setAttribute("cx", String(a.d.x));
        a.c.setAttribute("cy", String(a.d.y));
      });
      counters.forEach((el, key) => (el.textContent = String(totals.get(key) ?? 0)));
    };
  }, [model, visible, pourRun, reduceMotion, W]);

  // An empty sieve with a source on offers Scan now in its own box, beside the reason; the
  // head then keeps only the "last scan" line, so the page never shows two Scan buttons
  // (and two identical live regions) for one scan task.
  const doorInEmpty = hasProfile && !loading && !!facts && facts.all.length === 0 && sourcesOn > 0;
  const head = (
    <div className="step-head">
      <div className="grow">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2 id="h-sieve">{facts && facts.all.length ? t("title", { n: facts.all.length }) : t("titleEmpty")}</h2>
        <p className="lede">{t("lede")}</p>
      </div>
      {hasProfile ? (
        <div className="scanline">
          <span suppressHydrationWarning>{lastScanAt ? t("lastScan", { when: rel(lastScanAt) }) : t("neverScanned")}</span>
          {doorInEmpty ? null : scanDoor}
        </div>
      ) : null}
    </div>
  );

  if (!hasProfile) {
    return (
      <section className="step" id="s-sieve" data-step="sieve" aria-labelledby="h-sieve">
        {head}
        <div className="gapbox">
          <strong>{t("notReached")}</strong>
          <span>{t("notReachedBody")}</span>
        </div>
      </section>
    );
  }

  if (loadError && !facts) {
    return (
      <section className="step" id="s-sieve" data-step="sieve" aria-labelledby="h-sieve">
        {head}
        {loadError}
      </section>
    );
  }

  if (loading || !facts || !model) {
    return (
      <section className="step" id="s-sieve" data-step="sieve" aria-labelledby="h-sieve">
        {head}
        <div className="sieve-stage" ref={stageRef} style={{ height: 360 }} role="status" aria-busy="true">
          <span className="vh">{t("loading")}</span>
        </div>
      </section>
    );
  }

  if (facts.all.length === 0) {
    return (
      <section className="step" id="s-sieve" data-step="sieve" aria-labelledby="h-sieve">
        {head}
        <div className="gapbox" data-empty-state={sourcesOn === 0 ? "no_sources" : lastScanAt ? "nothing_found" : "no_scan"}>
          <strong>{sourcesOn === 0 ? t("empty.noSources") : lastScanAt ? t("empty.nothing") : t("empty.noScan")}</strong>
          <span>{sourcesOn === 0 ? t("empty.noSourcesBody") : lastScanAt ? t("empty.nothingBody") : t("empty.noScanBody")}</span>
          {sourcesOn === 0 ? emptyDoor : scanDoor}
          {sourcesOn === 0 ? (
            <a className="btn sm ghost" href="#s-sources">
              {t("toSources")}
            </a>
          ) : null}
        </div>
      </section>
    );
  }

  const bySource = new Set(facts.all.map((r) => r.sourceId));
  const openCatch = (key: string | null) => setCatchKey((cur) => (cur === key ? null : key));
  const catchLayer = catchKey ? model.layers.find((l) => l.key === catchKey) ?? null : null;

  return (
    <section className="step" id="s-sieve" data-step="sieve" aria-labelledby="h-sieve">
      {head}
      <div className="sieve-stage" ref={stageRef} style={{ height: model.H }}>
        <svg
          id="sieveSvg"
          ref={svgRef}
          width={W}
          height={model.H}
          viewBox={`0 0 ${W} ${model.H}`}
          role="img"
          aria-label={t("svgLabel", { n: facts.all.length, scored: facts.scored.length })}
          onClick={(e) => {
            const id = (e.target as Element).getAttribute?.("data-id");
            if (id) onOpen(id);
          }}
        >
          <defs>
            <pattern id="sv-mesh" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M0 5h10M5 0v10" stroke="var(--sv-line)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x={model.x0 - 12} y={0} width={W - model.x0 + 12} height={Math.max(0, model.fieldTop - 6)} fill="url(#sv-mesh)" opacity={0.35} />
          <line x1={18} x2={W - 18} y1={model.fieldTop} y2={model.fieldTop} stroke="var(--sv-line)" strokeWidth={1} />
          {model.layers.map((L) => (
            <g key={L.key}>
              <line x1={18} x2={model.x0 - 22} y1={L.y} y2={L.y} stroke="var(--sv-line-2)" strokeWidth={1} />
              <line
                x1={model.x0 - 10}
                x2={W - 8}
                y1={L.y + 1}
                y2={L.y + 1}
                stroke={L.kind === "door" ? "var(--sv-held)" : L.kind === "wait" ? "var(--sv-line-2)" : "var(--sv-caught)"}
                strokeWidth={4}
                strokeDasharray="9 5"
                strokeLinecap="round"
              />
            </g>
          ))}
          {model.ghosts.map((g, i) => (
            <circle key={`g${i}`} cx={g.x} cy={g.y} r={g.r} fill="none" stroke="var(--sv-ink-3)" strokeWidth={1.3} strokeDasharray="2 1.6" />
          ))}
          <line x1={18} x2={W - 18} y1={model.base + 1} y2={model.base + 1} stroke="var(--sv-ink-2)" strokeWidth={1.5} />
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={model.fx(v)} x2={model.fx(v)} y1={model.base + 1} y2={model.base + 7} stroke="var(--sv-ink-2)" />
              <text x={model.fx(v)} y={model.base + 24} fontSize={14} textAnchor="middle" fill="var(--sv-ink-3)" fontFamily="var(--sv-sans)">
                {v}
              </text>
            </g>
          ))}
          <text x={W - 18} y={model.base + 42} fontSize={14} textAnchor="end" fill="var(--sv-ink-3)" fontFamily="var(--sv-sans)">
            {t("scoreAxis")}
          </text>
          {model.dots.map((d) => (
            <circle key={d.id} data-id={d.id} className={cx("d", d.cls)} r={d.r} cx={d.x} cy={d.y} />
          ))}
          {model.layers
            .filter((L) => L.overflow > 0)
            .map((L) => (
              <text key={`more-${L.key}`} x={W - 18} y={L.y - 8} textAnchor="end" fontSize={14} fontWeight={700} fill="var(--sv-ink-2)" fontFamily="var(--sv-sans)">
                {t("more", { n: L.overflow })}
              </text>
            ))}
        </svg>

        <div className="layer-lbl hop" style={{ top: 14, width: Math.max(200, model.x0 - 34) }}>
          <span className="ln">{facts.all.length}</span>
          <div>
            <div className="lt">{t("pouredIn")}</div>
            <div className="ls">{t("pouredFrom", { sources: bySource.size })}</div>
          </div>
        </div>
        {model.layers.map((L) => (
          <div key={L.key} className={cx("layer-lbl", L.kind)} style={{ top: L.top, width: Math.max(200, model.x0 - 34) }}>
            {/* keyed by the count: the pour writes this text directly, and a new count must
                mount a fresh node rather than update the one the pour replaced */}
            <span key={`${L.key}:${L.items.length}`} className="ln" data-lc={L.key}>
              {L.items.length}
            </span>
            <div>
              <div className="lt">{L.kind === "door" ? t("door") : L.kind === "wait" ? t("waiting") : tGate(`label.${L.key as KoReasonKey}`)}</div>
              <div className="ls">
                {L.kind === "door"
                  ? t("doorWhy", { sources: Array.from(new Set(L.items.map((r) => sourceLabel(r.sourceId)))).join(", ") })
                  : L.kind === "wait"
                    ? t("waitingWhy")
                    : L.also.length
                      ? t("gateAlso", { all: L.all.length, also: L.also.length })
                      : t("gateNotZero")}
              </div>
              <button type="button" className={cx(SV_BTN_SM_GHOST, "lb")} aria-expanded={catchKey === L.key} onClick={() => openCatch(L.key)}>
                {L.kind === "door" ? t("seeHeld") : t("seeCaught", { n: L.all.length })}
              </button>
              {L.kind === "door" ? (
                <a className="btn sm ghost lb" href="#s-sources">
                  {t("decideSources")}
                </a>
              ) : null}
            </div>
          </div>
        ))}
        <div className="layer-lbl field" style={{ top: model.fieldTop + 12, width: Math.max(200, model.x0 - 34) }}>
          <span key={`field:${facts.scored.length}`} className="ln" data-lc="field">
            {facts.scored.length}
          </span>
          <div>
            <div className="lt">{t("through")}</div>
            <div className="ls">{t("throughHint")}</div>
            <a className="btn sm ghost lb" href="#s-evening">
              {t("toRanking")}
            </a>
          </div>
        </div>
      </div>

      <div className="funnel-line">
        {t.rich("funnel", {
          found: facts.all.length,
          held: facts.held.length,
          caught: facts.gated.length,
          waiting: facts.waiting.length,
          scored: facts.scored.length,
          top: facts.top5.length,
          b: (c) => <b>{c}</b>,
          a: (c) => <span className="arr">{c}</span>,
        })}
      </div>
      <div className="sieve-legend">
        {facts.held.length ? (
          <span>
            <i className="k-held" />
            {t("legend.held")}
          </span>
        ) : null}
        <span>
          <i className="k-caught" />
          {t("legend.caught")}
        </span>
        <span>
          <i className="k-double" />
          {t("legend.double")}
        </span>
        <span>
          <i className="k-ghost" />
          {t("legend.ghost")}
        </span>
        {facts.waiting.length ? (
          <span>
            <i className="k-wait" />
            {t("legend.waiting")}
          </span>
        ) : null}
        <span>
          <i className="k-strong" />
          {t("legend.strong")}
        </span>
        <span>
          <i className="k-promising" />
          {t("legend.promising")}
        </span>
        <span>
          <i className="k-partial" />
          {t("legend.partial")}
        </span>
        <button
          type="button"
          className={SV_BTN_SM_GHOST}
          onClick={() => {
            positions.current = new Map();
            poured.current = false;
            setPourRun((n) => n + 1);
          }}
        >
          {t("pourAgain")}
        </button>
      </div>

      {catchLayer ? (
        <div className="catch-panel">
          <div className="cp-head">
            <div>
              <h3>
                {catchLayer.kind === "door"
                  ? t("catch.heldTitle", { n: catchLayer.all.length })
                  : catchLayer.kind === "wait"
                    ? t("catch.waitTitle", { n: catchLayer.all.length })
                    : t("catch.gateTitle", { n: catchLayer.all.length, gate: tGate(`label.${catchLayer.key as KoReasonKey}`) })}
              </h3>
              <div className="muted">
                {catchLayer.kind === "door" ? t("catch.heldBody") : catchLayer.kind === "wait" ? t("catch.waitBody") : t("catch.gateBody", { both: catchLayer.all.filter((r) => r.blockedBy.length > 1).length })}
              </div>
            </div>
            <button type="button" className={SV_BTN_SM_GHOST} onClick={() => setCatchKey(null)}>
              {t("catch.close")}
            </button>
          </div>
          <div className="catch-list">
            {[...catchLayer.all]
              .sort((a, b) => (catchLayer.kind === "gate" ? asIf(b) - asIf(a) : a.title.localeCompare(b.title)))
              .map((row) => (
                <button key={row.id} type="button" className={SV_CATCH_ROW} onClick={() => onOpen(row.id)}>
                  <span>
                    <span className="t">{row.title}</span>
                    <span className="m">
                      {[row.company, row.location].filter(Boolean).join(" · ")}
                      {row.blockedDetails.length ? ` · ${row.blockedDetails.join("; ")}` : ""}
                    </span>
                  </span>
                  <span className="gates">
                    {catchLayer.kind === "door" ? (
                      <span className="gchip held">{sourceLabel(row.sourceId)}</span>
                    ) : (
                      row.blockedBy.map((g) => (
                        <span key={g} className="gchip">
                          {tGate(`label.${g}`)}
                        </span>
                      ))
                    )}
                  </span>
                  <span className="asif">
                    {catchLayer.kind === "gate" ? (
                      row.asIfTotal !== null ? (
                        t.rich("catch.wouldHave", { n: row.asIfTotal, b: (c) => <b>{c}</b> })
                      ) : (
                        t("catch.noAsIf")
                      )
                    ) : catchLayer.kind === "door" ? (
                      t("catch.notRead")
                    ) : (
                      t("catch.notScored")
                    )}
                  </span>
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
