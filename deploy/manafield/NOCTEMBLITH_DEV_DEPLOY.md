# Noctemblith isolated development deployment

Status: CANDIDATE ONLY. Do not start or modify containers on source merge.

The new immutable ActivityPub origin is https://noctemblith-dev.manafield.studio/.
The existing https://noctite-dev.manafield.studio/ must continue running unchanged.
Do not change the origin of an existing federated instance in place.

## Prerequisites

1. Merge code, then have the owner rename the GitHub repository to eventide-manafield/noctemblith.
2. Create and verify branch noctemblith/dev at the reviewed commit. Manually trigger docker.yml on this new branch.
3. Verify GHCR image digest ghcr.io/eventide-manafield/noctemblith@sha256:<digest>.
4. Deploy from a SEPARATE folder. Set .config/default.yml with the NEW origin, database noctemblith on db, Redis redis, new admin setup password.
5. Create a new private deploy/manafield/secrets/noctemblith-database-password. Do NOT reuse an old instance password.
6. Prepare the external development-only network noctemblith-dev-modules, isolated from production.
7. Check both Compose candidates: project noctemblith-dev, app service noctemblith, independent PostgreSQL/Redis/media volumes.

## Operator verification

With NOCTEMBLITH_IMAGE set to the verified immutable GHCR digest, check:

    docker compose -f deploy/manafield/compose.noctemblith-dev.candidate.yml -f deploy/manafield/compose.noctemblith-dev-edge.candidate.yml config --quiet

After explicit operator approval only, start the new development stack:

    docker compose -f deploy/manafield/compose.noctemblith-dev.candidate.yml -f deploy/manafield/compose.noctemblith-dev-edge.candidate.yml up -d --pull always

Review and install traefik.noctemblith-dev.candidate.yml separately in Traefik's dynamic directory.
Never replace the original Noctite ingress router or connect the old DB/media.
Verify HTTPS, certificates, /healthz/, /noctemblith-build.json, new emoji asset and admin setup.
At present DNS resolves for the new name but HTTP 404 is expected until new ingress/app is configured.

Do not use down -v. The old Noctite emoji seeder and PNG have been deleted from the new source.
The historical, already-shipped Noctite migration is intentionally preserved. The fresh Noctemblith
emoji uses its own Noctemblith bootstrap-state migration.
