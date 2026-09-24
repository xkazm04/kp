"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET, CHIP_TOGGLE, FIELD, META_LABEL, NOTICE, PANEL, PANEL_SUNKEN, STICKY_HEAD } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { canTransitionGig } from "@/app/_lib/gigs/transitions";
import { GIG_ARENAS, type Gig, type GigArena, type GigAttempt, type GigOutcome, type GigStatus } from "@/app/_lib/gigs/types";
import { BOARD_STEPS, groupBoard, queueKindOf, type BoardFilter, type SourceRow, type SpecialistRow } from "./gigsLogic";
import { Absent, DeadlineText, GigHead, RewardText, UntrustedText } from "./GigsFacts";
import { markForGig, OutcomeMark } from "./GigsMarks";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// The board: every gig, by lifecycle step, INCLUDING the empty steps ("none at this
// step") - so a step nothing reached reads as a gap, not a missing row. Search plus arena
// and status filters. A row opens the gig's record: its listing, every attempt and every
// verdict appended to it, and the moves its status still allows.

export function GigsBoard({
  gigs,
  attemptsByGig,
  truncated,
  sources,
  specialists,
  now,
  onOpenInQueue,
  onChanged,
}: {
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  truncated: boolean;
  sources: readonly SourceRow[];
  specialists: readonly SpecialistRow[];
  now: Date;
  onOpenInQueue: (key: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const [filter, setFilter] = useState<BoardFilter>({ search: "", arena: "all", status: "all" });
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = useMemo(() => groupBoard(gigs, filter), [gigs, filter]);
  const shown = groups.reduce((n, g) => n + g.gigs.length, 0);
  const specialistById = useMemo(() => new Map(specialists.map((s) => [s.id, s])), [specialists]);
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const open = openId ? gigs.find((g) => g.id === openId) ?? null : null;

  if (open) {
    const latest = attemptsByGig[open.id] ?? null;
    const kind = queueKindOf(open, latest);
    return (
      <GigRecord
        gig={open}
        source={open.sourceId ? (sourceById.get(open.sourceId) ?? null) : null}
        specialist={open.specialistId ? (specialistById.get(open.specialistId) ?? null) : null}
        now={now}
        onBack={() => setOpenId(null)}
        queueKey={kind ? `${kind}:${open.id}` : null}
        onOpenInQueue={onOpenInQueue}
        onChanged={onChanged}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-serif text-h2 text-ink">{t("board.title", { count: gigs.length })}</h2>
        <p className="mt-1 max-w-3xl text-sm text-steel">{t("board.lede")}</p>
        {truncated ? <p className={`${NOTICE("amber")} mt-2 px-3 py-1.5 text-sm`}>{t("board.truncated", { count: gigs.length })}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          placeholder={t("board.searchPlaceholder")}
          aria-label={t("board.searchLabel")}
          className={`${FIELD} min-w-[16rem]`}
        />
        <div role="group" aria-label={t("board.arenaFilter")} className="flex flex-wrap gap-1.5">
          {(["all", ...GIG_ARENAS] as const).map((a) => (
            <button key={a} type="button" aria-pressed={filter.arena === a} onClick={() => setFilter((f) => ({ ...f, arena: a as GigArena | "all" }))} className={CHIP_TOGGLE(filter.arena === a)}>
              {a === "all" ? t("board.allArenas") : fmt.arena(a)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-steel">
          {t("board.statusFilter")}
          <select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as GigStatus | "all" }))} className={FIELD}>
            <option value="all">{t("board.allSteps")}</option>
            {BOARD_STEPS.map((s) => (
              <option key={s} value={s}>
                {fmt.status(s)}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-steel nums" role="status">
          {t("board.shown", { count: shown })}
        </span>
      </div>

      <div className={`${PANEL} overflow-x-auto`}>
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 ${META_LABEL}`}>
                {t("board.col.listing")}
              </th>
              <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 ${META_LABEL}`}>
                {t("board.col.arena")}
              </th>
              <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 text-right ${META_LABEL}`}>
                {t("board.col.reward")}
              </th>
              <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 ${META_LABEL}`}>
                {t("board.col.deadline")}
              </th>
              <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 ${META_LABEL}`}>
                {t("board.col.specialist")}
              </th>
              <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 ${META_LABEL}`}>
                {t("board.col.latest")}
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.status}>
              <tr className="bg-stone-50">
                <th scope="rowgroup" colSpan={6} className={`px-3 py-1.5 ${META_LABEL}`}>
                  {g.gigs.length ? t("board.step", { step: fmt.status(g.status), count: g.gigs.length }) : t("board.stepEmpty", { step: fmt.status(g.status) })}
                </th>
              </tr>
              {g.gigs.map((gig) => {
                const latest = attemptsByGig[gig.id] ?? null;
                const mark = markForGig(gig, latest);
                const sp = gig.specialistId ? specialistById.get(gig.specialistId) : undefined;
                return (
                  <tr key={gig.id} className={`border-t border-stone-200 align-top ${gig.status === "suspect" ? "bg-red-50" : ""}`}>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setOpenId(gig.id)} className="focus-ring text-left font-semibold text-ink hover:text-coral hover:underline">
                        {gig.title}
                      </button>
                      {gig.status === "suspect" ? <span className={`${NOTICE("critical")} ml-2 inline-block px-2 py-0.5 text-xs font-semibold`}>{t("board.suspectChip")}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`${CHIP_QUIET} text-xs`}>{fmt.arena(gig.arena)}</span>
                    </td>
                    <td className="px-3 py-2 text-right nums">
                      <RewardText gig={gig} />
                    </td>
                    <td className="px-3 py-2">
                      <DeadlineText gig={gig} now={now} />
                    </td>
                    <td className="px-3 py-2">{sp ? sp.name : <Absent>{t("board.noSpecialist")}</Absent>}</td>
                    <td className="px-3 py-2">
                      {latest ? (
                        <span className="inline-flex items-center gap-1.5">
                          {fmt.attemptStatus(latest.status)}
                          {mark ? (
                            <>
                              <OutcomeMark kind={mark} />
                              <span className="text-steel">{t(`mark.${mark}` as Parameters<typeof t>[0])}</span>
                            </>
                          ) : null}
                        </span>
                      ) : (
                        <Absent>{t("board.noAttempt")}</Absent>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

type GigRecordAnswer = { gig: Gig; attempts: GigAttempt[]; outcomes: GigOutcome[] };

function GigRecord({
  gig,
  source,
  specialist,
  now,
  onBack,
  queueKey,
  onOpenInQueue,
  onChanged,
}: {
  gig: Gig;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  now: Date;
  onBack: () => void;
  queueKey: string | null;
  onOpenInQueue: (key: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const [record, setRecord] = useState<GigRecordAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/gigs/${encodeURIComponent(gig.id)}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (GigRecordAnswer & ApiErrorPayload) | null;
        if (!alive) return;
        if (!r.ok || !body) setError(resolveError(body, t("board.recordFailed")));
        else setRecord(body);
      })
      .catch(() => {
        // Unreachable server: the generic sentence is all there is to say.
        if (alive) setError(t("board.recordFailed"));
      });
    return () => {
      alive = false;
    };
  }, [gig.id, gig.updatedAt, resolveError, t]);

  async function move(action: "decline" | "withdraw") {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action });
    setBusy(false);
    if (!res.ok) setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
    else await onChanged();
  }

  const outcomesByAttempt = new Map<string, GigOutcome[]>();
  for (const o of record?.outcomes ?? []) {
    const k = o.attemptId ?? "";
    outcomesByAttempt.set(k, [...(outcomesByAttempt.get(k) ?? []), o]);
  }

  return (
    <div className={PANEL}>
      <div className="px-5 pt-3">
        <button type="button" onClick={onBack} className={`${BTN_GHOST} h-8 px-2 text-sm`}>
          <ArrowLeft size={14} aria-hidden /> {t("board.back")}
        </button>
      </div>
      <GigHead gig={gig} crumbs={[t("views.board"), fmt.status(gig.status), gig.id]} source={source} specialist={specialist} now={now} />
      <div className="grid gap-6 px-5 py-5 xl:grid-cols-2">
        <UntrustedText gig={gig} source={source} />
        <div className="space-y-3">
          <h3 className={META_LABEL}>{t("board.attempts")}</h3>
          {error ? (
            <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
              {error}
            </p>
          ) : null}
          {!record && !error ? <p className="text-sm text-steel">{t("board.loadingRecord")}</p> : null}
          {record && record.attempts.length === 0 ? (
            <div className={`${PANEL_SUNKEN} px-4 py-3 text-sm`}>
              <p className="font-semibold text-ink">{t("board.neverAttempted")}</p>
              <p className="text-steel">{t("board.neverAttemptedBody")}</p>
            </div>
          ) : null}
          {record ? (
            <ol className="space-y-2">
              {record.attempts.map((a) => (
                <li key={a.id} className="rounded-lg border border-stone-200 px-3 py-2 text-sm dark:rounded-2xl">
                  <p className="flex flex-wrap justify-between gap-2">
                    <span className="font-mono text-steel">{a.id}</span>
                    <span className="font-semibold text-ink">{fmt.attemptStatus(a.status)}</span>
                  </p>
                  <p className="text-steel">
                    {fmt.dateTime(a.createdAt)} · {a.costUsd === null ? t("desk.costUnreported") : t("desk.cost", { cost: fmt.usd(a.costUsd) })}
                  </p>
                  {a.status === "sent" && !(outcomesByAttempt.get(a.id) ?? []).length ? (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-steel">
                      <OutcomeMark kind="pending" /> {t("mark.pending")}
                    </p>
                  ) : null}
                  {(outcomesByAttempt.get(a.id) ?? []).map((o) => (
                    <div key={o.id} className="mt-1.5 border-t border-dotted border-stone-200 pt-1.5">
                      <p className="inline-flex flex-wrap items-center gap-1.5 text-ink">
                        <OutcomeMark kind={o.verdict} /> <span className="font-semibold">{fmt.verdict(o.verdict)}</span>
                        <span className="text-steel">{t("board.recorded", { date: fmt.dateTime(o.recordedAt), source: t(`outcomeSource.${o.source.replace(":", "_")}` as Parameters<typeof t>[0]) })}</span>
                        {o.amount !== null ? <span className="font-semibold nums">{fmt.money(o.amount, o.currency)}</span> : null}
                      </p>
                      {o.feedbackText ? <blockquote className="mt-1 border-l-2 border-stone-300 pl-2 text-ink">{o.feedbackText}</blockquote> : <p className="mt-1 text-steel">{t("board.noWords")}</p>}
                    </div>
                  ))}
                </li>
              ))}
            </ol>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-2">
            {queueKey ? (
              <button type="button" onClick={() => onOpenInQueue(queueKey)} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
                {t("board.openInQueue")}
              </button>
            ) : (
              <p className="text-sm text-steel">{t("board.needsNobody")}</p>
            )}
            {canTransitionGig(gig.status, "declined") ? (
              <button type="button" disabled={busy} onClick={() => move("decline")} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
                {t("board.decline")}
              </button>
            ) : null}
            {canTransitionGig(gig.status, "withdrawn") ? (
              <button type="button" disabled={busy} onClick={() => move("withdraw")} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
                {t("board.withdraw")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
