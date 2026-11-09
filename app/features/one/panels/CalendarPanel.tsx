"use client";

// calendar — the interview calendar (round 4), read through tools/reads.ts `useCalendar`:
// ONE schedule read (GET /api/schedule?limit=200, filtered client-side by week), the free pool
// (GET /api/schedule?slots=1) and the shared pipeline read for who is WAITING for a slot
// (active entries on the `calendar` gate — their `approvalDetail` "Tue 14:00" is a
// placeholder and is never shown as a time). Every time is in the server's interview zone.
//
//   table / pane  the week grid (Mon–Fri, booked + awaiting interviews and the free times,
//                 a week pager over this week → the offer horizon) beside the waiting list,
//                 grouped by role; a waiting row is a candidate (selectable).
//   list          the week as an agenda, one group per day.
//   insight       this week's shape, who waits longest, and ONE suggested booking (the
//                 longest waiter on the first free time — a PREVIEW consent card).
//
// Params: none — or `entryId` + `label`: the INTERVIEW TOOL for that one candidate (their
// invitations, the free times as Book buttons, Send a link). Every act is a preview.
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Mark, Note, Tag } from "@/app/_components/kit";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { isoToDateSlot } from "@/app/_lib/schedule-slots";
import { useCalendar, useInterview, type CalendarDay, type Invite, type Slot } from "../tools/reads";
import { useDays } from "./cells";
import { InsightBody, NameCell, PanelFrame, type InsightData, type PanelRow } from "./PanelFrame";
import type { OneEntry } from "./pipelineRead";
import type { PanelProps } from "./types";

const bookParams = (e: { id: string; label: string }, slot: Slot, dateSlot: string, zone: string) => ({
  entryId: e.id,
  dateSlot,
  label: e.label,
  when: slot.label,
  zone,
});

/** Days since an ISO instant (null when unknown). */
function daysSince(iso: string | null, now: number): number | null {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 86_400_000)) : null;
}

/** A row-like pressable line (role=button), the same keys as a table row. */
function PickLine({ picked, onPick, children }: { picked: boolean; onPick?: () => void; children: ReactNode }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (onPick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onPick();
    }
  };
  return (
    <div
      role={onPick ? "button" : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-pressed={onPick ? picked : undefined}
      onClick={onPick}
      onKeyDown={onKey}
      data-row
      data-picked={picked || undefined}
      className={`flex min-h-[var(--one-row-h)] items-center gap-2 border-b border-stone-200 px-[var(--one-pad)] py-1 outline-none last:border-b-0 hover:bg-stone-50 focus-visible:bg-stone-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-coral data-[picked]:bg-stone-100 dark:border-dashed ${
        onPick ? "cursor-pointer" : ""
      } ${picked ? "shadow-[inset_3px_0_0_var(--color-ink)]" : ""}`}
    >
      {children}
    </div>
  );
}

/* ── the week grid + the waiting list ───────────────────────────────────────── */

function WeekGrid({
  days,
  zone,
  waitingPicked,
  onBook,
}: {
  days: CalendarDay[];
  zone: string;
  /** The picked candidate, when they are waiting: free times become Book buttons. */
  waitingPicked: { id: string; label: string } | null;
  onBook: (slot: Slot, dateSlot: string) => void;
}) {
  const t = useTranslations("one.core.panels.calendar");
  const tc = useTranslations("one.core.panels");
  const fmt = useDateFormat();
  const f = useFormatter();
  return (
    <div className="grid min-h-0 grid-cols-5 overflow-y-auto" data-role="one-week">
      {days.map((d) => {
        const noon = `${d.date.iso}T12:00:00Z`;
        const booked = d.items.filter((i) => i.kind === "interview").length;
        return (
          <section key={d.date.iso} className={`flex min-w-0 flex-col border-r border-stone-200 last:border-r-0 dark:border-dashed ${d.date.past ? "bg-stone-50" : ""}`} aria-label={fmt.date(noon, { timeZone: "UTC" })}>
            <div className="sticky top-0 z-[1] flex items-baseline gap-1.5 border-b border-stone-200 bg-white px-2 py-1.5 dark:border-b-2">
              <span className="text-micro font-semibold text-ink">{f.dateTime(new Date(noon), { weekday: "short", timeZone: "UTC" })}</span>
              {/* The day of the month as a numeral; the pager names the full week. */}
              <span className="k-nums text-micro text-steel">{d.date.day}</span>
            </div>
            <ul className="flex flex-col gap-1 p-1.5">
              {d.items.map((it) =>
                it.kind === "interview" ? (
                  <li key={it.invite.id} className="flex min-w-0 flex-col rounded-md border border-stone-200 bg-white px-2 py-1 dark:rounded-lg" data-item="interview" data-status={it.invite.status}>
                    <span className="flex items-center gap-1.5">
                      <Mark kind={it.invite.status === "confirmed" ? "ok" : "wait"} tip={it.invite.status === "confirmed" ? t("confirmed") : t("pending")} />
                      <span className="k-nums text-micro font-semibold text-ink">{it.time}</span>
                    </span>
                    <span className="break-words text-micro text-ink">{it.invite.label ?? tc("notReturned")}</span>
                    {it.invite.jobTitle ? <span className="truncate text-micro text-steel">{it.invite.jobTitle}</span> : null}
                  </li>
                ) : (
                  <li key={it.slot.value} className="flex min-w-0 items-center gap-1.5 px-1" data-item="free">
                    {waitingPicked && !d.date.past ? (
                      <Button label={t("agendaFree", { time: it.time })} variant="secondary" size="sm" className="w-full justify-start" onClick={() => onBook(it.slot, it.dateSlot)} data-act="interview-book" />
                    ) : (
                      <span className="text-micro text-steel">
                        <span className="k-nums">{it.time}</span> · {t("free")}
                      </span>
                    )}
                  </li>
                )
              )}
              {booked === 0 && d.items.length === 0 ? <li className="px-1 text-micro text-steel">{t("noDay")}</li> : null}
            </ul>
            <span className="sr-only">{zone}</span>
          </section>
        );
      })}
    </div>
  );
}

