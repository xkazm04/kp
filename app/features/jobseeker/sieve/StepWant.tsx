"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChapterHead } from "./ChapterHead";
import { useTranslations } from "next-intl";
import { SENIORITIES, WORK_MODES, type JobseekerPreferences, type JobseekerProfile, type Seniority, type WorkMode } from "@/app/_lib/jobseeker/types";
import { Banknote, Crosshair, Languages, Laptop, MapPin, TrendingUp } from "lucide-react";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { FailureNotice } from "../FailureNotice";
import { addLanguage, normalizeLanguages } from "./languageEntries";
import { ProvMark } from "./marks";
import { SV_BTN_SM_GHOST } from "./sieveRecipes";
import { useWantSave } from "./useWantSave";
import { WantCard, type WantCardCommit } from "./WantCard";
import { WantLanguagesEditor, type LanguagesDraft } from "./WantLanguages";
import { addToken, changedFields, countryCodeOf, payDraftOf, payFloorOf, payScale, restatePeriod, wantSetCount, type PayDraft } from "./wantModel";

// Step 4 — "Five things steer the search": places, the pay floor, titles, work modes and
// the level, plus the seeker's languages (which steer the designed CV, not the search).
//
// Each card has two layers (WantCard): a VIEW that states its value large, and an EDIT
// layer opened by a click, whose controls work on a draft and save once, on Done. A
// draft is never overwritten by a save's echo - the defect this shape replaced, where a
// currency picked before an amount (or an amount before a currency) saved "no floor"
// and snapped back (wantModel.ts). Saves go one at a time in commit order
// (useWantSave.ts), as `PUT /api/jobseeker/profile` with `preferencesReplace`, so
// removing the last place really empties the list.
//
// The scores on screen were computed against the preferences at the last scan, and the
// step says so beside a Scan now - it never pretends an edit re-scored 98 postings in
// the browser. "A floor without a currency is not a floor" is a rule of the engine
// (profile.ts parseSalaryFloor): Done refuses an amount with no currency and says so,
// instead of storing no floor behind the seeker's back.

type PlacesDraft = { locations: string[]; countries: string[]; city: string; country: string; countryError: string | null };
type TitlesDraft = { titles: string[]; families: string[]; typed: string };

function formatAmount(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** An "Add" row whose text lives in the draft: Enter or the button adds it. */
function AddRow({ value, placeholder, onType, onAdd, invalid, describedBy, maxLength }: { value: string; placeholder: string; onType(v: string): void; onAdd(): void; invalid?: boolean; describedBy?: string; maxLength?: number }) {
  const t = useTranslations("me.sieve.want");
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAdd();
    }
  };
  return (
    <div className="addin">
      <input value={value} onChange={(e) => onType(e.target.value)} onKeyDown={onKey} placeholder={placeholder} aria-label={placeholder} aria-invalid={invalid || undefined} aria-describedby={describedBy} maxLength={maxLength} />
      <button className={SV_BTN_SM_GHOST} type="button" onClick={onAdd}>
        {t("add")}
      </button>
    </div>
  );
}

