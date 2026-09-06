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
11. **Only the pouches respond to touch, and the cover stops paying for blur** (patch 15).
   The device report framed the empty black bands above and below the pouch row: "yeh jaga
   kam na kray - is pr touch swipe kuch b kam na kray". The carousel's drag layer was a
   full-`inset-0` sheet bigger than the artwork it held, so a swipe starting in dead space
   still grabbed the row (and the `grab` cursor advertised that). The layer is no longer a
   hit target at all: each card wrapper is (`pointer-events:auto` + a `data-cwc` marker),
   `onPointerDown` ignores a gesture that did not start inside a pouch, and `<main>` gets
   `touch-action:none` so the bands cannot scroll or rubber-band the page either. Also in
   this patch, on request: the Stack cover's `backdrop-filter:blur(22px) saturate(1.6)` is
   gone completely (flat translucent panel, with enough body that the card stays hidden),
   and the card name under a pouch follows the theme token (`var(--ink)`, weight 800)
   instead of being hardcoded white whenever the cover is on - which was invisible in
   light mode. The title's drop shadow became a token (`--pouch-label-shadow` in
   `app/index.css`): no smudge behind black text on a light page, the halo kept in dark.
12. **Every card can carry its own pouch colour** (patch 16). "jaisy baki carousel hain un
   ka colour select kar saktay hain, is ka bhi waise hi karo". Settings -> Pouch -> Colour is
   wallet-wide, so one card could not be different. The card's own editor sheet (long-press a
   card -> Card details) now has a **Pouch colour** row using the same 11 swatches, saved on
   that card (`card.color`), plus a **Wallet colour** chip that hands it back to the wallet
   setting. Painting reuses the bundle's existing "Yours" theme (`ad('custom', custom)`), so
   the sleeve, tray gradient, sheen and name colour all follow one hex - no new drawing
   code. Both memo comparators compare `card.color`, otherwise React would accept the value
   and never repaint. Cards without an override are untouched.
13. **The cover wears the wallet's colour, NFC stays off, light is the default, and the
   header says "Wallet"** (patch 17). Four asks, one patch.
   "Stack meh jo cover ha blur wala us ko khatam kro, or jo colour pick karte thy … wo us ki
   jaga laga do" - patch 15 had only deleted the `backdrop-filter`, which left a translucent
   glass panel sitting in exactly the same place. The panel is now painted from the *same
   colour the carousel pouch uses* (the card's own `color` if it has one, else the wallet's
   `custom.color` / `slateColor`) through the bundle's existing shading helper
   `td(hex, mul)`: light at the mouth, the colour in the middle, darkened at the bottom,
   exactly like the tray gradient - and it is opaque, so nothing shows through it.
   "nfc auto off rakho" - `nfc` defaults to off *and* the settings loader pins it off
   (`n.nfc=!1`, the same idiom that already pins the removed `autoDetect`), so an old
   install's stored `nfc:true` cannot bring "Tap a bank card" back. The Settings row for it
   was removed with the feature: a toggle whose value resets on relaunch is worse than no
   toggle.
   "auto light mode rakho" - default `appearance` is `light`, and an install still carrying
   the old `system` default is migrated once (flagged `appearanceMigrated`), so a later,
   deliberate System/Dark pick survives.
   "header pr top left corner pr bara bold Wallet likho, font ios wala ho" - a 28px / weight
   800 wordmark with tight negative tracking and the `-apple-system, BlinkMacSystemFont,
   "SF Pro Display", "SF Pro Text"` stack before the app's own fallbacks, coloured
   `var(--ink)` so it stays legible in the dark theme, and `margin-right:auto` so the three
   icons keep their place on the right. It is inserted *after* patch 8's
   `/*cardwallet:header*/` marker so that patch's verification keeps matching.
