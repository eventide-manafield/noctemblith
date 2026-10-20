#!/usr/bin/env bash
# Noctemblith dev-only emergency OAuth callback token-format hotfix.
# Usage: bash FILE --check | --build | --deploy
# Preserves standalone, all DB/Redis/media volumes, ActivityPub origin, accounts.
set -Eeuo pipefail
umask 077

MODE="$1"
[[ "$MODE" == "--check" || "$MODE" == "--build" || "$MODE" == "--deploy" ]] || {
  echo "Usage: bash $0 --check | --build | --deploy" >&2
  exit 2
}
[[ "$(id -un)" == "nayuz" ]] || { echo "Run from the nayuz SSH account." >&2; exit 1; }
for bin in docker gh python3 curl; do
  command -v "$bin" >/dev/null || { echo "Missing $bin" >&2; exit 1; }
done
docker info >/dev/null 2>&1 || { echo "Docker socket not accessible." >&2; exit 1; }
gh auth status --hostname github.com >/dev/null 2>&1 || { echo "gh auth login is required." >&2; exit 1; }

REPO="eventide-manafield/noctemblith"
BRANCH="noctemblith/dev"
EXPECTED_SHA="c2f5f3e87600e52393e55466a1aa7192526d3616"
REVIEWED_PR_HEAD="480d6d2efd55445586338b09e0b4bed45cb54808"
PREVIOUS_SHA="62f3b2595473767a61fb74c37b6243be1d3b4a13"
STABLE_SHA="f4d08b443ab666360530b5807f56bf36931d4cdb"
STANDALONE_SHA="e7bd0feada2c951d0c88ced3f5f9a19b799f9f99"
DEPLOY="/opt/manafield/ai-workspace/deployments/noctemblith-dev"
BASE="$DEPLOY/docker-compose.yml"
SSO="$DEPLOY/docker-compose.manafield-sso.candidate.yml"
CURRENT_OVERLAY="$DEPLOY/docker-compose.device-sessions-20261016T021403Z.image.yml"
OLD="$DEPLOY/docker-compose.public-handle-20261016T005506Z.image.yml"
DEV_CONTAINER="noctemblith-dev-noctemblith-1"
ONLY_CONTAINER="noctemblith-only-noctemblith-1"
APP="https://noctemblith-dev.manafield.studio"
ONLY="https://noctemblith-only.manafield.studio"
[[ -f "$BASE" && -f "$SSO" && -f "$OLD" && -f "$CURRENT_OVERLAY" ]] || {
  echo "Dev Compose baseline missing; refusing rollout." >&2; exit 1;
}
cd "$DEPLOY"

compose_current() {
  docker compose -f "$BASE" -f "$SSO" -f "$CURRENT_OVERLAY" "$@"
}
# On failure roll back to the LAST KNOWN WORKING release, not the broken
# device-session release currently running.
compose_old() {
  docker compose -f "$BASE" -f "$SSO" -f "$OLD" "$@"
}
remote_sha="$(gh api "repos/$REPO/git/ref/heads/$BRANCH" --jq '.object.sha')"
[[ "$remote_sha" == "$EXPECTED_SHA" ]] || {
  echo "Expected dev SHA $EXPECTED_SHA but remote is $remote_sha. Review a new commit before deploying." >&2; exit 1;
}
echo "Reviewed GitHub dev revision: $EXPECTED_SHA"

http_get() {
  # Retry transient Cloudflare/network failures without confusing an empty body
  # or timeout with a real version change.
  curl -fsS --connect-timeout 5 --max-time 15     --retry 2 --retry-delay 1 --retry-connrefused "$1"
}
build_sha() {
  local body
  body="$(http_get "$1/noctemblith-build.json")" || return 1
  printf '%s' "$body" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])' || return 1
}
verify_sso() {
  local value
  value="$(http_get "$1/auth/manafield/status")" || return 1
  [[ "$value" == "$2" ]] || { echo "Unexpected SSO status at $1: $value" >&2; return 1; }
}
LIVE_SHA="$(build_sha "$APP")" || {
  echo "Dev build identity unavailable during preflight. Nothing changed." >&2; exit 1;
}
[[ "$LIVE_SHA" == "$PREVIOUS_SHA" || "$LIVE_SHA" == "$STABLE_SHA" ]] || {
  echo "Dev build $LIVE_SHA differs from either reviewed pre-hotfix baseline." >&2; exit 1;
}
ONLY_SHA_PRE="$(build_sha "$ONLY")" || {
  echo "Standalone public build identity temporarily unavailable during preflight. Nothing changed." >&2; exit 1;
}
[[ "$ONLY_SHA_PRE" == "$STANDALONE_SHA" ]] || {
  echo "Standalone returned an unexpected SHA before deployment: $ONLY_SHA_PRE" >&2; exit 1;
}
verify_sso "$APP" '{"enabled":true}'
verify_sso "$ONLY" '{"enabled":false}'
[[ "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://manafield.studio/account/oauth/profile-handle)" == 401 ]] || {
  echo "Account Core new public-handle OAuth endpoint is not ready." >&2; exit 1;
}

