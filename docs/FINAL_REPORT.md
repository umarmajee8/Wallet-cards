# Final production verification report — Card Wallet

Date: 2026-09-05 · Branch: `arena/01a07196-wallet-cards`
Artifact: `CardWallet_release.apk` (11,652,949 bytes)
SHA-256: `63dbd8b1929fdbcb673a19ebab585c0c723ae41518188ff437e84da0c2233e9a`

---

## Status: ❌ NOT production ready — QA pass complete (patches 26-29), device + release build still open

> Round 14 ka poora natija **`docs/QA_HANDOVER_REPORT.md`** mein ha (sections 1-30, har finding ka
> root cause + fix + negative control, aur §5 mein woh sab cheezen jo is environment mein
> *verifiable hi nahi*). Yeh file uska summary ha; numbers neeche wale table se match karte han.

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
| Android system Back in every state | ⛔ not tested — handler **added** by patch 26 (was: no handler at all); device check in plan §F1–F10 |
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
| 3 | No Back-button handling anywhere — Back from any sheet exited the app | **Critical-class** | **Fixed in patch 26** (round 14): one history entry per open sheet + `popstate` closes the topmost. The earlier "don't patch minified code blind" stance was revisited and the fix is additive, reproduced before and after, and covered by 3 QA checks + 2 smoke checks. Device confirmation: plan §F. |
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
| dropdown | `var(--sheet)` panel, `var(--ink)` rows | `#0b0b0d` panel, white rows, `#ff453a` destructive row **<- round 22 (patch 37) went back to the stock tokens: the literal was written when the app was light-only and it stopped following the theme, which the client reported** |
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

**Ek baat jo bug nahi ha:** preview deck ko dobara centre ya chhota nahi karta. Default
`Card overlap` (.7) par fan kareeb chaar card-width tak jata ha, so bahar wale cards stage se kat
jate hain — bilkul waise hi jaise phone ka viewport wallet ke stack ko kaatta ha. Ye is liye theek
ha kyunke preview aur wallet ek hi component aur ek hi settings share karte hain; jab aap overlap kam
karenge to dono jagah deck saath mein bund ho jayegi. (Main ne ek check likhi thi jo dono fans ka
ratio tulna karti ha, phir hata di — transform settle hone ke liye frames chahiye, aur frame-timing
par depend karne wala test na hone se bura hota ha.)
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


---

## 18. Round 14 - poori production QA pass, 4 asli defects aur unke fixes (patches 26-29), 2026-09-06

**Kya manga gaya:** client ko dene se pehle A-Z QA - har feature ko *use* karke test karo, har screen
inspect karo, interactions repeat karo, edge cases, aur koi bhi issue chhupana nahi: reproduce karo,
root cause nikalo, source mein fix karo, phir regression dobara.

**Kya mila (char defects, sab fixed):**

| # | Defect | Repro | Fix |
|---|---|---|---|
| QA-1 | Back button ka **koi handler hi nahi tha** - koi bhi sheet khuli ho to Back app khatam kar deta tha (adhi editing saath) | jsdom: `history.length` kabhi nahi barha, sheet khuli rahi | patch 26 - har open sheet par ek `pushState`, `popstate` sab se upar wali band karta ha (z-order), Done par double-pop guard |
| QA-2 | Store shuda settings par koi clamp nahi: `custom.stack.size:1e9` -> card **226,229,508,197 px**; negative -> **0 px** (khali wallet, crash jaisa) | 4 hostile `wallet.settings.v1` fixtures | patch 27 - `cwClamp()` load par, har field ki apni slider range, stack/carousel alag namespace |
| QA-3 | `om()` bina `src` wale card **delete** kar ke storage likh deta tha - permanent, khamosh data loss | src-less card fixture | patch 27 - filter ab `e.id && (e.src \|\| e.back \|\| e.title)` |
| QA-4 | Na-parhne-layq photo = **kuch nahi hota** (na card, na message). HEIC, cloud-only photo, 0-byte share, 12 MP decode OOM | 0-byte file asli gallery input se | patch 28 - "Could not read that image - try another photo", partial batch counts, replace-photo purani tasveer rakhta ha |
| QA-5 | Share/Save **native `CardIO` plugin** ko `await` karte han jo is APK mein hai hi nahi -> promise reject, aur neeche wali kaam karne wali Web-Share/download line tak kabhi pahunch hi nahihti | static: dex sirf Capacitor core, `cordova_plugins.js` 0 B | patch 29 - dono calls `try{}catch{}` -> fallback chalta ha (device row V5) |
| QA-8 | Editor mein `+ CVV` chip aur tap-flow ka CVV field - app plain `localStorage` mein sab kuch rakhta ha, PCI DSS security code store karne se mana karta ha | UI text se | patch 29 - dono hataye; "no CVV, no PIN" copy ab sach ha |

**Khud ka kiya hua nuqsan jo suite ne pakra:** patch 27 ki pehli version `custom.stack` ko (jo number
tha) "ghareeb" samajh kar delete kar deta tha - haqeeqat mein woh legacy fan multiplier ha jo fold ab
bhi parhta ha. Do purane pouch checks laal ho gaye (`229.5px -> 229.5px`). Fix: numbers mehfooz, aur
donon (1.5, 0.4) ke liye naya regression check.

**Negative controls (har fix ke liye):** `replay_chain.py --upto N --swap` se bundle dobara banakar
poori suite dobara - upto 25 -> **127/141**, upto 26 -> **130/141** (theek Back rows), upto 27 ->
**139/141** (clamp + loader + import), upto 28 -> **145/147** (CVV rows). Yehi saboot ha ke checks
sachche han.

**Jo verify nahi ho saka (chhupaya nahi gaya):** hardware Back ki delivery, soft keyboard, rotation ka
visual, screen-size clipping, font scaling, camera/OCR/NFC asli silicon, WhatsApp hand-off, jank/
memory/ANR, `FLAG_SECURE`, Play signing/AAB/versionCode. Sab §5 of the handover report mein, saath
yeh ke kis row se band hoga. NFC ka status: is build mein NFC **hai hi nahi** (setting har load par
`!1` pin hoti ha, native plugin bhi nahi) - permission remove karna chahiye.

**Gates is round ke baad:** QA suite **147/147** (~119 s, 32 groups) · smoke **221/221** ·
`animation_audit` 10/1 purani WARN · `replay_chain` 465,046 B **IDENTICAL** (patches 1->29) ·
`verify_release` **28/29** (sole FAIL = debug cert, by design) · `apk_content_check` **40/40**.

**Build.** `CardWallet_qa_fixed.apk` — 11,653,889 B, sha256 `f543dddf3b38e30efcb0bd86dc0631f390e33da162f599175abda7a3f1961368`,
andar ka `index.js`/`index.css` tree se byte-identical. Debug key; pehle `adb uninstall
com.arena.cardwallet`. Release-signed artifact is code ke liye **maujood nahi** (repo ka
`CardWallet_release.apk` round-5 ka bundle ha - purana, handover ke qabil nahi).

