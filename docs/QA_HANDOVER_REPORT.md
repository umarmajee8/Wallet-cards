# Final production QA & client-handover report — Card Wallet

App: `com.arena.cardwallet` · versionCode 1 / versionName 1.0 · minSdk 23 · targetSdk 35
Build under test: **`CardWallet_qa_fixed.apk`** — 11,653,889 bytes,
SHA-256 `f543dddf3b38e30efcb0bd86dc0631f390e33da162f599175abda7a3f1961368`
Web payload inside it: `repo_export/app/index.js` 465,046 bytes (md5 `5a6cf9626528675445baaa3b9eb41b0e`),
`repo_export/app/index.css` 20,086 bytes (md5 `4037f6c0c1df5f1b0ddd33331891e611`) — both verified
byte-identical to the reviewed tree.
Signed with: throwaway **debug** key (see RELEASE-1). Date: 2026-09-06.

---

## 0. How this QA pass was actually run (read this before trusting any PASS)

| Layer | Tool | What it really exercises |
|---|---|---|
| Behaviour | `node repo_export/patches/qa_feature_suite.mjs` (new, 147 checks) | The real React bundle booted in jsdom as an Android-WebView-shaped window: cards created through the gallery input, edited, deleted, sliders dragged, storage corrupted, batches of 50 cards, 25 open/close cycles, restart = a fresh boot reading the same `localStorage`. Events are real `MouseEvent`/`Event` dispatch through React's delegated listeners. |
| Behaviour (regression) | `node repo_export/patches/smoke_test_webview.mjs` (221 checks) | Every UI contract shipped in rounds 7-13, re-checked on this bundle. |
| Reproducibility | `python3 repo_export/patches/replay_chain.py` | The shipped bundle is rebuilt from the stock bundle + patches 1→29 and compared byte-for-byte. |
| Package | `python3 repo_export/patches/verify_release.py <apk>` (29 checks) | zip/CRC, v1+v2+v3 signatures, single non-debug signer, key size, 4-byte alignment, `allowBackup=false`, `debuggable` off, cleartext off, min/target SDK, no exported provider, unchanged package id and permission set, payload matches the tree, header config compiled in. |
| Payload | `python3 repo_export/patches/apk_content_check.py <apk>` (new, 40 checks) | The behaviour list above is really inside the APK, and the removed features / injection surface stay out. |
| Static style | `python3 repo_export/patches/animation_audit.py` (10 checks) | Which animated properties are layout-triggering, blur usage, the `--p` slider paint contract. |

**No physical device, no Android SDK, no emulator, no release keystore exists in this environment.**
Everything that needs real hardware, the real Back key, the soft keyboard, GPU frame pacing, memory,
or Android's UI is therefore listed in **§5 NOT VERIFIED** and must be run through
`docs/DEVICE_TEST_PLAN.md` before handover. This is stated instead of being dressed up as a PASS.

A test that cannot fail is not evidence, so every fix in this pass was also run as a **negative
control** (`replay_chain.py --upto N --swap`, i.e. rebuild without that fix and re-run the suite):

| Control | Removed | QA-suite result |
|---|---|---|
| patch 25 out | preview stage sizing | 127/141 — preview + import + back + clamp rows fail |
| patch 26 out | Back handling | 130/141 — exactly the 3 Back rows fail (and 11 later ones) |
| patch 27 out | settings clamp + loader | 139/141 → the 8 clamp/geometry/data-loss rows fail |
| patch 28 out | import feedback | 139/141 → exactly the 2 import-report rows fail |
| patch 29 out | CardIO fallback + CVV | 145/147 → the 2 CVV rows fail (share fallback is source-level only, see §5) |

---

## 1. Verdict

# NOT READY FOR CLIENT HANDOVER

Zero CRITICAL issues remain, and 6 MAJOR issues were found and fixed in code with regression re-run
afterwards (147/147 + 221/221 green, replay IDENTICAL, 40/40 in-APK content checks). What blocks
approval is not "the app doesn't work" — it is that **major items cannot be closed from this
environment**: the six fixes have never been pressed on a phone, the release-signed build does not
exist, and four native/manifest decisions (soft-keyboard resize, screenshot protection, NFC and
external-storage permissions) are still open. The client's own rule is the one applied here:
approve only when CRITICAL and MAJOR are zero **and** the full regression has been run on the device.

**Ready when:** section V of `docs/DEVICE_TEST_PLAN.md` is signed off on a physical phone, and
RELEASE-1/2/3 below are closed. That is roughly a half-day of device time plus one release build.

