"use client";

import { useTranslations } from "next-intl";
import type { GigAttempt } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { attemptTimeline } from "../../logic/report";
import { OutcomeMark } from "../../shared/GigsMarks";
import type { GigRecord } from "../panels/useGigRecord";
import { Pill, type Tone } from "./parts";

// Section 7, the record: every attempt and verdict as one compact timeline (the same
// derivation as the History tab, logic/report.ts attemptTimeline) - which draft, its status
// as a pill, when, what it cost ("not reported", never $0), and the verdicts it earned. The
// History tab keeps the long form: the notes that sent a draft back and the judge's words.

const TONE: Partial<Record<GigAttempt["status"], Tone>> = { failed: "coral", approved: "moss", sent: "moss", revision_requested: "amber" };

export function ReportRecord({ record, error, onOpenHistory }: { record: GigRecord | null; error: string | null; onOpenHistory: () => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  if (error) {
    return (
      <p role="alert" className="alert">
        {error}
      </p>
    );
  }
  if (!record) return <p className="panel-empty">{t("detail.loadingRecord")}</p>;
  const { rows, loose } = attemptTimeline(record.attempts, record.outcomes);
  return (
    <>
      <ol className="rp-rec">
        {rows.map(({ n, attempt: a, outcomes }) => (
          <li key={a.id}>
            <span className="rp-rec-n">{t("tabs.draftN", { n })}</span>
            <span className="rp-rec-main">
              <Pill tone={TONE[a.status] ?? "steel"}>{fmt.attemptStatus(a.status)}</Pill>
              <span className="t-meta">{fmt.dateTime(a.createdAt)}</span>
              {outcomes.map((o) => (
                <span key={o.id} className="rp-rec-v">
                  <OutcomeMark kind={o.verdict} /> {fmt.verdict(o.verdict)}
                  {o.amount !== null ? <b> {fmt.money(o.amount, o.currency)}</b> : null}
                </span>
              ))}
              {a.status === "sent" && outcomes.length === 0 ? (
                <span className="rp-rec-v">
                  <OutcomeMark kind="pending" /> {t("mark.pending")}
                </span>
              ) : null}
            </span>
            <span className={a.costUsd === null ? "rp-rec-cost absent" : "rp-rec-cost"}>{a.costUsd === null ? t("signoff.costUnreported") : fmt.usd(a.costUsd)}</span>
          </li>
        ))}
      </ol>
      {loose.length ? (
        <p className="t-meta">
          {loose.map((o) => fmt.verdict(o.verdict)).join(" · ")} · {t("report.record.loose")}
        </p>
      ) : null}
      <button type="button" className="linkbtn rp-more" onClick={onOpenHistory}>
        {t("report.record.openHistory")}
      </button>
    </>
  );
}
