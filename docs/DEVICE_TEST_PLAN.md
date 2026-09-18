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

## F. Android system Back  ⚠ regression check for patch 26 — do this section first

**Status changed in this QA pass.** The app previously registered *no* Back
handler at all, so Back from any sheet exited the app. Patch 26 added a
history-based contract in the web layer: opening the topmost sheet pushes
exactly one `history` entry, and a `popstate` listener closes that sheet again
(z-order crop → camera → delete-all confirm → editor → card sheet → settings →
pouch studio → tap → search). jsdom proves the contract (QA suite group 17 +
2 smoke checks); **it cannot prove that the hardware key reaches `popstate` in
`BridgeActivity`**, which is what this section is for. If a row below exits the
app instead of closing the surface (see also V10 for the keyboard interplay), patch 26 is not working on that device/OS
combination — capture `adb logcat -s chromium Capacitor` and file the row.

Every "Likely app exits instead" note in the table below is the *old* behaviour,
kept as a description of the bug, not an expectation.

| # | State when Back is pressed | Expected (desired) | Watch for |
|---|---|---|---|
| F1 | Wallet home | App goes to background | — |
| F2 | `+` menu open | Menu closes, app stays | Should close now (patch 26) — exit = regression |
| F3 | Settings sheet open | Sheet closes | Exit = regression (patch 26) |
| F4 | Card detail / preview sheet open | Sheet closes | Exit = regression (patch 26) |
| F5 | Camera sheet open | Camera closes, wallet stays | Exit = regression; also confirm the preview stops |
| F6 | Crop view open | Back to capture, no half-saved card | Should return to capture; a half-saved card is a regression |
| F7 | Predictive back gesture (Android 14+) | No flicker, no black frame | The handler is `popstate`-based, so it is predictive-back compatible by construction - look for a double-close (the sheet closes, then the app exits), which would mean the entry was popped twice |
| F8 | Search field open, keyboard up | Back closes the keyboard first, then the sheet | If the whole sheet vanishes with the keyboard still up, note the OEM/WebView |
| F9 | Wallet home (nothing open) | App backgrounds; **must not** close a sheet that is not there | A second Back press must never leave a phantom history entry |
| F10 | Editor open with an unsaved edit | Patch 26 keeps the edit: Back closes the sheet and the card is *not* written | Confirm nothing half-written appears in the deck |

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

## R. Premium settings: glass sheet, Custom Pouch, live preview (patches 18 + 19 + 20)

The whole point of this round is that a control in Settings and the wallet on screen are the
same state. Each row below therefore asks for the *pair*: what the sheet looks like, and what
the wallet does right after.

| # | Step | Expected |
|---|---|---|
| R1 | Open Settings (light theme) and scroll inside the sheet | The panel is frosted glass: the wallet's cards are visibly blurred *through* it and stay blurred while you scroll - no opaque grey rectangle. Text over it stays crisp and readable, including over a light-coloured pouch |
| R2 | Same, in dark theme (Settings -> Appearance -> Dark) | The glass goes dark instead of white, hairlines and text stay legible, no halo or grey smudge around the panel edges |
| R3 | Read the headings and rows | `Settings` is the biggest line, `Design` / `Layout` / `Cards` / `Appearance` are medium-bold black (not grey, not uppercase), row text is normal size. Nothing is wrapped in a full-width blue button - chips, dots, sliders and switches only |
| R4 | System setting "Remove animations"/reduced-transparency on, or Accessibility -> reduce transparency if the phone has it | The sheet falls back to a solid panel and remains fully usable (no unreadable translucency, no invisible text) |
| R5 | Settings -> Custom Pouch | Everything for the pouch is on this one screen: Design (material, colour, background, border, radius, shadow, grading, grain, stitching, name) then Layout (carousel/stack, Wallet & cover, size, spacing, stack style). No "next screen", no explanatory paragraphs |
| R6 | With the preview visible at the top, tap a colour dot, then drag Radius and Background | The 3D cards inside the preview change in the same instant - colour, corner radius and gradient - and you never have to close the sheet to check |
| R7 | Now close Settings and look at the real wallet | The real pouch matches the preview exactly: same colour, same corner radius, same gradient darkness. If the preview moved and the wallet did not, that is a fail (this is what patch 20 is for) |
| R8 | Layout group: switch Stack style Flat -> Fan -> Deck, and drag Spacing | The real row spreads/stacks accordingly, in Stack view as well as the carousel. Sliders must stay reachable while the row keeps animating - no dropped frames while dragging |
| R9 | Size down to ~85% and Radius up to ~150%, then kill the app and reopen | The pouch stays smaller and rounder after relaunch (values are stored in `wallet.settings.v1`); nothing clipped or overlapping the header or the bottom edge |
| R10 | Shadow to 0% and Border to None, then turn Wallet & cover off and on | Shadows disappear from the card and the cover panel; the fold animation still plays and still looks like the old one, just without the drop shadow. Bring them back: identical to before |
| R11 | Cards row: tap one card chip, then leave Settings | Only the *preview* narrows to that card. Your actual wallet still has every card, in the same order, and the selected one did not change |
| R12 | Existing interactions: tap a Stack card to eject it, swipe the carousel, open a card, flip it | All behave exactly as before (this round touched geometry only at rest). The tapped card still lifts in place, the row still auto-settles, the flap still folds |
| R13 | Small screen (360dp) and landscape, then a tablet if available | The sheet fits without horizontal scroll, sliders and dots stay tappable (nothing under the thumb or the notch), and the preview scales instead of clipping |

