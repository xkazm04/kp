"use client";

import { useLocale, useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { pinLinkLocale } from "@/app/_lib/candidate-link-locale";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";

// The "Issue Durable Skill Profile" button + share link, split out of
// DevSubmissionRow.tsx.
//
// The failure line used to assert ONE cause for every failure — a precondition on the
// evaluation plus a signing secret — so a 503, a tenancy 404 or a dropped connection
// all told the recruiter to go and do work they had already done, and named a server
// environment variable at them while doing it. An env-var name is not a recruiter's
// remedy and does not belong in product copy. The mint answers with a
// machine `code`; that code resolves in the reader's language through the shared
// `errors` catalog, and anything without one gets a neutral generic instead of a
// confident guess.
export function DevSubmissionRowSkillProfile({
  dsp,
  onIssue,
}: {
  dsp: { status: "idle" | "issuing" | "done" | "error"; token: string | null; code: string | null };
  onIssue: () => void;
}) {
  const t = useTranslations("devcase.skillProfile");
  const errMsg = useErrorMessage();
  // The credential link is the ONE candidate-facing link in the product that was
  // never ?lang=-pinned, so it resolved from a cookie or Accept-Language and could
  // open a shared credential in a language its reader does not have. Pinned to the
  // locale it is opened/copied FROM, the convention every other door follows.
  // Residual: no candidate locale is threaded into this row, so when the link is
  // later mailed to the candidate the sender must pin it with resolveCommsLocale
  // (comms-dispatch.ts) instead of reusing this one.
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-micro">
      <button
        type="button"
        onClick={onIssue}
        disabled={dsp.status === "issuing"}
        className={`${BTN_SECONDARY} h-7 px-2`}
      >
        {dsp.status === "issuing" ? t("issuing") : dsp.status === "done" ? t("reissue") : t("issue")}
      </button>
      {dsp.status === "done" && dsp.token ? (
        <a
          href={pinLinkLocale(`/skill/${dsp.token}`, locale)}
          target="_blank"
          rel="noreferrer"
          className="focus-ring rounded text-ink underline"
        >
          {t("view")}
        </a>
      ) : null}
      {dsp.status === "error" ? (
        <span role="alert" className="text-coral">
          {errMsg({ code: dsp.code }, t("failed"))}
        </span>
      ) : null}
    </div>
  );
}
