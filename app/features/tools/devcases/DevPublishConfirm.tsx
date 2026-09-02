"use client";

// The confirm-before-publish dialog, lifted out of DevCaseDetailHeader into its own
// component for ONE reason: a11y wiring has to mount and unmount WITH the dialog.
//
// It shipped as `role="alertdialog"` and nothing else — no focus moved into it, Escape
// did nothing, and Tab walked straight out into the page behind. An alertdialog that
// does none of those things is a div wearing a role, and it guards the most
// irreversible action on this surface: publishing mints a live candidate-facing apply
// link and sources real people into the pipeline.
//
// It does NOT use the shared `Modal`. Modal portals to document.body, scrims the page
// and locks scroll — this confirm is deliberately an inline panel that appears under
// the header it belongs to, with the assignment still readable beneath it, and turning
// it into a centered overlay would be a UX change smuggled in behind a bug fix. What
// it needs is the BEHAVIOUR, and that is `useDialogA11y` — the hook Modal itself is
// built on, and the same one the side drawers use for exactly this reason. Passing
// `lockScroll: false` keeps the page scrollable; `trap: true` is kept because the
// choice really is modal: the panel that publishes must not be tabbed past.
import { useRef } from "react";
import { AlertTriangle, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import type { DegradedReason } from "./DevCaseDetail.publish";

export function DevPublishConfirm({
  publishing,
  degraded,
  publishReasons,
  ackDegraded,
  setAckDegraded,
  canPublishNow,
  confirmPublish,
  cancelPublish,
}: {
  publishing?: boolean;
  degraded: boolean;
  publishReasons: DegradedReason[];
  ackDegraded: boolean;
  setAckDegraded: (v: boolean) => void;
  canPublishNow: boolean;
  confirmPublish: () => void;
  cancelPublish: () => void;
}) {
  const t = useTranslations("devcase.studio.detail");
  const tReason = useTranslations("devcase.studio.degradedReason");
  const ref = useRef<HTMLDivElement | null>(null);
  // Escape closes; focus moves to the first control inside on open and returns to the
  // Publish trigger on unmount. The trigger must therefore still be enabled while this
  // is open (it is `aria-expanded` instead) — `previouslyFocused?.focus?.()` is a
  // silent no-op on a disabled button, which is how the keyboard user used to be
  // dropped back onto <body>.
  useDialogA11y(ref, cancelPublish, { trap: true, lockScroll: false });
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-label={t("confirmLabel")}
      tabIndex={-1}
      className="rounded-lg border border-coral/30 bg-coral/5 p-4"
    >
      <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-coral">
        <Send size={12} /> {t("confirmTitle")}
      </h3>
      <p className="mt-2 max-w-prose text-sm text-steel">{t("confirmBody")}</p>
      {degraded ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-meta font-semibold text-amber-700">
            <AlertTriangle size={13} /> {t("degradedTitle")}
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-amber-800">
            {publishReasons.map((r) => (
              <li key={r}>{tReason(r)}</li>
            ))}
          </ul>
          <label className="mt-2 flex items-start gap-2 text-xs font-medium text-amber-900">
            <input
              type="checkbox"
              checked={ackDegraded}
              onChange={(e) => setAckDegraded(e.target.checked)}
              className="mt-0.5"
            />
            {t("degradedAck")}
          </label>
        </div>
      ) : null}
      <div className="mt-3 flex gap-1.5">
        {/* Source order IS focus order: useDialogA11y focuses the first control inside.
            On a healthy assignment that is this button, the primary action. On a
            degraded one the acknowledgement checkbox comes first in the markup and
            therefore takes focus — which is the correct first step there, since the
            button is disabled until it is ticked. */}
        <button
          type="button"
          onClick={confirmPublish}
          disabled={!canPublishNow || publishing}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-coral px-3 text-micro font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
        >
          <Send size={12} /> {publishing ? t("publishing") : t("confirmCta")}
        </button>
        <button
          type="button"
          onClick={cancelPublish}
          className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 bg-white px-3 text-micro font-semibold text-steel hover:text-ink"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
