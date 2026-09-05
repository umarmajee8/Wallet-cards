# CardWallet (patched)

This repo contains the patched source for the CardWallet app.

## Changes made
1. Removed the "Make your own pouch" custom color-picker feature (both the header menu entry and the Settings-screen row).
2. Fixed pouch presets, selectable from Settings -> **Pouch style**:
   - **Frosted** - the original dark frosted glass
   - **Steel** - dark slate/blue-grey look
   - **Emerald** - dark green look
   - **Paper** - light felt pouch with a dashed seam, matching the reference mock
     (patch 10). The app's own default stays whatever `wallet.settings.v1` says,
     which is `slate`; picking a preset does not change anybody's look until they
     ask for it.
   Two things had to be repaired to make this row work at all (patch 9): the
   section is missing from `app/index.js` even though the base APK has it (the
   bundle and the APK had drifted, so builds silently shipped no pouch picker),
   and the stock settings loader rewrote `theme` to `slate` on every read - so a
   preset you picked was saved to storage and thrown away at the next start.
3. Removed the **Auto-detect details** feature (Settings toggle, “Fill in from picture” button, and OCR on new photos). Card details are only what you type in.
4. Added a **Wallet & cover** on/off switch (Settings -> Pouch). Turning it off
   hides the pouch in Carousel and the frosted cover in Stack, leaving plain
   cards; the card title then follows the theme (black on light, white on dark)
   instead of being hard-coded white. Default is on, and installs that predate
   the setting keep the pouch.
5. Production hardening: release signing with a real RSA-4096 keystore
   (the debug key is retired) and `android:allowBackup="false"` so card photos
   and details never leave the app sandbox via cloud/adb backup.
