# Noctite branding assets · 그믐석

This branch introduces the original crystal/crescent mark for the **Noctite
software fork**. The bottom three layers depict sunset light trapped inside
violet crystal. The unpainted center remains transparent.

## Assets

| Path | Purpose |
|---|---|
| `packages/backend/assets/noctite.svg` | **Canonical editable SVG**. No embedded raster, script, or external images. Served as `/static-assets/noctite.svg`. |
| `packages/backend/assets/noctite-emoji.png` | 128×128 PNG transparent compact icon for browsers, touch fallback and static serving. |
| `assets/noctite-emoji.png` | Same PNG, easy to find in the GitHub repository for downloading and uploading as **`:noctite:`**. |

The PNG is based on the canonical SVG and crops **transparent surrounding
padding only** to make the mark legible at emoji scale. The logo artwork
and glow remain intact. Keep the SVG as the art source if revising it.

## Software default vs. individual instance customization

The Noctite server defaults to the Noctite logo for page favicons, the
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

## Built-in `:noctite:` custom emoji

A new or existing **independent Noctite installation** automatically receives
its local `:noctite:` emoji when the backend starts after migrations.

The startup hook in `CustomEmojiService` calls
`seedNoctiteEmoji()` using the **instance's own configured public URL**.
It creates a real row in the regular PostgreSQL `emoji` table:

- name: `noctite` (used as `:noctite:`)
- category: `Noctite`
- image: `https://<instance-host>/static-assets/noctite-emoji.png`
- public reaction, federatable custom emoji (`localOnly: false`)
- no aliases and no special permissions

Consequently it appears in the ordinary `/api/emojis` response,
custom emoji picker, and reactions without special frontend hardcoding or
a manual admin upload.

### Idempotence, local ownership, and intentional defaults

Startup takes a **PostgreSQL transaction-scoped advisory lock** before checking
for an existing local `noctite` emoji and inserting the default. Multiple
worker processes racing on startup cannot each create a second initial emoji.
PostgreSQL's usual `UNIQUE(name, host)` constraint alone is insufficient
because local emoji rows have a NULL host.

When a local `:noctite:` already exists, the seed **does not change its
image, aliases, category, restrictions, or any other fields**. Operators
may customize the emoji through standard Misskey controls.

By Noctite policy, if an operator deletes `:noctite:` entirely, the default
will be restored on the **next server restart**. This is intentional: an
installed Noctite is always expected to include its namesake emoji. Manual
customization is respected, but the alias should remain present.

**No existing running server or database was modified by this pull request.**
A server must install and launch a new image containing the seeding code for
the row to be created. Different Noctite instances seed their own records
and use their own ActivityPub host names; an instance owner's configuration
always determines the domain.

To verify after deployment, an administrator can check the built-in emoji
in the picker, or read the public `GET /api/emojis` response. No password,
manual DB INSERT, or migration of existing user records is needed.

## Check

```bash
node --test scripts/noctite-branding.test.mjs
```

This checks committed PNG metadata, basic SVG safety, default icon fallbacks,
and the server seed hook's presence. A separate backend unit test checks actual
seed logic and idempotence. Neither needs production credentials.
