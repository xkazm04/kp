"use client";

import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { addLanguage, isLanguageLevel, LANGUAGE_LEVELS, MAX_LANGUAGE_NAME, MAX_LANGUAGES, normalizeLanguages, readLanguage, removeLanguage, setLanguageLevel } from "./languageEntries";
import { SV_BTN_SM_GHOST } from "./sieveRecipes";

// The Want step's languages card: the seeker's own list, each language with its level.
// It opens on what the CV said (profile.languages) until the seeker states their own
// (preferences.languages); the first edit stores the whole list, so it starts from the
// CV's rather than from nothing. The designed CV prints the stored list in place of the
// CV's own Languages block (cvDocument.ts buildCvDocument).

export function WantLanguages({
  own,
  fromCv,
  onChange,
}: {
  /** preferences.languages — the seeker's own statement, possibly empty. */
  own: readonly string[];
  /** profile.languages — what the CV reading found. */
  fromCv: readonly string[];
  onChange(next: string[]): void;
}) {
  const t = useTranslations("me.sieve.want");
  const isOwn = own.length > 0;
  const list = normalizeLanguages(isOwn ? own : fromCv);
  const full = list.length >= MAX_LANGUAGES;

  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("v") as HTMLInputElement | null;
    const raw = (input?.value ?? "").trim();
    if (!raw) return;
    const next = addLanguage(list, raw);
    if (next.length !== list.length) onChange(next);
    if (input) input.value = "";
  };

  return (
    <div className="wcard">
      <div className="wh">
        <h3>{t("languages.title")}</h3>
        <span className="small muted">{isOwn ? t("languages.hintOwn") : t("languages.hint")}</span>
      </div>
      <div className="tokens" role="group" aria-label={t("languages.title")}>
        {list.map((l, i) => {
          const entry = readLanguage(l);
          if (!entry) return null;
          const level = entry.level ?? "";
          // A level the CV stated in its own words ("fluent") stays selectable as that word.
          const ownWord = level && !isLanguageLevel(level) ? level : null;
          return (
            <span key={entry.name.toLowerCase()} className="payrow">
              <span className="token">
                {entry.name}
                <button type="button" aria-label={t("remove", { value: entry.name })} onClick={() => onChange(removeLanguage(list, i))}>
                  ×
                </button>
              </span>
              <select aria-label={t("languages.levelOf", { value: entry.name })} value={level} onChange={(e) => onChange(setLanguageLevel(list, i, e.target.value || null))}>
                <option value="">{t("languages.levelNone")}</option>
                {LANGUAGE_LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    {lv === "native" ? t("languages.native") : lv}
                  </option>
                ))}
                {ownWord ? <option value={ownWord}>{ownWord}</option> : null}
              </select>
            </span>
          );
        })}
        {list.length === 0 ? <span className="small muted">{t("languages.none")}</span> : null}
      </div>
      <form className="addin" onSubmit={add}>
        <input name="v" placeholder={t("languages.add")} aria-label={t("languages.add")} maxLength={MAX_LANGUAGE_NAME} disabled={full} />
        <button className={SV_BTN_SM_GHOST} type="submit" disabled={full}>
          {t("add")}
        </button>
      </form>
      {full ? (
        <div className="rule" role="status">
          {t("languages.full", { max: MAX_LANGUAGES })}
        </div>
      ) : null}
      <div className="said">{t("languages.ruleEdit")}</div>
    </div>
  );
}
