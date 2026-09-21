"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { BTN_SECONDARY, CHIP_QUIET, EYEBROW, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { intakeLang } from "@/app/_lib/intake-lang";
import { shortDate } from "../jdsLibrary";
import { IntakeStudioOverlay } from "./IntakeStudioOverlay";
import { JdsIntakeSessionsTable } from "./JdsIntakeSessionsTable";
import { useAppMasterLogic } from "./jdsIntakeAppMaster";
import { useIntakeLogic, type IntakeSummary } from "./jdsIntakeLogic";

// THE INTAKE LEDGER — and only the ledger.
//
// This surface used to be two views in one component: a list of conversations,
// which it swapped out for the conversation itself the moment one was opened. The
// tab then had to host both, so the desk that is the whole point of the feature
// got whatever height was left under a tab header, a mode switcher and an intro
// paragraph — and the ledger, the thing a returning recruiter comes for, was
// silently replaced rather than navigated away from.
//
// So the tab answers one question: which intake conversations do I have, and what
// is the state of the one I was last in. Opening a session opens the STUDIO
// (`IntakeStudioOverlay`) — a full-viewport dialog over this page, so the ledger
// is still underneath when it closes.
//
// The hook stays HERE, not in the overlay: it holds the session list this page
// draws, and `useAppMasterLogic` needs the shared TasksProvider as its clock (it
// must also be called unconditionally, before any early return, so its hook order
// is stable whether or not a session is open).

const SHAPE_KEY = {
  power_unit: "shape.powerUnit",
  story: "shape.story",
  app_master: "shape.appMaster",
} as const;


export function JdsIntakePanel({
  onPromoted,
  autoStart = false,
  onAutoStarted,
}: {
  onPromoted?: () => void;
  /** `?intake=new` arrived: open the studio on a fresh session as soon as this
   *  panel is alive. One-shot — the tab strips the param and calls
   *  `onAutoStarted` back, so a re-render can never start a second conversation. */
  autoStart?: boolean;
  onAutoStarted?: () => void;
}) {
  const t = useTranslations("library.tab.intake");
  const locale = useLocale();
  // An API failure is shown from its machine `code`, never from the server's
  // English `error` string (docs/architecture/api-contracts.md §1.1).
  const resolveError = useErrorMessage();
  const logic = useIntakeLogic(onPromoted);
  const appMaster = useAppMasterLogic(logic.active, logic.applySession);
  // Which row the summary rail is describing. It follows the reader: whatever
  // they last opened, falling back to the newest session, so the rail says
  // something useful on a first visit instead of sitting empty next to a list.
  const [lastOpened, setLastOpened] = useState<string | null>(null);

  const { sessions, startNew, openSession } = logic;
  const highlighted = useMemo<IntakeSummary | null>(() => {
    if (!sessions || sessions.length === 0) return null;
    const picked = lastOpened ? sessions.find((s) => s.id === lastOpened) : null;
    if (picked) return picked;
    return [...sessions].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))[0] ?? null;
  }, [sessions, lastOpened]);

  useEffect(() => {
    if (!autoStart) return;
    // Consumed before the fetch is fired, not after: `startNew` is async, and a
    // re-render inside that window would otherwise start a second session.
    onAutoStarted?.();
    void startNew(intakeLang(locale));
  }, [autoStart, onAutoStarted, startNew, locale]);

  const open = (id: string) => {
    setLastOpened(id);
    void openSession(id);
  };

  return (
    <div className={`${PANEL} animate-fade-in p-5`}>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-5">
        <div className="min-w-0">
          {/* No new-intake door on this page: starting a role is a workspace
              action and lives in the Library menu, next to the surfaces it feeds.
              A ledger is for what already happened. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* The lede is a tooltip on the title, not a paragraph under it: it
                explains the surface to a first-time reader and then repeats itself
                on every visit above the one thing a returning reader came for. */}
            <div className={`${META_LABEL} cursor-help underline decoration-stone-300 decoration-dotted underline-offset-4`} title={t("lede")}>
              {t("ledgerTitle")}
            </div>
          </div>
          {logic.error && (logic.error.kind === "list" || logic.error.kind === "open" || logic.error.kind === "create" || logic.error.kind === "appMaster") ? (
            <p className="mt-3 text-body text-red-700">
              {resolveError(logic.error, t(logic.error.kind === "appMaster" ? "appMaster.startError" : "error"))}
            </p>
          ) : null}
          {/* Keyed on the loaded state, so the ledger fades in when the fetch
              lands (the key changes null → "loaded") instead of appearing under
              the placeholder it replaces. */}
          <div key={sessions === null ? "loading" : "loaded"} className="animate-arrive-in">
            {sessions === null ? (
              <div className="reveal-quiet mt-4 min-h-[6rem]" aria-hidden />
            ) : (
              <JdsIntakeSessionsTable sessions={sessions} onOpen={open} />
            )}
          </div>
        </div>
        <IntakeLedgerSummary row={highlighted} onOpen={open} />
      </div>
      {logic.active ? <IntakeStudioOverlay active={logic.active} logic={logic} appMaster={appMaster} /> : null}
    </div>
  );
}

/**
 * The rail beside the ledger: everything about ONE session that the table cannot
 * hold without becoming a spreadsheet — and the door back into it.
 *
 * It describes the row the reader last opened, which is the one they are most
 * likely to want again; before they have opened anything it describes the newest.
 * A promoted session links to the JD it produced, because "what came of this
 * conversation" is the question the ledger's `promoted` chip raises and cannot
 * answer.
 */
function IntakeLedgerSummary({ row, onOpen }: { row: IntakeSummary | null; onOpen: (id: string) => void }) {
  const t = useTranslations("library.tab.intake");
  const locale = useLocale();
  return (
    <aside className={`${PANEL_SUNKEN} mt-4 p-4 lg:mt-0`}>
      <div className={EYEBROW}>{t("ledger.summaryTitle")}</div>
      {row === null ? (
        <p className="mt-2 text-body text-steel">{t("ledger.summaryEmpty")}</p>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-body font-medium text-ink">{row.title || t("untitled")}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {row.shape ? <span className={CHIP_QUIET}>{t(SHAPE_KEY[row.shape])}</span> : null}
            <span className={CHIP_QUIET}>{t(`status.${row.status}`)}</span>
          </div>
          <dl className="space-y-1 text-meta text-steel">
            <div className="flex justify-between gap-2">
              <dt>{t("table.turns")}</dt>
              <dd className="nums text-ink">{row.turnCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t("table.updated")}</dt>
              <dd className="text-ink">{shortDate(row.updatedAt ?? row.createdAt, locale)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm`} onClick={() => onOpen(row.id)}>
              {t("ledger.summaryOpen")}
            </button>
            {row.jdSlug ? (
              // The JD's own page, the same door `JobsLifecycleStrip` uses — the
              // library ledger has no per-JD deep-link param to aim at.
              <Link href={`/jds/${encodeURIComponent(row.jdSlug)}`} className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm`}>
                {t("ledger.summaryJd")}
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
}
