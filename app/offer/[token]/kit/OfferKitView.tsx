"use client";

import type { ReactNode, RefObject } from "react";
import { useTranslations } from "next-intl";
// Slices, not the kit barrel: a public door loads only the parts it draws.
import { Button } from "@/app/_components/kit/Button";
import { KitSurface } from "@/app/_components/kit/KitSurface";
import { Letter, LetterBlock, LetterHead, Monogram, Outcome } from "@/app/_components/kit/Letter";
import { Note } from "@/app/_components/kit/Section";
import { StatStrip } from "@/app/_components/kit/StatStrip";
import type { Figure } from "@/app/_components/kit/types";
import { initials } from "@/app/_lib/initials";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { offerKitHead, offerKitPhase, offerKitTerms, type OfferKitInput } from "./offerKitModel";
import { OfferKitDecision, type OfferKitDecisionProps } from "./OfferKitDecision";

export type OfferKitViewProps = OfferKitDecisionProps & {
  offer: (OfferKitInput & { timeZone: string }) | null;
  notFound: boolean;
  loadError: string | null;
  result: "accepted" | "declined" | "expired" | null;
  onRetry: () => void;
  /** The accepted outcome takes focus when the accept lands (OfferClient's effect owns the ref). */
  acceptedRef: RefObject<HTMLDivElement | null>;
  /** The AI disclosure, rendered by OfferClient with its server-resolved regime (null once answered). */
  disclosure: ReactNode;
};

/**
 * /offer/[token]'s markup, composed from the composition kit (promoted at Gate 2 of the
 * kit-unification spark). A calm letter: the eyebrow names the company, the role is the h1, the
 * terms are a stat strip, the team's notes a document block, then the decision or its outcome,
 * then the disclosure. Every piece of state and every guard is OfferClient's.
 */
export default function OfferKitView({
  offer, notFound, loadError, result, onRetry, acceptedRef, disclosure, ...decision
}: OfferKitViewProps) {
  const t = useTranslations("offer");
  const tCommon = useTranslations("common");
  const dates = useDateFormat();
  return (
    <main className="min-h-screen bg-paper px-4 py-10">
      <KitSurface density="calm">
        <Letter bar={<LanguageSwitcher />}>
          {notFound ? (
            <Outcome title={t("invalidLink")}>{t("invalidLinkBody")}</Outcome>
          ) : loadError ? (
            <Note tone="critical" action={<Button label={tCommon("retry")} size="lg" onClick={onRetry} />}>
              {loadError}
            </Note>
          ) : !offer ? (
            <LoadingGap className="min-h-[24rem]" />
          ) : (
            <OfferKitLetter
              offer={offer}
              result={result}
              acceptedRef={acceptedRef}
              disclosure={disclosure}
              decision={decision}
              dateOf={(raw) => dates.date(raw, { fallback: "" }) || raw}
            />
          )}
        </Letter>
      </KitSurface>
    </main>
  );
}

function OfferKitLetter({
  offer, result, acceptedRef, disclosure, decision, dateOf,
}: {
  offer: NonNullable<OfferKitViewProps["offer"]>;
  result: OfferKitViewProps["result"];
  acceptedRef: OfferKitViewProps["acceptedRef"];
  disclosure: ReactNode;
  decision: OfferKitDecisionProps;
  dateOf: (raw: string) => string;
}) {
  const t = useTranslations("offer");
  const head = offerKitHead(offer);
  const terms = offerKitTerms(offer);
  const phase = offerKitPhase(result);
  const title =
    head.title.key === "jobTitle" ? head.title.text : head.title.key === "roleAt" ? t("roleAt", { company: head.title.company }) : t("roleGeneric");
  const figures: Figure[] = [];
  if (terms.salary) figures.push({ label: t("compensation"), value: terms.salary.value, unit: terms.salary.unit ?? undefined });
  if (terms.startDate) figures.push({ label: t("startDate"), value: dateOf(terms.startDate) });
  return (
    <>
      <LetterHead
        brand={head.company ? <Monogram text={initials(head.company, "•")} /> : undefined}
        eyebrow={head.company ? `${t("eyebrow")} · ${head.company}` : t("eyebrow")}
        title={title}
        context={head.preparedFor ? t("preparedFor", { name: head.preparedFor }) : undefined}
      />
      {figures.length > 0 ? <StatStrip items={figures} /> : null}
      {terms.notes ? (
        <LetterBlock label={t("notesLabel")}>
          <p className="k-body">{terms.notes}</p>
        </LetterBlock>
      ) : null}
      <LetterBlock className="k-letter__decide">
        {phase === "accepted" ? (
          <Outcome ref={acceptedRef} tabIndex={-1} role="status" aria-live="polite" tone="ok" title={t("acceptedTitle")}>
            {head.company ? t("acceptedBodyCompany", { company: head.company }) : t("acceptedBodyGeneric")}
          </Outcome>
        ) : phase === "declined" ? (
          <Outcome role="status" aria-live="polite" title={t("declinedTitle")}>{t("declinedBody")}</Outcome>
        ) : phase === "expired" ? (
          <Outcome role="status" aria-live="polite" title={t("expiredTitle")}>{t("expiredBody")}</Outcome>
        ) : (
          <OfferKitDecision {...decision} offer={offer} company={head.company} />
        )}
      </LetterBlock>
      {disclosure ? <LetterBlock>{disclosure}</LetterBlock> : null}
    </>
  );
}
