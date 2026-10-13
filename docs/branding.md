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

## Register `:noctite:` in an instance

Misskey custom emoji is stored in the **individual instance database**.
Adding a PNG to the Git repository does *not* register an emoji on an
already-running server. Do not seed or overwrite custom emojis silently.

After deploying a reviewed build, an instance administrator can:

1. Download `assets/noctite-emoji.png` (transparent PNG, 128×128).
2. Open **Control Panel → Custom Emojis** (custom emoji manager).
3. Choose **Add** / local emoji upload, select the PNG.
4. Set the exact name `noctite` (no leading/trailing colon in the name field).
5. Set optional category `Noctite`, and choose **localOnly** according to
   the server's federation policy. Leave aliases empty unless intentional.
6. Save and confirm `:noctite:` appears in the emoji picker and reactions.
   Confirm publication policy with the server operator before federation.

The administrator must have `canManageCustomEmojis` permission. The Misskey
`admin/emoji/add` endpoint requires authenticated admin privileges and a
Drive file ID; copying the asset is **not** an alternative to that API.

For a different independently hosted Noctite instance, the local
administrator decides whether and how to install the same emoji.

## Check

```bash
node --test scripts/noctite-branding.test.mjs
```

This checks the committed PNG signature, dimensions, SHA-256, exact duplicate,
basic SVG safety and the expected default fallbacks. It requires no Docker,
database, browser credentials, or running Noctite instance.