14. **Premium settings: system type, a real frosted sheet, and one Custom Pouch panel that
   drives the wallet** (patches 18, 19, 20). *"Wallet ki existing functionality ko change kiye
   baghair UI aur settings experience ko premium minimalist Apple style mein enhance karo."*
   - **Type** (18): the font stack now names `SF Pro Display` / `SF Pro Text` before the
     existing fallbacks (system sans -> Inter -> Roboto), body copy carries `-0.011em`
     tracking, and the uppercase letter-spaced label look is gone: `Settings` is 20px/700,
     card headings 15px/600 in `var(--ink)`, group labels 11.5px/600, row text 14px. Where the
     SF faces do not exist the fallbacks are the same ones the app already used, so no metric
     or wrap behaviour changes.
   - **Glass** (18): the settings sheet is a `.cw-glass-sheet` panel - translucent token fill
     (`--glass` / `--glass-2`), `backdrop-filter: blur(34px) saturate(1.7)`, a hairline stroke
     and a top highlight - over a scrim that blurs the wallet behind it (`--scrim-blur`).
     Values are CSS custom properties with `html.dark` variants, so the dark theme gets its own
     glass, and `@media (prefers-reduced-transparency:reduce)` puts every surface back to a
     solid `var(--sheet)` / `var(--raised)` with `backdrop-filter:none`. Only the settings
     sheet was converted; the card editor keeps `sheet-bg`, so no new blur sits anywhere the
     cards animate.
   - **One place** (19): Custom Pouch is a section *inside* Settings that carries every Design
     and Layout control in the app - material, colour, background depth, border, radius,
     shadow, grading, grain, stitching and name, then carousel/stack, Wallet & cover, size,
     spacing and stack style - plus a Cards filter and Appearance. No option was dropped and no
     screen was added; the explanatory sentences went away because the controls now show their
     own state (selected chip, read-out value). The Cards chips filter the *preview only* -
     they never touch stored cards.
   - **Live preview** (19): the panel mounts the wallet's real component (`Ed` for carousel,
     `__cwStack` for stack, first three cards) inside a `pointer-events:none` box. It is not an
     image: it re-renders on the same state the wallet reads, so a colour or layout pick is on
     the preview in the same frame it is committed.
   - **Applied for real** (20): a `__cwTune` post-processor sits on the single theme
     choke-point (`ad()`), so Background/Radius/Shadow/Material/Border/Grading apply to both
     views; `__cwSlateTray` builds the carousel tray from the same fields; the canvas sleeve
     painter reads depth/material/shadow/border; and `xd()` scales `pouchW`/`cardW` by Size,
     `slide` by Spacing and both radii by Radius (with `Sd()` recomputing on change), so the
     change lands on the wallet, not just the preview. Every new field defaults to the neutral
     value, so an untouched install paints byte-for-byte what patch 17 painted.
