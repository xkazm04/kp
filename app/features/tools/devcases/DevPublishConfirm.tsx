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
//
// THREE VARIANTS, one dialog (challenge-r09 devcase-lifecycle/B): publish, reopen (the
// same publish on a case whose intake is closed - it mints a FRESH link and the old one
// stays closed, which is exactly what the recruiter must be told before sharing), and
// stop (closes every open apply link; nobody is emailed). The a11y wiring above is the
// reason they share one component rather than three copies of it.
import { useRef } from "react";
import { AlertTriangle, CircleStop, RotateCcw, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import type { DegradedReason } from "./DevCaseDetail.publish";

export type IntakeConfirmVariant = "publish" | "reopen" | "stop";

export function DevPublishConfirm({
  variant = "publish",
  publishing,
  degraded,
  publishReasons,
  ackDegraded,
  setAckDegraded,
  canPublishNow,
  confirmPublish,
  cancelPublish,
  error = null,
}: {
  variant?: IntakeConfirmVariant;
  /** true while this variant's request is in flight (publish/reopen or stop). */
  publishing?: boolean;
  degraded: boolean;
  publishReasons: DegradedReason[];
  ackDegraded: boolean;
  setAckDegraded: (v: boolean) => void;
  canPublishNow: boolean;
  confirmPublish: () => void;
  cancelPublish: () => void;
  /** The last attempt's failure, already in the reader's language (stop only). */
  error?: string | null;
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
  const Icon = variant === "stop" ? CircleStop : variant === "reopen" ? RotateCcw : Send;
  const title = variant === "stop" ? t("stopTitle") : variant === "reopen" ? t("reopenTitle") : t("confirmTitle");
  const body = variant === "stop" ? t("stopBody") : variant === "reopen" ? t("reopenBody") : t("confirmBody");
  const cta = variant === "stop" ? t("stopCta") : variant === "reopen" ? t("reopenCta") : t("confirmCta");
  const busy = variant === "stop" ? t("stopping") : t("publishing");
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-label={variant === "publish" ? t("confirmLabel") : title}
      tabIndex={-1}
      className="rounded-lg border border-coral/30 bg-coral/5 p-4"
    >
      <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-coral">
        <Icon size={12} /> {title}
      </h3>
      <p className="mt-2 max-w-prose text-sm text-steel">{body}</p>
      {degraded && variant !== "stop" ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-meta font-semibold text-amber-700">
            <AlertTriangle size={13} /> {t("degradedTitle")}
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-micro text-amber-800">
            {publishReasons.map((r) => (
              <li key={r}>{tReason(r)}</li>
            ))}
          </ul>
          <label className="mt-2 flex items-start gap-2 text-micro font-medium text-amber-900">
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
          <Icon size={12} /> {publishing ? busy : cta}
        </button>
        <button
          type="button"
          onClick={cancelPublish}
          className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 bg-white px-3 text-micro font-semibold text-steel hover:text-ink"
        >
          {t("cancel")}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-micro text-coral">
          {error}
        </p>
      ) : null}
    </div>
  );
}