---

## 2. Results by the requested checklist (1-30)

Status legend: **PASS** = executed and verified here · **PASS\*** = verified at jsdom/static level,
the hardware half in §5 · **NOT VERIFIED** = could not be executed here, needs device/build.

| # | Area | Status | Evidence / what was actually done |
|---|---|---|---|
| 1 | Installation | **PASS\*** | First launch with empty storage boots with 0 script errors; specimen deck (4 cards) renders; no network call, no service worker; settings are not written until the user changes them. Reinstall = boot on cleared storage → only specimen data. Real `adb install/uninstall` → §A of the device plan. |
| 2 | App launch / cold-warm-bg-fg | **PASS** | 6 consecutive cold starts, all interactive, 0 errors; 12 visibility+resize+focus cycles in a row leave the tree intact; force-close mid-drag leaves loadable state (QA `2 launch`, `22 stress`). |
| 3 | Home wallet | **PASS** | Empty state ("Wallet is empty" + hint) · 1 card · 4 · 6 · 20 · 50 cards (no DOM explosion, <400 buttons) · 400-char title, 2000-char field, Arabic/Devanagari/emoji/RTL, blank title, field-less card — all render with 0 errors. Card clipping / screen-overflow geometry: jsdom has no layout engine → device row V8. |
| 4 | Create card | **PASS** | Rapid 15× taps on Create open exactly one import menu and write nothing; gallery input (`accept="image/*" multiple`) drives the real crop sheet; Cancel writes nothing; crop Save adds **exactly one** card even with 9 rapid Saves; the new card's title renders and survives a restart; 5,000-char + NUL + bidi title stores intact, parses, paints, survives restart; unreadable file → announced (patch 28). Camera capture → §B/§C. |
| 5 | Edit card | **PASS** | Card sheet → *Card details* → editor → `Card name` changed → Save → storage updated immediately, and after a restart the edit is still there. Rapid Saves do not duplicate. |
| 6 | Delete card | **PASS** (held card) | Delete from the card sheet removes exactly one card, the deck index stays inside the list (no blank wallet), and it stays gone after a restart. Cancel changes nothing. *Delete-all* via More → confirm → empties, restart does not resurrect, Cancel keeps all 6. Middle/last-card delete needs the deck swipe, which jsdom cannot drive honestly → device row V13 (same reducer, filtered by id + `wd(index,len)` clamp). |
| 7 | Data persistence | **PASS** | Stack block (overlap/vOff/visible/size/rot/shrink/spacing/gap), carousel block (size/gap/side/peek/pos), `view`, and pouch colour all round-trip; nothing silently resets; `custom` is identical after a restart. Two intentional resets exist by design: `nfc` and `autoDetect` are forced off at load (see MINOR-1). |
| 8 | Stack layout | **PASS** | Stack rows present (overlap/vertical-offset/scale/rotation/visible-cards/spacing) and carousel-only rows absent; every stack slider at min/mid/max keeps ≥3 cards sized inside the preview box; ≥3 stacked cards are the real component, not a picture; preview and wallet read the same `custom.stack`. |
| 9 | Carousel layout | **PASS** | Carousel rows present, stack-only rows absent; `sideGap/posX/sideOp` geometry recompute on all six fields; live preview updates per view; carousel ignores stack settings (pouch geometry byte-identical with stack pushed to every extreme). |
| 10 | Stack ↔ Carousel | **PASS** | 12 rapid switches mid-sheet: 0 errors, cards still staged, each view keeps its own block (`stack.overlap` unchanged after carousel drags and vice-versa); data unchanged by switching. |
| 11 | Sliders | **PASS** | 220 rapid full-range drags leave a valid in-range value; row and stored value agree on release; no jump/lag defects visible in the harness (quantised canvas cache + one rAF coalesced write, both asserted in the smoke suite). Real frame pacing → §5 V11. |
| 12 | Design settings | **PASS** | 10 pouch-colour dots + wallet colour + Radius/Shadow/Sheen/Edge/Grading/Grain/Background ranges drive the render path and persist; the same values drive preview and wallet (`__cwMrg`). |
| 13 | Live preview | **PASS** | Preview is the wallet's own component tree (0 `<img>` fakes, ≥4 divs, real card roots), 3 cards in carousel / 6 in stack, restages instantly on view switch, updates on slider moves, stand-in artwork loads (patch 25), and the stage carries a real 388×302 box (patch 25). |
| 14 | Settings UI | **PASS\*** | One sheet, control budget intact (7 chip buttons, 2 switches, 18 range sliders, ≤30 buttons), continuous values are sliders not chip rows, no `nowrap` label without ellipsis, glass sheet class present. Blur *looks* right / typography at real DPI → §5 V12. |
| 15 | Create button | **PASS** | 36 px disc (`h-9`) with 19/21 px glyphs, `aria-label="Add card"`, toggles cleanly under 10 extra taps, no duplicate sheet, no loading/disabled state needed (it opens a menu, not a request). |
| 16 | Animation | **PASS\*** | Idle deck schedules ≤6 frames per ~900 ms window (no runaway loop); after closing Settings the frame count is flat; 25 open/close cycles add <40 DOM nodes and leave 0 orphan timers/intervals; no broken state after rapid interaction. Perceived smoothness/jank → §5 V11. |
| 17 | Back button | **PASS\*** (fixed) | History contract verified: one entry pushed per open sheet, Back closes the topmost sheet and the app survives, Done-close leaves no stale entry, 10 open/close cycles return to baseline. **Whether Android's Back key/gesture actually reaches `popstate` in this Capacitor shell is a device-only question** → device rows F1–F10 (patch 26 is the fix; the pre-fix state exited the app from any sheet, reproduced here). |
| 18 | Keyboard | **NOT VERIFIED** | jsdom has no soft keyboard. Static: no `visualViewport` listener, one `scrollIntoView` call site, manifest has no `windowSoftInputMode` → RELEASE-4. |
| 19 | Screen sizes | **PASS\*** | 320×568, 412×915, 800×1280 and landscape 915×412 boots: 0 errors, ≥3 cards with sane widths bounded by the viewport. Clipping/overflow at real DPI and font scaling → §5 V8, V14. |
| 20 | Rotation | **PASS\*** | `android:configChanges` covers orientation/screenLayout/screenSize/keyboard (no activity recreate), and the bundle has an explicit landscape path (`landW/landH`, `rotate(90deg)` on the card face) that renders in a landscape boot here with no errors. Visual result → §5 V9. |
| 21 | Performance | **PASS\*** | Measured main-thread cost of the storage model (see PERFORMANCE-1): 8 photo cards = 6.6 MB, stringify 26 ms, launch parse 5 ms; 20 cards = 16.4 MB / 67 ms / 14 ms. 40 mixed interactions on a 20-card deck finish bounded and error-free. No ANR/freeze can be measured here → §5 V11. |
| 22 | Stress | **PASS** | 50-card deck boot · 20-card deck with resize/tap/slider/settings storm · 40 rapid view switches · 25 sheet cycles · force-close mid-drag then restart. All with 0 console errors and 0 unhandled rejections across all 147 checks. |
| 23 | Error handling | **PASS** | 8 corrupt-storage scenarios (non-JSON, array-of-junk, src-less cards, settings as array, nested objects, `1e9` values, negative values, `__proto__` payloads) all boot, render, and self-heal to valid JSON on the first edit. Before patch 27 two of these produced a **100-billion-px deck** or a **0-px deck** — that class is closed. |
| 24 | Storage | **PASS** | Exactly two keys (`wallet.cards.v2`, `wallet.settings.v1`); no cookies, no `sessionStorage`, no stray blobs; delete removes; no duplicates after 9 rapid Saves; quota failure is caught with the user's own toast. |
| 25 | Security | **PASS\*** | No `dangerouslySetInnerHTML`/`innerHTML=`/`document.write`/`insertAdjacentHTML`/`eval` in app code (React's own prop tables excluded by scoping to the app range); markup in a card title renders as text; boot makes 0 network requests; card data never reaches the console; no CVV/CVC field is offered or stored after patch 29; `allowBackup=false`; cleartext off; only 2 stored keys; OCR runs from bundled `ocr/*` assets (no CDN fetch despite the vendored default). |
| 26 | NFC | **NOT VERIFIED — and effectively absent** | The web layer's tap sheet is gated on `custom.nfc`, and `$p()` forces `nfc:false` on every load, so `Jp` can never open in this build; there is no NFC native plugin in the APK (dex carries only Capacitor's core classes; `cordova_plugins.js` is 0 bytes). Consequence: the `NFC` permission is declared for nothing → RELEASE-3. Not a PASS by code presence, exactly as instructed. |
| 27 | Android compatibility | **PASS\*** | Lifecycle/resize/visibility handled without errors; dark mode logic + a one-time `system`→`light` migration asserted in the smoke suite; edge-to-edge uses `env(safe-area-inset-*)` + `viewport-fit=cover`; `backdrop-filter`/flex-`gap`/`inset` against minSdk 23 is flagged (COMPAT-1). Different Android versions → §A of the device plan. |
| 28 | APK release test | **BLOCKED / PARTIAL** | `verify_release.py` = 28/29 on the tested APK (the single FAIL *is* the debug cert, by design here). See RELEASE-1/2/3/4. The repo's `CardWallet_release.apk` is release-signed but **stale** (bundle `d43cca08891b`, 455,924 B, no patch-8 header marker) — it must not be handed over. |
| 29 | Final regression | **PASS** | Re-run after the last patch: QA suite 147/147, smoke 221/221, animation audit 10/1 pre-existing WARN, replay chain IDENTICAL through patch 29, in-APK content 40/40, verify_release 28/29. |
| 30 | Handover checklist | **see §6** | |

