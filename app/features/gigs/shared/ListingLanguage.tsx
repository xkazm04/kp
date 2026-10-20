"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { GigBrief } from "@/app/_lib/gigs/types";
import { foreignLanguage } from "../logic/report";
import { revealInvisible } from "../logic/untrusted";

// A listing written in another language than English (the brief's `language`, prompt
// gig-brief-v4): a tag naming the language, and the English translation the research model
// wrote (`listingEnglish`) - the operator reads every gig in English. The translation is the
// stranger's words carried over, so it is framed like the listing itself (styles/records.css
// `.uf`): plain text, links never followed, invisible characters shown. The report's hero
// keeps it one click away; the Listing tab shows it open above the original.

/** The language's name in the reader's language ("Czech", "čeština"), or its code. */
export function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code.toUpperCase();
  } catch {
    // An unknown or malformed code: the code itself is still the truth.
    return code.toUpperCase();
  }
}

export function ListingLanguage({ brief, open: always = false }: { brief: GigBrief | null; open?: boolean }) {
  const t = useTranslations("gigs.report.lang");
  const locale = useLocale();
  const id = useId();
  const [shown, setShown] = useState(false);
  const code = foreignLanguage(brief?.language);
  if (!brief || !code) return null;
  const language = languageName(code, locale);
  const english = brief.listingEnglish?.trim() || null;
  const open = always || shown;
  return (
    <div className="lang">
      <p className="lang-row">
        <span className="lang-tag">{t("tag", { language })}</span>
        {!english ? (
          <span className="t-meta">{t("none")}</span>
        ) : always ? null : (
          <button type="button" className="linkbtn" aria-expanded={shown} aria-controls={id} onClick={() => setShown((v) => !v)}>
            {shown ? t("hide") : t("read")}
          </button>
        )}
      </p>
      {english && open ? (
        <div id={id} className="uf lang-en">
          <p className="uf-head">
            <span className="uf-tag">{t("enTag")}</span>
            <span>{t("enNote", { language })}</span>
          </p>
          <div className="uf-body">
            {revealInvisible(english).map((s, i) =>
              s.kind === "text" ? (
                <span key={i}>{s.text}</span>
              ) : (
                <span key={i} className="uf-cp">
                  {s.code}
                </span>
              )
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
