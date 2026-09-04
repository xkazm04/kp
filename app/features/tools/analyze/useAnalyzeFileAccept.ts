"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { acceptUpload } from "@/app/_lib/upload-constraints";
import { useErrorMessage } from "@/app/_lib/use-error-message";

/**
 * The single intake gate for the Analyze workspace. Every File entry point —
 * the empty drop zone, the Replace input, the Add-variant input, and the
 * drop-anywhere overlay — calls `accept(file, commit)` instead of committing the
 * File to state itself. `accept` runs the shared `acceptUpload` check and only
 * invokes `commit` when the File clears extension + size; otherwise it surfaces
 * the inline `error`. Funnelling every path through this one hook is what makes
 * "no intake bypasses validation" a checkable contract rather than three
 * near-identical copies that can drift apart.
 *
 * The gate answers a CODE, not a sentence, so the refusal a recruiter reads here
 * is the SAME message the server's 400/413 produces and it is in their language —
 * the drop zone used to print `acceptUpload`'s hardcoded English to every locale.
 */
export function useFileAccept() {
  const t = useTranslations("analyze");
  const errMsg = useErrorMessage();
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    (file: File, commit: (file: File) => void) => {
      const result = acceptUpload(file);
      if (!result.ok) {
        setError(errMsg({ code: result.code }, t("errUploadRejected")));
        return;
      }
      setError(null);
      commit(result.file);
    },
    [errMsg, t]
  );

  // Surface an inline rejection that isn't an acceptUpload (extension/size)
  // failure — e.g. the sample-CV fetch failing, or a drop that exceeds the
  // variant cap. Routing these through the same `error` row keeps every "your
  // file didn't go in" message in one place instead of silently vanishing.
  const reject = useCallback((message: string) => setError(message), []);

  return { error, accept, reject };
}
