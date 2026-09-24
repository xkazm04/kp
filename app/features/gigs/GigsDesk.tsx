"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { BTN_AFFIRM, BTN_GHOST, BTN_SECONDARY, FIELD, KBD, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { lintDraft } from "@/app/_lib/gigs/draft-lint";
import { GIG_DISCLOSURE_ITEM } from "@/app/_lib/gigs/types";
import { checklistFor, checklistKeyFor, deskGate, evidenceState, markSentGate, type AfterWrite, type QueueItem, type SourceRow, type SpecialistRow } from "./gigsLogic";
import { GigHead, UntrustedText } from "./GigsFacts";
import { DraftGalley, LintStrip } from "./GigsLint";
import { sendJson } from "./useGigsData";
import { useBareKeys } from "./useBareKeys";
import { useGigsFormat } from "./useGigsFormat";

// The review desk: one drafted attempt, read the way a careful reviewer reads it. The
// pre-send lint strip first, then the evidence the agent ran (three states - passed,
// failed, NOT VERIFIED, never two), then the draft as a numbered galley with margin
// marks beside the line each finding refers to, and beside it the arena checklist (keys
// 1-6), the disclosure sentence, the revision note and the four moves.
//
// Approve stays disabled while any blocker is open, any checklist item is unticked, or
// any warn is not marked seen - and the button SAYS which, in its label. Approving sends
// nothing: the operator sends from their own account, then marks it sent here.
//
// State is per card and local: ticking a box re-renders this desk, nothing above it, so
// the page keeps its scroll. The parent hands in a store so a half-reviewed card keeps
// its ticks when the operator steps to another item and back.

export type DeskMemory = { ticks: Record<string, boolean>; seen: string[]; note: string; startedAt: number };
export type DeskStore = Map<string, DeskMemory>;

