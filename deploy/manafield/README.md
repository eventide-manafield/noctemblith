# Noctemblith deployment templates

The actively configured development instance is kept outside the Git repository at
`/opt/manafield/ai-workspace/deployments/noctemblith-dev/`.
That directory contains its own Docker Compose, private database/Redis/media volumes,
an operator-owned `.config/default.yml`, Docker secrets and a Traefik route candidate.

New development origin: `https://noctemblith-dev.manafield.studio/`.
Compose project: `noctemblith-dev`; app service: `noctemblith`.

The `compose.noctemblith-dev.candidate.yml`, `compose.noctemblith-dev-edge.candidate.yml`,
`default.noctemblith-dev.example.yml` and `traefik.noctemblith-dev.candidate.yml`
files in this directory are **reference templates**, not the running Compose files.
See `NOCTEMBLITH_DEV_DEPLOY.md` for the actual deployment path and checks.

Never change the origin of an existing federated server in place. Do not run
`docker compose down -v`, copy secrets into the repository, expose PostgreSQL or Redis
to the public edge, or apply candidate Traefik files without operator approval.

Production deployment is a separate decision with new secrets, volumes and a
permanent hostname. The existing deployment is **development only**.
