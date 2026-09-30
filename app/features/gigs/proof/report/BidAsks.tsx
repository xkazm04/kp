"use client";

import { useTranslations } from "next-intl";

// What a freelance bid asks the client, as two compact numbered lists side by side (stacked
// when the column is narrow): the questions, in the order to ask them, and the artifacts the
// work needs that the listing does not provide. Used by the Summary's bid block and by the
// Review tab's message card. An empty list says so in words; it is never just missing.

export function BidAsks({ questions, artifacts }: { questions: readonly string[]; artifacts: readonly string[] }) {
  const t = useTranslations("gigs.proposal.bid");
  const list = (title: string, items: readonly string[], none: string) => (
    <section className="bid-asks-col" aria-label={title}>
      <h4 className="sub-title">
        {title} {items.length ? <span className="sub-n">{items.length}</span> : null}
      </h4>
      {items.length ? (
        <ol className="steps">
          {items.map((x, i) => (
            <li key={i}>
              <span className="step-n" aria-hidden>
                {i + 1}
              </span>
              <span>{x}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="t-meta">{none}</p>
      )}
    </section>
  );
  return (
    <div className="bid-asks">
      {list(t("questions"), questions, t("noQuestions"))}
      {list(t("artifacts"), artifacts, t("noArtifacts"))}
    </div>
  );
}