function Tokens({ items, className, label, onRemove }: { items: string[]; className?: string; label?: (v: string) => string; onRemove(i: number): void }) {
  const t = useTranslations("me.sieve.want");
  return (
    <>
      {items.map((v, i) => (
        <span key={`${v}-${i}`} className={`token${className ? ` ${className}` : ""}`}>
          {label ? label(v) : v}
          <button type="button" aria-label={t("remove", { value: label ? label(v) : v })} onClick={() => onRemove(i)}>
            ×
          </button>
        </span>
      ))}
    </>
  );
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
  const { prefs, state, failure, changed, commit, retry } = useWantSave(profile, onSaved);
  const [filling, setFilling] = useState<number>(-1);
  const sectionRef = useRef<HTMLElement | null>(null);
  const profileId = profile?.id ?? null;

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

  if (!profile || !prefs) {
    return (
      <section className="step" id="s-want" data-step="want" aria-labelledby="h-want">
        <ChapterHead n={4} id="h-want" eyebrow={t("eyebrow")} title={t("title")} />
        <div className="gapbox">
          <strong>{t("notReached")}</strong>
          <span>{t("notReachedBody")}</span>
        </div>
      </section>
    );
  }

  /** Done: send only what the card changed. */
  const save = (next: Partial<JobseekerPreferences>): WantCardCommit => {
    const patch = changedFields(prefs, next);
    if (Object.keys(patch).length) commit(patch);
    return { ok: true };
  };
  const more = (items: string[], shown: number) => (items.length > shown ? t("more", { n: items.length - shown }) : null);

  // ---- places ----
  const places = [...prefs.locations, ...prefs.countries.map((c) => c.toUpperCase())];
  const placesCard = (
    <WantCard<PlacesDraft>
      title={t("places.title")}
      hint={t("places.hint")}
      icon={<MapPin size={18} aria-hidden />}
      filling={filling === 1}
      empty={places.length === 0}
      value={places.length ? places.slice(0, 3).join(", ") : "—"}
      valueText={places.length ? places.join(", ") : t("places.empty")}
      sub={places.length ? more(places, 3) : t("places.empty")}
      rule={t("places.rule")}
      draftOf={() => ({ locations: [...prefs.locations], countries: [...prefs.countries], city: "", country: "", countryError: null })}
      editor={(d, set) => {
        const addCountry = () => {
          if (!d.country.trim()) return;
          const code = countryCodeOf(d.country);
          if (!code) return set({ ...d, countryError: t("places.countryInvalid", { value: d.country.trim() }) });
          set({ ...d, countries: addToken(d.countries, code), country: "", countryError: null });
        };
        return (
          <>
            <div className="tokens">
              <Tokens items={d.locations} className="pin" onRemove={(i) => set({ ...d, locations: d.locations.filter((_, j) => j !== i) })} />
              <Tokens items={d.countries} className="country" label={(c) => c.toUpperCase()} onRemove={(i) => set({ ...d, countries: d.countries.filter((_, j) => j !== i) })} />
              {d.locations.length + d.countries.length === 0 ? <span className="small muted">{t("places.none")}</span> : null}
            </div>
            <AddRow value={d.city} placeholder={t("places.add")} onType={(city) => set({ ...d, city })} onAdd={() => set({ ...d, locations: addToken(d.locations, d.city), city: "" })} />
            <AddRow value={d.country} placeholder={t("places.country")} maxLength={3} invalid={!!d.countryError} describedBy={d.countryError ? "sv-country-error" : undefined} onType={(country) => set({ ...d, country, countryError: null })} onAdd={addCountry} />
            {d.countryError ? (
              <div id="sv-country-error" className="rule warn" role="alert">
                {d.countryError}
              </div>
            ) : null}
          </>
        );
      }}
      commit={(d) => {
        // Text typed but not added still counts; a country code the engine cannot read
        // is said, never dropped.
        const country = d.country.trim();
        const code = country ? countryCodeOf(country) : null;
        if (country && !code) return { ok: false, message: t("places.countryInvalid", { value: country }) };
        return save({ locations: addToken(d.locations, d.city), countries: code ? addToken(d.countries, code) : d.countries });
      }}
    />
  );

  // ---- pay floor ----
  const floor = prefs.salaryFloor;
  const payCard = (
    <WantCard<PayDraft>
      title={t("pay.title")}
      hint={t("pay.hint")}
      icon={<Banknote size={18} aria-hidden />}
      filling={filling === 2}
      empty={!floor}
      value={floor ? `${formatAmount(floor.amount, locale)} ${floor.currency}` : "—"}
      valueText={floor ? `${formatAmount(floor.amount, locale)} ${floor.currency} ${tPrefs(`period.${floor.period}`)}` : t("pay.empty")}
      sub={floor ? tPrefs(`period.${floor.period}`) : t("pay.empty")}
      rule={t("pay.rule")}
      draftOf={() => payDraftOf(floor)}
      editor={(d, set) => {
        const scale = payScale(d.currency, d.period);
        const currencies = Array.from(new Set(["CZK", "EUR", ...(d.currency ? [d.currency] : [])]));
        const noCurrency = d.amount > 0 && !d.currency;
        return (
          <>
            <div className={`pay-big${noCurrency ? " nofloor" : ""}`}>
              {formatAmount(d.amount, locale)} <small>{d.currency ? `${d.currency} ${tPrefs(`period.${d.period}`)}` : t("pay.noCurrency")}</small>
            </div>
            <input type="range" min={0} max={Math.max(scale.max, d.amount)} step={scale.step} value={d.amount} aria-label={t("pay.amount")} onChange={(e) => set({ ...d, amount: Number(e.target.value) })} />
            <div className="payrow">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={scale.step}
                value={d.amount}
                aria-label={t("pay.amountExact")}
                onChange={(e) => set({ ...d, amount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              />
              <select aria-label={t("pay.currency")} value={d.currency ?? ""} onChange={(e) => set({ ...d, currency: e.target.value || null })}>
                <option value="">{t("pay.noCurrencyOption")}</option>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select aria-label={t("pay.period")} value={d.period} onChange={(e) => set(restatePeriod(d, e.target.value === "year" ? "year" : "month"))}>
                <option value="month">{tPrefs("period.month")}</option>
                <option value="year">{tPrefs("period.year")}</option>
              </select>
            </div>
            {noCurrency ? (
              <div className="rule warn" role="status">
                {t("pay.ruleWarn")}
              </div>
            ) : null}
          </>
        );
      }}
      commit={(d) => {
        const out = payFloorOf(d);
        if ("error" in out) return { ok: false, message: t("pay.needCurrency") };
        return save({ salaryFloor: out.floor });
      }}
    />
  );

  // ---- titles ----
  const titles = prefs.targetTitles;
  const families = prefs.targetRoleFamilies.map((f) => enumLabel("family", f));
  const titlesCard = (
    <WantCard<TitlesDraft>
      title={t("titles.title")}
      hint={t("titles.hint")}
      icon={<Crosshair size={18} aria-hidden />}
      wide
      filling={filling === 0}
      empty={titles.length === 0}
      value={titles.length ? titles.slice(0, 2).join(" · ") : "—"}
      valueText={titles.length ? titles.join(", ") : t("titles.empty")}
      sub={titles.length ? [more(titles, 2), families.length ? t("titles.andFields", { fields: families.join(", ") }) : null].filter(Boolean).join(" · ") || null : t("titles.empty")}
      rule={t("titles.ranks")}
      draftOf={() => ({ titles: [...titles], families: [...prefs.targetRoleFamilies], typed: "" })}
      editor={(d, set) => (
        <>
          <div className="tokens">
            <Tokens items={d.titles} onRemove={(i) => set({ ...d, titles: d.titles.filter((_, j) => j !== i) })} />
            {d.titles.length === 0 ? <span className="small muted">{t("titles.none")}</span> : null}
          </div>
          <AddRow value={d.typed} placeholder={t("titles.add")} onType={(typed) => set({ ...d, typed })} onAdd={() => set({ ...d, titles: addToken(d.titles, d.typed), typed: "" })} />
          {/* The target FIELDS the ranking also reads. Older profiles had one seeded
              from the CV's own past field, silently; shown here so it can go. */}
          {d.families.length ? (
            <div className="tokens" role="group" aria-label={t("titles.families")}>
              <span className="small muted">{t("titles.families")}</span>
              <Tokens items={d.families} label={(f) => enumLabel("family", f)} onRemove={(i) => set({ ...d, families: d.families.filter((_, j) => j !== i) })} />
            </div>
          ) : null}
          <div className="rule">{t("titles.rule")}</div>
        </>
      )}
      commit={(d) => save({ targetTitles: addToken(d.titles, d.typed), targetRoleFamilies: d.families })}
    />
  );

  // ---- work modes ----
  const modes = WORK_MODES.filter((m) => prefs.workModes.includes(m));
  const modesCard = (
    <WantCard<WorkMode[]>
      title={t("modes.title")}
      hint={t("modes.hint")}
      icon={<Laptop size={18} aria-hidden />}
      filling={filling === 3}
      empty={modes.length === 0}
      value={modes.length ? modes.map((m) => tPrefs(`workMode.${m}`)).join(" · ") : "—"}
      valueText={modes.length ? modes.map((m) => tPrefs(`workMode.${m}`)).join(", ") : t("modes.empty")}
      sub={modes.length ? null : t("modes.empty")}
      rule={t("modes.rule")}
      draftOf={() => [...modes]}
      editor={(d, set) => (
        <div className="toggles" role="group" aria-label={t("modes.title")}>
          {WORK_MODES.map((m) => {
            const on = d.includes(m);
            return (
              <button key={m} type="button" aria-pressed={on} onClick={() => set(on ? d.filter((x) => x !== m) : WORK_MODES.filter((x) => x === m || d.includes(x)))}>
                {tPrefs(`workMode.${m}`)}
                <span>{t(`modes.detail.${m}`)}</span>
              </button>
            );
          })}
        </div>
      )}
      commit={(d) => save({ workModes: d })}
    />
  );

  // ---- level ----
  const level = prefs.seniority;
  const levelCard = (
    <WantCard<Seniority | null>
      title={t("level.title")}
      hint={t("level.hint")}
      icon={<TrendingUp size={18} aria-hidden />}
      filling={filling === 4}
      empty={!level}
      value={level ? tPrefs(`seniority.${level}`) : "—"}
      valueText={level ? tPrefs(`seniority.${level}`) : t("level.empty")}
      sub={level ? t(`level.detail.${level}`) : t("level.empty")}
      rule={t("level.rule")}
      draftOf={() => level}
      editor={(d, set) => (
        <div className="levels" role="radiogroup" aria-label={t("level.title")}>
          {SENIORITIES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={d === s} onClick={() => set(d === s ? null : s)}>
              {tPrefs(`seniority.${s}`)}
              <span>{t(`level.detail.${s}`)}</span>
            </button>
          ))}
        </div>
      )}
      commit={(d) => save({ seniority: d })}
    />
  );

  // ---- languages ----
  const ownLanguages = prefs.languages.length > 0;
  const cvLanguages = normalizeLanguages(profile.profile.languages ?? []);
  const languages = ownLanguages ? normalizeLanguages(prefs.languages) : cvLanguages;
  const languagesCard = (
    <WantCard<LanguagesDraft>
      title={t("languages.title")}
      hint={ownLanguages ? t("languages.hintOwn") : t("languages.hint")}
      icon={<Languages size={18} aria-hidden />}
      wide
      filling={false}
      empty={languages.length === 0}
      value={languages.length ? languages.slice(0, 3).join(" · ") : "—"}
      valueText={languages.length ? languages.join(", ") : t("languages.none")}
      sub={languages.length ? more(languages, 3) : t("languages.none")}
      rule={t("languages.ruleEdit")}
      draftOf={() => ({ list: [...languages], typed: "" })}
      editor={(d, set) => <WantLanguagesEditor draft={d} onChange={set} />}
      commit={(d) => {
        const list = d.typed.trim() ? addLanguage(d.list, d.typed) : d.list;
        // Done on the CV's own list, untouched, states nothing of the seeker's own.
        if (!ownLanguages && JSON.stringify(list) === JSON.stringify(cvLanguages)) return { ok: true };
        return save({ languages: list });
      }}
    />
  );

  const set = wantSetCount(prefs);
  return (
    <section className="step" id="s-want" data-step="want" aria-labelledby="h-want" ref={sectionRef}>
      <ChapterHead n={4} id="h-want" eyebrow={t("eyebrow")} title={t("title")} lede={t("lede")} />
      {/* A bento: the titles lead (the ranking reads them first) and the two cards whose
          values run long take two columns. */}
      <div className="wants">
        {titlesCard}
        {placesCard}
        {payCard}
        {modesCard}
        {levelCard}
        {languagesCard}
      </div>

      <div className="want-foot">
        <span className="confirmed" role="status" aria-live="polite">
          <ProvMark mark={set === 5 ? "solid" : "half"} size={14} />
          {state === "saving" ? t("saving") : state === "saved" ? t("saved", { set }) : t("setCount", { set })}
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
      {state === "error" ? <FailureNotice failure={failure} fallback={t("saveError")} onRetry={retry} className="mt-3" /> : null}
    </section>
  );
}
