"use client";

import type { CohortDimension, CohortView } from "../../cohortTypes";
import { LoomKnot } from "./LoomKnot";
import { LoomLegend } from "./LoomLegend";
import { fitRatedCount, knotOf, type RowReading, type Thread } from "./loomModel";
import type { Cursor } from "./loomNav";
import type { LoomWords } from "./useLoomWords";

type Row = { dimension: CohortDimension; reading: RowReading; rated: number; note: string | null };

/**
 * The shuttle: the one place the loom is READ in words. It follows what is pointed at or focused
 * (a thread, a row, a crossing) and states it fully: the short label, the band and what widened it,
 * the rare note, the reason a knot is missing, the row's claim and who it binds. Idle, it is the
 * legend. A polite live region, so a keyboard reader hears the crossing it lands on.
 */
export function LoomShuttle({ view, threads, rows, words, reading }: {
  view: CohortView;
  threads: readonly Thread[];
  rows: readonly Row[];
  words: LoomWords;
  reading: Cursor | null;
}) {
  const { t } = words;
  const thread = reading && reading.col >= 0 ? threads[reading.col] : null;
  const row = reading && reading.row >= 0 ? rows[reading.row] : null;
  return (
    <aside className="lm-shuttle" aria-label={t("shuttle.label")}>
      <div aria-live="polite" className="lm-shuttle__live">
        {!thread && !row ? <p className="lm-shuttle__idle">{t("shuttle.idle")}</p> : null}
        {thread ? <MemberHead thread={thread} view={view} words={words} /> : null}
        {thread && row ? <CellReading thread={thread} row={row} words={words} /> : null}
        {row && !thread ? <RowReadingCard row={row} total={view.members.length} words={words} /> : null}
      </div>
      {!thread && !row ? <LoomLegend words={words} /> : null}
    </aside>
  );
}

function MemberHead({ thread, view, words }: { thread: Thread; view: CohortView; words: LoomWords }) {
  const { t } = words;
  const m = thread.member;
  return (
    <div className="lm-shuttle__member">
      <p className="lm-shuttle__name">{m.label}</p>
      <p className="lm-shuttle__meta">
        {t(`membership.${m.membership}`)} · {t(`runState.${m.runState}`)}
      </p>
      <p className="lm-shuttle__meta">
        {m.fitRank != null
          ? t("shuttle.fitRank", { rank: m.fitRank, rated: fitRatedCount(view) })
          : t("shuttle.noFitRank", { reason: words.absent(m.cells.fit.absentReason ?? "notRead") })}
      </p>
      {thread.slack ? <p className="lm-shuttle__slack">{t("shuttle.slack", { other: words.name(thread.slackBehind) })}</p> : null}
      <p className="lm-shuttle__hint">{m.analysisSlug ? t("shuttle.report") : t("shuttle.noReport")}</p>
    </div>
  );
}

function CellReading({ thread, row, words }: { thread: Thread; row: Row; words: LoomWords }) {
  const { t } = words;
  const cell = thread.member.cells[row.dimension];
  const knot = knotOf(cell);
  const r = row.reading;
  const others = r.kind === "insideNoise" ? r.noise.filter((id) => id !== thread.member.memberId) : [];
  const inNoise = r.kind === "insideNoise" && r.noise.includes(thread.member.memberId);
  return (
    <div className="lm-shuttle__cell">
      <div className="lm-shuttle__fig">
        <LoomKnot knot={knot} bind={null} />
        <div>
          <p className="lm-shuttle__dim">{words.dim(row.dimension)}</p>
          <p className="lm-shuttle__label">
            {knot.kind === "absent" ? words.absent(knot.reason) : `${t(`tier.${knot.tier}`)} · ${words.short(cell.label)}`}
          </p>
        </div>
      </div>
      {cell.band ? (
        <p className="lm-shuttle__meta">
          {t("shuttle.band", { lo: cell.band.lo, hi: cell.band.hi })}
          {cell.band.drivers.length ? ` · ${cell.band.drivers.map(words.short).join(" · ")}` : ""}
        </p>
      ) : null}
      {cell.comment ? (
        <figure className="lm-shuttle__note">
          <figcaption>{t("shuttle.note")}</figcaption>
          <blockquote>{cell.comment}</blockquote>
        </figure>
      ) : null}
      {r.kind === "clears" && r.leader === thread.member.memberId ? <p className="lm-shuttle__claim" data-kind="clears">{t("shuttle.leads")}</p> : null}
      {inNoise ? <p className="lm-shuttle__claim" data-kind="insideNoise">{t("shuttle.noise", { names: words.names(others) })}</p> : null}
      <p className="lm-shuttle__hint">{t("shuttle.pull")}</p>
    </div>
  );
}

function RowReadingCard({ row, total, words }: { row: Row; total: number; words: LoomWords }) {
  const { t } = words;
  const r = row.reading;
  return (
    <div className="lm-shuttle__row">
      <p className="lm-shuttle__name">{words.dim(row.dimension)}</p>
      <p className="lm-shuttle__claim" data-kind={r.kind}>
        {r.kind === "insideNoise" ? t("shuttle.noiseRow", { names: words.names(r.noise) }) : words.claim(r)}
      </p>
      <p className="lm-shuttle__meta">{t("shuttle.rated", { rated: row.rated, total })}</p>
      {r.kind === "neverLeads" ? <p className="lm-shuttle__meta">{t("shuttle.salary")}</p> : null}
      {r.kind === "neverLeads" && r.partitions ? (
        <div className="lm-shuttle__parts">
          <p className="lm-shuttle__dim">{t("shuttle.partitions")}</p>
          <ul>
            {r.partitions.map((p) => (
              <li key={p.key}>{t("shuttle.partition", { key: p.key, n: p.count })}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {row.note ? (
        <figure className="lm-shuttle__note">
          <figcaption>{t("shuttle.note")}</figcaption>
          <blockquote>{row.note}</blockquote>
        </figure>
      ) : null}
      <p className="lm-shuttle__hint">{t("shuttle.pull")}</p>
    </div>
  );
}
