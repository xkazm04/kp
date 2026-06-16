"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
// Registry-free intake module (not the apply.ts barrel), keeping the candidate
// bundle lean — same import discipline as ConversationalApply.
import { APPLY_EMAIL_RE, isRetryableApplyStatus } from "@/app/_lib/apply-intake";
import { useErrorMessage } from "@/app/_lib/use-error-message";

type KoStep = { id: string; prompt: string };

// E2 — the one-screen lead form. Everything fits a phone held in a break room:
// two inputs, the job's knockout questions as big yes/no toggles, one submit.
// Unlike the conversational flow there is no step machine — the form keeps its
// state on any failure, so every error is recoverable by editing + resubmitting
// (isRetryableApplyStatus only tunes the message framing, never discards input).
// `campaign`/`variant` are E5 attribution read from the ad link by the server
// page — forwarded verbatim with the POST, never shown to the candidate.
export function QuickApplyForm({
  jobId,
  koSteps,
  campaign = "",
  variant = "",
}: {
  jobId: string;
  koSteps: KoStep[];
  campaign?: string;
  variant?: string;
}) {
  const t = useTranslations("apply");
  const tCommon = useTranslations("common");
  const errMsg = useErrorMessage();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ko, setKo] = useState<Record<string, boolean>>({});
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    result: "accepted" | "declined";
    message: string;
    duplicate?: boolean;
    // The entry's opaque lead token (from the accept response) — carried on the
    // enrichment CTA so the full apply opens knowing this lead, exactly like the
    // link in the acknowledgement email.
    leadToken?: string;
  } | null>(null);

  // Submit unlocks only when every field is answered — a lead with a missing
  // KO answer would just be declined server-side (missing ⇒ fail), which reads
  // as a rejection the candidate never earned.
  const allKoAnswered = koSteps.every((s) => ko[s.id] !== undefined);
  const ready = Boolean(name.trim()) && Boolean(email.trim()) && allKoAnswered && !submitting;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    // Same regex the server enforces — catch the typo here so the candidate
    // fixes it in place instead of bouncing off a 400.
    if (!APPLY_EMAIL_RE.test(email.trim())) {
      setEmailError(t("invalidEmail"));
      return;
    }
    setEmailError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/apply/${jobId}/quick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: { name: name.trim(), email: email.trim(), ...ko }, campaign, variant }),
      });
      const d = await res.json();
      if (res.ok) {
        setSubmitError(null);
        setDone({
          result: d.result,
          message: d.message,
          duplicate: Boolean(d.duplicate),
          leadToken: typeof d.leadToken === "string" ? d.leadToken : undefined,
        });
      } else {
        // The form retains every answer, so both failure classes recover the
        // same way (edit if needed, tap again); a transient one says so.
        setSubmitError(isRetryableApplyStatus(res.status) ? t("submitFailed") : errMsg(d, t("submitFailed")));
      }
    } catch {
      setSubmitError(t("networkFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    const fresh = done.result === "accepted" && !done.duplicate;
    return (
      <div aria-live="polite">
        <div className={`rounded-lg border p-4 ${fresh ? "border-moss/40 bg-moss/5" : "border-stone-200 bg-paper"}`}>
          <p className={`font-serif text-h3 ${fresh ? "text-moss" : "text-ink"}`}>
            {done.result === "accepted" ? (done.duplicate ? t("alreadyApplied") : t("youreIn")) : t("thanksApplying")}
          </p>
          <p className="mt-1 text-base text-steel">{done.message}</p>
          {fresh ? (
            // The enrichment hand-off: same loop the acknowledgement email
            // offers, available right here while the candidate is still present.
            // The ?lead= token opens the chat already knowing them — no
            // re-typing name/email, no re-answering the gates they just passed.
            <div className="mt-4">
              <a
                href={`/apply/${jobId}${done.leadToken ? `?lead=${encodeURIComponent(done.leadToken)}` : ""}`}
                className="focus-ring block rounded-md bg-ink px-4 py-3 text-center text-base font-semibold text-white hover:bg-steel"
              >
                {t("quick.enrichCta")}
              </a>
              <p className="mt-1.5 text-sm text-steel">{t("quick.enrichNote")}</p>
            </div>
          ) : null}
        </div>
        <AiDisclosure className="mt-6" />
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="space-y-4">
        <div>
          <label htmlFor="qa-name" className="text-sm font-semibold text-ink">
            {t("quick.nameLabel")}
          </label>
          <input
            id="qa-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("script.namePlaceholder")}
            autoComplete="name"
            disabled={submitting}
            className="focus-ring mt-1 h-12 w-full rounded-md border border-stone-200 px-3 text-base disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="qa-email" className="text-sm font-semibold text-ink">
            {t("quick.emailLabel")}
          </label>
          <input
            id="qa-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
            }}
            placeholder={t("script.emailPlaceholder")}
            autoComplete="email"
            disabled={submitting}
            aria-invalid={emailError ? true : undefined}
            className="focus-ring mt-1 h-12 w-full rounded-md border border-stone-200 px-3 text-base disabled:opacity-50"
          />
          {emailError ? (
            <p role="alert" className="mt-1 text-sm text-coral">
              {emailError}
            </p>
          ) : (
            <p className="mt-1 text-sm text-steel">{t("quick.emailHint")}</p>
          )}
        </div>
        {koSteps.map((step) => (
          <fieldset key={step.id}>
            <legend className="text-base text-ink">{step.prompt}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([true, false] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  disabled={submitting}
                  aria-pressed={ko[step.id] === value}
                  onClick={() => setKo((k) => ({ ...k, [step.id]: value }))}
                  className={`focus-ring h-12 rounded-md border text-base font-semibold disabled:opacity-50 ${
                    ko[step.id] === value
                      ? "border-ink bg-ink text-white"
                      : "border-stone-200 bg-white text-ink hover:border-coral/50"
                  }`}
                >
                  {value ? tCommon("yes") : tCommon("no")}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {submitError ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral/40 bg-coral/5 p-3 text-base text-coral">
          {submitError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!ready}
        className="focus-ring mt-5 h-12 w-full rounded-md bg-ink text-base font-semibold text-white hover:bg-steel disabled:opacity-50"
      >
        {submitting ? t("sending") : t("quick.submit")}
      </button>

      <AiDisclosure className="mt-6" />
    </form>
  );
}
