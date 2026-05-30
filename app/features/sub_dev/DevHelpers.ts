// A run is "partial" when some pipeline steps used the LLM and others fell back
// to deterministic templates — surface that instead of mislabelling it full LLM.
export function sourceLabel(source?: string): string {
  if (source === "llm") return "Claude CLI";
  if (source === "partial") return "Partial (degraded)";
  return "template";
}

// The grounded repo analysis only supports GitHub (github.com URL or bare
// owner/repo). Any other host can't be fetched, so the case runs ungrounded at
// low confidence — we warn the user rather than silently wrapping it as github.
export function isSupportedRepoRef(raw: string): boolean {
  const ref = raw.trim();
  if (!ref) return true; // empty = no codebase, that's fine
  if (/github\.com/i.test(ref)) return true;
  if (/^[^/\s]+\/[^/\s]+$/.test(ref)) return true; // bare owner/repo
  return false;
}

export function scoreColor(v: number): string {
  if (v >= 72) return "bg-moss";
  if (v >= 55) return "bg-moss/60";
  if (v >= 40) return "bg-amber-400";
  return "bg-coral";
}

// Foreground that stays legible on each scoreColor band: dark text on the light
// amber / translucent-moss bands, white on the solid moss / coral ones.
export function scoreTextColor(v: number): string {
  if (v >= 72) return "text-white";
  if (v >= 55) return "text-ink";
  if (v >= 40) return "text-ink";
  return "text-white";
}
