"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { TextInput } from "@/app/_components/TextInput";
// Registry-free intake module (not the apply.ts barrel), keeping the candidate
// bundle lean — same import discipline as ConversationalApply.
import { APPLY_EMAIL_RE, isRetryableApplyStatus } from "@/app/_lib/apply-intake";
import { useErrorMessage } from "@/app/_lib/use-error-message";

type KoStep = { id: string; prompt: string };

// DOM id of a knockout group's first control (its Yes button) — the focus/scroll
// target when that gate is what's blocking the submit. One place so the render
// and the "jump to the first unanswered control" lookup can't drift.
const koControlId = (stepId: string) => `qa-ko-${stepId}`;

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
  relayConfigured = false,
}: {
  jobId: string;
  koSteps: KoStep[];
  campaign?: string;
  variant?: string;
  /** REC-10 — is a real delivery relay wired (server-read, passed by the page)?
   *  Gates the "we'll email you" promises: without a relay no email ever leaves,
   *  so the copy points at the durable status link instead. */
  relayConfigured?: boolean;
}) {
  const t = useTranslations("apply");
  const tCommon = useTranslations("common");
  const errMsg = useErrorMessage();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ko, setKo] = useState<Record<string, boolean>>({});
  const [emailError, setEmailError] = useState<string | null>(null);
  // The "you haven't finished yet" cue, raised only by an actual submit attempt
  // (never pre-emptively) — see `firstMissingControlId` below.
  const [incompleteError, setIncompleteError] = useState<string | null>(null);
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
    // The durable status-tracking token (capst-l1-002) — the same one the ack
    // email carries, so the lead can check where they stand after the tab closes.
    statusToken?: string;
  } | null>(null);

  // Honeypot: a field a real applicant never sees (off-screen + aria-hidden +
  // tabIndex -1 + autocomplete off), but a form-filling bot populates. When it comes
  // back non-empty the server silently drops the submission. Deliberately NOT
  // type="hidden" (bots routinely skip those) — a real input pulled out of the visual
  // and accessibility trees, so humans and screen readers never encounter it.
  const [companyUrl, setCompanyUrl] = useState("");

  // The FIRST control still standing between the candidate and a submit, as a DOM
  // id, in visual order — or null when the form is complete. The submit button no
  // longer renders `disabled` on an incomplete form: a dead grey button on a
  // paid-traffic mobile form is a silent leak (nothing names the blocking field,
  // and a disabled control isn't even focusable to hint at one). Instead the tap
  // is accepted and answered — an inline alert plus a jump to this control.
  // The server contract is unchanged: a missing KO answer would still be declined
  // server-side (absent ⇒ fail), which is exactly why we never let it be POSTed.
  const firstMissingControlId = (): string | null => {
    if (!name.trim()) return "qa-name";
    if (!email.trim()) return "qa-email";
    const unanswered = koSteps.find((s) => ko[s.id] === undefined);
    return unanswered ? koControlId(unanswered.id) : null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    // Incomplete: say so, and take the candidate straight to the field that's
    // blocking them (focus for keyboard/SR users, scroll for everyone else —
    // the KO gates can sit below the fold on a phone).
    const missing = firstMissingControlId();
    if (missing) {
      setIncompleteError(t("quick.incompleteHint"));
      const el = document.getElementById(missing);
      el?.focus();
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setIncompleteError(null);
    // Same regex the server enforces — catch the typo here so the candidate
    // fixes it in place instead of bouncing off a 400.
    if (!APPLY_EMAIL_RE.test(email.trim())) {
      setEmailError(t("invalidEmail"));
      const el = document.getElementById("qa-email");
      el?.focus();
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setEmailError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/apply/${jobId}/quick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: { name: name.trim(), email: email.trim(), ...ko }, campaign, variant, company_url: companyUrl }),
      });
      const d = await res.json();
      if (res.ok) {
        setSubmitError(null);
        setDone({
          result: d.result,
          message: d.message,
          duplicate: Boolean(d.duplicate),
          leadToken: typeof d.leadToken === "string" ? d.leadToken : undefined,
          statusToken: typeof d.statusToken === "string" ? d.statusToken : undefined,
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
          {/* capst-l1-002 — the durable status link, mirroring the conversational
              done screen: the lead's one way to see where they stand once this
              tab is gone (and, with no relay, their ONLY touchpoint at all). */}
          {done.result === "accepted" && done.statusToken ? (
            <a
              href={`/status/${done.statusToken}`}
              className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:border-coral/50"
            >
              {t("trackStatus")}
            </a>
          ) : null}
        </div>
        <AiDisclosure className="mt-6" showDataConsent />
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {/* Honeypot — must stay empty. Off-screen + removed from the a11y + tab order so
          only an indiscriminate form-filling bot reaches it. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="qa-company-url">{t("quick.honeypotLabel")}</label>
        <input
          id="qa-company-url"
          type="text"
          name="company_url"
          tabIndex={-1}
          autoComplete="off"
          value={companyUrl}
          onChange={(e) => setCompanyUrl(e.target.value)}
        />
      </div>
      <div className="space-y-4">
        <div>
          <label htmlFor="qa-name" className="text-sm font-semibold text-ink">
            {t("quick.nameLabel")}
          </label>
          <TextInput
            id="qa-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (incompleteError) setIncompleteError(null);
            }}
            placeholder={t("script.namePlaceholder")}
            autoComplete="name"
            disabled={submitting}
            className="mt-1 h-12"
          />
        </div>
        <div>
          <label htmlFor="qa-email" className="text-sm font-semibold text-ink">
            {t("quick.emailLabel")}
          </label>
          <TextInput
            id="qa-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
              if (incompleteError) setIncompleteError(null);
            }}
            placeholder={t("script.emailPlaceholder")}
            autoComplete="email"
            disabled={submitting}
            invalid={Boolean(emailError)}
            className="mt-1 h-12"
          />
          {emailError ? (
            <p role="alert" className="mt-1 text-sm text-coral">
              {emailError}
            </p>
          ) : (
            // "We'll send you a confirmation" only when a relay can actually
            // send one; otherwise the honest purpose — identity + follow-up.
            <p className="mt-1 text-sm text-steel">{t(relayConfigured ? "quick.emailHint" : "quick.emailHintNoRelay")}</p>
          )}
        </div>
        {koSteps.map((step) => (
          <fieldset key={step.id}>
            <legend className="text-base text-ink">{step.prompt}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([true, false] as const).map((value) => (
                <button
                  key={String(value)}
                  // Only the first (Yes) control carries the id — it's the group's
                  // focus target when this gate is the one blocking submit.
                  id={value ? koControlId(step.id) : undefined}
                  type="button"
                  disabled={submitting}
                  aria-pressed={ko[step.id] === value}
                  onClick={() => {
                    setKo((k) => ({ ...k, [step.id]: value }));
                    if (incompleteError) setIncompleteError(null);
                  }}
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
      {/* Raised only by an attempted submit on an incomplete form (never
          pre-emptively), alongside the focus/scroll jump — the cue the dead
          disabled button never gave. */}
      {incompleteError ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral/40 bg-coral/5 p-3 text-base text-coral">
          {incompleteError}
        </p>
      ) : null}

      <button
        type="submit"
        // Disabled ONLY while a POST is in flight. An incomplete form still
        // submits — and gets told what's missing (see `submit`).
        disabled={submitting}
        className="focus-ring mt-5 h-12 w-full rounded-md bg-ink text-base font-semibold text-white hover:bg-steel disabled:opacity-50"
      >
        {submitting ? t("sending") : t("quick.submit")}
      </button>

      <AiDisclosure className="mt-6" />
    </form>
  );
}
