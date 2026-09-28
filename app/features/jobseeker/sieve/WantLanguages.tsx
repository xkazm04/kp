"use client";

import type { KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { addLanguage, isLanguageLevel, LANGUAGE_LEVELS, MAX_LANGUAGE_NAME, MAX_LANGUAGES, readLanguage, removeLanguage, setLanguageLevel } from "./languageEntries";
import { SV_BTN_SM_GHOST } from "./sieveRecipes";

// The languages card's EDIT layer (WantCard holds the view and the Done/Cancel): the
// draft list, each language with its level. The card opens on the seeker's own list
// (preferences.languages) or, until they state one, on what the CV said
// (profile.languages); Done stores the whole list, so a first edit starts from the CV's
// rather than from nothing. The designed CV prints the stored list in place of the CV's
// own Languages block (cvDocument.ts buildCvDocument). Text typed but not yet added is part
// of the draft (`typed`), so Done keeps it (StepWant's commit adds it).

export type LanguagesDraft = { list: string[]; typed: string };

export function WantLanguagesEditor({ draft, onChange }: { draft: LanguagesDraft; onChange(next: LanguagesDraft): void }) {
  const t = useTranslations("me.sieve.want");
  const { list, typed } = draft;
  const set = (next: string[]) => onChange({ ...draft, list: next });
  const full = list.length >= MAX_LANGUAGES;

  const add = () => {
    if (!typed.trim()) return;
    onChange({ list: addLanguage(list, typed), typed: "" });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };

  return (
    <>
      <div className="langs" role="group" aria-label={t("languages.title")}>
        {list.map((l, i) => {
          const entry = readLanguage(l);
          if (!entry) return null;
          const level = entry.level ?? "";
          // A level the CV stated in its own words ("fluent") stays selectable as that word.
          const ownWord = level && !isLanguageLevel(level) ? level : null;
          return (
            <div key={entry.name.toLowerCase()} className="langrow">
              <span className="token">
                {entry.name}
                <button type="button" aria-label={t("remove", { value: entry.name })} onClick={() => set(removeLanguage(list, i))}>
                  ×
                </button>
              </span>
              <select aria-label={t("languages.levelOf", { value: entry.name })} value={level} onChange={(e) => set(setLanguageLevel(list, i, e.target.value || null))}>
                <option value="">{t("languages.levelNone")}</option>
                {LANGUAGE_LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    {lv === "native" ? t("languages.native") : lv}
                  </option>
                ))}
                {ownWord ? <option value={ownWord}>{ownWord}</option> : null}
              </select>
            </div>
          );
        })}
        {list.length === 0 ? <span className="small muted">{t("languages.none")}</span> : null}
      </div>
      <div className="addin">
        <input value={typed} onChange={(e) => onChange({ ...draft, typed: e.target.value })} onKeyDown={onKey} placeholder={t("languages.add")} aria-label={t("languages.add")} maxLength={MAX_LANGUAGE_NAME} disabled={full} />
        <button className={SV_BTN_SM_GHOST} type="button" onClick={add} disabled={full}>
          {t("add")}
        </button>
      </div>
      {full ? (
        <div className="rule" role="status">
          {t("languages.full", { max: MAX_LANGUAGES })}
        </div>
      ) : null}
    </>
  );
}
