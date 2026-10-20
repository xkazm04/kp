"use client";

import { useEffect, useRef, useState } from "react";
import { companyConfigFor, companyOf } from "@/app/_lib/jobseeker/companyConfig";
import { ChapterHead } from "./ChapterHead";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { isSourceAdapterName, type JobseekerProfile, type JobseekerSource, type SourceRunOutcome, type SourceTier } from "@/app/_lib/jobseeker/types";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { euresCountryPlan, readPreferredCountries, saveEuresCountries } from "../euresDoor";
import { callJson, entryForSource, sourceDisplayLabel, type ApiFailure, type CatalogEntryView } from "../sourcesApi";
import { LockIcon, ProvMark } from "./marks";
import { sourceIsOn } from "./sieveModel";
import { cx, SV_BTN_GHOST, SV_BTN_PRIMARY, SV_BTN_SM_GHOST, SV_LOCK, SV_SWITCH } from "./sieveRecipes";

// Step 8 — Where your postings come from. Three lanes, the legal tiers of ADR 0009 §3:
//   A  open and rights-clean (EURES, the ministry's open data, company ATS feeds): one tap
//   B  Czech job boards whose terms forbid automated reading: a LOCK until the seeker has
//      read the site's own clause and accepted the exposure for their own search
//   C  refused: listed only to say why, never fetched, no control at all
// Every card says what the source means for THIS sieve — how many postings it put in, or
// how many wait at the door while it is off — so switching one is a visible act: the
// sieve's counts move with it.
//
// The acknowledgement is a real modal dialog (the checkbox first in focus order, the CTA
// disabled until it is ticked — the contract the keyless e2e pins), and a changed terms
// summary re-asks with a line saying so. `blocked` and `collapsed` are pause reasons a
// scan set and only the seeker clears.
//
// Tier A holds two kinds of source: whole-market feeds (EURES, the ministry's file,
// Arbeitnow) and per-company boards. A board is ONE card per vendor (Greenhouse, Ashby...)
// with its companies as rows - each its own switch - and the field that adds the next:
// the live run's seven companies had made the lane twenty cards long, three times the
// other two.
//
// EURES searches the seeker's own countries and an empty list is a query for nothing
// (the adapter refuses it as config_invalid). So switching the EURES card ON with no
// country set writes the country it names first — the same derivation as the feed's
// one-click door (euresDoor.ts) — and the card says which countries it searches.

const EURES_ADAPTER = "eures";
/** A last run that landed (or was skipped by the cadence); any other outcome is said in
 *  the flag's ink - a board that answered 404 read like a quiet success in grey. */
const RAN_CLEAN: ReadonlySet<SourceRunOutcome> = new Set(["succeeded", "skipped"]);

type Ack = { entry: CatalogEntryView; source: JobseekerSource | null; changed: boolean };

