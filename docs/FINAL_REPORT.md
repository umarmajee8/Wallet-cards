# Final production verification report — Card Wallet

Date: 2026-09-05 · Branch: `arena/01a07196-wallet-cards`
Artifact: `CardWallet_release.apk` (11,652,949 bytes)
SHA-256: `63dbd8b1929fdbcb673a19ebab585c0c723ae41518188ff437e84da0c2233e9a`

---

## Status: ❌ NOT production ready — device verification not executed

**Khulasa (Urdu):** Release signing, `allowBackup` hardening, naya **Wallet &
cover** on/off option aur release APK build — sab mukammal ho gaye. Signed APK
package-level par 26/26 checks aur web layer 50/50 checks pass kar chuki hai. **Lekin kisi bhi asli Android device par ek bhi test nahi
chala** — is environment mein na koi phone hai, na `adb`, na emulator (Google
ke Android SDK endpoints bhi block hain). Camera, NFC, gallery, WhatsApp,
system Back, restart/persistence, naye cover toggle ka asli look aur animation
smoothness sirf asli device par verify ho sakte hain. Aap ne kaha tha ke production-ready status sirf tab dena
jab release signed APK successfully verify ho — signature verify ho chuki hai,
par device testing baqi hai, is liye status abhi **blocked** hai, "ready" nahi.

The signed release APK itself verifies successfully. What is missing is the
entire on-device half of your request, and I am not going to claim it passed.

---

## 1. What was changed

### 1.1 Debug key → production release signing ✅

| | Before | After |
|---|---|---|
| Certificate | `CN=CardWallet Debug, O=CardWallet, C=US` | `CN=Card Wallet, OU=Mobile, O=Card Wallet, C=PK` |
| Key | RSA-2048, self-generated throwaway | RSA-4096, SHA-256, 30-year validity |
| Cert SHA-256 | `19e06220…1f98b619` | `86383a7f…3e436726` |
| Keystore | loose PEM key/cert | PKCS#12 (`keytool`-compatible) |
| Schemes | v1 + v2 + v3 | v1 + v2 + v3 |

- Keystore: `repo_export/signing/release-key.p12`, alias `cardwallet-release`,
  password in `repo_export/signing/release-key-password.txt`.
  Both are **gitignored and never committed**.
- The build script now **refuses to sign** with any certificate whose subject
  contains "Debug", and `verify_release.py` fails the build if the old debug
  fingerprint ever reappears.
- ⚠️ **Back up that keystore outside this workspace.** Losing it means the app
  can never be updated under `com.arena.cardwallet` again.
