"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowRight, Check, FileText, FlaskConical, Loader2, Upload, X } from "lucide-react";
import { buildUrl } from "@/app/features/shell/tabs";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { TextInput } from "@/app/_components/TextInput";

// Simulate a real application ARRIVING WITH A CV on this channel — the loop the plain
// "receive a test application" button can't show. Upload a PDF/DOCX/TXT/MD; the server
// parses it with the real extractor, builds a matchable candidate, and lands them at
// Accepted on the receiver's role. Same composite the real inbound receiver uses, so
// this exercises the actual parse → candidate → pipeline path, not a mock.
// Copy resolves through `channels.cvSim.*` (channels-i18n-honesty).

const ACCEPT = ".pdf,.docx,.txt,.md";

type SimResult = {
  ok?: boolean;
  candidateLabel?: string;
  archetype?: string | null;
  degraded?: boolean;
  jobTitle?: string;
  error?: string;
  code?: string;
};

export function CvSimCard({
  jobId,
  jobTitle,
  channel,
  onDone,
}: {
  jobId: string;
  jobTitle: string;
  channel: string;
  onDone?: () => void;
}) {
  const t = useTranslations("channels");
  // Failures read from the machine `code`, not the server's English `error`
  // (app/_lib/use-error-message.ts).
  const errMsg = useErrorMessage();
  const reduced = useReducedMotion();
  const router = useRouter();
  const search = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
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
        onDone?.();
      }
    } catch {
      // The upload never completed. The thrown Error's message is English network
      // prose (and, on a parse failure, internal detail) — the localized sentence is
      // the only honest thing to paint here.
      setResult({ error: t("cvSim.requestFailed") });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring inline-flex items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/40 px-3 py-2 text-sm font-semibold text-ink hover:border-coral/50 hover:text-coral"
      >
        <FlaskConical size={15} aria-hidden /> {t("cvSim.open")}
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-stone-300 bg-paper/40 p-3">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <FlaskConical size={15} className="text-coral" aria-hidden /> {t("cvSim.title")}{" "}
          <span className="text-coral">{jobTitle}</span>
        </p>
        <button type="button" onClick={() => setOpen(false)} aria-label={t("cvSim.close")} className="focus-ring rounded-md p-1 text-steel hover:text-ink">
          <X size={15} />
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setResult(null);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm hover:border-coral/40"
      >
        {file ? <FileText size={15} className="text-moss" aria-hidden /> : <Upload size={15} className="text-steel" aria-hidden />}
        <span className={file ? "truncate text-ink" : "text-steel"}>{file ? file.name : t("cvSim.choose")}</span>
      </button>

      <div className="flex flex-wrap gap-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t("cvSim.namePlaceholder")} sizeVariant="sm" className="min-w-0 flex-1" />
        <TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("cvSim.emailPlaceholder")} sizeVariant="sm" className="min-w-0 flex-1" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={!file || busy} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ArrowRight size={15} aria-hidden />}
          {busy ? t("cvSim.running") : t("cvSim.run")}
        </button>
        <p className="text-xs text-steel">{t("cvSim.hint")}</p>
      </div>

      <AnimatePresence>
        {result ? (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.16, ease: "easeOut" }}
            className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              result.error ? "border-coral/30 bg-coral/10 text-ink" : "border-moss/30 bg-moss/10 text-ink"
            }`}
          >
            {result.error ? (
              <span className="inline-flex items-center gap-1.5">
                <AlertCircle size={14} className="text-coral" aria-hidden /> {t("cvSim.failed", { reason: result.error })}
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <Check size={14} className="text-moss" aria-hidden />
                  {t.rich("cvSim.landed", {
                    name: result.candidateLabel ?? "",
                    role: result.jobTitle ?? "",
                    // A thin CV lands a STUB, not a matchable candidate — the suffix says
                    // which of the two actually happened rather than implying the good case.
                    suffix: result.degraded ? t("cvSim.stub") : result.archetype ? ` · ${result.archetype}` : "",
                    b: (chunks) => <b>{chunks}</b>,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))}
                  className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline"
                >
                  {t("cvSim.openInPipeline")} <ArrowRight size={13} aria-hidden />
                </button>
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
