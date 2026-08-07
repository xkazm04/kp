"use client";

import dynamic from "next/dynamic";
import { motion, type TargetAndTransition } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link2, Pencil, ShieldCheck, TriangleAlert } from "lucide-react";
import { AMBER, CORAL, HAND, INK, LIMEWASH, MOSS, STEEL } from "../tokens";
import { useStillMotion } from "../useStillMotion";
import { CARD, ENTER, cycle } from "./shared";

/*
 * 04 · Provable, not promised — the chain breaks itself on camera.
 *
 * "Tamper-evident" is a word; a chain that visibly fails is a demonstration.
 * Three sealed decisions sit linked by their hashes, then something edits the
 * middle one — its hash changes, and every link after it snaps. That is
 * precisely what tamper-evidence means and precisely why it is worth having:
 * the record does not stop you altering history, it stops you altering history
 * quietly. The loop then re-seals, so the panel can be watched twice.
 *
 * Underneath, the second half of the claim — "confidence is measured against
 * real outcomes, calibrated, never just asserted" — gets the one honest chart
 * on the page. It is lazy-loaded; see ./CalibrationChart.
 */

// One full seal → tamper → detect → re-seal cycle, in seconds.
const DUR = 7.6;

// Decision hashes are illustrative data, not copy — held as constants so a
// translator never sees them and the lint can tell them apart from strings.
const BLOCKS = [
  { key: "advance", name: "Jana N.", color: MOSS, hash: "a3f19c", broken: "a3f19c" },
  { key: "pass", name: "Alex T.", color: CORAL, hash: "7be04d", broken: "0d21ff" },
  { key: "offer", name: "Petr K.", color: AMBER, hash: "c58a12", broken: "c58a12" }
] as const;

// The chart is a separate chunk: the landing must not ship recharts to every
// visitor for a panel most never open. Fallback holds the exact box so the
// swap cannot shift the stage.
const CalibrationChart = dynamic(() => import("./CalibrationChart"), {
  loading: () => <div className="h-[80px] w-full rounded-lg sm:h-[96px]" style={{ background: LIMEWASH }} />
});

