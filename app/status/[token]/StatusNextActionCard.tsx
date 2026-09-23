"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY_LG, EYEBROW, PANEL_ACCENT } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { CandidateNextAction } from "@/app/_lib/candidate-next-action";

// "Waiting on you" (challenge-r06 application-status-page/B). At interview and offer
// stage the page used to say "watch your email"; this card names what the server knows
// is pending, with its deadline, and gives the candidate one move: have the link sent
// to their inbox again.
//
// The link itself is NEVER on this page: the status link is forwardable, and an offer
// or booking token here would let whoever holds it act for the candidate. The resend
// door re-delivers it to the address on file, at most once a day, and answers with a
// sentence that does not reveal whether an address is on file.
//
// With no relay configured no email will arrive, so the card states the action and the
// deadline, says the team will reach out, and offers no button (never a promise the
// deployment cannot keep).
export function StatusNextActionCard({
  token,
  nextAction,
  relayConfigured,
}: {
  token: string;
  nextAction: CandidateNextAction | null | undefined;
  relayConfigured: boolean | undefined;
}) {
  const t = useTranslations("status.nextAction");
  const { date, dateTime } = useDateFormat();
  const errMsg = useErrorMessage();
  const [phase, setPhase] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [answer, setAnswer] = useState<"resent" | "resentNoRelay" | null>(null);
  const [failure, setFailure] = useState<{ code?: string | null } | null>(null);

  if (!nextAction) return null;
  const emailPromised = relayConfigured !== false;
  const kindLabel = {
    answer_offer: t("kind.answer_offer"),
    book_interview: t("kind.book_interview"),
    take_interview: t("kind.take_interview"),
  }[nextAction.kind];
  // An offer deadline is an instant (it lapses at a time of day); the others are day-grained.
  const until = nextAction.expiresAt ? (nextAction.kind === "answer_offer" ? dateTime(nextAction.expiresAt) : date(nextAction.expiresAt)) : null;

  const resend = async () => {
    if (phase === "sending") return;
    setPhase("sending");
    setFailure(null);
    try {
      const res = await fetch(`/api/status/${token}/resend`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
      if (res.ok && (body?.message === "resent" || body?.message === "resentNoRelay")) {
        setAnswer(body.message);
        setPhase("done");
        return;
      }
      setFailure({ code: body?.code ?? null });
      setPhase("failed");
    } catch {
      setFailure({ code: null });
      setPhase("failed");
    }
  };

  return (
    <section className={`${PANEL_ACCENT} mt-6 p-4`} aria-labelledby="status-next-action-title">
      <p id="status-next-action-title" className={EYEBROW}>
        {t("title")}
      </p>
      <p className="mt-1 font-serif text-h3 text-ink">{kindLabel}</p>
      <p className="mt-1 text-base text-steel">
        {t("sentOn", { date: date(nextAction.sentAt) })}
        {until ? ` · ${t("openUntil", { date: until })}` : null}
      </p>
      {emailPromised ? (
        <>
          <p className="mt-2 text-base text-steel">{t("where")}</p>
          <div aria-live="polite">
            {phase === "done" && answer ? (
              <p role="status" className="mt-3 text-base text-ink">
                {answer === "resent" ? t("resent") : t("resentNoRelay")}
              </p>
            ) : (
              <button type="button" onClick={() => void resend()} disabled={phase === "sending"} className={`${BTN_SECONDARY_LG} mt-3`}>
                {phase === "sending" ? t("resending") : t("resend")}
              </button>
            )}
          </div>
          {phase === "failed" ? (
            // Never a silent failure: a candidate told nothing would wait for an email.
            <p role="alert" className="mt-2 text-base font-semibold text-coral">
              {errMsg(failure, t("failed"))}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-base text-steel">{t("noRelay")}</p>
      )}
    </section>
  );
}