---

## 3. CRITICAL

**None open.** (Nothing found that loses data silently, crashes on a normal path, or blocks the app
from starting. One candidate — Back exiting the app with a sheet open, mid-edit — is MAJOR below,
because the data written so far is committed and the wallet reloads correctly.)

---

## 4. Findings

### MAJOR

| ID | Issue | Reproduced | Root cause | Status |
|---|---|---|---|---|
| **QA-1** | Hardware Back from any sheet (Settings, card editor, crop, delete-all confirm, search) did not close the sheet — it finished the activity: process gone, half-finished edit lost. | Yes (jsdom: `history.length` never grew, sheet stayed open, `Back` = nothing to pop) | No Back handling of any kind existed: no `backbutton`/`popstate` listener, and no Capacitor `App` plugin is compiled in (`cordova_plugins.js` is 0 bytes) | **FIXED (patch 26)** — the web layer now pushes one history entry per open sheet and closes the topmost one on `popstate`, in a fixed z-order (crop → camera → delete-all → editor → details → settings → studio → tap → search), with a guard so a Done-tap close does not double-pop. Device confirmation still required (§F1–F10). |
| **QA-2** | A non-slider value in `wallet.settings.v1` bricks the layout: `custom.stack.size = 1e9` → cards **226,229,508,197 px** wide (measured); negative sizes → every card 0 px (an empty wallet that looks like a crash). And the bad value was written straight back. | Yes, 4 hostile fixtures | `$p()` merged stored numbers over the defaults and trusted them; no clamp anywhere | **FIXED (patch 27)** — `cwClamp()` runs on the merged `custom` at load, using the sliders' own ranges (`overlap [0,1.1]`, `visible [3,8]` rounded, `pos [-.22,.22]`, …), non-finite → range default, and a `stack`/`carousel` namespace that is a string/array is dropped. Numbers in those slots are *kept*: `custom.stack: 1.5` is the legacy multiplier the fold still reads (see MINOR-3 for what the first version broke). |
| **QA-3** | Silent data loss: `om()` kept only cards with `e.src`, so a card whose photo was missing (interrupted save, truncated write, any future pouch-only card) vanished on next launch **and was then rewritten out of storage**. | Yes | Loader filter conflated "no photo" with "not a card" | **FIXED (patch 27)** — keeps anything with an `id` and something to show (`src`, `back` or `title`); the render path already tolerates a missing image. |
| **QA-4** | Picking a photo that cannot be read did **nothing**: no card, no message, sheet dismissed. `ye` had `catch{}` and `_e()` then found an empty queue. On device: HEIC from a new phone, a cloud-only photo, a share intent with no bytes, or an OOM during decode of a 12 MP JPEG. Same silent shape in `ve` (replace photo). | Yes — a 0-byte file through the real input, and a 1-good/2-bad batch | Swallowed `catch{}` with no user-facing outcome | **FIXED (patch 28)** — "Could not read that image - try another photo", partial batches report "1 of 3 added - the rest could not be read", replace-photo says "Could not read that photo". Both verified behaviourally in jsdom (the only fix here that could be fully proven). |
| **QA-5** | Share / Save-to-gallery dead-end on device. The code calls `Capacitor` plugin `CardIO` (`shareToWhatsApp`, `saveToGallery`) when `isNativePlatform()` is true, but **no such plugin exists in this APK** (dex has only Capacitor core; no `*Plugin` class; `cordova_plugins.js` empty) → the awaited call rejects and the working Web Share / download paths two lines below are never reached. | Partially: the missing-plugin state is proven statically; the native branch itself cannot be entered from jsdom (`isNativePlatform()` stays false — logged, not hidden) | Unconditional `await` of an optional plugin with no fallback | **FIXED at source level (patch 29)** — the plugin call is wrapped and falls through to Web Share, then to the download anchor. **Device check required: §E of the device plan + row V5.** Longer term the native `CardIO` plugin should either be shipped or removed with the `<queries>` entries that exist only for it. |
| **QA-8** | The card editor offered a **`+ CVV`** chip and the tap flow created a `CVV` field — in an app whose only storage is plain `localStorage`. Storing a security code is what PCI DSS forbids outright, and the app's own copy already promises "no CVV, no PIN". | Yes (chip list read from the UI text) | `Id=[…,'CVV',…]` suggestion array + `o.push({label:'CVV',value:''})` | **FIXED (patch 29)** — both removed; the copy stays and is now true. Verified in jsdom (the chip is gone) and in the APK (`\`CVV\`` absent, `no CVV, no PIN` present). |
| **RELEASE-2** | Capacity/perf model: photo bytes live in `localStorage`, and the **whole deck is re-serialised on every change**. | Measured: 8 cards ≈ 6.6 MB (stringify 26 ms, launch parse 5 ms); 20 cards ≈ 16.4 MB (67 ms / 14 ms) | Design choice | OPEN — see PERFORMANCE-1. Not fixable inside a QA pass; needs an IndexedDB/Blob store (or the Filesystem plugin) and is the single biggest structural recommendation for the next milestone. |
| **RELEASE-1** | No release-signed build of the current code exists. The signing keystore is gitignored and absent here, so the tested artifact is debug-signed; the repo's `CardWallet_release.apk` is stale (round-5 payload, `verify_release` 26/29). | Yes (`verify_release` on it fails payload + header-marker checks) | Environment | OPEN — run `pip install cryptography apksigtool && python3 repo_export/patches/build_release_apk.py --out CardWallet_release.apk` with `repo_export/signing/release-key.p12` present, then `verify_release.py` must reach **29/29**. |
| **RELEASE-3** | `android.permission.NFC` + `uses-feature nfc` are declared, and a `nfc` setting exists, but nothing can read a tag in this build (QA-26). An unused dangerous permission in a wallet is exactly what a store review queries. | Yes (manifest + `nfc:!1` forced at load + no plugin) | Feature removed from the build, permission left behind | OPEN (native project needed) — remove the permission, or ship the plugin. |
| **RELEASE-4** | No `android:windowSoftInputMode` in the manifest. With Capacitor + `h-full`/absolute sheets, an OEM WebView can end up in `adjustNothing`, where the keyboard covers the focused field in the card editor / search. | Static only | Missing attribute | OPEN (native project needed) — add `android:windowSoftInputMode="adjustResize"`, then run §V10. |
| **SECURITY-1** | No `FLAG_SECURE` on the activity: card photos (CNIC, licence, bank card) are visible in screenshots, in the Recents thumbnail, and on an unattended display mirror. For an ID wallet this is the one privacy item worth real effort. | Static (no native code in this repo to set it) | Native window flag never set | OPEN (native project needed) — `getWindow().setFlags(FLAG_SECURE, FLAG_SECURE)` in `MainActivity`, and re-check the Recents preview. |

