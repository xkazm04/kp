/* eslint-disable i18next/no-literal-string --
 * DELIBERATELY English-only, unlike every other user-facing surface in kp.
 *
 * This page makes article-by-article claims about a regulated system, and a customer may
 * put it in front of a procurement or legal reviewer. A mistranslated compliance claim is
 * materially worse than an English one: "enforced in code" and "partial" are load-bearing
 * words, and the machine-translation path this repo uses elsewhere (/i18n-translate) is
 * the wrong tool for text whose accuracy is the entire product of the page.
 *
 * Revisit when a human legal reviewer per locale is available; until then the honest
 * option is one language we can stand behind. The page says so in its footer.
 */
import {
  CLASSIFICATION,
  DATA_RIGHTS,
  DISCLAIMER,
  SUBPROCESSORS,
  byWeakestFirst,
  postureSummary,
  type Posture,
} from "@/app/_lib/trust-posture";
import { CARD_PAD, EYEBROW, INTRO, PANEL, PANEL_SUNKEN, TITLE_DISPLAY } from "@/app/_components/ui/recipes";

// W0.5 — the public trust surface. A server component: static claims, no client state.
// Copy and posture live in app/_lib/trust-posture.ts so they are reviewable as text and
// pinned by tests; this file is presentation only.

const POSTURE_LABEL: Record<Posture, string> = {
  enforced: "Enforced in code",
  partial: "Partial",
  not_yet: "Not yet built",
};

// Status colour comes from the mapped status shades, so both themes are covered by the
// tokens rather than by a fork here.
const POSTURE_CHIP: Record<Posture, string> = {
  enforced: "border-green-200 bg-green-50 text-green-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  not_yet: "border-red-200 bg-red-50 text-red-700",
};

function PostureChip({ posture }: { posture: Posture }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-meta uppercase ${POSTURE_CHIP[posture]}`}>
      {POSTURE_LABEL[posture]}
    </span>
  );
}

export function TrustContent() {
  const rows = byWeakestFirst();
  const summary = postureSummary();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 lg:py-16">
      <header className="border-b border-stone-200 pb-8">
        <p className={EYEBROW}>Trust</p>
        <h1 className={`mt-1 ${TITLE_DISPLAY}`}>How KandiDate handles a regulated hiring decision</h1>
        <p className={`mt-3 max-w-2xl ${INTRO}`}>
          KandiDate screens, scores, ranks and interviews job candidates. Under the EU AI Act that is a high-risk
          use, and the obligations apply in full from {CLASSIFICATION.appliesFrom}. This page states, article
          by article, which of them the product enforces today — including the ones it does not.
        </p>
        {/* Lead with the shape. A reader who scrolls no further should still leave knowing
            how many obligations are NOT fully met — the partial + not-yet chips below,
            counted from OBLIGATIONS — rather than with a green impression. Never restate
            that count in prose here: it was written as "three" while the register had
            grown to six, and a stale figure on this page is the failure it exists to
            prevent. */}
        <div className="mt-5 flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${POSTURE_CHIP.enforced}`}>
            {summary.enforced} enforced
          </span>
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${POSTURE_CHIP.partial}`}>
            {summary.partial} partial
          </span>
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${POSTURE_CHIP.not_yet}`}>
            {summary.not_yet} not yet built
          </span>
        </div>
      </header>

      <section className="mt-10">
        <h2 className="font-serif text-h2 text-ink">Classification</h2>
        <div className={`mt-4 ${PANEL} ${CARD_PAD} space-y-3`}>
          <p className="text-body text-ink">
            <strong>{CLASSIFICATION.conclusion}</strong> {CLASSIFICATION.annex}.
          </p>
          <p className="text-body text-steel">{CLASSIFICATION.derogation}</p>
          <p className="text-body text-steel">{CLASSIFICATION.providerRole}</p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-h2 text-ink">Obligations, weakest first</h2>
        <p className="mt-2 text-body text-steel">
          Ordered by what is missing rather than by what is strongest — the question a reviewer actually has.
        </p>
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.article} className={`${PANEL} ${CARD_PAD}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-serif text-h3 text-ink">
                  <span className="text-steel">{r.article}</span> {r.title}
                </h3>
                <PostureChip posture={r.posture} />
              </div>
              <p className="mt-2 text-body text-steel">{r.summary}</p>
              {r.gap ? (
                <p className="mt-2 border-l-2 border-stone-200 pl-3 text-body text-steel">
                  <span className="font-semibold text-ink">Outstanding: </span>
                  {r.gap}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-h2 text-ink">Data handling</h2>
        <ul className={`mt-4 ${PANEL} ${CARD_PAD} list-disc space-y-2 pl-8`}>
          {DATA_RIGHTS.map((line) => (
            <li key={line} className="text-body text-steel">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-h2 text-ink">Subprocessors</h2>
        <p className="mt-2 text-body text-steel">
          KandiDate routes to the engines each customer configures, so this is the set it <em>can</em> engage — not
          one it always does. Every entry is optional: an offline, self-hosted install engages none of them.
        </p>
        <div className={`mt-4 overflow-x-auto ${PANEL}`}>
          <table className="w-full min-w-[32rem] text-left">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="px-4 py-3 text-meta uppercase text-steel">Processor</th>
                <th className="px-4 py-3 text-meta uppercase text-steel">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-b border-stone-200 last:border-0">
                  <td className="px-4 py-3 text-body font-semibold text-ink">{s.name}</td>
                  <td className="px-4 py-3 text-body text-steel">{s.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className={`mt-10 ${PANEL_SUNKEN} ${CARD_PAD} space-y-2`}>
        <p className="text-body text-steel">{DISCLAIMER}</p>
        <p className="text-sm text-steel">
          Published in English only. The rest of the product is localized, but the wording of a compliance
          claim is load-bearing, and we would rather state it in one language we can stand behind than in
          four we cannot review.
        </p>
      </footer>
    </main>
  );
}
