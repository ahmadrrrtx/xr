# Bundled typefaces (local-first: zero network fetches for type)

XR's type identity (docs: xr-audit/09-DESIGN-RETHINK-v3 §Type) ships INSIDE the
desktop package. Nothing here is loaded from Google Fonts or any CDN at runtime;
`scripts/desktop-fonts-check.ts` fails CI if a stylesheet ever points type at a
URL, or if a file listed here goes missing or changes without this manifest.

| Role    | Family          | Files (latin + latin-ext)                       | License |
|---------|-----------------|-------------------------------------------------|---------|
| display | Space Grotesk   | `space-grotesk-*-wght-normal.woff2` (variable)  | OFL-1.1 (`LICENSE-space-grotesk.txt`) |
| body    | IBM Plex Sans   | `ibm-plex-sans-*-{400,500,600}-normal.woff2`, `…-400-italic.woff2` | OFL-1.1 (`LICENSE-ibm-plex-sans.txt`) |
| code    | JetBrains Mono  | `jetbrains-mono-*-wght-normal.woff2` (variable) | OFL-1.1 (`LICENSE-jetbrains-mono.txt`) |

Provenance: the woff2 subsets and licenses are copied verbatim from the
fontsource packages on npm, pinned:

- `@fontsource-variable/space-grotesk@5.3.0`
- `@fontsource/ibm-plex-sans@5.3.0`
- `@fontsource-variable/jetbrains-mono@5.3.0`

`SHA256SUMS` pins every file. Refresh = bump the pinned versions above, re-copy
the files, regenerate `SHA256SUMS`, and keep the unicode-range subsets in
`src/styles/fonts.css` in step with the packages' own CSS.

Only latin + latin-ext are bundled on purpose (276 KB total). Other scripts
fall through the stacks in `tokens.css` to the OS fonts — honest, and the
stacks are ordered so metrics stay close.
