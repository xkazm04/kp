"use client";

// The three session-local status banners atop the Decisions queue: the
// "queued for Schedule" handoff, extended-offer secure links, and a wave's
// comms-delivery failures. Split out of DecisionsTab so its render shell
// stays under the 200-line cap.
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Copy, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { CompletionCta } from "@/app/_components/CompletionCta";
import { capNames } from "./decisionsSelectionHygiene";
import { NOTICE } from "@/app/_components/ui/recipes";

export function DecisionsBanners({
  queuedLabels,
  onDismissQueued,
  sentOffers,
  relayConfigured,
  copiedOfferId,
  onCopyOffer,
  onDismissSentOffers,
  waveCommsFailed,
  onDismissWaveComms,
}: {
  queuedLabels: string[];
  onDismissQueued: () => void;
  sentOffers: { id: string; label: string; link: string }[];
  relayConfigured: boolean | null;
  copiedOfferId: string | null;
  onCopyOffer: (id: string, link: string) => void;
  onDismissSentOffers: () => void;
  waveCommsFailed: { count: number; labels: string[] }[];
  onDismissWaveComms: () => void;
}) {
  const t = useTranslations("decisions");
  const router = useRouter();
  const search = useSearchParams();

  return (
    <>
      {/* Forward handoff (Decisions → Schedule): accepting a screening queues
          the candidate for slot-picking on Schedule with no visible trace here —
          this band says what happened and where the work continues. */}
      {queuedLabels.length > 0 ? (
        <CompletionCta
          message={t("queuedBanner", { count: queuedLabels.length, name: queuedLabels[queuedLabels.length - 1] })}
          links={[{ label: t("queuedBannerCta"), tab: "schedule" }]}
          onDismiss={onDismissQueued}
          dismissLabel={t("queuedDismiss")}
        />
      ) : null}

      {/* OO-L1-02 — extended offers keep their candidate link visible + copyable
          (the same readonly-field + copy affordance as the drawer's TokenLinkPanel),
          instead of the card fading out and the link living only in the outbox. */}
      {sentOffers.length > 0 ? (
        <section aria-live="polite" className="rounded-lg border border-moss/40 bg-moss/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Check size={14} className="text-moss" />{" "}
              {t(relayConfigured === false ? "offerSent.titleQueued" : "offerSent.title", { count: sentOffers.length })}
            </p>
            <button type="button" onClick={onDismissSentOffers} className="focus-ring text-meta font-semibold text-steel hover:text-ink">
              {t("offerSent.dismiss")}
            </button>
          </div>
          <p className="mt-0.5 text-sm text-steel">{t("offerSent.help")}</p>
          <ul className="mt-2 space-y-1.5">
            {sentOffers.map((o) => (
              <li key={o.id} className="flex items-center gap-1.5">
                <span className="w-40 shrink-0 truncate text-sm font-semibold text-ink">{o.label}</span>
                <input
                  readOnly
                  value={o.link}
                  onFocus={(ev) => ev.currentTarget.select()}
                  aria-label={t("offerSent.linkAria", { name: o.label })}
                  className="focus-ring min-w-0 flex-1 rounded-md border border-stone-200 bg-paper px-2 py-1 text-sm text-ink"
                />
                <button
                  type="button"
                  title={t("offerSent.copy")}
                  onClick={() => onCopyOffer(o.id, o.link)}
                  className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
                >
                  {copiedOfferId === o.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Direction 2b — a committed wave's comms failures stay named after the
          modal closes. Amber (a warning, not the success band): these candidates
          are out of the funnel but weren't notified, so they need a manual nudge.
          Links to Analytics, where the Decision Log holds the audited
          rejection_comms_failed trail. */}
      {waveCommsFailed.length > 0 ? (
        <section
          aria-live="polite"
          className={`flex flex-wrap items-center justify-between gap-2 ${NOTICE()} px-4 py-2.5`}
        >
          <p className="min-w-0 text-sm text-ink">
            <AlertTriangle size={14} className="-mt-0.5 mr-1 inline text-amber-700" aria-hidden />
            {t("waveComms.banner", { count: waveCommsFailed.reduce((n, g) => n + g.count, 0) })}
            {/* Grouped per committed wave; each wave's names capped with "+N more"
                so the banner can't grow unbounded across successive waves. */}
            {waveCommsFailed.map((g, i) => {
              const { shown, more } = capNames(g.labels, 5);
              if (shown.length === 0 && more === 0) return null;
              return (
                <span key={i} className="block text-amber-800">
                  {shown.join(", ")}
                  {more > 0 ? ` ${t("waveComms.more", { count: more })}` : ""}
                </span>
              );
            })}
          </p>
          <span className="flex items-center gap-3">
            {/* Direction 3 — land on Analytics with the Decision Log already
                filtered to the audited rejection_comms_failed trail (the
                deep-linkable ?kind= the log now hydrates from), not the bare tab. */}
            <button
              type="button"
              onClick={() =>
                router.push(
                  buildUrl({ tab: "analytics", ...clearedTabScopedParams(), kind: "rejection_comms_failed" }, search.toString())
                )
              }
              className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-amber-800 hover:underline"
            >
              {t("waveComms.cta")} <ArrowRight size={13} aria-hidden />
            </button>
            <button
              type="button"
              onClick={onDismissWaveComms}
              aria-label={t("queuedDismiss")}
              className="focus-ring rounded p-0.5 text-steel hover:text-ink"
            >
              <X size={14} aria-hidden />
            </button>
          </span>
        </section>
      ) : null}
    </>
  );
}
