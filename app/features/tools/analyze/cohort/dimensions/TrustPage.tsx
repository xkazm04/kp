"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { CohortMember } from "../cohortTypes";
import { CommentMark, makeStops, MemberName, MemberPress, Remainder, type PageProps } from "./dimensionParts";
import { humanCode, isClean, trustModel, type Severity, type TrustRow } from "./trustModel";
import { useAbsentWord } from "./useCohortLabel";

/** Severity in SHAPE: a filled diamond (blocker), a triangle (warning), a disc (passed / clean). */
function SevGlyph({ sev }: { sev: Severity | "clean" }) {
  return (
    <svg className="cd-sevmark" viewBox="0 0 16 16" aria-hidden data-sev={sev}>
      {sev === "blocker" ? <path d="M8 1.8 14.2 8 8 14.2 1.8 8Z" /> : sev === "warn" ? <path d="M8 2.2 14 13H2Z" /> : <circle cx="8" cy="8" r="5" />}
    </svg>
  );
}

/**
 * Trust: a severity ledger. One row per finding code across the cohort with the members who
 * carry it, blockers first; then the clean members, STATED as clean rather than left out; then
 * the checks that passed, quietly; then who was not read (never counted as clean).
 */
export function TrustPage({ view, focusMemberId, onFocusMember, onOpenReport }: PageProps) {
  const t = useTranslations("analyzeCohort.pages.trust");
  const reasonWord = useAbsentWord();
  const model = useMemo(() => trustModel(view), [view]);
  const stops = makeStops();
  const focused = view.members.find((m) => m.memberId === focusMemberId);

  const chip = (m: CohortMember, text: string | null, slot: string) => (
    <span key={m.memberId} className="cd-sev__chip">
      <MemberPress
        member={m}
        focusId={focusMemberId}
        stop={stops(m.memberId, slot)}
        onFocusMember={onFocusMember}
        label={text ? t("chip", { name: m.label, text }) : m.label}
        tip={text ?? undefined}
        className="cd-chip"
      >
        {m.label}
      </MemberPress>
      <CommentMark name={m.label} text={m.cells.trust.comment} />
    </span>
  );
  const row = (r: TrustRow, quiet = false) => (
    <li key={r.code} className="cd-sev__row" data-sev={r.severity} data-quiet={quiet ? "" : undefined}>
      <SevGlyph sev={r.severity} />
      <span className="cd-sev__what">
        <span className="cd-sev__code">{humanCode(r.code)}</span>
        <span className="cd-sev__word">{t(`sev.${r.severity}`)}</span>
      </span>
      <span className="cd-sev__who">{r.carriers.map((c) => chip(c.member, c.text, `code:${r.code}`))}</span>
      <span className="cd-sev__n k-nums">{r.carriers.length}</span>
    </li>
  );

  return (
    <div className="cd-split">
      <div className="cd-trust">
        <ol className="cd-sev" aria-label={t("ledger")}>
          {model.flagged.map((r) => row(r))}
          <li className="cd-sev__row" data-sev="clean">
            <SevGlyph sev="clean" />
            <span className="cd-sev__what">
              <span className="cd-sev__code">{t("clean")}</span>
              <span className="cd-sev__word">{t("cleanLine")}</span>
            </span>
            <span className="cd-sev__who">{model.clean.length ? model.clean.map((m) => chip(m, null, "clean")) : <span className="cd-focus__quiet">{t("cleanNone")}</span>}</span>
            <span className="cd-sev__n k-nums">{model.clean.length}</span>
          </li>
        </ol>
        {!model.flagged.length ? <p className="cd-focus__quiet">{t("noneFlagged")}</p> : null}
        {model.passed.length ? (
          <ol className="cd-sev cd-sev--passed" aria-label={t("passed")}>
            {model.passed.map((r) => row(r, true))}
          </ol>
        ) : null}
        <Remainder pending={model.pending} groups={model.absent} focusId={focusMemberId} onFocusMember={onFocusMember} stops={stops} />
      </div>
      <aside className="cd-focus" aria-live="polite">
        {focused ? (
          <>
            <p className="cd-focus__kicker">{t("focusKicker")}</p>
            <h3 className="cd-focus__name">
              <MemberName member={focused} onOpenReport={onOpenReport} />
            </h3>
            {!focused.detail.trust ? (
              <p className="cd-focus__quiet">{reasonWord(focused.cells.trust.absentReason ?? "notRead")}</p>
            ) : isClean(focused) ? (
              <p className="cd-focus__quiet">{t("cleanLine")}</p>
            ) : (
              <ul className="cd-focus__list cd-focus__list--plain">
                {focused.detail.trust.findings.map((f, i) => (
                  <li key={`${f.code}-${i}`} data-sev={f.severity}>
                    <SevGlyph sev={f.severity} />
                    <span>
                      <strong>{humanCode(f.code)}</strong> {f.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="cd-focus__prompt">{t("focusPrompt")}</p>
        )}
      </aside>
    </div>
  );
}
