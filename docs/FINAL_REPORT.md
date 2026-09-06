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

---

## 6. Addendum — header options restyled to the mock (patch 7 + 8), 2026-09-05

**Khulasa (Urdu):** Aap ki picture aa gayi, aur header ab usi mutabiq hai —
`+` **kaale disc par safed plus**, aur **search + hamburger (☰) bare kaale icons**
(baghal mein koi chip nahi). Dropdown black panel + white rows hai. Sath hi ab
header options `repo_export/header_options.json` se drive hote hain — kaunsa
button, uska label/icon/fill-bare/colour, aur dropdown ke rows — sab ek JSON file
se; minified JS chhedne ki zaroorat nahi. Test ke liye debug-signed APK bana diya
(production keystore is clone mein gitignored hai).

Artifact: `CardWallet_header_black.apk` (11,648,377 bytes) — **debug-signed, do
not distribute**; install karne se pehle `adb uninstall com.arena.cardwallet`
(current build ke upar update signature mismatch se `INSTALL_FAILED_UPDATE_INCOMPATIBLE`
aayega).
SHA-256: `b2a36df60798bdc801ef51d4c34729c62e390e8995eafdcd8cd036bff155b9fe`

What changed in the bundle:

| | before | after (the mock) |
|---|---|---|
| `+` | `var(--ink)` glyph, `var(--chip)` behind it when open | `#000` disc, white plus at 2.5 stroke, soft drop shadow, 4px halo while its menu is open |
| search | same ink glyph on the page | bare `#000` loupe at 2.3 stroke, 26px, no chip |
| overflow | three vertical dots | **hamburger** — three 2.7-round bars, bare `#000`, 26px |
| dropdown | `var(--sheet)` panel, `var(--ink)` rows | `#0b0b0d` panel, white rows, `#ff453a` destructive row |
| where the options come from | hard-coded `Add card / Search cards / More` + hard-coded rows | generated from `header_options.json` |

Tap targets are unchanged (44px, `h-11 w-11`) for both filled and bare options, so
removing the chip did not shrink the hit area.

Gates re-run on this pass:

- `smoke_test_webview.mjs`: **62/62** (was 50) — the header checks read the JSON
  and assert each option's fill/tone/glyph-size/active-state against it, plus
  that the menu button renders the hamburger path and not the stock dots, and
  that both themes render the configured tones verbatim.
- `verify_release.py`: **28/29** on the debug APK — the single failure is
  `sign: signer subject is not a debug cert`, i.e. the debug key doing its job.
  Three of its checks now compare the shipped bundle against
  `header_options.json`, so a bundle that drifts from the config fails the gate.
- `patch7`/`patch8` re-ran twice → byte-identical output (idempotent);
  `patch8` refuses to write a bundle that does not parse (`node --check`), and
  rejects unknown icons/tones/keys with the valid names listed.
- `animation_audit.py`: 10 checks, 1 warning — the same pre-existing
  layout-property warning, unchanged by this pass.

Known trade-offs, deliberately left as asked:

1. `tone: "black"` is literal. The mock is light-theme; on the **dark** theme the
   app background is `#000`, so the two bare glyphs would be invisible. The
   smoke test asserts the config is honoured in both themes rather than
   "fixed". One word — `"tone": "ink"` — makes them follow the theme.
2. The mock draws the three options with wide, even spacing; the header still
   uses the app's own `gap-1` between them (icons matched, layout not
   re-proportioned). Say the word and it becomes a config field.
3. Still **device-unverified**: real contrast over the pouch/card photos, the
   44px tap feel, and the halo animation can only be judged on hardware
   (`docs/DEVICE_TEST_PLAN.md` section A + I).

---

## 7. First on-device report → dark-theme header fix (2026-09-05)

**Khulasa (Urdu):** Aap ne phone par install karke screenshot bheja — dark theme
mein `+` ka kaala disc kaale background par gum tha aur search/hamburger to bilkul
hi nazar nahi aa rahe the. Yehi woh trade-off tha jo maine §6 mein "design call"
likha tha; device ne saabit kar diya ke yeh bug hai. Ab header app ke apne
theme tokens (`--solid` / `--on-solid` / `--ink`) use karta hai, is liye light
theme mein mock jaisa kaala disc + safed plus hi rahega, aur dark theme mein palat
kar safed disc + kaala plus ho jayega — gayab hona possible hi nahi.

Also: **L5/L6 of `docs/DEVICE_TEST_PLAN.md` are now the regression pair for this**,
and this is the first row of the plan that has actually been executed on hardware.

What changed:

| | before (literal, from the mock) | after (`tone: auto`, default) |
|---|---|---|
| disc fill | `#000` in both themes | `var(--solid)` → `#111113` light, `#fff` dark |
| disc glyph | `#fff` | `var(--on-solid)` → `#fff` light, `#111113` dark |
| bare glyph (search / ☰) | `#000` — **invisible on the dark theme** | `var(--ink)` → `#111113` light, `#f5f5f7` dark |
| active halo | `rgba(17,17,19,.10)` | `var(--chip)` |
| hairline | `rgba(255,255,255,.14)` | `var(--line)` (6% black light / 12% white dark) |

Two deliberate non-inversions, both from the earlier "black background + white
icons" decision: the dropdown stays a black panel with white rows in *both*
themes, and `tone: "black"` / `"white"` remain available when something must not
follow the theme.

