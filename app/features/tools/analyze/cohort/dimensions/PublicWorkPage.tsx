"use client";

import { useMemo, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import { CommentMark, makeStops, MemberName, MemberPress, Remainder, type PageProps } from "./dimensionParts";
import { publicWorkModel, type EvidenceCard } from "./publicWorkModel";

/**
 * Public work: an evidence card for every member whose GitHub was READ (the figures, the
 * language mix, the top repositories as links, the role's skills it shows and the ones it does
 * not), strongest first; then the honest remainder, grouped by why there is no card.
 */
export function PublicWorkPage({ view, focusMemberId, onFocusMember, onOpenReport }: PageProps) {
  const t = useTranslations("analyzeCohort.pages.publicWork");
  const model = useMemo(() => publicWorkModel(view), [view]);
  const stops = makeStops();
  // A leader is named only where the claim says the separation CLEARS (never on an ordering alone).
  const claim = view.claims.byDimension.publicWork;
  const leader = claim.separation === "clears" ? claim.leader : null;

  const card = (c: EvidenceCard) => {
    const d = c.detail;
    const id = c.member.memberId;
    const user = d.username ?? c.member.label;
    return (
      <article key={id} className="cd-card" data-on={focusMemberId === id ? "" : undefined} data-leader={leader === id ? "" : undefined} aria-label={c.member.label}>
        {leader === id ? <span className="cd-lead">{t("leads")}</span> : null}
        <header className="cd-card__head">
          <span className="cd-card__who">
            <MemberName member={c.member} onOpenReport={onOpenReport} />
            <CommentMark name={c.member.label} text={c.member.cells.publicWork.comment} />
          </span>
          <MemberPress
            member={c.member}
            focusId={focusMemberId}
            stop={stops(id, "card")}
            onFocusMember={onFocusMember}
            label={t("cardPress", { name: c.member.label, rating: c.rating })}
            className="cd-card__seal"
          >
            <span className="k-nums">{c.rating}</span>
          </MemberPress>
        </header>
        {d.profileUrl ? (
          <a className="cd-card__user" href={d.profileUrl} target="_blank" rel="noopener noreferrer" aria-label={t("profile", { user })}>
            @{user}
          </a>
        ) : (
          <span className="cd-card__user">@{user}</span>
        )}
        <dl className="cd-card__figs">
          <div>
            <dt>{t("repos")}</dt>
            <dd className="k-nums">{d.publicRepos ?? ABSENT}</dd>
          </div>
          <div>
            <dt>{t("stars")}</dt>
            <dd className="k-nums">{d.totalStars ?? ABSENT}</dd>
          </div>
          <div>
            <dt>{t("active")}</dt>
            <dd className="k-nums">{d.activeRepos ?? ABSENT}</dd>
          </div>
        </dl>
        <div className="cd-langs" role="img" aria-label={t("languagesLabel", { list: c.languages.map((l) => `${l.name} ${l.percent}%`).join(", ") })}>
          {c.languages.map((l, i) => (
            <i key={l.name} data-i={i} style={{ "--w": `${l.percent}%` } as CSSProperties} />
          ))}
          {c.other ? <i data-i="other" style={{ "--w": `${c.other}%` } as CSSProperties} /> : null}
        </div>
        <ul className="cd-langs__key">
          {c.languages.map((l, i) => (
            <li key={l.name} data-i={i}>
              {l.name} <span className="k-nums">{l.percent}%</span>
            </li>
          ))}
          {c.other ? (
            <li data-i="other">
              {t("other")} <span className="k-nums">{c.other}%</span>
            </li>
          ) : null}
        </ul>
        {d.topRepos.length ? (
          <ul className="cd-card__repos" aria-label={t("top")}>
            {d.topRepos.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.name}
                </a>
                <span className="cd-card__meta">{[r.language, t("starCount", { n: r.stars })].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="cd-card__skills">
          {d.matchedSkills.map((s) => (
            <span key={s} className="cd-tag" data-kind="shown">
              {s}
            </span>
          ))}
          {d.potentialGaps.map((s) => (
            <span key={s} className="cd-tag" data-kind="gap" aria-label={t("gap", { skill: s })}>
              {s}
            </span>
          ))}
        </p>
      </article>
    );
  };

  return (
    <div className="cd-public">
      {model.cards.length ? (
        <>
          <div className="cd-cards">{model.cards.map(card)}</div>
          <p className="cd-legend">
            <span className="cd-tag" data-kind="shown">
              {t("shown")}
            </span>
            <span className="cd-tag" data-kind="gap">
              {t("gaps")}
            </span>
          </p>
        </>
      ) : (
        <p className="cd-focus__quiet">{t("noCards")}</p>
      )}
      <Remainder title={t("remainder")} pending={model.pending} groups={model.remainder} focusId={focusMemberId} onFocusMember={onFocusMember} stops={stops} />
    </div>
  );
}
