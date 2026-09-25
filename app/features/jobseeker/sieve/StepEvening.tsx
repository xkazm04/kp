"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { FIT_TIERS, POSTING_STATUSES, WORK_MODES, type FeedNewSince } from "@/app/_lib/jobseeker/types";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { isNewerThanAnchor } from "../feedModel";
import { BandGlyph, Pip, Pips, ProvMark, StatusChip, TargetMark, TierChip } from "./marks";
import {
  applyDirection,
  directionFilterOn,
  directionOf,
  EMPTY_FILTER,
  filterScored,
  inDirection,
  isFilterActive,
  liftSkills,
  provenanceOf,
  type ListFilter,
  type SieveFacts,
  type SievePosting,
} from "./sieveModel";
import { cx, SV_BTN_SM_GHOST, SV_CARD, SV_CHIP_BTN, SV_FCHIP, SV_LINK_BTN, SV_ROW } from "./sieveRecipes";

// Step 6 — "Worth your evening". The ranking, three ways at once:
//   the SKYLINE  every scored posting as a bar — the bar is the confidence band, the line
//                across it is the score — so 98 postings read as one shape; drag across it
//                (or Shift+arrows) to pick a range and the list below follows
//   the FIVE     the best still-open postings as cards: score and band, the skills met
//                (drawn by where the seeker's claim comes from), what is missing, pay as
//                the ad stated it, the five checks as pips
//   the LIST     every scored posting in its own scroller, searchable and filterable, 98
//                rows as calm as 6
// A day whose best posting is only a partial fit says so first, as a starting point and
// not a verdict, and names the skills that would lift the most scores at once.
//
// DIRECTION is a view over the ranking, not a layer of the sieve: "Your direction" keeps
// the list to postings on the seeker's stated way (a target title or a target family),
// on by default once they named a title and something matches it, and it says how many
// it hides. The top five stay the sieve's ranking and carry the bullseye instead.

export function payText(row: Pick<SievePosting, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">, locale: string, perMonth: string, perYear: string): string | null {
  if (!row.salaryCurrency || (row.salaryMin === null && row.salaryMax === null)) return null;
  const f = new Intl.NumberFormat(locale);
  const lo = row.salaryMin ?? row.salaryMax!;
  const hi = row.salaryMax ?? row.salaryMin!;
  const range = lo === hi ? f.format(lo) : `${f.format(lo)}–${f.format(hi)}`;
  const per = row.salaryPeriod === "year" ? perYear : row.salaryPeriod === "month" ? perMonth : "";
  return `${range} ${row.salaryCurrency}${per ? ` ${per}` : ""}`;
}

