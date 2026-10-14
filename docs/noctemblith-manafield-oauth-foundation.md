# Noctemblith: Manafield Account OAuth client (foundation only)

Status: **implementation foundation; disabled by default**.
Base: Misskey/Noctemblith **2026.10.0** release tag.

This change adds strictly validated OAuth client configuration, secure
authorization-request generation (PKCE S256 + state), token form construction,
state comparison and trusted identity claim parsing.

It does **not yet register HTTP routes, expose a login button, exchange
tokens over the network, create/link Noctemblith users, or issue Noctemblith sessions**.
There is no hidden partial SSO implementation. The existing standalone
Misskey authentication flows remain the only operational login paths.

## Provider contract

The separate Manafield Account Core is proposed to provide
`manafield.identity.oauth2` v1.0.0. The provider OAuth implementation
already supports Authorization Code + S256 PKCE:

- `GET https://manafield.studio/account/oauth/authorize`
- `POST https://manafield.studio/account/oauth/token`
- `GET https://manafield.studio/account/oauth/userinfo`
- `POST https://manafield.studio/account/oauth/end-session`

The OAuth client ID and callback URL must be **explicitly registered** by the
Account Core administrator. Nothing in this fork automatically registers a
client or grants OAuth access.

## Future Noctemblith configuration names (not consumed at runtime yet)

- `NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN`: pinned provider HTTPS origin
- `NOCTEMBLITH_MANAFIELD_OAUTH_CLIENT_ID`: registered public OAuth client ID
- `NOCTEMBLITH_MANAFIELD_OAUTH_CALLBACK_URL`: exact callback address on the
  configured Noctemblith HTTPS origin, ending in `/auth/manafield/callback`

The helper returns `null` if all values are absent. Partial or malformed
configurations throw; insecure HTTP endpoints, untrusted callback hosts,
userinfo credentials or callback query/fragment are rejected.

## Required security gates before wiring the callback

1. Implement a **server-side, one-time, short-lived state+PKCE store** with
   HttpOnly/Secure/SameSite=Lax correlation cookie; consume state atomically.
2. Validate the callback state, handle provider denial and fail closed on
   timeout/replay. Exchange the authorization code **server-side**, with
   allowed provider URL and no credential logging.
3. Fetch `userinfo` over the configured HTTPS provider. Never accept identity
   data directly from the browser, Noctemblith user parameters, or decoded bearer
   token assumptions. Pin the provider's issuer/origin.
4. Explicitly prompt for consent and a checked **available Noctemblith handle**
   before generating an ActivityPub actor. A matching existing username must
   never be silently claimed or linked.
5. Use Noctemblith's **internal** SignupService/session APIs and transactional
   unique identity link records. Never INSERT unverified actor rows or
   expose native signup/token secrets over a generic API.
6. Preserve Noctemblith's own suspended-user controls. Define what happens to
   active local sessions when Manafield Account is disabled, logged out, or
   deleted. `userinfo` alone does not revoke preexisting Noctemblith sessions.
7. Only then expose a `Continue with Manafield` option **when integration is
   enabled**. Keep independent/standalone Noctemblith authentication available.

The persistent mapping key should be `(provider_id, Manafield sub UUID)` →
`Noctemblith user ID`. Validate concurrency, collisions, session revocation,
username restrictions, and ActivityPub identity implications before enabling
public federation or production signups.

## Tests and implementation

- Helpers: `packages/backend/src/server/manafield-oauth/client.ts`
- Unit tests: `packages/backend/src/server/manafield-oauth/client.test.ts`
- Account-side draft: [Manafield Account PR #15](https://github.com/eventide-manafield/manafield-account/pull/15)
- Adapter-side design: [manafield-noctemblith PR #2](https://github.com/eventide-manafield/manafield-noctemblith/pull/2)

The tests target validation and PKCE construction only. They are **not** end
to end SSO tests; a Noctemblith backend build and Account Core integration remain
pending. No existing production instance, runtime DB or secret was changed.
