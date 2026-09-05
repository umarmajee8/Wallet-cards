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

<!-- The literal `#000`/white styling in the two rows above is what the mock implies and
is what shipped in this pass; §7 replaced it with theme tokens after the first
device report. Read the two sections together. -->

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

## 8. Pouch style picker, Paper preset, add-card pill (patches 9-11), 2026-09-05

**Khulasa (Urdu):** Aap ne pouch wali picture di — *"bilkul picture jesa ho, add
card wala text remove kr dena, baki sab same"*. Do cheezein baneen: (1) pouch ka
style aap ki picture jaisa (**Paper** preset: halka felt, dashed seam, no rivets),
aur (2) **add-card ki capsule/pill** jo picture mein pouch ke neeche-right thi —
wahi 208x56 capsule, bagal mein grey `+` disc, **"Add Card" text hata diya**.
Settings se pill sirf **empty wallet** par dikhti hai (aap ne wahi choose kiya).

Lekin isse pehle ke koi preset kaam kare, do **pre-existing bugs** dhape:

1. `repo_export/app/index.js` aur base APK **drift** kar chuke the: "Pouch style"
   section base APK mein tha, bundle mein nahi — aur build sirf bundle inject karta
   hai. Matlab aapke phone ke build mein pouch-style picker **tha hi nahi**
   (README ke dawa ke bawajood). patch 9 ne woh section wapas bundle mein daala.
2. Settings loader har load par saved `theme` ko `slate` par force kar deta tha
   (`n.theme = 'slate'` in the stock code). preset choose karne par value
   localStorage mein likh jati thi aur agle start par phenk di jati thi — picker
   decorative tha. patch 9 ne woh pin hata diya. Fresh installs ka look nahi badla,
   kyunke default `theme:slate` hi hai.

Aur ek nuance: default **Design = Slate** tray ka background card ke colour se
tint karta hai aur theme ka gradient ignore karta hai — is liye patch 10 ne Paper
ko us re-tint se exempt kar diya (the tray branch now checks `v.id !== 'paper'`), warna
aap ki picture ka halka felt default design par kabhi nahi banta.

### Bundle-level diff (behaviour)

| area | before | after |
|---|---|---|
| Settings -> Pouch style | section absent from the shipping bundle | restored, 4 presets (Frosted / Steel / Emerald / Paper) |
| saving a preset | written, then forced back to `slate` on next load | honoured — survives restart (asserted by a reload test) |
| `Paper` preset | n/a | light felt tray `#f7f6f4 -> #e3e1dd`, white sheen, dark hairline edge, sleeve `#f1efec/#dedad5`, grey dashed seam `rgba(151,147,142,.72)`, rivets off |
| add-card control | header `+` only | header `+` **plus** the mock's wide capsule over the pouch area (empty wallet only), grey `+` disc at the left, **no label** |
| that capsule's menu | n/a | same capture routes as the header `+`; anchored to the bottom so it opens **upward** (`fixed inset-x-0 bottom-0`, origin `96% bottom`, spring from below) |
| colours of the new control | n/a | `var(--solid)` / `var(--on-solid)` / `var(--sub)` / `var(--line)` - legible on the dark Frosted pouch and on light Paper; deliberately not literal `#000` (that was this session's §7 lesson) |

Two decisions were yours and are encoded as such: the pill's **width is the
picture's** (208x56) with only the text removed, and it is **empty-state only**.
Default theme/pouch was left alone on purpose, so nothing changes for an install
that does not go looking for it.

### Gates re-run

- `smoke_test_webview.mjs`: **83/83** (was 64) — 19 new checks: picker present,
  four swatches, Paper writes `theme=paper`, the choice survives a reload, Paper's
  tray renders in the DOM in *both* designs (and the Slate card-tint is what a
  naive patch would have shipped), default render unchanged, pill hidden with cards
  / shown when empty, `textContent === ""` (the label removal is asserted, not
  assumed), 208x56 + `+` disc geometry, tokens-not-literals, tapping it opens the
  capture routes, bottom-anchored panel, dismiss + haptics path, header `+` intact,
  zero console errors in all three scenarios.
- `verify_release.py`: **28/29** on the new APK (only `sign: signer subject is not
  a debug cert`).
- patch 7-11 re-ran as a chain from the stock bundle: **byte-identical** output;
  every `--check` now reports "applied" instead of false STALE (patch 7 also
  tolerates its own output being re-worded downstream by patch 11).
- `animation_audit.py`: 10 checks, same single pre-existing WARN (layout-property
  animation) - nothing added by this pass.

New artifact: `CardWallet_header_black.apk` (**11,649,098 bytes**), sha256
`9e0852d82c0cc2d18ca8ec7be28ac52969fa649010856307c91e719d368ddc06` — debug-signed
with the same key as your current install, so `adb install -r` updates in place
(no uninstall, no data loss). The filename still says "header" for link
stability; it now also carries the pouch picker, Paper and the pill.

**Not verified on a device** (status line above still applies): see
`docs/DEVICE_TEST_PLAN.md` §M for the pouch/pill checks.
