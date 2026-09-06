"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, EYEBROW } from "@/app/_components/ui/recipes";
import type { CompanionProposal } from "@/app/_lib/db/companion";
// The PURE payload module, never `companion-actions` — the catalog's executors
// reach better-sqlite3, and a client component must not drag that graph in.
import { coerceProposalPayload } from "@/app/_lib/companion-proposal-view";

/*
 * What Candi OFFERED, under the sentence that offered it.
 *
 * The whole design is in the two buttons: she has already said what she would do,
 * and this is the operator saying yes or no. So the card is quiet — a hairline
 * panel, an eyebrow naming who is asking, one line of what would happen, and the
 * two answers. No icon, no severity color, no urgency: a proposal is a question,
 * and dressing a question as an alert would make declining feel like a failure.
 *
 * COPY IS A REFERENCE, NOT A SENTENCE. The proposal row was written by a server
 * with no reader attached and is read later by whoever has the dock open, in
 * their language — the same contract task-label.ts keeps for a task row, resolved
 * the same way (`t.has` first, then translate). A summary key this build no
 * longer carries renders the "can no longer describe" line rather than an empty
 * card or a raw identifier.
 *
 * RE-OPEN SAFE. `status` comes from the live proposal row, never from the turn
 * that produced it, so a conversation reloaded after an accept paints an outcome
 * chip and no buttons. There is no path back: Accept is rendered for an OPEN
 * proposal and for nothing else.
 */

/** Structural shape of a translator scoped to `companion` — the `renderTaskLabel`
 *  trick, for the same reason: next-intl types the `values` argument FROM the
 *  key, so a structural signature over an erased key can never match it. Only
 *  `has` is declared; the call is cast once, after `has` proved the key exists. */
type CompanionTranslator = { has: (key: never) => boolean };

function reference<T extends CompanionTranslator>(
  t: T,
  key: string,
  values: Record<string, string | number> | undefined,
  fallback: string
): string {
  const k = key as Parameters<T["has"]>[0];
  if (!t.has(k)) return fallback;
  const translate = t as unknown as (k: unknown, v?: Record<string, string | number>) => string;
  return translate(k, values);
}

export type CompanionProposalCardProps = {
  proposal: CompanionProposal;
  /** Resolves to false when the answer did not land, so the card can re-arm its
   *  buttons instead of sitting disabled on a request that failed. */
  onResolve: (id: string, decision: "accept" | "decline") => Promise<boolean>;
  /** The code from an answer that did not land, when it was THIS card's. Read
   *  through `useErrorMessage` like every other code: the server's English
   *  sentence is never what the operator sees. Absent in surfaces that show the
   *  failure elsewhere (voice mode's ticker prints the thread's error line). */
  error?: string | null;
};

export function CompanionProposalCard({ proposal, onResolve, error }: CompanionProposalCardProps) {
  const t = useTranslations("companion");
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const payload = coerceProposalPayload(proposal.payload);
  const summary = payload
    ? reference(t, `action.${payload.summary.key}`, payload.summary.values, t("action.unknown"))
    : t("action.unknown");

  const answer = async (decision: "accept" | "decline") => {
    if (busy) return;
    setBusy(true);
    const ok = await onResolve(proposal.id, decision);
    // Re-arm only on failure: a success replaces this card's `status`, so the
    // buttons are gone and leaving `busy` set would be state nothing reads.
    if (!ok) setBusy(false);
  };

  return (
    <div className="mt-2 max-w-[85%] rounded-lg border border-stone-200 bg-white p-3 dark:rounded-2xl dark:shadow-sticker-sm">
      <p className={EYEBROW}>{t("proposal.eyebrow")}</p>
      <p className="mt-1 text-body text-ink">{summary}</p>
      {proposal.status === "open" ? (
        <div className="mt-2.5 flex items-center gap-2">
          <button type="button" onClick={() => void answer("accept")} disabled={busy} className={`${BTN_PRIMARY} h-8 px-3 text-sm`}>
            {busy ? t("proposal.working") : t("proposal.accept")}
          </button>
          <button type="button" onClick={() => void answer("decline")} disabled={busy} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("proposal.decline")}
          </button>
        </div>
      ) : null}
      {/* An answer that did not land, said where the button was pressed. A 409
          is NOT one of these: the route sends the answered row with it, so that
          card has already repainted as answered by the time this could render. */}
      {proposal.status === "open" && error ? (
        <p role="alert" className="mt-2 text-sm text-coral">
          {resolveError({ code: error }, t("proposal.failed"))}
        </p>
      ) : null}
      {proposal.status !== "open" ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={CHIP_QUIET}>
            {proposal.status === "accepted" ? t("proposal.accepted") : t("proposal.declined")}
          </span>
          {payload?.outcome ? (
            <span className={CHIP_QUIET}>
              {reference(t, `outcome.${payload.outcome.key}`, payload.outcome.values, t("outcome.unknown"))}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