6. **Header options restyled to the mock** (patch 7): the `+` is a solid black
   disc with a white plus, while search and the menu button are bare black glyphs
   with no chip behind them - theme-coloured icons floating on the page are gone.
   The menu button became a hamburger (three bars) instead of three dots, and the
   dropdown is a black panel with white rows (the destructive row keeps the
   app's red). Bare glyphs render at 26px so all three options carry the same
   visual weight as the disc.
7. **Header options are now config-driven** (patch 8): `header_options.json`
   declares which buttons the header shows - label, icon, action, order, whether
   the option is a filled disc or a bare glyph (`chip`), its colour (`tone`:
   black / white / ink), whether the label is drawn next to the icon - plus what
   each dropdown contains. Change the file, re-run
   `patches/patch8_header_options.py`, rebuild: no minified JS editing, and the
   patch refuses to write a bundle that does not parse.
   Behaviour is unchanged from the stock app (same three actions, same two
   dropdowns), so this is styling plus plumbing, not a feature swap.
8. **Repairs to the pouch picker** (patch 9): re-inserts the **Pouch style**
   section into the bundle that actually ships, and stops the settings loader
   from forcing `theme=slate`, so a chosen preset now survives a restart.
9. **Add-card pill on the empty wallet** (patch 11): the mock's wide black
   capsule with the grey `+` disc at its left, drawn over the lower-right of the
   pouch area - **without** the "Add Card" label, as asked. Tapping it opens the
   same capture routes as the header `+`, with the menu flipping to open upward
   from the bottom. It renders only when the wallet is empty (the mock is an
   empty wallet), so on a fresh install - which seeds demo cards - you see it
   after **☰ -> Delete all cards**. The header `+` keeps working; both are there.

## Structure
- `app/` - the web bundle that runs inside the Android WebView (Capacitor-based hybrid app): `index.html`, the compiled/minified `index.js`, `index.css`, and icons.
- `android/AndroidManifest.xml` - the app's Android manifest.
- `patches/` - Python scripts that patch the minified `index.js` (patch1 -> patch11),
  plus the release toolchain: `build_release_apk.py` (build + sign),
  `build_debug_apk.py` (same bundle, throwaway debug key - for hands-on testing),
  `apkbuilder.py` (aligned zip, v1/v2/v3 signing, PKCS#12 keystore),
  `axml.py` (binary manifest reader/patcher), `verify_release.py`,
  `smoke_test_webview.mjs` and `animation_audit.py`.
- `header_options.json` - the header's option list (top-bar buttons + the two
  dropdowns they open). Consumed by `patches/patch8_header_options.py`.

## Header options, in detail

`repo_export/header_options.json` is the single place to change what the header
offers. Per option:

| key | meaning |
|---|---|
| `chip` | `true` = filled disc (black bg, white glyph, halo while its menu is open); `false` = bare glyph on the page, with a subtle `var(--chip)` circle only while its menu is open |
| `tone` | `auto` (default - follow the app's theme tokens: black disc + white glyph on light, white disc + black glyph on dark) / `black` / `white` (literal, does **not** invert) / `ink` (glyphs invert, disc stays black). `defaults.tone` covers the whole row |
| `showText` | label beside the icon, chip grows to fit (also settable globally) |
| `when` | `nfc` / `hasCards` - reuses the gates the app already has |
| `icon` | plus, search, bars, dots-v, dots-h, gear, image, camera, nfc, trash, x, check, chevron-r, wallet, sliders, list, star, card, eye, share, lock |
| `action` | `toggle:<add\|more>`, gallery, camera, nfc, search, settings, studio, delete, none |

Tap targets stay 44px (`h-11 w-11`) either way, so the bare glyphs are not a
smaller hit area than the disc.

**Why `auto` is the default:** the mock is a light-theme drawing, so a literal
`#000` is what it implies - and on the dark theme (app bg `#000`) that made the
`+` a muddy circle and the search/menu glyphs disappear completely, which is
exactly what a device screenshot caught. `auto` resolves through `--solid` /
`--on-solid` / `--ink`, the same tokens the app's own solid buttons use, so the
row flips with the theme instead of disappearing. Note `--solid` is `#111113`,
the app's near-black, not the pure `#000` of the mock.

    python3 repo_export/patches/patch8_header_options.py   # JSON -> index.js
    python3 repo_export/patches/patch9_restore_pouch_picker.py
    python3 repo_export/patches/patch10_paper_pouch.py      # needs 9
    python3 repo_export/patches/patch11_pouch_add_pill.py
    python3 repo_export/patches/build_debug_apk.py          # -> installable APK

Every patch above takes `--check` (anchor sanity, no writes) and is safe to re-run:
they recognise their own output instead of stacking copies. `patch7 --check` also
tolerates its output being re-worded by patch 11. Order matters once: patch 10's
swatch edits are anchored inside patch 9's block.

patch 8 is idempotent: it writes a `/*cardwallet:header*/` marker over the span it
owns and re-runs replace that span instead of stacking copies. `--check` validates
the JSON (icons, actions, gates) without touching the bundle. Unknown icon/action
names fail loudly with the list of valid ones.

Both dropdowns are configurable the same way (`menus.add` / `menus.more`), which
is why the panel is generated too: `(l==="add"?p:m)` in the bundle becomes a
marked array literal that patch 8 owns.

Gates: `verify_release.py` and the smoke test check the header against this same
JSON, so a bundle that drifted from the config fails the build rather than
shipping quietly. patch 8 also runs `node --check` over its own output.

- `signing/` - production keystore + password (gitignored, never committed).
- `CardWallet_no_pouch.apk` - previous signed build (pouch changes only).
- `../CardWallet_no_autodetect.apk` - superseded debug-signed build (do not ship).
- `../CardWallet_release.apk` - current production release-signed APK.

## Build notes

**Release builds (current):** `python3 patches/build_release_apk.py` produces
`../CardWallet_release.apk` - the web bundle is injected into the base APK, the
binary manifest is hardened (`allowBackup=false`), every stored entry is 4-byte
aligned, and the package is signed **v1 + v2 + v3 with the production RSA-4096
keystore** in `signing/release-key.p12` (gitignored - back it up).
See `../docs/RELEASE.md`.

Verification gates:
- `python3 patches/verify_release.py ../CardWallet_release.apk` - 29 package checks
  (the header ones read `header_options.json`, so a bundle that drifted from the
  config fails the build instead of shipping quietly)
- `node patches/smoke_test_webview.mjs` - 83 web-layer checks (`npm i jsdom`)
- `python3 patches/animation_audit.py` - static jank audit

`verify_release.py` shells out to `apksigtool` for the v2/v3 checks
(`pip install --user apksigtool`); without it those 3 checks cannot run.

**Test builds without the release key:** `python3 patches/build_debug_apk.py`
writes `../CardWallet_header_black.apk`, signed with a throwaway key it creates
under `repo_export/signing/`. Same bundle, same manifest hardening, same
alignment - only the signature differs, so Android will not update an existing
install over it (`adb uninstall com.arena.cardwallet` first). Never distribute it.


On-device testing is **not** covered by any of the above - see
`../docs/DEVICE_TEST_PLAN.md` and the current status in `../docs/FINAL_REPORT.md`.

**Legacy:** `patches/rebuild_apk.py` signed with a throwaway debug key and is
kept for history only. `../CardWallet_no_autodetect.apk` is that old
debug-signed build - **do not distribute it**.
