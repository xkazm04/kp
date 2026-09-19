"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { JdRow } from "./jdsLibrary";

const ICON_BTN =
  "focus-ring inline-grid h-8 w-8 place-items-center rounded-md text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-40";

// The per-row delete action for a JD that is NOT live, shown only to the person
// who created the description or to an admin — `row.canDelete` is the SERVER's
// answer to that question (GET /api/jds folds it per row) and the caller pairs it
// with the liveness check. Hiding the icon is the courtesy; DELETE /api/jds/[slug]
// re-checks both conditions and is the actual gate.
//
// Sibling of RowIngest, and deliberately the same shape: icon button, the resolved
// reason in the tooltip AND an assertive live region, because a table row has no
// room for a sentence. The one difference is the confirm — a delete is the only
// irreversible action in this ledger, so it stacks a themed Modal (the design
// tokens cannot reach a native window.confirm, and the Modal stack already handles
// Escape/Tab per dialog).
export function RowDelete({ row, reload }: { row: JdRow; reload: () => void }) {
  const t = useTranslations("library.tab");
  const errMsg = useErrorMessage();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // `null` = nothing has failed yet. A FAILURE is an object, so "failed with no
  // code the catalog knows" (an offline fetch, an unrecognized code) is still a
  // failure the row reports, rather than collapsing into the success state.
  const [failure, setFailure] = useState<{ code: string | null } | null>(null);

  async function run() {
    setConfirming(false);
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(`/api/jds/${encodeURIComponent(row.slug)}`, { method: "DELETE" });
      if (!res.ok) {
        // The reader never sees the server's English `error` string: the route
        // answers with a machine code (JD_LIVE_CANNOT_DELETE, JD_DELETE_FORBIDDEN,
        // JD_DELETE_FAILED) and useErrorMessage resolves it in their language.
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setFailure({ code: body.code ?? null });
        return;
      }
      // Reload rather than splicing the row out locally: the ledger's footer count
      // and the status facets are derived from the fetched page, and a local splice
      // would leave both claiming a library that no longer exists.
      reload();
    } catch {
      // Offline / aborted fetch — no code to resolve, so the generic fallback below
      // is what the reader gets. Swallowed on purpose: a failed delete is reported
      // in the row, never thrown into the table's render.
      setFailure({ code: null });
    } finally {
      setBusy(false);
    }
  }

  const reason = failure ? errMsg(failure, t("deleteJdFailed")) : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        className={`${ICON_BTN} ${reason ? "text-coral" : ""}`}
        title={reason ?? t("deleteJd")}
        aria-label={t("deleteJdAria", { title: row.title })}
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Trash2 size={15} aria-hidden />}
      </button>
      {reason ? (
        <span role="alert" className="sr-only">
          {reason}
        </span>
      ) : null}
      {confirming ? (
        <Modal
          title={t("deleteConfirmTitle")}
          onClose={() => setConfirming(false)}
          size="md"
          footer={
            <>
              <button type="button" onClick={() => setConfirming(false)} className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm`}>
                {t("deleteCancel")}
              </button>
              <button type="button" onClick={() => void run()} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
                {t("deleteConfirm")}
              </button>
            </>
          }
        >
          <p className="text-base text-steel">{t("deleteConfirmBody", { title: row.title })}</p>
        </Modal>
      ) : null}
    </>
  );
}
