"use client";

/*
 * The transparency ledger, closed by default.
 *
 * Agent prose is not the UI: the stage carries the status line, the live card
 * and the phase panels, and everything else — narration, and every `notice` the
 * host wrote when its own policy settled something — goes here. That is the
 * whole point of the drawer: a fact the operator is ENTITLED to but must not be
 * interrupted by.
 *
 * The unread badge counts anything appended while it is shut, notices included.
 * A notice the operator never saw a count for is a policy decision made in
 * silence, which is the thing notices exist to prevent.
 *
 * The one exception rides on the stage instead: `unrequested-run` means the
 * asking contract slipped for a command, and that is not a drawer fact.
 */

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { PANEL } from "@/app/_components/ui/recipes";
import { Prose } from "./StudioBits";
import { COPY, NOTICE_LABEL } from "./copy";
import type { ActivityEntry } from "./useWizardSession";

export function ActivityDrawer({
  entries,
  unread,
  open,
  onToggle,
}: {
  entries: ActivityEntry[];
  unread: number;
  open: boolean;
  onToggle: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <section className={`${PANEL} overflow-hidden`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="focus-ring flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-base font-semibold text-ink">{COPY.activityTitle}</span>
        {unread > 0 && !open ? (
          <span className="rounded-full bg-coral px-2 py-0.5 text-sm font-semibold text-white">{unread}</span>
        ) : null}
        <span className="flex-1" />
        <ChevronDown
          size={16}
          aria-hidden
          className={`text-steel transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
            className="overflow-hidden border-t border-stone-200"
          >
            <div className="max-h-72 space-y-2 overflow-y-auto px-4 py-3">
              {entries.length === 0 ? (
                <p className="text-sm text-steel">{COPY.activityEmpty}</p>
              ) : (
                entries.map((entry) =>
                  entry.kind === "notice" ? (
                    <p key={entry.seq} className="flex flex-wrap gap-x-2 text-sm">
                      <span
                        className={`font-semibold ${
                          entry.noticeKind === "unrequested-run" ? "text-amber-700" : "text-steel"
                        }`}
                      >
                        {NOTICE_LABEL[entry.noticeKind ?? "other"]}
                      </span>
                      <span className="min-w-0 flex-1 text-steel">{entry.text}</span>
                    </p>
                  ) : (
                    <p key={entry.seq} className="whitespace-pre-line text-sm text-steel">
                      {entry.kind === "you" ? <span className="font-semibold text-ink">{COPY.activityYou}</span> : null}
                      <Prose text={entry.text} />
                    </p>
                  ),
                )
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
