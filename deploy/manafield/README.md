# Noctite → Manafield: isolated development deployment candidate

> **Not deployed.** The Compose manifest is intentionally independent of
> Manafield's operating database, Redis, services and Docker networks.

## Why this exists

A Noctite (Misskey 2026.10.0) instance needs its own web/backend app,
PostgreSQL, Redis and persistent media. `manafield-noctite` is a **separate**
Manafield Module that reports this server's health; it is not the SNS app.
The adapter has no DB connection and must not proxy user or ActivityPub traffic.

A production-grade Noctite address will eventually be
`https://noctite.manafield.studio/`. **Do not start a throwaway development
instance with that URL**, because ActivityPub identifiers include the host and
must not be renamed after federation begins. Reserve a distinct development
hostname and data volumes; never migrate test actors into production by
renaming their domain.

## 1. Build an image separately (operator action)

The upstream Docker Hub publisher was replaced with a
**manual** GHCR publishing workflow at `.github/workflows/docker.yml`.
It only builds when manually dispatched on a `noctite/*` branch. It uses
`GITHUB_TOKEN` to publish into `ghcr.io/eventide-manafield/noctite` as
`build-<commit SHA>`, never to the original `misskey/misskey` Docker Hub
repository.

No image has been published by this code change. Review the workflow result,
the manifest, and the generated image digest. Use `NOCTITE_IMAGE` pinned to
**the verified digest**, not to `latest`.

## 2. Prepare development-only private configuration

The deployment candidate is `deploy/manafield/compose.dev.candidate.yml`.
It expects a private `.config/default.yml` and a development-only
`deploy/manafield/secrets/database-password` outside version control.
A minimal sample (not a real config) is at
`deploy/manafield/default.dev.example.yml`.

The administrator must provide:

- A **unique development origin**, reachable over HTTPS with a valid proxy,
  different from the planned `noctite.manafield.studio` production origin.
- A random initial setup password, signup/moderation policy, reverse proxy
  trust CIDRs, and the public source repository URL for the modified AGPL app.
- PostgreSQL `db` / `noctite` user/db and Redis `redis`, both isolated.
  Leave `db.pass` absent so the process can read `DATABASE_PASSWORD`
  from the mounted secret during startup.
- Private password file created outside Git and readable in the Postgres and
  Noctite containers. The Noctite image uses nonroot UID **991**;
  explicitly verify container access to the secret rather than changing it
  to world-readable on the host. Never print the password.
- An isolated development adapter network named
  `noctite-dev-modules` (or change `NOCTITE_MODULES_NETWORK`) provisioned
  by the administrator.

Only the Noctite server joins the adapter network. The PostgreSQL and Redis
containers stay on a separate Docker `internal` network. There is **no
published host port** and no Traefik router in this Compose candidate.

The Compose project is `noctite-dev` to avoid colliding with Manafield's
existing Compose project or persistent volume names. Media, PostgreSQL
and Redis state are isolated named volumes.

## 3. Validation before any startup

1. Check the configuration with
   `NOCTITE_IMAGE=<verified-image-digest> docker compose -f deploy/manafield/compose.dev.candidate.yml config`
   from the repo root. Running `config` is read-only; running `up` is not.
2. Verify the resulting mounts, project name, network name, image digest,
   volume names, entrypoint, and secret permissions.
3. Start the development Noctite stack **only when the administrator approves**.
4. `GET /healthz/` should be 200 after PostgreSQL migrations and Redis
   readiness; check internally before touching any external routing.
5. In a *separate development Manafield Instance*, register the public
   `manafield-noctite` module and attach it to the same dev network.
   Verify `GET /manafield/health` returns `ok` when Noctite is ready,
   `degraded` when stopped, with no credentials or database shared.
6. Verify basic anonymous pages, admin creation, local signup policy, note
   creation, file uploads, and authenticated API flows *before federation*.
7. Reserve actual federation smoke testing for a stable production-ready
   hostname, validated HTTPS ingress, and an explicit allowlist of remote
   test instances. Test WebFinger, NodeInfo, inbox delivery, outbound signed
   requests, media fetch, account handles, moderation, and undo/retry behavior.

## Federation discovery smoke check (after HTTPS goes live)

Once a stable public Noctite account has been created, run this **read-only**
client from a machine outside the server's private Docker network:

```bash
node scripts/noctite-federation-smoke.mjs https://noctite.manafield.studio localusername
```

It checks HTTPS health, NodeInfo discovery, WebFinger for
`acct:localusername@noctite.manafield.studio`, and the ActivityPub actor's
inbox/outbox/public key. It does not mutate state or need credentials.
**A pass does not prove federation**: then follow the account from a real
second server and verify signed inbound follow, accept, post delivery, replies,
unfollow, blocked actors, media and retries.

## 4. Production gates

- Production site at `noctite.manafield.studio` must have working inbound
  HTTPS reverse proxy and outbound Internet access; no conflicting old
  `social.manafield.studio` account identities.
- Public modified Noctite source code plus visible repository URL in Misskey
  admin settings to satisfy AGPL publication guidance.
- Backups and restore tests of PostgreSQL and media; decide Redis persistence
  and disaster-recovery policy.
- Resource estimates for server RAM/CPU, instance capacity, and image size.
  Consider building on CI and only pulling the image on the small home host.
- Account Core SSO is **not implemented end-to-end yet** and must not be treated
  as a prerequisite for standalone SNS federation.
- Human-approved DNS/Cloudflare/Traefik changes and initial administrator
  registration, then explicitly enable public ActivityPub communications.

No sudo/Docker socket access is required for the coding agent, and no
production settings change just because this candidate merges.
