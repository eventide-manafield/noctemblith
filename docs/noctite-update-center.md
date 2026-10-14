# Noctite update center (v0.1)

Namespace: `studio.manafield.eventide` in the TypeScript source tree
`packages/frontend/src/studio/manafield/eventide/`.

## Scope

The Noctite **administrator-only** control panel shows an update notice
when a verified GHCR build from the configured channel is strictly ahead
of the image currently running. This is the approval and notification
stage of an update system, **not an in-browser Docker control panel**.

The feature is available from **Control Panel → Noctite 업데이트** at
`/admin/noctite-updates`. A compact notice also appears when a Noctite
administrator enters the admin control panel and there is an actionable
update. Moderators cannot access the actual update panel.

## Detection (public metadata, no secrets)

The GHCR publishing workflow `.github/workflows/docker.yml` embeds
build-time **commit SHA** and **channel** into the image's
`/misskey/packages/backend/assets/noctite-build.json`, served with
`Cache-Control: no-store` at `/noctite-build.json`.

The frontend:
1. Reads current SHA/channel from its **own** server (same origin).
2. Reads the latest successful manual Docker image workflow run on that
   same `noctite/*` branch via GitHub's *public* REST API.
3. Compares commits via the public GitHub compare API and only advertises
   a candidate if its commit is `ahead` of the currently installed SHA.

The workflow only reports success **after** the Docker image push step
succeeds. Docker manifests can still be deleted later: the operator must
verify the actual GHCR digest before deployment.

If image metadata is unavailable (e.g. an old image), or GitHub is
unavailable/rate-limiting, the panel says so instead of inventing an
available update. There is no GitHub token in the browser or image.
Potential API limits and browser cross-origin network policy apply.

## Three equal choices

- **업데이트 적용**: opens human-readable manual deployment instructions,
  a verified workflow run link, and copyable immutable source-SHA image
  tag. It does **not** execute an update. GHCR **digest** must still be
  confirmed by the operator before using Docker.
- **이번 버전 건너뛰기**: hides the precise candidate SHA indefinitely.
  A newer successful build can still be shown.
- **7일 뒤 다시 보기**: hides the precise candidate SHA for seven days;
  a newer candidate can still be shown immediately.

For v0.1 decisions are persisted with the **instance's own browser**
`localStorage`, scoped per signed-in administrator account ID and web
origin. They are **not** synced between devices or admin accounts.
Future server-side settings can implement shared policy. Buttons never
modify current Docker containers, secret files or a database.

## Operator-controlled build and deployment

Open:
https://github.com/eventide-manafield/noctite/actions/workflows/docker.yml

Select `Run workflow` and **Branch: `noctite/dev`**.
This creates
`ghcr.io/eventide-manafield/noctite:build-<exact 40-character SHA>`.

The workflow summary provides the verified digest.
After making a PostgreSQL backup, update **only the Noctite application**
using both existing dev Compose files and an immutable image digest.
Do not use `down -v`; do not change `id: aidx`, the
`noctite-dev.manafield.studio` origin, Redis, volumes, secrets,
existing Traefik routes or the production environment.

Until an isolated privileged updater has been explicitly designed,
authorized and separately deployed, the application itself **never gets
Docker socket, sudo or systemd write access**.

### Future v0.2

A separate operator-scoped updater with constrained allowlisted actions
may later perform digest verification, preflight/backup,
`docker compose up -d --no-deps noctite`, health checks and audit
recording with explicit confirmation. This is **not** part of v0.1.

## Local checks

```bash
node --experimental-strip-types --test scripts/noctite-update-center.test.mjs
node --test scripts/noctite-branding.test.mjs scripts/noctite-themes.test.mjs
```

A full frontend typecheck/build and end-to-end administrator-browser smoke
test should be performed before publishing a release. New deployments must
be built from this commit (older Noctite images lack the runtime SHA file).