**Verdict: NOT READY FOR CLIENT HANDOVER** — 0 critical, 6 major closed; baaqi device pass (plan §A-V,
khaas tor par §F aur §V1-V14) + ek release build with the production keystore.

---

## 19. Round 15 - Liquid Glass (selective), patch 30 + stylesheet, 2026-09-06

**Manga gaya:** premium Apple-jaisa *Liquid Glass*, lekin har jagah nahi - sirf ahem surfaces
(Settings panel, Custom Pouch container, create button, floating controls, Stack/Carousel controls,
live preview container, sliders, aur agar bottom floating action area ho). Shartain: parhne mein
easy, cards dominant rehain, hard glow/white borders na hon, light + dark dono par test, aur
performance/jank ka koi nuqsan nahi. Apple ke assets ya exact layout copy nahi karna.

**Design (do tiers, yehi asal faisla ha):**

| Tier | Kahan | Kya |
|---|---|---|
| **1 - asal blur** | bottom-sheet panel (`cw-glass-sheet cw-lg-primary`), create disc (`cw-lg-fab`) | `backdrop-filter: blur(30px) saturate(1.72) brightness(1.03)` (disc: 10px + saturate 1.9), upar specular sheen, 1px hair rim, ek soft depth shadow |
| **2 - "glass" magar blur nahi** | sliders, chips, swatches, rows, pouch tray (`cw-lg-pouch`), preview frame (`cw-lg-preview`), secondary buttons (`cw-lg-btn`) | translucent fill + hair rim + inner highlight - *kyunki yeh tier 1 ke blur par baithe han, inhein dobara blur karne ki zaroorat nahi* |

**Kyun (performance ka core):** nested `backdrop-filter` har element par ek compositor readback +
filtered layer maangta ha - 18 sliders/chips wahi karte to sheet 60 fps par hi atak jaati ✗ Is liye
poore app CSS mein sirf **4 selectors** blur karte han (`.cw-glass-sheet`, `.cw-scrim`,
`.cw-lg-primary`, `.cw-lg-fab`) - aur yeh number `apk_content_check.py` APK ke *andar se* verify karta
ha. Sheet khuli ho to DOM mein zyada se zyada **3** blurred elements (scrim + panel + disc), wallet
screen par akele **1** (sirf create disc) - dono QA checks han.

**Readability - yahan test ne asli bug nikala:** glass ke upar purana caption colour
(`--sub #8e8e93`, opaque sheet ke liye bana tha) **1.05:1** measure hua jab peeche kaali artwork thi
= literal taur par andarsh ✗✗ Fix: `--lg-ink` / `--lg-sub` (on-glass text tokens) + tint alpha
band 0.74-0.90. Ab `liquid_glass_audit.py` har surface ko **white / mid-grey / black** artwork ke
upar, **dono themes** mein composite karke WCAG ratio nikalta ha: light = 9.41 (body), 5.21
(captions), 11.52 (pouch tray), 14.15 (chips), 10.2 (disc glyph); dark = 9.67, 6.29, 8.66, 8.78,
13.00. Sab ≥ 4.5:1 ✓ (tier-2 controls *tier-1 ke andar* composite hote han, jaise browser karta ha.)

**Taste rules jo code mein daal de:** rim alpha ≤ .16 (white border nahi), koi `0 0 <bara blur>` glow
nahi, koi infinite keyframe nahi, koi permanent `will-change` nahi, `backdrop-filter`/`filter`/
layout properties kabhi animate nahi hoten, press = `transform:scale(.94)`, appearance = sheet ke
spring par `opacity:.92 -> 1` cross-fade.

**Contract jo toota nahi:** cards ka deck, flat-colour cover (round 9), header bar aur toasts par
koi glass nahi (`[data-cwc]` par `cw-lg` class ka na hona = check). Create disc ab bhi
theme-token-driven ha: `var(--solid)` -> `var(--lg-solid-glass)` (+ pinned tones
`var(--lg-glass-black/white)`) - is liye theme flip par rang badalta ha; 3 purane header checks
naye tokens par widen kiye aur ab woh alpha band + token inversion bhi check karte han.

**Fallbacks:** `@supports not (backdrop-filter:blur(2px))` -> opaque (COMPAT-1, Android 6-9 WebView),
`prefers-reduced-transparency` -> blur off + solid fills, `prefers-reduced-motion` -> transitions/press
off.

**Gates:** QA **173/173** (naya group 33: 26 checks) · smoke **229/229** (+8) · `liquid_glass_audit`
**60/60** · `apk_content_check` **54/54** · `verify_release` **28/29** (sole FAIL debug cert) ·
`replay_chain` patch 30 tak **IDENTICAL** (465,259 B) · `animation_audit` 10/1 (WARN purana, barqarar).
**Negative controls:** patch 30 hatao -> audit 54/60 + group 33 **17/26**; CSS block hatao -> group 33
**18/26** aur audit saaf verdict ke saath exit karta ha (traceback nahi).

**Build.** `CardWallet_liquid_glass.apk` — 11,656,321 B, sha256
`fc2a8bc6d849f9d955f53ddac8b7a69fdc131788f12afcb9efeed6f097054aa7` (debug key; pehle
`adb uninstall com.arena.cardwallet`). Visual preview (tokens se generated):
`docs/liquid-glass-preview.svg`.

**Device par dekhna ha:** plan ka naya section **W** (blur ka asli look, jank, banding, Android 6-9
par opaque fallback, reduced-transparency, light+dark artwork par caption contrast, camera sheet ke
upar double-blur cost). Bottom floating action area **maujood nahi** (is liye us par kuch nahi kiya -
sheet khud bottom par ha aur tier 1 le rahi ha).

---

## 20. Round 16 - header ke saare controls footer ke glass dock me (patch 31 + stylesheet), 2026-09-07

**Kya manga gaya:** "header pr jo b ha - create, search, setting - sab ko footer pr set kro, woh b
 Liquid Glass styling ke sath." Yaani top bar se teeno controls utha kar neeche ek floating glass pill
 me bithana, aur wohi material quality jo round 15 ne set ki thi. `Wallet` wordmark upar hi raha (woh
 app ka title ha, control nahi) - ab top row me sirf wohi ha, aur yeh assert bhi hota ha.

