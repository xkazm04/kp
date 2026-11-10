"use client";

// The consent surface for one proposed act (hitl-approval; reversible-screen-ops "propose").
//
// It renders from the RESOLVED act (acts.ts) — who, what, the consequence including
// "emails the candidate" where the door does, any cost, and whether an undo exists —
// never from the conductor's words. Rendering runs nothing; only the user's press does,
// once, against an existing door (doors.ts). One primary (coral) button per card; the card
// leads with title + one consequence line + an undo/final tag, the rest behind Details. After
// the press: a result line, then Undo where a reverse door exists, otherwise a plain
// statement that it is final from here. A stale refusal says "this moved — refresh".
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Note } from "@/app/_components/kit";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { ConsoleAnchor, consoleHref } from "../panels/PanelShell";
import type { PanelProps } from "../panels/types";
import type { ProposalInstance } from "../types";
import { resolveAct, WAVE_UNDO_CAP, type ResolvedAct } from "./acts";
import { ConsentFrame, isSettled, ResultLines, type Phase } from "./ConsentFrame";
import { confirmWave, entryAct, previewWave, reverseWave, type WavePreview, type WaveResult } from "./doors";
import { InterviewConsent, LetterConsent } from "./ToolConsent";

export type ConsentCardProps = {
  proposal: ProposalInstance;
  /** The read epoch (a letter card reads the letter it agrees to). */
  epoch: number;
  /** A data act landed: re-read every view. */
  onDataChanged: () => void;
  onDismiss: () => void;
  /** Arms a follow-up act (an approved letter's "Review the send"). */
  onPropose?: PanelProps["onPropose"];
  className?: string;
};

export function ConsentCard(props: ConsentCardProps) {
  const act = resolveAct(props.proposal.act, props.proposal.params);
  // The tool acts own their reads and phases (ToolConsent.tsx); hooks stay unconditional.
  if (act.armed && (act.act === "letterApprove" || act.act === "letterSend")) return <LetterConsent {...props} act={act} />;
  if (act.armed && (act.act === "interviewBook" || act.act === "interviewLink")) return <InterviewConsent {...props} act={act} />;
  return <PipelineConsent {...props} act={act} />;
}

