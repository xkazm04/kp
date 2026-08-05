# Scan lenses — reference for /scan-sweep

One section per lens. `Match` is the same keyword rule the Personas app uses
to bundle lenses for a context — apply it to the context's attributes when no
explicit `--lenses` list was passed.

## code-optimizer — Code Optimizer ⚡

Group: technical
Match: `/performance|render|bundle|query|slow|cache|optim/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies performance bottlenecks and optimization opportunities

Anchor examples:
- Reduce bundle size
- Optimize database queries
- Improve render performance

## security-auditor — Security Auditor 🔒

Group: technical
Match: `/auth|login|token|secret|password|credential|session|encrypt|permission/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies security vulnerabilities and best practice violations

Anchor examples:
- XSS prevention
- SQL injection risks
- Authentication gaps

## architecture-analyst — Architecture Analyst 🏗️

Group: technical
Match: `/architect|module|component|layer|service|pattern|coupling|abstract/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Evaluates system architecture and suggests structural improvements

Anchor examples:
- Reduce coupling
- Improve modularity
- Better separation of concerns

## test-strategist — Test Strategist 🧪

Group: technical
Match: `/test|spec|coverage|mock|assert|e2e|integration|unit/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies gaps in test coverage and suggests testing strategies

Anchor examples:
- Missing edge cases
- Integration test gaps
- E2E scenarios

## dependency-auditor — Dependency Auditor 📦

Group: technical
Match: `/package|dependency|import|library|version|npm|cargo/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Analyzes dependencies for updates, vulnerabilities, and bloat

Anchor examples:
- Outdated packages
- Unused dependencies
- Version conflicts

## ux-reviewer — UX Reviewer 🎨

Group: user
Match: `/ui|ux|component|page|view|form|modal|button|layout|style/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Reviews user experience patterns and suggests improvements

Anchor examples:
- Loading states
- Error handling UX
- Navigation clarity

## accessibility-checker — Accessibility Checker ♿

Group: user
Match: `/a11y|accessibility|aria|wcag|screen.?reader|keyboard|contrast/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies accessibility issues and WCAG compliance gaps

Anchor examples:
- Missing ARIA labels
- Color contrast
- Keyboard navigation

## mobile-specialist — Mobile Specialist 📱

Group: user
Match: `/mobile|responsive|viewport|touch|swipe|tablet/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Evaluates mobile experience and responsive design

Anchor examples:
- Touch targets
- Viewport handling
- Mobile performance

## error-handler — Error Handler 🚨

Group: user
Match: `/error|exception|catch|boundary|fallback|retry|toast|alert/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Reviews error handling, recovery flows, and user messaging

Anchor examples:
- Graceful degradation
- Retry logic
- Error boundaries

## onboarding-designer — Onboarding Designer 🎯

Group: user
Match: `/onboard|wizard|setup|welcome|tutorial|getting.?started/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Evaluates first-time user experience and onboarding flows

Anchor examples:
- Setup wizards
- Progressive disclosure
- Empty states

## feature-scout — Feature Scout 🔭

Group: business
Match: `/feature|roadmap|missing|todo|placeholder|future/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies missing features and enhancement opportunities

Anchor examples:
- Competitive features
- User-requested features
- Market gaps

## monetization-advisor — Monetization Advisor 💰

Group: business
Match: `/billing|payment|subscription|plan|pricing|tier|premium/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Suggests revenue optimization and pricing strategies

Anchor examples:
- Premium features
- Usage limits
- Conversion funnels

## analytics-planner — Analytics Planner 📊

Group: business
Match: `/analytics|tracking|event|metric|telemetry|log/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Plans analytics instrumentation and data collection

Anchor examples:
- Event tracking
- Funnel analysis
- User behavior insights

## documentation-auditor — Documentation Auditor 📝

Group: business
Match: `/doc|readme|comment|api.?doc|jsdoc|guide/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Reviews documentation completeness and quality

Anchor examples:
- API docs
- README quality
- Code comments

## growth-hacker — Growth Hacker 🚀

Group: business
Match: `/share|referral|invite|social|viral|notification/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies growth opportunities and viral mechanics

Anchor examples:
- Sharing features
- Referral programs
- Network effects

## tech-debt-tracker — Tech Debt Tracker 🏦

Group: mastermind
Match: `/debt|legacy|workaround|hack|deprecated|fixme|todo/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Catalogs technical debt and prioritizes repayment

Anchor examples:
- Legacy code
- Missing abstractions
- Workarounds

## innovation-catalyst — Innovation Catalyst 💡

Group: mastermind
Match: `/ai|ml|machine.?learn|llm|agent|automat|innovat/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Suggests innovative approaches and paradigm shifts

Anchor examples:
- AI integration
- New architectures
- Emerging patterns

## risk-assessor — Risk Assessor ⚠️

Group: mastermind
Match: `/risk|single.?point|scale|failover|backup|disaster|recovery/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies project risks and mitigation strategies

Anchor examples:
- Single points of failure
- Scaling risks
- Data loss scenarios

## integration-planner — Integration Planner 🔗

Group: mastermind
Match: `/api|webhook|integration|sync|external|third.?party|oauth/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Plans system integrations and API design

Anchor examples:
- Third-party APIs
- Webhook design
- Data synchronization

## devops-optimizer — DevOps Optimizer 🔧

Group: mastermind
Match: `/ci|cd|deploy|docker|pipeline|build|monitor|infra/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Optimizes build, deploy, and operations workflows

Anchor examples:
- CI/CD pipelines
- Docker optimization
- Monitoring gaps

## bounty-hunter — Bounty Hunter 🏴‍☠️

Group: technical
Match: `/exploit|vulnerab|race.?condition|edge.?case|logic.?flaw|inconsisten|data.?leak|bounty/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Scans for exploitable bugs, logic flaws, and edge cases that qualify for bug bounty programs — pricing anomalies, data inconsistencies, rule violations, race conditions, and UI/logic mismatches

Anchor examples:
- Pricing calculation errors
- Race conditions in state updates
- Inconsistent validation rules
- Edge cases in boundary logic
- Data leaks between user contexts

## business-strategist — Business Strategist 💼

Group: business
Match: `/business.?value|monetiz|conversion|retention|competitor|workflow.?friction|revenue|value.?prop/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Finds pure business-value opportunities: monetization, conversion, user retention, missing features competitors have, pricing/packaging surfaces, and workflow friction that costs users money or time. Thinks like a product manager, not an engineer — proposes WHAT to build for value, not refactors.

Anchor examples:
- Add usage-based billing tier
- Reduce onboarding drop-off step
- Export reports customers ask for
- Surface ROI metrics on dashboard

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs. -->
