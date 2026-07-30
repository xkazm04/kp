# syntax=docker/dockerfile:1
#
# KP self-host image — the Next.js 16 app and its Python "jobfit" pipeline in ONE
# container (the app spawns `python -m pipeline.jobfit.*` at request time, so the
# runtime needs both toolchains). Multi-stage: a builder that installs deps,
# compiles the native better-sqlite3 module and runs `next build`, then a slim
# runner. Full deployment guide: docs/architecture/self-hosting.md.
#
# Versions track CI (.github/workflows/ci.yml): Node 24 and Python 3.x. This image
# uses Debian bookworm's python3 (3.11); CI validates on 3.12 and the pipeline
# supports 3.11+. If your policy requires an exact Python minor, override
# --build-arg NODE_IMAGE=... with a base that ships it, or add deadsnakes.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- builder: deps + native build + next build ----------
FROM ${NODE_IMAGE} AS builder
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/opt/venv/bin:$PATH
WORKDIR /app

# Toolchain: python (for `npm run schemas:gen` = python -m pipeline.jobfit.codegen,
# which runs inside `npm run build`) and build-essential (node-gyp compiles
# better-sqlite3 from source when no prebuilt binary matches this Node ABI).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv

# Python deps first — layer cached until requirements.txt changes. Needed by the
# build (schemas codegen imports the pipeline package: pydantic et al.).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Node deps next — cached until the lockfile changes. `npm ci` builds
# better-sqlite3 against THIS image's Node, so the .node binary is ABI-correct
# for the (same-base) runner below.
# --legacy-peer-deps: `next` is pinned to a CANARY (16.3.0-canary.77), a
# prerelease that does not satisfy next-intl's stable `^16.0.0` peer range, so
# npm's strict ERESOLVE would abort. The lockfile is already resolved (CI builds
# it green), so we install it verbatim and skip the prerelease-peer conflict —
# this only relaxes the error, it does not change which versions are installed.
COPY package.json package-lock.json ./
# --include=dev: this stage sets NODE_ENV=production (correct for the runtime), which
# would make npm ci OMIT devDependencies — but `next build` needs them (tailwind
# postcss, typescript, babel, react-is via recharts). Force them in for the build;
# `npm prune --omit=dev` below strips them back out for the copy the runner takes.
RUN npm ci --legacy-peer-deps --include=dev

# Full source + build. `next build` with output:"standalone" (next.config.ts) emits
# .next/standalone — a self-contained server with a MINIMAL, traced node_modules — so
# the runner never copies the builder's full node_modules or the source tree.
COPY . .
# --legacy-peer-deps (used on npm ci above for the canary-next conflict) also SKIPS
# auto-installing PEER deps. recharts imports its `react-is` peer at build + SSR time,
# so add just that one explicitly (--save so the standalone trace keeps it). This
# edits only the container's manifest copy, never the source package.json/lock.
# --include=dev: under NODE_ENV=production a plain `npm install` would re-reify the
# tree WITHOUT the devDependencies `next build` needs (tailwind postcss, etc.).
RUN npm install --save --include=dev --legacy-peer-deps react-is@19.2.5 \
 && npm run build

# ---------- runner: slim standalone runtime with python for the spawned pipeline ----------
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    KP_DB_PATH=/data/kp.sqlite \
    PYTHON_CMD=/opt/venv/bin/python \
    PATH=/opt/venv/bin:$PATH
WORKDIR /app

# Runtime needs python3 (the app spawns the pipeline per request) and tini as PID 1
# so a container SIGTERM reaps the spawned python children instead of orphaning them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /app kp \
 && mkdir -p /data && chown kp:kp /data

# Standalone server + its TRACED node_modules (incl. the native better-sqlite3 binding
# and the bundled message catalogs), then the client assets and public dir Next keeps
# outside the trace.
COPY --from=builder --chown=kp:kp /app/.next/standalone ./
COPY --from=builder --chown=kp:kp /app/.next/static ./.next/static
COPY --from=builder --chown=kp:kp /app/public ./public
# The Python pipeline is SPAWNED (`python -m pipeline.jobfit.*`), not imported, so it
# isn't in the JS trace — copy the package, its runtime data files, and the venv.
COPY --from=builder --chown=kp:kp /app/pipeline ./pipeline
COPY --from=builder --chown=kp:kp /app/data ./data
COPY --from=builder --chown=kp:kp /opt/venv /opt/venv
# The /diagrams (Architecture) page reads docs/diagrams/*.puml from disk at request
# time. next.config.ts's `outputFileTracingIncludes` already bundles them into
# .next/standalone (copied above), so this is belt-and-suspenders: it guarantees
# the sources are present under /app/docs/diagrams (= process.cwd()/docs/diagrams
# at runtime) even if the trace-include ever misses them, with no dependency on
# file-tracing heuristics or workspace-root inference. ~40 KB.
COPY --from=builder --chown=kp:kp /app/docs/diagrams ./docs/diagrams

USER kp
VOLUME ["/data"]
EXPOSE 3000

# Liveness — Node 24 ships a global fetch, so no curl/wget needed in the slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies (the pipeline spawns) + forwards signals to the standalone server.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