15. **Stack gets its own Layout, the sheet loses half its buttons, sliders go smooth, and the
   create button shrinks** (patches 21 + 22). *"layout meh stack ki alag setting ho or carousel
   ki alag … sliders ko smooth kro … stack preview meh show nhi ho rha … create button ko thora sa
   chota kro … bhot zada setting meh button ho gya han."*
   - **The stack preview was invisible, and that was a real bug**: `__cwStack` sizes its cards
     from `window.innerWidth/innerHeight`, so inside the sheet it laid a phone-sized stack into a
     176px box. It now takes an optional `fit` box from its caller (`fit:{w:388,h:302}` from the
     preview, scaled `.56`) and keeps the viewport maths untouched for the wallet - the smoke test
     asserts both branches of that ternary, so the wallet cannot silently inherit the preview's
     sizing.
   - **Layout follows the view**: `Carousel|Stack` selects the wallet, a sub-label names whose
     settings are shown below it, and only that view's controls appear - `Wallet & cover`, `Size`,
     `Spacing` for the carousel; `Wallet & cover`, `Size`, `Spread` and the `Flat|Fan|Deck` fan for
     the stack. The preview mounts the same component the wallet renders, so sheet and wallet are
     always the same picture.
   - **Chip buttons: 22 -> 7 (10 in Stack)**. The `Cards` preview-filter row is gone, and the
     Material and Border chip rows became the `Sheen` and `Edge` sliders - they write the same
     `custom.material` / `custom.border` fields patch 20 paints from, so nothing was lost and both
     still reach the wallet. What is left is four chip rows: Slate|Classic, Carousel|Stack,
     Flat|Fan|Deck (Stack only) and System|Light|Dark.
   - **Smooth sliders**, in three parts. React restores a controlled input to the last committed
     value on every event - that flicker under the thumb was the complaint - so a drag is now a
     two-tier write: local sheet state holds the dragged value, while the wallet is committed once
     per frame through a `requestAnimationFrame` queue (`setTimeout` fallback, and one storage
     write per frame instead of one per event). Every pouch slider is step `.01` with a filled
     track (`--p`) and a 20px thumb inside a 26px hit area (`touch-action:none`, so the sheet stops
     scrolling under the drag) and tabular read-out digits. And the sleeve canvas cache key was
     `JSON.stringify(custom)` - a full canvas repaint plus `toDataURL` per slider step - which is
     now a quantized signature (`__cwSig`): a whole sweep costs ~10 repaints instead of ~100, with
     `.16s` of easing on the tray so the fine values still read as continuous.
   - **Create button**: the header's filled `+` and its two bare siblings went 44px -> 40px with
     21px/24px glyphs, and the sheet's `Done` pill a step smaller (`text-[13.5px]`). patch 7 owns
     that span, so it carries a `DOWNSTREAM_KEEP` marker for this rewrite; patch 19 and 20 gained
     the same for the sheet span patch 22 rewrites.

