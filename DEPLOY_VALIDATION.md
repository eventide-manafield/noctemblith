# Noctemblith device-session validation deployment

## Scope and constraints

- **Only** deploy to https://noctemblith-dev.manafield.studio/.
- Preserve standalone https://noctemblith-only.manafield.studio/, its native login, ActivityPub origin and PostgreSQL/Redis/media volumes.
- Existing dev account records and messages must be kept. The backup is only for recovery.
- Existing authenticated dev browsers with old 16-character shared native tokens will need to sign in again after rollout.
- Do not describe this feature as central logout; only service-specific per-device logout is added.

## Procedure

1. Review PR #23 full CI and merge into `noctemblith/dev`.
2. Confirm the resulting **merge commit SHA**, not the PR source head SHA; pin this in `deploy-device-sessions-dev.sh`.
3. Run read-only preflight as SSH user `nayuz` using `--check`.
4. Trigger manual GitHub Actions `docker.yml` workflow using `--build`. That publishes `ghcr.io/eventide-manafield/noctemblith:build-<merge SHA>`.
5. After the exact GitHub run succeeds, run `--deploy`. This fetches immutable digest, backs up the isolated dev database, verifies Compose and recreates only the app, then checks health/build SHA and SSO isolation.
6. Independently verify that the dev public build equals the newly merged SHA and standalone remains on `e7bd0feada2c951d0c88ced3f5f9a19b799f9f99`.

## Browser E2E checks

- Login on PC and phone (or two separate browser profiles). The two login tokens must be distinct; **never paste these tokens into chat/logs**.
- Log out on PC. Verify PC's authenticated HTTP API fails and active WebSocket disconnects within the bounded validation interval; phone remains logged in and functional.
- Central Manafield login session must remain valid after the PC's Noctemblith-only logout.
- Log in to Noctemblith again on PC with the still-valid central login.
- Repeat Noctemblith logout with multiple saved same-origin accounts: all browser tokens being removed from local storage must be revoked.
- Test old shared native credential is not accepted by integrated API after upgrade; login anew with an existing linked account, no duplicate actor creation.
- Check native signup/signin on independent standalone as regression, without resetting it.
- If dev health checks fail the script rolls back the app image; database schema migrations are **not** automatically reversible and backup is preserved.

## Note

This phase does not implement central logout backchannel or reverse SSO, and it does not require any Account Core image change. Do not roll out to standalone or production without separate verification/approval.

## GitHub merge and deploy script (2026-10-16)

- PR #23 was merged to `noctemblith/dev` as **`62f3b2595473767a61fb74c37b6243be1d3b4a13`**.
- PR's final reviewed source head was `1ab199a1bab6e34013b822ef9435f46224462f36` (including self-reference TypeScript and ESLint formatting fixes).
- Targeted deployment script is `/opt/manafield/ai-workspace/work/noctemblith-device-sessions-20261016/deploy-device-sessions-dev.sh`, with three modes: `--check`, `--build`, `--deploy`.
- `--build` and `--deploy` require **all 10 reviewed PR workflows** to be green. `--deploy` also requires a successful manual `docker.yml` build for the exact merged SHA and an immutable image digest. If CI is pending, **no deployment will occur**.
- The script preserves `noctemblith-only` and its image, creates a new immutable dev-only override and PostgreSQL backup, recreates only `noctemblith-dev` app, and rolls back the app image to `f4d08b443ab666360530b5807f56bf36931d4cdb` on health failure.
- `manafield-agent` cannot access Docker and has no GitHub CLI authentication, so operator `nayuz` must execute those commands via SSH. The scripts were staged but not run by the agent.