export function StepEvening({
  facts,
  hasProfile,
  loading,
  locale,
  openId,
  guidedId,
  newSince,
  onMarkSeen,
  onOpen,
  onOrderChange,
  loadError,
  targetTitles,
  skillless,
  polishing,
  onPolish,
}: {
  facts: SieveFacts | null;
  hasProfile: boolean;
  loading: boolean;
  locale: string;
  openId: string | null;
  /** The posting whose fit conversation settled — flagged on its card. */
  guidedId: string | null;
  newSince: FeedNewSince;
  onMarkSeen(): void;
  onOpen(id: string): void;
  /** The list's current order, so J/K on the Weigh step walks what the seeker sees. */
  onOrderChange(ids: string[]): void;
  loadError: ReactNode;
  /** How many target titles the seeker stated: the direction filter's default. */
  targetTitles: number;
  /** The profile claims no skill at all: every score is field and level only. */
  skillless: boolean;
  polishing: boolean;
  /** Opens the CV studio (the polish conversation). */
  onPolish(): void;
}) {
  const t = useTranslations("me.sieve.evening");
  const tPrefs = useTranslations("me.preferences");
  const tMode = useTranslations("me.preferences.workMode");
  const tTier = useTranslations("me.sieve.tier");
  const tStatus = useTranslations("me.sieve.status");
  const tDir = useTranslations("me.sieve.direction");
  const rel = useRelativeTime();
  const [f, setF] = useState<ListFilter>(EMPTY_FILTER);
  // null = untouched: the default follows the facts (directionFilterOn).
  const [dirChoice, setDirChoice] = useState<boolean | null>(null);
  const [skyFocus, setSkyFocus] = useState(0);
  const [skyKeyed, setSkyKeyed] = useState(false);
  const skyHost = useRef<HTMLDivElement | null>(null);
  const [skyW, setSkyW] = useState(900);
  const perMonth = tPrefs("period.month");
  const perYear = tPrefs("period.year");

  const dirOffered = !!facts && facts.scored.some(inDirection);
  const dirOn = !!facts && directionFilterOn(dirChoice, targetTitles, facts.scored);
  const { rows, hidden: dirHidden } = useMemo(() => applyDirection(facts ? filterScored(facts.scored, f) : [], dirOn), [facts, f, dirOn]);
  useEffect(() => {
    onOrderChange(rows.map((r) => r.id));
  }, [rows, onOrderChange]);

  const ready = !!facts && !loading && hasProfile;
  useEffect(() => {
    const el = skyHost.current;
    if (!el) return;
    const measure = () => setSkyW(Math.max(300, Math.round(el.clientWidth || 900)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // "New" is ONE rule, applied to the rows this step shows: the chips and the header count
  // both come from it, against the full stored anchor tuple (at AND id), so the anchor row
  // the seeker already saw is never chipped and the count equals the chips on screen.
  const anchor = newSince ? { at: newSince.anchorAt, id: newSince.anchorId } : null;
  const isNew = (r: SievePosting) => !!anchor && isNewerThanAnchor({ at: r.firstSeenAt, id: r.id }, anchor);
  const newCount = facts && anchor ? facts.scored.filter(isNew).length : 0;

  const head = (title: string, lede?: string) => (
    <div className="step-head">
      <div className="grow">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2 id="h-evening">{title}</h2>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {newCount > 0 ? (
        <span className="scanline">
          <span className="chip st-new">{t("newSince", { count: newCount })}</span>
          <button type="button" className={SV_BTN_SM_GHOST} onClick={onMarkSeen}>
            {t("markSeen")}
          </button>
        </span>
      ) : null}
    </div>
  );

  if (!hasProfile || !facts || loading) {
    return (
      <section className="step" id="s-evening" data-step="evening" aria-labelledby="h-evening">
        {head(t("titleEmpty"))}
        {loadError ?? (
          <div className="gapbox">
            <strong>{hasProfile ? t("loading") : t("notReached")}</strong>
            {hasProfile ? null : <span>{t("notReachedBody")}</span>}
          </div>
        )}
      </section>
    );
  }

  if (facts.scored.length === 0) {
    return (
      <section className="step" id="s-evening" data-step="evening" aria-labelledby="h-evening">
        {head(t("titleEmpty"))}
        <div className="gapbox" data-empty-state="nothing_scored">
          <strong>{facts.all.length ? t("noneScored") : t("nothingYet")}</strong>
          <span>{facts.all.length ? t("noneScoredBody", { caught: facts.gated.length, waiting: facts.waiting.length, held: facts.held.length }) : t("nothingYetBody")}</span>
        </div>
      </section>
    );
  }

  const anyGood = facts.strong + facts.promising > 0;
  const best = facts.open[0];
  const lift = liftSkills(facts.open);
  const n = facts.scored.length;
  const top = new Map(facts.top5.map((r, i) => [r.id, i + 1]));
  const tierCounts = new Map<string, number>();
  const modeCounts = new Map<string, number>();
  for (const r of facts.scored) {
    if (r.fitTier) tierCounts.set(r.fitTier, (tierCounts.get(r.fitTier) ?? 0) + 1);
    if (r.workMode) modeCounts.set(r.workMode, (modeCounts.get(r.workMode) ?? 0) + 1);
  }

  // ---- skyline geometry ----
  const H = 250;
  const L = 36;
  const R = 10;
  const T = 24;
  const B = 30;
  const step = (skyW - L - R) / Math.max(1, n);
  const bw = Math.max(3, Math.min(18, step * 0.72));
  const y = (v: number) => T + ((100 - v) / 100) * (H - T - B);

  return (
    <section className="step" id="s-evening" data-step="evening" aria-labelledby="h-evening">
      {head(anyGood ? t("title", { n: Math.min(5, facts.top5.length) }) : t("titlePartial"), anyGood ? t("lede") : undefined)}

      {skillless ? (
        // A profile that lists no skill is scored on field and level alone (measured:
        // 25-42 "partial" for unrelated roles). Said once, calmly, with the way out.
        <div className="notice info ev-note" role="note">
          <span>{t("noSkills")}</span>
          <a className="btn sm ghost" href="#s-arrive">
            {t("noSkillsDrop")}
          </a>
          <button type="button" className={SV_BTN_SM_GHOST} onClick={onPolish} disabled={polishing} aria-busy={polishing || undefined}>
            {t("noSkillsPolish")}
          </button>
        </div>
      ) : null}

      {!anyGood && best && best.confidence ? (
        <div className="honest-top">
          {t.rich("partialNote", { score: best.matchTotal ?? 0, low: best.confidence.low, high: best.confidence.high, b: (c) => <b>{c}</b> })}
        </div>
      ) : null}

      {lift.list.length ? (
        <div className="lift">
          <span className="lk">{t("lift")}</span>
          {lift.list.map((x) => (
            <button
              key={x.skill}
              type="button"
              className={SV_CHIP_BTN}
              onClick={() => {
                setF({ ...EMPTY_FILTER, q: x.skill });
                document.getElementById("sv-plist")?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              {t("liftChip", { skill: x.skill, count: x.count, pool: lift.pool })}
            </button>
          ))}
        </div>
      ) : null}

      <div className="skyline-wrap">
        <div className="sky-head">
          <div>
            <h3>{t("skyTitle", { n })}</h3>
            <div className="sky-sel" role="status" aria-live="polite">
              {skyKeyed && facts.scored[skyFocus]
                ? t("skyFocus", {
                    rank: skyFocus + 1,
                    title: facts.scored[skyFocus]!.title,
                    score: facts.scored[skyFocus]!.matchTotal ?? 0,
                    low: facts.scored[skyFocus]!.confidence?.low ?? 0,
                    high: facts.scored[skyFocus]!.confidence?.high ?? 0,
                  })
                : f.brush
                  ? t("skyRange", { from: f.brush[0] + 1, to: f.brush[1] + 1 })
                  : t("skyAll")}
            </div>
          </div>
          <div className="seg" role="group" aria-label={t("rangeLabel")}>
            {([5, 10, 25, 0] as const).map((k) => {
              const on = k === 0 ? !f.brush : !!f.brush && f.brush[0] === 0 && f.brush[1] === Math.min(n, k) - 1;
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => setF((cur) => ({ ...cur, brush: k === 0 ? null : [0, Math.min(n, k) - 1] }))}>
                  {k === 0 ? t("rangeAll") : t("rangeTop", { n: k })}
                </button>
              );
            })}
          </div>
        </div>
        <div ref={skyHost}>
          <svg
            className="skyline"
            tabIndex={0}
            width={skyW}
            height={H}
            viewBox={`0 0 ${skyW} ${H}`}
            // Focusable and keyboard-driven, so it is announced as a control, not a
            // picture: a slider over the ranks, its value the posting under the cursor.
            role="slider"
            aria-label={t("skyLabel", { n })}
            aria-valuemin={1}
            aria-valuemax={n}
            aria-valuenow={Math.min(n, skyFocus + 1)}
            aria-valuetext={
              facts.scored[skyFocus]
                ? t("skyFocus", {
                    rank: skyFocus + 1,
                    title: facts.scored[skyFocus]!.title,
                    score: facts.scored[skyFocus]!.matchTotal ?? 0,
                    low: facts.scored[skyFocus]!.confidence?.low ?? 0,
                    high: facts.scored[skyFocus]!.confidence?.high ?? 0,
                  })
                : undefined
            }
            aria-orientation="horizontal"
            onPointerDown={(e) => {
              // The drag's anchor rides on the element itself: a pointer gesture is not state.
              const r = e.currentTarget.getBoundingClientRect();
              const a = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - L) / step)));
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              e.currentTarget.dataset.drag = String(a);
            }}
            onPointerMove={(e) => {
              const a = e.currentTarget.dataset.drag;
              if (a === undefined) return;
              const r = e.currentTarget.getBoundingClientRect();
              const b = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - L) / step)));
              const brush = e.currentTarget.querySelector<SVGRectElement>("#sv-brush");
              if (brush && b !== Number(a)) {
                const a0 = Math.min(Number(a), b);
                const a1 = Math.max(Number(a), b);
                brush.setAttribute("x", String(L + a0 * step));
                brush.setAttribute("width", String((a1 - a0 + 1) * step));
                brush.setAttribute("opacity", "0.16");
              }
            }}
            onPointerUp={(e) => {
              const a = e.currentTarget.dataset.drag;
              delete e.currentTarget.dataset.drag;
              if (a === undefined) return;
              const r = e.currentTarget.getBoundingClientRect();
              const b = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - L) / step)));
              if (b === Number(a)) {
                onOpen(facts.scored[b]!.id);
                return;
              }
              setF((cur) => ({ ...cur, brush: [Math.min(Number(a), b), Math.max(Number(a), b)] }));
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = Math.max(0, Math.min(n - 1, skyFocus + (e.key === "ArrowRight" ? 1 : -1)));
                setSkyKeyed(true);
                if (e.shiftKey) {
                  const a0 = f.brush ?? [skyFocus, skyFocus];
                  setF((cur) => ({ ...cur, brush: [Math.min(a0[0], next), Math.max(a0[1], next)] }));
                }
                setSkyFocus(next);
              } else if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                setSkyKeyed(true);
                setSkyFocus(e.key === "Home" ? 0 : n - 1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                onOpen(facts.scored[skyFocus]!.id);
              }
            }}
            onBlur={() => setSkyKeyed(false)}
          >
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={L} x2={skyW - R} y1={y(v)} y2={y(v)} stroke="var(--sv-line)" strokeWidth={1} />
                <text x={L - 6} y={y(v) + 5} fontSize={14} textAnchor="end" fill="var(--sv-ink-3)" fontFamily="var(--sv-sans)">
                  {v}
                </text>
              </g>
            ))}
            {f.brush ? <rect x={L + f.brush[0] * step} y={T - 18} width={(f.brush[1] - f.brush[0] + 1) * step} height={H - T - B + 20} fill="var(--sv-accent)" opacity={0.1} rx={4} /> : null}
            <rect id="sv-brush" x={0} y={T - 18} width={0} height={H - T - B + 20} fill="var(--sv-accent)" opacity={0} />
            {facts.scored.map((r, i) => {
              const c = r.confidence ?? { low: r.matchTotal ?? 0, high: r.matchTotal ?? 0 };
              const x = L + i * step + (step - bw) / 2;
              const tp = top.get(r.id);
              const col = `var(--sv-${r.fitTier ?? "partial"})`;
              const op = tp ? 0.55 : r.status === "new" || r.status === "shortlisted" ? 0.3 : 0.14;
              const sy = H - B + 12;
              const focus = openId === r.id || (skyKeyed && skyFocus === i);
              return (
                <g key={r.id}>
                  <rect x={x} y={y(c.high)} width={bw} height={Math.max(2, y(c.low) - y(c.high))} rx={Math.min(3, bw / 2)} fill={col} fillOpacity={op} stroke={col} strokeOpacity={tp ? 1 : 0.5} />
                  <line x1={x - 1.5} x2={x + bw + 1.5} y1={y(r.matchTotal ?? 0)} y2={y(r.matchTotal ?? 0)} stroke={tp ? "var(--sv-ink)" : col} strokeWidth={tp ? 3 : 2} />
                  {tp ? (
                    <text x={x + bw / 2} y={y(c.high) - 6} fontSize={14} fontWeight={700} textAnchor="middle" fill="var(--sv-ink)" fontFamily="var(--sv-sans)">
                      {tp}
                    </text>
                  ) : null}
                  {r.status === "applied" ? <rect x={x + bw / 2 - 4} y={sy - 4} width={8} height={8} fill="var(--sv-ink)" /> : null}
                  {r.status === "shortlisted" ? <circle cx={x + bw / 2} cy={sy} r={4.5} fill="var(--sv-accent)" /> : null}
                  {r.status === "dismissed" ? <path d={`M${x + bw / 2 - 4} ${sy - 4}l8 8m0 -8l-8 8`} stroke="var(--sv-ink-3)" strokeWidth={1.8} /> : null}
                  {r.status === "gone" ? <circle cx={x + bw / 2} cy={sy} r={4} fill="none" stroke="var(--sv-ink-3)" strokeDasharray="2 1.5" /> : null}
                  {focus ? <rect x={x - 3} y={y(c.high) - 3} width={bw + 6} height={y(c.low) - y(c.high) + 6} fill="none" stroke="var(--sv-accent)" strokeWidth={2} rx={4} /> : null}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="pip-legend">
          <span>
            <i className="sw-strong" />
            {tTier("strong")}
          </span>
          <span>
            <i className="sw-promising" />
            {tTier("promising")}
          </span>
          <span>
            <i className="sw-partial" />
            {tTier("partial")}
          </span>
          <span>{t("skyKey")}</span>
          <span>{t("skyMarks")}</span>
          <span>{t("skyHow")}</span>
        </div>
      </div>

      <div className="top5">
        {facts.top5.length === 0 ? (
          <div className="gapbox">{t("nothingOpen")}</div>
        ) : (
          facts.top5.map((r, i) => {
            const pay = payText(r, locale, perMonth, perYear);
            return (
              <button key={r.id} type="button" className={SV_CARD} onClick={() => onOpen(r.id)}>
                <span className="rk">{i + 1}</span>
                {r.id === guidedId ? <span className="flagged">{t("guided")}</span> : null}
                <span className="tt">{r.title}</span>
                {directionOf(r)?.state === "target" ? (
                  <span className="dirmark">
                    <TargetMark size={12} />
                    {tDir("mark")}
                  </span>
                ) : null}
                <span className="meta">{[r.company, r.location, r.workMode ? tMode(r.workMode) : null].filter(Boolean).join(" · ")}</span>
                <span className="scoreline">
                  <span className="sc">{r.matchTotal}</span>
                  {r.confidence ? (
                    <span className="band">
                      <BandGlyph total={r.matchTotal ?? 0} low={r.confidence.low} high={r.confidence.high} tier={r.fitTier} width={96} />
                      <br />
                      {t("band", { low: r.confidence.low, high: r.confidence.high })}
                    </span>
                  ) : null}
                  <TierChip tier={r.fitTier} />
                </span>
                <span className="skl">
                  {r.matchedSkills.slice(0, 4).map((s) => {
                    const pv = provenanceOf(s.provenance);
                    return (
                      <span key={s.skill} className={cx("sk", pv.stated && "st")}>
                        <ProvMark mark={pv.mark} size={12} />
                        {s.skill}
                      </span>
                    );
                  })}
                  {r.missingSkills.length ? <span className="sk miss">{t("missing", { n: r.missingSkills.length, list: r.missingSkills.slice(0, 2).join(", ") })}</span> : null}
                </span>
                <span className="cardfoot">
                  {pay ? <span className="pay">{pay}</span> : <span className="pay muted">{t("payUnstated")}</span>}
                  <Pips flags={r.eligibility} />
                </span>
                <span className="cardfoot">
                  <span className="small muted">{r.postedAt ? t("posted", { when: rel(r.postedAt) }) : t("seen", { when: rel(r.firstSeenAt) })}</span>
                  {isNew(r) ? <span className="chip st-new">{t("new")}</span> : <StatusChip status={r.status} />}
                </span>
              </button>
            );
          })
        )}
      </div>

      <h3>{t("allTitle")}</h3>
      <div className="filters">
        <input type="search" placeholder={t("search")} aria-label={t("search")} value={f.q} onChange={(e) => setF((cur) => ({ ...cur, q: e.target.value }))} />
        {dirOffered ? (
          <button type="button" className={SV_FCHIP} aria-pressed={dirOn} onClick={() => setDirChoice(!dirOn)}>
            <TargetMark size={12} />
            {tDir("filter")}
          </button>
        ) : null}
        <span className="fchips" role="group" aria-label={t("fitLabel")}>
          {FIT_TIERS.filter((k) => tierCounts.get(k)).map((k) => {
            const on = f.tiers.includes(k);
            return (
              <button key={k} type="button" className={SV_FCHIP} aria-pressed={on} onClick={() => setF((cur) => ({ ...cur, tiers: on ? cur.tiers.filter((x) => x !== k) : [...cur.tiers, k] }))}>
                {tTier(k)} <span className="c">{tierCounts.get(k)}</span>
              </button>
            );
          })}
        </span>
        <span className="fchips" role="group" aria-label={t("modeLabel")}>
          {WORK_MODES.filter((k) => modeCounts.get(k)).map((k) => {
            const on = f.modes.includes(k);
            return (
              <button key={k} type="button" className={SV_FCHIP} aria-pressed={on} onClick={() => setF((cur) => ({ ...cur, modes: on ? cur.modes.filter((x) => x !== k) : [...cur.modes, k] }))}>
                {tMode(k)} <span className="c">{modeCounts.get(k)}</span>
              </button>
            );
          })}
        </span>
        <select aria-label={t("statusLabel")} value={f.status} onChange={(e) => setF((cur) => ({ ...cur, status: e.target.value as ListFilter["status"] }))}>
          <option value="">{t("anyStatus")}</option>
          {POSTING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus(s)}
            </option>
          ))}
        </select>
        <select aria-label={t("sortLabel")} value={f.sort} onChange={(e) => setF((cur) => ({ ...cur, sort: e.target.value as ListFilter["sort"] }))}>
          <option value="score">{t("sort.score")}</option>
          <option value="new">{t("sort.new")}</option>
          <option value="narrow">{t("sort.narrow")}</option>
        </select>
      </div>
      <div className="list-meta">
        <span className="muted" role="status">
          {t("showing", { shown: rows.length, total: n })}
          {f.brush ? ` · ${t("skyRange", { from: f.brush[0] + 1, to: f.brush[1] + 1 })}` : ""}
          {dirOn && dirHidden > 0 ? ` · ${tDir("hides", { n: dirHidden })}` : ""}
        </span>
        <span className="pip-legend">
          <span>{t("checksKey")}</span>
          <span>
            <Pip state="ok" />
            {t("checkOk")}
          </span>
          <span>
            <Pip state="flag" />
            {t("checkFlag")}
          </span>
          <span>
            <Pip state="unknown" />
            {t("checkUnknown")}
          </span>
        </span>
      </div>
      <div className="plist" id="sv-plist">
        <div className="prow plist-head" aria-hidden>
          <span>#</span>
          <span>{t("col.posting")}</span>
          <span>{t("col.score")}</span>
          <span className="payc">{t("col.pay")}</span>
          <span className="pips">{t("col.checks")}</span>
          <span className="when">{t("col.posted")}</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            {t("noMatch")}{" "}
            {isFilterActive(f) || dirOn ? (
              <button
                type="button"
                className={SV_LINK_BTN}
                onClick={() => {
                  setF(EMPTY_FILTER);
                  if (dirOn) setDirChoice(false);
                }}
              >
                {t("clearFilters")}
              </button>
            ) : null}
          </div>
        ) : (
          rows.map((r) => {
            const pay = payText(r, locale, perMonth, perYear);
            return (
              <button key={r.id} type="button" className={cx(SV_ROW, openId === r.id && "cur")} onClick={() => onOpen(r.id)}>
                <span className="rk">{facts.rank[r.id]}</span>
                <span className="pt">
                  <span className="t">
                    {directionOf(r)?.state === "target" ? (
                      <>
                        <TargetMark size={12} />
                        <span className="vh">{tDir("mark")}</span>{" "}
                      </>
                    ) : null}
                    {r.title}
                  </span>
                  <span className="m">
                    {isNew(r) ? `${t("new")} · ` : ""}
                    {r.status !== "new" ? `${tStatus(r.status)} · ` : ""}
                    {r.id === guidedId ? `${t("guided")} · ` : ""}
                    {[r.company, r.location, r.workMode ? tMode(r.workMode) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="bnd">
                  <b>{r.matchTotal}</b>
                  {r.confidence ? <BandGlyph total={r.matchTotal ?? 0} low={r.confidence.low} high={r.confidence.high} tier={r.fitTier} width={90} /> : null}
                </span>
                <span className="payc">{pay ? <span className="pay">{pay}</span> : <span className="pay muted">{t("payUnstated")}</span>}</span>
                <Pips flags={r.eligibility} />
                <span className="when">{rel(r.postedAt ?? r.firstSeenAt)}</span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
