"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Defer } from "@/app/_components/ui/Defer";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import { buildTabSwitchUrl } from "@/app/features/shell/tabs";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { switchTab, duplicateToBuilder, type AuthorNavState } from "./jdsLedgerNav";
import { readIntentPrompt } from "./jdsLedgerArtifacts";
import type { GeneratePrefill } from "./jdsLibrary";
import { DUPLICATE_PARAM, opensOnGenerate } from "./jdsIntakeTabEntry";

// JOB INTAKE — the authoring half of the JD surfaces, split out of the library
// tab. The library page used to carry a Saved / Generate / Intake strip, which
// made one page answer two unrelated questions: "which roles do I have" (a
// ledger you scan) and "write me a new one" (a workspace you sit in). They now
// live under their own sidebar items; the ledger is the whole library page and
// this is the whole authoring page.
//
// Intake is the DEFAULT: talking a role through is the surface this product
// argues for. Generate is the alternative for the recruiter who already has the
// text and wants to hand it over directly.
//
// Both panels stay mounted (the inactive one is `display:none`) so switching
// between them can never discard a half-typed draft or an in-flight dialog —
// the invariant jdsLedgerNav.ts pins. Only a Duplicate advances `builderKey`,
// which remounts the builder so it re-reads the new prefill.

const chunkGap = () => <div className="reveal-quiet min-h-[20rem]" aria-hidden />;
const LibraryGeneratePanel = dynamic(() => import("./JdsGeneratePanel").then((m) => ({ default: m.LibraryGeneratePanel })), {
  loading: chunkGap,
});
const LibraryIntakePanel = dynamic(() => import("./intake/JdsIntakePanel").then((m) => ({ default: m.JdsIntakePanel })), {
  loading: chunkGap,
});

export function JdsIntakeTab() {
  const t = useTranslations("library.intakeTab");
  const router = useRouter();
  const search = useSearchParams();
  // The entry mode is decided from the URL ONCE, at mount: a deep link carrying a
  // JD prefill (the guided demo's ?jdTitle=…, a finished build's ?jdTask=, a
  // Duplicate's ?duplicate=) is asking for the builder, and anything else lands on
  // the dialog. Read in the state initializer so a later param strip (below)
  // cannot flip the tab under the reader.
  const [nav, setNav] = useState<AuthorNavState>(() => ({
    tab: opensOnGenerate(search) ? "generate" : "intake",
    builderKey: 0,
  }));
  const [prefill, setPrefill] = useState<GeneratePrefill | null>(null);

  // Duplicate handoff (?duplicate=<slug>): the ledger no longer shares a page with
  // the builder, so the prefill can't be handed over in memory. The SLUG rides the
  // URL and the fetch happens here — the same read the ledger used to do
  // (`?intent=1`), so a regenerated role still designs from the recruiter's
  // ORIGINAL prompt rather than from the rendered markdown.
  const loadDuplicate = useCallback(async (slug: string) => {
    let need = "";
    let meta: { title?: string; company?: string; seniority?: string; roleFamily?: string } = {};
    try {
      const src = (await fetch(`/api/jds/${encodeURIComponent(slug)}?intent=1`).then((r) => r.json())) as
        | { title?: string; body?: string; preview?: string; company?: string; seniority?: string; roleFamily?: string; build_input_json?: string | null }
        | null;
      const prompt = readIntentPrompt(src?.build_input_json);
      need = prompt || (typeof src?.body === "string" ? src.body : "");
      meta = { title: src?.title, company: src?.company, seniority: src?.seniority, roleFamily: src?.roleFamily };
    } catch {
      // A failed read is not a failed Duplicate: the builder opens empty-but-open
      // rather than swallowing the click, and the recruiter can type.
      need = "";
    }
    setPrefill({ title: meta.title ?? "", company: meta.company, seniority: meta.seniority, roleFamily: meta.roleFamily, need });
    setNav((s) => duplicateToBuilder(s));
  }, []);

  useEffect(() => {
    const slug = search.get(DUPLICATE_PARAM);
    if (!slug) return;
    // Deferred kickoff (the jdsHooks idiom): the fetch — and therefore every
    // setState it lands — starts in a 0ms callback rather than in the effect body,
    // so nothing sets state synchronously during the effect.
    const timer = window.setTimeout(() => void loadDuplicate(slug), 0);
    // One-shot, like ?arm= and ?coachEdit=: strip the param with a raw history
    // write (no setState → no nav churn) so a refresh or a shared link can never
    // re-seed a prefill the recruiter has since edited.
    const url = new URL(window.location.href);
    url.searchParams.delete(DUPLICATE_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="stagger-children rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div className="min-w-0">
          <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
          <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
        </div>
        {/* The other half of the split, one click away — an authored role's
            destination is the ledger, and the ledger's "write a new one" is here. */}
        <button
          type="button"
          className={`${BTN_GHOST} h-9 shrink-0 px-3 text-sm`}
          onClick={() => router.push(buildTabSwitchUrl("library", search.toString()))}
        >
          {t("toLibrary")} <ArrowRight size={14} aria-hidden />
        </button>
      </header>

      <div className="mt-5">
        <SegmentedControl
          label={t("modeLabel")}
          value={nav.tab}
          // A manual switch clears any pending Duplicate prefill so it can't re-seed
          // a form the recruiter opened themselves; it keeps builderKey, so the
          // builder is NOT remounted and a half-typed draft survives the swap.
          onChange={(v) => {
            setPrefill(null);
            setNav((s) => switchTab(s, v === "generate" ? "generate" : "intake"));
          }}
          options={[
            { value: "intake", label: t("modeIntake") },
            { value: "generate", label: t("modeGenerate") },
          ]}
        />
      </div>

      <div className={nav.tab === "intake" ? "animate-fade-in mt-5" : "hidden"}>
        <Defer strategy="idle" placeholder={chunkGap()}>
          <LibraryIntakePanel onPromoted={notifyDataChanged} />
        </Defer>
      </div>
      {/* `animate-fade-in` on a display-toggled wrapper replays on each show: a CSS
          animation starts when an element becomes rendered, so the swap gets its
          transition without a key (a key would remount the builder — the very thing
          the stay-mounted contract above exists to prevent). */}
      <div className={nav.tab === "generate" ? "animate-fade-in mt-5" : "hidden"}>
        <Defer strategy="idle" placeholder={chunkGap()}>
          <LibraryGeneratePanel key={nav.builderKey} onSaved={notifyDataChanged} prefill={prefill} />
        </Defer>
      </div>
    </section>
  );
}
