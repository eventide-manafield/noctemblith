# Noctemblith branding assets · 그믐석

This branch introduces the original crystal/crescent mark for the **Noctemblith
software fork**. The bottom three layers depict sunset light trapped inside
violet crystal. The unpainted center remains transparent.

## Assets

| Path | Purpose |
|---|---|
| `packages/backend/assets/noctemblith.svg` | **Canonical editable SVG**. No embedded raster, script, or external images. Served as `/static-assets/noctemblith.svg`. |
| `packages/backend/assets/noctemblith-emoji.png` | 128×128 PNG transparent compact icon for browsers, touch fallback and static serving. |
| `assets/noctemblith-emoji.png` | Same PNG, easy to find in the GitHub repository for downloading and uploading as **`:noctemblith:`**. |

The PNG is based on the canonical SVG and crops **transparent surrounding
padding only** to make the mark legible at emoji scale. The logo artwork
and glow remain intact. Keep the SVG as the art source if revising it.

## Software default vs. individual instance customization

The Noctemblith server defaults to the Noctemblith logo for page favicons, the
site's navigation and About screen fallback, and the Web App Manifest. A
server operator who sets `meta.iconUrl`, `meta.app192IconUrl`, or
`meta.app512IconUrl` still **overrides** those respective defaults.

The existing `/favicon.ico` compatibility URL redirects to the transparent
brand PNG. The no-override `/apple-touch-icon.png` returns the same PNG.
The PWA icon manifest lists a 128×128 PNG and an `any`-sized SVG. Some
platforms prefer larger raster icons; add separately rendered 192×192 and
512×512 PNGs when finalizing app-install branding. The present version
prioritizes an accurate vector and emoji source without mislabeling image sizes.

**Important:** a Git commit does not edit the *live instance's* Admin settings
or automatically change its installed Docker image. Rebuild the fork and
deploy the new image after review; any explicit instance icon and browser
caches may require manual refresh. GitHub's repository social preview image
is also a separate GitHub repository setting, not controlled by source code.

## Default color identity

Noctemblith includes [Dusk (dark) and Dawn (light) built-in themes](noctemblith-themes.md).
The dark scheme uses purple crystal and gently contained orange sunset
highlights. The light scheme follows the current Manafield Home ivory and
lavender colors, with orange reserved for secondary accents.

Existing user-selected themes and instance-admin theme overrides remain intact.

## Built-in `:noctemblith:` custom emoji

A new or existing **independent Noctemblith installation** automatically receives
its local `:noctemblith:` emoji when the backend starts after migrations.

The startup hook in `CustomEmojiService` calls
`seedNoctemblithEmoji()` using the **instance's own configured public URL**.
It creates a real row in the regular PostgreSQL `emoji` table:

- name: `noctemblith` (used as `:noctemblith:`)
- category: `Noctemblith`
- image: `https://<instance-host>/static-assets/noctemblith-emoji.png`
- public reaction, federatable custom emoji (`localOnly: false`)
- no aliases and no special permissions

Consequently it appears in the ordinary `/api/emojis` response,
custom emoji picker, and reactions without special frontend hardcoding or
a manual admin upload.

### Once at installation — not on every restart

A TypeORM migration adds a tiny `noctemblith_bootstrap_state` table that records
whether the Noctemblith default emoji has already been offered to this
instance. During the **first boot of this branded release**,
`CustomEmojiService` takes a PostgreSQL transaction-scoped advisory lock,
checks the persistent marker, and inserts `:noctemblith:` only if the local
record doesn't already exist. The marker is then saved in the same
transaction. Multiple server processes cannot race to create duplicates.

After initialization, the marker stays even if the administrator deletes
`:noctemblith:`. **A deleted emoji stays deleted across restarts and software
updates.** Noctemblith will not try to restore it or overwrite the user's choice.

An existing local `:noctemblith:` also remains completely unchanged; marking
the initial installation complete does not alter any administrator-owned
image, category, aliases, visibility, or permissions.

A migration tracking record is independent from the emoji itself, because
PostgreSQL's regular `UNIQUE(name, host)` does not prevent multiple rows
with a NULL (local) host. A transaction-scoped lock protects this first
installation without introducing a permanent constraint on manual changes.

**No existing running server or database was modified by this pull request.**
A server must install and launch a new image containing the seeding code for
the row to be created. Different Noctemblith instances seed their own records
and use their own ActivityPub host names; an instance owner's configuration
always determines the domain.

To verify after deployment, an administrator can check the built-in emoji
in the picker, or read the public `GET /api/emojis` response. No password,
manual DB INSERT, or migration of existing user records is needed.

## Check

```bash
node --test scripts/noctemblith-branding.test.mjs
```

This checks committed PNG metadata, basic SVG safety, default icon fallbacks,
and the server seed hook's presence. A separate backend unit test checks
one-time installation, administrator deletion persistence, and idempotence. Neither needs production credentials.
