"use client";

// The sealed decision chain as a TABLE: sortable headers, header-cell filters,
// and a pager — replacing the unbounded `<ul>` that rendered every record at
// once (a 66-record chain made the section ~9,000px tall, and a real chain is
// far longer).
//
// CLIENT-side here, unlike the decision log beside it. /api/decisions/records
// returns the WHOLE chain in one response — it has to, because verifying
// tamper-evidence means walking every link — so the rows are already in memory
// and paging them is a slice, exactly the case TablePager documents itself for.
//
// One rule this table must not break: `seq` is the chain's own order, and the
// hash of each link is computed over the one before it. So the DEFAULT ordering
// stays seq-descending (newest link first) and sorting by another column is a
// VIEW over the chain, never a claim about the chain itself — the seq column
// stays visible in every ordering so the reader can always see the real position.
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { kindLabel, parseEventActor } from "@/app/_lib/decision-attribution";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { useTableSort } from "@/app/_components/table/useTableSort";
import type { DecisionRecord } from "@/app/_lib/decision-record-store";
import {
  compareNames,
  formatAuditTime,
  isRecordOnlyKind,
  matchesSubject,
  resolveAuditTimeZone,
  shortHash,
} from "../analyticsDecisionLogTypes";
import { DecisionRecordDetail } from "./DecisionRecordDetail";

type Col = "seq" | "kind" | "subject" | "actor" | "createdAt" | "keyId";

/** Every column plus the expander cell — the detail row spans the full table. */
const COLUMN_COUNT = 8;

