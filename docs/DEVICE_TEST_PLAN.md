# On-device test plan — CardWallet_release.apk

Everything in this file is **still outstanding**: it requires a physical
Android phone and could not be executed in the build environment (no device,
no `adb`, no emulator — the Android SDK/JDK download endpoints are blocked
there). Nothing in this file has been marked as passed by the build pipeline.

APK under test: `CardWallet_release.apk`
SHA-256: `63dbd8b1929fdbcb673a19ebab585c0c723ae41518188ff437e84da0c2233e9a`
Signer cert SHA-256: `86383a7f13662e8b55885cb5331341f8db964ad065da074cc360082a3e436726`

**Currently on device:** the rounds since §M ship as debug-signed builds because no release
keystore is available here - the newest is `CardWallet_cover_colour.apk` (2026-09-05, rounds
§N-§Q: stack eject, carousel settle, inert bands + per-card pouch colour, cover colour +
NFC/appearance defaults + header wordmark). Same debug key throughout, so `adb install -r`
keeps the app's data; §Q's rows are the ones that matter for this build.

## 0. Install

Old debug-signed builds must be removed first — the signature changed.

```bash
adb uninstall com.arena.cardwallet          # ignore "Unknown package"
adb install -r CardWallet_release.apk
adb shell dumpsys package com.arena.cardwallet | grep -E "versionCode|flags"
# confirm the installed signer:
adb shell pm dump com.arena.cardwallet | grep -i signature
```

Suggested devices: one mid-range phone (the animation truth-teller, e.g.
Snapdragon 6xx/7xx class, 60 Hz) **and** one 120 Hz flagship. Android 13+ and
one Android 9–11 device if you support them (minSdk is 23).

---

## A. Fresh install (empty state)

| # | Step | Expected |
|---|---|---|
| A1 | Launch from launcher, cold start | Splash → wallet in < 2 s, no white flash, no ANR |
| A2 | First screen | 4 demo cards (CNIC, Licence, Debit, Student) in the carousel |
| A3 | Rotate / fold-unfold if applicable | No crash, layout re-flows (activity handles configChanges itself) |
| A4 | Check storage seeded | `adb shell run-as com.arena.cardwallet ls -l app_webview` populated |

## B. Camera

| # | Step | Expected |
|---|---|---|
| B1 | `+` → **Take a picture**, first time | Android runtime permission dialog appears once |
| B2 | Deny the permission | Clear in-app message, no crash, back to wallet |
| B3 | Grant, then capture | Live preview is smooth, shutter works, captured image lands in the crop view |
| B4 | Crop → Save | Card appears in the wallet with the photo, correct aspect ratio, not rotated/mirrored |
| B5 | Torch toggle (if the device has one) | Turns the flash on/off |
| B6 | Leave the camera sheet with system Back / Cancel | Preview stops, camera LED off, no held camera handle |
| B7 | Take a picture → immediately background the app | No crash on return, camera released |

## C. Gallery

| # | Step | Expected |
|---|---|---|
| C1 | `+` → **Add from gallery** | System picker opens (photo picker on Android 13+) |
| C2 | Pick a large photo (≥ 12 MP) | Import completes, no OOM, wallet stays responsive |
| C3 | Cancel the picker | Returns to the wallet with no half-created card |
| C4 | Pick a HEIC/WebP image | Either imports correctly or fails with a readable message |
| C5 | Add front **and** back of one card | Flip shows the correct side |

## D. NFC (bank-card read)

| # | Step | Expected |
|---|---|---|
| D1 | Settings → *Read cards over NFC* is On, `+` menu shows **Tap a bank card** | Present |
| D2 | Turn NFC off in Android settings, open the sheet | "NFC is off" style message, no crash |
| D3 | Tap a contactless debit/credit card | Buzz, PAN + expiry filled in; **CVV/PIN never shown** |
| D4 | Move the card away mid-read | "The card moved away…" message, recoverable |
| D5 | Tap a non-bank card (transit/office badge) | "That is not a bank card…" message |
| D6 | Toggle the NFC setting Off | **Tap a bank card** disappears from the `+` menu |
| D7 | Leave the NFC sheet open, lock/unlock the phone | Reader mode restarts cleanly, no stuck scan |

## E. WhatsApp hand-off

