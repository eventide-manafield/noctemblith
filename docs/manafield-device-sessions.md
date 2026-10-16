# Manafield browser sessions and per-device logout (implementation candidate)

Status: **code-only / not deployed**. Created 2026-10-16. This applies only when
`NOCTEMBLITH_MANAFIELD_SSO_ENABLED=true`; standalone Noctemblith preserves its existing
native-token flows. No database, Redis, or ActivityPub origin migrations are needed.

## Session model

- Every successful sign-in (including central OAuth JIT, native password, and passkey)
  returns a distinct high-entropy browser bearer token with prefix `mfs1_`.
- `ManafieldSessionService` stores only its SHA-256 hash as a Redis key, along with
  the local user ID, under a 30-day expiry. Redis unavailable -> no new session or authentication.
- Normal API and WebSocket authentication resolve browser session tokens via Redis.
  Revoked/expired sessions cannot make new authenticated API requests or open WebSockets.
- Existing WebSocket connections are rechecked every 10 seconds and are closed when
  revoked or when the session store becomes unavailable.
- Same-account different-device sessions use different Redis keys. The first device's
  logout revokes **only** the presented token.

## Logout API

`POST /auth/manafield/session/logout` with same-origin Origin and
`Authorization: Bearer mfs1_...`. Returns HTTP 204 when that token is revoked,
401 when invalid/previously revoked, or 503 when integration is disabled.
The frontend revokes the current token and other saved browser-session tokens for the **same origin** before deleting local storage; it never submits tokens from other instances. The user's Manafield Account
Core session is **not** revoked. A 401 still permits the browser to clear its own
already-invalid token; unexpected failures leave local state intact for retry.

## Legacy migration and limitations

- Existing shared 16-character native tokens are deliberately denied by the ordinary
  integrated API/WS authentication path (including local root accounts). Otherwise
  those old tokens would bypass per-device session revocation.
- Browser clients holding such tokens need to sign in **once** through the Manafield
  login path after installing this build. Existing account and ActivityPub records remain
  intact. Native possession proof remains available only through the existing-account
  linking endpoint, not the normal API.
- Integrated local root/bootstrap users can still perform **native password/passkey login**
  (the resulting browser credential is an independent session token), but cannot use
  the old shared native token to authenticate routine API/WS requests.
- Third-party app / MiAuth access tokens remain separate from browser sessions and are
  not revoked when the browser signs out.
- Central **global logout** backchannel, central-session ownership mapping, all-devices
  revoke, reverse login, MFA rules, and enforcement of central account status for every
  local password/passkey login remain **separate unfinished work**. Do not mark complete.
- A session is created per successful login, not by fingerprinting a device.
- Replacing the integrated dev image will require previously logged-in linked clients
  to reauthenticate because their shared native tokens stop authenticating API calls.

## Validation before deployment

1. Run focused Vitest suites for AuthenticateService, SigninService,
   ManafieldSessionService and ManafieldSsoService.
2. Run full backend/frontend typechecks, lint, CI image build and tests.
3. Verify in an isolated dev environment: PC session A + mobile session B;
   log out A; A's API/WS stops, B's remain usable, Core login remains active.
4. Verify a previously linked account's old shared 16-char token is denied by API/WS;
   standalone instance still logs in with its own native token.
5. Test multi-tab logout, repeated logout, Redis outage and recovery,
   logout with third-party apps present, suspended accounts and API token permissions.
6. Validate manual central logout separately once backchannel support is implemented.

This code branch does **not** change a running instance, and its merge is not approval
to deploy to standalone or production Noctemblith.
