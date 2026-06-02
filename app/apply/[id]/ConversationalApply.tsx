"use client";

import { useEffect, useRef, useState } from "react";
import { AiDisclosure } from "@/app/_components/AiDisclosure";

type Step = {
  id: string;
  type: "text" | "ko" | "choice";
  prompt: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
};
type Msg = { who: "bot" | "me"; text: string };

export function ConversationalApply({ jobId }: { jobId: string }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [input, setInput] = useState("");
  const [done, setDone] = useState<{ result: "accepted" | "declined"; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // True during the 250ms hand-off between steps; locks the controls so a step
  // can't be answered before the next prompt has even rendered.
  const [transitioning, setTransitioning] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  // Step ids already answered — the synchronous guard that makes advance()
  // idempotent even when two events fire within the same render frame.
  const answeredRef = useRef<Set<string>>(new Set());
  const stepTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/apply/${jobId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) {
          setError(d.error);
          return;
        }
        setSteps(d.steps);
        setMsgs([{ who: "bot", text: d.steps[0]?.prompt ?? "Let's begin." }]);
      })
      .catch(() => {
        if (alive) setError("Couldn't load the application.");
      });
    return () => {
      alive = false;
    };
  }, [jobId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, done]);

  useEffect(() => {
    return () => {
      if (stepTimer.current !== null) window.clearTimeout(stepTimer.current);
    };
  }, []);

  // The controls are locked while a POST is in flight or while we're mid-hop
  // between steps. advance() is the single entry point and answers each step
  // exactly once, keyed by step id, so a double-click / double-Enter that slips
  // past the disabled UI (or fires within one render frame) is a no-op.
  const busy = submitting || transitioning;

  const advance = async (stepId: string, newAnswers: Record<string, unknown>, label: string) => {
    if (busy || answeredRef.current.has(stepId)) return;
    answeredRef.current.add(stepId);

    setMsgs((m) => [...m, { who: "me", text: label }]);
    setAnswers(newAnswers);
    const next = idx + 1;
    if (steps && next < steps.length) {
      setTransitioning(true);
      stepTimer.current = window.setTimeout(() => {
        stepTimer.current = null;
        setMsgs((m) => [...m, { who: "bot", text: steps[next].prompt }]);
        setIdx(next);
        setTransitioning(false);
      }, 250);
    } else {
      setSubmitting(true);
      try {
        const res = await fetch(`/api/apply/${jobId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: newAnswers }),
        });
        const d = await res.json();
        if (res.ok) setDone({ result: d.result, message: d.message });
        else setError(d.error || "Couldn't submit your application.");
      } catch {
        setError("Couldn't submit your application.");
      } finally {
        setSubmitting(false);
      }
    }
  };

  const submitText = () => {
    const v = input.trim();
    if (!v || !steps || busy) return;
    const step = steps[idx];
    advance(step.id, { ...answers, [step.id]: v }, v);
    setInput("");
  };
  const submitKo = (yes: boolean) => {
    if (!steps || busy) return;
    const step = steps[idx];
    advance(step.id, { ...answers, [step.id]: yes }, yes ? "Yes" : "No");
  };
  const submitChoice = (value: string, label: string) => {
    if (!steps || busy) return;
    const step = steps[idx];
    advance(step.id, { ...answers, [step.id]: value }, label);
  };

  if (error) return <p className="rounded-md border border-stone-200 bg-paper p-4 text-base text-coral">{error}</p>;
  if (!steps) return <p className="text-base text-steel">Loading…</p>;

  const cur = !done ? steps[idx] : null;

  return (
    <div>
      <div className="space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={m.who === "me" ? "text-right" : ""}>
            <span
              className={`inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-base leading-6 ${
                m.who === "me" ? "bg-coral text-white" : "border border-stone-200 bg-white text-ink"
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
        {done ? (
          <div className={`rounded-lg border p-4 ${done.result === "accepted" ? "border-moss/40 bg-moss/5" : "border-stone-200 bg-paper"}`}>
            <p className={`font-serif text-h3 ${done.result === "accepted" ? "text-moss" : "text-ink"}`}>
              {done.result === "accepted" ? "You're in 🎉" : "Thanks for applying"}
            </p>
            <p className="mt-1 text-base text-steel">{done.message}</p>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {!done && cur ? (
        <div className="mt-4">
          {cur.type === "ko" ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => submitKo(true)}
                className="focus-ring rounded-md border border-stone-200 bg-white px-5 py-2 text-base font-semibold text-ink hover:border-moss/50 disabled:opacity-50"
              >
                Yes
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => submitKo(false)}
                className="focus-ring rounded-md border border-stone-200 bg-white px-5 py-2 text-base font-semibold text-ink hover:border-coral/50 disabled:opacity-50"
              >
                No
              </button>
            </div>
          ) : cur.type === "choice" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {(cur.options ?? []).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={busy}
                  onClick={() => submitChoice(opt.value, opt.label)}
                  className="focus-ring rounded-md border border-stone-200 bg-white px-4 py-2 text-left text-base font-semibold text-ink hover:border-coral/50 disabled:opacity-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitText();
              }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={cur.placeholder}
                disabled={busy}
                className="focus-ring h-11 flex-1 rounded-md border border-stone-200 px-3 text-base disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || busy}
                className="focus-ring rounded-md bg-ink px-4 text-base font-semibold text-white hover:bg-steel disabled:opacity-50"
              >
                Send
              </button>
            </form>
          )}
        </div>
      ) : null}

      <AiDisclosure className="mt-6" />
    </div>
  );
}
