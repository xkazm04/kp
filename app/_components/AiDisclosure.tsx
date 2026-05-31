import { ShieldCheck } from "lucide-react";

// Candidate-facing transparency note. Our differentiator vs. opaque AI-hiring
// vendors: AI assists, a human decides, and assessment is on talent/fit.
export function AiDisclosure({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-md border border-stone-200 bg-paper/60 p-3 text-sm text-steel ${className}`}>
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        <ShieldCheck size={14} className="text-moss" /> How this works
      </p>
      <p className="mt-1">
        We use AI to assist screening and interviews — assessing your{" "}
        <span className="font-medium text-ink">skills, experience, and fit</span> for the role. A human reviews and
        makes every advance, offer, and rejection decision; nothing adverse is decided automatically. You can ask for a
        human review at any point.
      </p>
    </div>
  );
}
