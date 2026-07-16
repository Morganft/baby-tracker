# Deployment — Proxmox (LXC + Docker, behind Caddy over Tailscale)

This runbook deploys baby_tracker to a self-hosted Proxmox box. The app is already
self-host-ready: full-stack **SvelteKit (adapter-node)**, single-file **SQLite** on a Docker
volume, **auto-migrations on boot**, and **no auth by design** (the LAN/VPN is the security
boundary — see `AGENTS.md`).

## Target architecture

| Value                    | Setting                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| App URL / `ORIGIN`       | `https://baby.home`                                                                                     |
| Reverse proxy            | **Caddy**, on a **separate LXC** (also runs Tailscale)                                                  |
| App host                 | **Debian LXC + Docker** on Proxmox, `local` storage, **DHCP**                                           |
| App LXC needs Tailscale? | **No** — the Caddy LXC handles Tailscale; it reaches the app over the LAN                               |
| App LXC sizing           | 2 vCPU / 2 GB RAM / ~8 GB disk                                                                          |
| Delivery                 | `git clone` + `docker build` on the app LXC (compiles the `better-sqlite3` native module for this host) |

Data flow: Tailscale device → Caddy LXC (`baby.home`, TLS) → app LXC `:3000`.

> **DHCP caveat:** the app LXC's IP is Caddy's upstream. If DHCP reassigns it, the proxy breaks
> silently after a reboot. Add a **DHCP reservation** (or resolve it by hostname) so the IP is stable.

## What the repo already handles (don't re-do these)

- `Dockerfile`: two-stage `node:22` build → `node:22-slim` runtime. Sets `DATABASE_URL=/data/app.db`,
  `PORT=3000`, `VOLUME /data`, `EXPOSE 3000`, `CMD ["node","build"]`.
- `docker-compose.yml`: `restart: unless-stopped`, `3000:3000`, named volume `baby-tracker-data:/data`.
- **Migrations run automatically on boot** (`src/lib/server/db/index.ts`), so a fresh container
  self-provisions its schema and default templates. No manual migration step.
- The **only** required env var is `ORIGIN` (below). `DATABASE_URL` / `PORT` are already set in the image.

---

## 1. Create the LXC on Proxmox

Create an **unprivileged** Debian 12 LXC (2 vCPU / 2 GB / 8 GB, `local` storage, DHCP — ideally
reserved). Enable Docker-in-LXC support: on the Proxmox host, add to `/etc/pve/lxc/<CTID>.conf`:

```
features: nesting=1,keyctl=1
```

Then start the container.

## 2. Install Docker in the LXC

```sh
apt update && apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker run --rm hello-world   # sanity check
```

## 3. Get the code

```sh
git clone <repo-url> /opt/baby_tracker
cd /opt/baby_tracker
# deploy from main unless told otherwise
```

Do **not** copy any local dev DB (`local.db*`) — it's gitignored/dockerignored and must not ship.

## 4. Configure for this host

Create `/opt/baby_tracker/docker-compose.override.yml` (untracked → survives `git pull`; Compose
auto-merges it):

```yaml
services:
  app:
    environment:
      # The external URL clients actually use, via Caddy. REQUIRED.
      # If ORIGIN is wrong, adapter-node rejects every POST/form submission (CSRF check).
      ORIGIN: https://baby.home
    ports:
      - '3000:3000'
```

## 5. Build and run

Optional but recommended — run the **preflight build gate** first. It reproduces
the Dockerfile's build stage with no `DATABASE_URL` (deploy conditions), catching
any server module that connects to the DB or reads a required env var at *import*
time — a class of bug the normal `npm run build` gate hides because it sets
`DATABASE_URL`:

```sh
cd /opt/baby_tracker
scripts/preflight-build.sh    # fails fast if the production build won't compile
```

Then build and run:

```sh
cd /opt/baby_tracker
docker compose up -d --build
docker compose logs -f          # expect a clean adapter-node start, no migration errors
curl -sSI http://localhost:3000/ # expect 200
```

## 6. Point Caddy at it (on the separate LXC)

Add to the Caddyfile:

```
baby.home {
    tls internal
    reverse_proxy <app-lxc-ip>:3000
}
```

- `tls internal` is required because `baby.home` isn't a public domain — Caddy signs it with its
  own internal CA. Trust that CA on each device (export Caddy's root cert) or accept the warning.
  Caddy auto-forwards `Host` / `X-Forwarded-Proto` / `X-Forwarded-For`, so `ORIGIN` lines up.
- **HTTP alternative** (no CA to trust): `http://baby.home { reverse_proxy <app-lxc-ip>:3000 }`
  and set `ORIGIN: http://baby.home`. But PWA install + service workers want HTTPS, so `tls
internal` is preferred.

Reload Caddy (`systemctl reload caddy`). Confirm `baby.home` resolves to the Caddy LXC and that
`ORIGIN` matches the URL **exactly** (scheme + host, no trailing slash).

## 7. Backups

Everything is in the `baby-tracker-data` volume (`/data/app.db` + WAL sidecars).

- **Recommended (app-consistent):** nightly cron on the app LXC using the built-in export:
  ```sh
  curl -fsS http://localhost:3000/api/export -o /opt/backups/baby-$(date +%F).json
  ```
  Restore via `POST /api/import` (merge / last-write-wins). Round-trip is verified by
  `scripts/verify-backup.sh`.
- **File-level (optional):** because WAL is on, never copy a live `.db` alone — stop the container
  or use SQLite `.backup`. Volume path: `/var/lib/docker/volumes/baby-tracker-data/_data/app.db`.
- Optionally add a Proxmox vzdump backup of the whole LXC as a coarse safety net.

## 8. Updates

```sh
cd /opt/baby_tracker && git pull
scripts/preflight-build.sh            # catch build-breaking regressions before swapping the container
docker compose up -d --build
```

The volume persists; any new migrations apply automatically on the next boot.

## Verification checklist

1. `docker compose ps` → `baby-tracker` is `Up`; logs show a clean start, no migration errors.
2. `curl -I http://localhost:3000/` on the LXC → `200`.
3. Open `https://baby.home` from a Tailscale device → app loads.
4. **Write path (the `ORIGIN` test):** log a sleep entry from the UI. If it saves, `ORIGIN` is
   correct; a failed POST means it doesn't match the browser URL.
5. **Persistence:** `docker compose restart` (or reboot the LXC), confirm the entry survives.
6. **Backup round-trip:** run `scripts/verify-backup.sh` before relying on backups.
