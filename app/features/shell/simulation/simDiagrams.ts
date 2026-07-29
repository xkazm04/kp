import type { SimPhaseId } from "./constants";

// Small, focused PlantUML diagrams — one per phase — rendered in the explainer
// drawer so the customer understands the mechanism behind each step. Component
// syntax matches the About tab's renderer; <<focus>> = automated (moss),
// <<gate>> = deliberate human decision (coral).

export const PHASE_DIAGRAM: Record<SimPhaseId, string> = {
  design: `@startuml
title Job description → a draft, company-formatted JD
actor "Recruiter" as rec
[Need + role spec] as need
package "Ingestion" {
  [Company template\\nbranded format] <<focus>> as tpl
  [Structured Job\\njd-<slug> · draft] <<focus>> as job
}
rec --> need
need --> tpl
tpl --> job
@enduml`,

  source: `@startuml
title Source: take the JD live, then rank the pool
[Draft JD] as job
[Go live] <<gate>> as pub
package "Matcher (deterministic)" {
  [KO filter\\nlocation · seniority · language] <<focus>> as ko
  [Multi-factor scorer\\nskills · career · fit] <<focus>> as sc
}
[Accepted pool] as out
job --> pub : go live
pub --> ko
ko --> sc : survivors
sc --> out : ranked
@enduml`,

  match: `@startuml
title Intake: channels feed the pipeline front
package "Channels" {
  [Careers page / Apply] <<focus>> as apply
  [Proactive sourcing] <<focus>> as src
}
[Accepted\\n(inbound + sourced)] <<focus>> as acc
[Score + archetype route] <<focus>> as match
[Screened] as out
apply --> acc
src --> acc
acc --> match
match --> out
@enduml`,

  screen: `@startuml
title Screen: first automated decision wave
[Screened cohort] as m
package "Auto-decision (configurable)" {
  [Rank by match] <<focus>> as rank
  [Reject bottom X%\\n< Y% match · audited] <<focus>> as rej
}
[Early-career\\nnever auto-rejected] <<gate>> as fair
[Passed → Interview] as out
m --> rank
rank --> rej
rej --> out : survivors
m --> fair : protected
fair --> out
@enduml`,

  interview: `@startuml
title Interview: automate or assign a slot
[Cleared screening] as s
package "Schedule" {
  [Self-schedule link\\ncandidate picks a slot] <<focus>> as auto
  [Manual slot\\nrecruiter assigns] <<gate>> as man
}
[Interview booked] as out
s --> auto
s --> man
auto --> out
man --> out
@enduml`,

  offer: `@startuml
title Offer: a human extends, the candidate decides
[Interview pass] as i
[Draft offer\\nband midpoint] <<focus>> as draft
[Recruiter: send offer] <<gate>> as ext
[Candidate\\naccept / decline] <<gate>> as cand
i --> draft
draft --> ext
ext --> cand : secure token link
@enduml`,

  hired: `@startuml
title Hired: onboarding kicks off
[Offer accepted] <<gate>> as acc
[Move to Hired] <<focus>> as hire
[Onboarding\\nwelcome · first week] <<focus>> as onb
acc --> hire
hire --> onb
@enduml`,
};
