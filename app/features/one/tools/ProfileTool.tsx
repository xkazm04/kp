"use client";

// The candidate profile tool (round 4) — what the `profile` panel draws in its `pane` look
// and, compacted, in its `insight` look. Two columns from 900px of the tool's OWN width
// (a container query, so a half-screen pane and a full sheet both read right): the CV as
// the analysis read it | the score — verdict, the five parts against their maxima, job fit
// (matching / missing / unproven), strengths, gaps, soft signals. Stacked below 900px.
//
// Everything is the analysis' own record (GET /api/analyses/[slug] via tools/reads.ts); a
// missing score is "Unscored", never a 0, and an analysis matched by name only says so.
import { useLocale, useTranslations } from "next-intl";
import { Mark, Note, ScoreList, Tag } from "@/app/_components/kit";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { ScoreBar } from "../panels/ScoreFig";
import type { ProfileSummary } from "./parse";

type Ready = ProfileSummary & { labelOnly: boolean };

function Chips({ label, items, tone }: { label: string; items: string[]; tone?: "caution" }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className={META_LABEL}>
        {label} <span className="k-nums">{items.length}</span>
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <li key={s} className="flex min-w-0 items-center gap-1">
            {tone ? <Mark kind={tone} /> : null}
            <Tag label={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Lines({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className={META_LABEL}>{label}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-micro text-ink">
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

/** The score half: verdict line, parts, job fit, strengths, gaps, soft signals. */
function ScoreSide({ p }: { p: Ready }) {
  const t = useTranslations("one.core.panels.profile");
  const locale = useLocale();
  const pct = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return (
    <div className="flex min-w-0 flex-col gap-4" data-role="one-profile-score">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <p className={META_LABEL}>{t("overall")}</p>
        <p className={META_LABEL}>{t("jobFit")}</p>
        <div className="text-body font-semibold">
          {p.verdict.overall !== null ? <ScoreBar score={p.verdict.overall} /> : <span className="text-micro text-steel">{t("unscored")}</span>}
        </div>
        <div className="text-body font-semibold">
          {p.verdict.jobFit !== null ? <ScoreBar score={p.verdict.jobFit} /> : <span className="text-micro text-steel">{t("jobFitNone")}</span>}
        </div>
      </div>
      {p.parts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className={META_LABEL}>{t("score")}</p>
          <ScoreList
            items={p.parts.map((x) => {
              const label = t(`parts.${x.key}`);
              return {
                key: x.key,
                label: `${label} · ${t("partOf", { value: pct.format(x.value), max: pct.format(x.max) })}`,
                value: x.max > 0 ? (x.value / x.max) * 100 : 0,
                meterLabel: t("meter", { label, value: pct.format(x.value), max: pct.format(x.max) }),
              };
            })}
          />
        </div>
      ) : null}
      {p.jobFit?.summary ? <p className="text-micro text-ink">{p.jobFit.summary}</p> : null}
      <Chips label={t("matching")} items={p.jobFit?.matching ?? []} />
      <Chips label={t("missing")} items={p.jobFit?.missing ?? []} tone="caution" />
      <Chips label={t("unproven")} items={p.jobFit?.unproven ?? []} />
      <Lines label={t("strengths")} items={p.strengths} />
      <Lines label={t("gaps")} items={p.gaps} />
      {p.softSignals.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className={META_LABEL}>{t("signals")}</p>
          <ul className="flex flex-col gap-1.5">
            {p.softSignals.map((s) => (
              <li key={s.key} className="flex min-w-0 items-start gap-2 text-micro">
                <Mark kind={s.side === "strength" ? "ok" : "caution"} tip={s.side === "strength" ? t("signalStrength") : t("signalWatch")} />
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{s.label}</span>
                  {s.detail ? <span className="text-steel"> · {s.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Provenance({ p }: { p: Ready }) {
  const t = useTranslations("one.core.panels.profile");
  const fmt = useDateFormat();
  const engine = p.engine === "llm" ? t("engine.llm") : p.engine === "deterministic" ? t("engine.deterministic") : t("engine.unknown");
  return (
    <p className="text-micro text-steel" data-role="one-profile-provenance">
      {engine}
      {p.createdAt ? ` · ${t("analysed", { date: fmt.date(p.createdAt) })}` : ""}
    </p>
  );
}

/** The `pane` look: CV | score, two columns from 900px of its own width. */
export function ProfilePane({ profile }: { profile: Ready }) {
  const t = useTranslations("one.core.panels.profile");
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto" data-role="one-profile">
      <div className="grid gap-[var(--one-gap)] p-[var(--one-pad)] @min-[900px]:h-full @min-[900px]:grid-cols-2">
        <div className="flex min-h-0 min-w-0 flex-col gap-2" data-role="one-profile-cv">
          <div className="flex items-baseline justify-between gap-3">
            <p className={META_LABEL}>{t("cv")}</p>
            <Provenance p={profile} />
          </div>
          {profile.labelOnly ? <Note tone="caution">{t("labelOnly")}</Note> : null}
          {profile.cvText ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-stone-200 bg-stone-50 p-3 dark:rounded-lg" tabIndex={0} aria-label={t("cv")}>
              <p className="whitespace-pre-wrap break-words text-micro leading-6 text-ink">{profile.cvText}</p>
            </div>
          ) : (
            <p className="text-micro text-steel">{t("cvNone")}</p>
          )}
          <p className="text-micro text-steel">{t("cvNote")}</p>
        </div>
        <div className="min-h-0 min-w-0 @min-[900px]:overflow-y-auto">
          <ScoreSide p={profile} />
        </div>
      </div>
    </div>
  );
}

/** The `insight` look: the verdict, the two figures and the first strength / gap. */
export function ProfileCard({ profile }: { profile: Ready }) {
  const t = useTranslations("one.core.panels.profile");
  return (
    <div className="flex flex-col gap-3 p-[var(--one-pad)]" data-role="one-profile-card">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <p className={META_LABEL}>{t("overall")}</p>
        <p className={META_LABEL}>{t("jobFit")}</p>
        <div>{profile.verdict.overall !== null ? <ScoreBar score={profile.verdict.overall} /> : <span className="text-micro text-steel">{t("unscored")}</span>}</div>
        <div>{profile.verdict.jobFit !== null ? <ScoreBar score={profile.verdict.jobFit} /> : <span className="text-micro text-steel">{t("jobFitNone")}</span>}</div>
      </div>
      {profile.labelOnly ? <Note tone="caution">{t("labelOnly")}</Note> : null}
      <Lines label={t("strengths")} items={profile.strengths.slice(0, 2)} />
      <Lines label={t("gaps")} items={profile.gaps.slice(0, 2)} />
      <Provenance p={profile} />
    </div>
  );
}
