"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PANEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { intakeLang } from "@/app/_lib/intake-lang";
import { IntakeStudioOverlay } from "../IntakeStudioOverlay";
import { useAppMasterLogic } from "../jdsIntakeAppMaster";
import { useIntakeLogic } from "../jdsIntakeLogic";
import { highlightRow } from "./ledgerKit";
import { LedgerAppMasterDoor, LedgerHead } from "./LedgerDoors";
import { LedgerDossier } from "./LedgerDossier";
import { LedgerGhost } from "./LedgerMarks";
import { LedgerRecords } from "./LedgerRecords";

// THE LEDGER, IN THE STUDIO'S LANGUAGE.
//
// The history is a ledger of RUNS, and every run produced something. A record
// says three things and says all of them in marks: what kind of run it was (the
// gutter), how long it ran (the ticks), and where it ended (the terminal mark,
// which on a promoted run is the door to the JD it made). The dossier beside the
// plane is one of those records opened out, in the same hand — not an aside
// about it.
//
// What went away is prose. The lede tooltip that re-explained the product above
// the thing a returning reader came for, the App-master paragraph, the "open a
// session and its summary appears here" placeholder and the "no sessions yet"
// line are all gone: two became tooltips on the doors that raise them, and two
// became outlines of the records that will fill their space.
//
// What stays is the ERROR. A failure the reader must act on is not chrome — the
// same exception the studio's coats carve out.

export function IntakeLedgerPlane({
  onPromoted,
  autoStart = false,
  onAutoStarted,
}: {
  onPromoted?: () => void;
  autoStart?: boolean;
  onAutoStarted?: () => void;
}) {
  const t = useTranslations("library.tab.intake");
  const locale = useLocale();
  const resolveError = useErrorMessage();
  const logic = useIntakeLogic(onPromoted);
  const appMaster = useAppMasterLogic(logic.active, logic.applySession);
  const [lastOpened, setLastOpened] = useState<string | null>(null);

  const { sessions, startNew, openSession, creating } = logic;
  const highlighted = useMemo(() => highlightRow(sessions, lastOpened), [sessions, lastOpened]);

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
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-5">
        <div className="min-w-0">
          <LedgerHead busy={creating} onNew={() => void startNew(intakeLang(locale))} />
          <LedgerAppMasterDoor busy={creating} onStart={(repo) => logic.startAppMaster(intakeLang(locale), repo)} />
          {logic.error &&
          (logic.error.kind === "list" || logic.error.kind === "open" || logic.error.kind === "create" || logic.error.kind === "appMaster") ? (
            <p className="mt-3 text-body text-red-700">
              {resolveError(logic.error, t(logic.error.kind === "appMaster" ? "appMaster.startError" : "error"))}
            </p>
          ) : null}
          {sessions === null ? (
            // Loading draws the same outline the empty plane does: the shape of
            // the records, not a spinner and not a promise.
            <LedgerGhost rows={4} />
          ) : (
            <LedgerRecords sessions={sessions} highlightedId={highlighted?.id ?? null} onOpen={open} />
          )}
        </div>
        <LedgerDossier row={highlighted} onOpen={open} />
      </div>
      {logic.active ? <IntakeStudioOverlay active={logic.active} logic={logic} appMaster={appMaster} /> : null}
    </div>
  );
}