**Css-only mumkin nahi tha, is liye DOM re-wrap.** Wordmark aur teeno buttons ek hi row ke siblings the
 (`justify-end` wali fixed row) aur option menu usi row se anchored tha. CSS se row neeche le jate hi
 wordmark bhi neeche chal jata, aur menu ek soonay upar-konay mein point karta. To patch 31 structure
 badalta ha: top fixed container ke ab **do bars** hain - upar wahi row (sirf wordmark) aur neeche
 `pointer-events-none fixed inset-x-0 bottom-0 z-40` wali bar jiske andar dock row ha. Teeno `g(...)`
 button elements source se **verbatim** slice ho kar shift hue (patch pehle assert karta ha ke theek 3
 buttons mile, phir `node --check` lagata ha), aur dock jaan-boojh kar us container ka bacha ha jis par
 `ref:d` ha - bahar tap karne par menu isi ref se band hota ha.

**Dock asal glass surface ha, sheet ki copy nahi.** Us ka apna tier-1 material: radius 999 (pill, is
 liye 22px blur, sheet wala 30px nahi - itni choti cheez ko zyada blur karoge to smear hoti ha),
 `saturate(1.78) brightness(1.03)`, aur `--lg-dock-alpha` **0.80 / 0.84** banaya (sheet 0.74 / 0.82 ha) kionke dock ke neeche hamesha cards scroll hote hain.
andar ka create disc apna `backdrop-filter` haar
 jata ha - **blur nested nahi hota** - is liye blurred surfaces ki tadaad pehle jaisi hi: rest par 1
 (ab dock, disc ki jagah) aur sheet khule hue 3 (dock + scrim + panel). Audit yeh sab pin karta ha aur
 stylesheet me "ziada se ziada 5 selectors blur declare karte hain" ki budget APK me bhi check hoti ha.

**Upar khulta ha, aur deck rasta deta ha.** Option menu ab dock ke bottom-centre se anchor hota ha
 (`mx-auto mb-1 w-[248px]` + `transformOrigin: center bottom`), aur `<main>` neeche
 `calc(env(safe-area-inset-bottom) + 62px)` reserve karta ha - gesture inset padha jata ha,
 banaya nahi jata - taake aakhri card pill ke neeche na dabay.

**Gates:** QA **175/175** (group 33 me 28), smoke **237/237** (+8 `header/foot`, jin me More menu ka
 open/close live jsdom app me chal kar verify hona shamil ha), `liquid_glass_audit` **72/72** (+12),
 `apk_content_check` **60/60** on `CardWallet_footer_dock.apk`, `replay_chain` patch 31 tak
 **IDENTICAL** (465,259 -> 465,581 B; stylesheet 28,767 -> 30,752 B), `verify_release` **28/29**
 (sirf debug cert wala FAIL, jo design ha). Negative control: patch 31 nikaal do to smoke theek 8 naye
 checks par 229/237 ho jata ha aur group 33 27/28 - yaani checks decorative nahi hain.

**Device par dekhna ha:** section **X** (X1-X6) - GPU par moving deck ke sath blur ka asli composite,
 gesture-nav phone par safe-area ka gap, 5-inch phone par 123px pill me 36px controls ka comfort, theme
 flip + reduce-transparency, Android 6-9 par opaque `--sheet` fallback aur light/dark artwork par
 caption contrast. Handover verdict round 14 jaisa hi **NOT READY** ha; round 16 ne us me koi open item
 close nahi kiya.

---

## 21. Round 17 - dock header wali jagah, sheet ka blur kam (patch 32), 2026-09-07

**Kya manga gaya:** do baatein. (1) "Setting me blur kam karo, lag feel ho raha ha." (2) "Create, search,
 setting ko bottom par le ayo - *usi jagah* jahan oper thin." Round 16 ne teeno controls ko bottom me ek
 *centred* pill me daal diya tha; user ko woh nahi chahiye - unhe neeche chahiye, magar unhi x-positions
 par jo header me the.

**Alignment (patch 32, JS).** Dock ki row ko header row ka apna class string de diya
 (`pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-end gap-1 px-2`) aur glass
 ek naye bachay par le aaya (`cw-dock pointer-events-auto flex items-center`) jisme teeno buttons hain.
 Is se *column* har viewport width par upar wali bar jaisa hi ha, magar blur sirf ~140x48 pill ke liye
 dena parta hai - poori width ke bar ke liye nahi. Option menu bhi right-align ho gaya
 (`ml-auto mb-1 w-[248px]`) aur woh More button se phoot'ta ha (`transformOrigin: right bottom`), center
 se nahi. Chaaranchored string swaps, har ek "exactly once" assert ke sath, `node --check` gate ✓ aur
 `replay_chain` patch 32 tak **IDENTICAL** (465,581 -> 465,658 B).

**Lag ka asli sabab (stylesheet se parha hua).** Settings panel ka element
 `cw-glass-sheet cw-lg-primary` leke chalta ha - yaani tier-1 ka 30px blur - **aur** woh scrim ke *andar*
 ha, jo apne thaha 20px blur karta tha. Filtered ancestor panel ka *backdrop root* ban jata ha: compositor
 ko poora screen do baar read back + filter karni parni ha, aur sheet ke slide-in spring ke har frame par.
 Yehi jhatak tha. To: (a) scrim ab blur karta hi nahi - 24%/34% dim ke neeche 20px ka blur dikhta hi nahi,
 (b) `--lg-blur` 30px -> **14px**, (c) `--glass-blur` 34px -> **14px** taake dono declarations sehmat hon
 (jis ka bhi rule jeetey, radius wohi). Aur pill ka 22px jaan-boojh kar barqarar ha: cost = **area x
 radius**, is liye bari surface ko chota blur chahiye aur choti floating surface zyada afford kar sakti
 ha - round 15 ka "har surface ka apna blur/opacity" rule abhi bhi laagu ha. Settings khule waqt blurred
 surfaces **3 -> 2**, rest par 1. Material ke baqi hissay (tint tokens, sheen, rim, koi animated filter,
 koi `will-change`) jaise ke waisay ✓ wallet cards ka path sparsh nahi.

**Gates:** `liquid_glass_audit` **79/79** (72 -> 79: cost/radius ke 6 naye rules, purana "dock radius
 sheet aur control ke beech" rule naye model se replace; +2 JS rules ke dock row *asal mein* header row ka
 class string ha aur glass pill par ha, column par nahi), QA **177/177** (group 33 = 30: blurred-DOM
 count `<= 2` aur scrim usme shamil nahi; koi `.cw-scrim` backdrop-filter ya `--scrim-blur` bacha ha ya
 nahi - woh bhi check), smoke **239/239**, `apk_content_check` **62/62** on `CardWallet_footer_tuned.apk`
 (blur-selector budget 5 -> 4), `verify_release` **28/29** (sirf debug cert), glass ke through contrast
 round 16 se **barqarar** (legibility alpha se aati ha, radius se nahi: light 9.41/5.21/11.52/14.15/10.20,
 dark 9.67/6.29/8.66/8.78/13.00). Negative controls: patch 32 ka JS nikaal do -> smoke **237/239** (theek
 2 naye checks fail), stylesheet round-16 par wapas -> audit **74/79** (theek 5 round-17 rules fail) -
 yaani dono aadhe load-bearing hain.

