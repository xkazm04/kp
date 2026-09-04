"use client";

// The "add a receiver" flow, split into its own modal so the Email/Ads panes
// stay view-only. Split out of the old ChannelsReceivers.tsx so each file
// stays under the 200-line cap. All copy resolves through the `channels.add.*`
// catalog in four locales (channels-i18n-honesty).

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { buildTabSwitchUrl } from "@/app/features/shell/tabs";
import { Modal } from "@/app/_components/Modal";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locales";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { SearchSelect } from "@/app/_components/table/ColumnFilter";
import type { ReceiverJob } from "./useChannelsReceivers";

export function AddReceiverModal({
  title,
  channel,
  jobs,
  onClose,
  onCreated,
}: {
  title: string;
  channel: string;
  /** The tab's published-roles list, or null while its fetch is in flight / after it
   *  FAILED (ChannelsTab holds the failure at null rather than collapsing it to []).
   *  The distinction is load-bearing here: `add.noJobs` asserts "Publish a role first"
   *  — a CAUSE this modal cannot know from an empty array. An unread list rendered
   *  that sentence plus a "Go to the JD library" CTA to workspaces full of published
   *  roles. Unknown now holds the picker's height and says nothing; the tab's own
   *  error strip already carries the failure. */
  jobs: ReceiverJob[] | null;
  onClose: () => void;
  onCreated: (token: string) => void;
}) {
  const t = useTranslations("channels");
  // Mint failures resolve from the machine `code`, never the server's English `error`
  // — see app/_lib/use-error-message.ts. This modal used to `throw new Error(p.error)`
  // and render the caught message, which put the route's English prose in front of a
  // Czech, German or French recruiter.
  const errMsg = useErrorMessage();
  const router = useRouter();
  const search = useSearchParams();
  // Empty = "nothing picked yet"; the first role is the DERIVED default rather than a
  // seeded one, so a list that arrives after the modal opened still preselects.
  const [jobId, setJobId] = useState("");
  const selectedJobId = jobId || jobs?.[0]?.id || "";
  const [lang, setLang] = useState<Locale>(DEFAULT_LOCALE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (creating || !selectedJobId) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/channels/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, jobId: selectedJobId, lang }),
      });
      // The route answers `{ webhook }` (POST /api/channels/webhooks), not a bare
      // token. Reading `p.token` therefore ALWAYS yielded undefined → onCreated("")
      // → no auto-select, so adding a second receiver silently left the setup guide
      // and the CV sim pointed at the OLD one: the recruiter copied the wrong
      // endpoint for the role they had just created. Typed against the record the
      // route actually returns so tsc pins the contract from now on.
      const p = (await r.json().catch(() => null)) as { webhook?: ChannelWebhookRecord; error?: string; code?: string } | null;
      if (!r.ok || !p?.webhook) {
        setError(errMsg(p, t("add.createFailed")));
        return;
      }
      onCreated(p.webhook.token);
      onClose();
    } catch {
      // The request never completed (offline, aborted). No code, no body — the
      // localized generic is the only honest answer.
      setError(t("add.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} size="md">
      {jobs === null ? (
        // Tier 2 (docs/design/loading-choreography.md): the roles list hasn't settled,
        // or its read failed. Hold the picker's height and assert nothing.
        <div className="reveal-quiet min-h-[9rem]" aria-hidden />
      ) : jobs.length === 0 ? (
        <p className="text-sm text-steel">
          {t("add.noJobs")}{" "}
          <button
            type="button"
            onClick={() => router.push(buildTabSwitchUrl("intake", search.toString()))}
            className="focus-ring font-semibold text-coral hover:underline"
          >
            {t("add.noJobsCta")}
          </button>
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className={`mb-1 block ${META_LABEL}`}>{t("add.roleLabel")}</label>
            <SearchSelect
              value={selectedJobId}
              onChange={setJobId}
              placeholder={t("add.rolePlaceholder")}
              options={jobs.map((j) => ({ value: j.id, label: j.title }))}
            />
          </div>
          <div>
            <span className={`mb-1 block ${META_LABEL}`}>{t("add.langLabel")}</span>
            <span className="flex items-center gap-1" role="group" aria-label={t("add.langLabel")}>
              {LOCALES.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLang(loc)}
                  aria-pressed={lang === loc}
                  className={`focus-ring rounded-full border px-2.5 py-0.5 text-sm font-semibold uppercase ${
                    lang === loc ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
                  }`}
                >
                  {loc}
                </button>
              ))}
            </span>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-coral">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 border-t border-stone-100 pt-3">
            <button type="button" onClick={onClose} className={`${BTN_SECONDARY} h-9 px-4 text-sm`}>
              {t("add.cancel")}
            </button>
            <button type="button" onClick={create} disabled={creating || !selectedJobId} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
              {creating ? t("add.creating") : t("add.create")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
