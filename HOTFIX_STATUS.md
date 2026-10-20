# SSO Login Token Hotfix (2026-10-16)

## Incident
After Noctemblith-dev deployed source `62f3b2595473767a61fb74c37b6243be1d3b4a13`, Manafield OAuth login showed '로그인 인증이 만료되었거나 실패했습니다. 다시 시도해 주세요.' even after retries.

## Verified cause
- Backend `SigninService.ts` returns a new per-device 48-character `mfs1_` browser token in SSO-enabled mode, stored as a hashed Redis key.
- Frontend `packages/frontend/src/pages/manafield-login-finish.vue` continued to reject login result unless `result.i.length === 16`.
- `completeLogin()` throws `invalid_login_response`; the Vue catch incorrectly presents it as expired/failed OAuth authentication. The OAuth provider, UUID link, and DB are not implicated by that specific code path.
- Public dev build and SSO health verified: build `62f3b259...`, HTTP 200, SSO enabled. Standalone unchanged on `e7bd0fea...`.

## Fix
- GitHub PR #24: https://github.com/eventide-manafield/noctemblith/pull/24
- Fix branch head `480d6d2efd55445586338b09e0b4bed45cb54808`, merged to `noctemblith/dev` as `c2f5f3e87600e52393e55466a1aa7192526d3616`.
- New validator accepts `mfs1_[A-Za-z0-9_-]{43}` and legacy 16-character credentials; malformed login tokens still rejected. Added frontend unit tests.
- Direct Node strip-types smoke assertions passed, `git diff --check` passed. Remaining GitHub PR CI checks must pass before GHCR build and dev-only rollout.

## Immediate restore, if needed
As SSH user `nayuz`, recreates only dev app from prior known-good image:
```bash
cd /opt/manafield/ai-workspace/deployments/noctemblith-dev
docker compose \
  -f docker-compose.yml \
  -f docker-compose.manafield-sso.candidate.yml \
  -f docker-compose.public-handle-20261016T005506Z.image.yml \
  up -d --no-deps --force-recreate noctemblith
```
No volumes/database/origin/standalone changes.

## Hotfix rollout
Operator script: `/opt/manafield/ai-workspace/work/noctemblith-sso-token-hotfix-20261016/deploy-sso-login-token-hotfix-dev.sh`

Run only if dev instance is still on broken `62f3b259...`; the script refuses to proceed after emergency rollback because its expected baseline would differ. If rollback happened, update and re-review its baseline before using it.
1. `gh pr checks 24 --watch --repo eventide-manafield/noctemblith`
2. `bash "$SCRIPT" --check`
3. `bash "$SCRIPT" --build` -> manual GHCR `docker.yml`, exact merged SHA.
4. After manual GHCR success: `bash "$SCRIPT" --deploy` (dev DB backup + app-only recreate; health and build hash checks; fallback to prior good image on failure).

Never issue credentials in logs. Post-fix browser E2E: OAuth -> 48-character token -> Noctemblith login -> per-device logout -> other device remains authenticated, standalone unchanged. Hard reload to ensure updated frontend assets.