| # | Step | Expected |
|---|---|---|
| E1 | Open a card → **WhatsApp** | WhatsApp opens on the contact picker with the card image attached |
| E2 | Send to a chat and open it there | Image is full quality and the right card/side |
| E3 | Uninstall/disable WhatsApp, retry | Graceful message or system chooser — no crash (manifest queries only `com.whatsapp`, `com.whatsapp.w4b`) |
| E4 | WhatsApp Business installed instead | Still resolves |
| E5 | Return to the wallet with Back from WhatsApp | Wallet is where it was, no duplicate activity |

## F. Android system Back  ⚠ known risk — check first

The web layer registers **no** Back handler and the app bundles **no**
Capacitor plugins, so `BridgeActivity` falls through to "WebView can't go back
→ finish the activity". Expect Back to close the whole app even when a sheet is
open. Confirm the real behaviour for each case:

| # | State when Back is pressed | Expected (desired) | Watch for |
|---|---|---|---|
| F1 | Wallet home | App goes to background | — |
| F2 | `+` menu open | Menu closes, app stays | Likely **app exits** instead |
| F3 | Settings sheet open | Sheet closes | Likely **app exits** |
| F4 | Card detail / preview sheet open | Sheet closes | Likely **app exits** |
| F5 | Camera sheet open | Camera closes, wallet stays | Likely **app exits** with camera open |
| F6 | Crop view open | Back to capture, no half-saved card | Data loss |
| F7 | Predictive back gesture (Android 14+) | No flicker, no black frame | |

If F2–F6 exit the app, the fix belongs in the app source: register an
`@capacitor/app` `backButton` listener (or push a `history` entry per overlay)
and close the top-most overlay first. It cannot be retro-fitted safely into the
minified bundle shipped in this repo.

## G. App restart & data persistence

| # | Step | Expected |
|---|---|---|
| G1 | Add 3 cards, kill from recents, relaunch | All 3 cards, order and details preserved |
| G2 | `adb shell am force-stop com.arena.cardwallet`, relaunch | Same |
| G3 | Change pouch style / appearance / layout, restart | Setting preserved (`wallet.settings.v1`) |
| G4 | Reboot the phone, relaunch | Cards still there |
| G5 | Fill the wallet with ~30 photo cards | Cold start still < 3 s; watch for the "No room left on the phone" toast (photos are data URLs in `localStorage`) |
| G6 | Delete all cards → confirm → restart | Wallet stays empty (no demo cards resurrecting) |
| G7 | Background the app for 30+ min, return | State intact, no reload flash |

## H. Backup hardening (regression for the `allowBackup` change)

| # | Step | Expected |
|---|---|---|
| H1 | `adb backup -f out.ab com.arena.cardwallet` | Refused / empty archive — card data must not leave the sandbox |
| H2 | `adb shell bmgr backupnow com.arena.cardwallet` | Reports the package as not backup-enabled |
| H3 | Google "backup & restore" onto a new phone | The wallet is **not** restored (accepted trade-off) |

## I. Animations — manual, on device, in good light

Run each one twice: once on the mid-range phone, once on the 120 Hz device.
Optional instrumentation:
`adb shell dumpsys gfxinfo com.arena.cardwallet framestats` and
Developer options → *Profile HWUI rendering* (bars must stay under the green line).

| # | Interaction | Look for |
|---|---|---|
| I1 | Carousel: swipe left/right fast, then flick | 60/120 fps, no stutter at the snap point, no rubber-band overshoot artefact |
| I2 | Carousel → Stack (Settings → Layout) | The re-layout transition does not jump or flash |
| I3 | Stack: scroll the pile up/down | Cards stay ordered, no z-fighting, no flicker between shadows |
| I4 | Tap a card → detail sheet | Sheet rises smoothly, card morph matches its source position |
| I5 | Drag the sheet down halfway and release | Snaps back or dismisses cleanly — never sticks half-open |
| I6 | Card flip (front ↔ back) | No mid-flip white frame, no mirrored text |
| I7 | `+` menu open/close | Scale/fade under 200 ms, no ghost of the menu left behind |
| I8 | Settings sheet: toggle Appearance dark/light | Whole-screen theme change without flashing white |
| I9 | Frosted pouch style (backdrop-filter) | This is the most GPU-expensive surface — check for dropped frames while scrolling behind it |
| I10 | Delete a card | Neighbouring cards close the gap smoothly, nothing snaps |
| I11 | Toggle switches in Settings | Knob glides (it animates `left`, so watch for a 1-frame jump) |
| I12 | NFC "tap" ripple | Pulse is smooth (it animates `width`/`height`, layout-triggering) |
| I13 | Accordion rows in Settings (`height: auto`) | Expand/collapse without content jitter |
| I14 | Cold start | No flash of unstyled content, splash blends into the wallet |

