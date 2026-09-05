# CardWallet (patched)

This repo contains the patched source for the CardWallet app.

## Changes made
1. Removed the "Make your own pouch" custom color-picker feature (both the header menu entry and the Settings-screen row).
2. Added two new fixed pouch presets, selectable from Settings -> **Pouch style**
   (caveat: the presets and the picker row are in the *base APK's* bundle, not in
   `app/index.js`, and the settings loader pins `theme=slate` on every read - so on
   a build from this repo the row is not there and a saved preset would be
   discarded anyway. See `../docs/FINAL_REPORT.md` §8 before touching this again):
   - **Frosted** (original default)
   - **Steel** - dark slate/blue-grey look
   - **Emerald** - dark green look
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
8. **Stack layout: tapping a card now ejects it and opens it** (patch 12): a tap on
   any card in the deck lifts *that* card out (`translateY -11%` of the card height,
   the pouch's own spring) and opens its details, instead of the previous behaviour
   where an off-centre tap tweened the whole fan sideways (`rotateY +/-48deg`,
   z -160px/step, scale .72-1) and opened nothing. Horizontal drags still flip the
   deck. The pouch already behaved this way - `yd` animates `y/rotate/scale` on
   eject - so this is parity, not a new motion language. Also releases the
   `drag.current` ref the tap path used to leave set, which is why the deck stopped
   resyncing to programmatic index changes after the first tap.

9. **Stack eject comes straight out, and stops paying for blur mid-motion** (patch 13,
   on top of 12): a tap no longer tweens the fan at all. The tapped card lifts out of
   its own slot (`y:-11%` of the card box) and grows on the card's existing `scale`
   spring; the deck's index is updated when the detail sheet hands over, i.e. behind
   the sheet's own opaque backdrop, where the re-order cannot be seen - so "the card
   comes in from the side" is gone, and closing leaves the card you opened at the
   front. Cost fixes for the "laggy" feel: the flap's `backdrop-filter:blur(22px
   saturate(1.6))` is dropped for the duration of the fold (re-blurring a backdrop
   behind a moving layer is the most expensive thing here) and restored at rest, the
   growth moved off the clipped photo box (scaling a rounded, `overflow-hidden`
   element re-rasterises the clip every frame), neighbours dim with `blur(6px)`
   instead of `blur(10px)` - affordable now that they no longer move during the
   eject - and the motion is faster (flap .4 -> .26s, lift spring 240/18/.85 ->
   520/34/.6, cover-off handoff 240 -> 170ms). The sheet also now starts from the
   *card's* rect rather than the stage centre, which the in-place eject made visible.
10. **The carousel row can no longer rest half-shifted** (patch 14). The pouch row is
   positioned by one shared spring, and it is exactly centred only when that spring is back
   at 0 - which happens in exactly one place: a settle animation's completion. So a swipe
   whose pointer stream Android takes away (the bottom gesture strip - the region marked in
   the device report) never reaches the release handler, nothing schedules a settle, and the
   row just sat half a card sideways with no recovery. Two edits: grabbing the row
   mid-glide now *finishes* the pending settle instead of stopping the animation and
   silently dropping the index step (the "sticks, then jumps" feeling), and an idle watchdog
   commits to the nearest index and re-centres ~0.3s after the row goes still - guarded by
   one 340ms grace re-arm on the same window `pointermove`/`pointerdown` events the drag
   itself uses, so an actively held card is never yanked. Sub-pixel drift is cleaned up too.
   Same springs, same snap targets; no layout, padding or safe-area change (that part of the
   report was the phone's own bar, which the app cannot remove).


## Structure
- `app/` - the web bundle that runs inside the Android WebView (Capacitor-based hybrid app): `index.html`, the compiled/minified `index.js`, `index.css`, and icons.
- `android/AndroidManifest.xml` - the app's Android manifest.
- `patches/` - Python scripts that patch the minified `index.js` (patch1 -> patch14),
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
    python3 repo_export/patches/build_debug_apk.py          # -> installable APK

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
- `node patches/smoke_test_webview.mjs` - 85 web-layer checks (`npm i jsdom`);
  6 of them drive the carousel with real pointer events and reproduce the stuck
  half-shifted row (58.4px) before proving it recovers to 0.00px
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
