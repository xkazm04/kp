"use client";

// W6-2 — what this candidate actually received (full letters, not just the
// event line), with failed sends visible at the source. Split out of
// PipelineCandidateDrawer.tsx.

import { AlertTriangle, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { labelize } from "@/app/_lib/format";
import { isUnaddressable } from "@/app/_lib/comms-view";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { useRelativeTime } from "./PipelineShared";
import type { CandidateComm } from "@/app/_lib/candidate-timeline";

// failure-truth-everywhere: the bundle carries the DERIVED delivery verdict
// (server-side, from the same comms-view derivation the Comms Center reads) instead
// of only the raw `status` column — which is why a bounced offer used to render a
// green "sent" here while Channels showed it red.
//
// drawer-comms-truth: the SAME rule now applies to the neighbouring `deliverable`
// bit, which the bundle also carried and this list used to drop — so an
// unaddressable message read as a neutral "queued" here while Channels warned. The
// predicate (isUnaddressable) and the wording (channels.comms.noAddressHint) are
// BORROWED from the Comms Center rather than re-invented; a genuinely queued message
// with a real address is untouched and still reads neutral.
export function PipelineCommsList({ comms }: { comms: CandidateComm[] }) {
  const t = useTranslations("pipeline.drawer");
  // The Comms Center's own string for this warning — one vocabulary, two surfaces.
  const tChannels = useTranslations("channels.comms");
  const enumLabel = useEnumLabel();
  const relativeTime = useRelativeTime();
  // Same capability bit ChannelsCommsTable passes down: null (unknown) never warns.
  const relayConfigured = useDeliveryCapability();
  if (comms.length === 0) return null;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Mail size={13} /> {t("messages", { count: comms.length })}
      </p>
      <ul className="mt-2 space-y-1">
        {comms.map((m) => {
          const adverse = m.verdict === "failed" || m.verdict === "bounced";
          const unaddressable = isUnaddressable(m, relayConfigured);
          return (
            <li key={m.id} className={`rounded-md border px-2.5 py-1 ${adverse ? "border-red-200 bg-red-50/50" : "border-stone-100 bg-paper/40"}`}>
              <details>
                <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-meta font-semibold uppercase text-steel">
                    {enumLabel("commKind", m.kind)}
                  </span>
                  <span
                    className={`text-meta font-semibold uppercase ${
                      adverse ? "text-red-700" : m.verdict === "sent" || m.verdict === "recovered" ? "text-moss" : "text-steel"
                    }`}
                  >
                    {t(`commsVerdict.${m.verdict}`)}
                  </span>
                  {/* The Comms Center's exact warning — same glyph, same amber, same
                      sentence — so a recruiter never has to cross-check two screens
                      to learn a relay could not address this person. */}
                  {unaddressable ? (
                    <span title={tChannels("noAddressHint")} className="inline-flex items-center text-amber-600">
                      <AlertTriangle size={12} aria-hidden />
                      <span className="sr-only">{tChannels("noAddressHint")}</span>
                    </span>
                  ) : null}
                  {/* `channel` was fetched-but-unread payload: RENDERED, because which
                      transport carried a letter is the first thing a recruiter asks
                      when chasing a failure (it is a column in the Comms Center too). */}
                  {m.channel ? <span className="text-meta text-steel">{labelize(m.channel)}</span> : null}
                  <span className="ml-auto text-meta text-steel">{relativeTime(m.createdAt)}</span>
                </summary>
                <div className="mt-1 border-t border-stone-100 pt-1 text-sm">
                  {/* WHY, not just that it went wrong — the same reasons the Comms
                      Center shows, so a recruiter never has to cross-check two screens. */}
                  {/* `bouncedAt` / `recoveredAt` were fetched-but-unread payload:
                      RENDERED, appended to the line each one dates via the SAME
                      localized relative-time helper the row header uses — WHEN a send
                      turned bad (or was healed) is the fact that tells a recruiter
                      whether it is still worth chasing. No new copy: pure composition. */}
                  {m.verdict === "bounced" ? (
                    <p className="text-meta text-red-700">
                      {t("commsBounceLine", { detail: m.bounceDetail ?? t("commsReasonUnknown") })}
                      {m.bouncedAt ? ` · ${relativeTime(m.bouncedAt)}` : ""}
                    </p>
                  ) : null}
                  {m.verdict === "failed" ? (
                    <p className="text-meta text-red-700">{t("commsFailureLine", { detail: m.failureDetail ?? t("commsReasonUnknown") })}</p>
                  ) : null}
                  {m.verdict === "recovered" ? (
                    <p className="text-meta text-moss">
                      {t("commsRecoveredLine")}
                      {m.recoveredAt ? ` · ${relativeTime(m.recoveredAt)}` : ""}
                    </p>
                  ) : null}
                  {m.subject ? <p className="font-semibold text-ink">{m.subject}</p> : null}
                  {m.body ? <pre className="mt-0.5 whitespace-pre-wrap font-sans text-sm leading-5 text-steel">{m.body}</pre> : null}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
