// htmlToText: a careers page in, the readable advertisement out. The cases that
// actually bite are the ones where a naive tag-strip poisons the corpus — inline JS
// and CSS becoming "prose", `</li><li>` welding two bullets into one word, and an
// unclosed <script> dragging its whole tail in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, htmlTitle, htmlToText, fetchPostingText, PostingFetchError } from "./job-posting-fetch.ts";

const PUBLIC = async () => [{ address: "93.184.216.34" }];

const PAGE = `<!doctype html>
<html><head>
  <title>Senior Java Developer &mdash; Example&nbsp;s.r.o.</title>
  <style>.hero { color: #fff; background: url(x.png); }</style>
  <script>window.dataLayer=[{"job":"leak"}];</script>
</head>
<body>
  <!-- a tracking comment -->
  <nav><a href="/">Home</a></nav>
  <h1>Senior Java Developer</h1>
  <p>We&#39;re building payment rails &amp; we need help.</p>
  <ul><li>5+ years of Java</li><li>Kafka &lt;3</li></ul>
  <noscript>Please enable JavaScript.</noscript>
  <svg><path d="M0 0"/></svg>
</body></html>`;

test("script, style, noscript, svg and comment content is DROPPED, not untagged", () => {
  const text = htmlToText(PAGE);
  for (const leak of ["dataLayer", "leak", "#fff", "background", "enable JavaScript", "M0 0", "tracking comment"]) {
    assert.ok(!text.includes(leak), `"${leak}" leaked into the extracted posting text`);
  }
});

test("block boundaries become line breaks, so adjacent bullets stay two bullets", () => {
  const text = htmlToText(PAGE);
  assert.match(text, /5\+ years of Java\nKafka <3/);
  // The heading and the paragraph are on their own lines.
  assert.match(text, /Senior Java Developer\nWe're building payment rails & we need help\./);
});

test("entities are decoded — named, numeric and nbsp — and unknown ones are left verbatim", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; f&nbsp;g"), `a & b <c> "d" 'e' f g`);
  assert.equal(decodeEntities("&#x2014; &#8212;"), "— —");
  assert.equal(decodeEntities("&notarealentity; stays"), "&notarealentity; stays");
});

test("the <title> is the title fallback, entity-decoded and collapsed", () => {
  assert.equal(htmlTitle(PAGE), "Senior Java Developer — Example s.r.o.");
  assert.equal(htmlTitle("<html><body>no title</body></html>"), null);
});

test("an unclosed <script> does not drag its tail into the text", () => {
  const truncated = "<body><p>Real copy here.</p><script>var a = 1; // the download was cut off";
  const text = htmlToText(truncated);
  assert.equal(text, "Real copy here.");
});

test("whitespace collapses to at most one blank line", () => {
  const text = htmlToText("<div>a</div>\n\n\n<div>   </div>\n\n<div>b</div>");
  assert.equal(text, "a\nb");
});

test("fetchPostingText refuses a non-http(s) scheme before any network call", async () => {
  await assert.rejects(() => fetchPostingText("file:///etc/passwd"), PostingFetchError);
  await assert.rejects(() => fetchPostingText("not a url at all"), PostingFetchError);
});

test("fetchPostingText refuses a content type that is not readable text", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("%PDF-1.7", { status: 200, headers: { "content-type": "application/pdf" } })) as typeof fetch;
  try {
    await assert.rejects(() => fetchPostingText("https://example.test/jobs/1", PUBLIC), PostingFetchError);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchPostingText returns the page's title and its extracted text", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(PAGE, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as typeof fetch;
  try {
    const { title, text } = await fetchPostingText("https://example.test/jobs/1", PUBLIC);
    assert.equal(title, "Senior Java Developer — Example s.r.o.");
    assert.match(text, /payment rails/);
    assert.ok(!text.includes("dataLayer"));
  } finally {
    globalThis.fetch = original;
  }
});

test("a non-OK status is a PostingFetchError, never a stored empty posting", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("nope", { status: 404, headers: { "content-type": "text/html" } })) as typeof fetch;
  try {
    await assert.rejects(() => fetchPostingText("https://example.test/gone", PUBLIC), PostingFetchError);
  } finally {
    globalThis.fetch = original;
  }
});

/** Stub fetch with a per-URL script; records every URL requested. */
async function withFetch(routes: Record<string, () => Response>, run: (seen: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: URL | string) => {
    const href = String(input);
    seen.push(href);
    const route = routes[href];
    if (!route) throw new Error(`unscripted ${href}`);
    return route();
  }) as typeof fetch;
  try {
    await run(seen);
  } finally {
    globalThis.fetch = original;
  }
}

const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
const page = () => new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });

test("a private or literal-IP start host is refused before any request", async () => {
  await withFetch({}, async (seen) => {
    for (const u of ["http://127.0.0.1/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/x", "http://localhost/x"]) {
      await assert.rejects(
        () => fetchPostingText(u, async (h) => [{ address: h === "localhost" ? "127.0.0.1" : h }]),
        PostingFetchError,
      );
    }
    assert.deepEqual(seen, []);
  });
});

test("a public host that redirects to a private address is refused at the hop", async () => {
  const lookup = async (h: string) => [{ address: h === "careers.test" ? "93.184.216.34" : h }];
  for (const target of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data"]) {
    await withFetch({ "https://careers.test/job": redirect(target) }, async (seen) => {
      await assert.rejects(() => fetchPostingText("https://careers.test/job", lookup), PostingFetchError);
      assert.deepEqual(seen, ["https://careers.test/job"]);
    });
  }
});

test("a public name that resolves to a private address (DNS rebinding) is refused", async () => {
  await withFetch({}, async (seen) => {
    await assert.rejects(
      () => fetchPostingText("https://rebind.test/job", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }]),
      PostingFetchError,
    );
    assert.deepEqual(seen, []);
  });
});

test("a redirect to a non-http scheme is refused", async () => {
  await withFetch({ "https://careers.test/job": redirect("file:///etc/passwd") }, async () => {
    await assert.rejects(() => fetchPostingText("https://careers.test/job", PUBLIC), PostingFetchError);
  });
});

test("more than 5 redirect hops is refused; exactly 5 is followed", async () => {
  const chain = (n: number) => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < n; i++) routes[`https://c.test/${i}`] = redirect(`https://c.test/${i + 1}`);
    routes[`https://c.test/${n}`] = page;
    return routes;
  };
  await withFetch(chain(6), async () => {
    await assert.rejects(() => fetchPostingText("https://c.test/0", PUBLIC), /too many redirects/);
  });
  await withFetch(chain(5), async () => {
    const { text } = await fetchPostingText("https://c.test/0", PUBLIC);
    assert.match(text, /payment rails/);
  });
});

test("a public http fetch through a public redirect is allowed", async () => {
  await withFetch({ "http://careers.test/a": redirect("/b"), "http://careers.test/b": page }, async (seen) => {
    const { title } = await fetchPostingText("http://careers.test/a", PUBLIC);
    assert.equal(title, "Senior Java Developer — Example s.r.o.");
    assert.deepEqual(seen, ["http://careers.test/a", "http://careers.test/b"]);
  });
});