function WaitingList({
  groups,
  selectedEntryId,
  onSelect,
}: {
  groups: { role: string | null; rows: OneEntry[] }[];
  selectedEntryId: string | null;
  onSelect?: (e: OneEntry) => void;
}) {
  const t = useTranslations("one.core.panels");
  const days = useDays();
  const [now] = useState(() => Date.now());
  return (
    <div className="flex min-h-0 flex-col" data-role="one-waiting">
      <p className={`${META_LABEL} border-b border-stone-200 px-[var(--one-pad)] py-2 dark:border-b-2`}>
        {t("calendar.waitingTitle")} <span className="k-nums">{groups.reduce((n, g) => n + g.rows.length, 0)}</span>
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? <p className="px-[var(--one-pad)] py-3 text-micro text-steel">{t("calendar.noneWaiting")}</p> : null}
        {groups.map((g) => (
          <div key={g.role ?? "none"} role="group" aria-label={g.role ?? t("group.none")} data-role="one-group">
            <div className="flex min-h-8 items-center gap-2 border-b border-stone-200 bg-stone-50 px-[var(--one-pad)] py-1 dark:border-dashed" data-role="one-group-head" aria-hidden>
              <span className="min-w-0 truncate text-micro font-semibold text-ink">{g.role ?? t("group.none")}</span>
              <span className="k-nums shrink-0 text-micro text-steel">{g.rows.length}</span>
            </div>
            {g.rows.map((e) => (
              <PickLine key={e.id} picked={e.id === selectedEntryId} onPick={onSelect ? () => onSelect(e) : undefined}>
                <NameCell name={e.label} sub={days(daysSince(e.stageChangedAt, now))} />
              </PickLine>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── the interview tool (one candidate) ────────────────────────────────────── */

function InterviewBody({ entryId, label, props }: { entryId: string; label: string; props: PanelProps }) {
  const t = useTranslations("one.core.panels.interview");
  const tc = useTranslations("one.core.panels.calendar");
  const fmt = useDateFormat();
  const days = useDays();
  const [now] = useState(() => Date.now());
  const iv = useInterview(entryId, props.epoch);
  if (iv.state !== "ready") return null;
  const { entry, zone, invites, slots } = iv;
  const who = { id: entryId, label };
  const waiting = entry?.waitingInterview === true;
  const when = (i: Invite) => (i.slotAt ? fmt.dayTime(i.slotAt, { timeZone: zone }) : null);
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto" data-role="one-interview">
      <div className="grid gap-[var(--one-gap)] p-[var(--one-pad)] @min-[900px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="flex items-center gap-1.5 text-micro text-ink" data-role="one-interview-status">
            {entry ? <Mark kind={waiting ? "needs" : "ok"} /> : <Mark kind="unknown" />}
            {!entry
              ? t("gone")
              : !waiting
                ? t("notWaiting")
                : daysSince(entry.stageChangedAt, now) === null
                  ? t("waitingUnknown")
                  : t("waiting", { days: days(daysSince(entry.stageChangedAt, now)) })}
          </p>
          <div className="flex flex-col gap-1.5">
            <p className={META_LABEL}>{t("invites")}</p>
            {invites.length === 0 ? (
              <p className="text-micro text-steel">—</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 text-micro">
                    <Tag label={i.status === "confirmed" ? tc("confirmed") : i.status === "pending" ? tc("pending") : i.status} />
                    <span className="k-nums text-ink">{when(i) ?? t("proposed")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {waiting ? (
            <div>
              <Button label={t("link")} variant="secondary" size="sm" onClick={() => props.onPropose("interviewLink", { entryId, label })} data-act="interview-link" />
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className={META_LABEL}>{t("slots")}</p>
            <p className="text-micro text-steel">{t("zone", { zone })}</p>
          </div>
          {iv.calendarStatus === "not_connected" ? <p className="text-micro text-steel">{tc("notConnected")}</p> : null}
          {iv.calendarStatus === "unavailable" ? <Note tone="caution">{tc("unavailable")}</Note> : null}
          {slots === null ? (
            <Note tone="caution">{tc("slotsFailed")}</Note>
          ) : slots.length === 0 ? (
            <p className="text-micro text-steel">{t("noSlots")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {slots.map((s) => {
                const dateSlot = isoToDateSlot(s.value, zone);
                return (
                  <li key={s.value} className="flex items-center gap-2">
                    {waiting && dateSlot ? (
                      <Button label={t("bookAt", { when: s.label })} variant="secondary" size="sm" onClick={() => props.onPropose("interviewBook", bookParams(who, s, dateSlot, zone))} data-act="interview-book" />
                    ) : (
                      <span className="k-nums text-micro text-steel">{s.label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── the panel ─────────────────────────────────────────────────────────────── */

export function CalendarPanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const tc = useTranslations("one.core.panels.calendar");
  const fmt = useDateFormat();
  const days = useDays();
  const [now] = useState(() => Date.now());
  const { entryId = "", label = "" } = props.panel.params;
  const tool = Boolean(entryId);
  const cal = useCalendar(props.epoch, 0);
  const iv = useInterview(tool ? entryId : null, props.epoch);
  const look = props.look ?? "table";

  if (tool) {
    const read = iv.state === "error" ? iv.read : iv.state === "loading" ? { state: "loading" as const, retry: () => undefined } : { state: "ready" as const, data: null, retry: () => undefined };
    return (
      <PanelFrame
        props={{ ...props, look: look === "insight" ? "insight" : "pane" }}
        data={{
          title: t("interview.titleFor", { label }),
          console: { tab: "schedule" },
          read,
          cols: [],
          rows: [],
          empty: t("interview.pick"),
          body: iv.state === "ready" ? { pane: <InterviewBody entryId={entryId} label={label} props={props} />, insight: <InterviewBody entryId={entryId} label={label} props={props} /> } : undefined,
        }}
      />
    );
  }

  const read = cal.state === "error" ? cal.read : cal.state === "loading" ? { state: "loading" as const, retry: () => undefined } : { state: "ready" as const, data: null, retry: () => undefined };
  const ready = cal.state === "ready" ? cal : null;
  const picked = ready?.waiting.find((e) => e.id === props.selectedEntryId) ?? null;
  const onBook = (slot: Slot, dateSlot: string) => {
    if (picked && ready) props.onPropose("interviewBook", bookParams(picked, slot, dateSlot, ready.zone));
  };
  const select = props.onSelectEntry ? (e: OneEntry) => props.onSelectEntry?.({ entryId: e.id, label: e.label }) : undefined;

  const notes = ready ? (
    <>
      {ready.truncated ? <Note tone="caution">{tc("truncated")}</Note> : null}
      {ready.slots === null ? <Note tone="caution">{tc("slotsFailed")}</Note> : null}
      {ready.calendarStatus === "unavailable" ? <Note tone="caution">{tc("unavailable")}</Note> : null}
    </>
  ) : null;

  const pager = ready ? (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 px-[var(--one-pad)] py-1.5 dark:border-b-2" data-role="one-week-pager">
      <Button label={tc("prevWeek")} icon="left" iconOnly variant="ghost" size="sm" disabled={ready.week <= 0} onClick={() => cal.setWeek(ready.week - 1)} />
      <span className="text-micro font-semibold text-ink">{ready.days[0] ? tc("week", { date: fmt.date(`${ready.days[0].date.iso}T12:00:00Z`, { timeZone: "UTC" }) }) : ""}</span>
      <Button label={tc("nextWeek")} icon="right" iconOnly variant="ghost" size="sm" disabled={ready.week >= ready.weekCount - 1} onClick={() => cal.setWeek(ready.week + 1)} />
      <span className="ml-auto text-micro text-steel">
        {tc("zone", { zone: ready.zone })}
        {ready.calendarStatus === "not_connected" ? ` · ${tc("notConnected")}` : ""}
      </span>
    </div>
  ) : null;

  // table / pane: the week grid beside the waiting list.
  const grid = ready ? (
    <div className="@container flex min-h-0 flex-1 flex-col" data-role="one-calendar">
      {pager}
      {ready.truncated || ready.slots === null || ready.calendarStatus === "unavailable" ? <div className="flex shrink-0 flex-col gap-1 px-[var(--one-pad)] pt-2">{notes}</div> : null}
      {/* The week takes the width; the waiting list sits beside it from 760px of the panel's
          own width (a half-screen side), under it below that. */}
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] @min-[760px]:grid-cols-[minmax(0,1fr)_16rem] @min-[760px]:grid-rows-1">
        <WeekGrid days={ready.days} zone={ready.zone} waitingPicked={picked ? { id: picked.id, label: picked.label } : null} onBook={onBook} />
        <div className="min-h-0 border-t border-stone-200 @min-[760px]:border-t-0 @min-[760px]:border-l dark:border-dashed">
          <WaitingList groups={ready.waitingByRole} selectedEntryId={props.selectedEntryId ?? null} onSelect={select} />
        </div>
      </div>
    </div>
  ) : null;

  // list: the week as an agenda, one group per day.
  const agenda: PanelRow[] = ready
    ? ready.days.flatMap((d) =>
        d.items.map((it): PanelRow => {
          const day = { key: d.date.iso, label: fmt.date(`${d.date.iso}T12:00:00Z`, { timeZone: "UTC" }) };
          return it.kind === "interview"
            ? {
                key: it.invite.id,
                cells: {},
                line: `${it.time} · ${it.invite.label ?? t("notReturned")}`,
                meta: [it.invite.jobTitle, it.invite.status === "confirmed" ? tc("confirmed") : tc("pending")].filter(Boolean).join(" · "),
                mark: it.invite.status === "confirmed" ? "ok" : "wait",
                group: day,
                ...(it.invite.entryId && it.invite.label ? { entry: { entryId: it.invite.entryId, label: it.invite.label } } : {}),
              }
            : { key: `${it.slot.value}-free`, cells: {}, line: tc("agendaFree", { time: it.time }), group: day };
        })
      )
    : [];

  const suggestion = ready?.suggestion ?? null;
  const thisWeek = ready ? ready.days : [];
  const count = (k: "confirmed" | "pending" | "free") =>
    thisWeek.reduce((n, d) => n + d.items.filter((i) => (k === "free" ? i.kind === "free" : i.kind === "interview" && i.invite.status === k)).length, 0);
  const longest = ready?.waiting[0] ?? null;

  const insightOf = (r: NonNullable<typeof ready>): InsightData => ({
    shape: {
      label: tc("thisWeek"),
      parts: [
        { key: "confirmed", label: tc("confirmed"), value: count("confirmed") },
        { key: "pending", label: tc("pending"), value: count("pending") },
        { key: "free", label: tc("freeSlots"), value: count("free") },
      ].filter((p) => p.value > 0),
    },
    facts: longest
      ? [{ key: "longest", label: tc("longest"), value: longest.label, sub: daysSince(longest.stageChangedAt, now) === null ? tc("waitingForUnknown") : tc("waitingFor", { days: days(daysSince(longest.stageChangedAt, now)) }), mark: "needs" as const }]
      : [],
    suggest: suggestion
      ? {
          label: tc("suggest", { label: suggestion.entry.label }),
          hint: tc("suggestHint", { when: suggestion.slot.label }),
          onPress: () => props.onPropose("interviewBook", bookParams(suggestion.entry, suggestion.slot, suggestion.dateSlot, r.zone)),
        }
      : undefined,
    quiet: !longest && count("confirmed") + count("pending") === 0 ? tc("empty") : undefined,
  });

  return (
    <PanelFrame
      props={look === "list" ? props : { ...props, group: "none" }}
      data={{
        title: tc("title"),
        count: ready ? ready.waiting.length : null,
        state: ready ? tc("zone", { zone: ready.zone }) : undefined,
        console: { tab: "schedule" },
        read,
        cols: [
          { key: "when", label: tc("cols.when"), track: "8rem" },
          { key: "who", label: tc("cols.who"), track: "minmax(0,1fr)" },
        ],
        rows: look === "list" ? agenda : [],
        note: look === "list" ? notes : undefined,
        empty: tc("empty"),
        body: ready
          ? {
              table: grid,
              pane: grid,
              // The card speaks even with nothing booked (who waits, the free week), so it is
              // drawn as the panel's own body rather than behind the rows' empty state.
              insight: <InsightBody data={{ title: tc("title"), read, cols: [], rows: [], insight: insightOf(ready) }} />,
            }
          : undefined,
      }}
    />
  );
}