**Harness ki theeki (taake agli baar koi app ka bug na samjhe):** naye jsdom me
 `element.style.backdropFilter = ...` accept hota ha magar `style` attribute me likha hi nahi jata, jis se
 `getAttribute("style")` par regex chalane wale **11 checks kisi bhi bundle par** fail hone lagay (round-16
 commit par bhi, byte-identical). `smoke_test_webview.mjs` ab un properties ko ek `inlineStyle()` helper se
 parhta ha jo CSSOM bhi dekh'ta ha, aur ek preview check `min-height: 0` ya `0px` dono qabool karta ha
 (React number ko unit ke baghair likhta ha) - koi assertion "pass ho jaye" is liye dheela nahi kiya gaya,
 sirh source badla ha jo chup kar value gira nahi sakta.

**Device par dekhna ha:** section **Y** (lag gaya ya nahi: Settings baar baar kholo/band karo, sheet khule
 waqt sliders drag karo, deck ko dock ke neeche se scroll karo; 14px blur par sheet parhne mein theek lagti
 ha ya zyada "khuli" lag rahi ha; pill ungli ke neeche theek usi jagah aata ha jahan header ke buttons the;
 right-aligned menu ki positioning; Android 6-9 fallback untouched). Handover verdict round 14 jaisa hi —
 round 17 ne koi open item close nahi kiya, maghi koi naya bhi nahi khola.

## 22. Round 18 - 4-digit lock + encrypted backup file (patch 33), 2026-09-09

**Kya manga gaya:** "code add kro like 4 digit unlock code" aur "Cloud Backup & Restore: agar user phone
change kare ya app delete ho jaye to cards zaya na hon". Teen scoping sawalon par user ne chuna: **file-only
backup** (na account, na Drive SDK), **cold start + 30 second background** par code (koi timer control
nahi, Settings me sirf ek switch), aur **5 galat koshishon par 30 second ka cool-down + "Reset app"** -
backdoor nahi chahiye tha, saaf likha hua.

**Kya bana (sab kuch ek reviewed source me):** `repo_export/patches/vault_src.js` bundle me append hota ha
(`patch33_vault_lock_backup.py` se, byte-for-byte; `replay_chain.py` ab patch 33 tak **IDENTICAL**, 494,450
B) aur `vault.css` `app/index.css` me (+5,225 B). Settings sheet me sirf **ek naya card** - "Lock & backup" -
ek switch aur teen row buttons, taake "minimum controls" ka rule na tute. Module ka apna store
`wallet.vault.v1` hai (settings ke saath mix nahi hota), us me salt + digest + rounds hain, **PIN kabhi
store nahi hota**.

**The gate.** `#cw-lock` `documentElement` par lagta ha, `display:none` se pehle - agar code enrolled ha to
pehli paint se pehle lock. Opaque rakha gaya ha (koi `backdrop-filter` nahi): wo usi data ko chupata ha,
blur uska kaam nahi. 4 digit boxes auto-advance, paste, backspace; galat code par `transform`-only shake
(`prefers-reduced-motion` me khatam). 30 second se zyada background par wapas aate hi dobara lock;
notification-shade jhalak (5 s) par kuch nahi hota. 5 galat codes -> 30 s countdown, boxes disabled.
Reset app = do tap, phir `localStorage.clear()` + reload. Back/gesture gate ke upar app ko bahar nahi
nikalta (history sentinel).

**The file.** Export: poora deck + settings ek JSON bundle ban kar **AES-GCM 256** se seal hota ha,
password se **PBKDF2-SHA256 150,000 rounds**, file `cardwallet-backup-YYYY-MM-DD.cwbak`. Jo chain pehle
se card-share me thi wahi chali: `navigator.canShare({files})` -> `navigator.share` -> `<a download>`.
APK repack hota ha, gradle build nahi, is liye koi naya native plugin possible nahi tha - yeh deliberately
"cloud" nahi, "file" ha: user Drive/Files/WhatsApp me khud rakhta ha. Import: file chuno -> password ->
confirm ("Restore N cards? replaces the M cards on this phone... cannot be undone") -> reload. Do guard:
jis file me `enc` block nahi us par **inkar** ("Backups are always encrypted"), aur `crypto.subtle` na ho
to export/import **refuse** hote hain - plaintext fallback kabhi nahi. `QuotaExceededError` (20 photo cards
≈ 16 MB, RELEASE-2 ka hi silsila) par mojooda deck salamat rehta ha aur message saaf aata ha.

**Imandari se likhi hui had:** PIN device-local gate ha, data ka encryption nahi - `localStorage` me cards
pehle jese hi rehte hain (Settings ka caption yehi kehta ha), aur PIN ka KDF jaan boojh kar sasta ha
(600 rounds, pure JS) taake low-end WebView par unlock pehle frame se pehle atke nahi. Phone badal kar
restore karne par lock **off** rehta ha - file me PIN nahi jata, aur naya phone = naya salt.

**Gates:** audit **96/96** (79 -> 96), QA **231/231** (group 34 = 54 checks: PIN digest Node me dobara
nikala gaya, asli `.cwbak` file Node ke webcrypto se round-trip, galat password reject, settings-in/lock-out,
junk file aur plaintext ka inkar, quota, reset, restore->reload spy), smoke **239/239** (control budget
2 -> 3 switches, button cap 22 -> 26 - card ke teen buttons hi hain), `apk_content_check.py` **70/70**
APK ke andar se (62 -> 70), `verify_release.py` **28/29**. Negative control: patch 33 ke bagair
audit **90/96** + smoke **238/239**, `--restore` par md5 `f987513e46c6` wapas.

**Teen findings jo agli baar ka waqt bacha lenge:** (1) `visibilitychange` **document** par fire hota ha,
window par listener use karne se auto-lock chup chaar mar jata (jsdom me proven) - ab dono par registered
ha. (2) Is repo me CSS `index.html` me **inline nahi** hota: `build_debug_apk.py` `assets/public/assets/`
ke andar JS aur CSS alag entries swap karta ha, `app/index.html` 1,185 B ka shell hi rehta ha - "re-sync
the inlined style" likhna ek aisi file edit karna hota jo hai hi nahi. (3) jsdom me `delete w.Date.now`
us realm ka asli `Date.now` hata deta ha (reassignment usko shadow karta ha), phir app ki har
`Date.now()` call throw karti ha - ek waqt yehi "auto-lock over-eager" ban kar nikla; ab fake clock save
kar ke restore karta ha. Aur ek purani galt jo notes me thi: `innerHTML` gate me allowed nahi (APK gate
puri app code me mana karta ha), is liye gate ka markup ab element calls se banta ha - 0 assignments.