16. **Stack and Carousel become two independent configuration modes, the preview never runs dry,
   and the sliders glide the wallet** (patches 23 + 24). *"Stack aur Carousel ko completely separate
   configuration modes banao … Stack ki settings Carousel par apply nahi honi chahiye aur Carousel ki
   settings Stack par apply nahi honi chahiye … preview static image na ho, minimum 3 actual cards
   render karo … sliders mein smooth interpolation … create button thora chota, extra padding/height
   hatao … settings panel configuration dashboard jaisi na lage."*
   - **Two namespaces, not two copies of one field.** The layout numbers now live in
     `custom.stack` (`size, gap, overlap, spacing, vOff, shrink, rot, visible`) and
     `custom.carousel` (`size, gap, side, peek, pos`). The renderers keep reading the flat names they
     always read - the wallet hands each view `{...custom, ...custom[view]}` through one helper
     (`__cwMrg`), so the same field name in two objects is what keeps the views apart, and a
     `radius`/`shadow` change still reaches both (they are design, not layout). Round 11 shared
     `custom.size`/`gap` between the views; that is exactly what this removes.
   - **Every requested control is real geometry**, read where the card is already being placed:
     `overlap` is the x step as a fraction of card width (`l*(cw*overlap + spacing)`), `vOff` adds a
     vertical step on the *transform* (`ly`) so it costs no layout, `shrink` is the per-depth scale
     falloff, `rot` the per-depth 3D turn (and how far its clamp opens), `visible` the depth at which
     a card stops being opaque. On the carousel: `gap` is the slide advance, `size` the card scale,
     `side` the side-card opacity graded by distance, `peek` the lateral factor (`0.56 * peek`) that
     decides how much of a neighbour shows past the front card, `pos` a bias of the whole row.
     `overlap .7` + `spacing 0` + `visible 3` reproduce patch 20/22's numbers exactly, so a wallet
     that never touched these sliders looks pixel-identical; `$p()` folds an older flat
     `size`/`gap`/`stack` (the Fan multiplier) into both namespaces once.
   - **The preview is the wallet's own tree and never shows one card.** It stages the wallet's real
     cards and pads them with stand-ins built by the same components (each carrying its own pouch
     colour, so a stack reads as separate cards) - three in the carousel, six in the stack, which is
     what makes `Visible cards` and `Vertical offset` legible while dragging. The sheet is now fed
     eight cards instead of four. It receives settings through the same `__cwMrg`, so the preview and
     the wallet behind it cannot disagree.
   - **A third tier on the sliders.** Geometry writes are ramped: each frame covers 42% of the
     distance to the finger and snaps onto the target when the remainder is under the rounding it
     writes with, so the last commit *is* the value. Non-geometry fields still commit once per frame;
     the dragged row still holds its own value in sheet state (round 11's fix), and the drag is only
     released when that field's glide finishes - otherwise the thumb would slide backwards under the
     finger.
   - **Fan chips are gone** (rotation and overlap cover what `Flat|Fan|Deck` preset) and `Spread`
     became `Spacing`, so Layout is now two chips plus one switch. The whole sheet is 7 chip buttons,
     2 switches, 11 colour dots, 18 sliders and one Done pill. The create button went 40px -> 36px
     with 19px/21px glyphs - padding and height, not just the glyph.
   - **Two bugs the harness caught, both worth knowing.** `Sd`'s dependency list still named only
     `size/gap/radius`, so `peek`/`side`/`pos` would have been settings with no effect; and patch 13's
     eject spring was declared as `let n = {…}` inside a component whose progress motion value is also
     `n`, so reading the depth there threw at render. The first was invisible because a Python
     multi-line string literal without parentheses had silently turned that edit into a no-op - patch
     23 now refuses an edit whose anchor and replacement are identical and re-checks that the old
     shape is gone afterwards.



## Structure
- `app/` - the web bundle that runs inside the Android WebView (Capacitor-based hybrid app): `index.html`, the compiled/minified `index.js`, `index.css`, and icons.
- `android/AndroidManifest.xml` - the app's Android manifest.
- `patches/` - Python scripts that patch the minified `index.js` (patch1 -> patch24), plus
  the readable sources of the settings sheet - `patch19_settings.src.js`,
  `patch22_settings.src.js` and `patch24_settings.src.js`, each minified by its own script (one
  flat node per line, no comments; the newest one owns the span and the older two report it as
  superseded) - and `replay_chain.py` (rebuild `app/index.js` from the pristine bundle through the
  whole chain and compare, which is how a shipped bundle is proven to contain no hand edits;
  `--upto N --swap` / `--restore` are how the negative controls are run),
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
- `node patches/smoke_test_webview.mjs` - 216 web-layer checks (`npm i jsdom`);
  the carousel tests drive real pointer events: they reproduce the stuck half-shifted
  row (58.4px) and prove it recovers to 0.00px, prove a swipe in the empty band moves
  nothing, read each pouch's painted gradient to prove a per-card colour wins, and read
  the Stack cover's painted gradient to prove it is the wallet colour rather than glass.
  A `matchMedia` stub that answers "dark" is what makes the light-by-default and
  appearance-migration checks mean something
- `python3 patches/animation_audit.py` - static jank audit

`verify_release.py` shells out to `apksigtool` for the v2/v3 checks
(`pip install --user apksigtool`); without it those 3 checks cannot run.

**Test builds without the release key:** `python3 patches/build_debug_apk.py`
writes `../CardWallet_stack_carousel_modes.apk`, signed with a throwaway key it creates
under `repo_export/signing/`. Same bundle, same manifest hardening, same
alignment - only the signature differs, so Android will not update an existing
install over it (`adb uninstall com.arena.cardwallet` first). Never distribute it.
It swaps `index.js` **and** `index.css` (a patch may add a token to the stylesheet, e.g.
patch 15's `--pouch-label-shadow`), but it refuses to run if `index.html` has drifted -
that would mean the entry graph changed and only a real build may produce that.


On-device testing is **not** covered by any of the above - see
`../docs/DEVICE_TEST_PLAN.md` and the current status in `../docs/FINAL_REPORT.md`.

**Legacy:** `patches/rebuild_apk.py` signed with a throwaway debug key and is
kept for history only. `../CardWallet_no_autodetect.apk` is that old
debug-signed build - **do not distribute it**.