function PipelineConsent({ proposal, onDataChanged, onDismiss, className, act }: ConsentCardProps & { act: ResolvedAct }) {
  const t = useTranslations("one.core.consent");
  const errMsg = useErrorMessage();
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const busy = phase.at === "busy";

  // Round 3: title (act + who), ONE consequence line, a quiet tag that says whether it can
  // be undone here, the buttons — and everything else (what reaches the inbox, the offer
  // step, the cost) behind a "Details" disclosure, so the card reads in one glance.
  const frame = (title: string, line: ReactNode, footer: ReactNode, opts?: { tag?: "final" | "undo"; details?: ReactNode }) => (
    <ConsentFrame act={proposal.act} proposalId={proposal.id} phase={phase.at} className={className} title={title} line={line} footer={footer} tag={opts?.tag} details={opts?.details} />
  );

  if (!act.armed) {
    return frame(
      t("heading"),
      <p>{t("disarmed", { reason: t(`reasons.${act.reason}`) })}</p>,
      <Button label={t("notNow")} variant="ghost" onClick={onDismiss} />
    );
  }

  const outcome = (): ReactNode => {
    if (phase.at === "stale") return <Note tone="caution">{t("stale")}</Note>;
    if (phase.at === "failed") return <Note tone="critical">{errMsg(phase.payload, t("failed"))}</Note>;
    if (phase.at === "done" || phase.at === "undone") return <ResultLines lines={phase.lines} />;
    return null;
  };

  const settledFooter = (): ReactNode => {
    if (phase.at === "done") {
      return phase.undo ? (
        <Button label={t("wave.undo")} variant="secondary" onClick={() => void phase.undo?.()} />
      ) : (
        <>
          <p className="text-micro text-steel">{t("final")}</p>
          <Button label={t("notNow")} variant="ghost" onClick={onDismiss} />
        </>
      );
    }
    return <Button label={t("notNow")} variant="ghost" onClick={onDismiss} />;
  };
  const settled = isSettled(phase);

  switch (act.act) {
    case "entryAdvance":
    case "entryReject":
      return frame(
        t(`${act.act}.title`, { label: act.label ?? "" }),
        <>
          <p>{t(`${act.act}.body`, { stage: proposal.params.expectedStage })}</p>
          {outcome()}
        </>,
        settled ? settledFooter() : (
          <>
            <Button
              label={t(`${act.act}.press`)}
              variant="primary"
              loading={busy}
              loadingLabel={t("working")}
              onClick={() => void runEntry(act)}
            />
            <Button label={t("notNow")} variant="ghost" disabled={busy} onClick={onDismiss} />
          </>
        ),
        {
          tag: settled ? undefined : "final",
          details: settled ? undefined : (
            <>
              <p>{act.emails === "rejection" ? t("emails.rejection") : t("emails.nextStep")}</p>
              <p>{t("final")}</p>
              {act.role ? <p>{t("forRole", { role: act.role })}</p> : null}
            </>
          ),
        }
      );
    case "wave": {
      const title =
        act.mode === "reject"
          ? act.role
            ? t("wave.rejectTitleRole", { threshold: act.threshold, role: act.role })
            : t("wave.rejectTitle", { threshold: act.threshold })
          : t("wave.advanceTitle", { count: act.count });
      const preview = phase.at === "previewed" ? phase.preview : null;
      return frame(
        title,
        <>
          <p>{act.mode === "reject" ? t("emails.rejectionMany") : t("wave.advanceLine")}</p>
          {preview ? (
            <div data-role="one-wave-preview">
              <p>{t("wave.touches", { total: preview.total })}</p>
              {preview.rows.length > 0 ? (
                <ul className="flex flex-col gap-1 text-micro text-ink">
                  {preview.rows.slice(0, 6).map((r) => (
                    <li key={r.id}>{r.jobTitle ? `${r.label} · ${r.jobTitle}` : r.label}</li>
                  ))}
                  {preview.total > 6 ? <li>{t("wave.moreRows", { count: preview.total - 6 })}</li> : null}
                </ul>
              ) : null}
            </div>
          ) : null}
          {outcome()}
        </>,
        settled ? settledFooter() : preview ? (
          <>
            {preview.total > 0 ? (
              <Button
                label={act.mode === "reject" ? t("wave.pressReject") : t("wave.pressAdvance")}
                variant="primary"
                onClick={() => void runWave(act, preview)}
              />
            ) : null}
            <Button label={t("notNow")} variant="ghost" onClick={onDismiss} />
          </>
        ) : (
          <>
            <Button label={t("wave.preview")} variant="primary" loading={busy} loadingLabel={t("wave.previewing")} onClick={() => void runPreview(act.text)} />
            <Button label={t("notNow")} variant="ghost" disabled={busy} onClick={onDismiss} />
          </>
        ),
        {
          tag: settled ? undefined : act.mode === "reject" ? "undo" : "final",
          details:
            settled ? undefined : act.mode === "advance" ? (
              <>
                <p>{t("emails.nextStep")}</p>
                <p>{t("wave.advanceBody")}</p>
                <p>{t("wave.scope")}</p>
              </>
            ) : (
              <>
                <p>{t("wave.undoBody")}</p>
                <p>{t("wave.scope")}</p>
              </>
            ),
        }
      );
    }
    case "letterApprove":
    case "letterSend":
    case "interviewBook":
    case "interviewLink":
      // Drawn by ToolConsent (ConsentCard routes them there before this component).
      return null;
    case "companion":
      return frame(
        t(`companion.title.${act.action}`),
        <p>{t("cost")}</p>,
        <>
          <ConsoleAnchor className="k-btn k-btn--primary" href={consoleHref(act.handoff)} data-role="one-consent-handoff">
            {t("companion.press")}
          </ConsoleAnchor>
          <Button label={t("notNow")} variant="ghost" onClick={onDismiss} />
        </>,
        { details: <p>{t("companion.body")}</p> }
      );
  }

  async function runEntry(a: Extract<ResolvedAct, { act: "entryAdvance" | "entryReject" }>) {
    setPhase({ at: "busy" });
    const r = await entryAct(a.entryId, a.action, a.expectedStage);
    if (!r.ok) return setPhase(r.stale ? { at: "stale" } : { at: "failed", payload: r.payload });
    const lines = [t(`${a.act}.done`, { label: a.label ?? "" })];
    if (r.routedToHumanRound) lines.push(t("routedToHumanRound"));
    if (a.act === "entryReject" && r.commsFailed) lines.push(t("entryReject.commsFailed"));
    setPhase({ at: "done", lines, undo: null });
    onDataChanged();
  }

  async function runPreview(text: string) {
    setPhase({ at: "busy" });
    const r = await previewWave(text);
    if (!r.ok) return setPhase({ at: "failed", payload: r.payload });
    setPhase({ at: "previewed", preview: { rows: r.rows, total: r.total, matchedIds: r.matchedIds } });
  }

  async function runWave(a: Extract<ResolvedAct, { act: "wave" }>, preview: WavePreview) {
    setPhase({ at: "busy" });
    const r = await confirmWave(a.text, a.mode === "reject" ? preview.matchedIds : null);
    if (!r.ok) return setPhase({ at: "failed", payload: r.payload });
    const lines = waveLines(r);
    const canUndo = a.mode === "reject" && r.count > 0 && preview.matchedIds.length <= WAVE_UNDO_CAP;
    if (a.mode === "reject" && r.count > 0 && !canUndo) lines.push(t("wave.undoTooMany"));
    setPhase({
      at: "done",
      lines,
      undo: canUndo
        ? async () => {
            setPhase({ at: "busy" });
            const u = await reverseWave(preview.matchedIds, a.text);
            if (!u.ok) return setPhase({ at: "failed", payload: u.payload });
            const back = [t("wave.undone", { restored: u.restored })];
            if (u.notified > 0) back.push(t("wave.undoneNotified", { notified: u.notified }));
            if (u.skipped > 0) back.push(t("wave.undoneSkipped", { skipped: u.skipped }));
            setPhase({ at: "undone", lines: back });
            onDataChanged();
          }
        : null,
    });
    onDataChanged();
  }

  function waveLines(r: WaveResult): string[] {
    const lines = [t("wave.done", { count: r.count })];
    if (r.failed > 0) lines.push(t("wave.failedSome", { count: r.failed }));
    if (r.commsFailed > 0) lines.push(t("wave.commsFailed", { count: r.commsFailed }));
    if (r.heldAtOffer > 0) lines.push(t("wave.heldAtOffer", { count: r.heldAtOffer }));
    if (r.droppedOut > 0) lines.push(t("wave.droppedOut", { count: r.droppedOut }));
    return lines;
  }
}
