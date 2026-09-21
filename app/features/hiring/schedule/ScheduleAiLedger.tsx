"use client";

// The AI round as a LEDGER — one row per candidate in the interview loop, in the
// two states a recruiter can still act on: AWAITING LINK (no live session yet; the
// row mints one) and LINK OUT (a session exists; when it went out, and whether the
// candidate is on the call right now). Completed interviews are out of this ledger's
// scope on purpose: their verdicts flow to Decisions as scorecard reviews, and the
// conversation is logged under Insights → Activity as the voice-interview use case.
//
// The table kit's full grammar (app/_components/table): sortable heads, a search
// on the candidate and a select on role / state, twenty rows to a page, and a
// live-region status for the sort and the match count.

import { useMemo, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { StatusChip } from "@/app/_components/StatusChip";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { TableStatus } from "@/app/_components/table/TableStatus";
import { useTableSort } from "@/app/_components/table/useTableSort";
import { BTN_PRIMARY, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import type { InterviewSessionSummary } from "@/app/_lib/db/interviews";
import type { SchedEntry } from "./ScheduleTypes";
import type { IvStatus } from "./useScheduleTab";

const CELL = "px-3 py-2 align-middle";
type State = "awaiting" | "out" | "live";
type Row = { key: string; state: State; name: string; role: string | null; sentAt: string | null; entry: SchedEntry | null };
type Col = "name" | "role" | "state" | "sent";
const STATE_ORDER: Record<State, number> = { awaiting: 0, out: 1, live: 2 };

export function ScheduleAiLedger({
  sessions,
  awaiting,
  interviews,
  generating,
  onGenerate,
}: {
  sessions: InterviewSessionSummary[];
  awaiting: SchedEntry[];
  interviews: Record<string, IvStatus>;
  generating: string | null;
  onGenerate: (e: SchedEntry) => void;
}) {
  const t = useTranslations("scheduleTab.aiRound");
  const format = useFormatter();
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const stateLabel: Record<State, string> = { awaiting: t("stateAwaiting"), out: t("linkOut"), live: t("live") };

  const rows = useMemo<Row[]>(
    () => [
      ...awaiting.map((e): Row => ({ key: `a-${e.id}`, state: "awaiting", name: e.candidateLabel, role: e.jobTitle, sentAt: null, entry: e })),
      ...sessions
        .filter((s) => s.status === "created" || s.status === "in_progress")
        .map((s): Row => {
          const live = s.status === "in_progress" || (s.entryId ? interviews[s.entryId]?.status === "in_progress" : false);
          return { key: `s-${s.id}`, state: live ? "live" : "out", name: s.candidateLabel ?? "—", role: s.jobTitle, sentAt: s.createdAt, entry: null };
        }),
    ],
    [awaiting, sessions, interviews],
  );

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(0);
  const reset = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(0);
  };
  const filtered = useMemo(() => {
    const q = name.trim().toLowerCase();
    return rows.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!role || r.role === role) && (!state || r.state === state));
  }, [rows, name, role, state]);
  const { sorted, sort, toggle } = useTableSort<Row, Col>(
    filtered,
    { name: (r) => r.name, role: (r) => r.role, state: (r) => STATE_ORDER[r.state], sent: (r) => r.sentAt },
    { col: "state", dir: "asc" },
  );
  const onSort = (col: Col) => {
    toggle(col);
    setPage(0);
  };
  const safePage = clampPage(page, sorted.length);
  const shown = pageSlice(sorted, safePage);
  const filtering = Boolean(name.trim() || role || state);
  const titles: Record<Col, string> = { name: t("colCandidate"), role: t("colRole"), state: t("colState"), sent: t("colSent") };
  const roleOptions = [...new Set(rows.map((r) => r.role).filter((r): r is string => Boolean(r)))].sort().map((r) => ({ value: r, label: r }));
  const stateOptions = (["awaiting", "out", "live"] as const).map((s) => ({ value: s, label: stateLabel[s] }));
  const counts = { awaiting: rows.filter((r) => r.state === "awaiting").length, out: rows.filter((r) => r.state !== "awaiting").length };

  return (
    <div className="space-y-3">
      <p className={META_LABEL}>
        {t("awaitingTitle")} <span className="text-coral">· {counts.awaiting}</span>
        <span className="mx-2 text-stone-300">|</span>
        {t("outTitle")} <span className="text-coral">· {counts.out}</span>
      </p>
      <TableStatus columnTitle={titles[sort.col]} dir={sort.dir} matched={filtered.length} filtered={filtering} />
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-200 p-3 text-sm text-steel">{t("awaitingEmpty")}</p>
      ) : (
        <div className={`${PANEL} overflow-x-auto`}>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-paper">
              <tr>
                <ColumnHead title={titles.name} sortCol="name" sort={sort} onSort={onSort} className={CELL}>
                  <ColumnFilter title={titles.name} value={name} onChange={reset(setName)} mode="search" trigger="icon" />
                </ColumnHead>
                <ColumnHead title={titles.role} sortCol="role" sort={sort} onSort={onSort} className={CELL}>
                  <ColumnFilter title={titles.role} value={role} onChange={reset(setRole)} options={roleOptions} trigger="icon" />
                </ColumnHead>
                <ColumnHead title={titles.state} sortCol="state" sort={sort} onSort={onSort} className={CELL}>
                  <ColumnFilter title={titles.state} value={state} onChange={reset(setState)} options={stateOptions} trigger="icon" />
                </ColumnHead>
                <ColumnHead title={titles.sent} sortCol="sent" sort={sort} onSort={onSort} className={CELL} />
                <th scope="col" className={`${CELL} ${META_LABEL} w-16 text-right`}>{t("colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.key} className="border-t border-stone-200 hover:bg-stone-50">
                  <td className={`${CELL} font-semibold text-ink`}>{row.name}</td>
                  <td className={`${CELL} text-steel`}>{row.role ?? "—"}</td>
                  <td className={CELL}>
                    {row.state === "awaiting" ? (
                      <StatusChip tone="waiting" label={stateLabel.awaiting} />
                    ) : row.state === "live" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-coral/10 px-2 py-0.5 text-sm font-semibold text-coral">
                        <span className="relative flex h-1.5 w-1.5" aria-hidden>
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-coral opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-coral" />
                        </span>
                        {stateLabel.live}
                      </span>
                    ) : (
                      <StatusChip tone="active" label={stateLabel.out} />
                    )}
                  </td>
                  <td className={`${CELL} nums text-steel`}>{when(row.sentAt)}</td>
                  <td className={`${CELL} text-right`}>
                    {row.entry ? (
                      // Icon only: the link glyph on an awaiting row says what it does;
                      // the accessible name still carries the words.
                      <button
                        type="button"
                        disabled={generating === row.entry.id}
                        onClick={() => onGenerate(row.entry as SchedEntry)}
                        aria-label={t("generate")}
                        title={t("generate")}
                        className={`${BTN_PRIMARY} h-8 w-8 cursor-pointer justify-center p-0 disabled:cursor-wait`}
                      >
                        {generating === row.entry.id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Link2 size={14} aria-hidden />}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-stone-200 px-3 py-2">
            <TablePager page={safePage} total={sorted.length} onPage={setPage} />
          </div>
        </div>
      )}
      <p className="text-sm text-steel">{t("verdictNote")}</p>
    </div>
  );
}
