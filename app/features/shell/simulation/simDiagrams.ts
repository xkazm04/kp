import type { useTranslations } from "next-intl";
import type { SimPhaseId } from "./constants";

// Small, focused PlantUML diagrams — one per phase — rendered in the explainer
// drawer so the customer understands the mechanism behind each step. Component
// syntax matches the About tab's renderer; <<focus>> = automated (moss),
// <<gate>> = deliberate human decision (coral).
//
// i18n: the drawer is part of the public guided demo, so the diagram TEXT is
// copy and lives in `simulation.diagram.*`. Only the labels move — every node
// keeps its ASCII `as <id>` handle and every edge is written against those ids,
// so the parser (app/_components/puml/parse.ts) sees an identical graph in every
// locale and only the drawn words change. `\\n` inside a label is PlantUML's
// line break and is carried verbatim in the message value.

type SimTranslator = ReturnType<typeof useTranslations<"simulation">>;

/** The seven per-phase diagrams, rendered in the active locale. Built per call
 *  (the translator is the input) rather than held as a module constant, which is
 *  what the English-only `PHASE_DIAGRAM` record used to be. */
export function phaseDiagrams(t: SimTranslator): Record<SimPhaseId, string> {
  return {
    design: `@startuml
title ${t("diagram.design.title")}
actor "${t("diagram.design.recruiter")}" as rec
[${t("diagram.design.need")}] as need
package "${t("diagram.design.ingestion")}" {
  [${t("diagram.design.template")}] <<focus>> as tpl
  [${t("diagram.design.job")}] <<focus>> as job
}
rec --> need
need --> tpl
tpl --> job
@enduml`,

    source: `@startuml
title ${t("diagram.source.title")}
[${t("diagram.source.draft")}] as job
[${t("diagram.source.goLive")}] <<gate>> as pub
package "${t("diagram.source.matcher")}" {
  [${t("diagram.source.koFilter")}] <<focus>> as ko
  [${t("diagram.source.scorer")}] <<focus>> as sc
}
[${t("diagram.source.pool")}] as out
job --> pub : ${t("diagram.source.edgeGoLive")}
pub --> ko
ko --> sc : ${t("diagram.source.edgeSurvivors")}
sc --> out : ${t("diagram.source.edgeRanked")}
@enduml`,

    match: `@startuml
title ${t("diagram.match.title")}
package "${t("diagram.match.channels")}" {
  [${t("diagram.match.apply")}] <<focus>> as apply
  [${t("diagram.match.sourcing")}] <<focus>> as src
}
[${t("diagram.match.accepted")}] <<focus>> as acc
[${t("diagram.match.route")}] <<focus>> as match
[${t("diagram.match.screened")}] as out
apply --> acc
src --> acc
acc --> match
match --> out
@enduml`,

    screen: `@startuml
title ${t("diagram.screen.title")}
[${t("diagram.screen.cohort")}] as m
package "${t("diagram.screen.autoDecision")}" {
  [${t("diagram.screen.rank")}] <<focus>> as rank
  [${t("diagram.screen.reject")}] <<focus>> as rej
}
[${t("diagram.screen.fairness")}] <<gate>> as fair
[${t("diagram.screen.passed")}] as out
m --> rank
rank --> rej
rej --> out : ${t("diagram.screen.edgeSurvivors")}
m --> fair : ${t("diagram.screen.edgeProtected")}
fair --> out
@enduml`,

    interview: `@startuml
title ${t("diagram.interview.title")}
[${t("diagram.interview.cleared")}] as s
package "${t("diagram.interview.schedule")}" {
  [${t("diagram.interview.selfSchedule")}] <<focus>> as auto
  [${t("diagram.interview.manualSlot")}] <<gate>> as man
}
[${t("diagram.interview.booked")}] as out
s --> auto
s --> man
auto --> out
man --> out
@enduml`,

    offer: `@startuml
title ${t("diagram.offer.title")}
[${t("diagram.offer.interviewPass")}] as i
[${t("diagram.offer.draft")}] <<focus>> as draft
[${t("diagram.offer.send")}] <<gate>> as ext
[${t("diagram.offer.candidate")}] <<gate>> as cand
i --> draft
draft --> ext
ext --> cand : ${t("diagram.offer.edgeLink")}
@enduml`,

    hired: `@startuml
title ${t("diagram.hired.title")}
[${t("diagram.hired.accepted")}] <<gate>> as acc
[${t("diagram.hired.move")}] <<focus>> as hire
[${t("diagram.hired.handoff")}] <<focus>> as onb
acc --> hire
hire --> onb
@enduml`,
  };
}
