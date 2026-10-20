"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { GIG_INVALID_STREAK_LIMIT, type GigStatus } from "@/app/_lib/gigs/types";
import { streakTone } from "../logic/line";
import type { CatalogEntry, SourceRow } from "../logic/wire";
import { useGigsFormat } from "../data/useGigsFormat";
import { jobsOf, otherConfig, type Key } from "./wireConfig";

/** A wire row folded open: the pause and why, the terms (a tier-B source's acknowledgement),
 *  the keyless behaviour, the key NAMES (never values), config, streak, last run, filed. */
export function WireDetail({
  source,
  entry,
  filed,
  shared,
  needsAck,
  busy,
  error,
  onPatch,
}: {
  source: SourceRow;
  entry: CatalogEntry | null;
  filed: Partial<Record<GigStatus, number>>;
  shared: boolean;
  needsAck: boolean;
  busy: boolean;
  error: string | null;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const format = useFormatter();
  const [read, setRead] = useState(false);
  const tone = streakTone(source.invalidStreak, GIG_INVALID_STREAK_LIMIT);
  const jobs = jobsOf(source);
  const config = otherConfig(source);
  const filedEntries = (Object.entries(filed) as [GigStatus, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  return (
    <div className="inner">
      <div>
        {source.pausedReason ? (
          <div>
            <h3 className="t-h3">{fmt.paused(source.pausedReason)}</h3>
            <p>{t(`pausedWhy.${source.pausedReason}` as Key)}</p>
            {source.pausedAt ? (
              <p className="t-meta">
                {t("sources.pausedSince")} {fmt.dateTime(source.pausedAt)}
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <h3 className="t-h3">{t("wires.terms")}</h3>
          {!entry ? (
            <p className="t-meta">{t("wires.noCatalog")}</p>
          ) : needsAck && entry.termsHash ? (
            <div className="terms">
              <p className="strong">{source.acknowledgedAt ? t("sources.termsChanged") : t("sources.termsFirst")}</p>
              <blockquote>{entry.termsSummary}</blockquote>
              <p>{t("sources.termsIsReading", { date: entry.checkedOn })}</p>
              {entry.termsUrl ? (
                <p>
                  <a href={entry.termsUrl} target="_blank" rel="noopener noreferrer" className="linkbtn">
                    {t("sources.readOriginal")}
                  </a>
                </p>
              ) : null}
              <p>
                <code>{t("sources.hash", { hash: entry.termsHash })}</code>
              </p>
              <label className="check-line">
                <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
                {t("sources.ackCheck")}
              </label>
              <div>
                <button type="button" className="btn affirm" disabled={busy || !read} onClick={() => void onPatch({ action: "acknowledge", termsHash: entry.termsHash })}>
                  {t("sources.acknowledge")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p>{entry.termsSummary}</p>
              <p className="t-meta">
                {entry.termsUrl ? (
                  <>
                    <a href={entry.termsUrl} target="_blank" rel="noopener noreferrer" className="linkbtn">
                      {t("sources.readOriginal")}
                    </a>
                    {" · "}
                  </>
                ) : null}
                {t("wires.checkedOn", { date: entry.checkedOn })}
                {source.acknowledgedAt ? ` · ${t("wires.acknowledgedOn", { date: fmt.date(source.acknowledgedAt) })}` : null}
              </p>
            </>
          )}
        </div>

        {entry ? (
          <div>
            <h3 className="t-h3">{t("wires.withoutKey")}</h3>
            <p>{entry.keylessBehaviour}</p>
          </div>
        ) : null}
      </div>

      <div>
        <div>
          <h3 className="t-h3">{t("wires.keys")}</h3>
          {entry && entry.envVars.length > 0 ? (
            <p>
              {entry.envVars.map((v, i) => (
                <span key={v}>
                  {i > 0 ? " " : null}
                  <code className="env">{v}</code>
                </span>
              ))}{" "}
              <span className="t-meta">{entry.needsKey ? t("wires.keysRequired") : t("wires.keysOptional")}</span>
            </p>
          ) : (
            <p className="t-meta">{t("wires.keysNone")}</p>
          )}
        </div>

        <div>
          <h3 className="t-h3">{t("wires.config")}</h3>
          {jobs ? (
            <>
              <p className="t-meta">{t("wires.jobCategories", { count: jobs.length })}</p>
              <div className="cats">
                {jobs.map((j) => (
                  <span key={j}>#{j}</span>
                ))}
              </div>
            </>
          ) : null}
          {config.length > 0 ? (
            <dl className="kv">
              {config.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : !jobs ? (
            <p className="t-meta">{shared ? t("wires.configEvery") : t("wires.configDefaults")}</p>
          ) : null}
        </div>

        <div>
          <h3 className="t-h3">{t("sources.streak")}</h3>
          <p className={tone === "near" || tone === "at" ? "coral" : undefined}>
            {t("sources.streakLine", { count: source.invalidStreak, limit: GIG_INVALID_STREAK_LIMIT })}
            {tone === "near" ? ` · ${t("sources.streakNear")}` : tone === "at" ? ` · ${t("sources.streakAt")}` : null}
          </p>
        </div>

        <div>
          <h3 className="t-h3">{t("sources.lastRun")}</h3>
          <p>
            {source.lastRunAt ? (
              t("sources.lastRunLine", { date: fmt.dateTime(source.lastRunAt), outcome: t(`runOutcome.${source.lastOutcome ?? "none"}` as Key) })
            ) : (
              <span className="absent">{t("sources.neverRun")}</span>
            )}
          </p>
        </div>

        <div>
          <h3 className="t-h3">{t("wires.filedTitle")}</h3>
          {filedEntries.length === 0 ? (
            <p className="t-meta">{source.lastRunAt ? t("wires.filedNone") : t("wires.neverRunNotZero")}</p>
          ) : (
            <p className="t-meta">
              {filedEntries.map(([k, n], i) => (
                <span key={k}>
                  {i > 0 ? " · " : null}
                  {fmt.status(k)} <b className="strong">{format.number(n)}</b>
                </span>
              ))}
            </p>
          )}
        </div>

        {error ? (
          <p role="alert" className="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