compose_current config --quiet
compose_old config --quiet
CURRENT="$(docker inspect "$DEV_CONTAINER" --format '{{.Config.Image}}')"
if [[ "$LIVE_SHA" == "$PREVIOUS_SHA" ]]; then
  CURRENT_CONFIG="$(compose_current config --format json |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["noctemblith"]["image"])')"
else
  # The operator might have restored the last working build before applying
  # the hotfix. Permit that exact reviewed baseline, not arbitrary images.
  CURRENT_CONFIG="$(compose_old config --format json |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["noctemblith"]["image"])')"
fi
[[ "$CURRENT" == "$CURRENT_CONFIG" ]] || {
  echo "Current dev image differs from the reviewed $LIVE_SHA Compose override." >&2
  echo "Current: $CURRENT / Compose: $CURRENT_CONFIG" >&2; exit 1;
}
ONLY_IMAGE="$(docker inspect "$ONLY_CONTAINER" --format '{{.Config.Image}}')"
ONLY_ID="$(docker inspect "$ONLY_CONTAINER" --format '{{.Id}}')"
[[ -n "$ONLY_IMAGE" && -n "$ONLY_ID" ]] || exit 1
echo "Preflight: dev on reviewed baseline $LIVE_SHA, standalone separate and unchanged."
echo "Account Core /profile-handle: HTTP 401 without token (expected)."
if [[ "$MODE" == "--check" ]]; then
  echo "CHECK PASSED (read only)."
  exit 0
fi

# All reviewed pull-request CI workflows must succeed before generating a
# deployment artifact. A GitHub merge does not imply the checks are complete.
echo "Checking complete PR CI for reviewed source revision $REVIEWED_PR_HEAD..."
CI_SUMMARY="$(gh api "repos/$REPO/actions/runs?head_sha=$REVIEWED_PR_HEAD&event=pull_request&per_page=100" | python3 -c '
import json,sys
sha=sys.argv[1]
runs=json.load(sys.stdin).get("workflow_runs", [])
expected=[
 "Noctemblith Manafield OAuth foundation",

 "Test (frontend)",

 "Test (production install and build)",
 "Lint",
 "Dockle",
 "Frontend diagnostics (inspect)",

 "Check SPDX-License-Identifier",
]
status={}
for r in runs:
 if r.get("head_sha") != sha: continue
 name=r.get("name")
 if name in expected and name not in status:
  status[name]=(r.get("status"),r.get("conclusion"))
for name in expected:
 state,conclusion=status.get(name,("missing","missing"))
 print("{}\\t{}\\t{}".format(name,state,conclusion))
ok=all(status.get(name)==("completed","success") for name in expected)
sys.exit(0 if ok else 3)
' "$REVIEWED_PR_HEAD")" || {
  echo "ABORT: reviewed PR CI still incomplete or failing. No image build/deploy started." >&2
  echo "$CI_SUMMARY" >&2
  exit 1
}
echo "Reviewed PR CI 7/7 passed."

if [[ "$MODE" == "--build" ]]; then
  echo "Dispatching manual GitHub Actions Docker build for $EXPECTED_SHA..."
  gh workflow run docker.yml --repo "$REPO" --ref "$BRANCH"
  echo "Workflow dispatched. Follow progress with:"
  echo "  gh run list --repo $REPO --workflow docker.yml --branch $BRANCH --limit 5"
  echo "When the matching SHA build completes successfully, run:"
  echo "  bash $0 --deploy"
  exit 0
fi

# A successful manual GHCR workflow for the exact revision is mandatory.
WORKFLOW_OK="$(gh run list --repo "$REPO" --workflow docker.yml --branch "$BRANCH" \
  --limit 40 --json headSha,status,conclusion,event |
  python3 -c 'import json,sys; sha=sys.argv[1]; data=json.load(sys.stdin); print("yes" if any(x.get("headSha")==sha and x.get("status")=="completed" and x.get("conclusion")=="success" and x.get("event")=="workflow_dispatch" for x in data) else "no")' "$EXPECTED_SHA")"
