// The THIRD half of the shared-primitive blind spot (waves 25 and 30 found the
// first two). `scripts/i18n-check.mjs` learned to read a hardcoded `aria-label="…"`
// and then a literal inside an `aria-label={…}` expression — but both of those look
// at JSX. A shared primitive can also ship English from a place no JSX check can
// reach: the DEFAULT VALUE of a prop in its destructure.
//
//   export function Select({ placeholder = "Select…", clearLabel = "Clear", … })
//
// `Select` had four of them. Every caller that did not pass the prop — for
// `searchPlaceholder` and `noMatchesLabel` that was ALL of them, measured — rendered
// English in cs, de and fr. No gate could see it: the eslint i18n rule reads JSX
// text nodes, `i18n-check`'s attribute greps read JSX attributes, and next-intl's
// typed keys only bind what actually reaches `t()`.
//
// NARROW ON PURPOSE. A prop default in this tree is almost always a TOKEN — a
// variant name (`tone = "amber"`, `mode = "select"`, `size = "2xl"`), a length
// (`minHeight = "10rem"`) or a Tailwind class string (`className = "h-40 w-40"`).
// None of those is copy and none of them starts with a capital letter. Sentence-cased
// copy does, always, in all four of this app's locales. So the rule is exactly:
//
//   a props-destructure default whose string literal begins with an uppercase
//   letter is copy that three locales will read in English.
//
// A genuine uppercase TOKEN default (there is none today) is the one false positive
// this can produce; the answer then is to lower-case the token, not to widen the rule
// — a rule that needs a growing allow-list is a rule nobody trusts.

/** Lines of the shape `  name = "Value",` — a destructured parameter with a default. */
const DESTRUCTURE_DEFAULT = /^\s{2,}([A-Za-z_$][\w$]*)\s*=\s*"([^"]*)"\s*,?\s*$/;
/** `const X = "Foo";` / `let x = "Foo"` are assignments, not parameter defaults. */
const DECLARATION = /^\s*(?:const|let|var|export)\b/;

/**
 * Sentence-cased copy starts with an uppercase letter; a variant token does not.
 *
 * The one other uppercase-first string a `.tsx` prop default carries here is SVG
 * PATH DATA (`d = "M10 12a5 5 0 0 1 …"` on JobFitIcon and the results glyphs) — an
 * uppercase path command, not a word. Requiring a run of at least two lowercase
 * letters separates them: every word in every locale has one, `a5` does not.
 */
function readsAsCopy(value) {
  return /^[A-ZÀ-Þ]/.test(value) && /[a-zß-ÿ]{2,}/.test(value);
}

/**
 * Findings for one shared-primitive source file.
 * @param {string} source file text
 * @returns {{ line: number, prop: string, value: string }[]}
 */
export function copyDefaults(source) {
  const found = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (DECLARATION.test(line)) return;
    const m = line.match(DESTRUCTURE_DEFAULT);
    if (!m) return;
    if (!readsAsCopy(m[2])) return;
    found.push({ line: i + 1, prop: m[1], value: m[2] });
  });
  return found;
}
