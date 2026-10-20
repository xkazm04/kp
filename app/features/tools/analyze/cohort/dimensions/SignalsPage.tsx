"use client";

import { useMemo, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { makeStops, MemberPress, Remainder, type PageProps } from "./dimensionParts";
import { probesFor, signalsModel, weightOf, type SignalRow } from "./signalsModel";
import { SignalsProbes } from "./SignalsProbes";

/**
 * Signals: a shared ledger. Every soft signal the analyses read is ONE row, grouped across
 * members, strengths facing watch-outs; its carriers are chips weighted by their confidence (the
 * filled share of the chip), the heaviest first. The focused member's suggested probes sit in the
 * side sheet, ready to copy into an interview plan.
 */
export function SignalsPage({ view, focusMemberId, onFocusMember, onOpenReport }: PageProps) {
  const t = useTranslations("analyzeCohort.pages.signals");
  const model = useMemo(() => signalsModel(view), [view]);
  const stops = makeStops();
  const focused = view.members.find((m) => m.memberId === focusMemberId);
  const probes = focused ? probesFor(model, focused.memberId) : [];

  const ledger = (kind: "strengths" | "antipatterns", rows: SignalRow[]) => (
    <section className="cd-ledger" data-kind={kind} aria-label={t(kind)}>
      <h3 className="cd-ledger__title">
        {t(kind)} <span className="cd-ledger__n k-nums">{rows.length}</span>
      </h3>
      {rows.length ? (
        <ol className="cd-ledger__rows">
          {rows.map((r) => (
            <li key={r.key} className="cd-sig" data-held={r.carriers.some((c) => c.member.memberId === focusMemberId) ? "" : undefined}>
              <p className="cd-sig__head">
                <span className="cd-sig__label">{r.label}</span>
                <span className="cd-sig__n k-nums">{t("carriers", { n: r.carriers.length, weight: r.weight })}</span>
              </p>
              <p className="cd-sig__who">
                {r.carriers.map((c) => (
                  <MemberPress
                    key={c.member.memberId}
                    member={c.member}
                    focusId={focusMemberId}
                    stop={stops(c.member.memberId, `${kind}:${r.key}`)}
                    onFocusMember={onFocusMember}
                    label={c.confidence == null ? t("chipUnstated", { name: c.member.label, detail: c.detail }) : t("chip", { name: c.member.label, c: c.confidence, detail: c.detail })}
                    tip={c.detail}
                    className="cd-chip cd-chip--weighted"
                  >
                    <span className="cd-chip__fill" data-unstated={c.confidence == null ? "" : undefined} style={{ "--w": `${weightOf(c.confidence) * 100}%` } as CSSProperties} />
                    <span className="cd-chip__text" data-comment={c.member.cells.signals.comment ? "" : undefined}>
                      {c.member.label}
                    </span>
                  </MemberPress>
                ))}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="cd-focus__quiet">{t(kind === "strengths" ? "noneStrengths" : "noneAntipatterns")}</p>
      )}
    </section>
  );

  return (
    <div className="cd-split">
      <div className="cd-sigs">
        <div className="cd-facing">
          {ledger("strengths", model.strengths)}
          {ledger("antipatterns", model.antipatterns)}
        </div>
        {model.quiet.length ? (
          <p className="cd-quiet">
            <span className="cd-quiet__k">{t("quiet")}</span>
            {model.quiet.map((m) => (
              <MemberPress key={m.memberId} member={m} focusId={focusMemberId} stop={stops(m.memberId, "quiet")} onFocusMember={onFocusMember} label={t("quietMember", { name: m.label })} className="cd-chip">
                {m.label}
              </MemberPress>
            ))}
          </p>
        ) : null}
        <Remainder pending={model.pending} groups={model.absent} focusId={focusMemberId} onFocusMember={onFocusMember} stops={stops} />
      </div>
      <SignalsProbes member={focused} probes={probes} comment={focused?.cells.signals.comment} onOpenReport={onOpenReport} />
    </div>
  );
}
