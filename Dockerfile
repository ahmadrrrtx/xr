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

# Dashboard port (127.0.0.1 inside the container; map with -p 127.0.0.1:7842:7842)
EXPOSE 7842

# Default: start the local dashboard daemon.
ENTRYPOINT ["bun", "run", "src/index.ts"]
CMD ["serve"]