Any jank found in I11/I12/I13 has a known cause (layout-animated properties) —
report which one and it can be converted to a transform-based animation.

## J. Existing-state upgrade path

| # | Step | Expected |
|---|---|---|
| J1 | Install the old debug build, add cards, then install the release APK **without** uninstalling | Install is expected to fail (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) — document it for users |
| J2 | Uninstall old → install release → restore nothing | Fresh state, demo cards, everything works |
| J3 | Install release, add cards, install the **same** release APK again (`-r`) | Update succeeds, cards preserved |

## K. Wallet & cover switch (new)

Settings → **Pouch** → *Wallet & cover*. Default on; installs made before this
build keep the pouch until the switch is touched.

| # | Step | Expected |
|---|---|---|
| K1 | Settings → Pouch, switch is **On** | Pouch controls (Name, Colour, Grading, Grain, Stitches) are listed under it |
| K2 | Turn it **Off** | Those controls disappear, subtitle reads "Off · plain cards in Carousel and Stack" |
| K3 | Close Settings, Carousel layout | No pouch/sleeve behind the cards; the card sits centred in the same slot, neighbours do not shift |
| K4 | Switch to Stack layout | No frosted glass cover over the cards |
| K5 | Light appearance, cover off | Card title under the card is **black** and readable |
| K6 | Dark appearance, cover off | Same title is **white** and readable |
| K7 | Tap a card with cover off (Carousel) | Detail sheet opens as usual, card is not left stuck mid-eject |
| K8 | Tap a card with cover off (Stack) | Same — the open hand-off no longer comes from the cover animation |
| K9 | Turn the switch back **On** | Pouch/cover return with the previous colour, grain, grading and stitches |
| K10 | Restart the app with the switch off | Still off (`wallet.settings.v1.cover === false`) |
| K11 | Swipe the carousel and the stack with the cover off | Motion is at least as smooth as with the pouch on — fewer layers to paint |
| K12 | Toggle the switch back and forth quickly | No flicker, no orphaned pouch layer, no crash |

---

## L. Header options (restyled to the mock — patch 7/8)

These are the checks the build machine cannot do: `smoke_test_webview.mjs` proves
the *values* (fill `#000`, glyph `#fff`/`#000`, 26px bare glyphs, hamburger path,
black dropdown) but it renders nothing, so contrast over real card photos is
untested.

| # | Step | Expected |
|---|---|---|
| L1 | Cold start, light theme, look at the header | `+` on a solid black disc with a white plus; search and the hamburger are bare black glyphs with **no** background, as in the mock |
| L2 | Compare the three options side by side | Same visual weight — the loupe and the bars read as large as the disc (26px vs 23px in the disc). If they look small, raise `size` for bare glyphs in patch7 |
| L3 | Tap each option | All three respond on the first tap; the hit area is 44px even for the bare glyphs (nothing to "miss" because there is no chip) |
| L4 | Open the `+` menu, then the hamburger | Black panel, white rows, rows dim on press; the open option shows its active state (halo on the disc, `var(--chip)` circle on the bare one) |
| L5 | Long-press / scroll a bright card photo under the header | Bare glyphs stay legible over a dark photo and the dark pouch. (Reported and fixed: literal `#000` glyphs disappeared on the dark theme — `tone` now defaults to `auto`.) If contrast is still marginal over a bright photo, that is a scrim question, not a token one |
| L6 | Switch Appearance to Dark, back to the wallet | Header **inverts**: light = near-black disc + white plus; dark = white disc + black plus, and the search/menu glyphs flip to near-white. Nothing may go invisible. Then re-check the black dropdown panel on the light theme — it is deliberately still black and does not invert |
| L7 | `Delete all cards` row | Still red (`#ff453a`) on the black panel, not white |
| L8 | Rotate the phone / split-screen with the header open | Menu stays anchored under the row, no clipping at 520px max width |
| L9 | Any device with a notch/cutout | Header clears the status bar (`safe-area-inset-top` + 6px) and the disc is not overlapped by the clock |
| L10 | 120 Hz device, open and close both menus | The spring in/out still feels like the rest of the app — the styling changed, the animation did not |

