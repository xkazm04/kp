// CV-variant intake (add/replace/remove), split out of useAnalyzeForm.ts. Self-
// contained: owns its own cvFiles state, the content-hash dedupe, and the
// serialized-queue guard against two near-simultaneous drops of the same file
// both passing a stale dedupe check.
import { useCallback, useRef, useState } from "react";
import { MAX_CV_VARIANTS } from "./AnalyzeTypes";
import { admitCvFile, fitsWithinCap } from "./analyzeCvIntake";

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
    // The verdict — cap, content dedupe, and the admit-on-hash-failure rule —
    // lives in admitCvFile, which is pure over a snapshot and therefore testable
    // over real Files without a renderer. This function keeps only the parts that
    // are genuinely about React: reading the live ref before and after the await,
    // and committing.
    const result = await admitCvFile(cvFilesRef.current, file, MAX_CV_VARIANTS);
    if (result.outcome !== "added") return;
    // Re-check against the LIVE ref, not the snapshot admitCvFile saw: a sibling
    // add can fill the last slot while this one awaits the hash, and the
    // pre-check alone would let the list overflow by one.
    if (!fitsWithinCap(cvFilesRef.current, MAX_CV_VARIANTS)) return;
    const merged = [...cvFilesRef.current, file];
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