### MINOR

* **MINOR-1** — `nfc` and `autoDetect` are forced to `false` on *every* load (`$p()`), so a toggle for either can never persist. Intentional (both features are off in this build), but it is a "setting silently resets" item by the checklist's definition. Keep it, or remove the switch from the UI so it is not a control that does nothing.
* **MINOR-2** — settings writes are swallowed (`function rm(e){try{localStorage.setItem(Zp,JSON.stringify(e))}catch{}}`) while card writes report a quota toast. On a full storage the user's design changes are lost silently. Recommend the same toast (`me(...)`) or a debounced write with a retry.
* **MINOR-3** — **a fix of mine broke the app and the suite caught it**: the first version of `cwClamp` deleted `custom.stack` when it was a *number*, which is the pre-per-view multiplier the legacy fold still reads; two long-standing pouch checks in the smoke suite went red (`229.5px -> 229.5px`, twice). Patch 27 now preserves numbers, both checks are green again, and a QA regression row ("a legacy numeric `custom.stack` survives the clamp and still drives the fan") was added for both `1.5` and `0.4`.
* **MINOR-4** — `user-scalable=no, maximum-scale=1.0` in `index.html` blocks pinch-zoom: a WCAG 1.4.4 failure for low-vision users. One-line removal; needs a design sign-off because it also stabilises the canvas gestures.
* **MINOR-5** — the harness could not drive `navigator.share`'s *error* branch (jsdom's Web Share always succeeds), so "share cancelled / fails" is device-only (V5). The surrounding code does filter `cancel|abort` out of the toast, which is right.

