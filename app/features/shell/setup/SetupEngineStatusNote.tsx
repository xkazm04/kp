"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEngineAvailability } from "../useEngineAvailability";

// DATA4, extended to onboarding — the wizard's activation step starts a REAL
// backgrounded AI build (POST /api/jds/generate), and on a keyless server that
// build silently degrades: without the Claude CLI every draft is a
// deterministic fallback that LOOKS like AI output; without a Gemini key the
// market-salary step falls back to the internal taxonomy band. Neither failure
// is a hard error minutes later (both paths have designed deterministic
// fallbacks — verified in pipeline/jobfit/devcase/* and market_salary_cli.py),
// so this WARNS honestly instead of blocking: the SchedulerToolbar amber-chip
// precedent, one note per degraded engine. Import mode saves an existing JD
// as-is (no AI), so it renders nothing there. null while loading — no false
// alarm (useEngineAvailability contract).
export function SetupEngineStatusNote({ mode }: { mode: "write" | "import" }) {
  const t = useTranslations("setup.engines");
  const engines = useEngineAvailability();
  if (!engines || mode === "import") return null;
  const notes: string[] = [];
  if (!engines.claudeCli) notes.push(t("claudeFallback"));
  if (!engines.gemini) notes.push(t("geminiFallback"));
  if (notes.length === 0) return null;
  return (
    <div role="status" className="space-y-1.5">
      {notes.map((note) => (
        <p
          key={note}
          className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> {note}
        </p>
      ))}
    </div>
  );
}
