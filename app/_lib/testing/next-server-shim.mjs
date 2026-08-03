// A minimal `next/server` stand-in for HANDLER-LEVEL unit tests.
//
// WHY THIS EXISTS: in a junction-linked git worktree, `next/server` resolves through two
// module identities under the test loader and every named export comes back `undefined` —
// `new NextRequest(...)` throws "NextRequest is not a constructor" and `NextResponse.json`
// blows up inside `jsonOk`. That is an environment artifact of the worktree, not a product
// bug (the same tests pass in a normal checkout), but it makes route handlers untestable
// exactly where the interesting server logic lives.
//
// The surface below is the whole of what kp's route handlers use, implemented on the
// platform primitives the handlers already treat them as. Register it via
// next-server-hooks.mjs BEFORE dynamically importing a route module; never in app code.
export class NextRequest extends Request {}

export const NextResponse = {
  json(body, init = {}) {
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  },
  redirect(url, status = 307) {
    return new Response(null, { status, headers: { location: String(url) } });
  },
  next() {
    return new Response(null, { status: 200 });
  },
};

export const after = (fn) => {
  if (typeof fn === "function") fn();
};

export const userAgent = () => ({});
export const userAgentFromString = () => ({});
