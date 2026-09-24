"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CHIP, NOTICE } from "@/app/_components/ui/recipes";
import type { Gig } from "@/app/_lib/gigs/types";
import { deadlineView, revealInvisible, type SourceRow, type SpecialistRow } from "./gigsLogic";
import { useGigsFormat } from "./useGigsFormat";

// The facts every gig page opens with: its status, the title, and a meta row whose
// absences are stated rather than blank ("reward not stated", "no deadline stated"). The
// breadcrumb lives one level up, in the page bar (GigsDetail.tsx). Plus the one way the
// tab shows a stranger's listing text: framed as untrusted, links as plain text, and
// every invisible character made visible.

export function Absent({ children }: { children: ReactNode }) {
  return <span className="italic text-steel">{children}</span>;
}

export function RewardText({ gig }: { gig: Pick<Gig, "reward"> }) {
  const t = useTranslations("gigs");
  if (!gig.reward) return <Absent>{t("facts.rewardNotStated")}</Absent>;
  return <span>{gig.reward.text}</span>;
}

export function DeadlineText({ gig, now }: { gig: Pick<Gig, "deadlineAt">; now: Date }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const d = deadlineView(gig.deadlineAt, now);
  if (d.state === "none") return <Absent>{t("facts.noDeadline")}</Absent>;
  if (d.state === "passed") return <span className="font-semibold text-coral">{t("facts.deadlinePassed", { date: fmt.date(d.at) })}</span>;
  return (
    <span className={d.state === "soon" ? "font-semibold text-amber-700" : undefined}>{t("facts.deadlineIn", { date: fmt.date(d.at), days: Math.max(0, d.days) })}</span>
  );
}

export function GigHead({
  gig,
  source,
  specialist,
  now,
  extra,
}: {
  gig: Gig;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  now: Date;
  extra?: ReactNode;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  return (
    <header className="border-b border-stone-200 px-5 pb-4 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${CHIP} text-xs`}>{fmt.status(gig.status)}</span>
        {gig.status === "suspect" ? <span className={`${NOTICE("critical")} inline-block px-2 py-0.5 text-xs font-semibold`}>{t("card.quarantined")}</span> : null}
      </div>
      <h2 className="mt-2 max-w-4xl font-serif text-h2 text-ink">{gig.title}</h2>
      <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        <div>
          <dt className="sr-only">{t("facts.arena")}</dt>
          <dd className={`${CHIP} text-xs`}>{fmt.arena(gig.arena)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-steel">{t("facts.org")}</dt>
          <dd className="font-semibold text-ink">{gig.org ? gig.org : <Absent>{t("facts.orgNotStated")}</Absent>}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-steel">{t("facts.reward")}</dt>
          <dd className="font-semibold text-ink">
            <RewardText gig={gig} />
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-steel">{t("facts.deadline")}</dt>
          <dd className="text-ink">
            <DeadlineText gig={gig} now={now} />
          </dd>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <dt className="text-steel">{t("facts.source")}</dt>
          <dd className="text-ink">
            {source ? source.host : t("facts.forwarded")}
            {source?.pausedReason ? <span className={`${NOTICE("amber")} ml-2 inline-block px-2 py-0.5 text-xs`}>{fmt.paused(source.pausedReason)}</span> : null}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-steel">{t("facts.specialist")}</dt>
          <dd className="text-ink">{specialist ? specialist.name : <Absent>{t("facts.noSpecialist")}</Absent>}</dd>
        </div>
        {extra}
      </dl>
    </header>
  );
}

/** A stranger's listing text. Never rendered as markup: links stay text, and a
 *  zero-width or direction-control character shows as a marked code point. */
export function UntrustedText({ gig, source }: { gig: Pick<Gig, "bodyText">; source: SourceRow | null }) {
  const t = useTranslations("gigs");
  const segments = revealInvisible(gig.bodyText);
  const hidden = segments.filter((s) => s.kind === "invisible").length;
  return (
    <div>
      <p className="mb-1.5 flex flex-wrap items-center gap-2 text-sm text-steel">
        <span className={`${NOTICE("critical")} inline-block px-2 py-0.5 text-xs font-semibold`}>{t("untrusted.tag")}</span>
        {source ? t("untrusted.note", { host: source.host, chars: gig.bodyText.length }) : t("untrusted.noteForwarded", { chars: gig.bodyText.length })}
        {hidden > 0 ? <span className="font-semibold text-coral">{t("untrusted.invisible", { count: hidden })}</span> : null}
      </p>
      <div className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border-2 border-dashed border-stone-300 bg-paper p-3 text-sm text-ink">
        {segments.map((s, i) =>
          s.kind === "text" ? (
            <span key={i}>{s.text}</span>
          ) : (
            <span key={i} className="mx-px inline-block rounded border border-coral px-1 align-baseline font-mono text-xs font-bold text-coral">
              {s.code}
            </span>
          )
        )}
      </div>
    </div>
  );
}
