"use client";

import { useTranslations } from "next-intl";
import { Button, KitSurface, Note, SaveBar, Section, saveTone } from "@/app/_components/kit";
import { useHiringComposer } from "../useHiringComposer";
import { saveStatusKey } from "./hiringKitModel";
import { HiringKitHead } from "./HiringKitHead";
import { HiringKitSteps } from "./HiringKitSteps";
import { HiringKitStranded } from "./HiringKitStranded";
import { HiringKitPolicy } from "./HiringKitPolicy";
import { HiringKitActions } from "./HiringKitActions";
import { HiringKitImpact } from "./HiringKitImpact";

/**
 * Settings > Hiring, composed from the composition kit (Gate 1; rendered only behind the dev-only
 * `?kit=1` switch, see HiringKitSwitch). The same state as the current tab, read through the same
 * hook (useHiringComposer: two drafts, occupancy, the stranded mapping, save / discard / reload)
 * and edited through the same model functions. Layout is the One Measure winner's Settings > Hiring:
 * a page head with the plan's figures and the save, the presets, one section per concern (the steps,
 * who runs and signs off each one, the AI actions per step, the plan's impact), and a save bar.
 */
export default function HiringKitView() {
  const t = useTranslations("hiringPlan");
  const c = useHiringComposer();
  const ready = c.plan != null && c.axis != null;

  return (
    <KitSurface density="calm">
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
            <HiringKitSteps c={c} />
            <HiringKitStranded c={c} />
            <HiringKitPolicy c={c} />
            <HiringKitActions c={c} />
            <HiringKitImpact c={c} />
            {/* The writes landed; the re-read behind them did not. Not a failed save. */}
            {c.refreshFailed ? (
              <Note tone="caution" action={<Button label={t("refreshRetry")} size="sm" onClick={() => void c.retryRefresh()} />}>
                {t("refreshFailed")}
              </Note>
            ) : null}
            <SaveBar
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
          </>
        )}
      </div>
    </KitSurface>
  );
}
