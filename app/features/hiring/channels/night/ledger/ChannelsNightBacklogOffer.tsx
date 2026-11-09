"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Mark } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { BacklogLetter, BacklogOffer, BacklogResult } from "@/app/_lib/comms-backlog";
import { tallyBacklogResults } from "./backlogOfferModel";

async function fetchOffer(): Promise<BacklogLetter[]> {
  try {
    const r = await fetch("/api/comms/backlog", { cache: "no-store" });
    if (!r.ok) return [];
    const offer = (await r.json()) as BacklogOffer;
    return offer.relayReady ? offer.letters : [];
  } catch {
    return []; // best-effort: no offer is shown when the read fails; the ledger below is unaffected
  }
}

/**
 * "N letters waited for a sender": the offer the post book makes once a relay delivers and the
 * workspace still holds letters recorded while none existed (docs/features/comms/README.md,
 * "The letters that waited"). It is an OFFER and nothing else: opening the list reads, and only
 * the one Send press posts. Each letter can be cleared first (one the owner already sent from
 * their own mailbox leaves no mark in the record, so this is where it is taken out). The answer
 * is said per outcome in the delivery vocabulary, and a letter a gate stopped is named with its
 * reason, never folded into a count. Renders nothing when there is nothing to offer.
 */
export function ChannelsNightBacklogOffer({ relayConfigured, onSent }: { relayConfigured: boolean; onSent: () => void }) {
  const t = useTranslations("channelsNight.ledger.backlog");
  const { dateTime } = useDateFormat();
  const [offered, setLetters] = useState<BacklogLetter[]>([]);
  // With no relay the offer is empty by definition; derived, so a stale read never shows.
  const letters = relayConfigured ? offered : [];
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [answer, setAnswer] = useState<{ results: BacklogResult[]; by: ReadonlyMap<string, BacklogLetter> } | "refused" | null>(null);

  useEffect(() => {
    if (!relayConfigured) return;
    let live = true;
    void fetchOffer().then((l) => {
      if (live) setLetters(l);
    });
    return () => {
      live = false;
    };
  }, [relayConfigured]);

  const picked = letters.filter((l) => !cleared.has(l.id));
  const send = async () => {
    if (sending || picked.length === 0) return;
    const by = new Map(letters.map((l) => [l.id, l] as const));
    setSending(true);
    setAnswer(null);
    try {
      const r = await fetch("/api/comms/backlog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: picked.map((l) => l.id) }),
      });
      const body = (await r.json().catch(() => null)) as { results?: BacklogResult[] } | null;
      if (!r.ok || !body?.results) setAnswer("refused");
      else setAnswer({ results: body.results, by });
    } catch {
      setAnswer("refused");
    } finally {
      setSending(false);
      setCleared(new Set());
      setLetters(await fetchOffer());
      onSent();
    }
  };

  const toggle = (id: string) =>
    setCleared((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (letters.length === 0 && answer === null) return null;
  const em = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const tally = answer && answer !== "refused" ? tallyBacklogResults(answer.results) : null;

  return (
    <div className="cn-ledger__alarm cn-ledger__backlog" data-tone="warn" role="status">
      <span className="cn-ledger__alarm-mark" aria-hidden="true"><Mark kind="wait" /></span>
      <div className="cn-ledger__alarm-body">
        {letters.length > 0 ? (
          <>
            <p className="cn-ledger__alarm-title">{t.rich("title", { count: letters.length, em })}</p>
            <p>{t("detail")}</p>
          </>
        ) : null}
        {open && letters.length > 0 ? (
          <>
            <ul className="cn-ledger__backlog-list" aria-label={t("listLabel")}>
              {letters.map((l) => (
                <li key={l.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!cleared.has(l.id)}
                      disabled={sending}
                      onChange={() => toggle(l.id)}
                      aria-label={t("pick", { recipient: l.recipient, subject: l.subject })}
                    />
                    <span className="cn-ledger__backlog-who">{l.recipient}</span>
                    <span>{l.subject}</span>
                    <span className="cn-ledger__backlog-when">{t("recorded", { when: dateTime(l.recordedAt) })}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p>{t("handHelp")}</p>
            {picked.length === 0 ? <p>{t("nonePicked")}</p> : null}
          </>
        ) : null}
        {answer === "refused" ? <p role="alert">{t("result.refused")}</p> : null}
        {tally ? (
          <div className="cn-ledger__backlog-answer">
            {tally.sent > 0 ? <p>{t("result.sent", { count: tally.sent })}</p> : null}
            {tally.failed > 0 ? <p>{t("result.failed", { count: tally.failed })}</p> : null}
            {tally.queued > 0 ? <p>{t("result.queued", { count: tally.queued })}</p> : null}
            {tally.skipped.length > 0 && answer && answer !== "refused" ? (
              <>
                <p>{t("result.skipped", { count: tally.skipped.length })}</p>
                <ul className="cn-ledger__backlog-list">
                  {tally.skipped.map((s) => (
                    <li key={s.id}>
                      <span className="cn-ledger__backlog-who">{answer.by.get(s.id)?.recipient ?? ""}</span>
                      <span>{t(`skip.${s.reason}`)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {letters.length > 0 ? (
        <div className="cn-ledger__backlog-acts">
          {open ? (
            <>
              <Button
                variant="primary"
                label={sending ? t("sending") : t("send", { count: picked.length })}
                disabled={sending || picked.length === 0}
                onClick={() => void send()}
              />
              <Button variant="ghost" label={t("close")} disabled={sending} onClick={() => setOpen(false)} />
            </>
          ) : (
            <Button variant="ghost" label={t("review")} onClick={() => setOpen(true)} />
          )}
        </div>
      ) : null}
    </div>
  );
}
