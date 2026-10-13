# Noctite default color themes — Dusk / Dawn

The Noctite fork ships **two new built-in default themes**, alongside all
existing Misskey themes. It does not rewrite the upstream base themes or
override any administrator-owned or user-selected theme.

## Dusk — dark (Noctite Purple)

| Role | Color |
|---|---|
| Background | `#17131F` |
| Main panels | `#211A2B` |
| Elevated surfaces | `#2B2237` |
| Foreground | `#F2ECFA` |
| Primary brand action | `#7A35B6` |
| Luminous violet active/link accent | `#B96AF0` |
| Warm sunset decoration / indicators | `#FF9D4D` |
| Warm light-readable tags / mention emphasis | `#FFC160` |

Primary buttons use purple with white text. Orange is used sparingly for
indicators, warm hashtags and mention emphasis; it does not replace warnings
or the normal semantic success/error state.

## Dawn — light (Manafield Home-inspired)

| Role | Color |
|---|---|
| Warm ivory background | `#F7F4EF` |
| Paper-like panels | `#FFFFFF` |
| Lavender raised surface | `#F3ECFB` |
| Foreground | `#1F1B24` |
| Main accent (matches Manafield Home light tokens) | `#7B4FD6` |
| Readable violet hyperlinks | `#7041C3` |
| Sunset decorative indicator | `#D77B35` |
| Accessible darker sunset text | `#A84C1B` |

Manafield Home's own CSS light-mode tokens are the reference for ivory
background (`#F7F4EF`), foreground (`#1F1B24`) and lavender accent
(`#7B4FD6`). The orange is a Noctite-specific companion to the brand mark.

## Application integration

- Canonical theme definitions:
  `packages/frontend-shared/themes/d-noctite.json5`,
  `packages/frontend-shared/themes/l-noctite.json5`.
- Both are listed among the built-in choices via
  `packages/frontend-shared/js/theme.ts`.
- Defaults apply to the main frontend, Theme Settings list, syntax
  highlighter and frontend-embed. The underlying Misskey base themes remain
  unchanged and can still be selected.
- Existing personal `prefer.s.darkTheme` and `prefer.s.lightTheme` values
  remain highest priority. `instance.defaultDarkTheme` /
  `instance.defaultLightTheme` are still applied for users who have not
  selected a theme, as already supported by Misskey.
- Changes to these source files do **not** live-update existing accounts'
  explicitly stored green themes. Select Dusk/Dawn in Settings → Themes
  or clear the previously chosen custom theme to use the fork defaults.
- Backend/browser/PWA fallback branding shifts from Misskey green to Noctite
  purple. Existing instance-configured `themeColor` continues to win.
- Certain green **data heatmaps** and genuine success indicators are retained
  deliberately. They are not a global brand accent.

## QA and deployment

The zero-dependency checks are:

```bash
node --test scripts/noctite-themes.test.mjs
```

They check the chosen tokens and basic text/button contrast (WCAG 4.5:1 for
regular colored text, 7:1 for main foreground), the Theme Settings/default
import wiring and preference precedence. The full app build and visual QA
are still needed, including theme toggling, buttons, focus states, modal
overlays and mobile layout.

This work is on `dev/noctite-branding`, not yet merged into the stable
Noctite branch nor deployed to the live `noctite-dev` container.
