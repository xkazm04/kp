"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { BTN_AFFIRM, BTN_SECONDARY, CHIP, CHIP_QUIET, META_LABEL, NOTICE, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { GIG_INVALID_STREAK_LIMIT } from "@/app/_lib/gigs/types";
import type { CatalogEntry, SourceRow } from "./gigsLogic";
import { Absent } from "./GigsFacts";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// The sources: official APIs only. Each configured source shows its tier, whether it is
// running or paused and why, its invalid streak and its last run. A tier-B source runs
// only after the operator acknowledges the terms summary the catalog shows - the summary
// and its hash are on screen, exactly what the acknowledgement records. A source that
// needs a key names the environment variables it reads (never their values).

export function GigsSources({
  sources,
  catalog,
  onChanged,
}: {
  sources: readonly SourceRow[];
  catalog: readonly CatalogEntry[];
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const byAdapter = new Map(catalog.map((c) => [c.adapter, c]));
  const addable = catalog.filter((c) => c.creatable && c.tier !== "C");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-h2 text-ink">{t("sources.title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-steel">{t("sources.lede")}</p>
      </div>
      {sources.length === 0 ? (
        <div className={`${PANEL_SUNKEN} px-6 py-6 text-center`}>
          <p className="font-serif text-h3 text-ink">{t("sources.emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-steel">{t("sources.emptyBody")}</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sources.map((s) => (
            <SourceCard key={s.id} source={s} entry={byAdapter.get(s.adapter) ?? null} onChanged={onChanged} />
          ))}
        </div>
      )}
      <section>
        <h3 className={`${META_LABEL} mb-2`}>{t("sources.addTitle")}</h3>
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {addable.map((c) => (
            <AddCard key={c.adapter} entry={c} already={sources.filter((s) => s.adapter === c.adapter).length} onChanged={onChanged} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function useAdapterLabel() {
  const t = useTranslations("gigs");
  return (entry: CatalogEntry | null, adapter: string) => {
    const key = `adapter.${adapter}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : (entry?.label ?? adapter);
  };
}

function KeyHint({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations("gigs");
  if (entry.envVars.length === 0) return <p className="text-sm text-steel">{t("sources.noKeyNeeded")}</p>;
  return (
    <div className="text-sm">
      <p className="text-ink">
        {entry.needsKey ? t("sources.needsKey") : t("sources.optionalKey")}{" "}
        {entry.envVars.map((v, i) => (
          <span key={v}>
            {i > 0 ? ", " : null}
            <code className="rounded bg-stone-100 px-1 font-mono text-sm">{v}</code>
          </span>
        ))}
      </p>
      <p className="mt-0.5 text-steel">
        <span className="font-semibold">{t("sources.keyless")}</span> {entry.keylessBehaviour}
      </p>
    </div>
  );
}

function SourceCard({ source, entry, onChanged }: { source: SourceRow; entry: CatalogEntry | null; onChanged: () => Promise<unknown> }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const label = useAdapterLabel();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const running = source.enabled && !source.pausedReason;
  const needsAck = source.tier === "B" && (!source.termsCurrent || source.pausedReason === "terms_review");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/sources/${encodeURIComponent(source.id)}`, "PATCH", body);
    setBusy(false);
    if (!res.ok) setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
    // A changed summary answers 409 with the new hash: re-read so the panel shows it.
    await onChanged();
  }

  return (
    <article className={`${PANEL} space-y-3 p-5`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${CHIP} text-xs`}>{t("sources.tier", { tier: source.tier })}</span>
        <span className={`${CHIP_QUIET} text-xs`}>{fmt.arena(source.arena)}</span>
        {running ? (
          <span className={`${NOTICE("info")} inline-block px-2 py-0.5 text-xs font-semibold`}>{t("sources.running")}</span>
        ) : (
          <span className={`${NOTICE("amber")} inline-block px-2 py-0.5 text-xs font-semibold`}>{source.pausedReason ? fmt.paused(source.pausedReason) : t("sources.disabled")}</span>
        )}
      </div>
      <div>
        <h3 className="font-serif text-h3 text-ink">{label(entry, source.adapter)}</h3>
        <p className="font-mono text-sm text-steel">{source.host}</p>
      </div>
      <p className="text-sm text-steel">{t(`sources.tierMeaning.${source.tier}` as Parameters<typeof t>[0])}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-steel">{t("sources.lastRun")}</dt>
        <dd className="text-ink">
          {source.lastRunAt ? t("sources.lastRunLine", { date: fmt.dateTime(source.lastRunAt), outcome: t(`runOutcome.${source.lastOutcome ?? "none"}` as Parameters<typeof t>[0]) }) : <Absent>{t("sources.neverRun")}</Absent>}
        </dd>
        <dt className="text-steel">{t("sources.streak")}</dt>
        <dd className="text-ink nums">{t("sources.streakLine", { count: source.invalidStreak, limit: GIG_INVALID_STREAK_LIMIT })}</dd>
        {source.pausedAt ? (
          <>
            <dt className="text-steel">{t("sources.pausedSince")}</dt>
            <dd className="text-ink">{fmt.dateTime(source.pausedAt)}</dd>
          </>
        ) : null}
      </dl>
      {source.pausedReason ? <p className="text-sm text-ink">{t(`pausedWhy.${source.pausedReason}` as Parameters<typeof t>[0])}</p> : null}
      {entry ? <KeyHint entry={entry} /> : null}

      {needsAck && entry && entry.termsHash ? (
        <div className={`${NOTICE("amber")} space-y-2 px-3 py-3 text-sm`}>
          <p className="font-semibold">{source.acknowledgedAt ? t("sources.termsChanged") : t("sources.termsFirst")}</p>
          <blockquote className="border-l-2 border-amber-600 pl-2">{entry.termsSummary}</blockquote>
          <p className="text-sm">{t("sources.termsIsReading", { date: entry.checkedOn })}</p>
          {entry.termsUrl ? (
            <a href={entry.termsUrl} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline">
              {t("sources.readOriginal")} <ExternalLink size={13} aria-hidden />
            </a>
          ) : null}
          <p className="break-all font-mono text-sm">{t("sources.hash", { hash: entry.termsHash })}</p>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="mt-0.5 h-4 w-4 accent-moss" />
            {t("sources.ackCheck")}
          </label>
          <button type="button" disabled={busy || !read} onClick={() => patch({ action: "acknowledge", termsHash: entry.termsHash })} className={`${BTN_AFFIRM} h-9 px-3 text-sm`}>
            {t("sources.acknowledge")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {running ? (
          <button type="button" disabled={busy} onClick={() => patch({ action: "pause" })} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            {t("sources.pause")}
          </button>
        ) : !needsAck ? (
          <button type="button" disabled={busy} onClick={() => patch({ action: "resume" })} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            {source.pausedReason === "invalid_streak" ? t("sources.resumeStreak") : t("sources.resume")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function AddCard({ entry, already, onChanged }: { entry: CatalogEntry; already: number; onChanged: () => Promise<unknown> }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const label = useAdapterLabel();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const res = await sendJson("/api/gigs/sources", "POST", { adapter: entry.adapter });
    setBusy(false);
    if (!res.ok) setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
    else await onChanged();
  }

  return (
    <li className={`${PANEL_SUNKEN} space-y-2 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${CHIP} text-xs`}>{t("sources.tier", { tier: entry.tier })}</span>
        {entry.arena ? <span className={`${CHIP_QUIET} text-xs`}>{fmt.arena(entry.arena)}</span> : null}
      </div>
      <p className="font-semibold text-ink">{label(entry, entry.adapter)}</p>
      <p className="font-mono text-sm text-steel">{entry.host}</p>
      {entry.declines ? <p className="text-sm text-amber-700">{t(`sources.declines.${entry.declines}` as Parameters<typeof t>[0])}</p> : null}
      <KeyHint entry={entry} />
      {entry.tier === "B" ? <p className="text-sm text-steel">{t("sources.addTierB")}</p> : null}
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
          {error}
        </p>
      ) : null}
      <button type="button" disabled={busy} onClick={add} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
        {already > 0 ? t("sources.addAnother", { count: already }) : t("sources.add")}
      </button>
    </li>
  );
}
