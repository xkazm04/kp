"use client";

// The rung views of the evidence ladder (ADR 0027 S3). Each rung says what it saw and
// why, or names why it has nothing yet. Shared by the candidate overview and the Dev
// studio's evaluation panel, so the WATCHED rung reads the same in both places.

import { useTranslations } from "next-intl";
import { RATING_MAX } from "@/app/_lib/format";
import { META_LABEL } from "@/app/_components/ui/recipes";
import {
  reasonCatalogKey,
  type DefendedRung,
  type EmptyRung,
  type LadderReason,
  type LadderRegister,
  type LadderRung,
  type QuotedRung,
  type WatchedRung,
} from "@/app/_lib/evidence-ladder/ladder";

function Reasons({ reasons, register = "software" }: { reasons: readonly LadderReason[]; register?: LadderRegister }) {
  const t = useTranslations("evidenceLadder.reasons");
  const [lead, ...rest] = reasons;
  return (
    <>
      {lead ? <p className="text-h3 font-semibold text-ink">{t(reasonCatalogKey(lead.key, register), lead.values)}</p> : null}
      {rest.length ? (
        <ul className="mt-1.5 space-y-1 text-meta text-steel">
          {rest.map((r) => (
            <li key={r.key}>{t(reasonCatalogKey(r.key, register), r.values)}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** One rung's frame: its name and what it reads, then the evidence or the empty cause. */
export function RungFrame({ rung, children }: { rung: LadderRung; children: React.ReactNode }) {
  const t = useTranslations("evidenceLadder");
  return (
    <div className="min-w-0" data-rung={rung}>
      <p className={META_LABEL}>{t(`rung.${rung}`)}</p>
      <p className="mt-0.5 text-micro text-steel">{t(`rungHint.${rung}`)}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function EmptyRungView({ rung }: { rung: EmptyRung }) {
  const t = useTranslations("evidenceLadder.empty");
  return <p className="text-meta text-steel" data-empty={rung.cause}>{t(rung.cause)}</p>;
}

/** `register` is the case's wording register (a role-neutral twin for software-only lines);
 *  it defaults to the software wording, which is what an unclassified case reads. */
export function WatchedRungView({ rung, register = "software" }: { rung: WatchedRung | EmptyRung; register?: LadderRegister }) {
  return rung.state === "empty" ? <EmptyRungView rung={rung} /> : <Reasons reasons={rung.reasons} register={register} />;
}

export function DefendedRungView({ rung }: { rung: DefendedRung | EmptyRung }) {
  const t = useTranslations("evidenceLadder");
  if (rung.state === "empty") return <EmptyRungView rung={rung} />;
  return (
    <>
      <Reasons reasons={rung.reasons} />
      {rung.quotes.length ? (
        <ul className="mt-3 space-y-2">
          {rung.quotes.map((q) => (
            <li key={q.followupIndex} className="border-l-2 border-stone-200 pl-3">
              <p className="text-micro text-steel">
                {t("followup", { index: q.followupIndex })} · {t(`finding.${q.kind}`)}
              </p>
              <p className="text-meta text-ink">{q.quote}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function QuotedRungView({ rung }: { rung: QuotedRung | EmptyRung }) {
  const t = useTranslations("evidenceLadder");
  if (rung.state === "empty") return <EmptyRungView rung={rung} />;
  return (
    <>
      <Reasons reasons={rung.reasons} />
      <ul className="mt-3 space-y-2">
        {rung.ratings.map((r, i) => (
          <li key={`${r.by}-${i}`} className="border-l-2 border-stone-200 pl-3">
            <p className="text-micro text-steel">
              <span className="nums font-semibold text-ink">{t("rating", { rating: r.rating, max: RATING_MAX })}</span>
              {" · "}
              {r.by === "ai" ? t("byAi") : (r.author ?? t("byHuman"))}
            </p>
            {r.evidence ? <p className="text-meta text-ink">{r.evidence}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