**Handover:** verdict **wahi - NOT READY FOR CLIENT HANDOVER**. SECURITY-1 (FLAG_SECURE) is round ka maqsad
nahi tha aur **OPEN** ha; haan, 30 s background ke baad Recents ka thumbnail ab lock screen dikhata ha,
deck nahi - mitigation, fix nahi. Naya device section **Z** (12 rows) verify karna zaroori ha: cold-start
timing, keyboard ka digit boxes ke sath bartao, Share sheet/Drive par file, fresh install par restore,
Android 6-9 par subtle-crypto ka inkar, aur cool-down jab app background me ho.

## 23. Round 19 - customization gate: switch on ho tab hi card ki look badle (patch 34 + stylesheet), 2026-09-14

**Kya manga gaya:** "aik option add kro customization wo on krain tab hi customization kray skain card ki
wrna nhi or auto band ho wo". Teen scoping sawal (kya gate kiska kaam kare, kab band ho, default) chhordie
gae, is liye assumption likh kar banaya gaya - **default OFF**, gate **Settings → Custom Pouch** ke colour /
cover / stack-carousel controls ko band karta ha, aur **sheet band hone par (aur app background me jane par)
khud band** ho jata ha. Yeh choice neeche har jagah "assumption" ke tor par namood ha, chhupaya nahi gaya.

**Kya bana.** `repo_export/patches/customize_src.js` (3,875 B) bundle me append hota ha
`patch34_customization_gate.py` se, aur `customize.css` (659 B) `app/index.css` me. Custom Pouch card ke
`children` me do badlaw: `cw-cust-slot` (jaha module apna switch bana leta ha, `ref: e =>
window.__cwCust && window.__cwCust.mount(e)` - koi React state share nahi hoti) aur `cw-cust-body`, jisme
`design` + `layout` wrap ho jate han. Bundle 494,450 → **498,509 B**, stylesheet 36,600 → **37,259 B**,
`replay_chain.py` ab **patch 34 tak IDENTICAL** ha.

**Ek rule, poora kaam.** `html[data-cw-custom="off"] .cw-cust-body{display:none}` - module ka sirf kaam ha
ke `<html>` par `on`/`off` likhe. Is se teen cheezen khud-ba-khud theek ho jatin han: (a) **values apply
rehti han** - jo look user ne pehle set ki, gate band karne par wo qaim rehti ha, kyunke sirf controls
chup'te han; (b) **React ke sath koi jhagra nahi** - settings ka object uska apna ha, gate usme likhta hi
nahi; (c) **fail-open** - agar module kabhi na chale to attribute unset ha aur controls gayab nahi hote
(gate khona, customization khone se behtar ha). QA me teeno ka apna apna check ha.

**Auto-off kaise.** Do raste: (1) slot document se hat jaye - module 400 ms par `slot.isConnected` dekhta
ha, sirf tab jab gate **on** ha (band hone par `clearInterval`, koi document-wide `MutationObserver` nahi,
warna deck ki har animation par callback); (2) `visibilitychange` (document par, kyunke jsdom me
window tak visibilitychange propagate nahi hota) aur `pagehide`. `ref(null)` ko close nahi samjha jata -
har re-render par React purana ref null karta ha aur naya node deta ha, is liye drag ke dauran gate nahi
band hota (QA me yeh specifically test ha: 3 slider drags ke baad bhi `isOn() === true` aur slot me
**ek** row).

**Kuch bhi persist nahi hota.** Na `wallet.cwcustom.v1`, na koi key - state sirf page ke zindagi bhar
rehti ha. Yeh jaan boojh kar: "yaad rakha hua on" ka matlab ha "bhool gaya that auto-band wala rule".
Isi liye `localStorage`/`sessionStorage`/`document.cookie`/`indexedDB` module me ek bar bhi nahi aate
(audit + QA donon check karte han), aur backup/restore bhi gate ke baare me kuch nahi lete.

**Scope me nahi jo cheezen.** NFC, theme (System/Light/Dark chips), Lock & backup ka card aur pouch ka
live preview **gate ke bahar** han - unka taluq card ki look ke customization se nahi. Gate UI ka
control-budget sirf **ek switch** barha: sheet me 4 switches, 25 buttons, 7 chips (smoke + QA me count
pinned). Naya CSS sirf tokens reuse karta ha: **0 `backdrop-filter`, 0 colour literal, 0 `@keyframes`,
0 `box-shadow`** - vault card ki `.cw-vault-row/.cw-vault-switch/.cw-vault-on` classes use hoti han.
`innerHTML` bhi nahi (QA: 0 assignments).

**Gates (sab isi tree par, APK ke andar ka payload byte-identical):**

| Gate | Pehle | Ab |
|---|---|---|
| `liquid_glass_audit.py` | 96/96 | **105/105** (9 round-19 rules) |
| `smoke_test_webview.mjs` | 239/239 | **241/241** (2 new; switch budget 3→4) |
| `qa_feature_suite.mjs` | 231/231 | **259/259** (group "35 customization" = 28) |
| `apk_content_check.py` | 70/70 | **78/78** |
| `verify_release.py` | 28/29 | 28/29 (akeela FAIL jaan boojh kar: debug cert) |
| `replay_chain.py` | patch 33 tak | **patch 34 tak IDENTICAL** (498,509 B) |

**Negative control.** `replay_chain.py --upto 33 --swap` (bundle me patch 34 ke baghair; `--swap` sirf
`index.js` badalta ha, stylesheet chhoota rehta ha - is liye CSS-side rules legitimately pass hain):
audit **103/105**, smoke **239/241**, QA group 35 **7/28**. Pehli bar group 35 crash kar gaya tha
(`getComputedStyle(null)`) - theek kiya ke har lookup null-safe ha aur source-level checks pehle
`HAS19` maangte han, warna "feature nahi ha" ka natija test-fail ki jagah harness-crash ban jata ha.

**jsdom ki had.** `display:none` visibility checks jsdom ke cascade par chalte han (us version me attribute
selector + `getComputedStyle` kaam karta ha - pehle alag se prove kiya gaya), lekin **asli rendering, touch
target, TalkBack aur frame pacing is environment me test nahi ho sakte** - `docs/DEVICE_TEST_PLAN.md`
section **AA** (10 rows) isi liye ha. AA1 (on karte hi controls aeen, koi reload nahi) aur AA3 (band hone par
controls gayab, aur dubara kholne par gate band) handover gates han.

**Artifact:** `CardWallet_custom_gate.apk` - **11,668,844 B**, sha256
`4566eaa23743ffd187004623389997ff0bbea2e8145d004c9740618167a49eaf`, `repo_export/app/index.js`
498,509 B (md5 `10fcb590b62a75332a1aa2c5155ffcb1`) aur `index.css` 37,259 B, APK ke andar tree se byte-identical. Debug-signed
(throwaway key), `allowBackup=false`, release sign ki koshish **nahi** ki gayi. Install se pehle
`adb uninstall com.arena.cardwallet`.

