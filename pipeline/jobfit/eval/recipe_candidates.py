"""Turn ingested job descriptions into RECIPE CANDIDATES for the AI registry.

A recipe (the registry's `recipes/` lane) is mastery: one recurring unit of work
with one central judgment, three to eight activities, connector CATEGORIES and no
organization-specific fact anywhere in it. This module does NOT write recipes. It
writes a DIGEST of candidates - an address (domain plus topic), a proposed slug and
title, three of the recipe's four description fields (`input` is a judgment a job
posting does not carry), activity labels, connector types, map terms and verbatim
JD evidence - so an operator can later run `/assay <path>` inside the registry and
decide which candidates become recipes.

Two run modes, and the offline one is the product property:

- `--no-llm` (or any posting whose provider call fails) uses a deterministic
  heuristic over the JD body. It never touches the network, always produces a
  record, and marks it `confidence: "low"` with a `#heuristic` suffix on `from`.
- the live mode asks one JSON completion per posting through the `jd_ingest` use
  case. Every field is validated against the same schema the heuristic is held to,
  and an invalid candidate is DROPPED with its reason logged in the summary. It is
  never repaired into something the model did not say.

Exit codes follow the package contract (eval/__main__.py): 0 the run happened,
1 a --strict gate failed (a record violated the schema, or nothing was produced),
2 the run could not be performed (unusable flags, no corpus).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

from ._style import _make_styler, should_color
from .intake_corpus import Posting, load_jd_corpus, stratified_distinct_roles
from .runner import glyph, verdict_banner, write_text_lf

FROM_ID = "kp/recipe_candidates@0.1.0"
HEURISTIC_SUFFIX = "#heuristic"

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REGISTRY = "../ai-registry"

ACTIVITY_MIN, ACTIVITY_MAX = 3, 8
MAP_TERMS_MIN = 3
CONFIDENCE_ORDER = {"low": 0, "medium": 1, "high": 2}
DEDUPE_JACCARD = 0.6

# The house rule the registry corpus is written to: no em dash, no en dash. Both
# render as the same long stroke and both have an ASCII twin (" - ").
LONG_DASH_RE = re.compile(r"[–—]")

# ---------------------------------------------------------------- the address

# The 16 kp role families (data/taxonomy.json `role_families`) mapped onto the 10
# domains the registry's recipes lane actually has. Every family is covered; the
# test pins that. The non-obvious ones:
#   healthcare_clinical      -> the lane has no clinical domain; the recurring
#                               units of work that survive de-identification are
#                               records, correspondence and scheduling.
#   life_sciences_research   -> same reason: no research lane; what generalizes is
#                               knowledge curation and reporting.
#   skilled_trades           -> field work is dispatched, scheduled and inspected,
#                               which is the operations lane's craft.
#   frontline_service        -> a frontline shift IS customer support work.
#   hr_people                -> no people lane; hiring and onboarding read as
#                               general professional coordination here.
#   education_academic       -> no education lane; curriculum and assessment work
#                               lands as general professional knowledge work.
ROLE_FAMILY_TO_DOMAIN: dict[str, str] = {
    "software_engineering": "software_engineering",
    "data_ai": "data_ai",
    "product_project": "product_project",
    "healthcare_clinical": "general_professional",
    "life_sciences_research": "general_professional",
    "skilled_trades": "operations_logistics",
    "operations_logistics": "operations_logistics",
    "frontline_service": "customer_support",
    "sales_marketing": "sales_marketing",
    "finance_accounting": "finance_accounting",
    "legal_compliance": "legal_compliance",
    "hr_people": "general_professional",
    "education_academic": "general_professional",
    "creative_design": "creative_design",
    "customer_support": "customer_support",
    "general_professional": "general_professional",
}

DOMAINS = sorted(set(ROLE_FAMILY_TO_DOMAIN.values()))

# Fallback copies, used only when --registry is absent. Both are READ from the
# registry when it is there, because both live with the registry and a copy here
# goes stale the first time either moves. The summary header says which was used.
FALLBACK_CONNECTOR_TYPES: tuple[str, ...] = (
    "advertising", "ai", "analytics", "automation", "bi", "browser_automation",
    "cache", "calendar", "ci_cd", "cloud", "containers", "crm", "database",
    "design", "desktop", "development", "documentation", "ecommerce", "email",
    "finance", "forms", "image_generation", "integration", "knowledge_base",
    "marketing", "messaging", "model_hosting", "monitoring", "notifications",
    "observability", "personalization", "productivity", "project_management",
    "research", "scheduling", "social", "source_control", "spreadsheet",
    "storage", "support", "ticketing", "time_tracking", "transcription",
    "vector_search", "video_generation", "vision", "voice_generation",
    "web_scraping",
)

# `desktop` is in the recorded catalog and is nonetheless BANNED in a recipe:
# every agent has desktop access, so it is a binding to nothing.
BANNED_CONNECTOR_TYPES = frozenset({"desktop"})

FALLBACK_TOPICS: dict[str, tuple[str, ...]] = {
    "creative_design": ("audio", "newsletters", "social-publishing", "video", "visual-assets"),
    "customer_support": ("retention", "service-health", "sla", "ticket-handling"),
    "data_ai": ("agent-context", "data-access", "data-quality"),
    "finance_accounting": ("investing", "revenue", "spend-and-budget"),
    "general_professional": (
        "correspondence", "decisions", "digests", "goals-and-reviews", "knowledge-curation",
    ),
    "legal_compliance": ("compliance-monitoring", "contracts", "deadlines"),
    "operations_logistics": ("approvals", "intake"),
    "product_project": ("customer-feedback", "ideation"),
    "sales_marketing": (
        "community-channels", "conversion-optimization", "lead-handling", "web-analytics",
    ),
    "software_engineering": (
        "code-review", "codebase-health", "cost-safety", "engineering-records",
        "error-triage", "event-routing", "incident-response", "observability",
        "release", "work-intake",
    ),
}

# A level may not hold more than ten child directories. A domain sitting at ten
# topics cannot take a new one without a subdivision, and the summary says so.
TOPIC_CAP = 10


class Registry:
    """What this module needs from the registry, and where it came from."""

    def __init__(
        self,
        topics: dict[str, tuple[str, ...]],
        connector_types: frozenset[str],
        source: str,
    ) -> None:
        self.topics = topics
        self.connector_types = connector_types
        self.source = source

    def allowed_connector(self, value: str) -> bool:
        return value in self.connector_types and value not in BANNED_CONNECTOR_TYPES


def load_registry(path: Path | None) -> Registry:
    """Read topic slugs and connector categories from a registry checkout.

    Tolerant on purpose: an absent checkout, a moved index or a rewritten
    check-recipes.mjs each degrade to the embedded fallback rather than failing a
    run whose real input is the JD corpus.
    """
    if path is None or not path.is_dir():
        return Registry(
            {k: v for k, v in FALLBACK_TOPICS.items()},
            frozenset(FALLBACK_CONNECTOR_TYPES),
            "embedded fallback (registry checkout not found)",
        )

    topics: dict[str, set[str]] = {}
    index = path / "recipes" / "index.json"
    if index.is_file():
        try:
            data = json.loads(index.read_text(encoding="utf-8"))
            entries = data.get("recipes", {})
            rows: Iterable[dict[str, Any]]
            rows = entries.values() if isinstance(entries, dict) else entries
            for row in rows:
                dom, top = row.get("domain"), row.get("topic")
                if isinstance(dom, str) and isinstance(top, str):
                    topics.setdefault(dom, set()).add(top)
        except (OSError, ValueError, AttributeError):
            topics = {}

    connectors: set[str] = set()
    gate = path / "scripts" / "check-recipes.mjs"
    if gate.is_file():
        try:
            text = gate.read_text(encoding="utf-8")
            m = re.search(r"RECORDED_CONNECTOR_TYPES\s*=\s*new Set\(\[(.*?)\]\)", text, re.S)
            if m:
                connectors = set(re.findall(r"['\"]([a-z_]+)['\"]", m.group(1)))
        except OSError:
            connectors = set()

    if not topics and not connectors:
        return Registry(
            {k: v for k, v in FALLBACK_TOPICS.items()},
            frozenset(FALLBACK_CONNECTOR_TYPES),
            f"embedded fallback (nothing readable under {path})",
        )

    resolved_topics = (
        {d: tuple(sorted(t)) for d, t in topics.items()} if topics else dict(FALLBACK_TOPICS)
    )
    return Registry(
        resolved_topics,
        frozenset(connectors or FALLBACK_CONNECTOR_TYPES),
        f"registry checkout at {path}",
    )


# ------------------------------------------------------------- the heuristic

_BULLET_RE = re.compile(r"^\s*(?:[-*•o·]|\d+[.)])\s+")
_HEADING_RE = re.compile(
    r"(responsibilit|duties|what you will do|what you'll do|the role|your day|"
    r"key tasks|accountabilit)",
    re.I,
)
_ACTION_VERBS = frozenset(
    """manage maintain coordinate develop build design review analyze analyse report
    prepare process support ensure monitor track handle respond resolve deliver plan
    lead create write test deploy schedule greet answer assist collaborate communicate
    document evaluate implement improve install inspect negotiate operate optimize
    oversee perform provide recruit research sell serve train update verify audit
    forecast reconcile onboard drive execute identify measure own partner produce run
    source teach translate troubleshoot administer approve assemble assess assign
    calculate check clean compile conduct configure confirm deliverables distribute
    draft escalate facilitate file follow generate inform inventory issue log
    negotiating order pack pick present prioritize process publish record recommend
    reply resolve retain review sample screen ship sort submit summarize supervise
    validate""".split()
)
_STOPWORDS = frozenset(
    """the and for with that this from will your you our are have has been they their
    them who whom which what when where able ability skills skill experience years year
    work works working team teams role roles job jobs company companies must should
    would could required requirement requirements including include includes strong
    excellent good great high highly plus etc other others more most very well within
    across into onto over under about also than then such per each any all its his her
    was were being both while during after before because there here these those
    position positions candidate candidates applicant applicants opportunity benefits
    salary hour hours day days week weeks month months full time part environment
    knowledge understanding communication written verbal degree diploma school college
    university preferred desired minimum maximum ideal ideally new used using use
    ensure ensuring provide providing perform performing support supporting related
    ability duties responsibilities responsibility""".split()
)

# Words that pass the stopword filter, recur across a JD, and still make a useless
# theme ("positive attitude", "prior experience", "various tasks"). A theme is the
# AREA half of a recipe title, so an adjective or a preposition there produces a
# slug like `prior-preparation` that names nothing.
_WEAK_TERMS = frozenset(
    """prior positive through various general daily weekly monthly appropriate relevant
    effective successful multiple several additional current necessary important
    accurate timely proper efficient professional detailed complete overall ongoing
    regular routine standard basic advanced senior junior level levels task tasks
    duty activity activities items item area areas people person staff members member
    others everyone anyone something anything nothing however therefore whether
    already always never often sometimes usually mostly largely fully partly clearly
    directly closely quickly first second third final next last best better
    dont wont cant below above further within around toward towards along
    expertise capabilities like make makes made though driven occurs occur involve
    involves involved receive receives received increase increases interested
    previous listed considered underlying demonstrated""".split()
)


def _is_weak(word: str) -> bool:
    """A keyword no theme should be built from.

    The plural test is the one worth naming: a JD writes "assists clients" and
    "documents each interaction", so a verb wearing an -s survives the verb filter
    and becomes an AREA. `assists-handling` names nothing.
    """
    if word in _STOPWORDS or word in _ACTION_VERBS or word in _WEAK_TERMS:
        return True
    return word.endswith("s") and word[:-1] in _ACTION_VERBS

_ACTIVITY_NOUNS: tuple[tuple[frozenset[str], str], ...] = (
    (frozenset({"review", "audit", "inspect", "assess", "evaluate", "check", "verify"}), "review"),
    (frozenset({"monitor", "track", "measure", "log", "record"}), "monitoring"),
    (frozenset({"report", "analyze", "analyse", "forecast", "summarize", "compile"}), "reporting"),
    (frozenset({"schedule", "coordinate", "manage", "plan", "assign", "supervise"}), "coordination"),
    (frozenset({"prepare", "process", "produce", "draft", "generate", "issue", "file"}), "preparation"),
    (frozenset({"design", "build", "develop", "create", "implement", "deploy", "configure"}), "build"),
    (frozenset({"train", "teach", "onboard", "facilitate"}), "enablement"),
    (frozenset({"respond", "resolve", "escalate", "serve", "greet", "answer", "assist"}), "handling"),
)

_CONNECTOR_KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("jira", "asana", "trello", "servicenow", "ticketing", "tickets"), "ticketing"),
    (("salesforce", "hubspot", "crm", "pipedrive"), "crm"),
    (("datadog", "grafana", "prometheus", "splunk", "nagios", "uptime"), "monitoring"),
    (("github", "gitlab", "bitbucket", "version control", "source control"), "source_control"),
    (("excel", "spreadsheet", "spreadsheets", "google sheets", "sheets"), "spreadsheet"),
    (("slack", "microsoft teams", "chat"), "messaging"),
    (("sql", "postgres", "postgresql", "mysql", "oracle", "database", "databases"), "database"),
    (("tableau", "power bi", "powerbi", "looker", "dashboards"), "bi"),
    (("email", "outlook", "gmail", "mailbox", "correspondence"), "email"),
    (("calendar", "calendars", "appointments", "scheduling"), "calendar"),
    (("payroll", "invoice", "invoices", "invoicing", "billing", "quickbooks", "sap", "ledger"), "finance"),
    (("sharepoint", "confluence", "notion", "wiki", "documentation"), "knowledge_base"),
    (("aws", "azure", "gcp", "cloud"), "cloud"),
    (("jenkins", "continuous integration", "ci cd", "pipelines"), "ci_cd"),
    (("docker", "kubernetes", "containers"), "containers"),
    (("figma", "photoshop", "illustrator", "indesign"), "design"),
    (("zendesk", "freshdesk", "helpdesk", "help desk"), "support"),
    (("shopify", "ecommerce", "e commerce"), "ecommerce"),
    (("google analytics", "analytics"), "analytics"),
    (("shipping", "warehouse", "inventory", "logistics", "fleet"), "automation"),
    (("survey", "surveys", "forms", "intake form"), "forms"),
    (("timesheet", "timesheets", "time tracking"), "time_tracking"),
    (("social media", "linkedin", "instagram", "facebook", "twitter"), "social"),
    (("advertising", "adwords", "ad campaigns", "ppc"), "advertising"),
    (("research", "literature", "market research"), "research"),
)


def _segments(body: str) -> list[str]:
    """Responsibility-like lines from a JD body.

    Real corpora arrive both ways: bulleted postings, and scraped postings whose
    bullets were flattened into blank-line-separated paragraphs (the calibration
    corpus is the second). So bullets and headings are used when present, and the
    fallback is every long enough line that carries an action verb.
    """
    lines: list[str] = []
    for chunk in body.replace("\r\n", "\n").split("\n"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if len(chunk) > 400:
            parts = [p.strip() for p in re.split(r"(?<=[.;])\s+", chunk) if p.strip()]
            lines.extend(parts or [chunk])
        else:
            lines.append(chunk)

    marked: list[str] = []
    under_heading = False
    for line in lines:
        bulleted = bool(_BULLET_RE.match(line))
        clean = _BULLET_RE.sub("", line).strip()
        if _HEADING_RE.search(clean) and len(clean) < 80:
            under_heading = True
            continue
        if len(clean) < 25:
            continue
        words = set(re.findall(r"[a-z]+", clean.lower()))
        if bulleted or under_heading or (words & _ACTION_VERBS):
            marked.append(clean)
    if not marked:
        marked = [ln for ln in lines if len(ln) >= 40]
    return marked[:40]


def _keywords(text: str, exclude: frozenset[str] = frozenset()) -> list[str]:
    words = re.findall(r"[a-z][a-z0-9]{3,}", text.lower())
    return [w for w in words if not _is_weak(w) and w not in exclude]


def _theme_phrase(keyword: str, segments: Sequence[str], exclude: frozenset[str]) -> str:
    """The keyword, widened to a two word phrase when one recurs beside it."""
    bigrams: Counter[str] = Counter()
    for seg in segments:
        tokens = _keywords(seg, exclude)
        for a, b in zip(tokens, tokens[1:]):
            if keyword in (a, b) and a != b:
                bigrams[f"{a} {b}"] += 1
    for phrase, count in bigrams.most_common():
        if count >= 2:
            return phrase
    return keyword


def _cluster(
    segments: Sequence[str], exclude: frozenset[str] = frozenset()
) -> list[tuple[str, list[str]]]:
    """Greedy keyword clustering: up to three themes, each with its own lines."""
    remaining = list(segments)
    clusters: list[tuple[str, list[str]]] = []
    while remaining and len(clusters) < 3:
        df: Counter[str] = Counter()
        for seg in remaining:
            for kw in set(_keywords(seg, exclude)):
                df[kw] += 1
        best = next((kw for kw, c in df.most_common() if c >= 2), None)
        if best is None:
            break
        claimed = [s for s in remaining if best in set(_keywords(s, exclude))]
        remaining = [s for s in remaining if s not in claimed]
        clusters.append((_theme_phrase(best, claimed, exclude), claimed))
    if not clusters and segments:
        df = Counter()
        for seg in segments:
            for kw in set(_keywords(seg, exclude)):
                df[kw] += 1
        theme = df.most_common(1)[0][0] if df else "the role"
        clusters.append((theme, list(segments)))
    return clusters


def _org_terms(posting: Posting) -> frozenset[str]:
    """Words that name THIS organization rather than the craft.

    A company name recurs across a JD as reliably as a real theme does, so it wins
    the clustering and produces `cigna-review` or `grant-thornton-build`. The
    mapping rule is that organization specific facts are charter, not recipe.
    """
    return frozenset(w for w in re.findall(r"[a-z][a-z0-9]{2,}", posting.company.lower()))


def _activity_noun(lines: Sequence[str]) -> str:
    verbs = Counter()
    for line in lines:
        for w in re.findall(r"[a-z]+", line.lower()):
            if w in _ACTION_VERBS:
                verbs[w] += 1
    for verb, _ in verbs.most_common():
        for group, noun in _ACTIVITY_NOUNS:
            if verb in group:
                return noun
    return "handling"


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug)


def _phrase(line: str, limit: int = 80) -> str:
    """One activity label: an imperative phrase, trimmed at a word boundary."""
    text = _BULLET_RE.sub("", line).strip()
    text = re.sub(
        r"^(?:you will|you'll|will be |responsible for|responsibilities include|"
        r"the role includes|duties include)\s*",
        "",
        text,
        flags=re.I,
    ).strip()
    text = LONG_DASH_RE.sub(" - ", text)
    text = re.sub(r"\s+", " ", text)
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip(",;:")
    return text[:1].upper() + text[1:] if text else text


def _generic_activities(theme: str) -> list[str]:
    return [
        f"Gather the {theme} items the period produced",
        f"Judge which {theme} items need action now",
        f"Carry out the {theme} work that was chosen",
        f"Hand the {theme} result to whoever depends on it",
    ]


def _connectors_for(text: str, registry: Registry) -> list[str]:
    lowered = f" {text.lower()} "
    found: list[str] = []
    for needles, ctype in _CONNECTOR_KEYWORDS:
        if ctype in found or not registry.allowed_connector(ctype):
            continue
        if any(f" {n} " in lowered or f" {n}." in lowered for n in needles):
            found.append(ctype)
    return found[:4]


def _pick_topic(domain: str, terms: Sequence[str], registry: Registry) -> str | None:
    """An existing topic slug for this domain when one shares a word with the theme."""
    haystack = {t for term in terms for t in re.findall(r"[a-z]+", term.lower())}
    best: tuple[int, str] | None = None
    for topic in registry.topics.get(domain, ()):
        tokens = set(topic.split("-"))
        hits = len(tokens & haystack)
        if hits and (best is None or hits > best[0]):
            best = (hits, topic)
    return best[1] if best else None


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def heuristic_candidates(posting: Posting, registry: Registry) -> list[dict[str, Any]]:
    """One to three deterministic candidates for a posting. No network, ever."""
    domain = ROLE_FAMILY_TO_DOMAIN.get(posting.role_family, "general_professional")
    segments = _segments(posting.body)
    if not segments:
        segments = [posting.title]
    org = _org_terms(posting)
    title_terms = _keywords(posting.title, org) or [_slugify(posting.title)]

    out: list[dict[str, Any]] = []
    used_slugs: set[str] = set()
    for theme, lines in _cluster(segments, org):
        noun = _activity_noun(lines)
        slug = _slugify(f"{theme} {noun}") or _slugify(f"{posting.title} {noun}")
        if slug in used_slugs:
            slug = f"{slug}-{len(used_slugs) + 1}"
        used_slugs.add(slug)

        labels = []
        for line in lines:
            label = _phrase(line)
            if label and label not in labels:
                labels.append(label)
            if len(labels) >= ACTIVITY_MAX:
                break
        while len(labels) < ACTIVITY_MIN:
            for generic in _generic_activities(theme):
                if generic not in labels:
                    labels.append(generic)
                if len(labels) >= ACTIVITY_MIN:
                    break

        cluster_terms = [kw for kw, _ in Counter(
            kw for line in lines for kw in _keywords(line, org)
        ).most_common(6)]
        map_terms: list[str] = []
        for term in [*re.findall(r"[a-z]+", theme), *title_terms, *cluster_terms,
                     posting.role_family, domain]:
            term = term.lower()
            if term and term not in map_terms:
                map_terms.append(term)

        title_text = f"{theme} {noun}".strip()
        record = {
            "ts": _iso_now(),
            "source": f"jd:{posting.id}",
            "sources": [f"jd:{posting.id}"],
            "role_title": posting.title,
            "role_family": posting.role_family,
            "proposed_domain": domain,
            "proposed_topic": _pick_topic(domain, [theme, noun, *cluster_terms], registry),
            "proposed_slug": slug,
            "proposed_title": title_text[:1].upper() + title_text[1:],
            "need": (
                f"Without this, the {theme} work a {posting.title.lower()} carries piles up "
                f"until it is handled late and differently each time."
            ),
            "core_action": (
                f"Judge which {theme} items need action now and how each one should be "
                f"handled, given what the last period already settled."
            ),
            "output": (
                f"A handled set of {theme} items, with the decisions recorded where the "
                f"next person to touch them can read why."
            ),
            "activity_labels": labels[:ACTIVITY_MAX],
            "connector_types": _connectors_for(" ".join(lines), registry),
            "map_terms": map_terms[:10],
            "evidence": lines[:4],
            "confidence": "low",
            "from": FROM_ID + HEURISTIC_SUFFIX,
        }
        out.append(_scrub(record))
        if len(out) >= 4:
            break
    return out


def _scrub(value: Any) -> Any:
    """Replace every long dash with its ASCII twin, everywhere in a record."""
    if isinstance(value, str):
        return LONG_DASH_RE.sub(" - ", value)
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items()}
    return value


# ------------------------------------------------------------- the validation

_REQUIRED_STRINGS = (
    "ts", "source", "role_title", "role_family", "proposed_domain", "proposed_slug",
    "proposed_title", "need", "core_action", "output", "confidence", "from",
)

# Connector IDS that a model reaches for when it has been told "connector types".
# They are already outside the recorded category list, so the check below rejects
# them; naming them buys a message that says WHY rather than "not recorded".
CONNECTOR_ID_TELLS = frozenset(
    {"plausible", "datadog", "jira", "salesforce", "hubspot", "github", "gitlab",
     "slack", "notion", "zendesk", "tableau", "quickbooks", "deepgram", "stripe"}
)


def _walk_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for v in value:
            yield from _walk_strings(v)
    elif isinstance(value, dict):
        for v in value.values():
            yield from _walk_strings(v)


def validate_candidate(rec: Any, registry: Registry) -> list[str]:
    """Every reason this record is not a usable candidate. Empty means valid."""
    problems: list[str] = []
    if not isinstance(rec, dict):
        return ["not a JSON object"]

    for key in _REQUIRED_STRINGS:
        value = rec.get(key)
        if not isinstance(value, str) or not value.strip():
            problems.append(f"{key} is missing or not a non-empty string")

    if rec.get("confidence") not in CONFIDENCE_ORDER:
        problems.append(
            f"confidence {rec.get('confidence')!r} is outside [low, medium, high]"
        )
    if rec.get("proposed_domain") not in DOMAINS:
        problems.append(
            f"proposed_domain {rec.get('proposed_domain')!r} is outside the lane's domains"
        )
    if rec.get("role_family") not in ROLE_FAMILY_TO_DOMAIN:
        problems.append(f"role_family {rec.get('role_family')!r} is not a kp role family")

    slug = rec.get("proposed_slug")
    if isinstance(slug, str) and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        problems.append(f"proposed_slug {slug!r} is not kebab-case")

    topic = rec.get("proposed_topic")
    if topic is not None:
        if not isinstance(topic, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", topic):
            problems.append(f"proposed_topic {topic!r} is neither null nor a kebab slug")
        elif topic not in registry.topics.get(rec.get("proposed_domain", ""), ()):
            problems.append(
                f"proposed_topic {topic!r} does not exist under {rec.get('proposed_domain')!r}"
            )

    labels = rec.get("activity_labels")
    if not isinstance(labels, list) or not all(
        isinstance(x, str) and x.strip() for x in labels
    ):
        problems.append("activity_labels must be a list of non-empty strings")
    elif not ACTIVITY_MIN <= len(labels) <= ACTIVITY_MAX:
        problems.append(
            f"activity_labels has {len(labels)} entries (the contract asks "
            f"{ACTIVITY_MIN}-{ACTIVITY_MAX})"
        )

    connectors = rec.get("connector_types")
    if not isinstance(connectors, list) or not all(isinstance(c, str) for c in connectors):
        problems.append("connector_types must be a list of strings")
    else:
        for c in connectors:
            if c in BANNED_CONNECTOR_TYPES:
                problems.append(
                    f"connector_types carries {c!r}, which is banned: every agent has "
                    f"desktop access, so it binds to nothing"
                )
            elif c in CONNECTOR_ID_TELLS:
                problems.append(
                    f"connector_types carries {c!r}, which is a connector ID rather than "
                    f"a category"
                )
            elif not registry.allowed_connector(c):
                problems.append(f"connector_types carries {c!r}, not a recorded category")

    terms = rec.get("map_terms")
    if not isinstance(terms, list) or not all(isinstance(t, str) and t.strip() for t in terms):
        problems.append("map_terms must be a list of non-empty strings")
    elif len(terms) < MAP_TERMS_MIN:
        problems.append(f"map_terms has {len(terms)} entries (at least {MAP_TERMS_MIN})")

    evidence = rec.get("evidence")
    if not isinstance(evidence, list) or not all(
        isinstance(e, str) and e.strip() for e in evidence
    ):
        problems.append("evidence must be a list of non-empty strings")
    elif not evidence:
        problems.append("evidence is empty; a candidate with no JD line behind it is a guess")

    for s in _walk_strings(rec):
        if LONG_DASH_RE.search(s):
            problems.append(
                "a long dash reached the record; the corpus is written with the ASCII twin"
            )
            break

    return problems


# ----------------------------------------------------------------- the live mode

LIVE_SYSTEM = (
    "You map job descriptions onto RECIPE CANDIDATES for a craft registry.\n"
    "A recipe is ONE recurring unit of work with ONE central judgment, held by "
    "anyone in that job family at any organization.\n"
    "Rules, all of them binding:\n"
    "- A responsibility bullet is an ADDRESS (domain plus topic) plus a candidate.\n"
    "- A duty line becomes an activity label: a phrase, not an instruction.\n"
    "- An accountability line becomes the output.\n"
    "- Why the role exists becomes the need, phrased as what goes wrong without it.\n"
    "- A named tool (Jira, Salesforce, Datadog) becomes a connector CATEGORY, never "
    "the tool name. Never emit 'desktop'.\n"
    "- Organization specific facts (headcount, reporting line, named internal systems, "
    "locations, salaries) are charter, not recipe. Drop them.\n"
    "- Never use an em dash or an en dash. Use ' - '.\n"
    "Return JSON only."
)


def _live_prompt(posting: Posting, domain: str, registry: Registry) -> str:
    topics = registry.topics.get(domain, ())
    connectors = sorted(registry.connector_types - BANNED_CONNECTOR_TYPES)
    body = posting.body[:6000]
    return (
        f"Job title: {posting.title}\n"
        f"Role family: {posting.role_family}\n"
        f"Registry domain for this family: {domain}\n"
        f"Existing topics under that domain: {', '.join(topics) or '(none)'}\n"
        f"Allowed connector categories: {', '.join(connectors)}\n\n"
        f"Job description:\n{body}\n\n"
        "Return {\"candidates\": [...]} with 1 to 3 entries. Each entry:\n"
        '{"proposed_topic": one of the existing topics or null,\n'
        ' "proposed_slug": kebab-case, area plus activity,\n'
        ' "proposed_title": area plus activity, unambiguous in a list of 200 recipes,\n'
        ' "need": what goes wrong without this work,\n'
        ' "core_action": the judgment at the center, one or two sentences,\n'
        ' "output": what exists in the world when it is done well,\n'
        f' "activity_labels": {ACTIVITY_MIN} to {ACTIVITY_MAX} phrases in order,\n'
        ' "connector_types": categories from the allowed list, possibly empty,\n'
        ' "map_terms": at least 3 lowercase words that would route a JD here,\n'
        ' "evidence": 1 to 4 VERBATIM lines copied from the job description,\n'
        ' "confidence": "low" | "medium" | "high"}\n'
    )


def _from_live(payload: Any, posting: Posting, domain: str) -> list[dict[str, Any]]:
    rows = payload.get("candidates") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    now = _iso_now()
    for row in rows[:4]:
        if not isinstance(row, dict):
            out.append({"__invalid__": "not a JSON object"})
            continue
        rec = {
            "ts": now,
            "source": f"jd:{posting.id}",
            "sources": [f"jd:{posting.id}"],
            "role_title": posting.title,
            "role_family": posting.role_family,
            "proposed_domain": domain,
            "proposed_topic": row.get("proposed_topic"),
            "proposed_slug": row.get("proposed_slug"),
            "proposed_title": row.get("proposed_title"),
            "need": row.get("need"),
            "core_action": row.get("core_action"),
            "output": row.get("output"),
            "activity_labels": row.get("activity_labels"),
            "connector_types": row.get("connector_types"),
            "map_terms": row.get("map_terms"),
            "evidence": row.get("evidence"),
            "confidence": row.get("confidence"),
            "from": FROM_ID,
        }
        out.append(rec)
    return out


def _resolve_provider() -> Any:
    try:
        from ..llm.registry import resolve_provider

        provider = resolve_provider("jd_ingest", timeout=120)
    except Exception:
        return None
    if provider is None:
        return None
    try:
        if not provider.available():
            return None
    except Exception:
        return None
    return provider


def _call_provider(provider: Any, prompt: str) -> Any:
    if hasattr(provider, "complete_json"):
        return provider.complete_json(prompt, system=LIVE_SYSTEM, expected_keys=("candidates",))
    result = provider.complete(prompt, system=LIVE_SYSTEM)
    text = getattr(result, "text", result)
    return json.loads(text)


# ------------------------------------------------------------------- dedupe

def _jaccard(a: Sequence[str], b: Sequence[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def dedupe(records: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold cross-posting duplicates together.

    Same proposed_slug, or overlapping map terms inside one domain, is one craft
    seen twice. The higher confidence record wins the prose; the evidence and the
    sources of both are kept, because a candidate two postings agree on is exactly
    the one an operator should look at first.
    """
    kept: list[dict[str, Any]] = []
    for rec in records:
        match = None
        for existing in kept:
            if existing["proposed_domain"] != rec["proposed_domain"]:
                continue
            if existing["proposed_slug"] == rec["proposed_slug"]:
                match = existing
                break
            if _jaccard(existing.get("map_terms", []), rec.get("map_terms", [])) >= DEDUPE_JACCARD:
                match = existing
                break
        if match is None:
            kept.append(dict(rec))
            continue

        winner, loser = match, rec
        if CONFIDENCE_ORDER.get(rec["confidence"], 0) > CONFIDENCE_ORDER.get(match["confidence"], 0):
            winner, loser = rec, match
        merged = dict(winner)
        merged["source"] = match["source"]
        sources: list[str] = []
        for s in [*match.get("sources", [match["source"]]), *rec.get("sources", [rec["source"]])]:
            if s not in sources:
                sources.append(s)
        merged["sources"] = sources
        evidence: list[str] = []
        for e in [*match.get("evidence", []), *rec.get("evidence", [])]:
            if e not in evidence:
                evidence.append(e)
        merged["evidence"] = evidence[:8]
        terms: list[str] = []
        for t in [*winner.get("map_terms", []), *loser.get("map_terms", [])]:
            if t not in terms:
                terms.append(t)
        merged["map_terms"] = terms[:12]
        kept[kept.index(match)] = merged
    return kept


