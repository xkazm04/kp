"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BellOff, Check, Languages, MailX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_PRIMARY, BTN_SECONDARY, PANEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { Locale } from "@/i18n/locales";
import { otherLetterLocales, stopLanguageOffer } from "./stopLanguageOffer";

type StopView = {
  jobTitle: string | null;
  company: string | null;
  /** Already opted out — resolved server-side at the durable candidate identity, so a
   *  link from an OLDER letter about a DIFFERENT role still reports the truth. */
  stopped: boolean;
  /** The language our letters go out in (resolved as every dispatch resolves it), and
   *  whether the candidate chose it here (POST /api/stop/[token]/language). */
  letterLocale: string;
  localeChosen: boolean;
};

/** A load failure is one of two things, and the page must not confuse them: the LINK is
 *  gone (404 — nothing to retry), or our side blinked (5xx, a dropped connection — a
 *  retry is the point). Same split, and the same reason, as the /data door. */
type LoadFailure = "dead" | "retryable";

// THE UNSUBSCRIBE PAGE (ePrivacy Art. 13(4); Czech § 7(4)(c) with § 11(2)(a)(4) of zák.
// č. 480/2004 Sb.; German UWG § 7(2) No. 2). The candidate opens it from the "stop these
// messages" footer on any of our mail. One click, no form, no account.
//
// HONEST ABOUT SCOPE, deliberately and in copy. The temptation on a page like this is to
// let the candidate believe more happened than did, because "unsubscribed" sounds
// final. Three facts are stated before the button, not after it:
//   • it stops outreach about openings;
//   • it erases NOTHING — that is the separate Art. 17 link in the same letter, and this
//     page cannot perform it (the opt-out token is scoped to stopping contact and does
//     not open the data door);
//   • it does not withdraw an application — someone mid-process stays in the running and
//     still hears back about it.
// The third is why the copy matters legally as well as decently: a candidate who reads
// "unsubscribe" as "withdraw" and clicks it has been misled into leaving a process.
export function StopClient() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const t = useTranslations("stop");
  const tCommon = useTranslations("common");
  const tLang = useTranslations("language");
  const pageLocale = useLocale();
  const errMsg = useErrorMessage();
  const [view, setView] = useState<StopView | null>(null);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [langBusy, setLangBusy] = useState(false);
  const [langSaved, setLangSaved] = useState<Locale | null>(null);
  const [langError, setLangError] = useState<string | null>(null);

  // `loadFailed` is DEAD-LINK copy, which is the truth for a 404 and a lie for a 5xx —
  // and a lie that closes the door on a legal affordance. The store's own coded message
  // is already localized in all four catalogs, so the retryable half needs no new copy.
  // A plain string computed at render: `errMsg` is a fresh closure each render and must
  // never enter an effect's dependency list.
  const loadRetryMessage = errMsg({ code: "STOP_LOOKUP_FAILED" }, t("loadFailed"));
  const stopErrorMessage = errMsg({ code: "STOP_FAILED" }, t("stopFailed"));

  const load = useCallback(async (): Promise<{ failure: LoadFailure } | { view: StopView }> => {
    if (!token) return { failure: "retryable" };
    try {
      const r = await fetch(`/api/stop/${token}`);
      const p = (await r.json().catch(() => ({}))) as Partial<StopView> & { error?: string };
      // Only a 404 means the link itself is dead; everything else is transient.
      if (r.status === 404) return { failure: "dead" };
      if (!r.ok || p.error) return { failure: "retryable" };
      return { view: p as StopView };
    } catch {
      return { failure: "retryable" };
    }
  }, [token]);

  useEffect(() => {
    let alive = true;
    void load().then((r) => {
      if (!alive) return;
      if ("view" in r) setView(r.view);
      else setLoadFailure(r.failure);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const retryLoad = () => {
    setLoadFailure(null);
    void load().then((r) => {
      if ("view" in r) setView(r.view);
      else setLoadFailure(r.failure);
    });
  };

  // ONE CLICK, no confirm dialog. The /data door guards its button with an alertdialog
  // because erasure is irreversible; this is neither irreversible nor destructive, and
  // a confirm step on an unsubscribe is friction on exactly the affordance the law
  // requires to be easy. (RFC 8058 goes further and lets a mail client POST it with no
  // page at all — the route accepts that, and the write is idempotent either way.)
  const stop = async () => {
    if (!token) return;
    setBusy(true);
    setStopError(null);
    try {
      const res = await fetch(`/api/stop/${token}`, { method: "POST" });
      const p = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || p.error) throw new Error("stop failed");
      setStopped(true);
    } catch {
      // Inline and dismissible beside a still-available button, so a retry costs the
      // candidate nothing. No "already done" reconcile is needed here (the /data door
      // has one because its token is spent on the first use): this token survives, the
      // write is idempotent, and a retry simply succeeds.
      setStopError(stopErrorMessage);
    } finally {
      setBusy(false);
    }
  };

  // THE LANGUAGE CHOICE. The switcher above flips only this PAGE; this writes the
  // language every future letter to this person goes out in. Deliberately not the stop:
  // someone who cannot read our letters usually wants them readable, not gone.
  const chooseLanguage = async (locale: Locale) => {
    if (!token) return;
    setLangBusy(true);
    setLangError(null);
    try {
      const res = await fetch(`/api/stop/${token}/language`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const p = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok || p.error) {
        setLangError(errMsg(p, t("languageFailed")));
        return;
      }
      setLangSaved(locale);
      setView((v) => (v ? { ...v, letterLocale: locale, localeChosen: true } : v));
    } catch {
      setLangError(t("languageFailed"));
    } finally {
      setLangBusy(false);
    }
  };

  const done = stopped || view?.stopped === true;
  const langOffer = view ? stopLanguageOffer(view, pageLocale) : null;
  const langOthers = view ? otherLetterLocales(view.letterLocale, langOffer?.suggest ?? null) : [];

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {/* The candidate's own escape hatch, mirroring the data and offer doors: the link
          is ?lang=-pinned to the language of the letter it rode on, but a forwarded link
          or a stale NEXT_LOCALE cookie can still land them here in a language they do
          not read — and this is the page that must never be unreadable. */}
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <BellOff size={14} /> {t("eyebrow")}
      </p>

      {/* A STABLE page heading in every state (loading, load-error, done, active), so a
          screen-reader user never lands on a headingless page. */}
      <h1 className="mt-1 font-serif text-display text-ink">
        {view?.jobTitle ? t("title", { role: view.jobTitle }) : t("titleGeneric")}
      </h1>

      {view && !loadFailure ? (
        <section className="mt-6 rounded-lg border border-stone-200 bg-paper p-5" aria-labelledby="stop-language-title">
          <p id="stop-language-title" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <Languages size={14} aria-hidden /> {t("languageTitle")}
          </p>
          {langSaved ? (
            <p role="status" className="mt-2 flex items-center gap-2 text-body text-ink">
              <Check size={16} className="text-moss" aria-hidden /> {t("languageSaved", { language: tLang(langSaved) })}
            </p>
          ) : (
            <p className="mt-2 text-body text-ink">
              {t("languageNow", { language: tLang(view.letterLocale as Locale) })}
            </p>
          )}
          {langOffer ? (
            <button
              type="button"
              onClick={() => void chooseLanguage(langOffer.suggest)}
              disabled={langBusy}
              className={`${BTN_SECONDARY} mt-3 h-11 px-4`}
            >
              {t("languageSuggest", { language: tLang(langOffer.suggest) })}
            </button>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-meta text-steel">{t("languageOthers")}</span>
            {langOthers.map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                onClick={() => void chooseLanguage(l)}
                disabled={langBusy}
                className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
              >
                {tLang(l)}
              </button>
            ))}
          </div>
          {langError ? (
            <p role="alert" className="mt-3 text-body text-red-700">
              {langError}
            </p>
          ) : null}
          <p className="mt-3 text-meta text-steel">{t("languageNotStop")}</p>
        </section>
      ) : null}

      {loadFailure ? (
        <div role="alert" className="mt-4 rounded-lg border border-stone-200 bg-paper p-4">
          <p className="text-body text-steel">{loadFailure === "dead" ? t("loadFailed") : loadRetryMessage}</p>
          {loadFailure === "retryable" ? (
            <button type="button" onClick={retryLoad} className={`${BTN_SECONDARY} mt-3 h-11 px-4`}>
              {tCommon("retry")}
            </button>
          ) : null}
        </div>
      ) : !view ? (
        // Skeleton mirroring the loaded page's shape so the first paint reserves its
        // height instead of visibly reflowing into a full page (CLS).
        <div className="mt-6 space-y-6" aria-busy="true" aria-label={tCommon("loading")}>
          <div className="space-y-2 rounded-lg border border-stone-200 bg-paper p-5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className={`${PANEL} space-y-3 p-5`}>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-11 w-56 rounded-md" />
          </div>
        </div>
      ) : done ? (
        <div role="status" className="mt-6 rounded-lg border border-moss/40 bg-moss/5 p-5">
          <p className="flex items-center gap-2 font-serif text-h3 text-ink">
            <Check size={18} className="text-moss" /> {t("doneTitle")}
          </p>
          <p className="mt-2 text-body text-steel">{t("doneBody")}</p>
          {/* Repeated in the done state on purpose: this is the moment a candidate who
              actually wanted an ERASURE discovers that this was not it. */}
          <p className="mt-3 text-meta text-steel">{t("eraseInstead")}</p>
        </div>
      ) : (
        <>
          {view.company ? <p className="mt-1 text-body text-steel">{view.company}</p> : null}

          <div className="mt-6 rounded-lg border border-stone-200 bg-paper p-5">
            <p className="text-meta uppercase tracking-wide text-steel">{t("scopeTitle")}</p>
            <ul className="mt-2 space-y-1.5" role="list">
              {[t("scopeStops"), t("scopeKeepsData"), t("scopeKeepsApplication")].map((line) => (
                <li key={line} className="flex items-start gap-2 text-body text-ink">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-steel" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className={`${PANEL} mt-6 p-5`}>
            <p className="text-body text-steel">{t("explainer")}</p>
            <button type="button" onClick={stop} disabled={busy} className={`${BTN_PRIMARY} mt-4 h-11 px-4`}>
              <MailX size={15} /> {busy ? t("stopping") : t("cta")}
            </button>
            {stopError ? (
              <p role="alert" className="mt-3 text-body text-red-700">
                {stopError}
              </p>
            ) : null}
            <p className="mt-4 text-meta text-steel">{t("eraseInstead")}</p>
          </div>
        </>
      )}
    </main>
  );
}