**Handover:** verdict **wahi - NOT READY FOR CLIENT HANDOVER** (6 MAJOR device-unverified, RELEASE-1/2/3/4
aur SECURITY-1 OPEN). Round 19 naya risk add nahi karta - na permission, na native code, na storage key,
na blurred surface - lekin yeh pehla control ha jo **UI ko chupata ha**, is liye AA ki 10 rows zaroori han:
agar kisi device par switch on hone par bhi controls na aayen, ya off par kaam karte rahen, to gate khuli
hawa ha. Yeh **UX guard ha, security control nahi** - card data `localStorage` me waisa hi ha asha ta
pehle tha, aur copy me kabhi "protected" nahi likha gaya.

## 24. Round 20 - scroll gesture ke dauran cards side me shift nahi hote (patch 35), 2026-09-16

**Kya report hua:** *"while scrolling through the passes the cards sometimes shift/slide off to the side
instead of staying properly centred/stacked in the carousel ... intermittent"*. Do alag races the, dono
ship-shuda bundle par jsdom me reproduce kiye gaye (numbers ek throwaway jsdom probe se, fix se **pehle** - wahi numbers ab smoke Test 6f/6h me pinned han) -
yeh layout ka masla nahi tha, is liye koi constraint/padding change nahi hui.

**Defect 1 - patch 14 ka watchdog live finger ke neeche se row kheench leta tha.** Patch 14 "gesture chori
ho gaya" ka faisla 340 ms ki *event-khamoshi* se karta tha, lekin drag ke dauran **ruki hui** ungli bilkul
wahi khamoshi paida karti ha: row nearest card par commit ho kar `d.jump(0)` se **106 px** side me uchhal
jati thi, aur agla `pointermove` poora gesture delta naye base se dobara laga deta tha (doosra **170 px**
jhatka). 200 px ka drag, 800 ms ruk kar phir jari: `-509.3 | -307.7 | -106.1 | 95.5 | 297.1` ->
`-403.2 | -201.6 | 0.0 | ...` -> `-573.0 | ...`. Jarh: `mv` `k+s` par chalta tha jahan `k` pointerdown par
capture hua tha - is liye jo bhi cheez `d` ko gesture ke peeche se hilati thi (watchdog, index effect), agli
move ko jump bana deti thi.

**Defect 2 - stack me recovery hi nahi thi, aur cancel ek tap tha.** `__cwStack` ko patch 14 kabhi nahi
mila: system ka khaaya hua gesture deck ko fractional index par **hamesha ke liye** chordeta tha
(`0.0 | 229.5 | 459.0 | 688.5` -> `-225.8 | 3.7 | 233.2 | 462.7`, 2.5 s aur 4.5 s baad bilkul wahi),
`drag.current` set reh jane se `drag.current||p.jump(r)` guard ki wajah se deck index changes par bhi nahi
hilta tha, 480 ms ka long-press timer chalta reh jata tha, aur `pointercancel` **tap** handler par laga
tha - bina kisi movement ke ek cancel us card ko khol deta tha jis par ungli thi.

**Fix ka rule: ungli glass par ho to row uski ha.** Ek injected helper `__cwPtr` batata ha ke kaun down ha
(pointerdown -> up / cancel / lostpointercapture) aur `held()`, `quiet(ms)` aur `onGone` deta ha - jahan
`onGone` WebView ke stream hamesha ke liye khone ke teen asli signals par chalta ha:
`visibilitychange` (hidden), `blur`, `pagehide`. App ko background karne wala gesture (patch 14 ki apni
device report: neeche ka gesture strip **home/recents** gesture hi ha) inhi me se ek signal deta ha, is
liye recovery **foran aur invisible** hoti ha; sirf ruki hui ungli inme se kuch nahi deti, is liye row ko
koi haath nahi lagata. 1500 ms ka net sirf us ek case ke liye ha jahan koi signal hi na aaye.

**Recovery glide karti ha, aur index commit nahi karti.** Patch 14 `d.jump(0)` + index commit karta tha;
ab carousel apne maujooda `Cd` tween par ghar jata ha aur index **badalta nahi** - kisi bhi arbitrary
offset par commit seamless ho hi nahi sakta (fan ko `slide - sideGap` = ~101 px hilata ha), is liye recovery
user ko usi card par wapas le jati ha jis par wo tha, aur rest state bilkul 0 hi rehti ha. Stack ki recovery
`snap()` ha, jo index-based ha - is liye by construction smooth tween.

**Drag ab live value par rebase hoti ha** (dono views me): har move par code apne last write se compare
karta ha, aur agar kisi aur ne row hil a di to pointer ka origin rebase hota ha, pehle kharch ho chuke
deltas dobara nahi lagte. Isi wajah se "cards side me drift nahi karte" luck ki jagah construction se sach
ha - aur settling row (ya chori-shuda gesture ke baad off-centre row) ko pakadne par ab snap nahi hota.

**Stack ko patch 14 ki guarantee bhi mil gayi:** cancel ek abort ha (nearest card par `snap`, kabhi open
nahi), `pointercancel` long-press timer clear karta ha, aur idle watchdog nearest index commit karta ha,
`drag.current` **aur** gesture ke listeners (`kill.current`) release karta ha - is liye index changes dobara
deck ko hilate han. Carousel me `g.current` ab settle-to-zero khatam hone par clear hota ha - pehle ek
**khatam-shuda** animation usme pari rehti thi, jo watchdog ke `if(g.current)return` guard ko chupke se
agla touch aane tak band kar deti thi (report ka "sometimes" yehi tha).

**Koi nayi motion language nahi:** wahi springs, wahi snap targets, wahi thresholds (18 px carousel
release, 360 px/s flick, 6/16 px axis lock, 480 ms long-press). Sirf ek jagah jump ki jagah glide aayi ha -
audit ka spring inventory badla nahi.

**Gates (sab isi tree par, APK ke andar ka payload tree se byte-identical):**

| Gate | Pehle | Ab |
|---|---|---|
| `smoke_test_webview.mjs` | 241/241 | **261/261** (Test 6f extended + naya Test 6h) |
| `qa_feature_suite.mjs` | 259/259 | **281/281** (naya group "36 gestures" = 22) |
| `apk_content_check.py` | 78/78 | **78/78** (`CardWallet_gesture_fixed.apk`) |
| `verify_release.py` | 28/29 | 28/29 (akeela FAIL jaan boojh kar: debug cert) |
| `animation_audit.py` | 10 / 1 warn | 10 / 1 warn (wahi layout-property warning) |
| `liquid_glass_audit.py` | 105/105 | **105/105** |
| `replay_chain.py` | patch 34 tak | **patch 35 tak** (previous bundle + patch35 byte-identical) |

