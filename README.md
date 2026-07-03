# GEM-ZT

A self-hosted [ZeroTier](https://www.zerotier.com/) network controller with a clean web GUI
and a documented REST API. Runs via Docker Compose: an official-protocol ZeroTier controller
container plus a Next.js app that manages it. Create networks, authorize members, assign IPs,
edit managed routes / DNS / flow rules, mint API keys, and read an audit log — all without
depending on my.zerotier.com.

## Quick start

```bash
docker compose up -d --build
```

Then open **http://localhost:3000** and complete the first-run setup wizard to create your
admin account. The stack is two services:

- **`zerotier-controller`** — the ZeroTier controller (`zyclonite/zerotier`). Holds the
  controller identity and all network definitions.
- **`app`** — the GEM-ZT web GUI + REST API on port 3000.

---

## ⚠️ Backups — read this before you run anything important

**The controller identity is irreplaceable.** The `controller_data` volume holds
`identity.secret`, whose node ID is the first 10 hex digits of *every* network ID (nwid) you
create. If you lose it, you can never recreate those networks with the same IDs — every device
that joined them is orphaned and must be re-provisioned onto brand-new networks.

**Never run `docker compose down -v`.** The `-v` flag deletes the named volumes
(`controller_data` **and** `app_data`) — i.e. it destroys the controller identity, every
network, and all GEM-ZT metadata. `docker compose down` (without `-v`) is safe: it stops the
containers but keeps the volumes.

Two volumes hold all state (Docker prefixes them with the compose project name — the directory
name, `zerotier`, by default; adjust if yours differs):

| Volume | Contents | Losing it means |
|---|---|---|
| `zerotier_controller_data` | Controller `identity.secret` + `controller.d/` network defs | **Unrecoverable** — networks and their IDs are gone |
| `zerotier_app_data` | SQLite DB: admin user, API keys, friendly names/notes, audit log, rules source | Recoverable-ish — networks keep working; you re-run setup and lose metadata |

### Backing up

Stop the stack first so the SQLite file and controller state are quiescent, then tar both
volumes (run from the project directory):

```bash
docker compose down            # stop containers; keeps volumes (NEVER add -v)

docker run --rm \
  -v zerotier_controller_data:/data -v "$PWD:/backup" \
  alpine tar czf /backup/gemzt-controller_data.tgz -C /data .

docker run --rm \
  -v zerotier_app_data:/data -v "$PWD:/backup" \
  alpine tar czf /backup/gemzt-app_data.tgz -C /data .

docker compose up -d           # bring it back
```

This produces `gemzt-controller_data.tgz` and `gemzt-app_data.tgz` — store them somewhere safe
(off-box). The controller archive is the critical one.

> If you must back up without downtime, at minimum snapshot `controller_data` while stopped, and
> copy the SQLite DB with `sqlite3 /data/gemzt.db ".backup /backup/gemzt.db"` rather than a raw
> file copy (a hot `cp` of an active SQLite file can be corrupt).

### Restoring

Restore into fresh, empty volumes (stack down, volumes removed or new project), then start:

```bash
docker compose down

docker run --rm \
  -v zerotier_controller_data:/data -v "$PWD:/backup" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/gemzt-controller_data.tgz -C /data"

docker run --rm \
  -v zerotier_app_data:/data -v "$PWD:/backup" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/gemzt-app_data.tgz -C /data"

docker compose up -d
```

The controller comes back with the same identity, so existing member devices reconnect with no
changes on their side.

---

## Security & exposure

The web panel is an admin surface for your controller — treat it like one.

- **Don't expose port 3000 directly to the internet or an untrusted LAN.** Put it behind a
  reverse proxy that terminates TLS and (ideally) adds its own auth. Everything, including the
  login password, is plain HTTP otherwise.
- **Set `GEMZT_SETUP_TOKEN` to lock down first-run setup.** The `/setup` endpoint that creates the
  admin account is unauthenticated until a user exists — so whoever reaches the app first can claim
  it, including if `app_data` is ever lost and setup silently re-opens. Generate a token
  (`openssl rand -hex 32`), put it in a `.env` file next to the compose file, and the wizard will
  require it to create the admin. Highly recommended if the panel is reachable by anyone but you.
- API access uses `Authorization: Bearer ztk_…` keys (managed under **API Keys**) or the session
  cookie. Full API reference is served at `/api/v1/openapi.json` and rendered under **API Docs**.

---

## Configuration

Environment variables (see `.env.example`; compose sets sensible defaults):

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:/data/gemzt.db` | SQLite location (the `app_data` volume) |
| `ZT_CONTROLLER_URL` | `http://zerotier-controller:9993` | Controller local API |
| `ZT_TOKEN_PATH` | `/controller/authtoken.secret` | Read-only-mounted controller auth token |
| `ZT_AUTH_TOKEN` | *(unset)* | Overrides the token file if set |
| `GEMZT_SETUP_TOKEN` | *(unset)* | If set, required to create the admin at first-run setup |

## Development

```bash
npm install
npm test          # vitest (unit + integration + jsdom UI); the e2e suite is CI-gated
npm run build     # prisma generate + next build
```

See [`TODO.md`](TODO.md) for the backlog (known follow-ups, an issue review, and a feature
roadmap) and `docs/superpowers/` for the design spec and implementation plan.

## Upgrading

The container now applies schema changes with **`prisma migrate deploy`** at startup (committed
migrations under `prisma/migrations/`), instead of `prisma db push`. `migrate deploy` is
non-interactive and only applies pending migrations — so a future schema change can't crash-loop
or silently drift the deployment.

**One-time baseline for a deployment created before migrations existed.** If your `app_data` DB was
first created by an older image (which used `db push`), it has no migration-tracking table, and
`migrate deploy` will fail with `P3005` ("database schema is not empty"). Baseline it once — **build the
image first** so the one-off container actually contains the migration (otherwise `migrate resolve` fails
with `P3017 migration could not be found`):

```bash
docker compose build          # rebuild the app image so it contains prisma/migrations/
docker compose run --rm app npx prisma migrate resolve --applied 20260703164130_init
docker compose up -d          # start the new image; migrate deploy now sees the baseline and is a no-op
```

Fresh installs need nothing — `migrate deploy` creates the schema from scratch.

If `migrate resolve` reports `P3008 (already recorded as applied)`, the baseline is already
done — skip it and just run `docker compose up -d --build`.
