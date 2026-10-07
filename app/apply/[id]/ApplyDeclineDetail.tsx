"use client";

import { useTranslations } from "next-intl";

/** What a knockout decline owes the person it turned away, shared by BOTH doors'
 *  decline screens (the conversational ApplyDoneCard and the quick form): the
 *  must-have(s) they answered no to, in plain words and their own language, that the
 *  decision was automatic, and how to ask a person to review it.
 *
 *  The names arrive from the server already localized (`failedKoNames`). The review
 *  line says an email is being SENT, never that one arrived: the server can vouch for
 *  handing it to a relay, not for delivery — and with no relay it says so instead. */
export function ApplyDeclineDetail({ names, reviewByEmail }: { names: readonly string[]; reviewByEmail: boolean }) {
  const t = useTranslations("apply");
  return (
    <div className="mt-3 space-y-2 text-base text-steel">
      {names.length > 0 ? (
        <div>
          <p className="font-semibold text-ink">{t("declinedMustHave")}</p>
          <ul className="mt-1 list-disc pl-5">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p>{t("declinedAutoNote")}</p>
      <p>{reviewByEmail ? t("declinedReviewEmail") : t("declinedReviewNoEmail")}</p>
    </div>
  );
}