# ------------------------------------------------------------------ reporting

def summarize(
    records: Sequence[dict[str, Any]],
    *,
    mode: str,
    corpus: Path,
    registry: Registry,
    postings: int,
    drops: Sequence[str],
    jsonl_path: Path,
    notes: Sequence[str] = (),
    color: bool = False,
) -> str:
    st = _make_styler(color)
    by_domain: dict[str, dict[str | None, list[dict[str, Any]]]] = {}
    for rec in records:
        by_domain.setdefault(rec["proposed_domain"], {}).setdefault(
            rec.get("proposed_topic"), []
        ).append(rec)

    lines: list[str] = []
    lines.append(
        verdict_banner(
            [
                f"{len(records)} candidates",
                f"{len(by_domain)} domains",
                f"{postings} postings",
                f"{len(drops)} dropped" if drops else "",
            ],
            passed=bool(records) and not drops,
            s=st,
        )
    )
    lines.append("")
    lines.append("# Recipe candidates from ingested job descriptions")
    lines.append("")
    lines.append(f"- Run mode: {mode}")
    lines.append(f"- Corpus: `{corpus.as_posix()}` ({postings} postings sampled)")
    lines.append(f"- Registry vocabulary: {registry.source}")
    lines.append(f"- Candidates after dedupe: {len(records)}")
    lines.append(f"- Dropped as invalid: {len(drops)}")
    for note in notes:
        lines.append(f"- {note}")
    lines.append("")
    lines.append(
        "A candidate is not a recipe. It is an address plus enough evidence for an "
        "operator to decide whether the craft behind it is real."
    )
    lines.append("")

    for domain in sorted(by_domain):
        existing = registry.topics.get(domain, ())
        lines.append(f"## {domain}")
        lines.append("")
        if len(existing) >= TOPIC_CAP:
            lines.append(
                f"`{domain}` already holds {len(existing)} topics, which is the cap. Any "
                f"candidate below that does not fit an existing topic forces a subdivision "
                f"of this domain before it can land."
            )
            lines.append("")
        for topic in sorted(by_domain[domain], key=lambda t: (t is None, t or "")):
            heading = f"### {topic}" if topic else "### (no existing topic)"
            lines.append(heading)
            lines.append("")
            lines.append("| slug | title | confidence | sources |")
            lines.append("| --- | --- | --- | --- |")
            for rec in sorted(by_domain[domain][topic], key=lambda r: r["proposed_slug"]):
                srcs = ", ".join(rec.get("sources", [rec["source"]]))
                conf = f"{glyph(rec['confidence'] != 'low')} {rec['confidence']}"
                lines.append(
                    f"| `{rec['proposed_slug']}` | {rec['proposed_title']} | {conf} | {srcs} |"
                )
            lines.append("")

    if drops:
        lines.append("## Dropped")
        lines.append("")
        lines.append(
            "A candidate that failed the schema is never repaired into something the "
            "model did not say. It is dropped, with its reason."
        )
        lines.append("")
        for drop in drops[:60]:
            lines.append(f"- {drop}")
        if len(drops) > 60:
            lines.append(f"- ... and {len(drops) - 60} more")
        lines.append("")

    lines.append("## Hand off")
    lines.append("")
    try:
        shown = jsonl_path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        shown = jsonl_path.as_posix()
    lines.append(f"Run /assay {shown} --domain <d> inside the registry")
    lines.append("")
    return "\n".join(lines)


