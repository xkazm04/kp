"use client";

import { useTranslations } from "next-intl";

/** What a failed must-have owes the applicant, shared by BOTH doors' screens (the
 *  conversational ApplyDoneCard and the quick form): the must-have(s) they answered no
 *  to, in plain words and their own language.
 *
 *  `held` (the live outcome since the Q1 ruling): nothing has been decided — a person
 *  reviews the application first — so the screen says exactly that and offers no review
 *  route yet; the route arrives in the letter, if a person confirms the rejection.
 *  Without `held` (the pre-Q1 decline, kept for the contract) it points at the review.
 *
 *  The names arrive from the server already localized (`failedKoNames`). The review
 *  line says an email is being SENT, never that one arrived: the server can vouch for
 *  handing it to a relay, not for delivery — and with no relay it says so instead. */
export function ApplyDeclineDetail({ names, reviewByEmail, held = false }: { names: readonly string[]; reviewByEmail: boolean; held?: boolean }) {
  const t = useTranslations("apply");
  return (
    <div className="mt-3 space-y-2 text-body text-steel">
      {names.length > 0 ? (
        <div>
          <p className="font-semibold text-ink">{held ? t("heldMustHave") : t("declinedMustHave")}</p>
          <ul className="mt-1 list-disc pl-5">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {held ? (
        <p>{t("heldNote")}</p>
      ) : (
        <>
          <p>{t("declinedAutoNote")}</p>
          <p>{reviewByEmail ? t("declinedReviewEmail") : t("declinedReviewNoEmail")}</p>
        </>
      )}
    </div>
  );
}
