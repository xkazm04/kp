"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BTN_PRIMARY_LG, PANEL } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { CandidateLetterView } from "@/app/_lib/interview-letter-types";
import { foldLetterRequest, statusLetterCopy, statusLetterPhase, type StatusLetterCopyKey } from "./statusLetterView";

// The candidate's FEEDBACK-LETTER card on their own status page (spark
// interview-feedback-letter, WP-beta). After a person decided on their application they may
// ask for a short letter about their AI interview; the card then says, honestly, where that
// one request stands: asked → being prepared → the letter itself, or the team's decision
// not to send individual feedback. Which state shows which copy is pure
// (statusLetterView.ts, pinned by statusLetterView.test.ts).
//
// Calm by design: one click, no confirm step (the request is harmless and idempotent — a
// second click is answered with the same request's state), no spinner beyond the moment
// the request is in flight, and a failure that says so and leaves the button in place.
export function StatusLetterCard({
  token,
  letter,
  relayConfigured,
  onLetter,
}: {
  token: string;
  letter: CandidateLetterView | undefined;
  /** False when no delivery relay is configured: no email will arrive, so none is promised. */
  relayConfigured: boolean | undefined;
  /** The door's answer, written back into the page's view so the card and the next poll agree. */
  onLetter: (letter: CandidateLetterView) => void;
}) {
  const t = useTranslations("status");
  const locale = useLocale();
  const { date } = useDateFormat();
  const errMsg = useErrorMessage();
  const [sending, setSending] = useState(false);
  // A coded failure of the last request, resolved in the reader's language.
  const [failure, setFailure] = useState<{ code: string | null } | null>(null);

  const phase = statusLetterPhase(letter);
  // Nothing to offer and nothing to report — unless the last request just came back
  // "not available", which is said once rather than the button silently vanishing.
  if (phase === "hidden" && !failure) return null;
  const copy = statusLetterCopy(phase, relayConfigured);
  // Literal keys: next-intl types them, and the copy map in statusLetterView.ts is pinned
  // to this literal by statusLetterView.test.ts.
  const text: Record<StatusLetterCopyKey, string> = {
    "letter.offer": t("letter.offer"),
    "letter.requested": t("letter.requested", { date: date(letter?.requestedAt) }),
    "letter.preparing": t("letter.preparing"),
    "letter.sentIntro": t("letter.sentIntro"),
    "letter.declined": t("letter.declined"),
    "letter.whenReadyEmail": t("letter.whenReadyEmail"),
    "letter.whenReadyPage": t("letter.whenReadyPage"),
  };

  const request = async () => {
    if (sending) return;
    setSending(true);
    setFailure(null);
    try {
      let outcome;
      try {
        const res = await fetch(`/api/status/${token}/letter`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The language this page is showing: the letter is written in it.
          body: JSON.stringify({ lang: locale }),
        });
        outcome = foldLetterRequest({ ok: res.ok, status: res.status }, await res.json().catch(() => null));
      } catch {
        outcome = foldLetterRequest(null, null);
      }
      if (outcome.kind === "letter") {
        onLetter(outcome.letter);
        return;
      }
      if (outcome.kind === "not_eligible") {
        // The button goes (asking again cannot change the answer); the reason is said once.
        onLetter({ canRequest: false, state: null, requestedAt: null, text: null });
      }
      setFailure({ code: outcome.code });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mt-8 rounded-lg border border-stone-200 bg-paper p-4" aria-labelledby="status-letter-title">
      <h2 id="status-letter-title" className="text-body font-semibold text-ink">
        {t("letter.title")}
      </h2>
      {/* Polite live region: a request that lands swaps the offer for its state, and a
          screen-reader user must hear that it did. */}
      <div aria-live="polite">
        {copy.body ? <p className="mt-1 text-base text-steel">{text[copy.body]}</p> : null}
        {phase === "sent" && letter?.text ? (
          // The approved letter, verbatim: a person owns every sentence of it.
          <div className={`${PANEL} mt-3 whitespace-pre-line p-4 text-base text-ink`}>{letter.text}</div>
        ) : null}
        {copy.followUp ? <p className="mt-2 text-base text-steel">{text[copy.followUp]}</p> : null}
      </div>
      {phase === "offer" ? (
        <button type="button" onClick={() => void request()} disabled={sending} className={`${BTN_PRIMARY_LG} mt-3`}>
          {sending ? t("letter.requesting") : t("letter.request")}
        </button>
      ) : null}
      {failure ? (
        // Never a silent failure: a candidate told nothing would believe they asked.
        <p role="alert" className="mt-2 text-base font-semibold text-coral">
          {errMsg(failure, t("letter.failed"))}
        </p>
      ) : null}
    </section>
  );
}
