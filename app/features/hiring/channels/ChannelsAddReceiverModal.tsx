"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels namespace on a later i18n pass. */

// The "add a receiver" flow, split into its own modal so the Email/Ads panes
// stay view-only. Split out of the old ChannelsReceivers.tsx so each file
// stays under the 200-line cap.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildTabSwitchUrl } from "@/app/features/shell/tabs";
import { Modal } from "@/app/_components/Modal";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locales";
import { SearchSelect } from "./ChannelsFilters";
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
  jobs: ReceiverJob[];
  onClose: () => void;
  onCreated: (token: string) => void;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [lang, setLang] = useState<Locale>(DEFAULT_LOCALE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (creating || !jobId) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/channels/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, jobId, lang }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      onCreated(typeof p.token === "string" ? p.token : "");
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't create it — try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} size="md">
      {jobs.length === 0 ? (
        <p className="text-sm text-steel">
          Publish a role first — each receiver binds to one job.{" "}
          <button
            type="button"
            onClick={() => router.push(buildTabSwitchUrl("library", search.toString()))}
            className="focus-ring font-semibold text-coral hover:underline"
          >
            Go to the JD library
          </button>
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className={`mb-1 block ${META_LABEL}`}>Role</label>
            <SearchSelect value={jobId} onChange={setJobId} placeholder="Select a role…" options={jobs.map((j) => ({ value: j.id, label: j.title }))} />
          </div>
          <div>
            <span className={`mb-1 block ${META_LABEL}`}>Candidate language</span>
            <span className="flex items-center gap-1" role="group" aria-label="Candidate language">
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
              Cancel
            </button>
            <button type="button" onClick={create} disabled={creating || !jobId} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