**Negative control.** Bundle **patch 35 ke baghair** (= pichhla shipped payload): smoke **246/261**
(13 naye checks fail - jinme *"front card x 58.36 -> 0.00px across a 900ms hold"*, yani bilkul wahi
reported symptom, aur *"the sheet opened on a cancel"*), QA group 36 **9/22**. Prone base bundle tree me
nahi ha, is liye chain ko *pichhle shipped bytes + patch 35* se verify kiya gaya - nateeja byte-identical
nikla, yani patch 14 ke waqt qaim kiya gaya "tree == scripts ka output" property ab bhi sach ha.

**Artifact:** `CardWallet_gesture_fixed.apk` - **11,669,260 B**, sha256
`d9370f9cfe91bfd04e15f951223dfe619896766d782ba3b9f98748381803ba6f`, `repo_export/app/index.js` 499,851 B.
Debug-signed (throwaway key, `repo_export/signing/debug-local.p12`), `allowBackup=false`, release signing
ki koshish **nahi** ki gayi (`release-key.p12` is environment me mojood nahi). Install se pehle
`adb uninstall com.arena.cardwallet`.

**Handover:** verdict **wahi - NOT READY FOR CLIENT HANDOVER** (device-unverified MAJOR items waise hi
khule han). Is round ka apna device work `docs/DEVICE_TEST_PLAN.md` section **AB** (8 rows) ha - us me se
**AB1** (normal scroll me cards side me na jayen) aur **AB2** (ajeeb swipe ke baad deck jawab deta rahe)
handover gates han.

## 25. Round 21 - header ke "Wallet" label hata diya gaya (patch 36), 2026-09-16

**Ask, verbatim:** *"Remove the \"Wallet\" text label shown at the top-left of the screen (the app
title/header text). Keep the rest of the header layout (search icon, menu icon, add button etc.) intact -
just remove that text element, don't leave empty spacing or misalign the remaining icons after removal."*
Ye label round 9 ka mandate tha (patch 17: *"header pr top left corner pr bara bold Wallet likho, font ios
wala ho"*) - yani is round me client ne apna hi purana ask override kiya, aur wo override documented ha
(patch 17 me `SUPERSEDED` entry, taake chain ka `--check` apni hi edit ko pehchane).

**Jo asal me screen par tha (bundle se naapa gaya, farz nahi kiya):** top-left "Wallet" ek `span` tha
(28 px / 800, `var(--ink)`), aur round 16 (patch 31) ke baad woh **header row ka wahi ek child** tha -
Add / Search / More pehle hi footer dock me ja chuke the. Yani ask me jo controls likhe han (search,
menu, add) woh label ke bhai-behen kabhi the hi nahi, is liye unka misalign hona is change se mumkin nahi.
Jo container `ref:d` rakhta ha (bahar tap par option menu band karta ha, aur dock us ka child ha) woh,
dock bar, dock row, menu, aur dono reserves - sab byte-identical rahe. **Patch sirf ek span ko chhoota ha.**

**Row kyun rakhi gayi:** khali flex row zero-height hoti ha (na text, na button, na apni padding) aur
container `pointer-events:none` ha - is liye na koi patli strip dikhti ha na koi tappable dead zone banti
ha. Do invariants bach jate han: patch 17 ka rule ke dock row literally header row ki class string ha
(glass audit `TOP_ROW_CLASS` ko **2** baar ginta ha, aur QA group 33 `dock.parentElement.className ===
headerRow.className` assert karta ha). Row hataane se dono tootte - bila faide.

**Reserves kyun nahi chhote:** main column upar `safe-area + 58 px` aur neeche `safe-area + 62 px` reserve
karta ha (round 16/17). Deck in dono ke beech centre hota ha, is liye upar ka reserve label ki height
jitna kam karne se **har card** hilta - ask tha label hataana, wallet dobara layout karna nahi. Kuch bhi
nahi hila. (Agar aage chal kar top band tight karna ho to woh apna alag, naapa gaya change ha: deck aadhe
delta jitna upar aayega.)

**Marker convention:** `/*cardwallet:header*/` barqarar ha - ye patch 8 ka marker ha, aur
`apk_content_check.py` isi se app-code ka start dhoondta ha (injection checks ka scope), aur
`verify_release.py` ise literal assert karta ha. Span ki jagah `/*cardwallet:no-wordmark*/` aaya ha - ye
positive proof ha ke removal chala (smoke checks, content check, glass audit aur patch 17 ka naya
`SUPERSEDED` entry isi ko dekhte han). Ye entry ek purani `--check` regression bhi theek karti ha: patch 17
ka wordmark edit round 16 ke baad se **STALE** parh raha tha (patch 31 ne buttons header row se hata diye
the), aur ab dobara applied parhta ha).

**Gates:** web smoke **261 -> 262/262** (teen wordmark checks ab absence checks han; naye checks: dock ke
teen controls jahan the wahan han, reserves untouched, header row aur dock row ka geometry twin barqarar,
container ab bhi `ref:d` ka malik), QA suite **281/281** (group 1 ka header check aur group 33 ka dock
check ab label ki gair-mojoodgi assert karte han), `apk_content_check.py` **78 -> 79/79** (naye marker ki
positive row + `MUST_NOT` taake label wapas na aa sake), `liquid_glass_audit.py` **105/105** (preview SVG
ab wordmark nahi banata), `animation_audit.py` 10 checks / 1 warning (wahi - is patch me koi nayi motion
nahi), `verify_release.py` **28/29**.

**Negative control:** pichhla bundle (`CardWallet_gesture_fixed.apk` ke bytes) - smoke me **4 checks
fail** (row khali nahi, 1 wordmark span mojood, marker ghaayab, `ref:d` row ab bhi bhara), aur
`apk_content_check.py` ki **4 rows** fail, aur QA group 33 me **1** check (29/30 ho gaya). Isi kaam me ek
trap bhi pakra gaya: QA group 1 ka pehla draft `!/\bWallet\b/.test(text)` tha aur woh **pre-fix** bundle
par bhi pass ho gaya, kyunke `textContent` bina separator jorta ha - root `"WalletPlatinum Debit Card..."`
parhta ha, is liye word boundary kabhi match nahi karti. Ab woh **element** ginta ha, jo pakarta ha
(pre-36 par group-1 family me 1 fail).

**Artifact:** `CardWallet_no_title.apk` - **11,669,121 B**, sha256
`75f86c0024ab7b1010e50a292694fbf7979190ae0c66cec4f08b52ab58f15ad4`, `repo_export/app/index.js` 499,516 B.
Debug-signed (wahi throwaway key, `repo_export/signing/debug-local.p12`), `allowBackup=false`, release
signing ki koshish **nahi** ki gayi (`release-key.p12` is environment me nahi). Install se pehle
`adb uninstall com.arena.cardwallet`.

