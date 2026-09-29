"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button, Mark } from "@/app/_components/kit";
import type { Gig, GigWithdrawReason } from "@/app/_lib/gigs/types";
import { briefChallenges, challengeKey, tallyWithdrawReasons, withdrawCountsByKey } from "@/app/_lib/gigs/withdraw-reasons";

// The brief's "Expected challenges" as rows the operator can act on: each bullet is a
// reason to take the gig off the line, one click away ("Withdraw for this"), and the one
// they pick is remembered (withdraw-reasons.ts) so later scans write a repeat in the same
// words and this list can say "you withdrew 3 gigs for this before". The sign-off's plain
// Withdraw stays for any reason the brief did not name.

export type ChallengeWithdraw = {
  /** Null when the gig's state no longer allows a withdraw: the rows stay, the buttons go. */
  onWithdraw: ((index: number) => void) | null;
  /** The bullet being withdrawn for right now. */
  busy: number | null;
  /** Past withdraws by challengeKey, this gig excluded. */
  counts: ReadonlyMap<string, number>;
  /** Why this gig was withdrawn, when it was for a bullet. */
  reason: GigWithdrawReason | null;
};

/** The gig's challenges, the past withdraws by reason (this gig left out), and how many of
 *  its challenges the operator withdrew other gigs for (the Brief tab's mark). */
export function useChallengeMemory(gigs: readonly Gig[], gig: Gig | null) {
  const challenges = useMemo(() => briefChallenges(gig?.brief), [gig?.brief]);
  const id = gig?.id ?? null;
  const counts = useMemo(() => withdrawCountsByKey(tallyWithdrawReasons(gigs.filter((g) => g.id !== id))), [gigs, id]);
  const recurring = challenges.filter((c) => (counts.get(challengeKey(c)) ?? 0) > 0).length;
  return { challenges, counts, recurring };
}

export function BriefChallenges({ id, heading, challenges, withdraw }: { id: string | undefined; heading: string; challenges: readonly string[]; withdraw: ChallengeWithdraw }) {
  const t = useTranslations("gigs");
  if (challenges.length === 0) return null;
  const chosen = withdraw.reason ? challengeKey(withdraw.reason.challenge) : null;
  return (
    <section className="brief-challenges" aria-label={heading}>
      <h2 id={id} tabIndex={id ? -1 : undefined} className="bc-title scroll-mt-6">
        {heading}
      </h2>
      {withdraw.onWithdraw ? <p className="bc-hint">{t("brief.challengesHint")}</p> : null}
      <ol className="bc-list">
        {challenges.map((c, i) => {
          const before = withdraw.counts.get(challengeKey(c)) ?? 0;
          const isReason = chosen !== null && chosen === challengeKey(c);
          return (
            <li key={`${i}-${c}`} className={`bc-row${before ? " is-recurring" : ""}${isReason ? " is-reason" : ""}`}>
              <span className="bc-n" aria-hidden>
                {i + 1}
              </span>
              <div className="bc-main">
                <p className="bc-text">{c}</p>
                {isReason ? (
                  <p className="bc-note">
                    <Mark kind="ok" /> {t("brief.withdrawnForThis")}
                  </p>
                ) : before ? (
                  <p className="bc-note">
                    <Mark kind="caution" /> {t("brief.withdrawnBefore", { count: before })}
                  </p>
                ) : null}
              </div>
              {withdraw.onWithdraw ? (
                <Button
                  label={t("brief.withdrawFor")}
                  tip={t("brief.withdrawForTip", { challenge: c })}
                  size="sm"
                  variant="ghost"
                  loading={withdraw.busy === i}
                  loadingLabel={t("brief.withdrawing")}
                  disabled={withdraw.busy !== null}
                  onClick={() => withdraw.onWithdraw?.(i)}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
