"use client";

import { Languages, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { BTN_PRIMARY, CHIP_TOGGLE, META_LABEL } from "@/app/_components/ui/recipes";
import { EmptyState } from "./JobsShared";
import { POSTING_LOCALES, type PostingLocale } from "./jobsMarkdown";
import { usePostingTranslations } from "./jobsPostingTranslations";

// THE POSTING TAB — one document, four language chips, and an honest empty state
// for the ones that do not exist yet.
//
// Two different things can sit behind a chip and the difference matters:
//
//  · the POSTING's own language renders the client-built Markdown, exactly as it
//    always has — structured fields plus catalog scaffolding, no model involved, so
//    it is always there and always current;
//  · any OTHER language renders the stored translation, and when there is none it
//    renders a dashed empty state with the action that makes one.
//
// The old behaviour was to re-render the scaffolding in the chosen language and
// leave the role's own prose untouched — so a "Czech" posting had Czech headings
// over an English description. That is worse than an empty state: it looks like a
// finished document, and it is the artifact a candidate applies against.
export function JobsPostingTab({
  jobId,
  postingLang,
  setPostingLang,
  markdown,
  appLocale,
}: {
  jobId: string;
  postingLang: PostingLocale;
  setPostingLang: (lang: PostingLocale) => void;
  /** The client-built posting in `postingLang`'s scaffolding — the source-language
   *  document, and the fallback while the translations read is still in flight. */
  markdown: string;
  appLocale: PostingLocale;
}) {
  const t = useTranslations("jobs.posting");
  const tr = usePostingTranslations(jobId, appLocale);
  const isSource = postingLang === tr.sourceLang;
  const stored = tr.byLang[postingLang];
  const generatingThis = tr.generating === postingLang;

  return (
    <>
      {/* JOB3 — choose the posting's language independently of the app. A language
          the ROLE was opened in is marked, so the chip row shows which of the four
          this role is actually advertised in without hiding the other three. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className={META_LABEL}>{t("postingLanguage")}</span>
        {POSTING_LOCALES.map((loc) => (
          <button
            key={loc}
            type="button"
            onClick={() => setPostingLang(loc)}
            aria-pressed={postingLang === loc}
            title={tr.roleLangs.includes(loc) ? t("langOpenedIn") : undefined}
            className={`${CHIP_TOGGLE(postingLang === loc)} cursor-pointer px-2.5 py-0.5 uppercase`}
          >
            {loc}
            {tr.roleLangs.includes(loc) ? <span aria-hidden className="ml-1 opacity-70">{"•"}</span> : null}
          </button>
        ))}
      </div>

      {isSource || stored ? (
        <article className="rounded-lg border border-stone-200 bg-paper/40 p-4">
          <Markdown content={isSource ? markdown : stored.bodyMd} />
        </article>
      ) : tr.loading ? (
        // The read is in flight and nothing is known yet: a quiet reserved box, not
        // a spinner and not a premature "no translation" claim.
        <div className="reveal-quiet min-h-[12rem]" aria-hidden />
      ) : (
        <EmptyState
          icon={Languages}
          title={t("noTranslationTitle", { lang: postingLang.toUpperCase() })}
          body={
            <>
              {t("noTranslationBody", { source: tr.sourceLang.toUpperCase() })}
              {tr.error ? (
                <span role="alert" className="mt-2 block text-coral">
                  {tr.error}
                </span>
              ) : null}
            </>
          }
          action={
            <button
              type="button"
              onClick={() => tr.generate(postingLang)}
              disabled={tr.generating !== null}
              className={`${BTN_PRIMARY} cursor-pointer disabled:cursor-default`}
            >
              {generatingThis ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Languages size={14} aria-hidden />}
              {generatingThis ? t("generatingTranslation") : t("generateTranslation")}
            </button>
          }
        />
      )}
    </>
  );
}
