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


17. **The stack preview is given a box to fill** (patch 25). *"preview meh stack show nhi ho rha ha,
   stack preview meh show hona chahiye"* - with a screenshot of an empty glass box.
   - **Why it was empty**: round 11's fix taught `__cwStack` to size its *cards* from the `fit` box,
     but the component's own stage still carried only `flex:1` - which means something only inside a
     flex column. In the sheet it sits in `.cw-preview-in`, an absolutely positioned box, so the stage
     computed a height of 0 and its own `overflow:hidden` clipped every card away. The wallet looks
     fine because there the stage really is the last row of a flex column.
   - **The fix is two properties, only when a box is given**: `flex:ft?`none`:1` plus
     `width:ft?ft.w:void 0,height:ft?ft.h:void 0`. With no `fit` (the wallet) React writes neither
     property, so that path is byte-identical; with `fit:{w:388,h:302}` (the preview) the stage becomes
     388x302 and the cards land inside it at their real size.
   - **The stand-in cards' artwork never loaded either**: their `src` was
     `data:image/svg+xml,` + `encodeURIComponent(prefix)` + `#2c3d56` + `"/></svg>` - a raw `#` in a
     URL starts the fragment, so the SVG was cut off at the fill colour. The colour is now an `rgb()`
     triple inside one fully encoded string, and the stand-ins carry no title (three copies of the
     wallet's first title read as a bug).
   - **What the preview does *not* do**: re-centre or shrink the deck to make it look tidier. At the
    default `Card overlap` the fan reaches about four card-widths from the middle, so the outer cards
    are cropped by the stage - exactly as the phone's viewport crops the wallet's own stack. That is
    the point of a preview that shares the component and the settings; a check that compared the two
    fans by ratio was written and then removed, because the deck's transforms only settle after enough
    animation frames, and a test that depends on frame timing is worse than no test. Dragging overlap
    down closes the deck in both places together.
  - **What the harness learned**: the round-11 check asserted a *width* on the stage's cards, and a
     zero-height clipped box still reports real widths on its children - so nothing caught it. The
     preview checks are now height-aware (the stage must carry the fit box's own `width`/`height`,
     read as declared property names so `min-height` cannot pass for `height`; the wallet's stage must
     *not*), and they assert the stand-in URL has no raw `#` and ends where the SVG ends. With patch 25
     removed those two checks fail on exactly the string this bug produced
     (`flex: 1 1 0%; min-height: 0px; overflow: hidden; …` with no height at all).
   - Rebuilding this also flushed a bug in `replay_chain.py --swap`: a rewrite of that block had
     dropped the line that writes the file, so the swap printed "swapped" while leaving the tree
     untouched - which makes a negative control quietly test the shipped bundle. It now writes,
     re-reads, and refuses if the bytes are not what it wrote.




18. **Production QA pass: four real defects found and fixed** (patches 26-29), 2026-09-06. A full
    A-to-Z test round was requested ("app opens" is not a pass) - 147 new behavioural checks driving
    the real flows (create through the gallery input, crop, nine rapid Saves, edit, delete, every
    slider, mode switching, restart with hostile storage), then a re-run of the 221-check smoke suite
    after each fix. The results and the honest limits are in **`docs/QA_HANDOVER_REPORT.md`**.
  - **QA-1 (Critical-class) - Back did nothing.** No `backbutton` and no `popstate` handler existed
    anywhere, and the APK ships zero Capacitor plugins, so Back with Settings/editor/crop/import open
    finished the activity: process gone, edit lost. Patch 26 gives the app a history-based contract -
    one `pushState` per open sheet, `popstate` closes the topmost in z-order, and a Done-tap close
    marks the entry so it is not popped twice. Reproduced in jsdom (`history.length` never grew),
    fixed, and proven load-bearing: removing the patch fails exactly the Back rows.
  - **QA-2/3 (Major) - stored settings were trusted, and the loader ate cards.**
    `custom.stack.size = 1e9` in `wallet.settings.v1` rendered cards **226,229,508,197 px** wide;
    negative sizes made every card 0 px (an empty wallet that looks like a crash). Patch 27 clamps at
    load with the sliders' own ranges, per `stack`/`carousel` namespace - and keeps a *number* in
    `custom.stack`, because that is the legacy fan multiplier, not garbage (my first version deleted
    it and two long-standing pouch checks went red; the clamp now preserves it and a regression row was
    added for both 1.5 and 0.4). Same patch fixed `om()`, which dropped any card without `src` **and
    rewrote storage without it** - a silent, permanent loss for a card whose photo save was
    interrupted. A card with a title but no photo is now kept.
  - **QA-4 (Major) - an unreadable photo was a silent no-op.** `ye`/`ve` swallowed every decode error,
    so a HEIC, a cloud-only item or a 0-byte share left the user staring at an unchanged wallet.
    Patch 28 reports it: "Could not read that image - try another photo", "1 of 3 added - the rest
    could not be read", and a failed replace keeps the old face with its own message. This is the one
    fix fully verifiable in jsdom, and it is: negative control upto-27 fails exactly these two checks.
  - **QA-5/8 (Major, device-side) - Share and Save dead-ended, and CVV was being offered.** The bundle
    `await`s Capacitor plugin `CardIO` (`shareToWhatsApp`, `saveToGallery`) on native, but no such
    plugin ships (dex holds Capacitor core only, `cordova_plugins.js` is 0 bytes), so the promise
    rejected and the working Web-Share / download paths below it never ran. Patch 29 wraps both calls
    so they fall through. jsdom cannot enter `isNativePlatform()` - the suite says so instead of
    claiming a pass - so this half is device row V5. The same patch removes the `+ CVV` suggestion chip
    and the empty CVV field the tap flow created: PCI DSS forbids retaining a security code and this
    app stores everything unencrypted. (The two `CVV` substrings that remain are the copy that
    promises *not* to read one.)
  - **New tooling for the next reviewer:** `qa_feature_suite.mjs` (147 checks, 32 groups, including a
    group that documents what the harness cannot reach), `apk_content_check.py` (40 checks run against
    the bytes *inside* the APK: payload identical to the tree, every round's fix present, removed
    features and every HTML-injection sink absent from app code), and `replay_chain.py --upto N
    --swap` used as a negative control for all four fixes.
  - **Verdict of the pass:** no open Critical, 6 Major closed in code with regression re-run
    (147/147 + 221/221), and handover still **NOT READY** - the six fixes have never been pressed on a
    phone, and release signing, `FLAG_SECURE`, `windowSoftInputMode`, the unused NFC permission and a
    storage model that caps a photo deck at roughly 6-12 cards (measured: 20 cards = 16.4 MB, 67 ms
    re-serialised per save) are open. §5 of the handover report lists exactly what each item needs.


19. **Liquid Glass - a selective, tiered material system** (patch 30 + `app/index.css`), 2026-09-06.
    The brief was premium Apple-inspired glass *on important surfaces only*, and the two risks that
    kills are (a) a translucent UI nobody can read and (b) a sheet that stutters. Both are handled with
    a tier system, and both are enforced by tests rather than by taste.
  - **Tier 1 (`cw-lg-primary`, `cw-lg-fab`) is the only layer that blurs.** The bottom-sheet panel and
    the create disc get a real `backdrop-filter` (30px blur + `saturate(1.72) brightness(1.03)` on the
    sheet, a tighter 10px + `saturate(1.9)` on the disc), a top specular sheen, a hair rim and one soft
    depth shadow. `blur + saturate + brightness` is what makes the material read as *glass over the
    wallet's own cards* rather than as a grey film: the colour behind it genuinely bleeds through.
  - **Tier 2 (`cw-lg-ctl`, `.cw-range`, `.cw-chip`, `.cw-dot`, `.cw-card`, `cw-lg-pouch`,
    `cw-lg-preview`) never blurs.** That is the performance rule, and it is stated in the CSS as well
    as tested: a nested `backdrop-filter` costs the Android compositor a readback plus a filtered layer
    *per element*, so sliders, chips, swatches and rows get a translucent fill, a 1px rim and an inner
    highlight instead - which still looks like glass because they sit on tier 1's blur. `apk_content_check.py`
    fails the build if more than four selectors in the shipped stylesheet declare a blur, or if a tier-2
    control ever starts declaring one; the QA suite asserts that the open sheet has **at most three**
    blurred elements in the DOM (scrim + panel + disc), and that the wallet screen at rest has exactly
    one (the create disc). The rest of the wallet - the deck, the flat-colour cover, the header bar,
    toasts - is untouched, and nothing on the card path carries a glass class.
  - **Legibility was measured, not assumed.** `liquid_glass_audit.py` composites each surface over the
    worst thing a phone can put behind it - pure white artwork, mid grey, pure black - in both themes,
    and requires WCAG contrast through the glass. The first numbers it produced were a real bug:
    captions (`--sub`, a caption colour meant for an *opaque* sheet) measured **1.05:1** on light glass
    over a dark card, i.e. invisible. The fix is a dedicated pair of on-glass text tokens
    (`--lg-ink` #111113 / `--lg-sub` #3f3f46, light; #f7f7f9 / #c9c9d1, dark) plus tint alphas raised to
    the 0.74-0.90 band, and the tier-2 checks composite *through* tier 1 the way the browser does.
    Final measured worst case: sheet text 9.41:1, captions 5.21:1, pouch tray 11.52:1, chip labels
    14.15:1, create-disc glyph 10.2:1 (dark theme: 9.67 / 6.29 / 8.66 / 8.78 / 13.00).
  - **No proprietary anything.** No asset, glyph, gradient or metric was copied: the material is built
    from the app's own tokens (`--glass-*`, `--line`, `--solid`, `--accent`) with SF Pro typography, the
    26px sheet radius, the rounded geometry and both layouts intact. The disc keeps the round-13
    contract that its colours are theme tokens - `background: var(--solid)` became
    `var(--lg-solid-glass)` (and `var(--lg-glass-black)` / `var(--lg-glass-white)` for the pinned tones),
    so a theme flip still re-colours it; the three header checks were widened to the new tokens and now
    additionally assert the token inverts and that its alpha sits in the .70-.95 glass band.
  - **Motion stays cheap.** Appearance is a cross-fade riding the existing spring
    (`opacity:.92 -> 1` on the panel), state changes transition `background-color`, `border-color`,
    `box-shadow` and a `scale(.94)` press - `backdrop-filter` is never animated, no keyframe loops ship,
    and no permanent `will-change` is set (all four are asserted against the CSS text).
  - **Graceful degradation is part of the material**: `@supports not (backdrop-filter:blur(2px))`
    renders the surfaces opaque - which also answers COMPAT-1 from the QA pass (Android 6-9 system
    WebViews have no `backdrop-filter`) - and `prefers-reduced-transparency` / `prefers-reduced-motion`
    drop the blur, the sheen and the press scale.
  - **Tooling and preview.** `patches/liquid_glass_audit.py` (60 checks: tier rules, blur budget,
    transition hygiene, rim/glow limits, fallbacks, the contrast engine) and
    `docs/liquid-glass-preview.svg`, which the audit generates *from the tokens it just read*, so the
    picture cannot drift from the code. Gates: QA 173/173, smoke 229/229, replay IDENTICAL through
    patch 30, in-APK content 54/54, `verify_release` 28/29 (debug cert). Negative controls: patch 30
    out -> audit 54/60 and QA group 33 17/26; CSS block out -> group 33 18/26 and the audit refuses
    with a clean verdict instead of a traceback.


20. **Round 16 - the header's controls move into a glass footer dock** (patch 31 + `app/index.css`),
    2026-09-07.
  - **What was asked.** "Jo b cheezein header me ha sab ko footer pe set karo": `Create +`, `Search`
    and `Settings`/`More` were all in the top bar; they now live together in one floating glass pill at
    the bottom, with the same material quality as the rest of the Liquid Glass system. The `Wallet`
    wordmark stays at the top-left - it is the app's title, not a control, and it is the only thing left
    in the top row (asserted).
  - **The DOM re-wrap, not a CSS trick.** The wordmark and the three controls were siblings inside one
    `pointer-events-auto mx-auto flex w-full max-w-[520px] justify-end` row, and the option menu was
    anchored to that row. A CSS-only move therefore had no valid target: pinning the row to the bottom
    drags the wordmark with it, and leaving the menu where it is points an options list at an empty top
    corner. So `patch31_footer_dock.py` rewrites the structure - the top fixed container now holds **two
    bars**: the unchanged row (wordmark only) and a new bottom bar
    `pointer-events-none fixed inset-x-0 bottom-0 z-40` whose inner row is the dock itself
    (`pointer-events-auto cw-dock ... justify-center`). The three `g(...)` button elements were sliced
    out of the source **verbatim** (the patch asserts it finds exactly three, and runs `node --check`
    before accepting its own output), and the dock stays a child of the container that owns `ref:d`,
    because that ref is what closes the option menu when you tap outside it.
  - **The dock is a first-class glass surface.** It gets its own tier-1 material, not a copy of the
    sheet: radius 999 (a pill, so `blur(22px)` instead of the sheet's 30px - a short pill smears if you
    blur it hard), `saturate(1.78) brightness(1.03)`, its own `--lg-dock-alpha` at **0.80 / 0.84**
    versus the sheet's 0.74 / 0.82, because a deck of cards is always scrolling under it. The Create
    disc inside keeps the round-9/15 contract exactly (36px box, 19px `+`, `var(--lg-solid-glass)`,
    tier-2 rim) but loses its own `backdrop-filter`: **blur is not nested**, so the number of blurred
    surfaces is unchanged - one at rest (the dock, where the disc used to be), three with a sheet open
    (dock + scrim + panel). `liquid_glass_audit.py` pins all of that (dock blurs, has its own radius, is
    more opaque than the sheet, suppresses the nested blur, has the opaque fallback) and the
    "CSS declares a blur in at most five selectors" budget is checked into the APK as well.
  - **It opens upward, and the deck gets out of its way.** The option menu re-anchors to the dock's
    bottom-centre (`mx-auto mb-1 w-[248px]` with `transformOrigin: center bottom`) instead of hanging
    off the top-right, and `<main>` reserves `calc(env(safe-area-inset-bottom) + 62px)` unconditionally
    - the gesture inset is read, never invented, so the last card is never under the pill.
  - **Gates.** QA feature suite **175/175** (group 33 is 28 checks, +3 for the dock), web smoke
    **237/237** (+8 `header/foot` checks incl. an open/close behaviour test that drives the More menu in
    a mounted jsdom app), `liquid_glass_audit.py` **72/72** (+12), `apk_content_check.py` **60/60**
    against `CardWallet_footer_dock.apk`, `replay_chain.py` **IDENTICAL** through patch 31
    (465,259 → 465,581 B), stylesheet 28,767 → 30,752 B, `verify_release.py` **28/29** (only FAIL = the
    deliberate debug cert). Negative control: replay the bundle without patch 31 and smoke drops to
    229/237 with exactly the eight new checks failing, and QA group 33 to 27/28 - the checks are
    load-bearing, not decorative. Contrast through the new material was re-measured in both themes
    (worst case still >= 4.5:1; captions 5.21:1 light / 6.29:1 dark, dock labels 11.52:1).
  - **Not claimed:** how the blur actually composites over a moving deck on a real GPU, the safe-area
    gap on a gesture-nav phone, and whether 36px controls in a 123px pill are comfortable on a 5-inch
    screen - that is section **X** of `docs/DEVICE_TEST_PLAN.md`. `docs/liquid-glass-preview.svg` is
    regenerated from the tokens, so the picture of the dock cannot drift from the code.


21. **Round 17 - the dock takes the header's own geometry; the Settings sheet stops blurring twice**
    (patch 32 + stylesheet), 2026-09-07.
  - **Two asks.** "Setting me blur kam karo, lag feel ho raha ha" and "create, search, setting ko bottom
    pr le ayo - *same jaga pr jis jaga oper ha*". Round 16 had centred the three controls in a pill; they
    now sit where they always sat, mirrored to the bottom edge.
  - **The placement.** `patch32_dock_align_and_blur.py` gives the dock row the header row's class string
    verbatim (`pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-end gap-1 px-2`)
    and moves the glass onto a new child (`cw-dock pointer-events-auto flex items-center`) that wraps the
    three buttons. So the *column* is identical to the top bar's at every viewport width, while the blur
    is only paid for by a ~140x48 pill instead of a full-width bar. The option menu right-aligns too
    (`ml-auto mb-1 w-[248px]`) and grows from the More button (`transformOrigin: right bottom`) instead of
    from the middle. Both edits are anchored string swaps, each asserted to match exactly once, gated by
    `node --check`; `replay_chain.py` reproduces the shipped bundle byte-exactly through patch 32.
  - **The lag, root-caused.** Reading the shipped stylesheet, the Settings panel was *two stacked
    full-viewport backdrop filters*: the panel element carries `cw-glass-sheet cw-lg-primary` (so a 30px
    blur from the tier-1 rule) and it is a **child of the scrim**, which blurred at 20px of its own. A
    filtered ancestor becomes the panel's backdrop root - the compositor reads back and filters the whole
    screen twice, on every frame of the sheet's slide-in spring. So: the scrim no longer blurs at all (a
    20px blur under a 24%/34% dim is not visible), `--lg-blur` drops 30px -> 14px, and `--glass-blur`
    (the declaration the tier-1 rule overrides on that element) drops 34px -> 14px so both agree whichever
    wins. The pill deliberately keeps 22px: cost is *area x radius*, so the big surface gets the short
    blur and the small floating one affords more - which is also why round 15's "different blur per
    surface" requirement still holds. Blurred surfaces while Settings is open: **3 -> 2**. The material is
    unchanged otherwise (same tint tokens, same sheen, same rim, no new `will-change`, no animated filter).
  - **Gates.** `liquid_glass_audit.py` **79/79** (72 -> 79: +6 cost/radius rules and a rewrite of the old
    "dock radius sits between sheet and control" rule, which the new per-surface model supersedes; +2 JS
    rules that the dock row *is* the header row's class string and that the glass sits on the pill, not on
    the column), QA feature suite **177/177** (group 33 = 30: the blurred-DOM count is now `<= 2` and
    excludes the scrim, plus a check that no `.cw-scrim` backdrop-filter or `--scrim-blur` survives), web
    smoke **239/239**, `apk_content_check.py` **62/62** against `CardWallet_footer_tuned.apk` (the
    blur-selector budget tightened 5 -> 4), `verify_release.py` **28/29** (only the deliberate debug cert),
    contrast through the glass re-measured and identical to round 16 (alpha carries legibility, not
    radius: 9.41 / 5.21 / 11.52 / 14.15 / 10.20 light, 9.67 / 6.29 / 8.66 / 8.78 / 13.00 dark).
    Negative controls: bundle replayed without patch 32 -> smoke **237/239**, failing exactly the two new
    `header/foot` checks; stylesheet back at round 16 -> audit **74/79**, failing exactly the five round-17
    rules. `docs/liquid-glass-preview.svg` is regenerated from the tokens, so it now draws the pill on the
    right and smears at 14px.
  - **A harness fix, recorded so nobody chases it as an app bug.** In a freshly installed jsdom (27.4.0 /
    cssstyle), `element.style.backdropFilter = ...` is accepted but **not serialised into the `style`
    attribute**, so every check that regexed `getAttribute("style")` for `backdrop-filter`, `perspective`
    or `touch-action` began failing on *any* bundle - 11 of them, reproduced identically on the round-16
    commit. `smoke_test_webview.mjs` now reads those declarations through one `inlineStyle(el)` helper that
    consults the CSSOM as well as the attribute (and one preview check accepts `min-height: 0` or `0px`,
    since React writes numbers without a unit). No assertion was relaxed to pass: the same properties are
    required, read from a source that cannot silently drop them.

22. **Round 18 - a 4-digit app lock and an encrypted backup file** (patch 33 + stylesheet), 2026-09-09.
  - **Two asks, one shared plumbing.** "code add kro like 4 digit unlock code" and "Cloud Backup & Restore:
    agar user phone change kare ya app delete ho jaye to cards zaya na hon". Both live in one reviewed source
    file - `patches/vault_src.js`, appended verbatim into the bundle by `patch33_vault_lock_backup.py`, with
    its stylesheet `patches/vault.css` appended into `app/index.css`. The Settings sheet grows **one** card
    ("Lock & backup": one switch, three row buttons) so the minimum-controls rule of rounds 12-13 still
    holds; the module owns every row inside it and is handed a mount point through
    `ref: e => window.__cwVault && window.__cwVault.mount(e)`, so no React state is shared with the sheet.
  - **Scope, as chosen.** No account and no Drive SDK - the backup is *a file the user keeps anywhere*.
    The lock asks for the code on cold start and after more than 30 s in the background, with no timer
    control. Five wrong codes put a 30 s cool-down on the gate and the only way out is the explicit
    "Reset app" (two taps, it says what it will erase). There is no recovery backdoor.
  - **The crypto, and its limits.** The backup is AES-GCM 256 with a PBKDF2-SHA256 150,000-round key from
    a password the app never stores; the envelope carries `kdf`/`iters`/`salt`/`iv` and a file without an
    `enc` block is refused ("Backups are always encrypted"). If `crypto.subtle` is missing the export and
    import paths **refuse** rather than fall back to plaintext. The PIN is separate and deliberately cheap
    (600 rounds of SHA-256 in JS, so it runs even where WebCrypto does not): it is a gate on the app, not
    encryption of the stored deck - the card data in `localStorage` is in the same shape it always was,
    and the new Settings caption says exactly that. `allowBackup=false` is untouched: an explicit,
    user-initiated file export is a different mechanism and is documented as such.
  - **Export path with no new native code.** The APK is repacked, not gradle-built, so no plugin can be
    added: the file goes through the card-share chain already in the bundle - `navigator.canShare({files})`
    -> `navigator.share` -> `<a download>` - and the Capacitor save bridges are left to the media paths.
  - **Gates.** `liquid_glass_audit.py` **96/96** (79 -> 96: the round-18 block is asserted to exist, the
    gate is asserted *opaque* (no backdrop-filter), its controls are token-driven with no colour literal
    in the stylesheet block, `--danger` is added to both `:root` and `html.dark`, and the one keyframe
    that ships moves `transform` only), QA feature suite **231/231** (177 -> 231: a new group
    "34 lock & backup", 54 checks - including re-deriving the PIN digest with an independent Node
    implementation of the same KDF and AES-GCM round-tripping the real `.cwbak` file through Node's
    webcrypto, which must reject a wrong password), web smoke **239/239**, `apk_content_check.py`
    **70/70** against `CardWallet_lock_backup.apk` (62 -> 70: the gate's digit boxes, `wallet.vault.v1`,
    `PBKDF2-SHA256`, `.cwbak`, the refuse-plaintext copy, the shipped CSS block, and the gate's opacity
    read out of the APK, not out of the tree), `verify_release.py` **28/29** (only the deliberate debug
    cert). `replay_chain.py` reproduces the shipped 494,450-byte bundle byte-exactly **through patch 33**.
  - **Negative control, and three findings worth keeping.** Bundle replayed without patch 33 -> audit
    **90/96** and smoke **238/239**, failing exactly the round-18 rules; `--restore` then returns the tree
    to md5 `f987513e46c6`. (1) `visibilitychange` is fired at **document**, not window - a window-only
    listener never ran it in jsdom, which is how the auto-lock would have shipped dead on some WebViews, so
    it is registered on both. (2) This repo does **not** inline CSS into `index.html`:
    `build_debug_apk.py` swaps `assets/public/assets/index-*.js` and `...css` as separate entries, and
    `app/index.html` stays the 1,185-byte Vite shell - a patch that "re-synced the inlined style" would be
    editing a file that does not exist. (3) In jsdom, `delete w.Date.now` after `w.Date.now = fn` removes
    the realm's own `Date.now` outright and every later app call throws; the fake clock now saves and
    restores it (`qa_feature_suite.mjs`), after that bug made a working auto-lock look over-eager.


23. **Round 19 - card customization only while a switch says so** (patch 34 + stylesheet), 2026-09-14.
  - **The ask, verbatim:** "aik option add kro customization wo on krain tab hi customization kray skain
    card ki wrna nhi or auto band ho wo". No scope answer came back, so the three open questions are
    answered in the open (default **off**, it gates the **Custom Pouch** colour / cover / stack-and-carousel
    sliders, it **auto-closes** when Settings shuts or the app is backgrounded) rather than buried in code.
  - **Two files, one rule.** `patches/customize_src.js` is appended verbatim into `app/index.js` and
    `patches/customize.css` into `app/index.css` by `patch34_customization_gate.py`. The patch grows a
    mount point inside the pouch card - a plain `cw-cust-slot` div whose ref callback calls `window.__cwCust.mount(e)`
    - and wraps the `design` + `layout` variables in one `cw-cust-body` block. That block is the entire
    mechanism: `html[data-cw-custom="off"] .cw-cust-body{display:none}`, and the module's only job is to
    write `on`/`off` on `<html>`. Bundle 494,450 → **498,509 bytes**, stylesheet 36,600 → **37,259 bytes**,
    `replay_chain.py` reproduces both **through patch 34**.
  - **Why a class and not React state.** The settings object belongs to the app's own components; a second
    writer would fight it and would also have to survive the sheet's re-renders. With a CSS-level gate the
    sliders keep working through every re-render, existing values keep applying while the block is hidden
    (the gate hides *controls*, never the user's look), and a module that fails to run leaves everything
    visible - **fail-open is the safe direction for a UX guard**, and the QA group asserts that no
    unqualified `display:none` on `.cw-cust-body` exists in the stylesheet.
  - **Auto-off, and the ref trap it had to dodge.** Closing the sheet is detected by polling
    `slot.isConnected` every 400 ms *only while the gate is open* (a `MutationObserver` on the document
    would fire on every deck animation), plus `visibilitychange` on `document` and `pagehide`. React calls
    an inline ref with `null` and then the node on **every** re-render, so a null ref must not be read as a
    close - otherwise the first slider drag would shut the gate. One check exists specifically for that:
    after three drags the gate is still on and the slot still holds exactly one row.
  - **Nothing is persisted - deliberately.** No key, no cookie, no `indexedDB`: the switch lives as long as
    the screen does. "Remembered on" is the same bug as "off that you forgot about", and it also keeps
    `wallet.settings.v1` and the `.cwbak` backup out of reach of a second writer. The audit and the QA group
    both read the module's source to prove the absence, and the gate adds **no** blurred surface, colour
    literal, keyframe, shadow or `innerHTML`.
  - **Control budget.** The Settings sheet gains exactly one switch (3 → 4) and one button (25 → 26 inside
    the 27 cap); both smoke and the QA budget check pin the numbers so a future round cannot quietly add
    a second control to this card.
  - **Gates.** `liquid_glass_audit.py` **105/105** (96 → 105: block exists and is small, no new blur, no
    colour literal, one qualified hide rule, no animation of its own, module and slot mounted once, the
    wrap is exactly design+layout, and the gate touches no storage), QA feature suite **259/259**
    (231 → 259: new group "35 customization", 28 checks - including `getComputedStyle` proving the block
    computes to `display:none` while closed and is laid out when open, zero writes for a toggle, an edit
    made while open being stored and *kept* after the gate closes, auto-off on Done / background / pagehide,
    no interval left behind, the switch staying reachable in both states, and that layout mode, theme and
    the lock card are not gated), web smoke **241/241**, `apk_content_check.py` **78/78** against
    `CardWallet_custom_gate.apk` (70 → 78: the slot, the wrapped block, the export, the statelessness and
    the shipped CSS rule are read out of the APK, not out of the tree), `verify_release.py` **28/29**
    (only the deliberate debug cert).
  - **Negative control.** `replay_chain.py --upto 33 --swap` (bundle without patch 34; `--swap` writes
    `index.js` only, so the stylesheet-side rules legitimately still hold) -> audit **103/105**, smoke
    **239/241**, QA group 35 **7/28 (the 7 that still pass are the stylesheet-side and absence rules - `--swap` writes `index.js` only)**. Writing that group surfaced a harness bug worth keeping as a
    rule: every lookup in a feature group must be null-safe and every source-level check must first assert
    the block it reads exists, or "feature missing" reports as a crash instead of a failure.
  - **Device work.** `docs/DEVICE_TEST_PLAN.md` section **AA** (10 rows) - reveal-without-reload, no jank
    on the toggle, auto-off on close and on backgrounding, rotation mid-edit, TalkBack, hit targets, and
    old-WebView behaviour (the gate involves no `backdrop-filter`, so it must look identical on Android
    6-9). **AA1** and **AA3** are handover gates: a customization switch that does not actually reveal the
    controls, or that lets edits through while off, is worse than no switch.

24. **Round 20 - the card preview gets a visible Back control, and the Back key finally closes it**
   (patch 35), 2026-09-18.
  - **The ask, verbatim:** *"Yehn pr back ka option nhi ha app meh add kro"*, with a screenshot of the
    full-screen card preview - the one with the WhatsApp and Save pills.
  - **Two defects, one screen.** (a) It was the only surface in the app with **no visible way out**:
    Settings and the editor have Done, the long-press sheet and the crop sheet have Cancel, the preview
    had nothing but the invisible knowledge that tapping the empty backdrop (or swiping down) dismisses
    it. (b) Worse, **the system Back key did not close it either**: patch 26 built the history contract
    (one `pushState` per open surface, `popstate` closes the topmost) but its gate list is
    `f v T m c D k b C` and the preview's state `o` is not in it, so Back produced a plain navigation
    with nothing to pop and the activity finished - the app exited and the screen the user was reading
    was gone. Same defect class as QA-1 in `docs/QA_HANDOVER_REPORT.md`, on the one surface that pass
    missed; the fix is four anchored edits (`op()` gains `||o`, `shut()` gains
    `if(o){ae.current=!1,s(null);return}` - the mirror of `jd`'s own `onClose` - and the effect's
    dependency list gains `o` - without it the listener keeps a stale `null` - and the popstate handler
    clears `pushed` before shutting, because the user's Back has *already* consumed the entry; that second
    half also stops a Back-close from swallowing the **next** Back press (round-19 build: Settings → Back →
    Settings → Back does nothing on the first press) and lets a sheet opened over the preview close first.)
  - **The control.** A 44x44 disc, top-left, `top: calc(env(safe-area-inset-top) + 10px)`, chevron
    glyph, `aria-label="Back"`, inserted *after* the card stage so a tall portrait card can never paint
    over it, and *before* the pills row so the patch has one unambiguous anchor. It calls the preview's
    own close path (`te()`), i.e. exactly what a backdrop tap does - so the chevron, the backdrop and
    the hardware Back key are now one behaviour, and `stopPropagation` keeps a single tap from closing
    twice. It animates `opacity`/`y` only and adds **no** glass: the fill is literally the Save pill's
    `rgba(255,255,255,0.16)` over the preview's `#09090b`, which measures **13.1:1** for the glyph.
  - **Numbers.** Bundle 498,509 → **499,369 bytes** (499,197 characters) and the **stylesheet is
    untouched** (37,259 bytes) - a patch that needed no new token, so the four-selector blur budget and
    every round-15/17/19 CSS rule are structurally unaffected.
  - **Gates.** web smoke **241 → 255**, QA feature suite **259 → 279** (new group "36 back affordance",
    20 checks: the control, its geometry, the close, the data being untouched, one history entry per
    open, Back closing the preview instead of the activity, a second Back not sweeping the wallet away,
    **a sheet opened over the preview closing first and the preview second** (long-press → editor), the
    swallowed-Back regression, plus the source guards), `apk_content_check.py` **78 → 83** (read out of
    the APK, not the tree - the control, its safe-area placement, the gate, the dependency list and the
    history accounting), `liquid_glass_audit.py`
    **105/105** and `animation_audit.py` **10 checks / 1 pre-existing warning** unchanged,
    `verify_release.py` **28/29** (the single deliberate failure is the debug certificate).
  - **Negative control.** The two suites run against the pre-patch bundle (`git show HEAD:repo_export/app/index.js`):
    smoke **243/255** - exactly the 12 feature checks fail - and QA group 36 **8/20**. Honest limit: `replay_chain.py`
    **cannot be run in this checkout** - the pristine seed bundle is not in the repo (`app/index.stock.js`,
    `/tmp/index.stock.js` and the `eb98ba0` fallback ref are all absent), so the chain-level claim is
    "each patch's own `--check`/idempotency holds, patch 35 applied twice is a no-op" rather than
    "replayed byte-identical", and it is written that way rather than quietly left implied.
  - **Device work.** `docs/DEVICE_TEST_PLAN.md` section **AB** (7 rows). **AB1** (the disc is drawn and
    tappable on a real screen, clear of the status bar) and **AB2** (the hardware Back key reaches
    `popstate` at all in this Capacitor shell) are handover gates - AB2 is the same open question patch
    26 has carried since round 14, only now with a visible control beside it.
  - **Artifact.** `CardWallet_back_button.apk` - **11,668,989 bytes**, sha256
    `3a8edb49bf590f4657d453505258303d60a20c7b81bba25a6a6169fc24e824fa`. Debug-signed with a throwaway
    key (the production keystore is gitignored and not present in this checkout, so no release-signed
    build was produced), `allowBackup=false`, aligned, verified 28/29. Uninstall
    `com.arena.cardwallet` before installing it over any earlier build.

## Structure
- `app/` - the web bundle that runs inside the Android WebView (Capacitor-based hybrid app): `index.html`, the compiled/minified `index.js`, `index.css`, and icons.
- `android/AndroidManifest.xml` - the app's Android manifest.
- `patches/` - Python scripts that patch the minified `index.js` (patch1 -> patch35), plus
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
- `../CardWallet_back_button.apk` - **current build** (round 20, debug-signed): the preview's Back
  control and the Back-key fix. This is the file `site/index.html` links to.
- `../CardWallet_custom_gate.apk` - the round-19 build the site linked to before round 20.
- `../CardWallet_no_autodetect.apk` - superseded debug-signed build (do not ship).
- `../CardWallet_release.apk` - the release-signed build of the round-14 tree. The production keystore
  lives outside this checkout, so nothing newer than it can be release-signed here; a release build of
  the current tree is still outstanding (see `../docs/RELEASE.md`).

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
- `node patches/smoke_test_webview.mjs` - 220 web-layer checks (`npm i jsdom`);
  the carousel tests drive real pointer events: they reproduce the stuck half-shifted
  row (58.4px) and prove it recovers to 0.00px, prove a swipe in the empty band moves
  nothing, read each pouch's painted gradient to prove a per-card colour wins, and read
  the Stack cover's painted gradient to prove it is the wallet colour rather than glass.
  A `matchMedia` stub that answers "dark" is what makes the light-by-default and
  appearance-migration checks mean something
- `python3 patches/animation_audit.py` - static jank audit

**jsdom suites (`smoke_test_webview.mjs`, `qa_feature_suite.mjs`)** are run with
`NODE_PATH=~/.cache/smoke/node_modules node patches/<suite>.mjs` after
`npm i --prefix ~/.cache/smoke jsdom@27 cssstyle@4.6.0`. That pairing is deliberate: cssstyle accepts
`style.backdropFilter` (and `perspective`, `touch-action`, ...) but does **not** write them back into the
`style` attribute, so a suite that regexes `getAttribute("style")` loses them - jsdom 24/26 fail 11
checks that way, jsdom 27 + cssstyle 4.6.0 only fail the ones `smoke_test_webview.mjs` now reads through
its `inlineStyle()` helper (round 17), which consults the CSSOM as well as the attribute.

`verify_release.py` shells out to `apksigtool` for the v2/v3 checks
(`pip install --user apksigtool`); without it those 3 checks cannot run.

**Test builds without the release key:** `python3 patches/build_debug_apk.py`
writes `../CardWallet_stack_preview_fixed.apk`, signed with a throwaway key it creates
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
