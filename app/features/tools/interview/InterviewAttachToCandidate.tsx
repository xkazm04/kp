"use client";

// d95fed6d — note a practice interview session on a real candidate's record, split
// out of InterviewSimTab.tsx. Lazy: the pipeline board is fetched only when the
// recruiter opens the control. Posting records a `sim_attached` event (drawer
// history); nothing else moves.
import { useState } from "react";
import { Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";

export function InterviewAttachToCandidate({ token }: { token: string }) {
  const t = useTranslations("interviewSim.attach");
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<{ id: string; candidateLabel: string; jobTitle: string | null }[] | null>(null);
  const [sel, setSel] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  // A failed fetch must NOT read as "no candidates" (the prior `.catch(setEntries([]))`).
  const [loadError, setLoadError] = useState(false);

  const loadEntries = () => {
    setLoadError(false);
    setEntries(null); // back to the loading state for a retry
    fetch("/api/pipeline")
      .then(async (r) => {
        if (!r.ok) throw new Error("pipeline fetch failed");
        return r.json();
      })
      .then((p) => {
        const list = ((p.entries ?? []) as { id: string; candidateLabel: string; jobTitle: string | null; status: string }[])
          .filter((e) => e.status === "active")
          .map((e) => ({ id: e.id, candidateLabel: e.candidateLabel, jobTitle: e.jobTitle }));
        setEntries(list);
        setSel((cur) => cur || list[0]?.id || "");
      })
      .catch(() => {
        setLoadError(true);
        setEntries([]); // leave the loading state; loadError drives the error UI
      });
  };

  const toggle = () => {
    setOpen((o) => !o);
    if (entries === null && !loadError) loadEntries();
  };

  const attach = async () => {
    if (state === "busy" || !sel) return;
    setState("busy");
    try {
      const r = await fetch("/api/interview/simulate/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, entryId: sel }),
      });
      if (!r.ok) throw new Error();
      setState("done");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="mt-3">
      {state === "done" ? (
        <p className="text-sm font-medium text-moss">{t("done")}</p>
      ) : (
        <>
          <button type="button" onClick={toggle} aria-expanded={open} className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}>
            <Link2 size={13} /> {t("toggle")}
          </button>
          {open ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {loadError ? (
                <p className="text-sm text-coral" role="alert">
                  {t("loadFailed")}{" "}
                  <button type="button" onClick={loadEntries} className="focus-ring font-semibold underline">
                    {t("retry")}
                  </button>
                </p>
              ) : entries === null ? (
                // Tier 2: the pipeline fetch is in flight and there's nothing to
                // show yet. Reserve the select+button row's height and stay quiet
                // — a fast response never flashes a "loading" line.
                <div className="reveal-quiet min-h-[2rem]" aria-hidden />
              ) : entries.length === 0 ? (
                <p className="text-sm text-steel">{t("noCandidates")}</p>
              ) : (
                <>
                  <label className="sr-only" htmlFor="sim-attach-entry">
                    {t("selectAria")}
                  </label>
                  <Select
                    id="sim-attach-entry"
                    ariaLabel={t("selectAria")}
                    value={sel}
                    onChange={setSel}
                    sizeVariant="sm"
                    className="h-8"
                    options={entries.map((e) => ({ value: e.id, label: `${e.candidateLabel}${e.jobTitle ? ` — ${e.jobTitle}` : ""}` }))}
                  />
                  <button type="button" onClick={attach} disabled={state === "busy"} className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}>
                    {state === "busy" ? t("attaching") : t("attach")}
                  </button>
                </>
              )}
              {state === "error" ? <p className="text-sm text-coral">{t("failed")}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