If R7 fails, note which control: the theme fields (colour/background/border/radius/shadow/
material/grading) all go through `ad()`/`__cwTune`, geometry (size/spacing/radius) through
`xd()`/`Sd()`, and the sleeve texture through `pd()` - so one failing row tells us which of the
three plumbing paths to look at.

---

## S. Compact sheet, view-specific Layout, smooth sliders (patches 21 + 22)

| # | Step | Expected |
|---|---|---|
| S1 | Settings -> look at the whole panel | Count the buttons: Slate/Classic, Carousel/Stack, System/Light/Dark (plus Flat/Fan/Deck only when Stack is selected). No card-name chips, no Matte/Satin/Gloss row, no Border row - those two are sliders (`Sheen`, `Edge`) now |
| S2 | Layout: tap **Stack** | Under the segment a `Stack` label appears with `Wallet & cover`, `Size`, `Spread` and `Flat/Fan/Deck`, and the preview at the top becomes the stacked deck. Tap **Carousel** and `Fan`/`Spread` go away, `Spacing` returns |
| S3 | With the preview visible, tap **Stack** | The stack is actually *drawn* in the preview box - two or three pouches fanned - not an empty glass rectangle, and not clipped past the box |
| S4 | Drag **Radius** (or Shadow / Sheen / Edge) slowly end to end | The thumb follows the finger with no back-step and no stutter; the percentage on the right changes without the row's width jogging; the tray corners grow smoothly. Release mid-way: the value stays where you left it |
| S5 | Drag **Size** or **Spread** quickly back and forth | No visible frame drops on the wallet behind the sheet (this is the row that used to repaint a canvas per step). If the whole app hitches while only the sheet's slider moves, that is a fail - note the device |
| S6 | Drag a slider inside the scrolling sheet | The sheet must not scroll under the thumb (`touch-action:none` on the input), and lifting mid-drag must settle on the last value, not jump back |
| S7 | Look at the header's **+** button | Slightly smaller than before (40px box, 21px glyph), still comfortably tappable, disc and glyph centred; the add menu opens exactly as before |
| S8 | Change a few controls, close Settings, kill the app, reopen | Every value is still applied (radius / sheen / edge / fan / spacing / size / view). Nothing reverts, and the number of stored writes was small (one commit per frame while dragging) |
| S9 | Existing interactions after all this | Tap a Stack card to eject, swipe the carousel, open a card, flip it - unchanged. The empty bands above/below the pouch row stay inert (patch 14/15 rules still hold) |
| S10 | Dark theme with the new sliders | Track, thumb and read-out stay legible; the filled part of the track is still visible against the frosted panel |
| S11 | Landscape and 360dp | The preview box and both views fit; the stack preview does not overlap `Design`; every slider stays reachable and none of the four chip rows wraps into the next |

If S4/S5 fail, note *which* control and whether the stutter is in the sheet or in the wallet behind
it: sheet-only stutter means the local drag state is not holding (React snapping the input back to
the committed value), wallet stutter means the canvas signature `__cwSig` is quantizing too finely.
---

## T. Round 12 - two independent layout modes, a staged preview, ramped sliders (patches 23 + 24)

The point of this round is that Stack and Carousel are configured *apart*, so most of these rows
are "does it stay put" checks. Numbers in brackets are the shipped defaults.

