"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SENIORITIES, WORK_MODES, type JobseekerPreferences, type JobseekerProfile, type SalaryFloor, type SalaryPeriod } from "@/app/_lib/jobseeker/types";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { FailureNotice } from "../FailureNotice";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "../apiFailure";
import { ProvMark } from "./marks";
import { SV_BTN_SM_GHOST } from "./sieveRecipes";

// Step 4 — "Five things steer the search". The seven-question conversation that used to
// collect these is now five cards the seeker TAPS: places as pins, the pay floor as a
// slider with its currency and period, titles as tokens, work modes as three toggles,
// the level as a four-stop switch. Languages ride along read-only — they come from the
// CV and are changed there.
//
// Every change is the seeker's own preference, saved as they make it (a short debounce,
// PUT /api/jobseeker/profile with `preferencesReplace` so removing the last place really
// empties the list). The scores on screen were computed against the preferences at the
// last scan, and the step says so beside a Scan now — it never pretends a slider
// re-scored 98 postings in the browser.
//
// "A floor without a currency is not a floor" is a rule of the engine
// (profile.ts parseSalaryFloor), so choosing no currency stores no floor and the card
// says so in the flag colour.

type Save = "idle" | "saving" | "saved" | "error";
const SAVE_DELAY_MS = 700;

function payScale(currency: string | null, period: SalaryPeriod): { max: number; step: number } {
  const year = period === "year";
  if (currency === "EUR") return year ? { max: 150_000, step: 1_000 } : { max: 12_000, step: 100 };
  return year ? { max: 3_000_000, step: 10_000 } : { max: 250_000, step: 1_000 };
}

