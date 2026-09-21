"use client";

// The intake composer's INPUT pipeline is the Studio kit's now
// (app/_components/studio/useStudioDictation.ts); intake keeps its name for the
// legacy voice bar that still imports it.
export { useStudioDictation as useIntakeDictation, useMicLevel, type StudioDictation as IntakeDictation } from "@/app/_components/studio/useStudioDictation";
