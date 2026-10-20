# Noctemblith DEV — current deployment

Development origin: `https://noctemblith-dev.manafield.studio/`.
Separate Compose project: `noctemblith-dev`; PostgreSQL 18 and Redis 7 remain
on the internal `noctemblith_private` network. Only the application joins
the shared `manafield-edge` network as alias `noctemblith-dev`.

## Deployment files on the authorized host

All running Compose configuration and secrets live under:

`/opt/manafield/ai-workspace/deployments/noctemblith-dev/`

Files: `docker-compose.yml`, `.config/default.yml`, `secrets/db-password`,
`traefik.noctemblith-dev.yml`, `DEPLOY_README.md`.

Do not echo, copy to Git, or transmit the setup password or database password.
The Compose image is pinned to a verified immutable digest.

## Current staging sequence

1. After a new reviewed build, update the image digest in the *operator*
   deployment directory's Compose file (not the reference template).
2. Log in as an authorized member of the Docker group and run:

       cd /opt/manafield/ai-workspace/deployments/noctemblith-dev
       docker compose config --quiet
       docker compose up -d --pull always
       docker compose ps

3. Check the app, database and Redis are all `healthy`; migrations run at app
   startup. A missing Docker secret or file permission must be fixed without
   resetting the database.
4. After all services are healthy, an administrator may install the new
   Traefik route from `traefik.noctemblith-dev.yml` under its own separate
   filename in `/home/nayuz/infra/traefik/dynamic/`.
5. Verify HTTPS `/healthz/`, `/noctemblith-build.json`, the canonical
   `noctemblith.svg` and built-in `:noctemblith:` emoji. Register the initial
   admin only using the locally stored setup password.

Do not publish PostgreSQL/Redis ports, change an existing ActivityPub origin,
or remove Docker volumes. Stop the app with `docker compose stop` if required.

## Source compatibility policy

Already-applied DB migration files are immutable. The new project evolves
its own `noctemblithUpdateChannel` column using a separate rename migration
instead of rewriting migration history. The web UI exposes only the new brand.
