# syntax note: multi-stage build producing a slim, non-root runtime image
# using Next.js "standalone" output (see next.config.mjs: output: 'standalone').
#
# ---------------------------------------------------------------------------
# non-root / controller auth-token note:
#
# The app workload runs as the built-in non-root `node` user (uid 1000). The
# container itself STARTS as root (no `USER node` below) so docker-entrypoint.sh
# can fix up volume ownership and then drops to `node` via su-exec before running
# the server — see that script.
#
# docker-compose.yml mounts the controller's data dir read-only at /controller,
# and lib/controller/token.ts reads /controller/authtoken.secret by default.
# That file is created by the zerotier-controller container owned by root with
# mode 0600, so the `node` user cannot read it directly. To avoid the resulting
# "controller degraded" state, the entrypoint (while still root) mirrors the
# token into a node-readable copy at /run/gemzt/authtoken.secret and points the
# app there via ZT_TOKEN_PATH. This is automatic — no operator action needed.
#
# Operators can still override by setting ZT_AUTH_TOKEN directly (takes priority
# in lib/controller/token.ts); if set, the entrypoint skips the mirror step.
# ---------------------------------------------------------------------------

FROM node:20-alpine AS base
# Prisma on Alpine (musl) needs OpenSSL present so it can detect libssl and
# load the correct query engine; without it Prisma warns and defaults to
# openssl-1.1.x. su-exec lets the entrypoint fix /data ownership as root and
# then drop to the unprivileged `node` user for the actual workload.
RUN apk add --no-cache openssl su-exec

# ---- deps: install full (dev+prod) dependencies once, reused by builder ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: generate Prisma client + build the Next standalone bundle ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runner: minimal, non-root runtime image -------------------------------
FROM base AS runner
WORKDIR /app

# OCI image labels (https://github.com/opencontainers/image-spec/blob/main/annotations.md).
# IMAGE_VERSION is an ARG so CI can stamp the real release version at build time. Use
# semantic versioning (semver.org) — 0.1.0, 0.2.0, 1.0.0, never a raw commit hash or
# `git describe` suffix — matching the version already tracked in package.json:
#   docker build --build-arg IMAGE_VERSION=$(node -p "require('./package.json').version") .
# The static default below is just the fallback for a plain `docker build` with no arg;
# keep it in sync with package.json's "version" field when you bump a release.
ARG IMAGE_VERSION=0.1.0
LABEL org.opencontainers.image.title="GEM-ZT" \
      org.opencontainers.image.description="Self-hosted ZeroTier network controller web GUI + REST API. This image is the app container only — it must run alongside the zyclonite/zerotier controller image via Docker Compose; see the repo README for the required deployment model." \
      org.opencontainers.image.source="https://github.com/damascus77/GEM-ZT" \
      org.opencontainers.image.documentation="https://github.com/damascus77/GEM-ZT#readme" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

ENV NODE_ENV=production
# Default SQLite location so the image runs standalone (`docker run`) as well
# as via docker-compose (which sets the same value). The directory must exist
# because `prisma migrate deploy` writes the SQLite file here at startup; a
# mounted volume (compose app_data:/data) transparently takes over this path
# at runtime.
ENV DATABASE_URL=file:/data/gemzt.db
RUN mkdir -p /data && chown node:node /data

# Next standalone server + assets. `standalone` already contains a pruned
# node_modules with the traced production dependencies (including
# @prisma/client and its query engine, since it's required at runtime).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# public/ is optional (this project doesn't currently have one); copy it if
# and when it's added without needing to touch this Dockerfile again.
COPY --from=builder /app/public ./public

# Prisma schema + migrations are needed at runtime for `prisma migrate deploy`.
COPY --from=builder /app/prisma ./prisma

# The standalone output tracer only bundles what's needed to *run* the built
# app (i.e. @prisma/client's runtime + query engine), not the `prisma` CLI
# itself — but the startup command below needs `npx prisma migrate deploy`.
# Copy the CLI package and its engines explicitly from the builder stage.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# argon2 is a native module. Next's standalone file-tracer copies its JS
# (argon2.cjs) but NOT the dynamically-resolved prebuilt .node binary under
# prebuilds/, so the traced copy crashes at runtime with "No native build was
# found for ... libc=musl". Copy the full module from the builder, whose
# `npm ci` (run on this same node:20-alpine base) fetched the musl prebuild.
COPY --from=builder /app/node_modules/argon2 ./node_modules/argon2

COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# NOTE: no `USER node` here — the container starts as root so the entrypoint can
# chown a root-owned /data volume, then it drops to `node` via su-exec before
# running migrations and the server. The app process itself still runs
# unprivileged.
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
