"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels namespace on a later i18n pass. */

// The icon-pill section switcher of ChannelsTab: each channel carries its own
// accent + live status. Split out of ChannelsTab.tsx to keep the tab file
// under the 200-line cap.

import type { BadgeTone } from "@/app/_components/Badge";
import { CHANNEL_SECTIONS, type ChannelSectionId } from "./channelsSections";
import { CHANNEL_ACCENT } from "./channelsAccent";

export function ChannelsTabSwitcher({
  section,
  setSection,
  statusFor,
}: {
  section: ChannelSectionId;
  setSection: (id: ChannelSectionId) => void;
  statusFor: (id: ChannelSectionId, channel?: string) => { tone: BadgeTone; label: string } | null | "pending";
}) {
  return (
    <div role="tablist" aria-label="Integration" className="flex flex-wrap gap-2">
      {CHANNEL_SECTIONS.map((s) => {
        const selected = s.id === section;
        const acc = CHANNEL_ACCENT[s.id];
        const st = statusFor(s.id, s.channel);
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setSection(s.id)}
            className={`focus-ring flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-all ${
              selected ? `${acc.border} ${acc.soft} shadow-pop` : "border-stone-200 bg-white hover:border-stone-300"
            }`}
          >
            <span
              className={`inline-grid h-8 w-8 place-items-center rounded-lg border ${selected ? acc.border : "border-stone-200"} ${selected ? "bg-white" : "bg-paper"}`}
            >
              <s.icon size={16} className={selected ? acc.text : "text-steel"} aria-hidden />
            </span>
            <span className="text-left">
              <span className={`block text-sm font-semibold ${selected ? "text-ink" : "text-steel"}`}>{s.label}</span>
              {st === "pending" ? (
                // Status source hasn't settled yet — hold the line's height, say
                // nothing (never guess "Off"/"Nothing published" ahead of data).
                <span className="reveal-quiet block h-4 w-14 rounded bg-stone-100" aria-hidden />
              ) : st ? (
                <span className="flex items-center gap-1 text-xs text-steel">
                  <span className={`h-1.5 w-1.5 rounded-full ${st.tone === "positive" ? "bg-moss" : "bg-stone-300"}`} aria-hidden />
                  {st.label}
                </span>
              ) : (
                <span className="block text-xs text-steel">Ledger</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
