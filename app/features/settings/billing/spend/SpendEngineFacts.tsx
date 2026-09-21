"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { buildTabSwitchUrl, navLabel, type WorkspaceTabId } from "@/app/features/shell/tabs";
import type { SpendOps } from "./useSpendData";

// Engine context as INLINE FACTS, not a card: which engines can serve, whether
// the automation clock is alive, what the queue is doing, and the three failure
// counters that explain a suspiciously cheap week.
//
// The old System card wrapped all of this in its own bordered panel, which is
// what made nesting it inside the usage panel look like a bug. Stripped to a
// line of dots and a line of counters, it reads as a footnote to the spend
// above it — which is what it is.
//
// The three failure counters render ONLY when non-zero. A spend reader is not
// triaging the scheduler, so three permanent zeroes are noise — but this is the
// only screen in the app that carries `reconcileFailures` and `noSlotStalls` at
// all (dead letters also surface per-message in the Channels ledger), so hiding
// them unconditionally would delete an alarm rather than quiet it. Silent when
// healthy, loud when not — and, since each one has a surface that carries the
// same failures per-item, LOUD now means a door rather than a dead end.

// Engine proper nouns: constants, not JSX text, because they are product names
// that never translate (docs/i18n/glossary.md — Do-Not-Translate). Their STATE
// therefore cannot ride the noun, and is rendered as a separate translated word
// beside it: "Gemini available" / "Gemini unavailable".
const ENGINE_GEMINI = "Gemini";
const ENGINE_CLAUDE_CLI = "Claude CLI";

type AlarmKey = "deadLetters" | "reconcileFailures" | "bookedStalls";

// Where each counter's failures are listed one by one. Dead letters are per-message
// rows in the Channels ledger (ChannelsCommsTable); BOTH schedule counters set a flag
// on the invite that the Schedule tab's attention section renders — `needs_reconcile`
// for a confirmed booking whose pipeline advance threw, `needs_more_slots` for a
// candidate who hit a fully-booked horizon (ScheduleInviteAttentionSection.tsx). So
// all three have a real destination; none is linked to a page that would only shrug.
const ALARM_TAB: Record<AlarmKey, WorkspaceTabId> = {
  deadLetters: "channels",
  reconcileFailures: "schedule",
  bookedStalls: "schedule",
};
// English source labels for the destination, used only as the has()-fallback the
// whole app applies to nav labels (tabs.ts navLabel).
const ALARM_TAB_LABEL: Record<AlarmKey, string> = {
  deadLetters: "Channels",
  reconcileFailures: "Schedule",
  bookedStalls: "Schedule",
};

/**
 * One dot and the label that says what the dot means.
 *
 * The dot stays `aria-hidden` because it is a REDUNDANT encoding: every caller
 * passes children that name the state in words. It used to be the only encoding
 * — green-or-red, explained in a `title` — which is invisible to touch and to
 * most screen-reader flows, so a reader heard a list of nouns with no status at
 * all. The `title` survives where it carries something the label does not (an
 * env var name, a binary on PATH), never as the sole home of the state.
 */
function Fact({ on, title, children }: { on: boolean; title?: string; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5" title={title}>
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${on ? "bg-moss" : "bg-coral"}`} />
      {children}
    </li>
  );
}

export function SpendEngineFacts({ ops }: { ops: SpendOps }) {
  const t = useTranslations("models.system");
  const tNav = useTranslations("nav");
  const nav = useShellNavigate();
  // The REACT-tracked search string, never window.location — see the note on
  // buildTabSwitchUrl in shell/tabs.ts.
  const query = useSearchParams().toString();
  const engineState = (available: boolean) => (available ? t("engineAvailable") : t("engineUnavailable"));
  const alarms = [
    ops.comms.deadLetters7d > 0 ? { key: "deadLetters" as const, count: ops.comms.deadLetters7d, tone: "text-coral" } : null,
    ops.schedule.reconcileFailures > 0
      ? { key: "reconcileFailures" as const, count: ops.schedule.reconcileFailures, tone: "text-coral" }
      : null,
    ops.schedule.noSlotStalls > 0
      ? { key: "bookedStalls" as const, count: ops.schedule.noSlotStalls, tone: "text-amber-700" }
      : null,
  ].filter((a): a is { key: AlarmKey; count: number; tone: string } => a !== null);
  return (
    <div className="space-y-2">
      {/* A list, not a row of spans: it stays one compact wrapped line visually, but a
          screen reader now gets the item boundaries the commas in a sighted read supply. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink">
        <Fact on={ops.ok}>{ops.ok ? t("healthy") : t("degraded")}</Fact>
        <Fact on={ops.seeds === "ok"}>{ops.seeds === "ok" ? t("seedsOk") : t("seedsFailed")}</Fact>
        <Fact on={ops.clock === "healthy"} title={t("clockTitle")}>
          {ops.clock === "healthy" ? t("scheduler") : ops.clock === "starting" ? t("schedulerStarting") : t("schedulerStalled")}
        </Fact>
        {/* These two titles name an ENV VAR and a binary on PATH, not copy —
            translating them would make the preflight hint wrong. They are a hint
            about WHERE the state comes from; the state itself is beside the noun. */}
        <Fact on={ops.engines.gemini} title="GEMINI_API_KEY / GOOGLE_API_KEY configured">
          <span>{ENGINE_GEMINI}</span>
          <span className="text-steel">{engineState(ops.engines.gemini)}</span>
        </Fact>
        <Fact on={ops.engines.claudeCli} title="claude CLI resolves on PATH">
          <span>{ENGINE_CLAUDE_CLI}</span>
          <span className="text-steel">{engineState(ops.engines.claudeCli)}</span>
        </Fact>
        <li className="text-steel">{t("queue", { running: ops.queue.running, queued: ops.queue.queued })}</li>
        {/* An empty catalog is the ordinary opening state of an install, so it is a
            neutral fact next to the queue — no dot, no amber, no verdict. The routes
            stopped calling it a degradation (app/api/ops/route.ts); this is where it
            says what it actually is. */}
        {ops.catalog === "empty" ? <li className="text-steel">{t("catalogEmpty")}</li> : null}
      </ul>

      {ops.degradedReasons.length > 0 ? (
        <ul className="space-y-0.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {/* `degradedReasons` are canonical English server diagnostics with no
              code to resolve (docs/architecture/localization.md). */}
          {ops.degradedReasons.map((r) => (
            <li key={r} className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {r}
            </li>
          ))}
        </ul>
      ) : null}

      {alarms.length > 0 ? (
        <div role="status" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {alarms.map((alarm) => {
            const tab = ALARM_TAB[alarm.key];
            const destination = navLabel(tNav, `tabs.${tab}`, ALARM_TAB_LABEL[alarm.key]);
            const open = t("alarmOpen", { tab: destination });
            return (
              <button
                key={alarm.key}
                type="button"
                // In-shell, not a document load: patching `?tab=` onto the history
                // stack costs none of the RSC round-trip a same-route query change
                // never needed (shell/nav/shallow-nav.ts).
                onClick={() => nav.push(buildTabSwitchUrl(tab, query))}
                title={open}
                className={`focus-ring inline-flex items-center gap-1 rounded-sm font-semibold hover:underline ${alarm.tone}`}
              >
                {t(alarm.key, { count: alarm.count })}
                <ArrowUpRight size={13} aria-hidden />
                {/* The count is the button's name; this says where the name leads,
                    so the destination is not carried by the arrow glyph alone. */}
                <span className="sr-only">{open}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
