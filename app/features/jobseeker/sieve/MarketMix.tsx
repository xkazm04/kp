"use client";

// What the seeker's target titles ask for NOW - the web research (roleResearch.ts), shown in
// the Want chapter under the titles it is about, against what the seeker already shows.
//
// A research is a sourced claim about the market, and the panel keeps it one: every skill
// opens to the reason and the pages it came from, each page marked read in full or seen only
// as a search result; the footer names the date, the model and the count. The seeker's side
// is marked from their OWN record - the CV's skills, and the GitHub skills only once they
// chose to use them - never from the research. Keyless (no Claude CLI on this install) the
// panel says so; the designed CV's coverage then reads the seeker's own postings.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { RoleResearchSkill, RoleResearchTier } from "@/app/_lib/jobseeker/roleResearch";
import type { GithubState } from "@/app/_lib/jobseeker/githubEvidence";
import type { JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { RoleResearchApi } from "./useSeekerEvidence";
import { ProvMark } from "./marks";
import { cx, SV_BTN_PRIMARY, SV_BTN_SM_GHOST } from "./sieveRecipes";

const TIERS: readonly RoleResearchTier[] = ["core", "common", "emerging"];

/** A skill name as the panel compares it: case, spaces, dots and dashes do not matter
 *  ("Next.js" = "nextjs" = "Next JS"). Display only - the matcher scores with the taxonomy. */
const key = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s._\-/]+/g, "");

type Have = "cv" | "github" | "missing";

/** A model id as a reader names it: "claude-sonnet-5-5" reads "Claude Sonnet 5.5". */
function modelLabel(id: string | null): string {
  const m = id ? /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id) : null;
  if (!m) return id ?? "-";
  return `Claude ${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

export function MarketMix({ api, profile, github }: { api: RoleResearchApi; profile: JobseekerProfile | null; github: GithubState | null }) {
  const t = useTranslations("me.sieve.market");
  const resolveError = useErrorMessage();
  const dates = useDateFormat();
  const [open, setOpen] = useState<string | null>(null);
  const research = api.record?.research ?? null;

  const haves = useMemo(() => {
    const cv = new Set((profile?.profile.skillClaims ?? []).map((c) => c.skill ?? "").filter(Boolean).map(key));
    for (const e of profile?.profile.evidence ?? []) for (const s of e.skills ?? []) cv.add(key(s));
    const gh = new Set(github && github.confirmed && github.use ? github.derived.skills.map((s) => key(s.skill)) : []);
    // The CV's own words too: the read skill list is thinner than what the CV says ("RAG
    // pipeline design", "Vector databases" on a line of their own).
    const text = (profile?.cvSourceText ?? "").normalize("NFKC");
    return { cv, gh, text };
  }, [profile, github]);
  const saysIt = (skill: string): boolean => {
    if (!haves.text || skill.length < 2) return false;
    const escaped = skill.normalize("NFKC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(haves.text);
  };
  const haveOf = (s: RoleResearchSkill): Have =>
    haves.cv.has(key(s.skill)) || saysIt(s.skill) ? "cv" : haves.gh.has(key(s.skill)) ? "github" : "missing";

  if (api.titles.length === 0) return null;
  const titles = api.titles.join(" · ");
  const markets = api.markets.length ? api.markets.map((m) => m.toUpperCase()).join(", ") : t("marketsAny");
  const core = research ? research.skills.filter((s) => s.tier === "core") : [];
  const coreHave = core.filter((s) => haveOf(s) !== "missing").length;
  const fetched = research ? research.sources.filter((s) => s.read === "fetched").length : 0;

  return (
    <section className="market" aria-labelledby="mk-title" data-state={api.running ? "running" : research ? "done" : "none"}>
      <div className="mk-head">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h3 id="mk-title">{t("title", { titles })}</h3>
          <p className="mk-lede">{research?.summary || t("lede", { markets })}</p>
        </div>
        {research ? (
          <div className="mk-score" aria-label={t("coreHaveLabel", { have: coreHave, total: core.length })}>
            <span className="n">{coreHave}</span>
            <span className="of">/{core.length}</span>
            <span className="l">{t("coreHave")}</span>
          </div>
        ) : null}
      </div>

      {api.running ? (
        <div className="mk-running" role="status" aria-live="polite">
          <span className="mk-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <div>
            <b>{t("running", { titles })}</b>
            <span>{t("runningNote")}</span>
          </div>
        </div>
      ) : null}

      {!research && !api.running ? (
        <div className="mk-cta">
          <p>{t.rich("ctaBody", { markets, b: (c) => <b>{c}</b> })}</p>
          <button type="button" className={SV_BTN_PRIMARY} onClick={() => void api.run(false)} disabled={!api.loaded}>
            {t("cta")}
          </button>
        </div>
      ) : null}

      {research ? (
        <div className="mk-tiers">
          {TIERS.map((tier) => {
            const list = research.skills.filter((s) => s.tier === tier);
            if (!list.length) return null;
            return (
              <div key={tier} className={cx("mk-tier", tier)}>
                <p className="mk-tier-h">
                  {t(`tier.${tier}`)} <span>{list.length}</span>
                </p>
                <ul>
                  {list.map((s) => {
                    const have = haveOf(s);
                    const id = `${tier}:${s.skill}`;
                    const isOpen = open === id;
                    return (
                      <li key={id} className={cx("mk-skill", have)}>
                        <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                          <ProvMark mark={have === "cv" ? "solid" : have === "github" ? "half" : "dashed"} size={14} />
                          <b>{s.skill}</b>
                          {s.share !== null ? <span className="mk-share">{Math.round(s.share * 100)} %</span> : null}
                          <em>{t(`have.${have}`)}</em>
                        </button>
                        {isOpen ? (
                          <div className="mk-why">
                            {s.why ? <p>{s.why}</p> : null}
                            <ul>
                              {s.sources.map((i) => {
                                const src = research.sources[i];
                                if (!src) return null;
                                return (
                                  <li key={i}>
                                    <a href={src.url} target="_blank" rel="noopener noreferrer">
                                      {src.title ?? src.publisher ?? new URL(src.url).hostname}
                                    </a>{" "}
                                    <span className="muted">{src.read === "fetched" ? t("read.fetched") : t("read.snippet")}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {research ? (
        <div className="mk-foot">
          <span suppressHydrationWarning>
            {t("footer", { date: dates.date(api.record!.at), model: modelLabel(api.record!.model), n: research.sources.length, fetched })}
          </span>
          <button type="button" className={SV_BTN_SM_GHOST} onClick={() => void api.run(true)} disabled={api.running}>
            {t("again")}
          </button>
        </div>
      ) : null}

      {api.attempt ? (
        <p className="mk-note" role="status">
          {api.attempt.fallbackReason === "no_provider" ? t("keyless") : t("failed", { reason: api.attempt.fallbackReason ?? "unknown" })}
        </p>
      ) : null}
      {api.error ? (
        <p className="mk-note" role="alert">
          {resolveError(api.error, t("error"))}
        </p>
      ) : null}
    </section>
  );
}
