# syntax=docker/dockerfile:1.7

# ── stage 1: build ────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Lock + manifest first for max layer caching on dep-only changes.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
 && pnpm install --frozen-lockfile --ignore-scripts

# Full source.
COPY . .

# Explicit obscura download per target arch (skips postinstall via --ignore-scripts).
# TARGETARCH is set by buildx: "amd64" or "arm64".
ARG TARGETARCH
RUN TARGET_PLATFORM=linux TARGET_ARCH=${TARGETARCH} node scripts/download-obscura.cjs

# Build frontend (dist/) + server (dist-server/).
RUN pnpm build:all


# ── stage 2: runtime ──────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=256
ENV PORT=7766
ENV DATA_DIR=/app/data

# Production deps only.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
RUN corepack enable \
 && pnpm install --prod --frozen-lockfile --ignore-scripts \
 && pnpm store prune \
 && rm -rf /root/.npm /root/.local/share/pnpm

# Build artifacts.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/bin ./bin

# Non-root user (uid 1000); volume mount owner must match.
# node:22-alpine ships a "node" user at uid/gid 1000 — replace with pentou.
RUN deluser --remove-home node 2>/dev/null || true \
 && addgroup -S -g 1000 pentou \
 && adduser -S -u 1000 -G pentou pentou \
 && mkdir -p /app/data \
 && chown -R pentou:pentou /app
USER pentou

EXPOSE 7766

# busybox wget is in alpine by default — no curl needed.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" | grep -q '"ok":true' || exit 1

CMD ["node", "dist-server/src/server/index.js"]