### COSMETIC

* **COSMETIC-1** — a fresh install seeds **4 specimen cards** (`National Identity Card`, `Driving Licence`, `Platinum Debit Card`, `Student ID`, all `00000`/`Specimen Name` placeholders) and writes them into the user's card storage on first launch. No real PII, but the client should decide whether a shipped wallet starts populated or empty; deleting them all is remembered (no resurrection).
* **COSMETIC-2** — no branded splash: Capacitor's `backgroundColor: #ffffff` is the whole first frame.
* **COSMETIC-3** — at the default `Card overlap` (70 %) the stack's fan is cropped by its box — in the preview *and* in the wallet, where the viewport crops it the same way. Deliberate (the preview shares the component and the settings); dragging overlap down closes the deck in both.
* **COSMETIC-4** — the vendored tesseract.js still carries its `https://cdn.jsdelivr.net/…` default string, although `createWorker` is configured with local `ocr/worker.min.js`, `ocr/tesseract-core[-simd]-lstm.wasm.js` and `ocr/tessdata` (all present in the APK). Confusing to a reviewer, harmless at runtime.
* **COSMETIC-5** — `+ Add / front / back` labels in the editor and the `Notes`/`Blood group` suggestion chips are all in English; no localisation surface exists.

### PERFORMANCE

