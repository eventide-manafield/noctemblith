# Noctite update channels · v0.2a, updater design · v0.2b

## v0.2a: server-wide subscription and manual development visibility

- The **instance administrator** manages the **server-level** update subscription in the existing Noctite admin settings. This is stored as `MiMeta.noctiteUpdateChannel` and updated only via the authenticated, `requireAdmin: true` `admin/update-meta` endpoint. A migration defaults existing instances to `noctite/release/latest`.
- Only `noctite/release/latest` and `noctite/dev` are valid subscription values; arbitrary repositories, URLs or branch names are never accepted.
- The compact admin dashboard notice consults the saved subscription channel, **not** the source channel embedded in the running image. A dev image alone does not subscribe an instance to dev notifications.
- The **개발 빌드 보기** switch is administrator-account-scoped browser state. It changes the **detailed page's current inspection channel only**, without editing the server subscription or causing compact dev notifications.
- A deliberate server-level subscription to dev is supported, but must be saved by an instance administrator.
- For dev **업데이트 적용**, a warning and explicit confirmation checkbox are required before opening the manual deployment instructions. These are not a substitute for a backup or an operator's deployment approval.
- Update availability requires: correct branch, successful manual publishing run, well-formed commit SHA and GitHub compare status `ahead` of the installed image. A diverged or behind channel is **not** a safe update and is not offered.
- Clicking **업데이트 적용** continues to be **manual guidance only** in v0.2a. No Docker, shell, privileged socket, secret, or deployment API capability is exposed to the web application.

### Release promotion rule

The `noctite/release/latest` branch is a **publication channel**, not a floating Docker `:latest` tag. It must be created/promoted only from tested, operator-approved commits. A workflow success on `noctite/dev` **does not** make it an approved release. Exact `build-<40-char SHA>` tag and verified `sha256` digest identify each published image.

Do not create or force-update `noctite/release/latest` automatically from `noctite/dev`. Until the release branch and its own successful GHCR workflow exist, the release subscription should show an empty/not-yet-built state, not fall back to dev.

### Required verification before deployment

1. Run Node update-center unit tests, branding/theme tests, the SPDX check and changed-file lint.
2. Rebuild `misskey-js` API types after changing `admin/meta` / `admin/update-meta`.
3. Compile frontend/backend; validate the migration with a **disposable isolated test DB**, never the live instance DB.
4. Test the administrator screen and multi-admin server-wide subscription; moderator access must be denied.
5. Confirm the compact notice remains silent when only `noctite/dev` has a new build and the server subscription is release.
6. Confirm view-dev does not modify the subscription, and development manual apply requires acknowledgment.
7. Back up live PostgreSQL and media before an operator-authorized application-only image replacement.

## v0.2b: privileged deployment execution — separate security boundary

**Not implemented or enabled by v0.2a.** Separate review and explicit operator approval required.

The web Noctite service must **never** gain the Docker socket, privileged container access, sudo, raw shell command execution or access to host configuration credentials.

Proposed narrow architecture:

1. A dedicated, local, operator-controlled updater runs outside the Noctite container with a fixed service identity and constrained action allowlist. It is not publicly network-exposed.
2. A backend route authenticates a real Noctite instance administrator, applies CSRF/session and rate controls, verifies an operation-specific confirmation, and sends a **structured**, one-use request to the local updater. The updater must independently validate authorization; a frontend role flag is not sufficient.
3. Allow only operator-configured project `noctite-dev` (initial pilot) and the single app service `noctite`. No arbitrary Compose paths, repositories, volume changes, shell flags, commands or image references supplied by clients.
4. The updater independently confirms the GitHub Actions workflow run, branch and SHA, checks that candidate commit is ahead, and resolves/verifies the GHCR image **digest**. Prevent replay, concurrent updates and downgrade.
5. Preflight must verify current service state, Compose file identity, volume bindings, host free space, backup availability and a maintenance window. Produce a verified PostgreSQL backup and confirm the media backup policy **before** replacing anything.
6. Only then run an allowlisted `docker compose -f ... -f ... up -d --no-deps noctite` with pinned digest. PostgreSQL/Redis services and all named volumes remain untouched.
7. Verify `/healthz/`, runtime SHA, administrator UX and DB migration state, with bounded timeouts and an append-only audit record.
8. Provide a non-destructive failure state and manual recovery instructions. Do **not** claim that rolling the image back reverses database migrations.
9. Verify threat model: administrator compromise, forged updater request, untrusted GHCR image, symlink/path escape, GitHub API outage, missing backup, power loss, concurrent request, and broken migrations.

Pilot v0.2b only on isolated dev after testing. Production opt-in requires separate operator review, backups, recovery plan and new privilege boundary review.
