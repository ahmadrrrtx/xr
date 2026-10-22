# ─────────────────────────────────────────────────────────────────────────────
# XR Cloud — production image.
#
# Two stages. The builder installs with the lockfile for a reproducible tree and
# never ships; the runtime carries only what serving needs. `drizzle/` is copied
# into the image because the `migrate` service runs from this same image — one
# artifact, two entrypoints, so the schema and the code that expects it can never
# be different versions.
#
# Bun specifically, not Node: the service uses `Bun.serve`, `Bun.Glob` and
# `Bun.file` at runtime, and the PGlite driver's WASM path is well-trodden there.
# ─────────────────────────────────────────────────────────────────────────────

FROM oven/bun:1.4.2-alpine AS builder

WORKDIR /app

# Dependency layer first so a source-only change does not re-resolve the tree.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
COPY scripts ./scripts

# ─────────────────────────────────────────────────────────────────────────────

FROM oven/bun:1.4.2-alpine AS runtime

WORKDIR /app

# The migration runner and the API run as the same non-root user.
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts

# Writable scratch for capture-mode mail and local blob fallback. Only ever used
# when those transports are selected; in production both are configured.
RUN mkdir -p /app/.xr-cloud-mail /app/.xr-cloud-exports && chown -R bun:bun /app

USER bun

EXPOSE 8787

# No curl in the alpine image on purpose — one fewer thing in the attack surface.
# Bun can make the request itself, and this checks the readiness probe rather
# than liveness, because a container that answers /healthz but cannot reach its
# database should not receive traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:'+(process.env.PORT??8787)+'/readyz'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "run", "src/index.ts"]
