# XR — single-container image (fixes the #1 r/LocalLLaMA complaint:
# "hostile to docker"). Runs the whole agent + dashboard in one container.
FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install deps first (layer cache)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production

# App source
COPY src ./src
COPY skills ./skills
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