Fidelity note: `--solid` is the app's near-black `#111113`, not the pure `#000` of
the mock. On a phone at 23px that is not a visible difference, and it is what the
app's own solid buttons use; say the word if you want literal `#000` on light
(`"tone": "black"`) and accept the dark-theme consequence, or a new token pair in
`index.css` (needs the base APK's CSS entry regenerated).

Gates re-run: smoke **64/64** (was 62) — the two new checks read `index.css`
directly and assert (a) that `--solid`/`--ink` actually invert between the two
theme blocks, so the "auto is meaningful" test cannot pass vacuously, and (b) that
auto-tone options declare tokens rather than literals in the DOM. patch7 now
migrates its own previous output (idempotent, re-run byte-identical), and patch8
refuses to write `tone: "auto"` against an older patch7 that would silently render
the disappearing black disc.

New artifact: `CardWallet_header_black.apk` (11,648,422 bytes), debug-signed,
sha256 `cc63bc965fa301e97b8cd7a43f0d31283636cdfe503377d4222462eeb7f061da`. Signed
with the same throwaway key as the build you already installed, so this one
updates over it (`adb install -r`) — no uninstall, no data loss this time. The
dark theme is the thing to re-check; `docs/DEVICE_TEST_PLAN.md` §L has the full
list. §6's `b2a36df6…` build is superseded by this.
## 8. Pouch preset + add-card pill: built, then reverted on request (2026-09-05)

Round 4 added a **Paper** pouch preset (light felt, dashed seam) matching a
reference mock, plus the mock's wide black **add-card capsule** with the label
removed, and the two repairs that round needed (patch 9: the missing Pouch style
section in `app/index.js`, and the settings loader forcing `theme=slate`).
It was fully gated (smoke 83/83, `verify_release` 28/29, patch chain replayed
byte-identically) and shipped as `9e0852d8…`.

The user tried it on device and asked for it to be removed - *"yeh ajeeb lag rha
ha mujy nhi chhy"* - so `f8cc89c` was reverted and the branch is back to §7's
state: `CardWallet_header_black.apk` = 11,648,422 bytes, sha256 `cc63bc96…`,
which keeps the header/tone work and nothing else.

Two things from that round are still true and worth knowing even though the code
is gone, because they are properties of the bundle, not of my patch:

1. **`repo_export/app/index.js` and `CardWallet_no_pouch.apk` have drifted** - the
   Pouch style section exists in the APK's copy and not in the one every build
   injects, so no APK built from this repo has a pouch-style picker regardless of
   what the README says.
2. **The stock settings loader overwrites `theme` with `slate` on every read**, so
   any pouch preset (built-in or future) is written to storage and discarded at
   the next start. A picker is decorative until that pin goes away.

If any part of it is wanted back - the pill alone, with its label restored, the
Paper preset alone, or just the two repairs - it is all in `f8cc89c`:
`git cherry-pick f8cc89c`, or take a single patch from
`repo_export/patches/patch9_restore_pouch_picker.py` /
`patch10_paper_pouch.py` / `patch11_pouch_add_pill.py` (each runs standalone and
takes `--check`). Do not re-apply the pill as-is: its appearance (empty wide
capsule) is exactly what was rejected.

## 9. Stack tap-to-eject (patch 12), 2026-09-05

**Khulasa (Urdu):** Aap ne kaha stack layout mein card par click karne par "ajeeb
si animation" hoti hai, aur click par card pouch/deck se **bahir aa ke khule**.
Dono ka karan ek hi jagah tha - `__cwStack` ke pointerup handler mein.

Kya ho raha tha: tap ko "hit-test against the fan" samjha jata tha -

    let e=(clientX-rect.left)/rect.width-.5, i=Math.round(d+e/.38);   // tap ke neeche ka index
    if(n!==Math.round(d)){snap(n);return}   // neighbor? sirf deck sideways, kuch nahi khulta

Matlab screen ke centre se ~19% har taraf hat kar tap karte hi poora fan sideways
tween ho jata tha (har card `rotateY +/-48deg`, `z -160px` per step, `scale .72-1`)
aur **koi card nahi khulta** - swipe wali animation tap par. Aur centre par tap
karne par khulta tha, magar card deck se bahir aata hi nahi tha: sirf frosted flap
fold hoti thi (`rotateX:-128`). Pouch (`yd`) mein yeh motion pehle se tha
(`animate:{y:-(inside+cardH*.35),rotate:-2.2,scale:1.05}` + `hd` spring) - is liye
stack ajeeb lagta tha.

Fix (bundle-level, 6 edits):

| | before | after |
|---|---|---|
| tap on a neighbour | fan sweeps sideways, sheet never opens | that card is brought forward (`snap(n,.24)`) **and** ejected + opened in the same motion |
| tap on the front card | flap folds, card stays put | card lifts `translateY(-ch*0.11)` on the pouch's spring (240/18/0.85), flap folds, then sheet opens |
| the photo | static | scale 1.05 while lifted (same 1.05 the pouch uses) |
| cover OFF handoff | `setTimeout(...,140)` | 240ms, so the lift is visible before the sheet takes over (with no flap there is no animation event to wait for) |
| `drag.current` on tap | left `true` forever after the first tap -> the fan stopped resyncing to index changes (`p.jump(r)` skipped) | cleared in the tap path |

`y` was deliberately chosen as the animated channel: on that element `x`/`z`/
`rotateY`/`scale`/`opacity` are the fan's own springs fed by `p.on("change")`, so
animating any of those would have fought the drag math. `y` was unused.

Gates: smoke **72/72** (was 64) - the new 8 checks drive real pointer events
against the stack (with the layout mock, so hit-testing works) and assert: the
tapped neighbour (not the front card) is the one that ends up ejected, its inline
`translateY` is ~-57px (=-11% of the 520px card box) while its neighbour's stays
0, the detail sheet opens on that card, a horizontal drag still flips the deck and
opens nothing, zero console errors, plus two code-level guards (the snap-only
branch is gone; `drag.current` is released). The existing
"tapping a card still opens the detail sheet (stack/carousel)" hand-off checks
still pass with the longer timer. `node --check` runs inside patch 12 before it
writes; re-running it is a no-op (an insert-type edit's anchor is a substring of
its own output, so `status()` checks the output first - that bug briefly produced
a duplicate `let ly` and the parse guard caught it).

Not fixed, on purpose: in Carousel only the middle pouch is tappable (`isActive`
gate) - side pouches need a swipe first. That is stock behaviour and reads as a
deliberate metaphor, not a bug; say the word if you want side pouches tappable.

Artifact: `CardWallet_header_black.apk` rebuilt (the filename is now just the
link that is stable) - see the sha256 in the commit message. Still **not**
verified on a device: `docs/DEVICE_TEST_PLAN.md` §N.

## 10. Stack eject: in place, and cheaper (patch 13), 2026-09-05

**Khulasa (Urdu):** Aap ne kaha *"thora sa laggy lagta ha card jab card nikalta ha,
lakin side sy ata ha"*. Dono ka ilaaj ho gaya - ab card **wahin se bahir** aata hai
jo card aap ne touch kiya (koi side-slide nahi), aur motion sasti + tez kar di.

Side-entry kyun thi: patch 12 neighbour-tap par pehle `snap(n,.24)` karta tha -
yaani poora fan tween ho ke us card ko centre laata. Centre se ~19% hat kar tap
lagne par bhi wohi path chalta, is liye zyada tar taps "side se aate" dikhe.
Ab tap kuch re-order nahi karta: card apni hi jagah se lift + 5% grow karta hai,
aur deck ka index us waqt update hota hai jab detail sheet ka apna opaque backdrop
(`rgba(9,9,11,.94)`) screen ko dhak chuka hota hai - wo re-order dikhta hi nahi.
Sheet band karne par jo card khola tha wahi front par hota hai.

Lag ke 3 asli cost, teeno hataye:

| cost | pehle | ab |
|---|---|---|
| flap `backdrop-filter:blur(22px) saturate(1.6)` on an element animating `rotateX` | re-blurs the backdrop every frame - sab se mehnga | fold ke dauran `none`, rest par wapas (frosted look zinda hai) |
| growth on the photo's `absolute overflow-hidden` box | scaling a clipped, rounded layer re-rasterises the clip each frame | rides the card's existing `scale` spring (`d`) - koi extra animated element nahi |
| neighbours `blur(10px)` while the fan tweened | blur on *moving* layers | `blur(6px)` + they no longer move during the eject (a side effect of removing the sweep) |
| timings | flap .4s, lift spring 240/18/.85, cover-off wait 240ms | .26s, 520/34/.6, 170ms |

In-place eject ne ek chhupa hua bug bhi ubaala: `__cwStack` hand-off par detail sheet
ko **stage-centre** rect deta tha, card ka apna rect nahi. Front card ke liye wo takreeban
theek tha; ab card side mein uth raha tha to sheet beech se zoom karti (jump).
`__cwCoverCard` ab khud `getBoundingClientRect()` nape kar bhejta hai, aur stage box
sirf fallback hai.

Gates: smoke **79/79** (was 72) - 15 stack checks ab real pointer events chalate
hain aur DOM se proof lete hain: tapped neighbour eject hota hai (front nahi), uska
`translateY` ~-46..-57px hai **jabke uska `translateX` apne slot par 229.5px hi rehta
hai** (yaani koi side travel nahi), mid-motion par doosre cards ka `transform`
bilkul nahi badalta (deck sweep not happening), flap ka `backdrop-filter: none`
jab tak fold ho rahi hai aur `blur(22px) saturate(1.6)` wapas jab card neeche aaye,
neighbours par `blur(6px)`, sheet khulti hai, **close karne par deck us card ko front
par le aata hai aur lift release ho jata hai** (`y=0, x=0, z-index:12`), swipe se
deck flip hota hai aur kuch nahi khulta, aur zero console errors.
Code-level: `patch12`/`patch13` dono idempotent; patch 12 ko "superseded" marker
dena pada kyunke patch 13 uski ek edit jaan boojh revert karti hai (warna re-run
us edit ko dobara laga ke clip wapas le aata). Chain 7->8->12->13 stock se replay =
byte-identical. `animation_audit`: same 10 checks / 1 pre-existing WARN.

`CardWallet_header_black.apk` = 11,648,558 bytes, sha256
`ede71942680958b9bb500af25c202cb1fad6f447b1f1b581d4ac0356a5f4900d`, same debug key
(`adb install -r`). **Device par abhi verify nahi hua** - `docs/DEVICE_TEST_PLAN.md`
§N (N3/N4/N4b/N4c is round ke rows hain).

---

## 11. Carousel: row kabhi aadha hat kar nahi rukta (patch 14), 2026-09-05

**Khulasa (Urdu):** Aap ne screenshot bheja ke card drag karte waqt "atak jata ha" aur
"aik side pr ho jata ha", aur neeche walay grey pill ko hataane ko kaha. Do alag baatein
saamne aayin:

* woh grey pill **app ka element hi nahi** - yeh Android ki system gesture / nav bar ha.
  Bundle mein app ke region mein koi bottom sheet / handle / `fixed inset-x-0 bottom`
  element nahi (grep se confirm), is liye usay "remove" karna app se possible nahi.
* card ka side par atakna **asli bug** ha, aur uski wajah bhi wohi area ha: jahan se
  gesture system le leta ha.

**Wajah (code).** Carousel ki poori row ek shared spring `d` se banti ha - har card
`offset + d/slide` par rehta ha, yaani row sirf tab centre mein hoti ha jab `d == 0`. Aur
`d` ko 0 par laane ki jagah sirf `y()` ha, jo settle animation ka `onComplete` ha:

    b=e=>{...g.current=Ju(d,-e*u.slide,{...Cd,onComplete:y})}
    y=()=>{g.current?.stop(),g.current=null;let e=_.current;_.current=0,e&&(h.current+=e,i(h.current)),d.jump(0)}

Teen raste the jin mein wo kabhi chalta hi nahi: (1) **stolen gesture** - Android pointer
stream le leta ha, hamara `end` hi nahi chalta, `b()` call nahi hoti, `d` adhuri value par
ruk jata ha; (2) **mid-glide grab** - `onPointerDown` ka `g.current?.stop(),g.current=null`
glide maarta ha magar `y()` nahi chalata, so pending index step drop; (3) 1-2px ka residual
kabhi theek nahi hota.

**Fix (do edits, sirf `function Td({cards:` ke andar).** pointerdown ab in-flight settle ko
*finish* karta ha (`g.current&&y()`) - kuch drop nahi hota aur snap ki zaroorat hi nahi. Doosra:
row par ek idle watchdog jo 340ms khamoshi ke baad nearest index commit karke `d.jump(0)` karta
ha. Guard yeh ha ke glide chal rahi ho (`g.current`) to haath na lagaye, aur finger abhi move kar
raha ho to ek baar 340ms aur intezaar (`grace++<1`) - warna user ka rok kar rakha hua card kheench
diya jata. Watchdog window ke apne `pointermove`/`pointerdown` events se `last` stamp karta ha,
live-pointer *count* is liye nahi rakha ke stolen gesture release kabhi report hi nahi karta -
count hamesha "finger down" par atak jata.

**Kya nahi badla:** spacing, `paddingBottom` (stock 58px), safe-area, colours, springs, snap
targets. Aap ne safe-area wala option choose nahi kiya, so wo nahi kia.

**Gates.** Smoke **85/85** (pehle 79). 6 naye carousel checks jsdom mein sachay pointer events
chalate hain aur pehle *symptom reproduce* karte hain: drag ke baad jaan boojh `pointerup` na
bhejein (system gesture le raha ha) → front card ka `translateX` **58.4px** par atak jata ha -
yehi aap ki screenshot wala state ha - phir watchdog usay **0.00px** par le aata ha. patch14
hata kar wahi run chalane par woh check **58.36px par FAIL** hota ha (83/85): yaani test waqai
us bug ko pakadta ha, khud-bakhud pass nahi hota. Normal drag+release (240px swipe) ab bhi
centre par settle karta ha, aur console errors zero.

Patch discipline: chain replay stock→7→8→12→13→14 byte-identical; `--check` clean; re-run
no-op. Yahan ek naya sabak mila - watchdog edit *insertion* ha (uska anchor usi ke naye text ka
prefix ha), is liye "anchor maujood = pending" wala rule dobara lagane par **do watchdog** bana
raha tha; `status()` ab pehle "applied" check karta ha. `verify_release.py` 28/29 (ek FAIL
jaan boojh: debug cert subject). `animation_audit`: same 10 checks / 1 pre-existing WARN.

**Build.** `CardWallet_header_black.apk` = 11,648,763 bytes, sha256
`c5a8f69a8f18d54c1616d26cf3b059742d389a1f67ccf77ea2c1fde3bb3204ca`, same debug key
(`adb install -r`, data salamat). Device rows: `docs/DEVICE_TEST_PLAN.md` §O (O1-O6).

---

## 12. Pouch screen: dead area band, blur, per-card colour (patches 15 + 16), 2026-09-05

**Khulasa (Urdu):** Aap ne doosri screenshot bheji aur blue se pouch ke upar/neeche ka
khaali kaala hissa frame kia - "yeh jaga kam na kray, is pr touch/swipe kuch b kaam na
kare". Saath mein: blur ka kaam kam karo, har card ka colour bhi select ho sakay, aur
white mode mein card ke naam white aate hain - woh black bold ho jan. Teeno ho gaye.

**1. Dead area ab bilkul inert ha (patch15).** Carousel ka drag layer `absolute inset-0`
tha - yaani stage box jitna bara, artwork se zyada - is liye khaali jagah se uthne wala
swipe bhi row ko khench leta tha, aur `cursor:grab` ye wada bhi karta tha. Ab:

* layer par `pointer-events:none`, aur har card wrapper par `pointer-events:auto` +
  `data-cwc` marker + grab cursor;
* `onPointerDown` sirf us gesture ko leta ha jo *card ke andar* shuru ho
  (`e.target.closest('[data-cwc]')`) - CSS kisi puranay WebView ne ignore kar dia to bhi
  rule lagoo rahega, aur jsdom mein (jahan hit-testing nahi ha) isi se test ho sakta ha;
* `<main>` par `touch-action:none` + `overscroll-behavior:none`, taake khaali patti se
  uthne wali swipe browser page ko scroll/rubber-band na karay.

**2. Blur ab kahin nahi (patch15).** Sach ye ha ke carousel mein koi blur tha hi nahi -
wahan pouch canvas par bunta ha - is liye card ka atakna blur se nahi ho raha tha (atakne
ka asli ilaaj patch14 + ab ye inert band ha). Blur sirf Stack view ke frosted cover par
tha: `backdrop-filter:blur(22px) saturate(1.6)`. Aap ne "poori tarah hata do" chuna, so
ab cover ek flat translucent panel ha - aur blur hatane ke baad card ka number uske peeche
se parha ja sakta tha, is liye panel ki body barha di (`rgba(28,28,34,0.72)`), taake
cover apna kaam karta rahe.

**3. Naam ab theme ke saath (patch15).** Label ka colour `cover ? white : var(--ink)` tha -
matlab cover ONhte hue light mode mein bhi white, aur safed background par gum. Ab label
hamesha `var(--ink)` (light: `#111113`, dark: `#f5f5f7`) + `font-weight:800`, aur uska
shadow ek token ha: `--pouch-label-shadow` (light `none`, `html.dark` mein purana halo).
Is ke liye pehli dafa `index.css` bhi badla - aur debug builder CSS swap karna nahi janta
tha, is liye usay bhi update kia (HTML ab bhi guardeed ha).

**4. Har card ka apna colour (patch16).** Aap ne "dono" kaha: per-card swatches + jo select
ho woh lage. Doosra aadha pehle se lagoo tha - test se proof: `custom.color:#2d4a3e` dene
par har pouch `rgb(32, 53, 45)` par paint hota ha (default slate `#3a3d45…` nahi). Pehla
aadha naya: card ke editor (long-press -> Card details) mein **Pouch colour** ki 11
swatches + **Wallet colour** chip (jo override wapas settings ko de deta ha, `{color:void
0}` - usi sheet ka `back:void 0` wala tareeqa). Card par `color` save hota ha aur `yd` us
card ko `theme:'custom'` par paint karta ha - yaani bundle ka apna "Yours" theme, jisme
sleeve, tray gradient, sheen aur naam ka rang ek hi hex se bante hain (naya drawing code
kuch nahi). Dono memo comparators (`Q` aur `Dd`) ab `card.color` compare karte hain - warna
React value accept karke card ko dobara paint hi na karta.

DOM se proof: `T0` par `#2c3d56` dene se sirf uski pouch `rgb(27, 38, 53) 0%, rgb(18, 24,
34) 45%, rgb(11, 15, 21) 100%` ho jati ha, baqi green hi rehti hain; `T2` par `#b08d57`
dene par woh alag `rgb(109, 87, 54)…` - yaani cards swatantir hain.

**Gates.** Smoke **115/115** (79 -> 85 -> 115). patch15 ke 12 naye checks: `<main>`,
peranay drag layer aur stage box se uthne wali swipe par row **0.00px** bhi nahi hilta,
card par swipe **31.83px** hilta ha, `pointer-events` / `cursor` / `touch-action` DOM par,
label `var(--ink)` + 800, aur CSS token. patch16 ke 8+3 checks: global colour apply,
per-card override jeet-ta ha, 11 swatches, save sirf us card par, selected ring, reset ke
baad wapas wallet colour. Chain replay stock->7->8->12->13->14->15->16 byte-identical;
patch13 ko `DOWNSTREAM_KEEP` marker dena para kyunke patch15 uski flap-blur edit ka span
aur re-word karta ha (warna patch13 dobara chalane par purana blur wapas aa sakta tha).
patch16 hata kar chalane par theek 8 colour checks fail hote hain (107/115) - yaani tests
is feature ko sach mein pakartay hain. `verify_release.py` 28/29 (soli FAIL = debug cert
subject). `animation_audit` 10 checks / 1 pre-existing WARN.

**Build.** `CardWallet_header_black.apk` = 11,649,151 bytes, sha256
`7f251342aefeffccd8ec5b4c6fcc227e00d95334d98ab7073196107e47036453`, same debug key
(`adb install -r`). Device rows: `docs/DEVICE_TEST_PLAN.md` §P (P1-P8), aur §O ab
safety-net rows hain.

## 13. Cover ka colour, NFC off, light default, header "Wallet" (patch 17), 2026-09-05

Chaar maang, ek patch.

1. *"Stack meh jo cover ha blur wala us ko khatam kro, or jo colour pic karte thy … wo us ki
   jaga laga do."* patch15 ne sirf `backdrop-filter` prop hata ya tha — uski jagah wahi ek
   translucent glass panel bacha hua tha, is liye device par "kuch nahi hua" lagta raha. Ab
   panel khud wohi colour pehanta ha jo pouch ke liye pick hota ha: card ka apna `color`,
   warna wallet ka `custom.color`/`slateColor` — aur wohi bundle ka helper `td(hex, mul)`
   jo carousel ka tray gradient banata ha, so moonh par halka, beech main colour, neeche
   dark; border aur rim bhi usi colour se. Panel opaque ha, card peeche se jhankta nahi.
2. *"nfc auto off rakho."* Default `nfc:!1`, aur loader me `n.nfc=!1` — stock ka apna
   `n.autoDetect=!1` wala tareeqa — taake purani install ka saved `nfc:true` feature wapas na
   le aaye (warna "default badal dia" sun kar device par phir "Nhi tum ny fix kia" hota).
   Settings ka NFC row bhi feature ke sath hata diya: toggle jo relaunch par reset ho jaye,
   us se behtar ha ke woh na ho.
3. *"auto light mode rakho."* `appearance` ka default `light`. Jo install purana default
   `system` liye baithi ha, usay **ek baar** migrate kiya jata ha (`appearanceMigrated` flag),
   taake baad me chuna hua System/Dark salamat rahe — System ab bhi phone ke sath chalta ha.
4. *"header pr top left corner pr bara bold Wallet likho, font ios wala ho."* 28px / weight
   800, `-0.6px` tracking, `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro
   Text", "Helvetica Neue", Inter, …` stack, colour `var(--ink)` (dark theme me bhi parhi
   jaye), `margin-right:auto` se 3 icons dayein taraf pehli tarah. Wordmark patch8 ke
   `/*cardwallet:header*/` marker ke **baad** insert hua, warna patch8 ki verification toot
   jati.

**Gates.** Smoke 115 -> **138**. Test 6i me `matchMedia` ko jaan boojh kar "dark" par stub kiya
gaya — warna "light default" ka check khali-khali pass hota, kyunke jsdom me waise bhi dark
nahi milta. Proof: fresh install par `dark` class nahi aati, `+` menu me "Tap a bank card"
nahi, Settings me NFC row nahi, aur sheet ka selected segment **Light**; `{appearance:'system'}`
wala fixture migrate hoke Light, `{appearance:'system', appearanceMigrated:true}` wala System
hi rehta ha (yaani feature nahi toda), `{appearance:'dark'}` wala dark. Cover: wallet
`#2d4a3e` par panel `rgb(53, 87, 73) 0%, rgb(45, 74, 62) 52%, rgb(31, 52, 43) 100%` aur rim
`rgb(25, 41, 34)`; apna colour rakhnay wali card par `rgb(52, 72, 101)…` — do alag panels,
`blur(` ka ek bhi ref nahi, `backdrop-filter: none`. patch17 hata kar chalaya to **118/138** —
theek yahi 20 checks girtay hain, yaani tests feature ko pakartay hain. Chain replay
stock->7->8->12->13->14->15->16->17 byte-identical; patch15 ko `SUPERSEDED` marker dena para,
kyunke patch17 uski "cover body" edit ka span hi badal deta ha (warna patch15 dobara chalne
par purana glass panel wapas aa sakta tha).

**Build.** `CardWallet_cover_colour.apk` = 11,649,058 bytes, sha256
`5af9e92602c35b080b2a4cce6b95471304b168cdd2da06870e028cee9f5bc074`, same debug key
(`adb install -r`, data bacha rehta ha). APK ke andar ke 11 content greps pass (naye defaults,
loader pin, migration, NFC row ka na hona, cover colour, purana glass `rgba` ka na hona,
wordmark + Apple stack, aur patch15/16 ke markers). `verify_release.py` 28/29 (soli FAIL =
debug cert subject), `animation_audit` 10 checks / 1 pre-existing WARN. Device rows:
`docs/DEVICE_TEST_PLAN.md` §Q (Q1-Q8).


---

## 14. Premium settings: glass + type, Custom Pouch panel, live preview, real plumbing (patches 18 + 19 + 20), 2026-09-05

**Maqsad.** "UI aur settings experience ko premium minimalist Apple style mein enhance karo" -
typography SF Pro (ya fallback), poori settings screen blurred glass, extra explanatory text
hta do, har option ko bara button mat banao, aur saari Design + Layout customization **ek**
Custom Pouch section me do jisme live preview ho - preview asli component ho, static image nahi.
Hard line: functionality aur card/wallet data untouched, aur jo setting me se badlay woh wallet
me bhi lage.

**Teen patches, ek zimmedari.**

1. *patch18 - type + glass (CSS + 4 span).* Font stack me `SF Pro Display` / `SF Pro Text`
   fallbacks se pehle; `html,:host` par `-0.011em`; purana uppercase letter-spaced label
   section khatam - `Settings` 20/700, card headings 15/600 `var(--ink)`, group labels
   11.5/600, rows 14. Glass tokens (`--glass`, `--glass-blur:34px`, `--glass-line`,
   `--glass-hi`, `--scrim-blur`, light + `html.dark`) aur `.cw-*` kit - `.cw-glass-sheet`,
   `.cw-scrim`, `.cw-card/.cw-row/.cw-seg/.cw-dot/.cw-chip/.cw-range/.cw-preview`.
   `prefers-reduced-transparency:reduce` par sab solid. Settings sheet ka panel `sheet-bg`
   se `cw-glass-sheet` par, scrim ka inline rgba hataa kar class, aur title `cw-title`.
   **Sirf** settings sheet convert hui - card editor (`zp`) `sheet-bg` hi rehta ha, taake
   blur kahin card animation ke raste me na aa jaye.
2. *patch19 - Custom Pouch sheet.* Purana `Np` (settings sheet) poori tarah replace; source
   `patch19_settings.src.js` me ha (flat, ek node per line) aur patch usay minify karke
   bundle me dalta ha. Andar: `Custom Pouch` card = **live preview** + `Design` + `Layout`,
   aur ek alag `Appearance` card. Preview = wallet ka apna component (`Ed` / `__cwStack`,
   pehli 3 cards, `pointer-events:none`, drag inert) - colour ya layout select karte hi
   preview usi state par dobara render hota ha, koi screenshot nahi. Saare explanatory `<p>`
   gaye; state control khud batata ha (chip `data-on`, slider ka read-out, switch). Cards
   chips ka kaam sirf preview filter ha - `useState`, storage me ek byte nahi jaata.
   `Xu` me naye neutral fields (`radius/shadow/material/depth/border/size/gap/stack`) -
   default par sab 1 (gap 20), yaani **pehle jaisa hi** paint.
3. *patch20 - jo setting badle woh wallet me lage (23 edits).* Ek `__cwTune(theme, custom)`
   post-processor `ad()` par baitha ha (wallet aur preview dono ka single choke-point) jo
   Slate/Classic/custom tray gradient, border alpha, sheen, shadow aur `cardRadius/pouchRadius`
   ko scale karta ha; `__cwSlateTray` carousel tray ka literal gradient wahi fields khata ha;
   canvas sleeve painter (`pd`) ke literals `depth/material/shadow/border` se multiply hote
   hain; `xd(k)` me `cardW=bd.cardW*size`, `slide=n*u+gp`, radii `*radius`, aur `Sd(k)` un
   teeno par recompute + resize; `Xd` (stack geo) + `__cwStack` + `__cwCoverCard` me
   `size/gap/radius/shadow/stack(Fan)` lagte hain. Sab kuch `==null?1` se guard ha - naye
   stored settings (jo `custom` me naye keys nahi rakhtay) par output **byte-for-byte**
   patch17 wala rehta ha.

**Gates.** Smoke **138 -> 178** (40 naye checks: 8 type/glass CSS, 7 DOM-glass/sheet,
9 Custom Pouch + preview, 13 plumbing + slider end-to-end). Negative controls, ek-ek patch
hataa kar (`patches/replay_chain.py --upto N --swap`): 20 ke bina **168/178** (theek 10
`pouch:` checks girtay hain), 19+20 ke bina **156/178**, round-9 JS par **153/178** - aur
teesre control me CSS-side checks isliye bachtay hain kyunke `index.css` rollback nahi hota.
19/20 ke naye checks ab null-safe hain (`q()`), warna missing sheet par crash hota.
Chain replay stock->7->8->12->13->14->15->16->17->18->19->20 **IDENTICAL** (458,900 B).
Replay harness ne ek apni ghalti bhi pakri: wo scratch copies ki jagah repo ki scripts chala
raha tha, yaani shipped bundle par patch chala raha tha - isse pehle "chain replay" ka hawala
isliye kamzor tha; ab harness scratch tree se chalata ha aur `--check-each` bhi deta ha.
patch13/17 ko `DOWNSTREAM_KEEP` markers dene pare (patch20 unhi spans ka shadow alpha / radius
dobara tune karta ha - marker ke bithooye wo apni edits "stale" bol kar chain rok detay).

**Naya test ne ek asli bug pakra.** `yd` ke card shadows me `((r&&r.shadow)||1)` tha -
`shadow:0` "missing" ban kar 1 par wapas aa jata, yaani Shadow slider ka 0% kabhi kaam nahi
karta. `!=null?+r.shadow:1` kiya, replay dobara chalaya, check ab
`rgba(0,0,0,0.6) -> rgba(0,0,0,0.0)` dikhta ha.

**Build.** `CardWallet_custom_pouch.apk` = 11,651,036 bytes, sha256
`141f035e75dcacbbfe20db63e43a0e1c7415fbbee9e6b64039af23a12ce6b47d` - same debug key,
`adb install -r` (data salamat). APK ke andar ka JS/CSS tree se byte-identical (md5
`a5f3c5c1…` / `45b9a3ac…`) aur 15/15 content greps (helpers, fan factor, shadow guard, SF Pro,
glass kit, reduced-transparency) ok. `verify_release.py` 28/29 (soli FAIL debug cert ha),
`animation_audit.py` 10 checks / 1 pre-existing WARN - card/pouch path par koi naya
transition nahi aaya, `.cw-*` controls hi animate hotay hain. Preview (:8080) symlinked
files ki wajah se auto-updated.

**Abhi bhi device par depend karti ha:** glass ka GPU cost (blur 34px mid-range Android par),
slider drag karte waqt row ki smoothness, aur R1-R13 - `docs/DEVICE_TEST_PLAN.md` §R.


---

## 15. Stack apni jagah, sheet compact, sliders smooth (patches 21 + 22), 2026-09-05

**Maqsad (round 11).** "Layout mein stack ki alag setting ho aur carousel ki alag", "jo
sliders hain un ko smooth karo", "stack preview mein show nahi ho raha", "create button thora
chota", aur "settings mein bohat zyada button ho gaye hain - kam se kam chahiye".

**Kya mila.**

1. *Stack preview sach me dikhta ha (patch21).* `__cwStack` apne cards `window.innerWidth/
   innerHeight` se size karta ha - sheet ke 176px box me matlab poori phone-size stack ek
   zero-height flex parent me, yaani kuch nazar nahi aata tha. Ab uska optional `fit` box
   caller se aata ha (preview `fit:{w:388,h:302}` deta ha, `.cw-preview-in` `.56` par scale)
   aur **wallet ki apni sizing ka formula jaisa tha waisa hi raha** - smoke test ternary ke
   *dono* branches assert karta ha, taake preview ki sizing khiskar wallet par na lage.
2. *Layout view ke sath chalta ha (patch22).* `Carousel|Stack` select karte hi us view ka
   sub-label aur uske controls aate hain: carousel = Wallet & cover, Size, Spacing; stack =
   Wallet & cover, Size, Spread, aur `Flat|Fan|Deck` fan. Preview wohi component mount karta
   ha jo wallet render karta ha, is liye sheet aur wallet hamesha ek tasveer dikhate hain.
3. *Buttons 22 -> 7 (Stack me 10).* `Cards` wala preview-filter row (jo user ne maanga hi nahi
   tha) gaya, aur Material/Border ki chip rows `Sheen`/`Edge` **sliders** ban gaein - wohi
   `custom.material`/`custom.border` fields likhti hain jo patch20 paint karta ha, yaani
   functionality loss zero. Bachchi hui 4 chip rows: Slate|Classic, Carousel|Stack,
   Flat|Fan|Deck (Stack only), System|Light|Dark.
4. *Sliders smooth - teen hisson me.* Sab se bara hissa React ka tha: controlled input har event
   par "last committed" value par wapas restore ho jata ha - **yehi thumb ke neeche ka jitter
   tha**. Ab drag do-tier hai: sheet ke andar local state (`setDrag`) drag ki value hold karta
   ha, wallet par commit **per frame ek baar** `requestAnimationFrame` queue se (na hone par
   `setTimeout` fallback), aur `pend.current` mirror hai taake dono tier kabhi alag na hon.
   Doosra hissa CSS: har pouch slider step `.01`, `--p` se bhara hua 4px track 26px hit area me
   (`touch-action:none` - sheet drag ke doran scroll nahi hoti), 20px thumb, tabular read-out.
   Teesra: sleeve canvas ka cache key `JSON.stringify(custom)` tha - har step par poora canvas
   re-paint + `toDataURL`. Ab `__cwSig` paint-only fields ko 1/8 grid par quantize karta ha,
   to ek sweep me ~10 repaints hote ha ~100 ki jagah, aur tray par `.16s` easing fine values ko
   continuous dikhati ha.
5. *Create button chota.* Header ka filled `+` aur do bare siblings 44px -> 40px, glyphs
   23/26 -> 21/24; sheet ka `Done` pill bhi `text-[13.5px]` par. patch7 ke span me yeh rewrite
   hai, is liye patch7 ko `DOWNSTREAM_KEEP` mila; patch19/20 ko bhi markers mile (patch22 ne un
   ke spans rewrite kiye) - marker ke bagair wo apne aap ko "stale" bol kar chain rok dete.

**Gates.** Smoke **178 -> 197** (19 naye checks: header size, fit sizing, `__cwSig`, tray easing,
CSS slider kit, chip budget 7/10, view-specific rows, stack preview ka card box, drag par
snap-back na hona, **6 events -> 1 storage write**, aur wallet ka tray radius 22.3 x 147% = 32.8px).
Controls: patch22 hataa kar **188/197**, patch21+22 hataa kar **184/197** - theek round-11 ke
checks girtay hain. `patches/replay_chain.py` ab patch 22 tak chalata ha aur shipped bundle
**IDENTICAL** (459,776 B). `animation_audit` 10 checks / 1 pre-existing WARN - card/pouch path par
koi naya transition nahi (easing sirf tray ki background/radius par, jo transform path me nahi).

**Do apni ghutiyan jo tests ne pakri, shipping se pehle.** (i) patch22 ka pehla draft object keys
template literals se likha gaya tha (`` `data-on`: ``) - JS me key sirf string/identifier/[expr]
hosakta ha, `node --check` ne bundle likhne se pehle rok diya. (ii) Storage par `setItem` spy
lagane ki koshish jsdom ke proxy ne `setItem` naam ka *key* store kar diya, is liye "1 write"
count 0 aaya; spy `Storage.prototype` par move kiya. Teesri cheez harness me mili: replay
scripts scratch copies ki jagah repo ki scripts chala raha tha - wo bug pichle section me note
ho chuka ha, ab `ORDER` bhi 21/22 tak hai.

**Build.** `CardWallet_settings_compact.apk` = 11,651,779 bytes, sha256
`41bdc836641f012219b6e3d471702cf730a62239cc9b5e846f2c2e4595ddb7d5`, same debug key
(`adb install -r`, data salamat). APK ke andar JS/CSS tree se byte-identical aur 20/20 content
greps (fit prop, fit sizing, `__cwSig`, purana JSON key ka na hona, tray easing, header sizes,
view-specific rows, do-tier drag state, Sheen/Edge, aur CSS slider kit). `verify_release` 28/29
(soli FAIL debug cert), preview (:8080) symlink se auto-updated.

**Device par abhi bhi dekhna ha:** S1-S11 - khaas taur par S4/S5 (thumb ke neeche ka jitter aur
wallet ki hitching) aur S3 (stack preview ka box), kyunke frame timing machine par nahi napte.

---

## 16. Round 12 - Stack aur Carousel ab do alag configuration modes (patches 23 + 24)

**User ki request (Roman Urdu):** *"Overall goal: settings simple aur clean hon, minimum buttons,
kam text, compact controls, bade headings, smooth sliders, real-time preview, independent Stack
settings, independent Carousel settings. Layout section mein Stack aur Carousel completely separate
configuration modes hon - Stack ke liye card overlap, vertical offset, scale, rotation, visible
cards, spacing; Carousel ke liye card spacing, scale, side card visibility, peek amount, horizontal
positioning. Stack ki settings Carousel par apply nahi honi chahiye aur Carousel ki settings Stack
par apply nahi honi chahiye. Preview static image na ho - minimum 3 actual cards, live components.
Sliders fluid hon, koi jump ya lag na ho, smooth interpolation ho. Create button thora aur chota,
extra padding/height hatao. Panel configuration dashboard jaisi na lage."*

Round 11 ne Layout ko view-specific *rows* toh bana diya tha, lekin dono views ek hi
`custom.size` / `custom.gap` / `custom.stack` field likh rahe the - matlab "Size" slider carousel
mein bhi pouch ko bada karta tha aur stack mein bhi. Yeh user ki main shikayat thi, is liye is
round mein asal namespacing ki gayi.

**Kya bana (patch 23 - bundle):** layout numbers ab do alag objects mein rehte hain -
`custom.stack = {size, gap, overlap, spacing, vOff, shrink, rot, visible}` aur
`custom.carousel = {size, gap, side, peek, pos}`. Renderers ko koi naya field nahi chahiye tha:
wallet har view ko `{...custom, ...custom[view]}` de deta ha ek chhote helper se (`__cwMrg`), isi
liye same naam do namespaces mein hone se views alag ho jate hain, aur design fields (radius,
shadow, colour, material) shared rehte hain kyunke wo layout nahi hain. Har requested control asal
geometry se juda ha: stack mein `overlap` = card width ka kitna hissa card khisakta ha
(`l*(cw*overlap + spacing)`), `vOff` = transform par vertical step (layout cost nahi), `shrink` =
per-depth scale, `rot` = per-depth 3D turn (aur clamp kitna khulta ha), `visible` = kis depth ke baad
card opaque nahi rehta. Carousel mein `gap` = slide advance, `size` = card scale, `side` = side cards
ki opacity (distance ke saath graded), `peek` = lateral factor (`0.56 * peek`) jo tay karta ha
pichla card kitna dikhta ha, `pos` = poore row ka horizontal bias. Defaults
(`.7 / 0 / 3 / 1`) patch 20-22 ke numbers exactly reproduce karte hain, aur `$p()` ek dafa purane
flat `size`/`gap`/`stack` (Fan multiplier) ko dono namespaces mein fold kar deta ha, so kisi
purani install ka look nahi badalta.

**Kya bana (patch 24 - sheet):** Layout ke paas ab sirf do chips + ek switch hain (`Flat|Fan|Deck`
chips delete kar diye kyunke Rotation/Overlap whi kaam sliders se kar dete hain; `Spread` ab
`Spacing`). Preview wallet ke apne components mount karta ha aur kabhi ek card par nahi rukta:
wallet ke real cards pehle, phir stand-in cards (whi components, har card ka apna pouch colour) -
carousel mein 3 aur stack mein 6 tak, tabhi `Visible cards` aur `Vertical offset` drag karte waqt
saaf dikhte hain. Sheet ko ab 8 cards diye jate hain (pehle 4). Teesri tier smoothness ki: geometry
writes **ramp** hote hain - har frame finger ke distance ka 42% cover hota ha aur aakhri step target
par *exact* snap karta ha, so jo value store hoti ha wahi hoti ha jo aapne chuni. Jo field dragged
ha uski value sheet ke paas rehti ha (React input ko wapas na kheenche) aur drag us field ki glide
khatam hone par hi chhooti ha.

**Do bugs jo harness ne pakde - dono batane layak hain.**
(i) `Sd` (geometry hook) ki dependency list abhi bhi `[size, gap, radius]` padh rahi thi, so
`peek`/`side`/`pos` settings store toh hoti lekin wallet unhe dobara layout mein recompute na karta
- yaani slider bilkul be-asar. Yeh is liye chhoot gaya kyunke patch 23 ke Python file mein multi-line
string literal bina parentheses ke tha, so `SD_NEW` sirf pehli line ban kar reh gaya aur edit no-op
ho gaya (patch ka apna status usko "applied" keh raha tha). Ab patch aise edit ko khud rok deta ha:
`old == new` ho toh refuse, aur apply ke baad `old` dobara dhoondhta ha.
(ii) patch 13 ka eject spring `let n = {…}` kehlaata tha, usi component mein jahan progress motion
value ka naam bhi `n` ha - shadowing ki wajah se render par `n.get is not a function` aaya aur poora
sheet crash hua. Ab us object ka naam `spg` ha, aur whi test ne ye crash pakra.
Iske ilawa markers update karne pare patch 7/13/17/19/20/21/22 ko (jahan 23/24 ne unka span dubara
likha), aur replay harness ke `--swap/--restore` ne ek purana backup bacha liya tha jis se restore
dobara buggy state de raha tha - ab wo swap aur restore dono par batate ha ke restore kis state par
le jayega (size + md5).

**Gate.** Smoke suite 216/216 (round 11 ki 197 checks ko round-12 ke field names par retarget kiya,
aur ek naya block 6m joda: dono taraf ki isolation, neutral defaults, migration, `Sd` deps, preview
ke 3/6 cards, ramp ki glide + exact landing, aur button budget). Negative controls: patch 24 hata kar
**13 FAIL**, patches 23 + 24 hata kar **22 FAIL** - dono mein sirf round-12 ke checks gire, purane
green (matlab naye checks naye kaam ke liye hain, decoration ke liye nahi). `animation_audit` 10
checks / 1 pehle se wali WARN. `replay_chain` seed -> patch 24 = **IDENTICAL** (463,130 B).

**Build.** `CardWallet_stack_carousel_modes.apk` = 11,653,136 bytes, sha256
`4ee95622b99ccb9fd578d86084a0c28319021d1f87869f931b47e338f3198e11`, same throwaway debug key
(`adb uninstall com.arena.cardwallet && adb install …`). APK ke andar JS/CSS tree se byte-identical
(md5 `211101a1…` / `4037f6c0…`) aur 42/42 content greps; `verify_release` 28/29 (sole FAIL = debug
cert subject, jo debug build ke liye expected ha). Preview (:8080) repo files ko symlink karta ha,
is liye har edit foran live.

**Device par abhi bhi dekhna ha:** section T (T1-T10) - khaas taur par T1/T2 (isolation: ek view ki
settings dusre par lag hi na hone chahiye), T4 (stack preview mein 3+ cards aur `Visible cards`),
T5/T6 (glide: thumb ke neeche preview smooth, release par exact value) aur T10 (36px create button
ka tap area device par theek lagta ha ya nahi).

---

## 17. Round 13 - stack preview ka box asal mein bharta ha (patch 25)

**User ki report:** screenshot ke saath preview area circle kiya hua tha aur likha *"preview meh stack
show nhi ho rha ha, stack preview meh show hona chahiye"* — yaani glass box bilkul khaali.

**Wajah (diagnosis, aur ye round 11 ki ghalti thi):** round 11 ne `__cwStack` ko `fit:{w:388,h:302}`
de kar uske **cards** ko box se size karna sikhaya tha — ye hissa theek tha — lekin component ka apna
**stage** ab bhi `flex:1` par chhora hua tha. `flex:1` ka matlab sirf flex column ke andar hota ha;
sheet mein stage `.cw-preview-in` ke andar ha jo absolutely positioned box ha, is liye stage ki height
**0** ban gayi aur uski apni `overflow:hidden` ne saare cards kaat diye. Wallet mein ye is liye theek
dikhta ha kyunke wahan stage waqayi flex column ki aakhri row hoti ha.

Doosri ghalti usi box mein: stand-in cards ka `src`
`data:image/svg+xml,` + `encodeURIComponent(prefix)` + `#2c3d56` + suffix tha — URL mein kacha `#`
fragment shuru karta ha, so SVG fill colour par hi kat ho jata tha aur image load hi nahi hoti thi.

**Fix (patch 25):** do properties, aur sirf tab jab `fit` diya gaya ho:

    style:{flex:ft?`none`:1, …, width:ft?ft.w:void 0, height:ft?ft.h:void 0, …}

`fit` na ho (wallet) to React ye dono properties likhta hi nahi — wo path byte-identical ha. `fit` ho
(preview) to stage 388x302 ho jata ha aur cards apne asal size ke andar baithte hain. Stand-in cards ka
rang ab `rgb(44,61,86)` jaisa triple ha jo poori encoded string ka hissa ha, aur un par title nahi
(teh qar copy wallet ka pehla title "broken" lagta tha).

**Harness ne kya seekha:** round 11 ki check stage ke cards ka **width** napti thi — aur zero-height
clipped box ke bachon ka width bilkul sahi aata ha, is liye kuch pakra hi nahi gaya. Ab preview checks
height-aware hain: stage par fit box ki `width`/`height` declared honi chahiye (property *naam* padhe
jate hain taake `min-height`, `height` ko pass na kar de), wallet ke stage par unka na hona chahiye,
aur stand-in URL mein kacha `#` nahi hona chahiye aur woh SVG ke end par khatam hona chahiye. Patch 25
hata kar ye do checks whi string par garte hain jo is bug ne di thi:
`flex: 1 1 0%; min-height: 0px; overflow: hidden; …` (height ke bina).

**Aur ek bug jo isi beech mila — apni ghalti maan leta hoon:** `replay_chain.py --swap` ke block ko
rewrite karte waqt main ne wo line gira di thi jo file likhti ha, so swap "swapped" print karta lekin
tree ko haath hi nahi lagata. Is ka matlab negative control chup-chaap **shipped bundle** par chalta
(aisa lagta ha jaise naye tests patch ke bagair bhi pass ho rahe hain — control ka sab se khatarnak
jhooth). Ab swap likh kar dobara padhta ha aur bytes match na hon to khud fail ho jata ha. Pichle turn
ke controls (13 FAIL / 22 FAIL) is bug se pehle ke theen aur durust theen; is turn ka control pehli
bar bekaar gaya tha, is liye dobara chalaya gaya.

**Gate.** Smoke **220/220** (4 naye preview checks samet). Negative control: patch 25 hata kar
**2 FAIL** — theek wahi do, stage-size aur stand-in URL. `replay_chain` seed → patch 25
**IDENTICAL** (463,213 bytes). `animation_audit` 10 checks / 1 purani WARN. `verify_release` 28/29
(sole FAIL debug cert), aur APK ke andar JS/CSS tree se byte-identical + naye fixes ke greps.

**Build.** `CardWallet_stack_preview_fixed.apk` — same debug key, pehle
`adb uninstall com.arena.cardwallet`.

**Device par dekhna ha:** section U (U1-U4): U1 preview box mein 3+ cards saaf dikhein (Stack view mein
6), U2 `Overlap`/`Visible cards`/`Vertical offset` slider hilate hi stage badle, U3 wallet ka stack
har guzre round ki tarah behave kare (fit change sirf preview tak mehdood ha), U4 ek-card wallet par
bhi stand-in cards colour ke saath aayen (pehle unki artwork load nahi hoti thi).
