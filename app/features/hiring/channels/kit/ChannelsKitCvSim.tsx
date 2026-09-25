"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Mark, Note, Section, TextField } from "@/app/_components/kit";
import { buildUrl } from "@/app/features/shell/tabs";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { useErrorMessage } from "@/app/_lib/use-error-message";

const ACCEPT = ".pdf,.docx,.txt,.md";

type SimResult = { ok?: boolean; candidateLabel?: string; archetype?: string | null; degraded?: boolean; jobTitle?: string; error?: string; code?: string };

/**
 * The CV simulator, on the kit (the retired ChannelsCvSimCard's logic, unchanged): upload a
 * PDF / DOCX / TXT / MD for this receiver's role and POST it to /api/sim/apply-cv, which parses it
 * with the real extractor, builds a matchable candidate and lands them at Accepted, the same
 * composite the inbound receiver uses. A thin CV lands a STUB and the result says so. On success
 * every live view re-reads (notifyDataChanged) and "Open in pipeline" goes to the candidate.
 * Failures read the machine `code` (useErrorMessage), never the server's English `error`.
 */
export function ChannelsKitCvSim({ jobId, channel, onDone }: { jobId: string; channel: string; onDone: () => void }) {
  const t = useTranslations("channels");
  const errMsg = useErrorMessage();
  const router = useRouter();
  const search = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("jobId", jobId);
      fd.append("channel", channel);
      if (name.trim()) fd.append("name", name.trim());
      if (email.trim()) fd.append("email", email.trim());
      const res = await fetch("/api/sim/apply-cv", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as SimResult;
      if (!res.ok || !data.ok) {
        setResult({ error: errMsg(data, t("cvSim.failedStatus", { status: res.status })) });
      } else {
        setResult(data);
        notifyDataChanged();
        onDone();
      }
    } catch {
      // The upload never completed; the thrown message is English network prose.
      setResult({ error: t("cvSim.requestFailed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t("cvSim.open")} state={t("cvSim.hint")}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setResult(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-2 py-2">
        <Button label={file ? file.name : t("cvSim.choose")} icon={file ? "check" : "plus"} size="sm" onClick={() => inputRef.current?.click()} />
        <TextField label={t("cvSim.namePlaceholder")} placeholder={t("cvSim.namePlaceholder")} value={name} onChange={setName} size="sm" />
        <TextField label={t("cvSim.emailPlaceholder")} placeholder={t("cvSim.emailPlaceholder")} value={email} onChange={setEmail} size="sm" />
        <Button label={t("cvSim.run")} loadingLabel={t("cvSim.running")} loading={busy} disabled={!file} variant="primary" size="sm" onClick={run} />
      </div>
      {/* A caution Note is role=status itself; the landed line announces the same way. */}
      {result?.error ? (
        <Note tone="caution">{t("cvSim.failed", { reason: result.error })}</Note>
      ) : result ? (
        <div className="k-verdict" role="status">
          <Mark kind="ok" />
          <div>
            {t.rich("cvSim.landed", {
              name: result.candidateLabel ?? "",
              role: result.jobTitle ?? "",
              // A thin CV lands a STUB, not a matchable candidate: the suffix says which happened.
              suffix: result.degraded ? t("cvSim.stub") : result.archetype ? ` · ${result.archetype}` : "",
              b: (c) => <b>{c}</b>,
            })}{" "}
            <Button label={t("cvSim.openInPipeline")} variant="link" size="sm" icon="right" onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))} />
          </div>
        </div>
      ) : null}
    </Section>
  );
}
