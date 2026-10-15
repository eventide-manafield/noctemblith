# Manafield Account SSO: Noctemblith development consumer

**Status:** Draft source only. Integration disabled unless expressly enabled; separate Account Core OAuth registration and an isolated Noctemblith database migration are prerequisites.

## Intent / isolation
- Manafield Account Core uniquely identifies people by immutable OAuth `sub` UUID. The handle (e.g. `eventide`) is **not** the link key.
- Development and production Noctemblith instances have distinct local PostgreSQL/Redis and OAuth client registrations. Either can link the **same** Manafield UUID to its own local actor independently.
- No actor rename, password copying, cross-database grants, implicit user provisioning, or migration of existing Noctemblith permissions.
- Current local owner `eventide` can self-link **only after signing into Noctemblith-dev and authenticating the Manafield account in the same browser**.

## Enable on Noctemblith-dev only
Environment variables **for the dev app container** (no secrets):

```env
NOCTEMBLITH_MANAFIELD_SSO_ENABLED=true
NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN=https://manafield.studio
NOCTEMBLITH_MANAFIELD_OAUTH_CLIENT_ID=manafield-noctemblith-dev
NOCTEMBLITH_MANAFIELD_OAUTH_CALLBACK_URL=https://noctemblith-dev.manafield.studio/auth/manafield/callback
```

The Account Core must explicitly register this public client ID and exact callback URI **in addition to** the existing `manafield-manage-web` registration, via its `MANAFIELD_ACCOUNT_OAUTH_CLIENTS_JSON` operator configuration. An unregistered client always fails closed.

Apply `1792000000004-ManafieldIdentityLink.js` to the dev Noctemblith database using the existing TypeORM migration workflow **only after backup and migration review**. Confirm Redis `GETDEL` support (Redis 6.2+), HTTPS ingress, CA trust and the dev container's ability to reach Account Core publicly.

**Do not enable the flag on production Noctemblith.** An unset flag hides the buttons and leaves existing local sign-in untouched.

## Browser operations
1. Sign into Noctemblith-dev as existing local `eventide` using existing password/passkey/TOTP login.
2. Open **Settings → Service Connection** and select **마나필드 계정 연결하기**. This uses the active Noctemblith native login over a same-origin authenticated POST.
3. The server creates a Redis state + PKCE S256 verifier for 5 minutes, returns the Account Core authorization URL, and sets a secure HttpOnly SameSite=Lax **host-only** browser correlation cookie.
4. Authenticate `eventide` on Account Core; it returns a one-time OAuth code to Noctemblith. The callback consumes the Redis state atomically; exchanges the code **server-side** with the exact registered client/redirect and verifier; fetches UserInfo over the configured HTTPS origin.
5. Database constraints permit one UUID per local user and one local user per UUID within that Noctemblith instance. If a competing mapping already exists, the flow rejects it instead of silently relinking.
6. After successful explicit linking, `Manafield 계정으로 계속하기` appears in the Noctemblith login screen. It uses a fresh 5-minute PKCE state, checks verified UUID mapping and local account active status, and redirects with a **one-time 60-second ticket**, never the native token.
7. Frontend removes the ticket from history and redeems it via a same-origin POST with a separate HttpOnly browser-bound cookie. The server uses the normal Noctemblith sign-in service (login history and notifications) and deletes the ticket atomically. Local login still works.
8. **Privilege gate:** Noctemblith administrators and moderators can be linked for identity management, but **cannot sign in using the central identity alone** until Account Core gains an approved MFA/step-up policy. They must continue using the existing local password/passkey/TOTP login. Linking does not remove their roles or existing sessions.

Security properties: bearer/native-token required to begin linking; neither username similarity nor a decoded access token claims ownership; no redirect target from the caller; no local token in URL; fail closed when callback/ticket is expired, replayed, from a different browser, or the local user is disabled/deleted. Never log authorization codes, bearer tokens, cookie values or POST request body.

## Validation and production gate
- Test existing Noctemblith-dev `eventide` data/admin rights before/after linking, including logout and fresh SSO login.
- Test rejected foreign/opaque CSRF attempts, state replays, wrong/missing cookie, wrong client redirect, expired ticket, UUID collision, and suspended/deleted local accounts.
- Test account/DB/Redis restart behavior and multiple app workers; state and tickets live in Redis, not process memory.
- Audit reverse-proxy and access logs for **query-parameter redaction on callback**; authorize code and ticket must never be published or logged.
- Only deploy after PR review, complete CI, dev backup and explicit operator go-ahead. This PR does not change the running dev instance or the central Account Core registrations.