function formatAmount(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function StepWant({
  profile,
  locale,
  onSaved,
  scanDoor,
  reduceMotion,
}: {
  profile: JobseekerProfile | null;
  locale: string;
  onSaved(profile: JobseekerProfile): void;
  /** The flow's Scan now control, rendered beside the "scores update on the next scan" note. */
  scanDoor: ReactNode;
  reduceMotion: boolean;
}) {
  const t = useTranslations("me.sieve.want");
  const tPrefs = useTranslations("me.preferences");
  const enumLabel = useEnumLabel();
  const [prefs, setPrefs] = useState<JobseekerPreferences | null>(profile?.preferences ?? null);
  const [amount, setAmount] = useState<number>(profile?.preferences.salaryFloor?.amount ?? 0);
  const [currency, setCurrency] = useState<string | null>(profile?.preferences.salaryFloor?.currency ?? null);
  const [period, setPeriod] = useState<SalaryPeriod>(profile?.preferences.salaryFloor?.period ?? "month");
  const [save, setSave] = useState<Save>("idle");
  const [saveError, setSaveError] = useState<ClassifiedFailure | null>(null);
  const [changed, setChanged] = useState(false);
  // An edit is queued or in flight (state, not the ref: render must not read a ref).
  const [dirty, setDirty] = useState(false);
  const [filling, setFilling] = useState<number>(-1);
  const [countryError, setCountryError] = useState<string | null>(null);
  const pending = useRef<Partial<JobseekerPreferences>>({});
  const timer = useRef<number | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const profileId = profile?.id ?? null;

  // The cards follow what the server holds whenever the stored profile changes from
  // OUTSIDE this step (a re-import, the EURES door writing countries, a CV conversation
  // closing) and no edit of the seeker's own is still waiting to be saved — else the
  // next direct edit would replace a list with this step's stale copy of it.
  const version = profile ? `${profile.id}:${profile.updatedAt}` : null;
  const [seenVersion, setSeenVersion] = useState(version);
  if (version !== seenVersion && !dirty) {
    setSeenVersion(version);
    setPrefs(profile?.preferences ?? null);
    setAmount(profile?.preferences.salaryFloor?.amount ?? 0);
    setCurrency(profile?.preferences.salaryFloor?.currency ?? null);
    setPeriod(profile?.preferences.salaryFloor?.period ?? "month");
  }

  const flush = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    setSave("saving");
    try {
      const res = await fetch("/api/jobseeker/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: patch, preferencesReplace: true }),
      });
      const body = (await res.json().catch(() => null)) as (JobseekerProfile & { code?: string }) | null;
      if (!res.ok || !body || typeof body.id !== "string") {
        // The unsaved change goes back in the queue, so Retry re-sends it.
        pending.current = { ...patch, ...pending.current };
        setSaveError(classifyApiFailure(res, body));
        setSave("error");
        return;
      }
      setSaveError(null);
      setSave("saved");
      if (Object.keys(pending.current).length === 0) setDirty(false);
      onSaved(body);
    } catch {
      pending.current = { ...patch, ...pending.current };
      setSaveError(TRANSPORT_FAILURE);
      setSave("error");
    }
  }, [onSaved]);

  const queue = useCallback(
    (patch: Partial<JobseekerPreferences>) => {
      pending.current = { ...pending.current, ...patch };
      setChanged(true);
      setDirty(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush]
  );
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  // The cards light up one after another the first time the step comes into view — the
  // seeker's answers arriving, not a form appearing.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !profileId || reduceMotion || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        [0, 1, 2, 3, 4].forEach((i) => window.setTimeout(() => setFilling(i), 250 + i * 330));
        window.setTimeout(() => setFilling(-1), 250 + 5 * 330 + 300);
      },
      { threshold: 0.18 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [profileId, reduceMotion]);

  const edit = (patch: Partial<JobseekerPreferences>) => {
    setPrefs((cur) => (cur ? { ...cur, ...patch } : cur));
    queue(patch);
  };

  const floorPatch = (nextAmount: number, nextCurrency: string | null, nextPeriod: SalaryPeriod): SalaryFloor | null =>
    nextCurrency && nextAmount > 0 ? { amount: nextAmount, currency: nextCurrency, period: nextPeriod } : null;

  if (!profile || !prefs) {
    return (
      <section className="step" id="s-want" data-step="want" aria-labelledby="h-want">
        <div className="step-head">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h2 id="h-want">{t("title")}</h2>
          </div>
        </div>
        <div className="gapbox">
          <strong>{t("notReached")}</strong>
          <span>{t("notReachedBody")}</span>
        </div>
      </section>
    );
  }

  const addTo = (field: "locations" | "targetTitles" | "countries") => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("v") as HTMLInputElement | null;
    const raw = (input?.value ?? "").trim();
    if (!raw) return;
    const value = field === "countries" ? raw.toLowerCase() : raw;
    // A country code the engine cannot read is SAID, never dropped: the typed value stays
    // in the field so it can be corrected.
    if (field === "countries" && !/^[a-z]{2}$/.test(value)) {
      setCountryError(t("places.countryInvalid", { value: raw }));
      return;
    }
    if (field === "countries") setCountryError(null);
    const list = prefs[field];
    if (!list.some((x) => x.toLowerCase() === value.toLowerCase())) edit({ [field]: [...list, value] });
    if (input) input.value = "";
  };
  const removeFrom = (field: "locations" | "targetTitles" | "countries" | "targetRoleFamilies", i: number) => edit({ [field]: prefs[field].filter((_, j) => j !== i) });

  const scale = payScale(currency, period);
  const noFloor = !currency;
  const currencies = Array.from(new Set(["CZK", "EUR", ...(currency ? [currency] : [])]));
  const set = [
    prefs.locations.length + prefs.countries.length > 0,
    !!prefs.salaryFloor,
    prefs.targetTitles.length > 0,
    prefs.workModes.length > 0,
    !!prefs.seniority,
  ].filter(Boolean).length;

  return (
    <section className="step" id="s-want" data-step="want" aria-labelledby="h-want" ref={sectionRef}>
      <div className="step-head">
        <div className="grow">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2 id="h-want">{t("title")}</h2>
          <p className="lede">{t("lede")}</p>
        </div>
      </div>
      <div className="wants">
        <div className={`wcard${filling === 0 ? " filling" : ""}`}>
          <div className="wh">
            <h3>{t("places.title")}</h3>
            <span className="small muted">{t("places.hint")}</span>
          </div>
          <div className="tokens">
            {prefs.locations.map((l, i) => (
              <span key={`l-${l}`} className="token pin">
                {l}
                <button type="button" aria-label={t("remove", { value: l })} onClick={() => removeFrom("locations", i)}>
                  ×
                </button>
              </span>
            ))}
            {prefs.countries.map((c, i) => (
              <span key={`c-${c}`} className="token country">
                {c}
                <button type="button" aria-label={t("remove", { value: c.toUpperCase() })} onClick={() => removeFrom("countries", i)}>
                  ×
                </button>
              </span>
            ))}
            {prefs.locations.length + prefs.countries.length === 0 ? <span className="small muted">{t("places.none")}</span> : null}
          </div>
          <form className="addin" onSubmit={addTo("locations")}>
            <input name="v" placeholder={t("places.add")} aria-label={t("places.add")} />
            <button className={SV_BTN_SM_GHOST} type="submit">
              {t("add")}
            </button>
          </form>
          <form className="addin" onSubmit={addTo("countries")}>
            <input
              name="v"
              placeholder={t("places.country")}
              aria-label={t("places.country")}
              aria-invalid={countryError ? true : undefined}
              aria-describedby={countryError ? "sv-country-error" : undefined}
              maxLength={3}
              onChange={() => {
                if (countryError) setCountryError(null);
              }}
            />
            <button className={SV_BTN_SM_GHOST} type="submit">
              {t("add")}
            </button>
          </form>
          {countryError ? (
            <div id="sv-country-error" className="rule warn" role="alert">
              {countryError}
            </div>
          ) : null}
          <div className="said">{t("places.rule")}</div>
        </div>

        <div className={`wcard${filling === 1 ? " filling" : ""}`}>
          <div className="wh">
            <h3>{t("pay.title")}</h3>
            <span className="small muted">{t("pay.hint")}</span>
          </div>
          <div className={`pay-big${noFloor ? " nofloor" : ""}`}>
            {formatAmount(amount, locale)} <small>{currency ? `${currency} ${tPrefs(`period.${period}`)}` : t("pay.noCurrency")}</small>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(scale.max, amount)}
            step={scale.step}
            value={amount}
            aria-label={t("pay.amount")}
            onChange={(e) => {
              const next = Number(e.target.value);
              setAmount(next);
              edit({ salaryFloor: floorPatch(next, currency, period) });
            }}
          />
          <div className="payrow">
            <select
              aria-label={t("pay.currency")}
              value={currency ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setCurrency(next);
                edit({ salaryFloor: floorPatch(amount, next, period) });
              }}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="">{t("pay.noCurrencyOption")}</option>
            </select>
            <select
              aria-label={t("pay.period")}
              value={period}
              onChange={(e) => {
                const next = e.target.value === "year" ? "year" : "month";
                // Restating the period restates the amount (x12), the one conversion the engine allows.
                const restated = next === period ? amount : next === "year" ? amount * 12 : Math.round(amount / 12);
                setPeriod(next);
                setAmount(restated);
                edit({ salaryFloor: floorPatch(restated, currency, next) });
              }}
            >
              <option value="month">{tPrefs("period.month")}</option>
              <option value="year">{tPrefs("period.year")}</option>
            </select>
          </div>
          <div className={`rule${noFloor ? " warn" : ""}`} role={noFloor ? "status" : undefined}>
            {noFloor ? t("pay.ruleWarn") : t("pay.rule")}
          </div>
        </div>

        <div className={`wcard${filling === 2 ? " filling" : ""}`}>
          <div className="wh">
            <h3>{t("titles.title")}</h3>
            <span className="small muted">{t("titles.hint")}</span>
          </div>
          <div className="tokens">
            {prefs.targetTitles.map((l, i) => (
              <span key={l} className="token">
                {l}
                <button type="button" aria-label={t("remove", { value: l })} onClick={() => removeFrom("targetTitles", i)}>
                  ×
                </button>
              </span>
            ))}
            {prefs.targetTitles.length === 0 ? <span className="small muted">{t("titles.none")}</span> : null}
          </div>
          <form className="addin" onSubmit={addTo("targetTitles")}>
            <input name="v" placeholder={t("titles.add")} aria-label={t("titles.add")} />
            <button className={SV_BTN_SM_GHOST} type="submit">
              {t("add")}
            </button>
          </form>
          {/* The target FIELDS the ranking also reads. Older profiles had one seeded
              from the CV's own past field, silently; shown here so it can go. */}
          {prefs.targetRoleFamilies.length ? (
            <div className="tokens" role="group" aria-label={t("titles.families")}>
              <span className="small muted">{t("titles.families")}</span>
              {prefs.targetRoleFamilies.map((fam, i) => (
                <span key={`f-${fam}`} className="token">
                  {enumLabel("family", fam)}
                  <button type="button" aria-label={t("remove", { value: enumLabel("family", fam) })} onClick={() => removeFrom("targetRoleFamilies", i)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="rule">{t("titles.ranks")}</div>
          <div className="said">{t("titles.rule")}</div>
        </div>

        <div className={`wcard${filling === 3 ? " filling" : ""}`}>
          <div className="wh">
            <h3>{t("modes.title")}</h3>
            <span className="small muted">{t("modes.hint")}</span>
          </div>
          <div className="toggles" role="group" aria-label={t("modes.title")}>
            {WORK_MODES.map((m) => {
              const on = prefs.workModes.includes(m);
              return (
                <button key={m} type="button" aria-pressed={on} onClick={() => edit({ workModes: on ? prefs.workModes.filter((x) => x !== m) : [...prefs.workModes, m] })}>
                  {tPrefs(`workMode.${m}`)}
                  <span>{t(`modes.detail.${m}`)}</span>
                </button>
              );
            })}
          </div>
          <div className="said">{t("modes.rule")}</div>
        </div>

        <div className={`wcard${filling === 4 ? " filling" : ""}`}>
          <div className="wh">
            <h3>{t("level.title")}</h3>
            <span className="small muted">{t("level.hint")}</span>
          </div>
          <div className="levels" role="radiogroup" aria-label={t("level.title")}>
            {SENIORITIES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={prefs.seniority === s} onClick={() => edit({ seniority: prefs.seniority === s ? null : s })}>
                {tPrefs(`seniority.${s}`)}
                <span>{t(`level.detail.${s}`)}</span>
              </button>
            ))}
          </div>
          <div className="said">{t("level.rule")}</div>
        </div>

        <div className="wcard">
          <div className="wh">
            <h3>{t("languages.title")}</h3>
            <span className="small muted">{t("languages.hint")}</span>
          </div>
          <div className="tokens">
            {(prefs.languages.length ? prefs.languages : profile.profile.languages ?? []).map((l) => (
              <span key={l} className="token ro">
                {l}
              </span>
            ))}
            {!prefs.languages.length && !(profile.profile.languages ?? []).length ? <span className="small muted">{t("languages.none")}</span> : null}
          </div>
          <div className="said">{t("languages.rule")}</div>
        </div>
      </div>

      <div className="want-foot">
        <span className="confirmed" role="status" aria-live="polite">
          <ProvMark mark={set === 5 ? "solid" : "half"} size={14} />
          {save === "saving" ? t("saving") : save === "saved" ? t("saved", { set }) : t("setCount", { set })}
        </span>
        <a className="btn primary" href="#s-sieve">
          {t("toSieve")}
        </a>
        {changed ? (
          <div className="edited">
            <span>{t("rescoreNote")}</span>
            {scanDoor}
          </div>
        ) : null}
      </div>
      {save === "error" ? <FailureNotice failure={saveError} fallback={t("saveError")} onRetry={() => void flush()} className="mt-3" /> : null}
    </section>
  );
}
