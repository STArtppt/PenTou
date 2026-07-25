# syntax=docker/dockerfile:1.7

# Runtime must be glibc-based (Debian slim), not Alpine/musl.
# Upstream obscura ships glibc-linked binaries (PT_INTERP ld-linux-*.so.*);
# on Alpine, spawn reports ENOENT even when /app/bin/obscura exists.

# ── stage 1: build ────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
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
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=256
ENV PORT=7766
ENV DATA_DIR=/app/data

# ca-certificates: HTTPS for share-link native APIs / optional runtime downloads.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Production deps only (native modules must match glibc runtime = same base family as builder).
# --ignore-scripts skips package postinstall (obscura is installed explicitly below via COPY bin);
# rebuild better-sqlite3 so its install script can fetch the correct prebuilt .node binding.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
RUN corepack enable \
 && pnpm install --prod --frozen-lockfile --ignore-scripts \
 && pnpm rebuild better-sqlite3 \
 && pnpm store prune \
 && rm -rf /root/.npm /root/.local/share/pnpm

# Build artifacts.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/bin ./bin

# Non-root user (uid 1000); volume mount owner must match.
# Official node images ship a "node" user at uid/gid 1000 — replace with pentou.
RUN userdel -r node 2>/dev/null || true \
 && groupadd --gid 1000 pentou \
 && useradd --uid 1000 --gid pentou --shell /usr/sbin/nologin --create-home pentou \
 && mkdir -p /app/data \
 && chown -R pentou:pentou /app
USER pentou

EXPOSE 7766

# Node is always present; avoid depending on wget/curl in slim.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7766)+'/healthz').then(async r=>{const j=await r.json();if(!j||j.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist-server/src/server/index.js"]
