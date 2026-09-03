# XR — single-container image (fixes the #1 r/LocalLLaMA complaint:
# "hostile to docker"). Runs the whole agent + dashboard in one container.
FROM oven/bun:1-alpine AS base

# Phase 4 · T6 — patch the base image at BUILD time. The floating
# oven/bun:1-alpine tag can lag alpine security releases (e.g. OpenSSL
# CVE-2026-45447: libcrypto3/libssl3 3.5.6-r0 -> 3.5.7-r0), which the trivy
# container-scan gate flags as HIGH/fixed. `apk upgrade` pulls the patched
# packages so the SHIPPED image is clean on the day it is built.
RUN apk upgrade --no-cache

WORKDIR /app

# Install deps first (layer cache)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production

# App source. scripts/ is required for the nightly golden-path container
# job (bun run scripts/golden-path.ts). Do NOT volume-mount the host
# checkout over /app — that hides the image's node_modules.
COPY src ./src
COPY skills ./skills
COPY scripts ./scripts
COPY bin ./bin
COPY plugins ./plugins
COPY tsconfig.json ./

# Data lives in a volume so the audit log / memory persist across upgrades.
ENV XR_HOME=/data
VOLUME ["/data"]

# Dashboard port.
#
# Phase 0 · T12: the daemon detects the container (via /.dockerenv) and binds
# 0.0.0.0 INSIDE the namespace, because a process bound to the container's own
# loopback can never be reached through a published port. Safety comes from the
# host-side publish being loopback-only — see docker-compose.yml, which maps
# 127.0.0.1:7842:7842 so the dashboard is not exposed to the network.
ENV XR_IN_CONTAINER=1
EXPOSE 7842

# Default: start the local dashboard daemon on the documented container port.
ENTRYPOINT ["bun", "run", "src/index.ts"]
CMD ["serve", "--port", "7842"]
