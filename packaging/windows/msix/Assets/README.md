# MSIX tile assets

`AppxManifest.xml` references six PNGs by name, and `MakeAppx` fails the whole
package if one is missing (it does not fall back):

| File | Size |
| --- | --- |
| `StoreLogo.png` | 50×50 |
| `Square44x44Logo.png` | 44×44 |
| `Square150x150Logo.png` | 150×150 |
| `SmallTile.png` | 71×71 |
| `Wide310x150Logo.png` | 310×150 |
| `SplashScreen.png` | 620×300 |

They are generated from the app icon, same as the tray set:

```sh
bun run scripts/generate-msix-assets.ts
```

The generator reuses `scripts/generate-tray-icons.ts` (decoder, crop maths,
resize, PNG encoder), so the Start tile cannot drift from the tray icon or the
window icon. Committing the PNGs keeps `makeappx` runnable on a machine without
Bun; the script is the source of truth and `test/desktop/msix-assets.test.ts`
pins the committed bytes to its output.

The wide assets (`Wide310x150Logo`, `SplashScreen`) centre the square mark at
72% of the tile height instead of stretching it — a stretched visor is the kind
of thing that ships because nobody looked.