L5/L6 are the regression pair for the on-device report in `FINAL_REPORT.md` §6:
the mock's literal `#000` was invisible on the dark theme, and the header now
rides the app's own `--solid`/`--on-solid`/`--ink` tokens so it inverts.

---

## N. Stack layout: tap-to-eject (patches 12 + 13)

The old behaviour was only visible on a real screen, so this is the row that
matters most: the machine can prove the tap opens, but not whether it *reads* well.

| # | Step | Expected |
|---|---|---|
| N1 | Settings -> Layout -> Stack | Deck of cards fanned left/right, front card centred |
| N2 | Tap the **front** card | It rises out of the deck (~57px on a phone) with the frosted flap folding back, then the detail sheet opens from that card |
| N3 | Tap a card at the **left or right edge** of the deck (a neighbour, not the front one) | **That** card rises out of the slot it is in and opens. It must NOT travel sideways first (that was the original bug, then a slide-in - patch 13 removed the deck tween entirely) |
| N4 | Watch the motion, slowly if you can | One move, straight out: lift + a 5% grow + the flap folding, ~a quarter second. No sideways entry, no bounce-back, no deck rotation, no frame hitch while the flap folds |
| N4b | Frosted cover while folding | The flap may lose its background blur mid-fold (that is the deliberate cost cut) but must look frosted again once the card is back. If it flickers visibly, say so |
| N4c | Close the sheet | Deck lands with the card you opened at the front, and the card is not stuck lifted/zoomed. The re-order happens behind the sheet, so you should not see cards shuffle |
| N5 | Swipe horizontally on the deck | Still flips cards (that gesture must not open anything); the card you land on is the one a tap would open |
| N6 | Close the sheet (swipe down / backdrop) | Deck is left with the card you opened at the front; that card is not stuck lifted/zoomed and not blurred |
| N7 | Tidy-up check: open a card, close, open another 5-6 times | No drift - after the first tap the deck used to stop resyncing its position (a leaked `drag.current`); the fan should still follow card adds/selection changes |
| N8 | Settings -> Wallet & cover OFF, then repeat N2 | Card still lifts, sheet opens ~240ms later (no flap to wait for). Should not feel laggy compared to cover ON |
| N9 | Carousel layout, tap a card in the pouch | Unchanged by this patch: card slides up out of the sleeve and opens. Only the middle pouch is tappable - side pouches need a swipe first (stock behaviour, tell me if you want it changed) |

N2/N3/N4 are the acceptance rows for this change; N7 is the regression guard for
the ref-leak fix. If the motion still feels heavy on a low-end phone, the knobs are
in patch 13 (lift distance `.11`, spring `520/34/.6`, flap `.26s`, handoff `170ms`)
- and the remaining cost is the flap's blur at rest, which stays because it is the
look.

## O. Carousel: a card that stops half-shifted must recover on its own (patch 14)

Context for these rows: the grey pill marked in the report is the phone's **system**
gesture bar - there is no app element there to remove, and no padding/safe-area was
touched. What patch 14 fixes is the *stuck row*: a swipe the system eats used to leave
the pouch resting half a card sideways, with the front card clipped by the screen edge
and its title cut (`...ar`).

| # | Step | Expected |
|---|---|---|
| O1 | Carousel (default pouch view): drag a card sideways, release normally | Unchanged feel - snaps to a card, centred. This patch must not make the gesture heavier or add a second animation |
| O2 | Drag a card only about half a card-width, then flick **down into the bottom gesture bar** so Android takes the swipe (or let a back-gesture / notification cancel it) | Within ~0.3-0.7s the row finishes settling by itself: the nearest card centres, nothing rests half-clipped by the screen edge |
| O3 | Drag a card, then hold it still under your finger (~half a card out of place) | Not yanked while you are moving. After a long still hold (~0.7s) it may snap to the nearest card - that is the deliberate trade; note it if it feels intrusive |
| O4 | Interrupt the row *while it is gliding* to a card (touch down mid-animation) | The pending step is committed, then your finger takes over. Used to stick sideways and then jump |
| O5 | Leave the pouch alone for a second and look at the resting row | Exactly centred: no sub-pixel lean, front card's title not clipped by an offset |
| O6 | Bottom of the screen | No visual change expected here (stock 58px padding kept). Confirm nothing new is clipped behind the gesture bar |

If O2 still shows a stuck card, the useful detail is *which* gesture ate it (edge
back-swipe, notification shade, recents) - the watchdog only gives up while a glide is
already running, so a stuck row after ~1s would mean the row was left mid-animation by
something else.

