"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { ConditionMark, type Condition } from "@/app/_components/kit/scene";
import type { JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { provenanceOf, type SieveFacts, type SievePosting } from "../sieve/sieveModel";
import { ArtBearing, ArtEvening, ArtLens, ArtSieve, ArtSources, ArtSpectrum, ArtWeigh, DecisionMark, TierGlyph } from "./AtlasArt";
import { WANT_KEYS, REQUIRED_WANTS, type Lock, type WantKey } from "./atlasModel";
import type { Lens } from "./atlasNav";
import { AT_CARD, AT_INST, AT_INST_SMALL, AT_LENS, AT_MORE, AT_WANT, cx } from "./atlasRecipes";

// The hub beside the sky. Locked: the unlock plate (what opens the dome, how far along, the next
// move), the instrument deck (setup) and the four market lenses drawn as not switched on. Ready:
// the top five as cards wired to their numbered stars, the four lenses with one live fact each,
// and a slim strip where setup has retreated. Every number is derived from the real rows.

const kfmt = (n: number): string => (n >= 1000 ? `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, "")}k` : String(n));

export type SideProps = {
  lock: Lock;
  set: Record<WantKey, boolean>;
  profile: JobseekerProfile | null;
  facts: SieveFacts | null;
  loading: boolean;
  sourcesOn: number;
  lockNote: string | null;
  hotDeck: boolean;
  /** The flow's ONE scan door (useScanTask), offered where the sky is empty. */
  scanDoor: ReactNode;
  onOpenLens: (lens: Lens, opener: HTMLElement | null) => void;
  onOpenWeigh: (opener: HTMLElement | null) => void;
  onOpenPosting: (id: string, opener: HTMLElement | null) => void;
  onPointCard: (id: string | null) => void;
  onLockedLens: (name: "sieve" | "evening" | "weigh" | "sources", opener: HTMLElement | null) => void;
};

export function AtlasSide(p: SideProps) {
  return p.lock.gate === "ready" ? <ReadySide {...p} /> : <LockedSide {...p} />;
}

function payShort(t: ReturnType<typeof useTranslations>, r: SievePosting): string {
  if (r.salaryMin === null && r.salaryMax === null) return t("card.payUnstated");
  const lo = r.salaryMin !== null ? kfmt(r.salaryMin) : "";
  const hi = r.salaryMax !== null ? kfmt(r.salaryMax) : "";
  const range = lo && hi && lo !== hi ? `${lo}–${hi}` : lo || hi;
  return t("card.pay", { range, cur: r.salaryCurrency ?? "", period: r.salaryPeriod === "year" ? t("card.perYear") : t("card.perMonth") });
}

/* ------------------------------------------------------------------ locked */

function LockedSide({ lock, set, profile, facts, onOpenLens, lockNote, hotDeck, onLockedLens }: SideProps) {
  const t = useTranslations("me.atlas");
  const tW = useTranslations("me.atlas.wants");
  const g = lock.gate;
  const missingFirst = lock.missing[0];
  const listFormat = (keys: WantKey[]) => new Intl.ListFormat(undefined, { style: "long", type: "conjunction" }).format(keys.map((k) => tW(`name.${k}`).toLowerCase()));
  return (
    <>
      <section className="unlock" aria-labelledby="at-ul-h" data-role="unlock">
        <p className="k-eyebrow">{t("unlock.eyebrow")}</p>
        <h2 className="ul-h" id="at-ul-h">{g === "no-cv" ? t("unlock.noCvTitle") : t("unlock.title", { n: lock.n, total: lock.total })}</h2>
        <p className="ul-t">{g === "no-cv" ? t("unlock.noCvText") : t("unlock.missing", { list: listFormat(lock.missing), count: lock.missing.length })}</p>
        <ul className="want-list">
          {WANT_KEYS.map((k) => {
            const on = set[k];
            const optional = !REQUIRED_WANTS.includes(k);
            return (
              <li key={k}>
                <button type="button" className={cx(AT_WANT, on ? "is-set" : "is-miss")} data-role="want" data-want={k}
                  aria-label={`${tW(`name.${k}`)}: ${on ? t("unlock.set") : g === "no-cv" ? t("unlock.notSetNoCv") : optional ? t("unlock.optional") : t("unlock.missingOne")}`}
                  onClick={(e) => onOpenLens(g === "no-cv" ? "cv" : "want", e.currentTarget)}>
                  <ConditionMark condition={on ? "live" : g === "no-cv" || optional ? "off" : "reach"} label="" />
                  <span>{tW(`name.${k}`)}{optional && !on ? <span className="want-opt"> · {t("unlock.optional")}</span> : null}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <Button size="lg" variant="primary" className="ul-go" data-role="unlock-go"
          label={g === "no-cv" ? t("unlock.ctaNoCv") : missingFirst ? tW(`cta.${missingFirst}`) : t("unlock.ctaOpen")}
          onClick={(e) => onOpenLens(g === "no-cv" ? "cv" : "want", e.currentTarget)} />
        {lockNote ? <p className="lock-note" role="status">{lockNote}</p> : null}
      </section>
      <div className="deck" role="group" aria-label={t("deck.label")}>
        <DeckInst id="cv" profile={profile} lock={lock} set={set} hot={g === "no-cv" && hotDeck} onOpenLens={onOpenLens} big />
        <DeckInst id="read" profile={profile} lock={lock} set={set} hot={false} onOpenLens={onOpenLens} big />
        <DeckInst id="want" profile={profile} lock={lock} set={set} hot={false} onOpenLens={onOpenLens} big />
      </div>
      <nav className="lenses is-locked" aria-label={t("lenses.lockedLabel")} data-market={t("lenses.notSwitchedOn")}>
        {(["sieve", "evening", "weigh", "sources"] as const).map((id) => (
          <LensBtn key={id} id={id} facts={facts} lock={lock} sourcesOn={0} onOpen={(e) => onLockedLens(id, e)} />
        ))}
      </nav>
    </>
  );
}

function deckFact(t: ReturnType<typeof useTranslations>, id: "cv" | "read" | "want", profile: JobseekerProfile | null, lock: Lock): { c: Condition; text: string; loud?: boolean } {
  if (id === "cv") return profile ? { c: "live", text: t("deck.cvIn") } : { c: "wait", text: t("deck.cvDrop"), loud: true };
  if (!profile) return { c: "off", text: t("deck.needsCv") };
  if (id === "read") {
    const claims = profile.profile.skillClaims ?? [];
    const stated = claims.filter((c) => provenanceOf(c.provenance).stated).length;
    return { c: "live", text: t("deck.skills", { n: claims.length, stated }) };
  }
  return { c: lock.missing.length === 0 ? "live" : "reach", text: t("deck.wantsSet", { n: lock.n, total: lock.total }) };
}

function DeckInst({ id, profile, lock, set, hot, onOpenLens, big }: { id: "cv" | "read" | "want"; profile: JobseekerProfile | null; lock: Lock; set: Record<WantKey, boolean>; hot: boolean; onOpenLens: SideProps["onOpenLens"]; big: boolean }) {
  const t = useTranslations("me.atlas");
  const f = deckFact(t, id, profile, lock);
  const locked = !profile && id !== "cv";
  const name = t(`deck.${id}.name`);
  const long = t(`deck.${id}.long`);
  const art = id === "cv" ? <ArtLens /> : id === "read" ? <ArtSpectrum /> : <ArtBearing flags={WANT_KEYS.map((k) => set[k])} />;
  const label = `${name}: ${long}. ${locked ? `${t("lenses.locked")}. ` : ""}${f.text}`;
  if (!big) {
    return (
      <button type="button" className={AT_INST_SMALL} data-role="instrument-small" data-lens={id} aria-label={label} onClick={(e) => onOpenLens(id, e.currentTarget)}>
        {art}
      </button>
    );
  }
  // A locked instrument is still a button: it answers with what opens it (the Lens).
  return (
    <button type="button" className={cx(AT_INST, locked && "is-locked", hot && "is-hot")} data-role="instrument" data-lens={id} aria-label={label}
      aria-disabled={locked || undefined} onClick={(e) => onOpenLens(locked ? "cv" : id, e.currentTarget)}>
      <span className="inst-art">{art}</span>
      <span className="inst-name">{name}</span>
      <span className="inst-long">{long}</span>
      <ConditionMark condition={f.c} label={f.text} loud={f.loud && hot} />
      {hot ? <span className="k-hand inst-hand">{t("deck.startHere")}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ lenses */

function LensBtn({ id, facts, lock, sourcesOn, onOpen }: { id: "sieve" | "evening" | "weigh" | "sources"; facts: SieveFacts | null; lock: Lock; sourcesOn: number; onOpen: (opener: HTMLElement | null) => void }) {
  const t = useTranslations("me.atlas");
  const ready = lock.gate === "ready" && facts !== null;
  const name = t(`lenses.${id}.name`);
  const long = t(`lenses.${id}.long`);
  let cond: Condition = "off";
  let text = t("lenses.locked");
  if (ready && facts) {
    const worth = facts.strong + facts.promising;
    if (id === "sieve") {
      cond = "live";
      text = t("lenses.sieveFact", { n: facts.gated.length });
    } else if (id === "evening") {
      cond = worth ? "live" : "wait";
      text = worth ? t("lenses.eveningFact", { n: worth }) : t("lenses.eveningNone");
    } else if (id === "weigh") {
      cond = facts.decided ? "live" : "wait";
      text = facts.decided ? t("lenses.weighFact", { n: facts.decided }) : t("lenses.weighNone");
    } else {
      cond = facts.held.length ? "reach" : "live";
      text = facts.held.length ? t("lenses.sourcesHeld", { on: sourcesOn, held: facts.held.length }) : t("lenses.sourcesFact", { on: sourcesOn });
    }
  }
  const art = id === "sieve" ? <ArtSieve /> : id === "evening" ? <ArtEvening /> : id === "weigh" ? <ArtWeigh /> : <ArtSources />;
  return (
    <button type="button" className={cx(AT_LENS, !ready && "is-locked")} data-role="lens" data-lens={id}
      aria-label={ready ? `${long}: ${text}` : t("lenses.lockedAria", { name: long })}
      aria-disabled={!ready || undefined}
      onClick={(e) => onOpen(e.currentTarget)}>
      <span className="lens-art">{art}</span>
      <span className="lens-name">{name}</span>
      <ConditionMark condition={cond} label={text} />
    </button>
  );
}

/* ------------------------------------------------------------------ ready */

function ReadySide({ lock, set, profile, facts, loading, sourcesOn, scanDoor, onOpenLens, onOpenWeigh, onOpenPosting, onPointCard }: SideProps) {
  const t = useTranslations("me.atlas");
  const tTier = useTranslations("me.sieve.tier");
  const tStatus = useTranslations("me.sieve.status");
  if (!facts) return null;
  const worth = facts.strong + facts.promising;
  const empty = facts.all.length === 0;
  const head = empty ? t("top5.headEmpty") : worth >= 5 ? t("top5.headFull") : worth > 0 ? t("top5.headSome", { n: worth }) : t("top5.headNone");
  const first = profile?.profile.displayName?.trim() ?? "";
  return (
    <>
      <section className="top5" aria-labelledby="at-t5h" data-role="top5">
        <header className="t5-head">
          {first ? <p className="t5-who">{first}</p> : null}
          <h2 className="t5-h" id="at-t5h">{head}</h2>
          <p className="t5-meta">{t("top5.meta", { scored: facts.scored.length, found: facts.all.length })}</p>
        </header>
        <ol className="t5-list">
          {facts.top5.length ? (
            facts.top5.map((r, i) => {
              const tier = r.fitTier ?? "partial";
              return (
                <li key={r.id}>
                  <button type="button" className={cx(AT_CARD, `t-${tier}`)} data-role="top5-card" data-id={r.id}
                    aria-label={t("card.aria", { rank: i + 1, title: r.title, company: r.company ?? "", score: r.matchTotal ?? 0, tier: tTier(tier), pay: payShort(t, r) })}
                    onClick={(e) => onOpenPosting(r.id, e.currentTarget)}
                    onMouseEnter={() => onPointCard(r.id)} onMouseLeave={() => onPointCard(null)}
                    onFocus={() => onPointCard(r.id)} onBlur={() => onPointCard(null)}>
                    <span className="t5-rank">{i + 1}</span>
                    <span className="t5-main">
                      <span className="t5-title">{r.title}</span>
                      <span className="t5-co">
                        <span className="t5-cot">{[r.company, r.location].filter(Boolean).join(" · ")}</span>
                        {r.status !== "new" ? <span className="t5-dec"><DecisionMark status={r.status} />{tStatus(r.status)}</span> : null}
                      </span>
                      <span className="t5-pay">{payShort(t, r)}</span>
                    </span>
                    <span className="t5-score">
                      <TierGlyph tier={tier} />
                      <b className="nums">{r.matchTotal ?? "—"}</b>
                      {r.confidence ? <span className="t5-bandline"><BandGlyph total={r.matchTotal ?? 0} low={r.confidence.low} high={r.confidence.high} /><span className="nums">{r.confidence.low}–{r.confidence.high}</span></span> : null}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="t5-none">
              {loading ? t("top5.loading") : empty ? t("top5.empty") : t("top5.none")}{" "}
              {empty ? <span className="sv at-embed">{scanDoor}</span> : <Button variant="link" label={t("top5.decideSources")} onClick={(e) => onOpenLens("sources", e.currentTarget)} />}
            </li>
          )}
        </ol>
        <button type="button" className={AT_MORE} data-role="top5-more" onClick={(e) => onOpenLens("evening", e.currentTarget)}>
          <span>{t("top5.all", { n: facts.scored.length })}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8h9M8.5 4l4 4-4 4" /></svg>
        </button>
      </section>
      <nav className="lenses" aria-label={t("lenses.label")}>
        <LensBtn id="sieve" facts={facts} lock={lock} sourcesOn={sourcesOn} onOpen={(e) => onOpenLens("sieve", e)} />
        <LensBtn id="evening" facts={facts} lock={lock} sourcesOn={sourcesOn} onOpen={(e) => onOpenLens("evening", e)} />
        <LensBtn id="weigh" facts={facts} lock={lock} sourcesOn={sourcesOn} onOpen={onOpenWeigh} />
        <LensBtn id="sources" facts={facts} lock={lock} sourcesOn={sourcesOn} onOpen={(e) => onOpenLens("sources", e)} />
      </nav>
      <div className="strip" role="group" aria-label={t("strip.label")}>
        <DeckInst id="cv" profile={profile} lock={lock} set={set} hot={false} onOpenLens={onOpenLens} big={false} />
        <DeckInst id="read" profile={profile} lock={lock} set={set} hot={false} onOpenLens={onOpenLens} big={false} />
        <DeckInst id="want" profile={profile} lock={lock} set={set} hot={false} onOpenLens={onOpenLens} big={false} />
        <span className="strip-t"><b>{t("strip.setup", { n: lock.n, total: lock.total })}</b></span>
        <Button size="sm" variant="ghost" label={t("strip.edit")} onClick={(e) => onOpenLens("want", e.currentTarget)} />
      </div>
    </>
  );
}

/** The score's band as a glyph: the track, the band, the point. */
function BandGlyph({ total, low, high }: { total: number; low: number; high: number }) {
  const k = 0.6;
  return (
    <svg className="bandg" viewBox="0 0 60 12" aria-hidden="true" focusable="false">
      <path className="bg-track" d="M0 6H60" />
      <rect className="bg-band" x={(low * k).toFixed(1)} y="2" width={((high - low) * k).toFixed(1)} height="8" rx="4" />
      <path className="bg-pt" d={`M${(total * k).toFixed(1)} 0V12`} />
    </svg>
  );
}
