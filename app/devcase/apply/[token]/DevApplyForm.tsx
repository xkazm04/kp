"use client";

import { useState } from "react";
import { Check, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { TextArea } from "@/app/_components/TextArea";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_PRIMARY_LG, NOTICE } from "@/app/_components/ui/recipes";

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; duplicate: boolean; ref: string | null }
  | { kind: "error"; message: string };

// The submission form half of the dev-case apply page (W5-1). POSTs to the
// SAME public inbound webhook external channels use — ack comms, dedup and
// lifecycle resume are the route's existing behavior, not re-implemented here.
export function DevApplyForm({ token }: { token: string }) {
  const t = useTranslations("devApply");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  // The applicant's language rides the webhook so the acknowledgement the shared
  // intake sends is written in it, not in the server's default.
  const locale = useLocale();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [repoRef, setRepoRef] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  // A submitter's ONLY identity is what this form captures — a missing address
  // converts a winning evaluation into an unreachable candidate, so contact is
  // required on the PUBLIC form (the webhook stays lenient for external ATS
  // callers, which carry their own identity). Light shape check only.
  const contactValid = /\S+@\S+\.\S+/.test(contact.trim());
  const canSubmit =
    name.trim().length > 0 && repoRef.trim().length > 0 && contactValid && state.kind !== "sending" && state.kind !== "done";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setState({ kind: "sending" });
    try {
      const r = await fetch(`/api/devcase/inbound?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate: name.trim(),
          repoRef: repoRef.trim(),
          contact: contact.trim(),
          notes: notes.trim() || undefined,
          locale,
        }),
      });
      const payload = (await r.json().catch(() => null)) as
        | { error?: string; code?: string; duplicate?: boolean; reference?: string }
        | null;
      if (!r.ok) throw new Error(errMsg(payload, t("submitFailed")));
      setState({
        kind: "done",
        duplicate: Boolean(payload?.duplicate),
        // The OPAQUE reference, not the store id the response also carries for
        // external channels (devcase-reference.ts).
        ref: typeof payload?.reference === "string" ? payload.reference : null,
      });
    } catch (caught) {
      setState({ kind: "error", message: caught instanceof Error ? caught.message : t("submitFailed") });
    }
  };

  if (state.kind === "done") {
    return (
      <div role="status" className="mt-4 rounded-md border border-moss/40 bg-moss/5 p-4">
        <p className="flex items-center gap-2 font-semibold text-moss">
          <Check size={16} aria-hidden /> {t("received")}
        </p>
        <p className="mt-1 text-sm text-steel">{state.duplicate ? t("receivedDuplicate") : t("receivedNote")}</p>
        {/* A durable handle on the submission — the page is otherwise a dead end
            once the form is gone. */}
        {state.ref ? <p className="mt-2 font-mono text-micro text-steel">{t("receivedRef", { ref: state.ref })}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          {t("fieldName")} <span className="text-coral">*</span>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} required className="mt-1" />
        </label>
        <label className="block text-sm font-medium text-ink">
          {t("fieldContact")} <span className="text-coral">*</span>
          <TextInput
            type="email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            required
            placeholder={t("fieldContactPlaceholder")}
            className="mt-1"
          />
          <span className="mt-1 block text-micro font-normal text-steel">{t("fieldContactHint")}</span>
        </label>
      </div>
      <label className="block text-sm font-medium text-ink">
        {t("fieldRepo")} <span className="text-coral">*</span>
        <TextInput
          value={repoRef}
          onChange={(e) => setRepoRef(e.target.value)}
          required
          placeholder="https://github.com/you/solution"
          className="mt-1"
        />
      </label>
      <label className="block text-sm font-medium text-ink">
        {t("fieldNotes")}
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1" />
      </label>
      {state.kind === "error" ? (
        <p role="alert" className={`${NOTICE("critical")} p-3 text-sm`}>
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!canSubmit}
        className={`${BTN_PRIMARY_LG} disabled:cursor-not-allowed`}
      >
        <Send size={15} aria-hidden /> {state.kind === "sending" ? t("sending") : t("submit")}
      </button>
    </form>
  );
}
