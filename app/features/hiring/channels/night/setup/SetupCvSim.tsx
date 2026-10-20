"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, TextField } from "@/app/_components/kit";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { buildUrl } from "@/app/features/shell/tabs";
import { SetupResult } from "./SetupBits";

const ACCEPT = ".pdf,.docx,.txt,.md";

type SimResult = { ok?: boolean; candidateLabel?: string; archetype?: string | null; degraded?: boolean; jobTitle?: string; code?: string };

/**
 * Test this receiver's role with a real CV (the retired ChannelsKitCvSim's logic, unchanged): a
 * PDF / DOCX / TXT / MD and an optional name / email go to /api/sim/apply-cv with the receiver's
 * role and channel; the real extractor parses it and lands a matchable candidate at Accepted (a thin
 * CV lands a STUB, and the result says so). On success every live view re-reads and "Open in
 * pipeline" goes to the board. A failure reads the machine `code`, never the server's prose.
 */
export function SetupCvSim({ jobId, channel, onDone }: { jobId: string; channel: string; onDone: () => void }) {
  const t = useTranslations("channels");
  const errMsg = useErrorMessage();
  const router = useRouter();
  const search = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(SimResult & { failure?: string }) | null>(null);

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
        setResult({ failure: errMsg(data, t("cvSim.failedStatus", { status: res.status })) });
      } else {
        setResult(data);
        notifyDataChanged();
        onDone();
      }
    } catch {
      setResult({ failure: t("cvSim.requestFailed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cns-panel">
      <p className="cns-help">{t("cvSim.hint")}</p>
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
      <div className="cns-row">
        <Button label={file ? file.name : t("cvSim.choose")} icon={file ? "check" : "plus"} size="sm" onClick={() => inputRef.current?.click()} />
        <TextField label={t("cvSim.namePlaceholder")} placeholder={t("cvSim.namePlaceholder")} value={name} onChange={setName} size="sm" />
        <TextField label={t("cvSim.emailPlaceholder")} placeholder={t("cvSim.emailPlaceholder")} value={email} onChange={setEmail} size="sm" />
        <Button label={t("cvSim.run")} loadingLabel={t("cvSim.running")} loading={busy} disabled={!file} variant="primary" size="sm" onClick={run} />
      </div>
      {result?.failure ? (
        <SetupResult ok={false}>{t("cvSim.failed", { reason: result.failure })}</SetupResult>
      ) : result ? (
        <SetupResult ok>
          {t.rich("cvSim.landed", {
            name: result.candidateLabel ?? "",
            role: result.jobTitle ?? "",
            // A thin CV lands a STUB, not a matchable candidate: the suffix says which happened.
            suffix: result.degraded ? t("cvSim.stub") : result.archetype ? ` · ${result.archetype}` : "",
            b: (c) => <b>{c}</b>,
          })}{" "}
          <Button label={t("cvSim.openInPipeline")} variant="link" size="sm" icon="right" onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))} />
        </SetupResult>
      ) : null}
    </div>
  );
}
