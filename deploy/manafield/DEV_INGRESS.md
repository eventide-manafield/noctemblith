> Legacy Noctite deployment notes: this existing ActivityPub identity is never renamed in place.

# Noctemblith isolated development HTTPS ingress — operator runbook

**State:** Templates only. The initial Noctemblith/Redis/PostgreSQL development
containers may already be running on private networks. Do not replace
volumes or reset the database. Do **not** add Traefik ingress until the
first-administrator setup route has password protection.

Development origin: `https://noctite-dev.manafield.studio/`.
Production origin: `https://noctite.manafield.studio/` (a **different** instance).

## Prerequisite: private initial-administrator setup password

Misskey 2026.10.0 allows the initial administrator to be created when
`rootUserId` is null. The endpoint checks `config.setupPassword` **only if
configured**; without it, the first unauthenticated visitor can claim initial
administrator status. A running healthy server is not proof that this risk is
mitigated. Protect the development account before routing public HTTPS.

From the existing development worktree, on an operator-controlled SSH TTY:

```bash
cd /opt/manafield/ai-workspace/work/noctite-dev-20261013
sudo python3 scripts/noctemblith-set-dev-setup-password.py .config/default.yml
```

The helper requests a strong, unique **setup password** twice without echo,
requires at least 12 characters, refuses the wrong origin or missing `id: aidx`,
and writes to Git-ignored `.config/default.yml`. It changes the file to
root-owned mode 0600 with read ACL only for the container UID 991. The
password is neither logged nor included in shell arguments/command history.
It is **not** the future administrator's login password. Do not share it in
chat; store it safely. Do not run if a root user was already created.

Restart **only the app** so it loads `setupPassword`; preserve databases:

```bash
docker restart noctite-dev-noctite-1
docker ps --filter name=noctite-dev
```

Wait for `noctite-dev-noctite-1` to become healthy again. Do not publish any
HTTP route while the app is unhealthy.

## 1. Attach only Noctemblith to the existing Traefik network

`compose.dev-edge.candidate.yml` adds the existing external
`manafield-edge` network **only to the Noctemblith app**, keeping Postgres/Redis
private. This is an optional overlay on the already-running private
`compose.dev.candidate.yml`.

**Dry-run first** with the exact verified image digest:

```bash
export NOCTEMBLITH_IMAGE='ghcr.io/eventide-manafield/noctemblith@sha256:eb5970069a3f94f06fd456aadb9f94f5ed939d854ac34c487da88eec84b59c27'

docker compose -f deploy/manafield/compose.dev.candidate.yml \
               -f deploy/manafield/compose.dev-edge.candidate.yml config --quiet
```

Do not recreate PostgreSQL or Redis. After an administrator verifies the
resulting network and config, the app can be recreated on both existing dev
networks, without touching the healthy dependencies:

```bash
docker compose -f deploy/manafield/compose.dev.candidate.yml \
               -f deploy/manafield/compose.dev-edge.candidate.yml up -d --no-deps noctemblith

docker compose -f deploy/manafield/compose.dev.candidate.yml \
               -f deploy/manafield/compose.dev-edge.candidate.yml ps
```

These commands **change running containers**. Never add `down -v`.

## 2. Add dedicated development HTTPS route (not yet installed)

Review `traefik.noctite-dev.candidate.yml`; it is only a proposed new route:

```text
Host(noctite-dev.manafield.studio)
  → Traefik websecure
  → Docker network manafield-edge
  → http://noctite-dev:3000
```

Do **not** edit the generated Manafield router file or its Account/Core
services. After verifying the stable dev origin, Traefik certificate coverage,
Cloudflare DNS/proxy routing, the private setup password is loaded and the
first administrator setup flow is secure, an operator may install this
**additional** file into their existing Traefik dynamic config directory.
If possible, add temporary IP allowlisting or HTTP authentication while
initial setup/moderation controls are being configured. Additional auth can
block ActivityPub discovery and therefore must be explicitly removed before
any federation tests.

Before opening registrations, create the initial admin account with the
setup password and set a deliberate registration/moderation policy.
Do not automatically register Noctemblith/Manafield users yet: SSO is incomplete.

## 3. Check the runtime in order

1. `docker ps --filter name=noctite-dev`: all three dev services healthy.
2. Internal health from the Noctemblith container:
   `docker exec noctite-dev-noctite-1 curl -fsS http://127.0.0.1:3000/healthz/`
3. Browser opens `https://noctite-dev.manafield.studio/` with correct TLS,
   and initial administrator setup requires the chosen setup password.
4. User signup/moderation policy configured by operator; no anonymous admin
   escalation; asset and API routing work.
5. Check NodeInfo/WebFinger with a locally created dev test account:
   `node scripts/noctemblith-federation-smoke.mjs https://noctite-dev.manafield.studio <local-user>`
6. Only after an explicit decision to federate: verify with **another test
   ActivityPub server** that follows, posts, accepts and undoes are delivered.

**Important:** The dev ActivityPub usernames and actor IDs belong forever to
`noctite-dev.manafield.studio`. They are not migrated into
`noctemblith.manafield.studio` by renaming a Compose project.

## 4. Common failures

- Still 404 externally: missing installed Traefik route or Cloudflare origin
  rule. Check public routing and certificate before changing Noctemblith config.
- Traefik 502: app missing the `manafield-edge` network or alias,
  unhealthy app, or wrong router backend.
- App restarts: check `docker logs --tail 100 noctite-dev-noctite-1`.
  `id: aidx` is required; never change the ID scheme after use.
- Setup password rejected: configuration was changed but Noctemblith was not
  restarted; verify file permissions and that the correct dev config is mounted.
- Existing MariaDB/Noctemblith/manafield data: this runbook does not import
  or reset any pre-existing services. Do not connect the independent
  Noctemblith DB to Manafield's operating database.
