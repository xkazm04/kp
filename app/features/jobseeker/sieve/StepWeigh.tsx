"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { DismissReason, FitArtifact, JobseekerDialog, JobseekerPostingSummary, PostingStatus, SalaryFloor, SourceTier } from "@/app/_lib/jobseeker/types";
import { DISMISS_REASONS } from "@/app/_lib/jobseeker/types";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "../apiFailure";
import type { StudioDegradation } from "../CvStudio";
import { FailureNotice } from "../FailureNotice";
import { compareSalary } from "../feedModel";
import { FitStudio } from "../FitStudio";
import { diveOutcome, reasoningView, type DiveOutcome, type PostingDetailView } from "../postingView";
import { payText } from "./StepEvening";
import { Pip, ProvMark, StatusChip, TierChip } from "./marks";
import { provenanceOf } from "./sieveModel";
import { cx, SV_BTN, SV_BTN_ACCENT, SV_BTN_SM, SV_BTN_SM_ACCENT, SV_BTN_SM_GHOST, SV_REASON } from "./sieveRecipes";

// Step 7 — Weigh one posting. Left: the score as a BAND on a gauge (the number, and the
// range it could really be), what the number is made of (three contributions that sum
// to it), the skills against the ad (each matched skill drawn by where the seeker's
// claim comes from), the fit conversation's gaps when one was had, the deep read, and
// the ad itself folded away. Right: the five checks of the seeker's own preferences,
// pay compared to their floor in ONE currency (never converted), where the posting came
// from, and — after a fit conversation — the questions to ask and the cover-note draft.
//
// The decision bar stays under the reader's thumb (sticky): Apply opens the ad on the
// employer's site and only THEN offers "I applied — mark it"; Let go asks why (the
// reason is what the coach learns from); every move is undoable. A / S / D decide, J / K
// walk the list the seeker is looking at.

type Detail = {
  view: PostingDetailView;
  fit: { artifact: FitArtifact; at: string } | null;
  source: { id: string; tier: SourceTier; host: string } | null;
};
type Pop = "apply" | "dismiss" | null;
type StudioState = { dialog: JobseekerDialog; degradation: StudioDegradation | null } | null;

/** One posting through GET /api/jobseeker/postings/[id]; touches no state. */
async function fetchDetail(id: string): Promise<{ ok: true; detail: Detail } | { ok: false; fail: ClassifiedFailure }> {
  try {
    const res = await fetch(`/api/jobseeker/postings/${encodeURIComponent(id)}`);
    const body = (await res.json().catch(() => null)) as (Detail & { code?: string }) | null;
    if (!res.ok || !body?.view) return { ok: false, fail: classifyApiFailure(res, body) };
    return { ok: true, detail: { view: body.view, fit: body.fit ?? null, source: body.source ?? null } };
  } catch {
    return { ok: false, fail: TRANSPORT_FAILURE };
  }
}

function splitCite(text: string): { text: string; cite: string } {
  const i = text.indexOf("Cited:");
  return i < 0 ? { text, cite: "" } : { text: text.slice(0, i).trim(), cite: text.slice(i + 6).trim() };
}