# ----------------------------------------------------------------------- main

def _candidates_for_posting(
    posting: Posting,
    registry: Registry,
    *,
    provider: Any,
) -> tuple[list[dict[str, Any]], str | None]:
    """Candidates for one posting plus the reason the live path was not used."""
    domain = ROLE_FAMILY_TO_DOMAIN.get(posting.role_family, "general_professional")
    if provider is None:
        return heuristic_candidates(posting, registry), None
    try:
        payload = _call_provider(provider, _live_prompt(posting, domain, registry))
    except Exception as exc:  # provider refused, timed out, or returned no JSON
        return (
            heuristic_candidates(posting, registry),
            f"jd:{posting.id}: provider call failed ({type(exc).__name__}), fell back "
            f"to the heuristic",
        )
    records = [_scrub(r) for r in _from_live(payload, posting, domain)]
    if not records:
        return (
            heuristic_candidates(posting, registry),
            f"jd:{posting.id}: the provider returned no candidates, fell back to the "
            f"heuristic",
        )
    return records, None


def run(
    *,
    corpus: Path,
    registry: Registry,
    roles: int,
    no_llm: bool,
    wall_minutes: float,
    out: Path,
    summary: Path,
    color: bool = False,
) -> tuple[int, int, str]:
    """Returns (written, dropped, summary markdown)."""
    postings = load_jd_corpus(corpus)
    sample = stratified_distinct_roles(postings, roles)

    provider = None if no_llm else _resolve_provider()
    mode = "offline heuristic (--no-llm)" if no_llm else (
        "live provider (jd_ingest)" if provider is not None
        else "offline heuristic (no provider available)"
    )

    raw: list[dict[str, Any]] = []
    notes: list[str] = []
    deadline = time.monotonic() + wall_minutes * 60.0
    for i, posting in enumerate(sample):
        if provider is not None and time.monotonic() > deadline:
            notes.append(
                f"Wall budget of {wall_minutes:g} minutes reached after {i} postings; the "
                f"remaining {len(sample) - i} ran on the heuristic."
            )
            provider = None
        records, note = _candidates_for_posting(posting, registry, provider=provider)
        if note:
            notes.append(note)
        raw.extend(records)

    valid: list[dict[str, Any]] = []
    drops: list[str] = []
    for rec in raw:
        problems = validate_candidate(rec, registry)
        if problems:
            label = rec.get("proposed_slug") if isinstance(rec, dict) else "<not an object>"
            src = rec.get("source") if isinstance(rec, dict) else "?"
            drops.append(f"`{label}` ({src}): {'; '.join(problems)}")
            continue
        valid.append(rec)

    merged = dedupe(valid)

    out.parent.mkdir(parents=True, exist_ok=True)
    write_text_lf(
        out, "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in merged)
    )
    text = summarize(
        merged,
        mode=mode,
        corpus=corpus,
        registry=registry,
        postings=len(sample),
        drops=drops,
        jsonl_path=out,
        notes=notes,
        color=color,
    )
    summary.parent.mkdir(parents=True, exist_ok=True)
    write_text_lf(summary, text)
    return len(merged), len(drops), text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipeline.jobfit.eval.recipe_candidates",
        description="Map ingested job descriptions onto recipe candidates for the AI registry.",
    )
    parser.add_argument("--jd-corpus", required=True, help="JSON array of postings")
    parser.add_argument("--roles", type=int, default=50, help="stratified distinct titles")
    parser.add_argument("--limit", type=int, default=None, help="alias of --roles")
    parser.add_argument("--out", default=".ai/recipe-candidates.jsonl")
    parser.add_argument("--summary", default=".ai/recipe-candidates.md")
    parser.add_argument("--no-llm", action="store_true", help="offline: heuristic only")
    parser.add_argument("--strict", action="store_true", help="fail if any record was dropped")
    parser.add_argument("--registry", default=DEFAULT_REGISTRY)
    parser.add_argument(
        "--wall-minutes", type=float, default=25.0,
        help="live budget; the rest of the corpus falls back to the heuristic",
    )
    parser.add_argument("--no-color", action="store_true")
    args = parser.parse_args(argv)

    # The verdict banner and the glyphs are non-ASCII; a Windows console defaults
    # to cp1250 here and would kill the run at the print rather than at the work.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    roles = args.limit if args.limit is not None else args.roles
    if roles <= 0:
        print("--roles must be positive", file=sys.stderr)
        return 2

    corpus = Path(args.jd_corpus)
    if not corpus.is_absolute():
        corpus = (REPO_ROOT / corpus) if not corpus.exists() else corpus
    if not corpus.is_file():
        print(f"corpus not found: {args.jd_corpus}", file=sys.stderr)
        return 2

    registry_path = Path(args.registry)
    if not registry_path.is_absolute():
        registry_path = (REPO_ROOT / registry_path).resolve()
    registry = load_registry(registry_path)

    def _resolve_out(value: str) -> Path:
        p = Path(value)
        return p if p.is_absolute() else REPO_ROOT / p

    try:
        written, dropped, text = run(
            corpus=corpus,
            registry=registry,
            roles=roles,
            no_llm=args.no_llm,
            wall_minutes=args.wall_minutes,
            out=_resolve_out(args.out),
            summary=_resolve_out(args.summary),
            color=should_color(args),
        )
    except (OSError, ValueError) as exc:
        print(f"could not run: {exc}", file=sys.stderr)
        return 2

    print(text)
    if args.strict and (dropped or not written):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