- ⚠️ Signature change ⇒ the release APK **cannot** install over an existing
  debug-signed build (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Uninstall first.

### 1.2 `allowBackup` review → disabled ✅

`android:allowBackup="true"` → `"false"`, patched directly in the binary
`AndroidManifest.xml` (size-preserving boolean flip) and mirrored in the
readable copy `repo_export/android/AndroidManifest.xml`.

Reasoning: the wallet stores card photos (CNIC, licence, bank cards) and typed
card details in WebView `localStorage` inside the app sandbox. With backup
enabled that data is copied into Google cloud backup and, on older Android
versions, is extractable with `adb backup`. Nothing in the app uses the backup
transport, so disabling costs no functionality.
Accepted trade-off: cards are not carried to a new phone; an explicit in-app
export/import is the right way to add that later.

Also checked while in the manifest: `debuggable` absent ✅, cleartext traffic
not enabled ✅, permission set unchanged (INTERNET, CAMERA, NFC,
WRITE_EXTERNAL_STORAGE≤28, dynamic-receiver) ✅, no exported provider ✅,
`targetSdk 35` ✅.

### 1.3 New feature: "Wallet & cover" on/off switch ✅ (code-verified, device-unverified)

Settings → **Pouch** → *Wallet & cover* (`wallet.settings.v1.cover`, default
`true`). Applied by `repo_export/patches/patch6_cover_toggle.py`, 23 anchored
edits, every one asserted to match exactly once.

Off means:
* **Carousel** — the pouch tray and the leather sleeve are not rendered; the
  card is centred inside the same stage box, so carousel spacing, scroll
  offsets and the title position are untouched.
* **Stack** — the frosted glass cover is not rendered. That cover's animation
  used to signal "card opened", so the hand-off now fires directly instead —
  tested in both layouts (see §2.2).
* **Both** — the card title stops being hard-coded white with a dark shadow and
  uses `var(--ink)`: **black on the light theme, white on the dark theme**.
* The pouch customisation controls (Name, Colour, Grading, Grain, Stitches)
  are hidden while the cover is off, and come back unchanged when it is on.

Installs whose saved settings predate the feature default to the pouch being
on, so nobody's wallet changes appearance on update.

### 1.4 Release APK built ✅

`python3 repo_export/patches/build_release_apk.py` — new, reproducible
pipeline (`apkbuilder.py` + `axml.py`), replacing the old debug-key
`rebuild_apk.py`. Aligns every STORED entry to 4 bytes (zipalign-equivalent),
signs v1+v2+v3, and self-checks the bundle for removed-feature strings.

---

## 2. Tests that were actually run — and where

### 2.1 Release package verification — **26/26 PASS** (build machine)

```
PASS  zip: archive readable, all CRCs valid                             431 entries
PASS  sign: APK Signing Block present
PASS  sign: v1 (JAR) signature files present
PASS  sign: APK Signature Scheme v2 verified
PASS  sign: APK Signature Scheme v3 verified
PASS  sign: exactly one signer certificate
PASS  sign: NOT signed with the old debug key
PASS  sign: signer subject is not a debug cert
PASS  sign: signing key >= 2048 bit                                     bits=4096
PASS  sign: v1 manifest covers every entry                              428 entries
PASS  align: all STORED entries 4-byte aligned
PASS  align: resources.arsc STORED and 4-byte aligned (targetSdk>=30)
PASS  align: no compressed native libs
PASS  manifest: package id unchanged                                    com.arena.cardwallet
PASS  manifest: allowBackup = false
PASS  manifest: debuggable not enabled
PASS  manifest: cleartext traffic not enabled
PASS  manifest: targetSdk >= 34 (Play requirement)                      min=23 target=35
PASS  manifest: permission set unchanged (no new permissions)           5 perms
PASS  manifest: no provider is exported                                 2 providers
PASS  payload: shipped JS bundle == repo_export/app/index.js
PASS  payload: removed feature absent (Auto-detect details)
PASS  payload: removed feature absent (Fill in from picture)
PASS  payload: removed feature absent (Make your own pouch)
PASS  payload: capacitor config present
PASS  payload: dex present
```

Signature verification uses `apksigtool`, an independent implementation from
the one that produced the signature.

### 2.2 Web-layer smoke test — **50/50 PASS** (headless jsdom, **not** a device)

This runs the exact JS bundle that ships inside the APK, in a simulated DOM.
It proves logic and state transitions, **not** rendering or hardware.

```
PASS  fresh install: bundle executes with no uncaught error
PASS  fresh install: React tree mounts into #root
PASS  fresh install: renders the wallet UI (4 demo cards)
PASS  removed feature: 'Auto-detect' not in UI
PASS  removed feature: 'Fill in from picture' not in UI
PASS  removed feature: 'Make your own pouch' not in UI
PASS  feature entry point: gallery/file input present (accept=image/*)
PASS  existing state: bundle boots with pre-existing storage
PASS  existing state: stored card is restored into the UI
PASS  existing state: stored cards survive re-mount (persistence intact)
PASS  existing state: dark appearance from settings applied
PASS  existing state: settings are not clobbered on boot
PASS  resilience: app still renders when localStorage writes fail (quota)
PASS  ui: header actions present (Add / Search / More)
PASS  ui: add-card menu opens with all three capture routes
PASS  ui: NFC entry point present in add menu
PASS  ui: add-card menu dismisses on outside tap (no stuck overlay)
PASS  ui: overflow menu opens (Settings / Delete all cards)
PASS  ui: settings sheet renders every section
PASS  ui: switching layout to Stack persists (settings.view)
PASS  ui: switching layout back to Carousel persists (settings.view)
PASS  ui: settings sheet closes cleanly (no leftover sheet in the DOM)
PASS  ui: wallet is back to the card view after closing the sheet
PASS  ui: no console errors across the whole interaction run
PASS  ui: 'delete all' asks for confirmation before destroying data
PASS  ui: confirming clears the wallet and persists the empty state
PASS  cover ON: carousel draws the pouch
PASS  cover ON: card title stays white over the pouch
PASS  cover: Settings exposes a 'Wallet & cover' switch, on by default
PASS  cover ON: pouch customisation controls are shown
PASS  cover: switch flips to off
PASS  cover OFF: pouch customisation controls are hidden
PASS  cover OFF: subtitle explains the state
PASS  cover: choice persists to wallet.settings.v1
PASS  cover OFF: carousel pouch is gone
PASS  cover OFF: cards themselves still render
PASS  cover OFF: title colour follows the theme (var(--ink))
PASS  cover OFF: dark drop-shadow on the title is dropped
PASS  cover OFF: stack drops the frosted cover
PASS  cover OFF: stack title follows the theme
PASS  cover ON: stack keeps the frosted cover
PASS  cover OFF + dark theme: title is var(--ink) (white on black)
PASS  cover: settings saved before this feature default to pouch ON
PASS  cover OFF: tapping a card still opens the detail sheet (carousel)
PASS  cover OFF: tapping a card still opens the detail sheet (stack)
PASS  cover OFF: no console errors in either open flow
```

### 2.3 Static animation audit — 1 warning, no blockers (build machine)

All motion uses compositor-friendly properties (`x, y, scale, rotate,
opacity`), 18 spring configs all critically-damped or better, `img.decode()`
warm-up before cards animate, overscroll and `touch-action` pinned.

Three animations do drive layout-triggering properties and are the first
places to look if the device pass finds jank:

| Where | Animated property | Better |
|---|---|---|
| Settings toggle knob | `left: 3 → 23` | `x` transform |
| NFC tap ripple | `width/height: 54 → 132` | `scale` |
| Settings accordion | `height: 0 → auto` | fine at this size, watch on low-end |

Also noted: `backdrop-filter` (frosted pouch) is the most GPU-expensive
surface — verify on a mid-range phone, not a flagship.

---

## 3. Tests that did **NOT** run — the remaining blocker

**Zero tests were executed on a physical Android device.** The build
environment has no phone, no `adb`, no emulator, and the Android SDK / JDK
download endpoints are blocked from it, so an emulator could not even be
provisioned — and an emulator still cannot test real NFC hardware, a real
camera sensor, real WhatsApp hand-off, or genuine animation smoothness.

Not verified, all of it required before shipping:

| Area | Status |
|---|---|
| Camera capture, permission flow, torch, release-on-exit | ⛔ not tested |
| Gallery picker, large/HEIC images, cancel path | ⛔ not tested |
| NFC bank-card read, NFC-off handling, error cases | ⛔ not tested |
| WhatsApp share (incl. WhatsApp-missing / W4B) | ⛔ not tested |
| Android system Back in every state | ⛔ not tested (**known risk, below**) |
| App restart, force-stop, reboot, persistence at scale | ⛔ not tested |
| Fresh install vs existing-install upgrade path | ⛔ not tested |
| "Wallet & cover" switch: real look with the pouch hidden, text contrast | ⛔ not tested (plan section K) |
| Animation smoothness: scroll, carousel, stack, sheets | ⛔ not tested |
| `adb backup` refusal after the `allowBackup` change | ⛔ not tested |

The full procedure is written up in **`docs/DEVICE_TEST_PLAN.md`** (sections
A–K, ~70 numbered steps, with install commands and what to watch for).

---

## 4. Issues found

| # | Issue | Severity | Action |
|---|---|---|---|
| 1 | APK signed with a throwaway debug key | High | **Fixed** — RSA-4096 production keystore, v1+v2+v3, debug key blocked by the build gate |
| 2 | `allowBackup="true"` exposed card photos/details to cloud & `adb backup` | High | **Fixed** — set to `false`, verified in the shipped binary manifest |
| 3 | No Back-button handling anywhere: the bundle registers no `backButton`/history handler and the APK ships **zero** Capacitor plugins, so `BridgeActivity` finishes the activity when the WebView can't go back — Back likely closes the whole app even with a sheet/menu/camera open | Medium | **Not fixed — needs device confirmation first.** The correct fix is source-level (`@capacitor/app` backButton listener or a history entry per overlay); this repo only contains the minified bundle, and patching React internals blind, with no device to re-test on, would be worse than the bug. Test F2–F6 in the plan settles it. |
| 4 | Three animations use layout-triggering properties (toggle `left`, ripple `width/height`, accordion `height:auto`) | Low | **Not fixed** — cosmetic, and a blind patch to minified code cannot be visually re-verified here. Convert to transforms if I11–I13 show jank |
| 5 | ~17 MB of Tesseract OCR wasm/traineddata still shipped although auto-detect was removed in patch 5 (the dead code still references it, so the assets can't just be deleted from the APK) | Low | **Not fixed** — drop it in a real source rebuild; would roughly halve the download size |
| 6 | `versionCode` is still `1` | Info | Fine for a first production build; every future update must bump it |
| 7 | `WRITE_EXTERNAL_STORAGE` (maxSdkVersion 28) still declared | Info | Harmless legacy; drop in a source rebuild if save-to-gallery no longer needs it |

Issues fixed during this pass and re-verified: **#1 and #2** — both re-checked
against the final signed artifact by `verify_release.py` (see §2.1), plus the
web bundle re-run in full after the rebuild (§2.2).

---

## 5. What "production ready" needs from here

1. Install `CardWallet_release.apk` on a real phone (uninstall old build first).
2. Work through `docs/DEVICE_TEST_PLAN.md` A–K, on a mid-range **and** a
   high-refresh device.
3. Send me the failures with their section ids. I fix them, rebuild, re-run the
   26-check gate + 28-check smoke suite, and you re-test the affected areas.
4. Only after A–K are green does this build get called production ready.

Until then the honest status is: **release-signed and package-verified, device-unverified.**
