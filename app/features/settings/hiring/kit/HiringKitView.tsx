"use client";

import { useTranslations } from "next-intl";
import { Button, KitSurface, Note, SaveBar, Section, saveTone } from "@/app/_components/kit";
import { useHiringComposer } from "../useHiringComposer";
import { saveStatusKey } from "./hiringKitModel";
import { HiringKitHead } from "./HiringKitHead";
import { HiringKitMatrix } from "./HiringKitMatrix";
import { HiringKitStranded } from "./HiringKitStranded";
import { HiringKitPreviews } from "./HiringKitPreviews";

/**
 * Settings > Hiring, composed from the composition kit (Gate 1; rendered only behind the dev-only
 * `?kit=1` switch, see HiringKitSwitch). The same state as the current tab, read through the same
 * hook (useHiringComposer: two drafts, occupancy, the stranded mapping, save / discard / reload)
 * and edited through the same model functions. Layout: a page head with the plan's figures and the
 * save, the presets, the pipeline as ONE matrix (a row per step: name, type, AI actions, cohort,
 * executor, guard, reorder), the save bar while a draft is unsaved, and the three impact previews.
 */
export default function HiringKitView() {
  const t = useTranslations("hiringPlan");
  const c = useHiringComposer();
  const ready = c.plan != null && c.axis != null;

  return (
    <KitSurface density="compact">
      <div data-sim="settings-hiring" aria-busy={!ready && !c.loadFailed}>
        <HiringKitHead c={c} />
        {c.loadFailed ? null : !ready ? (
          <Section title={t("steps.title")} status="loading" />
        ) : (
          <>
            {/* Somebody stored a newer plan: nothing was written, and the honest move is to show
                what is stored (HiringTab's banner, as a kit note). */}
            {c.staleConflict ? (
              <Note tone="critical" action={<Button label={t("staleReload")} size="sm" onClick={() => void c.reloadPlan()} />}>
                {t("stale")}
              </Note>
            ) : null}
            {c.countsFailed ? (
              <Note tone="caution" action={<Button label={t("occupancyRetry")} size="sm" onClick={() => void c.retryCounts()} />}>
                {t("occupancyUnknown")}
              </Note>
            ) : null}
            <HiringKitMatrix c={c} />
            <HiringKitStranded c={c} />
            {/* The save bar exists only while there is something to save, IN FLOW under the table it
                saves (today's tab puts it there too): it takes its own height, so it never covers a
                row. Clean, the head's Save and its quiet "All changes saved" say it. */}
            {c.dirty || c.saving ? (
              <SaveBar
                placement="flow"
                tone={saveTone({ dirty: c.dirty, blocked: c.blocked, saving: c.saving })}
                status={t(saveStatusKey(c.blockedReason, c.dirty))}
                actions={
                  <>
                    {c.dirty ? <Button label={t("discard")} variant="ghost" icon="resend" disabled={c.saving} onClick={c.discard} /> : null}
                    <Button
                      label={t("save")}
                      variant="primary"
                      loading={c.saving}
                      loadingLabel={t("saving")}
                      disabled={!c.dirty || c.blocked}
                      onClick={() => void c.save()}
                      data-role="kit-save"
                    />
                  </>
                }
              />
            ) : null}
            {/* The writes landed; the re-read behind them did not. Not a failed save. */}
            {c.refreshFailed ? (
              <Note tone="caution" action={<Button label={t("refreshRetry")} size="sm" onClick={() => void c.retryRefresh()} />}>
                {t("refreshFailed")}
              </Note>
            ) : null}
            <HiringKitPreviews c={c} />
          </>
        )}
      </div>
    </KitSurface>
  );
}
