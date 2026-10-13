# Noctite: External Module Widget (MVP)

Noctite's first modification from Misskey 2026.10.0 adds an optional
**External Module** widget to the existing widget picker.

## Usage

1. Customize the existing Misskey/Noctite widget sidebar.
2. Add **External Module**.
3. Open its settings and set the URL of an **HTTPS** widget page and the height.
4. Place it beside the timeline. Each widget can be configured independently.

The URL must be an absolute HTTPS URL without user information, query strings,
or fragments. Do not embed credentials in the URL. The default is empty, so no
third-party page is loaded until the user deliberately configures one.

## Security & boundaries

- The external page is displayed in an iframe with `sandbox="allow-scripts allow-forms"`.
- In particular, **no `allow-same-origin`**, top-level navigation, popups, downloads,
  or access to Noctite account cookies/tokens are granted.
- No `postMessage` bridge, shared authentication, game state, or Module Registry
  exists in this first patch.
- The external application must permit embedding via its `frame-ancestors` policy.
  Some applications cannot operate with an opaque sandbox origin.
- If embedding is blocked, users can open the page in a separate tab.
- The widget is optional and Noctite can operate normally with no Manafield Core.
- This is a **display integration**, not a privileged extension API. Do not put
  administrative pages or sensitive application actions into iframe sources.

## Future milestones (not implemented)

- Manafield Core-provided trusted module catalog / signed manifests.
- Explicit origin-checked, versioned messages between widget and module.
- Scoped auth and consent, no shared passwords or bare bearer tokens.
- Echo preview widget, independent clicker game, persisted game progress.
- Noctite dev/prod environment separation, then cloud deployment.

## Testing

The URL validator has unit tests in
`packages/frontend/src/widgets/external-module-url.test.ts`.
For the full front-end, run the repository's existing `frontend` tests and
typecheck in CI. Do not assume testing succeeded until dependencies are installed
and the actual test commands complete.