export default function AuditArt() {
  const t = useTranslations("landing");
  const rm = useStillMotion();

  // The two halves of every crossfade in this panel: `intact` is the resting
  // truth, `tampered` is the ~30% of the loop where the chain is broken.
  const intact = (still: TargetAndTransition) =>
    cycle(rm, DUR, { opacity: [1, 1, 0, 0, 1, 1] }, [0, 0.4, 0.46, 0.72, 0.78, 1], still);
  const tampered = (still: TargetAndTransition) => ({
    initial: { opacity: 0 },
    ...cycle(rm, DUR, { opacity: [0, 0, 1, 1, 0, 0] }, [0, 0.4, 0.46, 0.72, 0.78, 1], still)
  });

  return (
    <div className="w-full max-w-[520px]">
      <div className="flex w-full flex-col gap-1.5 sm:flex-row sm:items-stretch sm:justify-center">
        {BLOCKS.map((b, i) => (
          <div key={b.key} className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
            <motion.div
              initial={rm ? false : { opacity: 0, y: 20, rotate: i % 2 ? 2 : -2 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0 }}
              viewport={ENTER}
              transition={{ delay: i * 0.12, type: "spring", bounce: 0.4 }}
              className={`${CARD} relative min-w-0 flex-1 overflow-hidden p-2 sm:p-2.5`}
            >
              {/* Only the middle block is edited, so only it flashes — and it
                  flashes to a WASH, not to full coral: the decision underneath
                  has to stay readable, since "you can still see what was
                  changed" is the property on display. Its own opacity track,
                  because the shared one animates to 1 and would drown it. */}
              {b.key === "pass" && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0"
                  style={{ background: CORAL }}
                  initial={{ opacity: 0 }}
                  {...cycle(rm, DUR, { opacity: [0, 0, 0.16, 0.16, 0, 0] }, [0, 0.4, 0.46, 0.72, 0.78, 1], { opacity: 0 })}
                />
              )}
              <p className="relative truncate text-[13px] font-extrabold sm:text-xs">
                {t(`trust.art.audit.blocks.${b.key}`, { name: b.name })}
              </p>
              <div className="relative mt-1 flex items-center gap-1.5 sm:mt-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[#17202a]"
                  style={{ background: b.color }}
                  aria-hidden
                />
                {/* Only the EDITED block's hash crossfades. The other two are
                    static, because their content did not change — what fails
                    downstream is the link, not their own digest. Fading all
                    three left the row blank for a third of the loop and quietly
                    misdescribed how a hash chain breaks. */}
                <span className="nums relative text-[13px] font-bold" style={{ color: STEEL }}>
                  {b.key === "pass" ? (
                    <>
                      <motion.span {...intact({ opacity: 1 })}>{b.hash}</motion.span>
                      <motion.span
                        className="absolute inset-0 whitespace-nowrap font-extrabold"
                        style={{ color: CORAL }}
                        {...tampered({ opacity: 0 })}
                      >
                        {b.broken}
                      </motion.span>
                    </>
                  ) : (
                    b.hash
                  )}
                </span>
              </div>

              {b.key === "pass" && (
                <motion.span
                  aria-hidden
                  className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full border-[3px] border-[#17202a] shadow-[2px_2px_0_#17202a]"
                  style={{ background: CORAL }}
                  {...cycle(
                    rm,
                    DUR,
                    { opacity: [0, 0, 1, 1, 0, 0], rotate: [0, 0, -12, 8, 8, 0] },
                    [0, 0.34, 0.42, 0.52, 0.6, 1],
                    { opacity: 0 }
                  )}
                >
                  <Pencil className="h-3 w-3 text-white" />
                </motion.span>
              )}
            </motion.div>

            {/* The link to the next block. After the edit, everything downstream
                of it fails — that is the whole property being demonstrated. */}
            {i < BLOCKS.length - 1 && (
              <span className="relative grid h-5 w-6 shrink-0 place-items-center self-center sm:h-6" aria-hidden>
                <motion.span className="absolute" {...(i === 0 ? { animate: { opacity: 1 } } : intact({ opacity: 1 }))}>
                  <Link2 className="h-5 w-5" style={{ color: INK }} />
                </motion.span>
                {i > 0 && (
                  <motion.span className="absolute text-lg font-extrabold" style={{ color: CORAL }} {...tampered({ opacity: 0 })}>
                    <TriangleAlert className="h-5 w-5" />
                  </motion.span>
                )}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* The verdict banner — the thing an auditor actually reads. */}
      <div className="relative mt-2 h-9 sm:mt-3">
        <motion.div
          className="absolute inset-x-0 flex items-center justify-center gap-2 rounded-xl border-[3px] border-[#17202a] py-1.5 text-sm font-extrabold text-white shadow-[3px_3px_0_#17202a]"
          style={{ background: MOSS }}
          {...intact({ opacity: 1 })}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {t("trust.art.audit.verified")}
        </motion.div>
        <motion.div
          className="absolute inset-x-0 flex items-center justify-center gap-2 rounded-xl border-[3px] border-[#17202a] py-1.5 text-sm font-extrabold text-white shadow-[3px_3px_0_#17202a]"
          style={{ background: CORAL }}
          {...tampered({ opacity: 0 })}
        >
          <TriangleAlert className="h-4 w-4" aria-hidden />
          {t("trust.art.audit.tampered")}
        </motion.div>
      </div>

      <div className={`${CARD} mt-2 p-2.5 sm:mt-3 sm:p-3`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: STEEL }}>
            {t("trust.art.audit.calibration.title")}
          </p>
          <div className="flex items-center gap-3 text-[13px] font-bold" style={{ color: STEEL }}>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border-2 border-[#17202a]" style={{ background: AMBER }} aria-hidden />
              {t("trust.art.audit.calibration.predicted")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border-2 border-[#17202a]" style={{ background: MOSS }} aria-hidden />
              {t("trust.art.audit.calibration.actual")}
            </span>
          </div>
        </div>
        <div className="mt-1.5">
          <CalibrationChart />
        </div>
      </div>

      <p className={`${HAND} mt-1.5 text-[15px] sm:mt-2 sm:text-sm`} style={{ color: STEEL }}>
        {t("trust.art.audit.calibration.note")}
      </p>
    </div>
  );
}
