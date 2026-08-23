"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { MessagesSquare } from "lucide-react";
import { ChatTranscript, type ChatSide, type ChatTurn } from "@/app/_components/chat/ChatTranscript";
import { Badge } from "@/app/_components/Badge";
import { KBD, STAT, STAT_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { CompanionTurnMeta } from "@/app/_lib/db/companion";
import { turnMeta, type CompanionRestProps, type CompanionVariantProps } from "./companionVariants";

/*
 * VARIANT B — "Desk" (console / ledger metaphor).
 *
 * The dock is an ops register, not a friendship. It opens with the studio's live
 * numbers as STAT chips — decisions / pipeline / schedule, the same counts the
 * sidebar badges carry — so the operator can read the board before asking about
 * it. The transcript runs compact, and every answer Candi gives drags a LEDGER
 * ROW behind it: which engine answered, how many memories it stood on, and a
 * loud flag when it degraded. The composer is keyboard-first, with the Enter /
 * Shift+Enter contract stated rather than discovered.
 *
 * Differs from Colleague: provenance is IN the reading path, not in the margin —
 * the premise is that an operator trusts a machine by auditing it, not by liking
 * it. Rest state is a thin edge tab: a drawer handle, minimum ink.
 */

const companionSide = (role: string): ChatSide => (role === "user" ? "right" : "left");

export function DeskRest({ onOpen, busy, unread, label }: CompanionRestProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="focus-ring fixed bottom-[calc(var(--sim-bar-h)_+_72px)] right-0 z-[var(--z-sim-drawer)] inline-flex items-center gap-1.5 rounded-l-lg border border-r-0 border-stone-200 bg-white py-3 pl-2.5 pr-2 text-steel shadow-pop transition-colors hover:border-coral/40 hover:text-ink"
    >
      <MessagesSquare size={16} aria-hidden />
      {unread || busy ? <span className="h-2 w-2 rounded-full bg-coral" /> : null}
    </button>
  );
}

export function CompanionDesk({ turns, busy, error, attention, onSend }: CompanionVariantProps) {
  const t = useTranslations("companion");
  const resolveError = useErrorMessage();
  const metaById = useMemo(() => new Map(turns.map((turn) => [turn.id, turnMeta(turn)])), [turns]);
  const chatTurns = useMemo<ChatTurn[]>(
    () => turns.map((turn) => ({ id: turn.id, role: turn.role, content: turn.content })),
    [turns]
  );
  const labels = useMemo(
    () => ({
      thinking: t("chat.thinking"),
      thinkingSlow: t("chat.thinkingSlow"),
      placeholder: t("chat.placeholderDense"),
      send: t("chat.send"),
      transcriptLabel: t("chat.transcriptLabel"),
    }),
    [t]
  );

  return (
    <>
      <div className="grid grid-cols-3 gap-1.5 pb-3">
        <StatChip label={t("desk.decisions")} value={attention?.decisions} />
        <StatChip label={t("desk.pipeline")} value={attention?.pipeline} />
        <StatChip label={t("desk.schedule")} value={attention?.schedule} />
      </div>
      {error ? <p className="pb-2 text-sm text-coral">{resolveError({ code: error }, t("chat.errorGeneric"))}</p> : null}
      <ChatTranscript
        className="min-h-0 flex-1"
        dense
        turns={chatTurns}
        side={companionSide}
        labels={labels}
        busy={busy}
        onSend={onSend}
        emptyState={<p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-ink dark:rounded-2xl">{t("greeting")}</p>}
        renderTurnExtras={(turn) => (turn.role === "assistant" ? <LedgerRow t={t} meta={metaById.get(turn.id)} /> : null)}
      />
      <p className="pt-2 text-meta text-steel">
        <kbd className={`${KBD} text-[13px]`}>{t("desk.enter")}</kbd> {t("desk.enterHint")} ·{" "}
        <kbd className={`${KBD} text-[13px]`}>{t("desk.shiftEnter")}</kbd> {t("desk.shiftEnterHint")}
      </p>
    </>
  );
}

/** A live studio number. Renders an em-dash-free placeholder while the counts
 *  are still loading — an absent count is not zero, and must not read as zero. */
function StatChip({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className={`${STAT} px-2 py-1.5`}>
      <span className={STAT_LABEL}>{label}</span>
      <span className={`${STAT_VALUE} text-h3 ${value ? "text-coral" : "text-ink"}`}>{value ?? "·"}</span>
    </div>
  );
}

/** The audit strip under one answer: which engine spoke, what it stood on, and
 *  whether it degraded. Absent metadata renders nothing rather than "unknown" —
 *  the ledger states what it knows. */
function LedgerRow({ t, meta }: { t: ReturnType<typeof useTranslations<"companion">>; meta: CompanionTurnMeta | undefined }) {
  if (!meta?.source) return null;
  const recall = meta.recallUsed?.length ?? 0;
  return (
    <div className="mt-1 flex max-w-[85%] flex-wrap items-center gap-1.5">
      <Badge
        tone={meta.source === "llm" ? "info" : "caution"}
        label={meta.source === "llm" ? t("meta.sourceLlm") : t("meta.sourceDeterministic")}
      />
      {recall > 0 ? <span className="text-meta text-steel nums">{t("meta.recallCount", { count: recall })}</span> : null}
      {meta.fallbackReason ? (
        <span className="text-meta text-coral" title={meta.fallbackReason}>
          {t("meta.fallbackFlag")}
        </span>
      ) : null}
    </div>
  );
}