function ReviewTimer({ startedAt }: { startedAt: number }) {
  const t = useTranslations("gigs");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <span className="font-mono text-sm text-steel nums">{t("desk.timer", { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` })}</span>;
}

export function GigsDesk({
  item,
  source,
  specialist,
  now,
  store,
  onChanged,
}: {
  item: QueueItem;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  now: Date;
  store: DeskStore;
  /** After a write: `left` = the card left the review queue; `flash` = what to say. */
  onChanged: AfterWrite;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const uid = useId().replace(/:/g, "");
  const attempt = item.attempt!;
  const gig = item.gig;
  const dl = attempt.deliverable;
  const items = checklistFor(gig.arena);

  const [memory, setMemory] = useState<DeskMemory>(() => {
    const kept = store.get(attempt.id);
    if (kept) return kept;
    return { ticks: { ...(attempt.review?.checklist ?? {}) }, seen: [], note: attempt.review?.note ?? "", startedAt: Date.now() };
  });
  useEffect(() => {
    store.set(attempt.id, memory);
  }, [store, attempt.id, memory]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [tab, setTab] = useState<"draft" | "listing">("draft");
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  const findings = useMemo(() => lintDraft({ gig, attempt, source, now }), [gig, attempt, source, now]);
  const seen = useMemo(() => new Set(memory.seen), [memory.seen]);
  const gate = deskGate(items, memory.ticks, findings, seen);
  const sendGate = markSentGate(items, memory.ticks);
  const stage = attempt.status === "approved" ? "approved" : "review";

  const toggle = useCallback((key: string) => setMemory((m) => ({ ...m, ticks: { ...m.ticks, [key]: !m.ticks[key] } })), []);
  const setSeen = useCallback(
    (id: string, value: boolean) => setMemory((m) => ({ ...m, seen: value ? [...new Set([...m.seen, id])] : m.seen.filter((x) => x !== id) })),
    []
  );

  useBareKeys((key) => {
    const k = checklistKeyFor(key, items);
    if (!k) return false;
    toggle(k);
    return true;
  });

  const jump = useCallback((anchorId: string) => {
    if (anchorId.includes("-line-")) setTab("draft");
    window.requestAnimationFrame(() => document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, []);

  const review = () => ({ checklist: memory.ticks, note: memory.note.trim() || null, reviewMs: Date.now() - memory.startedAt });

  async function act(action: "approve" | "revise" | "discard" | "mark_sent") {
    setError(null);
    setNotice(null);
    if (action === "revise" && !memory.note.trim()) {
      setError(t("desk.noteRequired"));
      noteRef.current?.focus();
      return;
    }
    setBusy(true);
    const res = await sendJson(`/api/gigs/attempts/${encodeURIComponent(attempt.id)}`, "POST", { action, review: review() });
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("desk.actionFailed")));
      // A revise whose re-dispatch failed still recorded the revision: the card moved.
      if (res.body && res.body.revisionRecorded === true) await onChanged(true);
      return;
    }
    if (action === "approve") {
      setNotice(t("desk.approvedNotice"));
      await onChanged(false);
      return;
    }
    await onChanged(true, action === "mark_sent" ? t("desk.sentFlash") : action === "revise" ? t("desk.revisedFlash") : t("desk.discardedFlash"));
  }

  const approveLabel = (() => {
    const r = gate.reason;
    if (!r) return t("desk.approveReady");
    if (r.kind === "blockers") return t("desk.approveBlocked", { count: r.count });
    if (r.kind === "checklist") return t("desk.approveChecklist", { ticked: r.ticked, total: r.total });
    return t("desk.approveUnseen", { count: r.count });
  })();

  return (
    <div>
      <GigHead
        gig={gig}
        crumbs={[t("views.queue"), t("queue.group.review"), t("desk.crumbAttempt", { gig: gig.id, attempt: attempt.id })]}
        source={source}
        specialist={specialist}
        now={now}
        extra={
          <div className="flex gap-1.5">
            <dt className="text-steel">{t("desk.drafted")}</dt>
            <dd className="text-ink">{fmt.dateTime(attempt.createdAt)}</dd>
          </div>
        }
      />
      <LintStrip findings={findings} seen={seen} onSeen={setSeen} onJump={jump} uid={uid} />

      <div className="grid 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6 px-5 py-5 2xl:border-r 2xl:border-stone-200">
          {attempt.revisionNote ? (
            <p className={`${NOTICE("info")} px-3 py-2 text-sm`}>
              <span className="font-semibold">{t("desk.earlierNote")}</span> {attempt.revisionNote}
            </p>
          ) : null}

          {!dl ? (
            <div className={`${NOTICE("critical")} px-4 py-3 text-sm`}>{t("desk.noDeliverable")}</div>
          ) : (
            <>
              <section aria-labelledby={`${uid}-ev`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id={`${uid}-ev`} className={META_LABEL}>
                    {t("desk.evidenceTitle")}
                  </h3>
                  <span className="text-sm text-steel">{t("desk.evidenceAside", { count: dl.evidence.length, confidence: fmt.percent(Math.round(dl.confidence * 100)) })}</span>
                </div>
                {dl.evidence.length === 0 ? (
                  <p className={`${NOTICE("amber")} mt-2 px-3 py-2 text-sm`}>{t("desk.noEvidence")}</p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {dl.evidence.map((ev, i) => {
                      const st = evidenceState(ev.passed);
                      return (
                        <li
                          key={i}
                          id={`${uid}-ev-${i}`}
                          className={`grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 rounded-lg border bg-paper p-3 dark:rounded-2xl ${
                            st === "failed" ? "border-coral" : st === "passed" ? "border-stone-200" : "border-dashed border-amber-600"
                          }`}
                        >
                          <EvidenceBadge state={st} />
                          <div className="min-w-0">
                            <p className={META_LABEL}>
                              {t("desk.evidenceHead", { n: i + 1, kind: t.has(`evidenceKind.${ev.kind}` as Parameters<typeof t>[0]) ? t(`evidenceKind.${ev.kind}` as Parameters<typeof t>[0]) : ev.kind })}
                              {" · "}
                              {t(`evidenceState.${st}` as Parameters<typeof t>[0])}
                            </p>
                            {ev.command ? (
                              <code className="mt-1 block whitespace-pre-wrap break-words rounded bg-stone-100 px-2 py-1 font-mono text-sm text-ink">{`$ ${ev.command}`}</code>
                            ) : (
                              <p className="mt-1 text-sm italic text-amber-700">{t("desk.noCommand")}</p>
                            )}
                            <p className="mt-1 text-sm text-ink">{ev.result}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              <section>
                <div role="tablist" aria-label={t("desk.readLabel")} className="flex gap-1 border-b border-stone-200">
                  {(["draft", "listing"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => setTab(k)}
                      className={`focus-ring -mb-px border-b-2 px-3 py-1.5 text-sm font-semibold ${tab === k ? "border-coral text-ink" : "border-transparent text-steel hover:text-ink"}`}
                    >
                      {k === "draft" ? t("desk.tabDraft") : t("desk.tabListing")}
                    </button>
                  ))}
                </div>
                <div className="pt-3" role="tabpanel">
                  {tab === "draft" ? (
                    <>
                      <p className="mb-3 text-sm text-steel">{dl.summary}</p>
                      <DraftGalley text={dl.draftText} findings={findings} seen={seen} onSeen={setSeen} uid={uid} />
                      {dl.artifacts.length > 0 ? (
                        <div className="mt-4">
                          <p className={META_LABEL}>{t("desk.artifacts")}</p>
                          <ul className="mt-1 space-y-0.5 text-sm text-ink">
                            {dl.artifacts.map((a, i) => (
                              <li key={i} className="break-words">
                                <span className="font-mono text-steel">{a.kind}</span> {a.title} <span className="text-steel">({a.ref})</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <UntrustedText gig={gig} source={source} />
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        <aside className="space-y-4 border-t border-stone-200 px-5 py-5 2xl:border-t-0" aria-label={t("desk.sideLabel")}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={META_LABEL}>{t("desk.checklistTitle", { arena: fmt.arena(gig.arena) })}</h3>
            <ReviewTimer startedAt={memory.startedAt} />
          </div>
          <div>
            <div className="h-1.5 overflow-hidden rounded-full border border-stone-200 bg-stone-100" aria-hidden>
              <div className="h-full bg-moss transition-[width] motion-reduce:transition-none" style={{ width: `${Math.round((100 * gate.ticked) / Math.max(1, gate.total))}%` }} />
            </div>
            <p className="mt-1 text-sm text-steel nums" aria-live="polite">
              {t("desk.ticked", { ticked: gate.ticked, total: gate.total })}
            </p>
          </div>
          <ul className="space-y-1">
            {items.map((k, i) => (
              <li key={k}>
                <label
                  className={`grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md border px-2 py-1.5 text-sm dark:rounded-lg ${
                    k === GIG_DISCLOSURE_ITEM ? "border-coral/50 bg-coral/5" : "border-transparent hover:bg-stone-50"
                  } ${memory.ticks[k] ? "text-steel" : "text-ink"}`}
                >
                  <input type="checkbox" checked={memory.ticks[k] === true} onChange={() => toggle(k)} className="mt-0.5 h-4 w-4 accent-moss" />
                  <span>{fmt.check(k)}</span>
                  <kbd className={`${KBD} text-xs`}>{i + 1}</kbd>
                </label>
              </li>
            ))}
          </ul>

          {dl && dl.disclosure.trim() ? (
            <figure className="rounded-lg border-2 border-ink bg-paper px-3 py-2 dark:rounded-2xl">
              <figcaption className={META_LABEL}>{t("desk.disclosureTitle")}</figcaption>
              <blockquote className="mt-1 font-serif text-base italic text-ink">{dl.disclosure}</blockquote>
            </figure>
          ) : (
            <p className={`${NOTICE("critical")} px-3 py-2 text-sm`}>{t("desk.disclosureMissing")}</p>
          )}

          {dl && dl.questions.length > 0 ? (
            <div className={`${NOTICE("amber")} px-3 py-2 text-sm`}>
              <p className="font-semibold">{t("desk.questionsTitle")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {dl.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <label htmlFor={`${uid}-note`} className="text-sm font-semibold text-ink">
              {t("desk.noteLabel", { name: specialist?.name ?? t("desk.theAgent") })}
            </label>
            <p className="text-sm text-steel">{t("desk.noteHint")}</p>
            <textarea
              id={`${uid}-note`}
              ref={noteRef}
              value={memory.note}
              onChange={(e) => setMemory((m) => ({ ...m, note: e.target.value }))}
              rows={3}
              className={`${FIELD} mt-1 w-full resize-y`}
            />
          </div>

          {error ? (
            <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className={`${NOTICE("info")} px-3 py-2 text-sm`}>
              {notice}
            </p>
          ) : null}

          {stage === "review" ? (
            <div className="grid gap-2">
              <button type="button" disabled={busy} onClick={() => act("revise")} className={`${BTN_SECONDARY} min-h-9 justify-start px-3 py-1.5 text-left text-sm`}>
                {t("desk.revise")}
              </button>
              {confirmDiscard ? (
                <div className={`${NOTICE("amber")} space-y-2 px-3 py-2 text-sm`}>
                  <p>{t("desk.discardConfirm")}</p>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => act("discard")} className={`${BTN_SECONDARY} h-8 px-3 text-sm text-coral`}>
                      {t("desk.discardYes")}
                    </button>
                    <button type="button" onClick={() => setConfirmDiscard(false)} className={`${BTN_GHOST} h-8 px-3 text-sm`}>
                      {t("desk.discardNo")}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirmDiscard(true)} className={`${BTN_SECONDARY} min-h-9 justify-start px-3 py-1.5 text-left text-sm text-coral`}>
                  {t("desk.discard")}
                </button>
              )}
              <button type="button" disabled={busy || !gate.ready} onClick={() => act("approve")} className={`${BTN_AFFIRM} min-h-10 justify-start px-3 py-2 text-left text-sm`}>
                {approveLabel}
              </button>
              {gate.ready ? (
                <p className="text-sm text-steel">{t("desk.approveNote")}</p>
              ) : (
                <div className="text-sm text-steel">
                  <p>{t("desk.stillNeeded")}</p>
                  <ul className="list-disc pl-5">
                    {gate.blockers > 0 ? <li>{t("desk.needBlockers", { count: gate.blockers })}</li> : null}
                    {gate.total - gate.ticked > 0 ? <li>{t("desk.needChecklist", { count: gate.total - gate.ticked })}</li> : null}
                    {gate.unseenWarns > 0 ? <li>{t("desk.needSeen", { count: gate.unseenWarns })}</li> : null}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <div className={`${NOTICE("info")} px-3 py-2 text-sm`}>
                <p className="font-semibold">{t("desk.approvedTitle")}</p>
                <p className="mt-1">{t("desk.approvedBody", { host: source?.host ?? t("desk.theSource") })}</p>
                <a href={gig.url} target="_blank" rel="noopener noreferrer" className="focus-ring mt-1 inline-flex items-center gap-1 font-semibold text-coral hover:underline">
                  {t("desk.openListing")} <ExternalLink size={13} aria-hidden />
                </a>
              </div>
              <button type="button" disabled={busy || !sendGate.ready} onClick={() => act("mark_sent")} className={`${BTN_AFFIRM} min-h-10 justify-start px-3 py-2 text-left text-sm`}>
                {sendGate.ready ? t("desk.markSentReady") : t("desk.markSentLocked", { ticked: sendGate.ticked, total: sendGate.total })}
              </button>
              <button type="button" disabled={busy} onClick={() => act("revise")} className={`${BTN_SECONDARY} min-h-9 justify-start px-3 py-1.5 text-left text-sm`}>
                {t("desk.revise")}
              </button>
            </div>
          )}

          <p className="text-sm text-steel nums">
            {attempt.costUsd === null ? t("desk.costUnreported") : t("desk.cost", { cost: fmt.usd(attempt.costUsd) })}
            {specialist ? ` · ${t("desk.budget", { budget: fmt.usd(specialist.spec.budgetUsdPerAttempt) })}` : null}
          </p>
        </aside>
      </div>
    </div>
  );
}

function EvidenceBadge({ state }: { state: "passed" | "failed" | "unverified" }) {
  // Three shapes: a filled disc with a tick, a filled square with a cross, a dashed
  // ring with a question mark - "not verified" is never painted as a failure.
  if (state === "passed") {
    return (
      <span aria-hidden className="mt-0.5 inline-grid h-6 w-6 place-items-center rounded-full bg-moss text-paper">
        <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" focusable="false">
          <path d="M2.5 6.5l2.2 2.2L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span aria-hidden className="mt-0.5 inline-grid h-6 w-6 place-items-center rounded-sm bg-coral text-white">
        <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" focusable="false">
          <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span aria-hidden className="mt-0.5 inline-grid h-6 w-6 place-items-center rounded-full border-2 border-dashed border-amber-600 text-amber-700">
      <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" focusable="false">
        <path d="M4.3 4.4a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3M6 9.2v.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
