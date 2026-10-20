"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
// Slices, not the kit barrel: a public door loads only the parts it draws.
import { Button } from "@/app/_components/kit/Button";
import { KitSurface } from "@/app/_components/kit/KitSurface";
import { Letter, LetterBlock, LetterHead, Outcome } from "@/app/_components/kit/Letter";
import { Mark } from "@/app/_components/kit/Mark";
import { ScoreList } from "@/app/_components/kit/ScoreList";
import { Note, Section } from "@/app/_components/kit/Section";
import { StatStrip } from "@/app/_components/kit/StatStrip";
import { formatCount } from "@/app/_components/kit/figure";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { skillBody, skillFigures, skillStaleKey, skillVerdict, type SkillKitCard } from "./skillKitModel";

/**
 * /skill/[token]'s markup, composed from the composition kit (promoted at Gate 2 of the
 * kit-unification spark). A calm letter: the credential's head, the verdict line whose mark SHAPE
 * carries the trust state, the two headline figures and the capability axes as labelled meters
 * (trusted states only), and the methodology line. Every fact arrives from the server page as
 * props; nothing is refetched, so the server HTML is the whole card. Print: the public bar (Print,
 * language) is print-hidden and the letter drops its elevation (doc.css); the rest prints as it reads.
 */
export default function SkillKitView({ card }: { card: SkillKitCard }) {
  const t = useTranslations("skillProfile");
  const tReport = useTranslations("report");
  const bar = (
    <>
      {card.kind === "card" ? <Button label={tReport("print")} size="sm" onClick={() => window.print()} /> : null}
      <LanguageSwitcher />
    </>
  );
  return (
    <main className="min-h-screen bg-paper px-4 py-10">
      <KitSurface density="calm">
        <Letter bar={bar}>
          {card.kind === "throttled" ? (
            <LetterHead eyebrow={t("eyebrow")} title={t("throttledTitle")} context={t("throttledBody")} />
          ) : (
            <SkillKitLetter card={card} />
          )}
        </Letter>
      </KitSurface>
    </main>
  );
}

function SkillKitLetter({ card }: { card: Extract<SkillKitCard, { kind: "card" }> }) {
  const t = useTranslations("skillProfile");
  const locale = useLocale();
  const verdict = skillVerdict(card.state);
  const body = skillBody(card);
  const staleKey = skillStaleKey(card);
  const figs = skillFigures(card);
  return (
    <>
      <LetterHead eyebrow={t("eyebrow")} title={t("title")} context={t("subtitle")} />
      <div className="k-verdict" data-role="skill-verdict">
        <Mark kind={verdict.mark} tip={t(verdict.label)} />
        <div>
          <b>{t(verdict.label)}</b>
          {/* The issue date belongs to the numbers it dates: shown only beside a trusted card. */}
          {body === "scores" ? (
            <span className="k-verdict__when">
              {" · "}
              {t("issuedLabel")}: {card.issued}
            </span>
          ) : null}
          {verdict.body ? <div className="k-verdict__body">{t(verdict.body)}</div> : null}
        </div>
      </div>
      {/* A stale credential stays genuine: say so plainly and name why. */}
      {staleKey ? (
        <Note tone="caution">{t(staleKey, { issued: card.issued, version: card.version })}</Note>
      ) : null}
      {body === "scores" ? (
        <>
          <StatStrip
            items={[
              { label: t("transferLabel"), value: figs.transfer },
              { label: t("confidenceLabel"), value: figs.confidencePct, unit: "%" },
            ]}
          />
          {card.axes.length > 0 ? (
            <Section title={t("axesLabel")} count={formatCount(card.axes.length, locale)}>
              <ScoreList
                items={card.axes.map((a) => ({
                  key: a.name,
                  label: a.label,
                  value: a.score,
                  meterLabel: t("axisMeterLabel", { axis: a.label, score: Math.round(a.score) }),
                }))}
              />
            </Section>
          ) : null}
        </>
      ) : body === "summary" ? (
        <LetterBlock>
          <Outcome>{t("summaryUnavailable")}</Outcome>
        </LetterBlock>
      ) : null}
      <p className="k-letter__foot">
        {t("methodology")}{" "}
        {/* rel=noreferrer: this page's URL IS the capability token, and /about is a tracked route. */}
        <Link href="/about" rel="noreferrer">
          {t("methodologyLink")}
        </Link>
        . {t("version", { version: card.version })}
      </p>
    </>
  );
}