## 2026-10-16 11:35 KST — Hotfix rollout auto-rollback caused by standalone HTTP timeout
- Operator executed `deploy-sso-login-token-hotfix-dev.sh --deploy`. GitHub exact merged SHA `c2f5f3e87600e52393e55466a1aa7192526d3616` and PR CI 7/7 verified; immutable GHCR digest `sha256:a4e05a40351f7e1e5f0b1e3ee6faa99bfa867c9e10531d0622b31e2b272df0af` was pulled.
- Pre-rollout isolated dev DB backup verified: `/home/nayuz/.local/share/manafield/backups/noctemblith-dev/pre-sso-login-hotfix-20261016T023448Z.dump`.
- New dev app container started, but a **public HTTPS request to the standalone instance** timed out (curl exit 28, empty JSON gave `JSONDecodeError`). The script incorrectly interpreted the failed request as an actual standalone build change and rolled back DEV to known-good `f4d08b443ab666360530b5807f56bf36931d4cdb`. No DB reset.
- Independent read-only checks immediately afterward: dev `f4d08b...`, health 200, SSO true; standalone `e7bd0fe...`, health 200, SSO false; Account Core login HTTP 200. The standalone did **not** actually change based on these checks.
- Fixed **the same** server-side deploy script in place: `/opt/manafield/ai-workspace/work/noctemblith-sso-token-hotfix-20261016/deploy-sso-login-token-hotfix-dev.sh`. `http_get` now retries/transient errors; `build_sha` avoids JSON traceback on failed HTTP; preflight reports network unavailability rather than fake build drift. After successful dev health, dev SSO and exact commit checks, rollback trap is cleared **before** standalone post-checks. Unchanged standalone Docker container ID and image are authoritative isolation checks; standalone HTTPS timeouts are warnings, not reasons to roll back a healthy dev deployment. Definite standalone discrepancy exits nonzero without undoing healthy dev. `bash -n` and static script guard checks passed.
- No further Docker action was executed by agent (`manafield-agent` cannot access Docker). User `nayuz` can run `bash SCRIPT --check` then `bash SCRIPT --deploy` (no additional `--build`: immutable image already published). Final authenticated browser OAuth login and two-device logout E2E remain needed.

## 2026-10-16 11:43 KST — Hotfix deploy succeeded (operator)
- Operator successfully reran the corrected `deploy-sso-login-token-hotfix-dev.sh --check` and `--deploy` as `nayuz`.
- PR #24 reviewed CI 7/7 success, deployed exact merge `c2f5f3e87600e52393e55466a1aa7192526d3616`, pinned GHCR image `sha256:a4e05a40351f7e1e5f0b1e3ee6faa99bfa867c9e10531d0622b31e2b272df0af`.
- Isolated dev DB backup verified `/home/nayuz/.local/share/manafield/backups/noctemblith-dev/pre-sso-login-hotfix-20261016T024328Z.dump`; dev-only Compose image override `/opt/manafield/ai-workspace/deployments/noctemblith-dev/docker-compose.sso-login-hotfix-20261016T024328Z.image.yml`.
- Read-only public checks independently showed dev `/noctemblith-build.json` at exact `c2f5f3e...`, `/healthz/` success, `/auth/manafield/status` enabled=true; standalone still `e7bd0feada2c951d0c88ced3f5f9a19b799f9f99`, healthy, SSO=false. Account `/account/oauth/profile-handle` unauthenticated HTTP 401 expected.
- **Deployment and health verified. Authenticated browser E2E NOT YET VERIFIED.** Next: force-refresh frontend, Manafield OAuth login, verify new per-device token issuance (do not expose tokens), signout on one device while second session remains active, Account Core login stays valid; check old-token client re-authentication. Standalone unaffected.

## 2026-10-16 12:00 KST — User browser E2E succeeded for independent device sessions
- User explicitly reported all four browser checks **PASSED** after dev-only hotfix rollout at source `c2f5f3e87600e52393e55466a1aa7192526d3616` / pinned image `sha256:a4e05a40351f7e1e5f0b1e3ee6faa99bfa867c9e10531d0622b31e2b272df0af`.
- (1) Manafield Account Core → integrated Noctemblith-dev OAuth sign-in completed successfully, no previous expired/failed login screen.
- (2) Same account logged in on PC and mobile/separate browser environments.
- (3) Logging out of Noctemblith on PC did not log out Noctemblith on mobile.
- (4) Noctemblith logout left the central Manafield Account Core session signed in.
- Conclusion: user-facing E2E for **Noctemblith per-device/per-service logout** passed. This does NOT verify implementation of **Account Core → all connected services global logout**, which remains unimplemented. Advanced revocation edges (API/WS replay, forced account disable, all-devices logout) are not covered by these four tests.
