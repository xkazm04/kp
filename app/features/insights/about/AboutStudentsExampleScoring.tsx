"use client";

import { useTranslations } from "next-intl";
import { rubricForArchetype } from "@/app/_lib/interview-rubric";
import { STUDENT_SCRIPT } from "@/app/_lib/student-interview";
import { AXES, BAND_STYLE, STUDENTS, ratingColor } from "./aboutStudentsData";

// Tab 2 of the early-career About page: three synthetic students scored side
// by side against the real early-career rubric. Split out of StudentsAbout.tsx
// (now AboutStudents.tsx) to keep that file under the 200-line cap.
export function AboutStudentsExampleScoring() {
  const t = useTranslations("about.students");
  // The interview grid rows come from the REAL early-career rubric (the same JSON
  // the Python scorer reads) — only the candidates here are synthetic. The
  // constructs the case-grounded phases feed (tagged "case") are the ones whose
  // ratings can mint observed-provenance skills.
  const rubric = rubricForArchetype("student");
  const caseFed = new Set(STUDENT_SCRIPT.filter((p) => p.caseGrounded).flatMap((p) => p.feeds));

  return (
    <div>
      <p className="text-base text-steel">
        {t.rich("exampleIntro", { em: (chunks) => <em>{chunks}</em> })}
      </p>

      <p className="mt-4 text-meta uppercase tracking-wide text-steel">{t("weightedDimensions")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">{t("colDimension")}</th>
              {STUDENTS.map((s) => (
                <th key={s.name} className="min-w-[170px] p-2 text-left align-bottom">
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="mt-0.5 text-sm font-normal text-steel">{s.tagline}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AXES.map((axis) => (
              <tr key={axis.key} className="border-t border-stone-100">
                <td className="sticky left-0 bg-white p-2 align-top">
                  <p className="text-ink">{axis.label}</p>
                  <p className="text-meta text-steel">{axis.sub}</p>
                </td>
                {STUDENTS.map((s) => (
                  <td key={s.name} className="p-2 align-top">
                    <span className="font-semibold nums text-ink">{s.scores[axis.key]}</span>
                    <span className="ml-1.5 text-meta text-steel nums">
                      {`w ${s.weights[axis.key]}% · +${((s.scores[axis.key] * s.weights[axis.key]) / 100).toFixed(1)}`}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-stone-200">
              <td className="sticky left-0 bg-white p-2 font-semibold text-ink">{t("rowTotal")}</td>
              {STUDENTS.map((s) => (
                <td key={s.name} className="p-2">
                  <span className="inline-flex h-7 min-w-9 items-center justify-center rounded-md bg-stone-100 px-1.5 font-semibold nums text-ink">
                    {s.total}
                  </span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-stone-100">
              <td className="sticky left-0 bg-white p-2 text-ink">{t("rowConfidence")}</td>
              {STUDENTS.map((s) => (
                <td key={s.name} className="p-2" title={s.bandWhy}>
                  <span className={`text-sm font-medium nums ${BAND_STYLE[s.bandLevel]}`}>
                    {`${s.band[0]}–${s.band[1]} · ${s.bandLevel}`}
                  </span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-stone-100">
              <td className="sticky left-0 bg-white p-2 text-ink">{t("rowWhyWeighting")}</td>
              {STUDENTS.map((s) => (
                <td key={s.name} className="p-2 align-top">
                  <p className="text-sm text-steel">{s.weightWhy}</p>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-5 text-meta uppercase tracking-wide text-steel">{t("rubricHeading")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">{t("colConstruct")}</th>
              {STUDENTS.map((s) => (
                <th key={s.name} className="min-w-[100px] p-2 text-left text-ink">{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rubric.map((comp) => (
              <tr key={comp.competency} className="border-t border-stone-100">
                <td className="sticky left-0 bg-white p-2 text-ink" title={comp.description}>
                  {comp.competency}
                  {caseFed.has(comp.competency) ? (
                    <span
                      className="ml-1.5 rounded-full bg-coral/10 px-1.5 py-0.5 text-meta font-medium text-coral"
                      title={t("caseBadgeTitle")}
                    >
                      {t("caseBadge")}
                    </span>
                  ) : null}
                </td>
                {STUDENTS.map((s) => {
                  const r = s.ratings[comp.competency];
                  return (
                    <td key={s.name} className="p-2">
                      {r ? (
                        <span
                          className={`inline-flex h-7 w-9 items-center justify-center rounded-md font-semibold nums ${ratingColor(r.score)}`}
                          title={r.evidence}
                        >
                          {r.score}
                        </span>
                      ) : (
                        <span className="text-steel">{"—"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-steel">
        {t.rich("scoringFootnote", { b: (chunks) => <span className="font-medium text-ink">{chunks}</span> })}
      </p>
    </div>
  );
}