export function StepWeigh({
  openId,
  row,
  rank,
  total,
  order,
  profileId,
  salaryFloor,
  locale,
  navActive,
  decideActive,
  onOpen,
  onRowUpdate,
  onToast,
  suggestions,
}: {
  openId: string | null;
  row: JobseekerPostingSummary | null;
  rank: number | null;
  total: number;
  /** The list order the seeker is looking at, for J/K and "3 of 54". */
  order: string[];
  profileId: string | null;
  salaryFloor: SalaryFloor | null;
  locale: string;
  /** J / K walk the list while the ranking or this step is on screen. */
  navActive: boolean;
  /** A / S / D decide only while THIS step is on screen: a decision is never made on a
   *  posting the reader cannot see. */
  decideActive: boolean;
  onOpen(id: string): void;
  onRowUpdate(row: JobseekerPostingSummary): void;
  onToast(message: string): void;
  /** Postings to offer when nothing is open yet. */
  suggestions: JobseekerPostingSummary[];
}) {
  const t = useTranslations("me.sieve.weigh");
  const tPost = useTranslations("me.posting");
  const tPrefs = useTranslations("me.preferences");
  const tDismiss = useTranslations("me.jobs.dismiss.reason");
  const tChecks = useTranslations("me.sieve.checks");
  const tGate = useTranslations("me.sieve.gate");
  const tStatus = useTranslations("me.sieve.status");
  const resolveError = useErrorMessage();
  const rel = useRelativeTime();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<ClassifiedFailure | null>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<ClassifiedFailure | null>(null);
  const [cover, setCover] = useState<Record<string, string>>({});
  const [studio, setStudio] = useState<StudioState>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<ClassifiedFailure | null>(null);
  const [dive, setDive] = useState<{ reasoning: PostingDetailView["reasoning"]; outcome: Exclude<DiveOutcome, "failed"> } | null>(null);
  const [diving, setDiving] = useState(false);
  const [diveError, setDiveError] = useState<ClassifiedFailure | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  const load = useCallback(
    (id: string) =>
      fetchDetail(id).then((r) => {
        if (!r.ok) {
          setDetailError(r.fail);
          return;
        }
        setDetailError(null);
        setDetail(r.detail);
      }),
    []
  );

  // A new posting opened: forget the last one's transient state, then read this one.
  const [shownId, setShownId] = useState<string | null>(null);
  if (openId !== shownId) {
    setShownId(openId);
    setPop(null);
    setWriteError(null);
    setDive(null);
    setDiveError(null);
    setOpenError(null);
    if (!openId) setDetail(null);
  }
  useEffect(() => {
    if (openId) void load(openId);
  }, [openId, load]);

  const status: PostingStatus = row?.status ?? detail?.view.status ?? "new";
  const pos = openId ? order.indexOf(openId) : -1;
  const nav = useCallback(
    (dir: number) => {
      if (!order.length) return;
      const next = pos < 0 ? order[0] : order[Math.max(0, Math.min(order.length - 1, pos + dir))];
      if (next && next !== openId) onOpen(next);
    },
    [order, pos, openId, onOpen]
  );

  const write = useCallback(
    async (next: Exclude<PostingStatus, "gone">, reason?: DismissReason) => {
      if (!openId || busy) return;
      setBusy(true);
      setWriteError(null);
      try {
        const res = await fetch(`/api/jobseeker/postings/${encodeURIComponent(openId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next, ...(reason ? { dismissReason: reason } : {}) }),
        });
        const body = (await res.json().catch(() => null)) as { posting?: JobseekerPostingSummary; code?: string } | null;
        if (!res.ok || !body?.posting) {
          setWriteError(classifyApiFailure(res, body));
          return;
        }
        setPop(null);
        onRowUpdate(body.posting);
        onToast(next === "new" ? t("toast.undone") : t("toast.moved", { status: tStatus(next) }));
      } catch {
        setWriteError(TRANSPORT_FAILURE);
      } finally {
        setBusy(false);
      }
    },
    [openId, busy, onRowUpdate, onToast, t, tStatus]
  );

  const openFit = useCallback(async () => {
    if (!profileId || !openId || opening) return;
    setOpening(true);
    setOpenError(null);
    try {
      const list = await fetch(`/api/jobseeker/dialogs?profileId=${encodeURIComponent(profileId)}`);
      const listed = (await list.json().catch(() => null)) as { dialogs?: JobseekerDialog[] } | null;
      const open = (listed?.dialogs ?? []).find((d) => d.kind === "fit" && d.postingId === openId && d.status === "open");
      if (open) {
        setStudio({ dialog: open, degradation: null });
        return;
      }
      const res = await fetch("/api/jobseeker/dialogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "fit", postingId: openId, lang: locale }),
      });
      const body = (await res.json().catch(() => null)) as { dialog?: JobseekerDialog; fallbackReason?: string | null; fallbackLang?: string | null; code?: string } | null;
      if (!res.ok || !body?.dialog) {
        setOpenError(classifyApiFailure(res, body));
        return;
      }
      setStudio({ dialog: body.dialog, degradation: body.fallbackReason ? { reason: body.fallbackReason, lang: body.fallbackLang ?? null } : null });
    } catch {
      setOpenError(TRANSPORT_FAILURE);
    } finally {
      setOpening(false);
    }
  }, [profileId, openId, opening, locale]);

  const deepDive = useCallback(async () => {
    if (!openId || diving) return;
    setDiving(true);
    setDiveError(null);
    try {
      const res = await fetch(`/api/jobseeker/postings/${encodeURIComponent(openId)}/deepdive`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { reasoning?: Record<string, unknown> | null; source?: string; fallbackReason?: string | null; code?: string } | null;
      const outcome = res.ok ? diveOutcome(body) : "failed";
      if (outcome === "failed") {
        setDiveError(classifyApiFailure(res, body));
        return;
      }
      setDive({ reasoning: reasoningView(body?.reasoning && typeof body.reasoning === "object" ? body.reasoning : null), outcome });
      if (outcome === "llm") void load(openId);
    } catch {
      setDiveError(TRANSPORT_FAILURE);
    } finally {
      setDiving(false);
    }
  }, [openId, diving, load]);

  // The keys, only while nothing is being typed: J/K while the list or this step is on
  // screen, A/S/D only while this step is.
  useEffect(() => {
    if (!navActive && !decideActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || studio) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === "escape" && pop) {
        setPop(null);
        return;
      }
      if (k === "j") {
        e.preventDefault();
        nav(1);
      } else if (k === "k") {
        e.preventDefault();
        nav(-1);
      }
      if (!decideActive || !openId || status === "gone") return;
      if (k === "a" && status !== "applied") setPop("apply");
      else if (k === "s") void write(status === "shortlisted" ? "new" : "shortlisted");
      else if (k === "d") setPop("dismiss");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navActive, decideActive, nav, openId, status, pop, write, studio]);

  const header = (title: string, meta?: ReactNode) => (
    <div className="step-head">
      <div className="grow">
        <p className="eyebrow">{rank ? t("eyebrowRank", { rank, total }) : t("eyebrow")}</p>
        <h2 id="h-weigh" className="w-title">
          {title}
        </h2>
        {meta}
      </div>
      {openId ? (
        <div className="w-nav">
          <button type="button" className={SV_BTN_SM_GHOST} disabled={pos <= 0} onClick={() => nav(-1)}>
            {t("prev")} <span className="kbd">K</span>
          </button>
          <span>{pos >= 0 ? t("position", { at: pos + 1, of: order.length }) : t("notInList")}</span>
          <button type="button" className={SV_BTN_SM_GHOST} disabled={pos >= order.length - 1} onClick={() => nav(1)}>
            {t("next")} <span className="kbd">J</span>
          </button>
          <a className="btn sm ghost" href="#s-evening">
            {t("backToList")}
          </a>
        </div>
      ) : null}
    </div>
  );

  if (!openId) {
    return (
      <section className="step" id="s-weigh" data-step="weigh" aria-labelledby="h-weigh" ref={sectionRef}>
        {header(t("title"))}
        <div className="gapbox">
          <strong>{t("nothingOpen")}</strong>
          {suggestions.slice(0, 3).map((s) => (
            <button key={s.id} type="button" className={SV_BTN_SM_GHOST} onClick={() => onOpen(s.id)}>
              {t("suggest", { title: s.title, score: s.matchTotal ?? 0 })}
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (!detail || detail.view.id !== openId) {
    return (
      <section className="step" id="s-weigh" data-step="weigh" aria-labelledby="h-weigh" ref={sectionRef}>
        {header(row?.title ?? t("title"))}
        {detailError ? (
          <FailureNotice failure={detailError} fallback={t("loadError")} onRetry={() => void load(openId)} />
        ) : (
          <div className="panel" role="status" aria-busy="true">
            <span className="muted">{t("loading")}</span>
          </div>
        )}
      </section>
    );
  }

  const v = detail.view;
  const m = v.match;
  const DIMS = ["foundation", "potential", "fit"] as const;
  const dimLabel = (code: string | undefined, label: string) => (code && (DIMS as readonly string[]).includes(code) ? t(`dim.${code as (typeof DIMS)[number]}`) : label);
  const fit = detail.fit?.artifact ?? null;
  const pay = payText({ salaryMin: v.salary.min, salaryMax: v.salary.max, salaryCurrency: v.salary.currency, salaryPeriod: v.salary.period }, locale, tPrefs("period.month"), tPrefs("period.year"));
  const salary = compareSalary(v.salary, salaryFloor);
  const reasoning = v.reasoning ?? dive?.reasoning ?? null;
  const breakdownTone = ["b0", "b1", "b2"];
  const coverText = fit?.coverNoteMd ? (cover[v.id] ?? fit.coverNoteMd) : null;
  const floorText = salaryFloor ? `${new Intl.NumberFormat(locale).format(salaryFloor.amount)} ${salaryFloor.currency} ${tPrefs(`period.${salaryFloor.period}`)}` : t("noFloor");

  const meta = (
    <div className="w-meta">
      <TierChip tier={m?.fitTier ?? null} />
      <StatusChip status={status} />
      {v.location ? <span className="chip">{v.location}</span> : null}
      {v.workMode ? <span className="chip">{tPrefs(`workMode.${v.workMode}`)}</span> : null}
      {v.company ? <span className="chip">{v.company}</span> : null}
      {detail.source ? <span className={cx("chip", detail.source.tier === "B" && "held")}>{v.sourceLabel}</span> : null}
    </div>
  );

  return (
    <section className="step" id="s-weigh" data-step="weigh" aria-labelledby="h-weigh" ref={sectionRef}>
      {header(v.title, meta)}
      <div className="weigh">
        <div>
          {m && m.confidence ? (
            <div className="panel">
              <h4>{t("scoreTitle")}</h4>
              <div className="gauge-top">
                <span className="gauge-num">{m.total}</span>
                <span className="gt">{t.rich("band", { low: m.confidence.low, high: m.confidence.high, level: t(`level.${m.confidence.level}`), b: (c) => <b>{c}</b> })}</span>
              </div>
              <div className="gauge">
                <div className="gtrack">
                  <div className={`gband tb-${m.fitTier ?? "partial"}`} style={{ left: `${m.confidence.low}%`, width: `${m.confidence.high - m.confidence.low}%` }} />
                  <div className="gmark" style={{ left: `${m.total}%` }} />
                </div>
                <div className="gticks" aria-hidden>
                  <span>0</span>
                  <span>25</span>
                  <span>50</span>
                  <span>75</span>
                  <span>100</span>
                </div>
              </div>
              {m.confidence.drivers.length ? (
                <ul className="drivers">
                  {m.confidence.drivers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : m ? (
            <div className="panel">
              <h4>{t("scoreTitle")}</h4>
              <span className="gauge-num">{m.total}</span>
            </div>
          ) : v.blocked ? (
            <div className="panel">
              <h4>{t("filteredTitle")}</h4>
              <div className="w-meta">
                {v.blocked.koKeys.map((k) => (
                  <span key={k} className="gchip">
                    {tGate(`label.${k}`)}
                  </span>
                ))}
              </div>
              {v.blocked.koDetails.length ? <p className="small muted">{v.blocked.koDetails.join(" · ")}</p> : null}
              <p className="asif left">
                {v.blocked.asIfTotal !== null ? t.rich("asIf", { n: v.blocked.asIfTotal, b: (c) => <b>{c}</b> }) : t("asIfNone")}
              </p>
              <a className="btn sm ghost" href="#s-want">
                {t("changeWants")}
              </a>
            </div>
          ) : (
            <div className="guided-miss">{t("notScored")}</div>
          )}

          {m && m.breakdown.length ? (
            <div className="panel">
              <h4>{t("madeOf", { n: m.total })}</h4>
              <div className="stack" role="img" aria-label={m.breakdown.map((b) => `${b.label} ${b.contribution}`).join(", ")}>
                {m.breakdown.map((b, i) => (
                  <div key={b.key} className={breakdownTone[i] ?? "b0"} style={{ width: `${b.contribution}%` }}>
                    {b.contribution >= 7 ? Math.round(b.contribution) : ""}
                  </div>
                ))}
              </div>
              <div className="stack-keys">
                {m.breakdown.map((b, i) => (
                  <div key={b.key}>
                    <b>
                      <i className={breakdownTone[i] ?? "b0"} />
                      {dimLabel(b.labelCode, b.label)} · {Math.round(b.contribution * 10) / 10}
                    </b>
                    {t("dimMath", { percent: b.percent, weight: b.weight })}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {m ? (
            <div className="panel">
              <h4>{t("skillsTitle")}</h4>
              <div className="skl">
                {m.matchedSkills.map((s) => {
                  const pv = provenanceOf(m.matchedSkillProvenance[s]);
                  return (
                    <span key={s} className={cx("sk", pv.stated && "st")}>
                      <ProvMark mark={pv.mark} size={12} />
                      {s} <span className="muted">· {t(`prov.${pv.key}`)}</span>
                    </span>
                  );
                })}
                {m.matchedSkills.length === 0 ? <span className="small muted">{t("noneMatched")}</span> : null}
              </div>
              {m.missingSkills.length ? (
                <div className="skl more">
                  <span className="small muted">{t("missing")}</span>
                  {m.missingSkills.map((s) => (
                    <span key={s} className="sk miss">
                      {s}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="small muted more">
                  {t("noneMissing")}
                </div>
              )}
              {m.unprovenSkills.length ? (
                <div className="skl more">
                  <span className="small muted">{t("unproven")}</span>
                  {m.unprovenSkills.map((s) => (
                    <span key={s} className="sk unp">
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {fit ? (
            <div className="panel">
              <h4>{t("guidedTitle", { n: fit.gaps.length })}</h4>
              <div className="gaps">
                {fit.gaps.map((g) => {
                  const sp = splitCite(g.mitigation);
                  return (
                    <div key={g.skill} className={cx("gapc", g.severity)}>
                      <div className="gh">
                        <span className="gs">{t(`severity.${g.severity}`)}</span>
                        <span className="gn">{g.skill}</span>
                      </div>
                      <p>{sp.text}</p>
                      {sp.cite ? (
                        <details>
                          <summary>{t("cite")}</summary>
                          <blockquote>{sp.cite}</blockquote>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p className="small muted leaned">
                {t.rich("leaned", { verdict: t(`verdict.${fit.verdict}`), when: rel(detail.fit!.at), b: (c) => <b>{c}</b> })}
              </p>
              <button type="button" className={SV_BTN_SM_GHOST} onClick={() => void openFit()} disabled={opening || !profileId}>
                {t("talkAgain")}
              </button>
            </div>
          ) : m || v.blocked ? (
            <div className="guided-miss">
              <span>{t("guidedMiss")}</span>
              <button type="button" className={SV_BTN_SM} onClick={() => void openFit()} disabled={opening || !profileId}>
                {t("talk")}
              </button>
            </div>
          ) : null}
          {openError ? <FailureNotice failure={openError} fallback={tPost("discussError")} onDismiss={() => setOpenError(null)} className="mt-3" /> : null}

          <div className="panel">
            <h4>{t("readTitle")}</h4>
            {reasoning ? (
              <>
                <p>{reasoning.verdict}</p>
                {reasoning.strengths.length ? (
                  <p className="small">
                    <b>{tPost("reasoning.strengths")}:</b> {reasoning.strengths.join(" · ")}
                  </p>
                ) : null}
                {reasoning.gaps.length ? (
                  <p className="small">
                    <b>{tPost("reasoning.gaps")}:</b> {reasoning.gaps.join(" · ")}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="small muted">{t("readNone")}</p>
            )}
            {dive?.outcome === "no_provider" ? <p className="small muted">{tPost("reasoning.deterministic")}</p> : null}
            {dive?.outcome === "template" ? <p className="small muted">{tPost("reasoning.templateOnly")}</p> : null}
            {!v.reasoning ? (
              <button type="button" className={SV_BTN_SM_GHOST} onClick={() => void deepDive()} disabled={diving} aria-busy={diving || undefined}>
                {diving ? tPost("reasoning.running") : t("readCta")}
              </button>
            ) : null}
            {diveError ? <FailureNotice failure={diveError} fallback={tPost("reasoning.error")} onRetry={() => void deepDive()} retrying={diving} className="mt-3" /> : null}
          </div>

          <div className="panel ad">
            <details>
              <summary>{t("adTitle", { chars: v.bodyText.length })}</summary>
              <div className="body">{v.bodyText || tPost("text.none")}</div>
            </details>
          </div>
        </div>

        <div>
          {m && m.eligibility.length ? (
            <div className="panel">
              <h4>{t("checksTitle")}</h4>
              <div className="elig">
                {m.eligibility.map((e) => (
                  <div key={e.key} className="erow">
                    <Pip state={e.state} />
                    <span className="ek">{tChecks(`key.${e.key}`)}</span>
                    <span>
                      <span className={`es ${e.state}`}>{tChecks(`state.${e.state}`)}</span> <span className="ed">· {e.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="panel">
            <h4>{t("payTitle")}</h4>
            <div className="pay-line">{pay ?? t("payUnstated")}</div>
            <div className="small muted note-line">
              {salary.kind === "compared"
                ? tPost(`salary.${salary.verdict}`, { pct: salary.pct })
                : salary.kind === "not_comparable"
                  ? tPost("salary.notComparable", { posting: salary.posting, floor: salary.floor })
                  : salary.kind === "no_floor"
                    ? t("payNoFloor")
                    : t("payUnknown")}
            </div>
            <div className="small muted note-line">
              {t("yourFloor", { floor: floorText })}
            </div>
          </div>

          <div className="panel">
            <h4>{t("fromTitle")}</h4>
            <dl className="kv">
              <dt>{t("from.source")}</dt>
              <dd>
                {v.sourceLabel}
                {detail.source ? ` · ${t("from.tier", { tier: detail.source.tier })}` : ""}
              </dd>
              {v.attribution ? (
                <>
                  <dt>{t("from.attribution")}</dt>
                  <dd>{v.attribution}</dd>
                </>
              ) : null}
              <dt>{t("from.posted")}</dt>
              <dd>{v.postedAt ? rel(v.postedAt) : t("from.notStated")}</dd>
              {row ? (
                <>
                  <dt>{t("from.firstSeen")}</dt>
                  <dd>{rel(row.firstSeenAt)}</dd>
                </>
              ) : null}
              <dt>{t("from.lastSeen")}</dt>
              <dd>
                {v.lastSeenAt ? rel(v.lastSeenAt) : t("from.notStated")}
                {status === "gone" ? ` — ${t("from.gone")}` : ""}
              </dd>
              {m && m.entryEligible !== null ? (
                <>
                  <dt>{t("from.early")}</dt>
                  <dd>{t(m.entryEligible ? "from.earlyYes" : "from.earlyNo", { pct: Math.round((m.graduateFriendliness ?? 0) * 100) })}</dd>
                </>
              ) : null}
            </dl>
          </div>

          {fit && fit.questionsToAsk.length ? (
            <div className="panel">
              <h4>{t("questionsTitle")}</h4>
              <ol className="qs">
                {fit.questionsToAsk.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {coverText !== null ? (
            <div className="panel cover">
              <h4>{t("coverTitle")}</h4>
              <label htmlFor="sv-cover" className="small muted">
                {t("coverHint")}
              </label>
              <textarea id="sv-cover" value={coverText} onChange={(e) => setCover((c) => ({ ...c, [v.id]: e.target.value }))} />
              <div className="scanline more">
                <button
                  type="button"
                  className={SV_BTN_SM_GHOST}
                  onClick={() => {
                    void navigator.clipboard?.writeText(coverText).then(
                      () => onToast(t("coverCopied")),
                      () => onToast(t("coverCopyFailed"))
                    );
                  }}
                >
                  {t("coverCopy")}
                </button>
                <span role="status">{cover[v.id] !== undefined ? t("coverEdited") : t("coverUntouched")}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="decide" role="group" aria-label={t("decideLabel")}>
        {status === "gone" ? (
          <span>{t("goneNote", { when: v.lastSeenAt ? rel(v.lastSeenAt) : "" })}</span>
        ) : (
          <button type="button" className={cx(status === "applied" ? SV_BTN : SV_BTN_ACCENT, status === "applied" && "on")} disabled={status === "applied" || busy} onClick={() => setPop(pop === "apply" ? null : "apply")}>
            {status === "applied" ? t("applied") : t("apply")} <span className="kbd">A</span>
          </button>
        )}
        <button type="button" className={cx(SV_BTN, status === "shortlisted" && "on")} aria-pressed={status === "shortlisted"} disabled={busy || status === "gone"} onClick={() => void write(status === "shortlisted" ? "new" : "shortlisted")}>
          {status === "shortlisted" ? t("shortlisted") : t("shortlist")} <span className="kbd">S</span>
        </button>
        <button type="button" className={cx(SV_BTN, status === "dismissed" && "on")} disabled={busy || status === "gone"} onClick={() => setPop(pop === "dismiss" ? null : "dismiss")}>
          {status === "dismissed" ? t("letGone") : t("letGo")} <span className="kbd">D</span>
        </button>
        {status !== "new" && status !== "gone" ? (
          <button type="button" className={SV_BTN_SM} disabled={busy} onClick={() => void write("new")}>
            {t("undo")}
          </button>
        ) : null}
        <span className="cur">
          {status === "new"
            ? t("undecided")
            : `${tStatus(status)}${status === "dismissed" && row?.dismissReason ? ` · ${tDismiss(row.dismissReason)}` : ""}${status === "applied" && row?.appliedAt ? ` · ${rel(row.appliedAt)}` : ""}`}
        </span>
        {pop === "apply" ? (
          <div className="pop" role="group" aria-label={t("apply")}>
            <span>{t("applyNote")}</span>
            <a className="btn sm" href={v.url} target="_blank" rel="noopener noreferrer">
              {t("openAd")}
            </a>
            <button type="button" className={SV_BTN_SM_ACCENT} disabled={busy} onClick={() => void write("applied")}>
              {t("markApplied")}
            </button>
            <button type="button" className={SV_BTN_SM} onClick={() => setPop(null)}>
              {t("cancel")}
            </button>
          </div>
        ) : null}
        {pop === "dismiss" ? (
          <div className="pop" role="group" aria-label={t("whyLabel")}>
            <span>{t("why")}</span>
            {DISMISS_REASONS.map((r) => (
              <button key={r} type="button" className={SV_REASON} disabled={busy} onClick={() => void write("dismissed", r)}>
                {tDismiss(r)}
              </button>
            ))}
            <button type="button" className={SV_BTN_SM} onClick={() => setPop(null)}>
              {t("cancel")}
            </button>
          </div>
        ) : null}
        {writeError ? (
          <span className="err" role="alert">
            {writeError.kind === "transport" ? resolveError(null, t("writeTransport")) : resolveError(writeError, t("writeError"))}
          </span>
        ) : null}
      </div>

      {studio ? (
        <FitStudio
          dialog={studio.dialog}
          posting={v}
          initialDegradation={studio.degradation}
          onDialogChange={(dialog) => setStudio((s) => (s ? { ...s, dialog } : s))}
          onDone={(artifact) => setDetail((d) => (d ? { ...d, fit: { artifact, at: new Date().toISOString() } } : d))}
          onMarkApplied={() => {
            window.open(v.url, "_blank", "noopener,noreferrer");
            void write("applied");
          }}
          applied={status === "applied"}
          onClose={() => setStudio(null)}
        />
      ) : null}
    </section>
  );
}