**Handover:** verdict wahi - **NOT READY FOR CLIENT HANDOVER** (device-unverified MAJOR items waise hi
khule han, aur round 20 ke AB1/AB2 ab bhi handover gates han). Is round ka apna device work
`docs/DEVICE_TEST_PLAN.md` section **AC** (5 rows) ha - khaas kar AC2 (deck ki position pichhle build se
compare - kuch nahi hilna chahiye) aur AC3 (khali corner par tap/long-press/drag se kuch na ho, aur menu
bahar-tap par band ho).

## 26. Round 22 - overflow menu dobara theme ke saath chalta ha (patch 37 + stylesheet), 2026-09-16

**Report, verbatim:** *"In Light mode, the app's overflow menu (the dropdown showing \"Settings\" and
\"Delete all cards\") is still rendering with a dark/black background instead of following the light theme.
Every other UI element on screen ... correctly switches to light mode - only this specific popup menu
stays hardcoded dark."* Ask tha: menu ke *"background, text, and icon colors"* ko theme se bandho aur
System / Light / Dark teeno me confirm karo.

**Ye kahan se aaya:** asal (stock) panel themed tha - `rounded-2xl sheet-bg` + `var(--line)` border. Round
4 (patch 7, "header look" mock) ne `sheet-bg` hata kar use `#0b0b0d` panel bana diya tha, aur usi patch
me likha tha: *"that was an explicit choice, not an oversight, so it does not invert"* - us waqt app sirf
light thi. Uske baad har round ne app ko theme-aware banaya (System/Light/Dark) aur surfaces tokens par
le gaya - bas yehi ek surface apne literals par reh gaya. Report ka screenshot bilkul wahi ha.

**Fix:** panel `#0b0b0d` -> `var(--sheet)`, hairline `rgba(255,255,255,.14)` -> `var(--line)`, rows
`#fff`/`#ff453a` -> `var(--ink)`/`var(--danger)`, aur drop shadow - jo ek value kisi mojood token se
nahi banti aur light vs black backdrop par alag honi chahiye - `--menu-shadow` ban gayi, dono themes ke
liye ek ek baar round-22 block me (`:root` = `rgba(15,23,42,.28)`, `html.dark` = `rgba(0,0,0,.75)`).
`#0b0b0d` bundle se poori tarah nikal gaya. Icons ka koi alag kaam nahi chaha: menu ke `<svg>`s
`currentColor` par stroked han, is liye row ke colour ke saath invert ho jate han - report ka "and icon
colors" wahi ek declaration ha jo labels ko theek karta ha.

**Jaan-boojh kar nahi chhua:** camera view (live feed par dark chrome), full-screen card viewer (`#000`,
Photos jaisa), sheet scrims (`rgba(10,10,12,.45)`), toast pill (`rgba(20,20,22,.92)`) aur card artwork -
ye sab jaan-boojh kar theme-independent han. "Delete all cards" ka confirm sheet pehle se themed tha;
sirf us ke destructive button par compiled `text-[#ff453a]` class ha, jo wahi rehti ha - dono themes me
ek hi red, bilkul jaise vault ka `--danger` (aur ab menu ki destructive row bhi wahi token use karti ha).

**Is round ne chain ki teen latent bugs pakri (sab ek hi shakal ki):** round 18, 19 aur 22 har ek
stylesheet **block append** karta ha, aur kai tools apne block ko *"mere banner se file ke end tak"*
samajhte the - jo chupke se har baad ke round ko bhi apne andar le leta ha. Round 22 append honay ke baad
un slices ne round 18 ke block ko round 22 ka shadow literal, round 19 ko "bara" aur round 19 ke "no colour
literal" rule ko fail karwa diya. Patch 37 ke apne pehle draft me ulti taraf wahi bug tha (us ne banner ko
fixed `=` run se match kiya jo round 19 ke banner se bhi match ho gaya, aur round 19 ka block rewrite kar
diya) - commit se pehle pakra gaya, aur isi liye ab file ke aakhir me guard list ha. Fix: patch 33/34 ka
`sync_appended` aur audit ke `V18`/`V19`, `apk_content_check.py` ke round-18/19 rules aur QA group 35 ka
`R19` ab **banner -> next banner** convention use karte han; patch 37 khud guess karne se inkaar karta ha
aur assert karta ha ke round 15/16/17/18/19 ke blocks aur gate ke dono rules stylesheet me mojood han.
Patch 7 me `DOWNSTREAM_KEEP` entries aayi han taake uska `--check` in tokens ko apna kaam samjhe (wahi
trick jo patch 21 button sizes ke liye use karta ha).

**Gates:** web smoke **262 -> 266/266** (panel/rows checks ab token-level han - jsdom inline style me
`var()` resolve nahi karta, is liye woh assert karte han "ye token ka naam leta ha *aur* dono themes me
token alag resolve hota ha" - saath me usi menu ka dark-mode pass aur `currentColor` icon check), QA suite
**281 -> 283/283** (group 33: panel token-bound aur tokens ulta resolve karte han),
`apk_content_check.py` **79 -> 83/83** (do positive rows, ek `MUST_NOT` taake near-black panel wapas na
aa sake, aur dono themes ka `--menu-shadow` rule), `liquid_glass_audit.py` **105 -> 111/111** (menu rows
**18.86:1** light / **15.63:1** dark; destructive row naapi aur 3:1 affordance floor par gated -
**3.41:1** light / **6.03:1** dark, app ka mojooda system red), `animation_audit.py` 10 checks / 1 warning
(barqarar - koi nayi motion nahi), `verify_release.py` **28/29**.

**Negative control:** pichhla bundle - smoke **260/266** (6 checks fail: panel `rgb(11, 11, 13)`, rows
`rgb(255, 255, 255)`), `apk_content_check.py` **77/83** (4 nayi rows), QA group 33 **30/32**.

**Artifact:** `CardWallet_themed_menu.apk` - **11,669,355 B**, sha256
`163c7cbbd4ec3e807857988481f48f233dd640856fe72c8ea389d3c2554deb57`, `repo_export/app/index.js` 499,506 B
(+ `index.css` 38,011 B). Debug-signed (wahi throwaway key), `allowBackup=false`, release signing ki
koshish **nahi** ki gayi. Install se pehle `adb uninstall com.arena.cardwallet`.

**Handover:** verdict wahi - **NOT READY FOR CLIENT HANDOVER**. Is round ka device work
`docs/DEVICE_TEST_PLAN.md` section **AD** (5 rows) ha: menu Light me, Dark me, aur System me phone toggle
karte hue - aur bahar-tap par dismissal. Round 20 ke **AB1**/**AB2** ab bhi handover gates han.
