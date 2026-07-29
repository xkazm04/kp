// CV-variant intake (add/replace/remove), split out of useAnalyzeForm.ts. Self-
// contained: owns its own cvFiles state, the content-hash dedupe, and the
// serialized-queue guard against two near-simultaneous drops of the same file
// both passing a stale dedupe check.
import { useCallback, useRef, useState } from "react";
import { isDuplicateCvVariant } from "@/app/_lib/cv-variant";
import { MAX_CV_VARIANTS } from "./AnalyzeTypes";

export function useAnalyzeCvFiles() {
  const [cvFiles, setCvFiles] = useState<File[]>([]);
  // Latest cvFiles + a promise chain — back the serialized, race-free CV intake (addCvFile).
  const cvFilesRef = useRef<File[]>(cvFiles);
  const addCvSeqRef = useRef<Promise<unknown>>(Promise.resolve());

  // Mirror cvFiles into a ref so the serialized intake below sees pending appends across
  // its async hash await. addCvFileInner also advances it synchronously on append so a
  // queued add sees the prior add before the next render lands. The caller (useAnalyzeForm)
  // keeps cvFilesRef in sync post-commit via its own effect reading `cvFiles`.
  const syncRef = useCallback((files: File[]) => {
    cvFilesRef.current = files;
  }, []);

  function addCvFile(file: File): Promise<void> {
    // Serialize intake: two near-simultaneous drops of the SAME file would otherwise both
    // dedupe-check against the same stale snapshot and both append (the functional setState
    // guards only the count cap, not content identity). Chaining each add means the second
    // sees the first's append (via cvFilesRef, advanced synchronously on append).
    const run = addCvSeqRef.current.then(() => addCvFileInner(file));
    addCvSeqRef.current = run.catch(() => {});
    return run;
  }

  async function addCvFileInner(file: File): Promise<void> {
    const current = cvFilesRef.current;
    if (current.length >= MAX_CV_VARIANTS) return;
    // Same-variant identity is by CONTENT, via the one cvVariantHash helper that
    // the server intake (collectCvFiles) also uses, so the two sides can't
    // disagree on what a duplicate is. The old rule here — name && size match —
    // silently merged two different CVs that shared a filename and byte length;
    // content hashing only merges true byte-for-byte clones.
    let duplicate = false;
    try {
      duplicate = await isDuplicateCvVariant(file, current);
    } catch {
      // Hashing needs crypto.subtle (a secure context). If it's unavailable we
      // must not silently drop the file — add it and let the server, which can
      // always hash, be the authoritative dedupe.
      duplicate = false;
    }
    if (duplicate) return;
    const merged = [...cvFilesRef.current, file];
    if (merged.length > MAX_CV_VARIANTS) return;
    cvFilesRef.current = merged; // advance synchronously so the next queued add sees it
    setCvFiles(merged);
  }

  function replaceCvFile(index: number, file: File) {
    setCvFiles((prev) => prev.map((existing, i) => (i === index ? file : existing)));
  }

  function removeCvFile(index: number) {
    setCvFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function clearCvFiles() {
    setCvFiles([]);
  }

  return { cvFiles, setCvFiles, addCvFile, replaceCvFile, removeCvFile, clearCvFiles, syncCvFilesRef: syncRef };
}
