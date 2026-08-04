"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { TextArea } from "@/app/_components/TextArea";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_GHOST, BTN_PRIMARY, META_LABEL } from "@/app/_components/ui/recipes";
import { FEEDBACK_EMAIL_MAX, FEEDBACK_MESSAGE_MAX } from "@/app/_lib/feedback";
import { useErrorMessage } from "@/app/_lib/use-error-message";

// The "Send feedback" dialog behind the rail affordance (NavFeedbackButton).
// One message + an optional reply email; the current route rides along so the
// operator view can see WHERE a report came from. POSTs the workspace-gated
// /api/feedback; failures resolve from the machine `code` (use-error-message).

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("feedback");
  const errMsg = useErrorMessage();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || message.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const search = searchParams.toString();
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          email: email.trim() || undefined,
          route: `${pathname}${search ? `?${search}` : ""}`,
        }),
      });
      if (!r.ok) {
        const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
        setError(errMsg(p, t("failed")));
        return;
      }
      setSent(true);
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("title")} subtitle={t("subtitle")} onClose={onClose} size="md">
      {sent ? (
        <div className="flex items-center gap-3 rounded-lg border border-moss/30 bg-moss/5 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-moss/15 text-moss">
            <Check size={18} aria-hidden />
          </span>
          <p role="status" className="text-sm font-medium text-ink">
            {t("sent")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="feedback-message" className={`${META_LABEL} block`}>
              {t("messageLabel")}
            </label>
            <TextArea
              id="feedback-message"
              autoFocus
              rows={5}
              maxLength={FEEDBACK_MESSAGE_MAX}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("messagePlaceholder")}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="feedback-email" className={`${META_LABEL} block`}>
              {t("emailLabel")}
            </label>
            <TextInput
              id="feedback-email"
              type="email"
              maxLength={FEEDBACK_EMAIL_MAX}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              className="mt-1"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm font-medium text-coral">
              {error}
            </p>
          ) : null}
        </div>
      )}
      <div className="mt-6 flex items-center justify-end gap-2">
        {sent ? (
          <button type="button" onClick={onClose} className={`${BTN_PRIMARY} h-10 px-5`}>
            {t("done")}
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className={`${BTN_GHOST} h-10 px-3`}>
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || message.trim() === ""}
              className={`${BTN_PRIMARY} h-10 px-5`}
            >
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
              {busy ? t("sending") : t("send")}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
