#!/bin/sh
# Runs pending Prisma migrations against the (possibly freshly-mounted) SQLite
# volume before handing off to the standalone Next.js server. Kept as a
# separate script (rather than an inline `CMD ["sh", "-c", ...]`) so it's easy
# to extend later (e.g. add a wait-for step) without re-quoting shell strings
# inside the Dockerfile.
set -e

# The app runs unprivileged as `node`, but a volume mounted at /data can arrive
# root-owned — e.g. a volume that predates this image running non-root, or a
# host bind-mount. SQLite (WAL mode) then can't create the DB or its -wal/-shm
# sidecars and fails with "disk I/O error". If we're started as root, take
# ownership of /data and re-exec this same script as `node`; if we're already
# `node` (e.g. `docker run --user node`), skip straight through.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data

  # The controller's authtoken.secret is root-owned mode 0600 and mounted
  # read-only at /controller, so the unprivileged `node` user can't read it and
  # the app reports "controller degraded". While we're still root (and can read
  # the RO mount), mirror it into a node-readable copy and point the app there.
  # Skipped if the operator supplied ZT_AUTH_TOKEN explicitly (takes priority in
  # lib/controller/token.ts) or the source isn't present yet.
  if [ -z "$ZT_AUTH_TOKEN" ] && [ -r /controller/authtoken.secret ]; then
    mkdir -p /run/gemzt
    cp /controller/authtoken.secret /run/gemzt/authtoken.secret
    chown node:node /run/gemzt/authtoken.secret
    chmod 400 /run/gemzt/authtoken.secret
    export ZT_TOKEN_PATH=/run/gemzt/authtoken.secret
  fi

  exec su-exec node "$0" "$@"
fi

# Next's standalone server binds to $HOSTNAME. Docker sets HOSTNAME to the
# container id, so the server would bind only to the container's external IP —
# in-container loopback calls (the compose healthcheck hits localhost:3000) then
# get ECONNREFUSED. Force binding on all interfaces. Set here (not just as a
# Dockerfile ENV) so it reliably wins over Docker's runtime HOSTNAME injection.
export HOSTNAME=0.0.0.0

# Invoke the Prisma CLI's entry module directly rather than via the
# node_modules/.bin/prisma shim: Docker's COPY dereferences that symlink into a
# plain file, so the shim then resolves its WASM assets relative to .bin/ and
# crashes with ENOENT on prisma_schema_build_bg.wasm.
node /app/node_modules/prisma/build/index.js migrate deploy

exec node server.js