export function DecisionRecordsTable({
  records,
  resolved,
  rationaleOf,
  boardHref,
  onExportDossier,
}: {
  records: DecisionRecord[];
  resolved: Record<string, { label: string; live: boolean }> | undefined;
  /** Localized rationale, resolved by the panel (it owns the wave catalog). */
  rationaleOf: (r: DecisionRecord) => string;
  boardHref: (q: string) => string;
  /** UAT LUC-GEF-L1-11 — the ?candidate= dossier, resolved by the panel (it owns
   *  the export provenance). Rejects on failure so the row can say so. */
  onExportDossier: (candidateRef: string) => Promise<void>;
}) {
  const t = useTranslations("analytics.decisionRecords");
  // UAT LUC-ANA-9 — the record kinds that ALSO exist as pipeline events read their
  // label from the log's catalog, which mirrors DECISION_META one-for-one (retired
  // kinds included). Only the record-only kinds need a catalog of their own. The
  // English-only `labelize()` this replaces printed "Auto Rejected" under a Czech
  // header, in the column and in its filter menu alike.
  const tLog = useTranslations("analytics.log");
  const locale = useLocale();
  const [kind, setKind] = useState("");
  const [actor, setActor] = useState("");
  const [subject, setSubject] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [dossierBusy, setDossierBusy] = useState<string | null>(null);
  const [dossierError, setDossierError] = useState<string | null>(null);

  // UAT LUC-ANA-7 — one clock, named. Both this table and the CSV/JSON exports
  // render through it; the raw ISO instant stays on every cell's title.
  const zone = useMemo(() => resolveAuditTimeZone(), []);

  const kindText = (k: string): string => (isRecordOnlyKind(k) ? t(`kinds.${k}` as Parameters<typeof t>[0]) : kindLabel(tLog, k));
  // A record OUTLIVES the entry it concerns, so an unresolved ref is normal: the
  // raw ref is then the subject's only identity, and it is what the search reads.
  const subjectLabel = (r: DecisionRecord): string => resolved?.[r.candidateRef]?.label ?? r.candidateRef;

  const { sorted, sort, toggle } = useTableSort<DecisionRecord, Col>(
    records,
    {
      seq: (r) => r.seq,
      kind: (r) => kindText(r.kind),
      subject: (r) => subjectLabel(r),
      actor: (r) => r.actor,
      createdAt: (r) => r.createdAt,
      keyId: (r) => r.keyId,
    },
    { col: "seq", dir: "desc" }
  );

  // UAT LUC-ANA-5 — the shared comparator uses `localeCompare` with the RUNTIME's
  // default locale, which is not the app locale: under en-US every Czech diacritic
  // surname collates as its base letter, and under SQLite's BINARY collation (the
  // log's server-side ordering) it lands after Z. The two text columns therefore
  // re-sort through the app-locale collator, with seq breaking ties so the ordering
  // is total and the same on every render.
  const ordered = useMemo(() => {
    if (sort.col !== "subject" && sort.col !== "kind") return sorted;
    const label = sort.col === "subject" ? subjectLabel : (r: DecisionRecord) => kindText(r.kind);
    return [...sorted].sort((a, b) => compareNames(label(a), label(b), locale, sort.dir) || b.seq - a.seq);
    // `sorted` already carries the active column/direction; recomputing on the
    // label functions' identity would re-sort on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, sort.col, sort.dir, locale, resolved]);

  const filtered = ordered.filter(
    (r) => (!kind || r.kind === kind) && (!actor || r.actor === actor) && matchesSubject(subjectLabel(r), subject)
  );
  const safePage = clampPage(page, filtered.length);
  const shown = pageSlice(filtered, safePage);

  // Facets from the FULL set, not the filtered view, so the option list doesn't
  // shrink as you narrow and strand the reader with no way back.
  const kindOptions = [...new Set(records.map((r) => r.kind))]
    .map((v) => ({ value: v, label: kindText(v) }))
    .sort((a, b) => compareNames(a.label, b.label, locale, "asc"));
  const actorOptions = [...new Set(records.map((r) => r.actor))].sort().map((v) => ({ value: v, label: v }));

  const onFilter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(0);
  };

  const runDossier = async (candidateRef: string) => {
    setDossierBusy(candidateRef);
    setDossierError(null);
    try {
      await onExportDossier(candidateRef);
    } catch {
      setDossierError(t("dossierFailed"));
    } finally {
      setDossierBusy(null);
    }
  };

  return (
    <>
      <p className="mt-3 text-meta uppercase text-steel">{t("timeZoneNote", { zone })}</p>
      {dossierError ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {dossierError}
        </p>
      ) : null}
      {/* A table forced past the viewport by min-w scrolls inside this div. A bare
                overflow container is not reachable without a pointer in every browser
                (current Chrome/Firefox focus scroll containers on their own; Safari
                does not), so it is a NAMED, focusable region -- which also gives the
                data surface an accessible name it did not have. */}
      <div className="mt-2 overflow-x-auto" role="region" tabIndex={0} aria-label={t("title")}>
        <table aria-label={t("title")} className="w-full min-w-[60rem] text-base">
          <thead>
            <tr className="border-b border-stone-200">
              <ColumnHead title={t("colSeq")} sortCol="seq" sort={sort} onSort={toggle} align="right" />
              <ColumnHead title={t("colKind")} sortCol="kind" sort={sort} onSort={toggle}>
                <ColumnFilter title={t("colKind")} trigger="icon" value={kind} onChange={onFilter(setKind)} options={kindOptions} />
              </ColumnHead>
              {/* UAT LUC-ANA-5 — Subject was the only column of six with neither sort
                  nor filter, on the one surface whose whole job is "show me this
                  person's records". Search is diacritic-folded and the ordering is
                  app-locale collated, so Čermák is reachable by typing "cermak" and
                  sorts between Cach and Dvořák instead of after Zeman. */}
              <ColumnHead title={t("colSubject")} sortCol="subject" sort={sort} onSort={toggle}>
                <ColumnFilter title={t("colSubject")} trigger="icon" mode="search" value={subject} onChange={onFilter(setSubject)} />
              </ColumnHead>
              <ColumnHead title={t("colRationale")} sort={sort} onSort={toggle} />
              <ColumnHead title={t("colActor")} sortCol="actor" sort={sort} onSort={toggle}>
                <ColumnFilter title={t("colActor")} trigger="icon" value={actor} onChange={onFilter(setActor)} options={actorOptions} />
              </ColumnHead>
              <ColumnHead title={t("colSealed")} sortCol="createdAt" sort={sort} onSort={toggle} />
              {/* UAT CS-L1-005 / LUC-ANA-8 — the per-record fingerprint, back on the
                  row. Without it there is no way to tie a line on screen to a line in
                  the export, which is the first thing an auditor does with both. */}
              <ColumnHead title={t("colFingerprint")} sort={sort} onSort={toggle} />
              {/* UAT LUC-ANA-1 — key_id was on the wire and rendered nowhere, so the
                  badge's count and the rows it counted could not be reconciled by eye.
                  It is per-ROW because a chain is legitimately mixed across a rotation
                  (and across the moment the key was first configured): a per-chain
                  summary alone would hide which links are the keyless ones. */}
              <ColumnHead title={t("colKey")} sortCol="keyId" sort={sort} onSort={toggle} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const subjectEntry = resolved?.[r.candidateRef];
              const isOpen = open === r.seq;
              return (
                <Fragment key={r.seq}>
                  <tr className="border-b border-stone-100 align-top last:border-0 hover:bg-paper/50">
                    {/* The chain position, always shown: sorting by another column
                        reorders the VIEW, and without seq on screen the reader
                        could mistake that view for the chain's own order. */}
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-mono text-sm text-steel nums">#{r.seq}</td>
                    <td className="py-2 pr-3 font-medium text-ink">
                      {kindText(r.kind)}
                      {/* UAT CS-L1-005 — the policy floor that produced this decision.
                          Sealed on all 66 live records, with three distinct floors in the
                          fixture, and rendered on no screen: "which policy rejected me"
                          is the question the record exists to answer. */}
                      {r.policyVersion ? (
                        <span className="block font-mono text-sm font-normal text-steel" title={t("policyTitle")}>
                          {r.policyVersion}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      {subjectEntry?.live ? (
                        <Link
                          href={boardHref(subjectEntry.label)}
                          className="focus-ring rounded text-ink underline-offset-2 hover:text-coral hover:underline"
                        >
                          {subjectEntry.label}
                        </Link>
                      ) : (
                        // A record outlives the entry it concerns, so an
                        // unresolvable ref is normal — shown as plain text, never
                        // as a dead link.
                        <span className="text-steel">{subjectEntry?.label ?? r.candidateRef}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-sm text-steel">
                      {/* UAT LUC-ANA-10 — the rationale IS the expander: a two-line clamp
                          with no way to read the rest made the legal basis unreadable
                          without leaving the table. */}
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : r.seq)}
                        aria-expanded={isOpen}
                        className="focus-ring flex w-full items-start gap-1 rounded text-left hover:text-ink"
                      >
                        {isOpen ? (
                          <ChevronDown size={13} className="mt-0.5 shrink-0" aria-hidden />
                        ) : (
                          <ChevronRight size={13} className="mt-0.5 shrink-0" aria-hidden />
                        )}
                        <span className={isOpen ? "" : "line-clamp-2"}>{rationaleOf(r)}</span>
                        <span className="sr-only">{t("rationaleToggle")}</span>
                      </button>
                    </td>
                    {/* G5 — the actor column printed the raw token, so a record
                        sealed by a PERSON and one sealed by a role nobody can name
                        rendered as two equally-authoritative strings. The chain is
                        history and is never rewritten, so the honest move is to
                        read the existing rows correctly rather than to edit them:
                        parseEventActor already separates "human:Petra Nováková"
                        from "human:recruiter", and only the second gets the mark.
                        New bulk rejections can no longer be sealed this way at all
                        (screen-wave.ts refuses an unnamed approver) — this is what
                        the records that predate that refusal look like. */}
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-sm text-steel">
                      {r.actor}
                      {(() => {
                        const who = parseEventActor(r.actor);
                        return who.kind === "human" && who.name === null ? (
                          <span
                            className="ml-1.5 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 font-sans text-meta uppercase text-amber-800"
                            title={t("actorRoleOnlyTitle")}
                          >
                            {t("actorRoleOnly")}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-sm text-steel nums" title={r.createdAt}>
                      {formatAuditTime(r.createdAt, locale, zone) || "—"}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-sm text-steel" title={r.contentHash}>
                      {shortHash(r.contentHash)}
                    </td>
                    <td className="whitespace-nowrap py-2 font-mono text-sm">
                      {r.keyId ? (
                        <span className="text-steel">{r.keyId}</span>
                      ) : (
                        // Not "—": the absence IS the fact an auditor came for. Amber, not
                        // neutral, because this link carries no secret at all.
                        <span className="text-amber-700">{t("keyNone")}</span>
                      )}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="border-b border-stone-100 last:border-0">
                      <td colSpan={COLUMN_COUNT} className="p-0">
                        <DecisionRecordDetail
                          record={r}
                          localizedRationale={rationaleOf(r)}
                          locale={locale}
                          zone={zone}
                          onExportDossier={runDossier}
                          busy={dossierBusy === r.candidateRef}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-base text-steel">{t("noMatches")}</p>
      ) : (
        <div className="mt-3">
          <TablePager page={safePage} total={filtered.length} onPage={setPage} />
        </div>
      )}
    </>
  );
}