* **PERFORMANCE-1 (the one real number)** — storage model cost measured on the shipped serialisation path: `4 cards = 3.3 MB (parse 2 ms, stringify 13 ms)`, `8 = 6.6 MB (5 / 26 ms)`, `15 = 12.3 MB (10 / 48 ms)`, `20 = 16.4 MB (14 / 67 ms)`. Every card mutation re-runs the stringify on the UI thread, and the WebView's ~5-10 MB `localStorage` quota caps a photo deck at roughly **6-12 cards** — past that the app refuses the write and says "No room left on the phone – remove a card to save changes" (graceful, but it is a product ceiling, not an error). Fix: move the images to an IndexedDB/Blob store (or `@capacitor/filesystem`) and keep only metadata in `localStorage`.
* **PERFORMANCE-2** — `animation_audit.py` still reports the known WARN *Layout-triggering properties are animated* (pre-existing since round 10, `x`/`width`-adjacent motion values); `backdrop-filter` is used on 8 selectors, which is the usual jank source on low-end GPUs. Both need a 60 Hz/120 Hz look on a real phone (V11).
* **PERFORMANCE-3** — no runaway loops or leaks found: idle frames ≤6 per ~900 ms, flat after closing the sheet, DOM nodes ±40 across 25 cycles, 0 live `setInterval`, ≤2 short-lived timers, 0 unhandled rejections in 147 checks.

### SECURITY

* Positives, verified: no HTML sink in app code; React escapes all card text (an `<img src=x onerror=alert(1)>` title renders as text, 0 stray `img`/`script` nodes); no `eval`/`document.write`/`insertAdjacentHTML`; no cookies, no `sessionStorage`; 0 network requests at boot and no XHR/`fetch` call site in app code (the WebView never leaves the device — `INTERNET` is still declared, see RELEASE-5); OCR is fully on-device from bundled assets; `allowBackup=false`, `debuggable` off, cleartext off, no exported provider; card data never logged; CVV is neither offered nor stored (QA-8); a tapped card number is masked unless the user explicitly opts into `keepFullNumber`.
* **SECURITY-2** — data at rest is plain `localStorage` (and any card photo the user imports). Acceptable for a demo/personal wallet, **not** for a regulated product: recommend `EncryptedSharedPreferences`/Keystore-backed storage or an app-level lock (PIN/biometrics) before this leaves a pilot. Device loss = readable files for a rooted device.
* **RELEASE-5** — permissions to review before submission: `INTERNET` (needed by the Capacitor asset loader in practice; nothing phones home), `CAMERA` (used by the scan sheet ✓), `NFC` (unused, RELEASE-3), `WRITE_EXTERNAL_STORAGE` maxSdk 28 (no Filesystem plugin exists in this build — likely removable), and `<queries>` for WhatsApp (only meaningful if the `CardIO` plugin ships, QA-5). `verify_release.py` pins the set so nothing is added silently.