| # | What to do | What must happen |
|---|---|---|
| T1 | Settings -> Layout: Stack. Move `Card overlap`, `Vertical offset`, `Scale`, `Rotation`, `Visible cards`, `Spacing` one at a time, then switch to Carousel | Every stack slider changes the stacked deck (x step, a vertical step, card size, per-card 3D turn, how many cards stay opaque, extra px). Switching to Carousel shows the carousel's five rows and **none of the stack values moved the carousel row**: same spacing, scale, side dim, peek and position as before |
| T2 | Now the other way: on Carousel set `Card spacing` 44px, `Scale` 114%, `Side cards` to Hidden, `Peek amount` 150%, `Position` fully Left. Go back to Stack | The carousel row reflects all five; the stack looks exactly as it did before, and `custom.stack` in the wallet is untouched (Settings -> reopen shows the same six values) |
| T3 | Kill the app and reopen | Both views keep their own numbers side by side (they are separate objects in `wallet.settings.v1`) - `stack.overlap` and `carousel.size` are not the same field any more |
| T4 | Open Settings on a wallet with **one** card | The preview still shows a real stack of at least three cards (six in Stack view), built by the same card components - no screenshot, no empty box. `Visible cards` 3 -> 6 visibly adds cards on stage |
| T5 | Drag any slider slowly, watch the wallet *behind* the sheet | It glides to the value while the finger is still moving: no stepping, no hitch, and the row's own number/thumb never jumps back. Release and the value lands exactly on where you left it (e.g. `Radius` 147% -> the pouch corner is 147% of its default) |
| T6 | Flick a slider far in one jump (e.g. `Card spacing` 20 -> 44px) and release immediately | The row shows 44 at once, the wallet arrives at 44 within a few frames and then stops (no drift, no further repaint loop, no battery tick) |
| T7 | Swipe the carousel and tap-eject a Stack card while Settings is open behind | The gestures still feel like before: short springs, eject in place. The ramp is only in the sheet's writer, so nothing in the card path animates that used to snap |
| T8 | Count the controls in the sheet | 7 chip buttons (Slate/Classic, Carousel/Stack, System/Light/Dark), 2 switches, the colour row, 18 sliders and Done - no `Flat/Fan/Deck` chips, no `Spread`, no `Size` row that both views share |
| T9 | Update from an older build (install over the previous round's data, or paste an old `wallet.settings.v1`) | Old `size`/`gap` values are folded into both views once and the wallet looks like it did before this round; a Fan-preset deck keeps its spread/rotation |
| T10 | Header: tap the `+` create button (now 36px, 19px glyph) with a thumb | Comfortable to hit and centred, disc and glyph still aligned with the search/hamburger icons; the menu opens as before. If it feels too small, say so - this is the second round of shrinking it |

If T1 or T2 fails, capture `wallet.settings.v1` (Settings are stored as one JSON object) - the two
`custom.stack` / `custom.carousel` objects should be independent; a value appearing in both means the
sheet wrote the wrong namespace, and a value in the right namespace with no visual change means the
geometry hook is not recomputing (`Sd`'s dependency list).


---

## U. Round 13 - the stack preview finally fills its box (patch 25)

The stage the preview mounts used to have no height of its own, so the cards existed but were
clipped away. These rows are about seeing them.

| # | What to do | What must happen |
|---|---|---|
| U1 | Open Settings on a wallet with a few cards; look at the preview under `Custom Pouch` | Cards are actually painted in that glass box - not an empty rectangle. In Carousel view you see the row of cards; tap `Stack` in Layout and the same box instantly shows a stacked deck |
| U2 | On Stack view, drag `Card overlap`, `Visible cards`, `Vertical offset`, `Rotation` | The stack *inside the preview* changes with your finger - wider/narrower fan, more/fewer cards, a vertical step, more turn. Same behaviour in the wallet behind the sheet |
| U3 | Close Settings and swipe / tap-eject in the wallet's own stack | Unchanged from previous rounds: full-size stack, drag and eject still work, no card clipped or shifted by the preview fix (the wallet gets no `fit` box, so its stage still sizes from the viewport) |
| U4 | Now do it on a wallet with exactly **one** card | The preview still shows a full stack (real card + stand-ins, each with its own colour and artwork loaded - no grey placeholder squares), while the wallet behind shows the single real card |

If U1 is still an empty box on a device, the thing to read is the stage element's inline style in the
WebView inspector (`chrome://inspect`): it must carry `width: 388px; height: 302px`. Without them the
`fit` prop is not reaching `__cwStack`, which is a different bug from the one patch 25 fixed.

---

## V. Round 14 - production QA pass fixes (patches 26-29)  ⚠ the device half of this pass

These four rows are the parts of the QA pass that jsdom could not settle. Each one
maps to a finding in `docs/QA_HANDOVER_REPORT.md`.

| # | Check | Expected | Finding |
|---|---|---|---|
| V1 | Import a HEIC / a Google-Photos *cloud-only* item / a 0-byte file from the gallery picker | Each failure shows "Could not read that image - try another photo" (or "1 of 3 added - the rest could not be read" for a partial batch), and a failed *replace photo* keeps the old image with its own toast | QA-4 (patch 28) - before the fix, the tap did nothing at all |
| V2 | With the deck holding 8+ photo cards, add and edit cards until storage is full | The "No room left on the phone" toast appears, nothing is lost; note the card count where it starts | QA/PERFORMANCE-1 - `localStorage` is the photo store; measure the real ceiling (browser engines vary: 5-10 MB) |
| V3 | Settings → Card layout: on **Stack** push Size and Spacing to maximum, then open **Carousel** | Carousel shows its own untouched values, deck renders normally, no giant/zero-size cards, and returning to Stack restores the extremes | QA-2 (patch 27) - the clamp table is per-namespace; a legacy numeric `custom.stack` must still move the fan |
| V4 | Cold start, then `adb shell pm clear` style fresh install, launch, kill from Recents, relaunch × 5 | No card is ever missing from the deck that was there before the kill; a card without a photo still shows its title | QA-3 (patch 27) - the loader used to drop src-less cards and rewrite them out |
| V5 | Long-press a stacked card → **Send to WhatsApp**, then **Save to gallery** | Share sheet opens (Web Share on 30+) and the image lands in the gallery. It must **not** silently do nothing. If WhatsApp does not receive a pre-filled message, that is the missing native `CardIO` plugin, not a JS bug | QA-5 (patch 29) - the plugin is absent from this build; the fix makes the call non-fatal and falls back |
| V6 | Add-details editor: check the field list on a phone | No **CVV** chip in the suggestion row, and no stored card carries a CVV field. "no CVV, no PIN" copy must still be visible | QA-8 (patch 29) - PCI DSS forbids retaining a security code; storage here is plain `localStorage` |
| V7 | Screenshot the wallet and check the Recents thumbnail | Decide: card images are visible unless the client adds `FLAG_SECURE` in native code | SECURITY-1 - not fixable from the web payload |
| V8 | Small phone (360x640 / 320x568 if you can emulate or find one) and 200 % font scale in system settings | Nothing clipped or off-screen, tap targets still reachable, deck still shows ≥3 cards, no horizontal scroll | QA §19 - jsdom has no layout engine, so this whole class is device-only |
| V9 | Rotate portrait ↔ landscape with a card editor open and a photo mid-crop | The activity is not recreated (`configChanges` covers orientation), the edit is still there, and the landscape layout uses its own geometry | QA §20 |
| V10 | Tap into the Card number / Notes field with the keyboard up | The focused field stays visible above the keyboard, the sheet scrolls, and Save is still reachable. If the keyboard covers it, that is RELEASE-4 (no `windowSoftInputMode`) | QA §18 - needs the manifest attribute added in the native project |
| V11 | Drag every slider full-range for ~30 s, then leave the wallet on Screen | No jank, no catch-up burst after release, no battery/thermal drama; `adb shell dumpsys meminfo com.arena.cardwallet` before/after a 20-card session should be flat | QA §21/§16 - PERFORMANCE-1/2 measured the JS side only |
| V12 | Blur and type check: Settings sheet over the wallet, `Wallet` wordmark, headings | Glass reads as glass (not a flat panel), no banding, headings visibly bolder than body, no text touching a card edge | QA §14 - judgement calls excluded by rule here |
| V13 | Delete a **middle** card and the **last** card by swiping the deck, and long-press vs tap on a blurred cover | Exactly one card goes, the deck re-centres, remaining ids untouched | QA §6 - synthetic drags through the spring physics are not honest in jsdom |
| V14 | TalkBack on: focus the create button, a slider, a card | Each announces its label and value; sliders are adjustable with volume keys or the TalkBack gesture | QA §14, MINOR-4 (zoom lock) |

## W. Round 15 - Liquid Glass (patch 30 + stylesheet)  ⚠ visual + performance half

The material is verified numerically here (tier rules, blur budget, WCAG contrast through the glass
in both themes) and `docs/liquid-glass-preview.svg` shows the composite the tokens describe - but a
browser compositor is not involved in any of that, so these rows are what actually close the round.

| # | Check | Expected | Watch for |
|---|---|---|---|
| W1 | Open Settings with a **bright** photo card and a **dark** card in the deck, one after the other | The sheet tints slightly differently over each, its text stays crisp in both, and captions never wash out | Text that disappears when a white card sits behind the sheet (the class of bug the audit caught at 1.05:1) |
| W2 | Drag `Card overlap` / `Visible cards` / `Background` full range with the sheet open | 60 fps, no catch-up burst after release, no shimmer on the rim | Nested-blur jank - the build caps the app at 4 blurred selectors; if a device still stutters, the tier-1 blur radius is the first dial to lower |
| W3 | Long-press a card on a glass cover, then open the card sheet over it | The sheet's blur does not double up with the cover's frosted layer; no flicker on the rim | Two stacked backdrop-filters recompositing per frame |
| W4 | Create disc on a light wallpaper vs a dark one, and in dark mode | Glyph stays high contrast (measured 10.2:1 light / 13.0:1 dark through pure black/white), disc reads as glass, not as a flat chip | A disc that turns invisible on one theme, or a white halo (the rim must stay a hair line) |
| W5 | Android 6/7 device (or a WebView without `backdrop-filter`) | Sheets and the disc fall back to **opaque** fills, everything still readable | Translucent panels with no blur = the failure mode `@supports not (...)` prevents |
| W6 | System settings: "Reduce transparency" ON, and "Reduce motion" ON | Transparency tiers drop to solid fills; the press scale and cross-fade stop | The media queries not covering a tier |
| W7 | Rotate with the sheet open, then scroll the sheet to the Custom Pouch tray | The recessed tray keeps its depth (no banding on the sheen), preview cards stay fully opaque inside the glass frame | Glass over the cards themselves - the brief forbids it, and `[data-cwc]` must carry no glass class |
| W8 | Camera sheet open (tier 1 + scrim + live camera) for 60 s | No thermal/frame drop beyond the camera's own cost; leaving the sheet returns the frame budget to idle | Blur + camera stream compositing together |
| W9 | Screenshot / screen-record the sheet over a card | Material looks like glass in the still (blur + sheen visible), not grey film | A compositor that renders `backdrop-filter` as nothing at all on that GPU |

---

## X. Round 16 - the footer dock (patch 31 + stylesheet)  ⚠ the dock is a live-composited surface

The layout, the safe-area arithmetic and the material tokens are all measured in code (smoke 237/237,
QA group 33 28/28, `liquid_glass_audit.py` 72/72). What no environment here can decide is how a
blurred pill floating over a scrolling deck *looks and feels* on real glass. Section **W** still
applies to every glass surface; these rows are the dock specifically.

| # | Check | Expected |
|---|-------|----------|
| X1 | Open the wallet, scroll the deck under the dock slowly, then flick it fast | The cards smear softly through the blur and re-emerge cleanly; the pill's rim and top sheen stay visible; no flicker, no rectangle of stale pixels, no frame drop while it scrolls. |
| X2 | Install on a gesture-nav device (inset > 0) and a 3-button device (inset 0); note the gap below the pill | Gap under the pill = system inset + 10px in both cases; the pill never sits under the home indicator or the button bar, and it stays centred (max 520px) on a tablet/foldable rather than stretching edge to edge. |
| X3 | Last-card clearance in both modes | With Stack and with Carousel, the last card of a long deck is fully readable above the dock, and the same holds in landscape and after rotating mid-list. |
| X4 | Target and menu ergonomics on a 5-inch phone | Three 36px controls in a ~123px pill are pressable without mis-taps (test Create → Search → More in sequence); the More menu opens **upward** from the pill with both rows fully visible, and tapping outside closes it (this relies on the container `ref:d` that the restructure deliberately keeps as the dock's ancestor - the one behaviour a restructure could silently break). |
| X5 | Cost of the extra blurred surface | Open Settings/the camera sheet over the dock and watch for the drop the double-blur could cause (dock + scrim + panel are blurred at once); also eject a card so it animates *under* the dock - the dock must not stutter during the spring. |
| X6 | Degradation and contrast | Light/dark theme flip re-colours the pill and its controls (no rgba baked in); with system "reduce transparency" the blur and sheen drop out; on an Android 6-9 WebView the pill falls back to the opaque `--sheet` colour and is still distinguishable from a light card, and captions/labels over the dock's tint stay readable over both a white and a black card face (measured 5.21:1 light / 6.29:1 dark worst case). |

Record: device, Android version, WebView version, and result per row. Anything that fails is filed with
the row id (e.g. "X4: menu clipped above the pill on 4.7-inch").

---

## Y. Round 17 - Settings sheet's lighter blur + the dock on the header's old x (patch 32)  ⚠ the feel half

Everything measurable here is measured: the audit pins 14px on the sheet, the no-blur scrim, the 4-selector
budget and the mirrored row string (79/79), and QA counts at most 2 blurred surfaces with Settings open.
What only a phone can answer is whether it now *feels* fast and still looks like glass.

| # | Check | Expected |
|---|-------|----------|
| Y1 | Open and close Settings ten times in a row, and drag a slider while it is open | No hitch on the slide-in spring and no stutter while dragging (this is the round-17 ask: it used to feel laggy). Compare against `CardWallet_footer_dock.apk` on the same device if in doubt. |
| Y2 | Read the sheet over a bright photo card and over a black card, in both themes | At 14px the deck shows through a little more of its structure - the text and read-outs must still be comfortably legible (measured through the tint: 9.41:1 body / 5.21:1 captions light, 9.67 / 6.29 dark) and the sheet must not look "open" or noisy. |
| Y3 | Watch the scrim area (the wallet behind the sheet) | Pure dim, no smearing. If the un-blurred deck behind the sheet reads as distracting on a small screen, that is a design call to file, not a bug - the blur was removed for a measured cost. |
| Y4 | Place a thumb at the bottom of the screen | Create / Search / More sit where they used to be under the header in x (right edge of the 520px column, 8px inset), so the reach is the same trio, mirrored. On a tablet/foldable the pill must still hug the *right edge of the centred column*, not the screen edge. |
| Y5 | Tap More, then tap outside | The menu opens upward from the pill's right edge, both rows visible, and outside-tap dismissal still works after the restructure (the `ref:d` container is unchanged). |
| Y6 | Regression: scroll a long deck under the pill, eject a card so it passes under it, then flip the theme | The pill keeps floating and re-colours correctly (no rgba baked in); on Android 6-9 WebViews the sheet falls back to the opaque `--sheet` and the scrim to a plain dim - both must stay visible. |

Record: device, Android + WebView version, and per-row result; file a failure with the row id (e.g. "Y2:
captions hard to read over a photo card in light mode").

## Z. Round 18 - the 4-digit lock and the `.cwbak` backup file (patch 33)  ⚠ the only way to test the lock honestly

Nothing here can be cleared in jsdom: the soft keyboard, the Share sheet, Drive, a real cold start and a
fresh install are all device-only. Work top to bottom - **Z1 must be done before anything else**, because a
misbehaving gate is a lock-out, not a cosmetic bug.

| # | Do this | Expect |
|---|---------|--------|
| Z1 | Settings -> Lock & backup -> turn the switch on, type a 4-digit code, re-type it. Then kill the app from Recents and reopen. | The code is asked for **before any card is visible** on the next launch; `Wallet` title and 4 digit boxes, one box focused, no blur behind the gate (it is opaque by design). The keyboard must not cover the boxes or the Confirm button on a small phone with the nav bar showing. |
| Z2 | Type one digit, then a letter, then the rest. | Non-digits are stripped, boxes auto-advance, nothing submits before the 4th digit, and nothing is written to storage while incomplete. Paste a 4-digit code from another app: all four boxes fill at once and the step submits. |
| Z3 | Unlock, open the pouch, then press Home and stay away ~5 s vs ~35 s. | 5 s: the wallet is exactly where you left it. 35 s: the gate is up again, deck untouched. Lock rotates the phone while backgrounded and on return - no stuck keyboard, no half-drawn sheet. |
| Z4 | Enter 5 wrong codes. | Codes 1-4 say "Wrong code - try again" and clear the boxes; the 5th starts a **30 s** cool-down with the boxes disabled and the countdown ticking in the message. Background the app for a minute during a cool-down: it keeps counting against real time (no reset by hiding the app). |
| Z5 | While cooled down, tap Reset app once, then again. | First tap arms it and re-labels itself "Tap again - this erases every card and setting"; second tap erases and reloads to an empty wallet. It does not arm itself before a cool-down has ended (no reset while the boxes are disabled). Back/swipe-to-dismiss must not close the gate, and while the gate is up Back never exits the app. |
| Z6 | Settings -> Back up now. Set a password, then a second one that differs. | Mismatch is refused before a file exists. Then: the Android Share sheet opens with **cardwallet-backup-YYYY-MM-DD.cwbak** attached. Save it to Drive *and* to Files; on a WebView where sharing is unavailable the same button falls back to a download. Check the file's size for a deck of 20 photo cards - it is roughly the deck's own size (RELEASE-2). |
| Z7 | Uninstall the app, reinstall, import that file (Restore a file), wrong password first, then right one. | Wrong password: refused, nothing touched. Right one: it states how many cards will replace how many, then the deck and the design settings come back and the lock is **off** on this install (the code never leaves the phone). Cards, pouch colour, stack/carousel settings and per-card colour all match the pre-uninstall state. |
| Z8 | Import something that is not a backup: a renamed photo, a plain `.json` of the deck, a `.cwbak` from another app. | Each refused with a real reason ("Backups are always encrypted" for a file with no sealed block), never a partial restore and never a plaintext file written out. Fill the phone's storage (or a 20-card deck on a near-full device) and restore: if the write cannot fit, the current deck stays intact with an explicit message. |
| Z9 | Android 6-9 / old WebView device, or any build where `crypto.subtle` is unavailable. | The lock enrols and unlocks (its digest is computed in JS by design). Back up: it refuses with "This device's browser can't encrypt - backup needs Android System WebView updates" and **stops** - no plaintext file anywhere, and the card must not claim a backup exists ("No backup yet."). |
| Z10 | Recents, right after Z3's 35 s trip. | The task thumbnail shows the **lock gate**, not card photos. This narrows SECURITY-1's exposure; it does not close it (no `FLAG_SECURE` in this build, so a screenshot while unlocked still captures the deck). |
| Z11 | Time a cold start with a code enrolled on the oldest phone you have, three times, next to the same app with no code. | The gate must not add a visible delay to first paint - the 600-round digest is deliberately cheap. If it does (jank while the boxes draw, or the gate appearing after the deck), that is a defect to file, not a taste call. |
| Z12 | With the new card present: open Settings, drag every slider, flip the theme, scroll the sheet to the bottom and back. | The sheet still behaves like round 17 (one blur pass at 14px, no new lag), the Lock & backup card sits inside the same column, its switch and buttons are legible in light **and** dark, and the "Reset app"/danger copy uses the `--danger` token colour (not a grey that looks disabled). |

Record per row: device, Android + WebView version, result. File a failure with the row id (e.g. "Z4:
cool-down resets when the app is hidden"). Two rows are hard gates for handover - **Z1** and **Z7**: an app
that can lock a user out, or a backup that cannot be restored, is worse than no feature.


## AA. Round 19 - the customization gate (patch 34 + stylesheet)  ⚠ this is the first control that *hides* UI - prove it reveals again

The gate's logic is fully covered in jsdom (28 QA checks: default off, one tap on, `display:none` while off,
auto-off on close/background, zero writes, values kept). What jsdom cannot show is whether a real phone
*renders and receives touch* the way the mechanism assumes: `display:none` on a wrapper, a 400 ms containment
poll, and a switch inside a sheet that framer-motion is animating. Work top to bottom - **AA1 and AA3 are
handover gates**.

| # | Do this | Expect |
|---|---------|--------|
| AA1 | Fresh install (or `adb install -r` after uninstalling). Settings → Custom Pouch. | The switch row "Customize cards" sits at the top of the pouch card, and **no** colour row, cover control or slider is visible below it. Toggle it on: the controls appear **immediately, with no reload, no flicker of the deck, and no sheet re-open**. Toggle off: they are gone again. Nothing about the wallet behind the sheet changes in either state. |
| AA2 | While the gate is on, drag every slider (Stack: overlap / offset / scale / rotation / visible / spacing; Carousel: spacing / scale / side / peek / position) and tap every colour and cover control. | Every control behaves exactly as it did before round 19 - live value on the finger, the deck and the preview both moving, the glide landing on the value. The values are written the moment you release, and the sheet's scroll must not swallow the drag near the switch row. |
| AA3 | With the gate on, close Settings (Done, swipe down, or Android Back). Reopen Settings. | On close the gate **shuts by itself**: reopening shows the switch off and the controls hidden again. There is no state in which Settings opens with the controls available without the switch being on - and no visible delay or jump when the block is removed. |
| AA4 | Gate on, then: press Home, pull the notification shade down and leave it, open the camera switch, switch to another app for 5 s and for 60 s, each time returning with Settings still open. | Returning from a quick shade peek leaves the gate as it was **only if the app never went to the background**; a real background trip closes it. No crash, no blank sheet, and the sliders you had dragged keep their values. |
| AA5 | Rotate the phone (or fold/unfold, or resize on a tablet) with the gate open mid-drag; then rotate after closing. | The process of recreating the activity resets the gate to off (by design - nothing is persisted), the deck keeps every value, and the switch row is drawn once, never twice, after the rotate. |
| AA6 | Kill the app from Recents while the gate is on, relaunch. Then do it again with a code enrolled in round 18's lock. | After relaunch the gate is off (no stale "on"). With the lock enrolled: the 4-digit gate first, then the wallet, and Settings still opens with customization closed. The two features must not stack controls or fight over the sheet. |
| AA7 | Turn the gate on and off with TalkBack (and with a Bluetooth keyboard if available: Tab to the switch, Space). | The row is announced as "Customize cards, switch, on/off" - one control, not a group of buttons; the hidden block is absent from the accessibility tree while off (a slider must not be reachable by swipe-and-double-tap behind a closed gate), and focus does not get stranded when the block disappears under the focus. |
| AA8 | Frame pacing: on the oldest/lowest-spec phone you have, open Settings and toggle the switch 10 times fast; then open with the gate off and scroll. | Toggling costs one style recalculation - no blur readback (the gate adds no `backdrop-filter` anywhere), no sheet jank, no 100 ms freeze on the first reveal. Compare with round 17's rule: the sheet still blurs once at 14px. If a toggle feels slower than the theme switch, that is a defect to file. |
| AA9 | Android 6-9 / a WebView without `backdrop-filter` support, and a device in each theme (light and dark) at 320-430 px width. | The switch row is legible and correctly sized in both themes (it reuses the vault row's tokens, so it must match the "Lock & backup" card exactly) and the row does not clip or wrap the caption into the toggle at the narrowest width. |
| AA10 | Read the copy out loud and compare it to what the build does. | "Turn on to change card colours, the cover and how the deck is arranged. It switches off by itself when you close Settings." must be literally true - if a future change persists the switch, or gates more than the pouch's look, the copy is wrong and both need updating. This feature is a **guard on editing, not protection of data**: nothing in this round changes what is stored or how. |

Record per row: device, Android + WebView version, result. Two failures are product-blocking: **AA1**
(the switch does not actually gate the controls on a real screen) and **AA3** (the gate stays open after
Settings closes, or opens already-on, which is the exact behaviour that was asked to be impossible).

## AB. Round 20 - the card preview's Back control (patch 35)  ⚠ the control's *existence* is device-only

jsdom proves the behaviour (20 QA checks + 14 smoke checks): the button is there while the preview is
open, it is 44×44 and inside the safe area, tapping it closes the preview, the preview pushes exactly
one history entry, `history.back()` closes it, and no stored card changes. What jsdom cannot prove is
that a **finger finds it** and that Android's **Back key/gesture actually reaches `popstate`** in this
Capacitor shell - that second question is the same one patch 26 has carried since round 14, and it is
what decides whether this screen used to exit the app for real. **AB1 and AB2 are handover gates.**

| # | Do this | Expect |
|---|---------|--------|
| AB1 | Tap a card in the wallet (both layouts: Carousel pouch and Stack) to open the full-screen preview on a real screen, in light and dark theme. | A 44 px dark disc with a white chevron-back sits in the **top-left**, clear of the status bar and of the notch/cutout (it is offset by `env(safe-area-inset-top)`), never under the card, never dimmed to invisibility by the preview's near-opaque backdrop. On a portrait card (a CNIC photo) it must still be visible and tappable above the card's top-left corner. |
| AB2 | With the preview open, press the **system Back key** (and on Android 13+ the **predictive-back gesture** from the screen edge). | The preview closes and the wallet is exactly where it was - front card unchanged, no reload, no toast. **The app must not exit.** Repeat from Settings, the card editor and the long-press sheet: each Back closes one surface at a time, topmost first. |
| AB3 | Tap the chevron. Then reopen and tap the empty backdrop. Then reopen and swipe the card down. Compare the three. | One behaviour, three routes: the same close animation, the same resting deck, no second close, no flicker of a re-opened sheet, and the front card is the one that was open. |
| AB4 | Open the preview → chevron → immediately open it again → chevron, 10× in a row; then open the preview, press Back, and press Back **once more** on the wallet. | No accumulating history entries: Back inside the wallet does nothing (it must not close the wallet or blank the deck), and the app never ends up with a stale entry that costs a second Back press to leave. If the app exits on the second Back at the wallet, that is normal Android behaviour, not a defect. |
| AB5 | Open the preview, then rotate the phone (or fold/unfold) mid-view; then rotate with the preview closed. | The control is drawn once, in the same place, after the re-create - no duplicate button, no button stranded inside the rotated card. The preview either survives the rotation or closes cleanly; both are acceptable, a half-drawn disc is not. |
| AB6 | TalkBack on: sweep to the top-left of the preview screen; then a fat-finger test with the thumb while holding the phone one-handed. | The control is announced as a **button, "Back"**, is reachable by swipe before the WhatsApp/Save pills, and the glyph itself is not announced separately. A thumb should hit it without looking - if the 44 px target feels small in one-handed use, that is a finding to report rather than a silent change. |
| AB7 | Frame pacing on the lowest-spec phone: open the preview 5× and watch the disc's entrance; then open it on Android 6-9 (WebView without `backdrop-filter`). | The disc fades/slides in with the pills and costs nothing measurable (no `backdrop-filter` on it, only `opacity`/`y`), and on an old WebView it looks identical to the new one - this control shares the Save pill's flat fill, not the glass tiers. |

Record per row: device, Android + WebView version, result. Two failures are product-blocking: **AB1**
(a way out that cannot be seen or hit is not a way out) and **AB2** (the Back key still finishing the
activity from the preview, which is the defect this round exists to fix).

## Sign-off

The build may only be called production-ready once **A–Z are green** on at least
one physical device, and once the release-signed build has been produced and put
through the same list (`docs/QA_HANDOVER_REPORT.md` §5 lists what cannot be
cleared in the development environment at all — right now that includes release
signing, NFC, the soft keyboard, rotation rendering and every smoothness/judgement
call). Record device model, Android version and result per row, and file anything
that fails with the section id (e.g. "F3 fails: Back exits the app with Settings
open"). The Android UI-testable layer is complete and green: `qa_feature_suite.mjs`
231/231 (group 33 covers the Liquid Glass material, the round-16 footer dock and the round-17 blur
budget; group 34 the lock and the backup file, including a Node re-derivation of the PIN digest and an
AES-GCM round-trip of a real `.cwbak`), `smoke_test_webview.mjs` 239/239, `liquid_glass_audit.py` 96/96
(tier rules, the cost model, the WCAG contrast engine and the round-18 gate's opacity/token rules),
`verify_release.py` 28/29 with the only FAIL being the deliberate debug signature, and
`apk_content_check.py` 70/70 against the APK itself (the four-blurred-selector budget plus the round-18
copy, store key, crypto markers and the gate's opacity - all read out of the shipped entries, not the tree). The jsdom suites need `jsdom@27` + `cssstyle@4.6.0`; on other pairings 11 checks
fail on *any* bundle because cssstyle does not serialise `backdrop-filter` into the `style` attribute - the
suite reads those through `inlineStyle()` (see README, round 17).