## P. Pouch screen: dead area, cover blur, per-card colour (patches 15 + 16)

The screenshot rows: the black band above and below the pouches had to stop responding,
the cover's blur had to go, and a card's name had to be readable in light mode. §O's
recovery rows stay in the plan - they are now a safety net, not the main fix.

| # | Step | Expected |
|---|---|---|
| P1 | In the carousel, press and drag starting in the empty black area **above** the pouches | Nothing happens at all: the row does not move, no card shifts, no scroll/rubber-band. The grab cursor is gone there too |
| P2 | Same, in the empty area **below** the row (over/near the system gesture bar) | Also nothing. A swipe that starts on a pouch still drags it normally |
| P3 | Drag starting exactly on the front pouch, and on a side pouch | Both still work - that is the only surface that responds; releasing still snaps to a card, centred |
| P4 | Settings -> Layout -> Stack: watch the cover fold when a card opens | No frosted blur any more - a flat translucent panel. The card behind it must NOT be readable through the cover (no number/chip showing through). If the panel now looks too plain or too dark, say so |
| P5 | System in **light** mode, look at the card names under the pouches (and in the Stack view) | Black and bold (`#111113`, weight 800), never white; no grey smudge behind them. In dark mode they stay near-white and the soft halo remains |
| P6 | Long-press a card -> Card details -> **Pouch colour** | 11 swatches appear under the card's name. Picking one repaints *that* card's pouch only; the other cards keep the wallet colour |
| P7 | After P6, the **Wallet colour** chip appears in that row | Tapping it removes the override and the card follows the wallet colour again. Then Settings -> Pouch -> Colour still changes every card that has no override |
| P8 | Kill and reopen the app after P6/P7 | The per-card colour persisted (it is stored on the card), and a card you never touched looks exactly as before |

If P1/P2 still move the row, note the device and whether a system gesture was involved -
the guard is on the event target, so a stray target (e.g. an overlay from another app)
would be worth knowing about.

---

## Q. Stack cover colour, NFC off, light default, header wordmark (patch 17)

Four asks in one build: the cover had to stop being glass and *become* the picked colour,
NFC had to stay off, the app had to open light, and the header had to say **Wallet**.

| # | Step | Expected |
|---|---|---|
| Q1 | Settings -> Layout -> Stack, cover left **on**, look at the cover panel | It is a flat panel painted in the pouch colour - no frost, no blur, no translucency. The card behind it must not be readable through it (no number, chip or photo edge showing through) |
| Q2 | Settings -> Pouch -> Colour: pick a different colour, then go back to Stack | The cover panel changes to the same colour family (lighter at the mouth, darker at the bottom). It should never look grey/white again |
| Q3 | Long-press a card -> Card details -> Pouch colour: give one card its own colour | That card's cover panel uses its own colour, the other cards keep the wallet colour - in Stack as well as in the carousel |
| Q4 | Settings -> Pouch -> **Wallet & cover** off, then on again, and open a card | Off: the photo is visible with no panel. On: the coloured panel folds back. No flicker, and the fold animation should feel no heavier than before (it is now cheaper: no blur to composite) |
| Q5 | Kill the app, set the **phone** to dark mode, reopen | The app opens **light** (default is Light now, not System). Settings -> Appearance shows **Light** selected. Tap System -> it follows the phone (dark at night); tap Dark -> always dark; kill and reopen: your choice is kept, it is not forced back to Light |
| Q6 | Open the **+ menu**, then Settings | No "Tap a bank card" entry anywhere, and no "Read cards over NFC" row in Settings - even on this existing install that used to have NFC on. If you want NFC back later, that is a new patch, not a toggle |
| Q7 | Look at the top-left of the header (light and dark theme, and with the notch/status bar) | "Wallet" is large and bold in the iOS-style system font, black in light theme, near-white in dark theme, never overlapping the +/search/menu icons or the status bar |
| Q8 | Scroll/drag near the header while the wordmark is there | The wordmark is not a touch target - dragging that starts over it behaves exactly like dragging in dead space (patch 15's rule still holds) |

If Q5 comes back showing dark-on-reopen, the migrated value was overwritten by a stored
choice - say so and include whether Appearance was ever touched on that device.

---

## Sign-off

The build may only be called production-ready once A–Q are green on at least
one physical device. Record device model, Android version and result per row,
and file anything that fails with the section id (e.g. "F3 fails: Back exits
the app with Settings open").