### RELEASE

1. **Signature** — tested artifact is debug-signed (throwaway key, `CN=CardWallet Debug`); `verify_release` fails exactly that one check. Production must be built with `repo_export/signing/release-key.p12` (`build_release_apk.py`), which is absent from this workspace. Any APK signed with the debug key **must not be distributed**, and installing over the previous debug build needs an uninstall (signature change otherwise → `INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
2. **Version** — versionCode **1** / versionName **1.0** with 12+ builds since: every Play upload needs a bumped versionCode, and the client should tag this as e.g. `1.1 (2)` before submission. `verify_release` checks the package id but not the version pair — worth adding if the client keeps shipping from this pipeline.
3. **AAB** — not produced and **not producible here**: this repo holds the built web payload plus an extracted `AndroidManifest.xml`, not the Gradle project (`android/` has only that file). A Play release needs the original Capacitor project (`npx cap build android --release` / `gradlew bundleRelease`) with minify/shrinker settings reviewed.
4. **Manifest** — `windowSoftInputMode` missing (RELEASE-4); `configChanges` correctly avoids activity recreation on rotation/keyboard (PASS); `launchMode="singleTask"`; `supportsRtl=true`; theme `AppTheme.NoActionBarLaunch`; `android:extractNativeLibs=false`; no `networkSecurityConfig` (fine with cleartext off).
5. **Debug surface** — no `vconsole`, no `webContentsDebuggingEnabled`/`logging` keys in `assets/capacitor.config.json`, no source maps, `cordova.js`/`cordova_plugins.js` are 0-byte stubs, tesseract's `setLogging` default is `false`, and `setWebContentsDebuggingEnabled` is only reachable through Capacitor's own debug-gated path. Nothing in the payload needs removing for release, but confirm `WebView.setWebContentsDebuggingEnabled(false)` is not enabled via a config flag on the client's build machine.
6. **Size** — 11.65 MB APK: assets 7.45 MB packed (18.54 MB raw; the OCR wasm pair + `eng.traineddata` are ~12.7 MB of it — a real reduction lever if OCR-offline is optional), dex 2.50 MB, res 1.27 MB, `resources.arsc` 0.30 MB, 431 entries, all STORED entries 4-byte aligned.
7. **Reproducibility** — `replay_chain.py` rebuilds the shipped bundle from the stock bundle + patches 1→29 and prints `IDENTICAL`, so the artifact under test is exactly what the repo describes (bundle md5 `5a6cf9626528675445baaa3b9eb41b0e`).

### COMPAT

* **COMPAT-1** — minSdk 23 (Android 6) vs `backdrop-filter` (Chrome 76+), flex `gap` (84+), `inset` (87+) in `index.css`: on an un-updated system WebView the glass becomes flat and card spacing collapses (the app still functions). Either raise minSdk to 26 (or 29 for the blur to be safe) or wrap those in `@supports`. Not fixable from the web payload alone.

---

## 5. NOT VERIFIED — and what each item needs

None of the following was "passed" on a technicality; each needs a phone, the native project, or the
signing key. Column 3 is the row in `docs/DEVICE_TEST_PLAN.md` that closes it.

| Item | Why it cannot be verified here | Needed |
|---|---|---|
| Real install / uninstall / reinstall, first-launch crash, splash, permission prompts, app-icon/label, install-over-signature-change | No `adb`, no device, no Play | §A (+ §J upgrade path) |
| Camera scan (preview, shutter, auto-capture, OCR quality, cancel mid-scan) | `getUserMedia` is stubbed to reject in jsdom | §B |
| Hardware Back / predictive-back gesture actually reaching the new `popstate` handler; also Android 14/15 predictive back animation | The history contract is verified, key delivery is not | §F1–F10 |
| "Share to WhatsApp" on device (native plugin missing → Web Share fallback), "Save to gallery", share-cancel behaviour | `isNativePlatform()` cannot be made true from jsdom (logged in QA group 32) | §E + §V5 |
| Soft keyboard covering the editor/search fields, paste/delete/scroll with keyboard open | No IME in jsdom; also depends on RELEASE-4 | §V10 |
| Card clipping, text overflow, buttons off-screen at small/landscape/large densities, 200 % font scale | jsdom has no layout engine (inline styles + classes only) | §V8 |
| Delete a middle / last card via the deck swipe; long-press vs tap on glass | Synthetic drags through the spring physics are not honest | §V13 |
| Slider feel, jump-free dragging, animation smoothness, jank, memory/CPU, ANR | No GPU, no compositor, no procstats | §V11 |
| Blur quality, typography, heading hierarchy at real DPI | No rendering | §V12 |
| Accessibility: zoom lock (MINOR-4), TalkBack on the sliders, hit-target sizes | Needs a real reader + font scaling | §V14 |
| Rotation portrait↔landscape mid-edit, data intact after rotation | `configChanges` + landscape geometry verified only at DOM level | §V9 |
| NFC: enable/disable, unsupported-device behaviour, permission flow | No NFC hardware, no native plugin in this build (QA-26) | §D |
| `FLAG_SECURE` behaviour, backup exclusion on a real device, rooted-device file access | Native + hardware | §V7 |
| Release signing, AAB, Play pre-launch review, upgrade test from an older version | Keystore + Gradle project + Play Console | §RELEASE-1/2/3 |

---
## 6. Final client-handover checklist (requested section 30)

| Check | Status | Note |
|---|---|---|
| No crash | **PASS in simulation / NOT VERIFIED on device** | 0 errors and 0 unhandled rejections in 147 checks × ~40 boots |
| No broken screen | PASS\* | every surface renders; visual polish needs V8/V12 |
| No missing functionality | **MAJOR open** | WhatsApp share depends on the missing `CardIO` plugin (QA-5, now non-fatal); NFC is absent in this build (QA-26) |
| No broken animation | PASS\* | no loops/leaks measured; feel needs V7 |
| No broken preview | **PASS** | patch 25 + `preview:` rows in both suites |
| No slider lag | PASS\* | 220-drag soak clean; pacing on device only |
| No data loss | **PASS after patches 27/28** | src-less-card drop closed (QA-3), silent import loss announced (QA-4) |
| No settings reset | PASS except the two deliberate pins | MINOR-1 |
| No UI overflow | NOT VERIFIED | V5 |
| No accidental duplicate cards | PASS | 9 rapid Saves → 1 card |
| No broken navigation | **PASS after patch 26** (device check V2) | |
| No unnecessary permissions | **OPEN** | NFC (and likely WRITE_EXTERNAL_STORAGE) — RELEASE-3 |
| No debug behavior | PASS | §RELEASE-5 |
| No obvious console errors | PASS | every check asserts it |
| No critical security issue | PASS for the web layer; **SECURITY-1/2 open** (FLAG_SECURE, plain storage) |
| No release signing issue | **OPEN** | RELEASE-1/2/3 — no release build of this code exists yet |

---

## Addendum - round 15 (Liquid Glass) landed after this report was written

The QA scope above is unchanged and the verdict is unchanged; the numbers moved and one more surface
class needs the device pass:

- **Gates now:** QA feature suite **173/173** (new group 33, 26 checks), smoke **229/229**
  (+8 header/glass checks), `liquid_glass_audit.py` **60/60** (new), `apk_content_check.py`
  **54/54** (new round-15 markers + a hard blur budget read from the shipped stylesheet),
  `verify_release.py` **28/29** (sole FAIL = the deliberate debug cert), `replay_chain.py`
  IDENTICAL through patch 30, `animation_audit.py` 10 checks / the same one pre-existing WARN.
- **Artifact:** `CardWallet_liquid_glass.apk` (11,656,321 B, sha256
  `fc2a8bc6d849f9d955f53ddac8b7a69fdc131788f12afcb9efeed6f097054aa7`) supersedes
  `CardWallet_qa_fixed.apk`; bundle md5 `7252562984dbadfcafef101fd92b1b4d` (465,259 B), stylesheet
  28,767 B with the Liquid Glass block.
- **New NOT-VERIFIED rows:** plan section **W1-W9** (how the blur actually composites on a real GPU,
  double-blur cost under the camera sheet, the Android 6-9 opaque fallback, reduce-transparency,
  banding on the sheen). Everything the round could be measured on - legibility through the glass in
  both themes, the blur budget, transition hygiene, the untouched card path - is measured, not
  asserted; `docs/QA_HANDOVER_REPORT.md` §4's MAJOR list is otherwise unchanged.
