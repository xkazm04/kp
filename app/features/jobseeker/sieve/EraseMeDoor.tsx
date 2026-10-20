"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/app/_components/ConfirmDialog";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { SV_LINK_BTN } from "./sieveRecipes";

// "Delete everything about me" — the seeker's own erasure door (DELETE
// /api/jobseeker/profile; db/jobseeker-profiles.ts eraseJobseekerData). Deliberately
// QUIET: an underlined line in the Sieve's footer, never a button competing with the
// flow, and one deliberate second step (ConfirmDialog) that names what goes and what
// stays before anything is deleted.
//
// After the server has erased, this browser forgets too: every `kp-me-*` key in
// localStorage (the CV design, the studio column widths, auto-speak) and sessionStorage
// (cover-note drafts, the draft-source note, the studio composer drafts, the CV
// "flight" marks) is removed by PREFIX, so a key added later is covered without this
// file having to learn its name. Then /me reloads onto its empty first-run state.

const STORAGE_PREFIX = "kp-me-";

function forgetThisBrowser(): void {
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
      }
      for (const key of keys) store.removeItem(key);
    } catch {
      /* storage refused (private mode, blocked site data): the server record is gone,
         and a browser that could not store anything has nothing of it to forget */
    }
  }
}

export function EraseMeDoor() {
  const t = useTranslations("me.erase");
  const resolveError = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function erase() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/jobseeker/profile", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "erase" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorPayload | null;
        setError(resolveError(body, t("failed")));
        setWorking(false);
        return;
      }
      forgetThisBrowser();
      // A HARD load, not router.push: the Sieve holds the erased profile and postings in
      // client state, and only a fresh document drops every copy of them.
      window.location.replace("/me");
    } catch {
      /* transport failure: said to the reader below, the dialog stays open to retry */
      setError(t("failed"));
      setWorking(false);
    }
  }

  return (
    <>
      <button type="button" className={SV_LINK_BTN} onClick={() => setOpen(true)}>
        {t("open")}
      </button>
      {open ? (
        <ConfirmDialog
          title={t("title")}
          confirmLabel={working ? t("working") : t("confirm")}
          cancelLabel={t("cancel")}
          confirmDisabled={working}
          onCancel={() => {
            if (working) return;
            setOpen(false);
            setError(null);
          }}
          onConfirm={() => void erase()}
        >
          {t("body")}
          {error ? (
            <strong role="alert" className="mt-3 block font-semibold text-ink">
              {error}
            </strong>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
