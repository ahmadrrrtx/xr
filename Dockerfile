# XR — single-container image (fixes the #1 r/LocalLLaMA complaint:
# "hostile to docker"). Runs the whole agent + dashboard in one container.
# Bun is pinned to .bun-version (D4); `apt-get upgrade` below still patches Debian.
#
# XR-LAUNCH-020 — glibc base (Debian slim), not Alpine/musl: the filesystem
# authority behind every file tool (src/security/fs-native.ts) dlopens glibc's
# `libc.so.6`, which musl does not provide, so on Alpine read_file/write_file
# failed closed with `unsupported`. CI proves the image with
# scripts/container-file-smoke.ts (real write_file → read_file + escape refusal).
FROM oven/bun:1.4.2-slim AS base

# Phase 4 · T6 — patch the base image at BUILD time. The pinned oven/bun tag
# can lag Debian security releases, which the trivy container-scan gate flags
# as HIGH/fixed. `apt-get upgrade` pulls the patched packages so the SHIPPED
# image is clean on the day it is built.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

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
