# On-device test plan — CardWallet_release.apk

Everything in this file is **still outstanding**: it requires a physical
Android phone and could not be executed in the build environment (no device,
no `adb`, no emulator — the Android SDK/JDK download endpoints are blocked
there). Nothing in this file has been marked as passed by the build pipeline.

APK under test: `CardWallet_release.apk`
SHA-256: `0b08e0a0a06e84022e0d79a5bc5bea11552a3fb1e6b33d96b05f923e0dcbfbfc`
Signer cert SHA-256: `86383a7f13662e8b55885cb5331341f8db964ad065da074cc360082a3e436726`

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

---

## Sign-off

The build may only be called production-ready once A–J are green on at least
one physical device. Record device model, Android version and result per row,
and file anything that fails with the section id (e.g. "F3 fails: Back exits
the app with Settings open").