export function StepSources({
  catalog,
  sources,
  postingCounts,
  hasProfile,
  countries,
  onSourcesChange,
  onProfileSaved,
  onToast,
}: {
  catalog: CatalogEntryView[];
  sources: JobseekerSource[];
  /** How many postings each source put into the dataset (any state). */
  postingCounts: Map<string, number>;
  hasProfile: boolean;
  /** `preferences.countries` as the page holds them. Absent = not handed in: the EURES
   *  card then reads them from the server at the moment it is switched on. */
  countries?: readonly string[];
  onSourcesChange(next: (prev: JobseekerSource[]) => JobseekerSource[]): void;
  /** The countries the EURES card wrote, so the page's copy matches the server's. */
  onProfileSaved?(profile: JobseekerProfile): void;
  onToast(message: string): void;
}) {
  const t = useTranslations("me.sieve.sources");
  const tAck = useTranslations("me.sources.ack");
  const tPause = useTranslations("me.sources.pauseReason");
  const tOutcome = useTranslations("me.sources.outcome");
  const resolveError = useErrorMessage();
  const rel = useRelativeTime();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, ApiFailure>>({});
  const [slugs, setSlugs] = useState<Record<string, string>>({});
  const [ack, setAck] = useState<Ack | null>(null);

  const upsert = (next: JobseekerSource) => onSourcesChange((prev) => (prev.some((s) => s.id === next.id) ? prev.map((s) => (s.id === next.id ? next : s)) : [...prev, next]));
  const fail = (key: string, f: ApiFailure) => setErrors((e) => ({ ...e, [key]: f }));
  const clear = (key: string) =>
    setErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });

  /** Create the source from its catalog entry if the workspace has none yet. */
  const ensure = async (entry: CatalogEntryView, existing: JobseekerSource | null, config?: Record<string, unknown>): Promise<JobseekerSource | null> => {
    if (existing) return existing;
    const r = await callJson<{ source: JobseekerSource }>("/api/jobseeker/sources", { method: "POST", body: JSON.stringify({ catalogId: entry.id, ...(config ? { config } : {}) }) });
    if (!r.ok) {
      fail(entry.id, r.fail);
      return null;
    }
    upsert(r.body.source);
    return r.body.source;
  };

  const patch = async (key: string, source: JobseekerSource, body: Record<string, unknown>, entry: CatalogEntryView | null): Promise<boolean> => {
    const r = await callJson<{ source: JobseekerSource }>(`/api/jobseeker/sources/${encodeURIComponent(source.id)}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!r.ok) {
      if (r.fail.code === "JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED" && entry) {
        setAck({ entry, source, changed: source.acknowledgedTermsHash !== null && !!r.fail.termsHash && source.acknowledgedTermsHash !== r.fail.termsHash });
        return false;
      }
      fail(key, r.fail);
      return false;
    }
    upsert(r.body.source);
    return true;
  };

  /** EURES is about to be switched on: make sure it has a country to search, writing
   *  the derived one when the seeker named none. The countries it will search, or null
   *  when the read or the write failed (the failure is on the card). */
  const ensureEuresCountries = async (key: string): Promise<string | null> => {
    let named = countries;
    if (named === undefined) {
      const read = await readPreferredCountries();
      if (!read.ok) {
        fail(key, read.fail);
        return null;
      }
      named = read.countries;
    }
    const plan = euresCountryPlan(named);
    const saved = await saveEuresCountries(plan);
    if (!saved.ok) {
      fail(key, saved.fail);
      return null;
    }
    if (saved.profile) onProfileSaved?.(saved.profile);
    return plan.label;
  };

  const toggle = async (key: string, entry: CatalogEntryView | null, existing: JobseekerSource | null) => {
    if (busy) return;
    setBusy(key);
    clear(key);
    try {
      const source = entry ? await ensure(entry, existing) : existing;
      if (!source) return;
      const turningOn = !sourceIsOn(source);
      // Written BEFORE the switch flips, so an enabled EURES always has a market to search.
      const euresSearch = turningOn && source.adapter === EURES_ADAPTER ? await ensureEuresCountries(key) : null;
      if (turningOn && source.adapter === EURES_ADAPTER && euresSearch === null) return;
      const ok = await patch(key, source, source.pausedReason ? { resume: true } : { enabled: turningOn }, entry);
      const n = postingCounts.get(source.id) ?? 0;
      const label = entry?.label ?? source.host;
      if (ok && euresSearch) onToast(t("toast.onCountries", { label, countries: euresSearch }));
      else if (ok) onToast(turningOn ? (n ? t("toast.onWith", { label, n }) : t("toast.on", { label })) : n ? t("toast.offWith", { label, n }) : t("toast.off", { label }));
    } finally {
      setBusy(null);
    }
  };

  const confirmAck = async () => {
    if (!ack) return;
    const key = ack.entry.id;
    setBusy(key);
    clear(key);
    try {
      const source = await ensure(ack.entry, ack.source);
      if (!source) return;
      const ok = await patch(key, source, { enabled: true, acknowledge: true }, null);
      if (ok) {
        const n = postingCounts.get(source.id) ?? 0;
        onToast(n ? t("toast.released", { n }) : t("toast.on", { label: ack.entry.label }));
        setAck(null);
      }
    } finally {
      setBusy(null);
    }
  };

  const addCompany = async (entry: CatalogEntryView) => {
    const slug = (slugs[entry.id] ?? "").trim();
    if (!slug || busy) return;
    setBusy(entry.id);
    clear(entry.id);
    try {
      const created = await ensure(entry, null, isSourceAdapterName(entry.adapter) ? companyConfigFor(entry.adapter, slug) : { slug });
      if (created) {
        setSlugs((s) => ({ ...s, [entry.id]: "" }));
        await patch(created.id, created, { enabled: true }, entry);
        onToast(t("toast.on", { label: `${entry.label} · ${slug}` }));
      }
    } finally {
      setBusy(null);
    }
  };

  const card = (key: string, label: string, host: string, entry: CatalogEntryView | null, source: JobseekerSource | null, tier: SourceTier) => {
    const on = sourceIsOn(source ?? undefined);
    const n = source ? postingCounts.get(source.id) ?? 0 : 0;
    const locked = tier === "B" && !(source?.acknowledgedAt && source.acknowledgedTermsHash === entry?.termsHash);
    const err = errors[key];
    const eures = (source?.adapter ?? entry?.adapter) === EURES_ADAPTER && countries !== undefined ? euresCountryPlan(countries) : null;
    return (
      <div key={key} className={cx("src", source?.acknowledgedAt && tier === "B" && "acked", source?.pausedReason && "paused")}>
        <div className="sh">
          <div>
            <div className="sl">{label}</div>
            <div className="host">{host}</div>
          </div>
          {locked && !on ? (
            <button type="button" className={SV_LOCK} disabled={!hasProfile || busy !== null} onClick={() => setAck({ entry: entry!, source, changed: !!source?.acknowledgedTermsHash && source.acknowledgedTermsHash !== entry?.termsHash })}>
              <LockIcon />
              {t("readTerms")}
            </button>
          ) : (
            <button
              type="button"
              role="switch"
              className={SV_SWITCH}
              aria-checked={on}
              aria-label={t("switchLabel", { label })}
              disabled={!hasProfile || busy !== null}
              aria-busy={busy === key || undefined}
              onClick={() => void toggle(key, entry, source)}
            />
          )}
        </div>
        <div className="sfeed">
          <span className={cx("chip", n > 0 && !on && "held")}>{n ? (on ? t("inSieve", { n }) : t("atDoor", { n })) : t("noneYet")}</span>
          {source?.pausedReason ? (
            <span className="chip st-dismissed">{t("paused", { reason: tPause(source.pausedReason) })}</span>
          ) : null}
          {source?.lastRunAt && source.lastOutcome ? (
            <span className={cx("small muted", !RAN_CLEAN.has(source.lastOutcome) && "run-bad")} suppressHydrationWarning>
              {t("lastRun", { outcome: tOutcome(source.lastOutcome), when: rel(source.lastRunAt) })}
            </span>
          ) : null}
          {tier === "B" && source?.acknowledgedAt ? <span className="small muted" suppressHydrationWarning>{t("acked", { when: rel(source.acknowledgedAt) })}</span> : null}
          {eures ? (
            <span className="small muted" data-testid="eures-countries">
              {!eures.defaulted ? t("euresCountries", { countries: eures.label }) : on ? t("euresNoCountry") : t("euresDefault", { countries: eures.label })}
            </span>
          ) : null}
        </div>
        {entry ? details(entry) : null}
        {err ? (
          <div className="src-err" role="alert">
            {err.kind === "transport" ? resolveError(null, t("unreachable")) : resolveError(err, t("error"))}
          </div>
        ) : null}
      </div>
    );
  };

  const details = (entry: CatalogEntryView) => (
    <details>
      <summary>{t("details")}</summary>
      <p>
        <b>{t("cadence")}</b> {entry.cadenceNote}
      </p>
      <p>
        <b>{t("robots")}</b> {entry.robotsSummary}
      </p>
      <p>
        <b>{t("terms")}</b> {entry.termsQuote}{" "}
        <a href={entry.termsUrl} target="_blank" rel="noopener noreferrer">
          {t("readOriginal")}
        </a>
      </p>
    </details>
  );

  /** One company on its vendor's card: the company, what it put in, its own switch. */
  const companyRow = (entry: CatalogEntryView, source: JobseekerSource) => {
    const on = sourceIsOn(source);
    const n = postingCounts.get(source.id) ?? 0;
    const err = errors[source.id];
    const company = isSourceAdapterName(source.adapter) ? companyOf(source.adapter, source.config) : null;
    return (
      <li key={source.id} className={cx("co", source.pausedReason && "paused")}>
        <div className="co-main">
          <span className="co-name">{company ?? source.host}</span>
          <span className="co-feed">
            <span className={cx("chip", n > 0 && !on && "held")}>{n ? (on ? t("inSieve", { n }) : t("atDoor", { n })) : t("noneYet")}</span>
            {source.pausedReason ? <span className="chip st-dismissed">{t("paused", { reason: tPause(source.pausedReason) })}</span> : null}
            {source.lastRunAt && source.lastOutcome ? (
              <span className={cx("small muted", !RAN_CLEAN.has(source.lastOutcome) && "run-bad")} suppressHydrationWarning>
                {t("lastRun", { outcome: tOutcome(source.lastOutcome), when: rel(source.lastRunAt) })}
              </span>
            ) : null}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          className={SV_SWITCH}
          aria-checked={on}
          aria-label={t("switchLabel", { label: sourceDisplayLabel(catalog, source) })}
          disabled={!hasProfile || busy !== null}
          aria-busy={busy === source.id || undefined}
          onClick={() => void toggle(source.id, entry, source)}
        />
        {err ? (
          <div className="src-err" role="alert">
            {err.kind === "transport" ? resolveError(null, t("unreachable")) : resolveError(err, t("error"))}
          </div>
        ) : null}
      </li>
    );
  };

  /** A per-company vendor: its companies as rows, then the field that adds the next. */
  const boardCard = (entry: CatalogEntryView) => {
    const mine = sources.filter((s) => entryForSource(catalog, s)?.id === entry.id);
    const [name, hint] = splitLabel(entry.label);
    return (
      <div key={entry.id} className="src board">
        <div className="sh">
          <div>
            <div className="sl">{name}</div>
            <div className="host">{hint ? `${entry.host} · ${hint}` : entry.host}</div>
          </div>
        </div>
        {mine.length ? <ul className="cos">{mine.map((s) => companyRow(entry, s))}</ul> : null}
        <form
          className="cfg"
          onSubmit={(ev) => {
            ev.preventDefault();
            void addCompany(entry);
          }}
        >
          <input
            value={slugs[entry.id] ?? ""}
            onChange={(ev) => setSlugs((s) => ({ ...s, [entry.id]: ev.target.value }))}
            placeholder={t("companyPlaceholder")}
            aria-label={t("companyLabel", { label: entry.label })}
            maxLength={80}
            disabled={!hasProfile}
          />
          <button type="submit" className={SV_BTN_SM_GHOST} disabled={!hasProfile || busy !== null || !(slugs[entry.id] ?? "").trim()}>
            {t("addCompany")}
          </button>
        </form>
        {errors[entry.id] ? (
          <div className="src-err" role="alert">
            {resolveError(errors[entry.id], t("error"))}
          </div>
        ) : null}
        {details(entry)}
      </div>
    );
  };

  const lane = (tier: SourceTier) => {
    const entries = catalog.filter((e) => e.tier === tier);
    const custom = sources.filter((s) => s.tier === tier && !entryForSource(catalog, s));
    return (
      <section key={tier} className={cx("lane", tier)} aria-labelledby={`sv-tier-${tier}`} data-tier={tier}>
        <header>
          <div className="tier">{t("tierCount", { tier, n: entries.length + custom.length })}</div>
          <h3 id={`sv-tier-${tier}`}>{t(`lane.${tier}.title`)}</h3>
          <p>{t(`lane.${tier}.sub`)}</p>
        </header>
        {tier === "C" ? (
          <div className="srcs">
            {entries.map((e) => (
              <div key={e.id} className="src refused" data-refused>
                <div className="sh">
                  <div>
                    <div className="sl">{e.label}</div>
                    <div className="host">{e.host}</div>
                  </div>
                  <span className="chip">{t("never")}</span>
                </div>
                {e.refusedReason ? <div className="why">{e.refusedReason}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          laneBody(tier, entries, custom)
        )}
      </section>
    );
  };

  /** Feeds and boards, grouped when a lane holds both (tier A); one run otherwise. */
  const laneBody = (tier: SourceTier, entries: CatalogEntryView[], custom: JobseekerSource[]) => {
    const feeds = [
      ...entries.filter((e) => !e.needsCompanyConfig).map((e) => card(e.id, e.label, e.host, e, sources.find((s) => entryForSource(catalog, s)?.id === e.id) ?? null, tier)),
      ...custom.map((s) => card(s.id, s.host, s.host, null, s, tier)),
    ];
    const boards = entries.filter((e) => e.needsCompanyConfig).map(boardCard);
    if (!feeds.length || !boards.length) return <div className="srcs">{[...feeds, ...boards]}</div>;
    return (
      <>
        <div className="lane-group">
          <div className="lane-sub">{t("group.feeds")}</div>
          <div className="srcs">{feeds}</div>
        </div>
        <div className="lane-group">
          <div className="lane-sub">{t("group.boards")}</div>
          <div className="srcs">{boards}</div>
        </div>
      </>
    );
  };

  const paused = sources.filter((s) => s.pausedReason);
  return (
    <section className="step" id="s-sources" data-step="sources" aria-labelledby="h-sources">
      <ChapterHead
        n={8}
        id="h-sources"
        eyebrow={t("eyebrow")}
        title={t("title")}
        lede={hasProfile ? t("lede") : t("ledeNoProfile")}
        aside={
          <Link className="btn sm ghost" href="/me/sources">
            {t("advanced")}
          </Link>
        }
      />
      <div className="lanes">{(["A", "B", "C"] as const).map(lane)}</div>
      <div className="paused-note">
        <ProvMark mark={paused.length ? "dashed" : "ring"} size={16} />
        <span>
          {paused.length
            ? t.rich("pausedSome", { n: paused.length, list: paused.map((s) => `${entryForSource(catalog, s)?.label ?? s.host} (${tPause(s.pausedReason!)})`).join(", "), b: (c) => <b>{c}</b> })
            : t.rich("pausedNone", { b: (c) => <b>{c}</b> })}
        </span>
      </div>
      <AckDialog
        ack={ack}
        count={ack?.source ? postingCounts.get(ack.source.id) ?? 0 : 0}
        busy={ack ? busy === ack.entry.id : false}
        error={ack && errors[ack.entry.id] ? resolveError(errors[ack.entry.id], t("error")) : null}
        onConfirm={() => void confirmAck()}
        onCancel={() => setAck(null)}
        labels={{
          tier: t("ackTier", { host: ack?.entry.host ?? "" }),
          changed: tAck("changed"),
          inSieve: t("ackCount"),
          inSieveNone: t("ackCountNone"),
          you: t("ackYou"),
          youBody: t("ackYouBody"),
          checkbox: tAck("checkbox"),
          cta: tAck("cta"),
          cancel: tAck("cancel"),
          full: t("readOriginal"),
        }}
      />
    </section>
  );
}

/** "Greenhouse job board (per company token)" -> the board's name and what to type. */
function splitLabel(label: string): [string, string | null] {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(label);
  return m ? [m[1]!, m[2]!] : [label, null];
}

function AckDialog({
  ack,
  count,
  busy,
  error,
  onConfirm,
  onCancel,
  labels,
}: {
  ack: Ack | null;
  count: number;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onCancel(): void;
  labels: Record<"tier" | "changed" | "inSieve" | "inSieveNone" | "you" | "youBody" | "checkbox" | "cta" | "cancel" | "full", string>;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const boxRef = useRef<HTMLInputElement | null>(null);
  const [checked, setChecked] = useState(false);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const id = ack?.entry.id ?? null;
  if (id !== shownFor) {
    setShownFor(id);
    setChecked(false);
  }
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ack && !d.open) {
      d.showModal?.();
      boxRef.current?.focus();
    } else if (!ack && d.open) d.close();
  }, [ack]);
  return (
    <dialog ref={ref} className="sv-ack" aria-labelledby="sv-ack-title" data-testid="source-ack" onCancel={onCancel} onClose={() => ack && onCancel()}>
      {ack ? (
        <>
          <div className="ah">
            <div className="tier">{labels.tier}</div>
            <h2 id="sv-ack-title">{ack.entry.label}</h2>
          </div>
          <blockquote>{ack.entry.termsQuote}</blockquote>
          {ack.changed ? <p className="changed">{labels.changed}</p> : null}
          <div className="consequence">
            <div>
              <b>{count}</b>
              {count ? labels.inSieve : labels.inSieveNone}
            </div>
            <div>
              <b>{labels.you}</b>
              {labels.youBody}
            </div>
          </div>
          <label className="agree">
            <input ref={boxRef} type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {labels.checkbox}
          </label>
          {error ? (
            <p className="changed" role="alert">
              {error}
            </p>
          ) : null}
          <div className="af">
            <a className="sm" href={ack.entry.termsUrl} target="_blank" rel="noopener noreferrer">
              {labels.full}
            </a>
            <button type="button" className={SV_BTN_GHOST} onClick={onCancel}>
              {labels.cancel}
            </button>
            <button type="button" className={SV_BTN_PRIMARY} disabled={!checked || busy} onClick={onConfirm}>
              {labels.cta}
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
