Self-hosted font assets for the MDA web workspace.

Source families:
- Inter
- JetBrains Mono
- Noto Sans SC

The files under `google/` are WOFF2 assets mirrored from Google Fonts for local serving.
`google-fonts.css` keeps the same font-family names and unicode-range slicing, but rewrites
remote font URLs to local `/fonts/google/...` paths.

License: Google Fonts serves these families under the SIL Open Font License.