[[ "$WORKFLOW_OK" == "yes" ]] || {
  echo "No successful manual Docker build for exact SHA. First run --build and verify CI." >&2; exit 1;
}
TAG="ghcr.io/eventide-manafield/noctemblith:build-$EXPECTED_SHA"
echo "Verifying GHCR tag: $TAG"
DIGEST="$(docker buildx imagetools inspect "$TAG" | awk '/^[[:space:]]*Digest:/ {print $2;exit}')"
[[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Could not resolve immutable GHCR digest." >&2; exit 1;
}
IMAGE="ghcr.io/eventide-manafield/noctemblith@$DIGEST"
docker pull "$IMAGE" >/dev/null
echo "Pulled exact image digest $DIGEST"

BACKUP_DIR="$HOME/.local/share/manafield/backups/noctemblith-dev"
mkdir -p -m 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_DIR/pre-sso-login-hotfix-$STAMP.dump"
echo "Backing up isolated Noctemblith-dev PostgreSQL..."
docker compose -f "$BASE" exec -T db pg_dump -U noctemblith -d noctemblith -Fc > "$BACKUP"
[[ -s "$BACKUP" ]]
docker compose -f "$BASE" exec -T db pg_restore --list < "$BACKUP" >/dev/null
echo "Backup verified: $BACKUP"

NEW="$DEPLOY/docker-compose.sso-login-hotfix-$STAMP.image.yml"
cat > "$NEW" <<YAML
# Reviewed immutable development-only image. Do not use for the standalone origin.
name: noctemblith-dev
services:
  noctemblith:
    image: $IMAGE
YAML
chmod 640 "$NEW"
compose_new() {
  docker compose -f "$BASE" -f "$SSO" -f "$NEW" "$@"
}
compose_new config --quiet
RESOLVED="$(compose_new config --format json |
  python3 -c 'import json,sys;print(json.load(sys.stdin)["services"]["noctemblith"]["image"])')"
[[ "$RESOLVED" == "$IMAGE" ]] || {
  echo "Compose resolved image is not the reviewed immutable digest." >&2; exit 1;
}

CHANGED=0
rollback() {
  local code="$1"
  trap - ERR
  if [[ "$CHANGED" == 1 ]]; then
    echo "Dev app did not pass validation; rolling back app to known-good public-handle image..." >&2
    compose_old up -d --no-deps --force-recreate noctemblith || true
  fi
  echo "PostgreSQL backup retained: $BACKUP" >&2
  echo "DB schema changes cannot be automatically rolled back by switching images." >&2
  exit "$code"
}
trap 'rollback "$?"' ERR
CHANGED=1
compose_new up -d --no-deps --force-recreate noctemblith

READY=0
for _ in $(seq 1 48); do
  HEALTH="$(docker inspect "$DEV_CONTAINER" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || true)"
  HTTP="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$APP/healthz/" || true)"
  SHA="$(build_sha "$APP" 2>/dev/null || true)"
  if [[ "$HEALTH" == healthy && "$HTTP" == 200 && "$SHA" == "$EXPECTED_SHA" ]]; then
    READY=1
    break
  fi
  sleep 5
done
[[ "$READY" == 1 ]] || { echo "Dev health/build check failed." >&2; false; }
verify_sso "$APP" '{"enabled":true}'
# Success/failure of the DEV deployment must be determined by DEV health/SSO.
# The isolated standalone instance is not touched by this script. An unrelated
# public HTTPS/Cloudflare timeout cannot be repaired by rolling back DEV.
trap - ERR
ONLY_ID_POST="$(docker inspect "$ONLY_CONTAINER" --format '{{.Id}}' 2>/dev/null || true)"
ONLY_IMAGE_POST="$(docker inspect "$ONLY_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || true)"
if [[ "$ONLY_ID_POST" != "$ONLY_ID" || "$ONLY_IMAGE_POST" != "$ONLY_IMAGE" ]]; then
  echo "WARNING: standalone Docker identity/image changed during deployment. Inspect independently; DEV hotfix remains installed." >&2
  echo "DEV HOTFIX HEALTHY: $EXPECTED_SHA" >&2
  exit 1
fi
ONLY_SHA_POST="$(build_sha "$ONLY" 2>/dev/null || true)"
if [[ -z "$ONLY_SHA_POST" ]]; then
  echo "WARNING: standalone public HTTPS build check unavailable after retries. Docker container ID and image are unchanged." >&2
elif [[ "$ONLY_SHA_POST" != "$STANDALONE_SHA" ]]; then
  echo "WARNING: standalone public build response changed to $ONLY_SHA_POST while standalone Docker container ID/image are unchanged." >&2
  echo "DEV HOTFIX HEALTHY: $EXPECTED_SHA" >&2
  exit 1
fi
ONLY_SSO_POST="$(http_get "$ONLY/auth/manafield/status" 2>/dev/null || true)"
if [[ -z "$ONLY_SSO_POST" ]]; then
  echo "WARNING: standalone SSO status HTTPS endpoint unavailable; its isolated Docker container ID and image are unchanged." >&2
elif [[ "$ONLY_SSO_POST" != '{"enabled":false}' ]]; then
  echo "WARNING: unexpected standalone SSO response: $ONLY_SSO_POST (Docker ID/image unchanged). Investigate separately; DEV hotfix is healthy." >&2
  exit 1
fi
echo "SUCCESS: Noctemblith-dev on $EXPECTED_SHA"
echo "Pinned image: $IMAGE"
echo "Standalone container ID and image unchanged."
echo "Database backup: $BACKUP"
echo "New dev-only Compose override: $NEW"
echo "Next: live OAuth login E2E with a new 48-character session token, then per-device logout isolation."
