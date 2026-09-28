"""github_evidence_cli: a seeker's own GitHub snapshot becomes personal-project evidence.

Pins: languages map to CV names (a notebook is Python, a Dockerfile is Docker, markup is not
a skill) and a C/C++/Assembly repository never becomes C# or a manufacturing skill; topics,
names and descriptions are read with the taxonomy's detector behind four guards (technical
terms only, whole words only, everyday-English words only when written as a name in prose,
"model" only as a topic); role words are never claims; ``corroborates`` names a claim the
evidence backs and nothing ever says "missing"; live repositories come before archived ones;
every cap holds; and a malformed request is exit 2 + ``invalid_input``. Synthetic data only.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit import github_evidence_cli as cli
from pipeline.jobfit.taxonomy import resolve_term


def repo(name: str, **over) -> dict:
    base = {
        "name": name,
        "fullName": f"seeker/{name}",
        "htmlUrl": f"https://github.com/seeker/{name}",
        "description": None,
        "language": "Python",
        "languages": None,
        "topics": [],
        "stars": 0,
        "pushedAt": "2026-09-01T10:00:00Z",
        "createdAt": "2025-01-01T00:00:00Z",
        "archived": False,
        "sizeKb": 100,
    }
    base.update(over)
    return base


def snapshot(repos: list[dict], *, planned: int = 0, read: int = 0, truncated: bool = False) -> dict:
    return {
        "login": "seeker",
        "name": None,
        "htmlUrl": "https://github.com/seeker",
        "publicRepos": len(repos),
        "readAt": "2026-09-28T08:00:00.000Z",
        "repos": repos,
        "truncated": truncated,
        "languageReads": {"planned": planned, "read": read},
        "budget": {"repos": len(repos), "fields": ["name"]},
    }


def derive(repos: list[dict], claims: list[str] | None = None, **snap) -> dict:
    return cli.run({"snapshot": snapshot(repos, **snap), "claims": claims or []})


def skills_of(out: dict, name: str) -> list[str]:
    return next(e["skills"] for e in out["evidence"] if e["repo"] == name)


def aggregate(out: dict) -> dict[str, dict]:
    return {s["skill"]: s for s in out["skills"]}


def run_main(argv: list[str], stdin: str | None = None) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        if stdin is None:
            code = cli.main(argv)
        else:
            with mock.patch("sys.stdin", io.StringIO(stdin)):
                code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def run_file(request: dict | str) -> tuple[int, str, str]:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "input.json"
        path.write_text(request if isinstance(request, str) else json.dumps(request), encoding="utf-8")
        return run_main(["--input-json", str(path)])


class LanguageMappingTest(unittest.TestCase):
    def test_primary_language_and_every_language_with_a_tenth_of_the_bytes(self):
        out = derive([
            repo("app", language="TypeScript", languages={"TypeScript": 700, "Python": 200, "JavaScript": 90, "CSS": 10}),
            repo("edge", language="Go", languages={"Go": 900, "Rust": 100}),
        ])
        self.assertEqual(skills_of(out, "app"), ["TypeScript", "Python"], "9% JavaScript is below the bar; CSS is markup")
        self.assertEqual(skills_of(out, "edge"), ["Go", "Rust"], "exactly 10% is in")

    def test_linguist_names_map_to_the_names_a_cv_uses(self):
        out = derive([
            repo(
                "infra",
                language="Jupyter Notebook",
                languages={"Jupyter Notebook": 400, "Dockerfile": 200, "HCL": 200, "Vue": 100, "PLpgSQL": 100},
            ),
        ])
        self.assertEqual(skills_of(out, "infra"), ["Python", "Docker", "Terraform", "PostgreSQL", "Vue.js"])
        terms = {s["skill"]: s["termId"] for s in out["skills"]}
        self.assertEqual(
            terms,
            {"Python": "python", "Docker": "docker", "Terraform": "terraform", "Vue.js": "vue", "PostgreSQL": "postgresql"},
        )

    def test_markup_and_shell_glue_count_only_when_the_taxonomy_models_them(self):
        self.assertIsNone(resolve_term("Bash"), "the taxonomy has no Bash term today; when it gains one, Shell maps to it here")
        out = derive([
            repo("site", language="HTML", languages={"HTML": 500, "CSS": 200, "Shell": 150, "Makefile": 150}),
            repo("tool", language="Shell", languages={"Shell": 600, "Python": 400}),
        ])
        self.assertNotIn("site", [e["repo"] for e in out["evidence"]], "nothing but glue: no skill, no item")
        self.assertEqual(skills_of(out, "tool"), ["Python"])

    def test_c_cpp_and_assembly_stay_themselves_and_never_become_csharp_or_a_trade(self):
        # resolve_term folds "c#" to "c" in its compact index, so it answers C# for both;
        # it also answers the manufacturing skill for the Assembly language.
        self.assertEqual(resolve_term("C++"), "csharp")
        self.assertEqual(resolve_term("Assembly"), "assembly")
        out = derive([
            repo("engine", language="C++", languages={"C++": 800, "C": 150, "Assembly": 50}),
            repo("boot", language="Assembly", languages={"Assembly": 1000}),
            repo("svc", language="C#", languages={"C#": 1000}),
        ])
        terms = {s["skill"]: s["termId"] for s in out["skills"]}
        self.assertEqual(terms["C++"], None)
        self.assertEqual(terms["C"], None)
        self.assertEqual(terms["Assembly"], None)
        self.assertEqual(terms["C#"], "csharp")
        self.assertEqual(aggregate(out)["C#"]["repos"], 1, "only the C# repository shows C#")

    def test_unmodelled_languages_are_kept_under_their_own_name(self):
        out = derive([repo("shop", language="PHP", languages={"PHP": 700, "Ruby": 300})])
        self.assertEqual(skills_of(out, "shop"), ["PHP", "Ruby"])
        self.assertEqual({s["termId"] for s in out["skills"]}, {None})

    def test_unread_languages_leave_only_the_primary_language(self):
        out = derive([repo("lib", language="Kotlin", languages=None)])
        self.assertEqual(skills_of(out, "lib"), ["Kotlin"])

    def test_a_repository_with_no_code_language_yields_nothing_whatever_its_labels_say(self):
        out = derive([
            repo("placeholder", language=None, languages={}, description="A Python and FastAPI toolkit", topics=["docker"]),
            repo("list", language=None, languages=None, description="Awesome Terraform modules"),
        ])
        self.assertEqual(out["evidence"], [])
        self.assertEqual(out["skills"], [])


class LabelDetectionTest(unittest.TestCase):
    def test_topics_names_and_descriptions_are_read_through_the_taxonomy(self):
        out = derive([
            repo(
                "langchain-rag-demo",
                language="Python",
                topics=["machine-learning", "next-js", "react-native"],
                description="Built with FastAPI and Next.js",
            ),
        ])
        skills = skills_of(out, "langchain-rag-demo")
        terms = {s["skill"]: s["termId"] for s in out["skills"]}
        for term_id in ("python", "machine_learning", "next_js", "react_native", "langchain", "rag", "fastapi"):
            self.assertIn(term_id, terms.values(), term_id)
        self.assertEqual(len(skills), len(set(terms.values())), "one entry per term")
        self.assertIn("FastAPI", skills, "the description's own casing is the spelling")
        self.assertIn("Next.js", skills)

    def test_only_technical_terms_count_from_labels(self):
        out = derive([
            repo(
                "lib",
                language="TypeScript",
                description="A type-safe event sourcing library with Redux dispatch, Rust ownership semantics, "
                "a recruiting pipeline, a product page and a networking layer",
                topics=["crm", "seo", "scrum"],
            ),
        ])
        self.assertEqual(skills_of(out, "lib"), ["TypeScript", "Rust"])

    def test_a_suffix_is_not_a_skill(self):
        out = derive([repo("streams", language="Go", description="Reactive streams behind a Helmet middleware over SQLite")])
        self.assertEqual(skills_of(out, "streams"), ["Go"])

    def test_everyday_english_words_count_in_prose_only_when_written_as_a_name(self):
        out = derive([
            repo("pof-exp", language="C++", description="How far this can go, and how swift it is"),
            repo("server", language="C++", description="A port of the service to Go"),
            repo("tagged", language="C++", topics=["go", "rust"]),
            repo("go-tools", language="C++"),
        ])
        self.assertEqual(skills_of(out, "pof-exp"), ["C++"])
        self.assertEqual(skills_of(out, "server"), ["C++", "Go"])
        # One spelling per skill: "Go" as the server's description writes it; "rust" was only
        # ever a topic, and the taxonomy has no display name, so it keeps the form found.
        self.assertEqual(skills_of(out, "tagged"), ["C++", "Go", "rust"])
        self.assertEqual(skills_of(out, "go-tools"), ["C++", "Go"], "a repository name is an identifier")
        self.assertEqual(aggregate(out)["Go"]["termId"], "go")
        self.assertEqual(aggregate(out)["Go"]["repos"], 3)

    def test_model_is_only_ever_a_topic(self):
        out = derive([
            repo("viewer", language="Rust", description="A 3D model viewer"),
            repo("model-zoo", language="Rust"),
            repo("forecast", language="Rust", topics=["model"]),
        ])
        self.assertEqual(skills_of(out, "viewer"), ["Rust"])
        self.assertEqual(skills_of(out, "model-zoo"), ["Rust"])
        self.assertIn("model", skills_of(out, "forecast"))

    def test_role_words_are_never_claims(self):
        out = derive([
            repo(
                "backend-engineer-portfolio",
                language="Java",
                description="Frontend developer playground by a fullstack engineer and architect",
                topics=["fullstack", "backend", "developer-tools"],
            ),
        ])
        self.assertEqual(skills_of(out, "backend-engineer-portfolio"), ["Java"])


class CorroborationTest(unittest.TestCase):
    def test_corroborates_names_the_claims_the_evidence_backs_and_nothing_says_missing(self):
        out = derive(
            [repo("web", language="Python", topics=["nextjs", "docker"])],
            claims=["Python", "next.js", "Kubernetes"],
        )
        rows = aggregate(out)
        self.assertTrue(rows["Python"]["corroborates"])
        self.assertTrue(rows["next.js"]["corroborates"], "the seeker's own spelling of the same term")
        self.assertFalse(rows["docker"]["corroborates"])
        self.assertNotIn("Kubernetes", rows, "a claim the evidence does not show is simply absent: no verdict")
        self.assertEqual(set(out), {"evidence", "skills", "budget"})
        for row in out["skills"]:
            self.assertEqual(set(row), {"skill", "termId", "repos", "lastPushedAt", "corroborates"})

    def test_the_seekers_spelling_is_the_one_spelling_everywhere(self):
        out = derive(
            [
                repo("a", language="TypeScript", topics=["nodejs"]),
                repo("b", language="TypeScript", description="Runs on Node.js"),
            ],
            claims=["Node JS", "typescript"],
        )
        self.assertEqual(skills_of(out, "a"), ["typescript", "Node JS"])
        self.assertEqual(skills_of(out, "b"), ["typescript", "Node JS"])
        rows = aggregate(out)
        self.assertEqual(rows["Node JS"]["repos"], 2)
        self.assertEqual(rows["Node JS"]["termId"], "node_js")
        self.assertTrue(rows["Node JS"]["corroborates"])
        self.assertIn("Stack: typescript, Node JS", out["evidence"][0]["text"])

    def test_an_unmodelled_skill_corroborates_by_its_folded_name(self):
        out = derive([repo("engine", language="C++")], claims=["c++"])
        row = aggregate(out)["c++"]
        self.assertEqual((row["termId"], row["corroborates"]), (None, True))

    def test_csharp_and_cpp_do_not_corroborate_each_other(self):
        out = derive([repo("engine", language="C++"), repo("svc", language="C#")], claims=["C#", "C"])
        rows = aggregate(out)
        self.assertFalse(rows["C++"]["corroborates"])
        self.assertTrue(rows["C#"]["corroborates"])

    def test_role_words_in_claims_change_nothing(self):
        out = derive([repo("svc", language="Java")], claims=["Backend engineer", "developer"])
        self.assertEqual(aggregate(out)["Java"]["corroborates"], False)


class EvidenceShapeTest(unittest.TestCase):
    def test_one_item_per_repository_that_shows_a_skill(self):
        out = derive([
            repo("org-memory_v2", language="JavaScript", description="Skills registry", pushedAt="2026-08-14T09:30:00Z"),
            repo("kp", language="TypeScript", pushedAt=None),
        ])
        first, second = out["evidence"]
        self.assertEqual(first, {
            "kind": "project",
            "title": "org memory v2",
            "text": "Skills registry\nStack: JavaScript",
            "skills": ["JavaScript"],
            "link": "https://github.com/seeker/org-memory_v2",
            "recency": "2026-08",
            "provenance": "personal_project",
            "repo": "org-memory_v2",
        })
        self.assertEqual(second["repo"], "kp", "the repository NAME: the key the CV's Projects section joins on")
        self.assertEqual((second["title"], second["text"], second["recency"]), ("kp", "Stack: TypeScript", None))
        self.assertIsNone(aggregate(out)["TypeScript"]["lastPushedAt"])

    def test_live_repositories_come_before_archived_ones_each_newest_first(self):
        out = derive([
            repo("archived-new", archived=True, pushedAt="2026-09-20T00:00:00Z"),
            repo("live-old", pushedAt="2021-01-01T00:00:00Z"),
            repo("live-new", pushedAt="2026-09-01T00:00:00Z"),
            repo("archived-old", archived=True, pushedAt="2020-01-01T00:00:00Z"),
        ])
        self.assertEqual(
            [e["repo"] for e in out["evidence"]],
            ["live-new", "live-old", "archived-new", "archived-old"],
        )

    def test_aggregate_counts_repositories_and_sorts_by_count_then_recency(self):
        out = derive([
            repo("a", language="Rust", pushedAt="2026-01-01T00:00:00Z"),
            repo("b", language="Rust", pushedAt="2026-02-01T00:00:00Z"),
            repo("c", language="Kotlin", pushedAt="2026-09-01T00:00:00Z"),
            repo("d", language="Java", pushedAt="2026-05-01T00:00:00Z"),
        ])
        self.assertEqual([s["skill"] for s in out["skills"]], ["Rust", "Kotlin", "Java"])
        self.assertEqual(aggregate(out)["Rust"]["repos"], 2)
        self.assertEqual(aggregate(out)["Rust"]["lastPushedAt"], "2026-02-01T00:00:00Z")


class CapsTest(unittest.TestCase):
    def test_at_most_thirty_items_the_most_recent_live_ones(self):
        repos = [repo(f"r{i:02d}", pushedAt=f"2026-{1 + i % 9:02d}-{1 + i:02d}T00:00:00Z") for i in range(28)]
        repos += [repo(f"old{i}", pushedAt=f"2019-01-0{1 + i}T00:00:00Z") for i in range(7)]
        out = derive(repos)
        self.assertEqual(len(out["evidence"]), cli.EVIDENCE_CAP)
        kept = {e["repo"] for e in out["evidence"]}
        self.assertTrue({f"r{i:02d}" for i in range(28)} <= kept)
        self.assertEqual(len(kept - {f"r{i:02d}" for i in range(28)}), 2)

    def test_at_most_eight_skills_per_repository(self):
        out = derive([
            repo(
                "kitchen-sink",
                language="Python",
                topics=["fastapi", "django", "flask", "docker", "kubernetes", "terraform", "postgresql", "redis", "kafka", "graphql"],
            ),
        ])
        self.assertEqual(len(skills_of(out, "kitchen-sink")), cli.SKILLS_PER_REPO)
        self.assertEqual(skills_of(out, "kitchen-sink")[0], "Python", "languages lead the stack")

    def test_at_most_forty_aggregate_skills(self):
        repos = [
            repo(f"r{i}", language=f"Zlang{i}a", languages={f"Zlang{i}{c}": 100 for c in "abcde"})
            for i in range(30)
        ]
        out = derive(repos)
        self.assertEqual(len(out["skills"]), cli.SKILLS_CAP)


class BudgetTest(unittest.TestCase):
    def test_the_budget_travels_with_the_result(self):
        out = derive([repo("a"), repo("b", language=None)], planned=12, read=7, truncated=True)
        self.assertEqual(
            out["budget"],
            {"repos": 2, "languageReads": {"planned": 12, "read": 7}, "partial": True, "truncated": True},
        )
        complete = derive([repo("a")], planned=1, read=1)
        self.assertEqual((complete["budget"]["partial"], complete["budget"]["truncated"]), (False, False))

    def test_an_empty_account_is_an_empty_answer_not_an_error(self):
        self.assertEqual(
            derive([]),
            {"evidence": [], "skills": [], "budget": {"repos": 0, "languageReads": {"planned": 0, "read": 0}, "partial": False, "truncated": False}},
        )


class CliTest(unittest.TestCase):
    def test_a_valid_request_answers_one_json_object_exit_0(self):
        code, out, err = run_file({"snapshot": snapshot([repo("kp", language="TypeScript")]), "claims": ["TypeScript"]})
        self.assertEqual(code, 0, err)
        payload = json.loads(out)
        self.assertEqual(payload["skills"][0]["skill"], "TypeScript")
        self.assertEqual(len(out.strip().splitlines()), 1)

    def test_stdin_works_and_claims_may_be_omitted(self):
        code, out, err = run_main([], stdin=json.dumps({"snapshot": snapshot([repo("kp")])}))
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out)["skills"][0]["corroborates"], False)

    def test_malformed_requests_are_exit_2_invalid_input(self):
        good = snapshot([repo("kp")])
        bad_requests = {
            "not json": "{nope",
            "not an object": [1, 2],
            "no snapshot": {"claims": []},
            "snapshot not an object": {"snapshot": "xkazm04"},
            "repos not a list": {"snapshot": {**good, "repos": {}}},
            "repo not an object": {"snapshot": {**good, "repos": ["kp"]}},
            "repo without a name": {"snapshot": {**good, "repos": [{**repo("kp"), "name": "  "}]}},
            "link off github": {"snapshot": {**good, "repos": [repo("kp", htmlUrl="javascript:alert(1)")]}},
            "no languageReads": {"snapshot": {k: v for k, v in good.items() if k != "languageReads"}},
            "negative reads": {"snapshot": {**good, "languageReads": {"planned": 1, "read": -1}}},
            "boolean reads": {"snapshot": {**good, "languageReads": {"planned": True, "read": 0}}},
            "truncated not a boolean": {"snapshot": {**good, "truncated": "no"}},
            "claims not a list": {"snapshot": good, "claims": "Python"},
        }
        for label, request in bad_requests.items():
            code, out, err = run_file(request)
            self.assertEqual(code, 2, label)
            self.assertEqual(out, "", label)
            self.assertEqual(json.loads(err.strip().splitlines()[-1])["code"], "invalid_input", label)


if __name__ == "__main__":
    unittest.main()
