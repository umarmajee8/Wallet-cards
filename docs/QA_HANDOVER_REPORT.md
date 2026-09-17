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

---

## Addendum - round 16 (footer dock) landed after this report was written

Scope and verdict unchanged: **NOT READY FOR CLIENT HANDOVER**. Round 16 moved chrome, it did not close
any open item - no CRITICAL was added or removed, none of the six MAJOR fixes gained a device run, and
RELEASE-1/2/3/4 + SECURITY-1 stay open.

- **What changed.** `Create +`, `Search` and `Settings`/`More` are no longer in the header: a patch
  (31) re-wraps the DOM so the top fixed container holds the wordmark row plus a new bottom bar, and the
  three controls sit in one glass pill (`cw-dock`) at the bottom-centre, 10px + the system inset above the
  edge. The option menu re-anchors to open upward. `<main>` now reserves the dock's height, so the deck
  is never obscured - the user's own cards stay the dominant layer (their rendering path is untouched).
- **Material contract respected.** The dock is a *tier 1* surface with its own numbers (22px blur in a
  999 radius, tint alpha 0.80 light / 0.84 dark - more opaque than the sheet because cards scroll under
  it); the create disc inside it is demoted to tier 2 by containment, so **the blur budget is unchanged**
  (1 blurred surface at rest, 3 with a sheet open). CSS blur-declaring selectors went 4 → 5 and the cap
  is enforced in `apk_content_check.py`.
- **Gates now:** QA feature suite **175/175** (group 33 = 28 checks), smoke **237/237** (+8
  `header/foot` checks, including a live open/close of the More menu), `liquid_glass_audit.py` **72/72**
  (+12 dock rules), `apk_content_check.py` **60/60**, `replay_chain.py` **IDENTICAL** through patch 31
  (bundle 465,581 B, stylesheet 30,752 B), `verify_release.py` **28/29** (sole FAIL = the deliberate
  debug cert), `animation_audit.py` unchanged (10 checks / 1 pre-existing WARN).
- **Negative controls.** Bundle replayed without patch 31 → smoke **229/237** failing exactly the eight
  new checks, QA group 33 **27/28**. So the layout contract is enforced, not described.
- **Artifact:** `CardWallet_footer_dock.apk` (11,656,858 B, sha256
  `1991407698b742d437bfc89052841ccac179a957309ec89dc3db5247297acdd2`) supersedes
  `CardWallet_liquid_glass.apk`; bundle md5 `cb8fa8fbb04d0643f17c928a88094806` and the payload inside the
  APK was verified byte-for-byte equal to the tree.
- **New NOT-VERIFIED rows:** plan section **X1-X6** (real GPU composite over a moving deck, the safe-area
  gap on gesture vs 3-button nav, last-card clearance in both modes, 36px targets in a ~123px pill on a
  5-inch phone including outside-tap dismissal, the cost of the extra blurred surface while a sheet is
  open and while a card ejects under the dock, and the opaque fallback + caption contrast on light and
  dark artwork). Everything that can be measured here is measured; nothing in this list is marked PASS.

---

## Addendum - round 17 (Settings blur + dock placement) landed after this report was written

Verdict unchanged: **NOT READY FOR CLIENT HANDOVER**. Round 17 removed a measured performance cost and
fixed a placement regression the user reported; it closes no open CRITICAL/MAJOR and opens none.

- **What changed, technically.** (1) The Settings sheet is no longer two stacked full-viewport
  `backdrop-filter`s: the scrim dropped its 20px blur entirely (it dims only), and the panel's radius went
  30px -> 14px (`--glass-blur` 34 -> 14 so the overridden declaration agrees with the effective one). Cost
  model in the code comment: area x radius. (2) The footer dock mirrors the header's geometry instead of
  centring - the row carries the header row's exact class string and the glass moved onto a
  `cw-dock` child wrapping the three buttons; the option menu right-aligns and grows from the More button.
- **Gates now:** QA feature suite **177/177** (group 33 = 30), smoke **239/239**,
  `liquid_glass_audit.py` **79/79**, `apk_content_check.py` **62/62**, `replay_chain.py` **IDENTICAL**
  through patch 32 (bundle 465,658 B md5 `53063b355aa2feb78b1257b43151c957`, stylesheet 31,375 B),
  `verify_release.py` **28/29** (sole FAIL = the deliberate debug cert), `animation_audit.py` unchanged.
  Negative controls: JS half out -> smoke 237/239 (exactly the two new placement checks); CSS half out ->
  audit 74/79 (exactly the five round-17 cost checks).
- **One QA finding worth recording (harness, not app).** In a freshly created sandbox the jsdom suites
  started failing **11** checks - cover flap, pouch row, preview fit - that had been green. Reproduced on
  the untouched round-16 bundle, ruled out as animation timing (re-ran with 3-4x longer settles), and
  root-caused: cssstyle accepts `style.backdropFilter` but does not serialise it into the `style`
  attribute, so `getAttribute("style")`-based regexes lose the declaration. The suite now reads those
  properties through an `inlineStyle()` helper that consults the CSSOM too, and one preview check accepts
  `min-height: 0` or `0px` (React writes unitless numbers). **No check was relaxed to make it pass** -
  the same declarations are required, from a source that cannot silently drop them. Documented in the
  README's test section, with the `jsdom@27` + `cssstyle@4.6.0` pairing to install.
- **Artifact:** `CardWallet_footer_tuned.apk` (11,657,123 B, sha256
  `e36a0f73d2c1138f99f447e3f97ff39a7da4c68e2994532554088dcdb453ec9e`) supersedes
  `CardWallet_footer_dock.apk`; the payload inside the APK is byte-identical to the tree.
- **New NOT-VERIFIED rows:** plan section **Y1-Y6** - whether Settings actually feels fast now on a real
  device (the user's complaint cannot be measured from here: this sandbox has no GPU, no compositor, and
  jsdom reports no frame timings), whether 14px still reads as glass over bright and dark artwork, the
  un-blurred deck under the scrim, the pill's reach/position under a thumb including on a tablet,
  outside-tap dismissal after the restructure, and the Android 6-9 opaque fallback. All are device rows,
  so they are marked NOT VERIFIED and nothing in this list is claimed as PASS.

## Addendum - round 18 (4-digit lock + encrypted backup file) landed after this report was written

Verdict unchanged: **NOT READY FOR CLIENT HANDOVER**. Round 18 adds a feature, and a feature whose whole
value is "don't lock the user out / don't lose the file" cannot be signed off from a desktop harness.

* **What is new in the build.** `patch33_vault_lock_backup.py` appends `patches/vault_src.js` to the bundle
  and `patches/vault.css` to the stylesheet: a 4-digit gate (`#cw-lock`, opaque, up before first paint when
  a code is enrolled, re-armed after >30 s backgrounded, 5 wrong codes -> 30 s cool-down, two-tap
  "Reset app"), and one Settings card ("Lock & backup") that exports the whole deck + settings as an
  **AES-GCM 256 / PBKDF2-SHA256 150,000-round** encrypted `.cwbak` file through the share -> download chain
  the card-share feature already used, and restores it after a password and an explicit replace-the-deck
  confirmation.
* **Scope, at the user's instruction.** No account, no Google Drive SDK, no automatic sync. No recovery
  backdoor for a forgotten PIN. The PIN is a device-local gate and is deliberately *not* the encryption key
  for stored data: the deck in `localStorage` is unencrypted, as it always was, and the Settings caption
  states that. `allowBackup=false` is unchanged - a user-initiated file export is a different mechanism.
* **Testable layer, all green.** Bundle replays byte-exactly through patch 33 (494,450 B). `qa_feature_suite.mjs`
  **231/231** - new group 34 is 54 checks and, where the browser's own maths is involved, does not trust
  the app's: the PIN digest is re-derived by an independent Node implementation of the same KDF, and the
  exported file is decrypted in the harness with Node's webcrypto (a wrong password must reject).
  `liquid_glass_audit.py` **96/96**, `smoke_test_webview.mjs` **239/239**, `apk_content_check.py` **70/70**
  against `CardWallet_lock_backup.apk`, `verify_release.py` **28/29** (the single FAIL is the debug cert).
  Negative control: replay without patch 33 -> audit **90/96**, smoke **238/239**.
* **SECURITY-1 stays OPEN**, and is untouched by this round's design (it needs `FLAG_SECURE` in native
  code, which a repacked APK cannot carry). One side effect worth recording: after 30 s backgrounded the
  gate re-covers the app, so the Recents thumbnail shows the lock screen instead of card photos - a
  narrower exposure, not a fix.
* **RELEASE-2 / PERFORMANCE-1 gains one more data point.** A backup file is about the size of the deck
  (20 photo cards ≈ 16 MB), and a restore writes it back into `localStorage` in one shot, so the
  `QuotaExceededError` path is a realistic case, not a theoretical one. It is handled (current deck stays
  intact, explicit message) and covered by a QA check, but the underlying "everything is one JSON string"
  model is still the structural item for the next milestone.
* **Device work added:** `docs/DEVICE_TEST_PLAN.md` section **Z** (12 rows). **Z1** (cold-start gate, keyboard
  geometry) and **Z7** (restore after a reinstall) are handover gates; **Z9** (Android 6-9 refusing to
  export rather than writing plaintext) and **Z10** (Recents thumbnail while locked) decide whether this
  round's privacy claims hold on hardware.
* **Fixed as shipped, no code change:** the two Settings rows that already used a hard-coded
  `text-[#ff453a]` still do; round 18 added a `--danger` token and used it for the *new* UI (the audit
  asserts the new stylesheet block contains no colour literal), leaving the older rows alone rather than
  re-tuning copy that passed device review in round 15-17.

---

## Addendum (2026-09-14) - rounds 19 site work and the customization gate; verdict unchanged

**Verdict: ❌ NOT READY FOR CLIENT HANDOVER.** Still 0 CRITICAL open, **6 MAJOR device-unverified**, and
RELEASE-1/2/3/4 + SECURITY-1 open. This addendum records what moved, what the numbers are now, and what
round 19 does *not* claim.

* **Build under test is now `CardWallet_custom_gate.apk`** - 11,668,844 bytes, SHA-256
  `4566eaa23743ffd187004623389997ff0bbea2e8145d004c9740618167a49eaf`. Payload inside it is byte-identical to
  the reviewed tree (`repo_export/app/index.js` 498,509 bytes, `index.css` 37,259 bytes - asserted by
  `apk_content_check.py`, not assumed). Still **debug-signed with a throwaway local key**: `adb uninstall
  com.arena.cardwallet` before installing, and never distribute it.
* **Gate counts, current tree** (each run end-to-end after the change, not carried over):

  | Layer | Tool | Now | Before |
  |---|---|---|---|
  | Behaviour | `qa_feature_suite.mjs` | **259/259** (group "35 customization" = 28) | 231/231 |
  | Regression | `smoke_test_webview.mjs` | **241/241** | 239/239 |
  | Material / perf | `liquid_glass_audit.py` | **105/105** | 96/96 |
  | Payload | `apk_content_check.py` | **78/78** | 70/70 |
  | Package | `verify_release.py` | 28/29 (akeela FAIL = deliberate debug cert) | 28/29 |
  | Reproducibility | `replay_chain.py` | IDENTICAL **through patch 34** | through patch 33 |
  | Static style | `animation_audit.py` | 5 PASS / 0 FAIL (it prints no total) | 5 PASS / 0 FAIL |

* **What round 19 is.** A switch at the top of Custom Pouch. Off by default; while off, one CSS rule
  (`html[data-cw-custom="off"] .cw-cust-body{display:none}`) removes the colour / cover / stack-and-carousel
  controls; it closes itself when the sheet unmounts (a 400 ms `slot.isConnected` poll that runs only while
  open), on `visibilitychange` and on `pagehide`. Nothing is persisted. Values already set keep applying -
  the gate hides controls, it never reverts a look.
* **What it is not.** Not a security boundary and not described as one: card data in `localStorage` is in the
  same shape it has always been (SECURITY-1 untouched). No new permission, no native code, no new blurred
  surface, no colour literal, no `innerHTML`, no storage key, no analytics, no network call - the audit
  checks each of those absences against the shipped files.
* **New risk this round introduces, stated plainly.** It is the first control in this app that *hides UI*, so
  the failure mode is no longer "a button does nothing" but "the user cannot reach the controls at all" (or
  reaches them while the switch says off). jsdom cannot settle that: `display:none`, touch targets, TalkBack
  and frame pacing are device facts. **`docs/DEVICE_TEST_PLAN.md` section AA (10 rows) is therefore part of
  this round's handover**, with **AA1** and **AA3** as the two blocking rows.
* **Test-suite lesson recorded.** The first version of the new QA group *crashed* on a tree without the
  feature (`getComputedStyle(null)`) instead of reporting failures, and four source-level checks could pass
  vacuously because `String.prototype.indexOf` returning `-1` made their slice empty. Both fixed - null-safe
  lookups, and every source-level check now asserts the block exists (`HAS19`) before reading it. A test that
  cannot fail is not evidence; this is the rule being applied to the harness itself.
* **Negative control for this round.** `replay_chain.py --upto 33 --swap` -> audit **103/105**, smoke
  **239/241**, QA group 35 **7/28 - 18 explicit failures, no crash**. (`--swap` writes `index.js` only, so the three stylesheet-side
  rules legitimately still pass on that tree.)
* **Site round (same branch, already merged).** The marketing site at `site/` is static HTML/CSS/JS with a
  zero-third-party-request rule enforced by `site/tools/check_site.py` (structural) and
  `site/tools/contrast.py` (measured through the glass, worst 6.60:1). GitHub Pages is still **not enabled** -
  the sandbox token cannot write Pages settings - so `https://umarmajee8.github.io/Wallet-cards/` is a
  pending manual step (Settings → Pages → Deploy from a branch → `main` / `/site`). Nothing in the app
  depends on it.

## Addendum (2026-09-16) - round 20: the gesture that misaligned the cards

**Verdict unchanged (NOT READY FOR CLIENT HANDOVER)** - this round closes a *defect* the client reported,
it does not close any of §5's device-unverified items.

**The report:** cards "sometimes" shift/slide sideways during a scroll gesture instead of staying centred
and stacked. Intermittent, so a race rather than a layout error - and it was two of them, both reproduced
headlessly against the shipped bundle before touching anything:

1. **Carousel** - patch 14's recovery watchdog decided "the pointer stream was stolen" from 340 ms of
   event *quiet*. A finger that is simply held still mid-drag is exactly that quiet, so the row was
   committed to the nearest card and jumped sideways (measured: 106 px), and the next `pointermove`
   replayed the whole gesture delta from the new base (a second 170 px jolt). The drag's origin was a value
   captured at pointerdown, so anything moving the row behind its back turned the next move into a jump.
2. **Stack** - `__cwStack` never had that watchdog at all: a gesture the system ate left the deck resting
   between two cards *permanently* (identical 4.5 s later), `drag.current` stayed set so index changes
   stopped moving the deck, the long-press timer kept running, and `pointercancel` was wired to the *tap*
   handler - a bare cancel opened the card under the finger.

**The fix (patch 35)** - one injected helper tracks who is down plus the three signals that mean a WebView
lost a stream for good (`visibilitychange`, `blur`, `pagehide`); a finger on the glass now owns the row,
recovery glides (and never re-orders the carousel), and both drags rebase on the live value so a move can
only ever add its own delta.

**Evidence:** web smoke **261/261** (was 241), QA feature suite **281/281** (was 259; new group
**"36 gestures"**, 22 checks), `animation_audit.py` unchanged (10 checks / 1 pre-existing warning),
`liquid_glass_audit.py` 105/105, `apk_content_check.py` 78/78 and `verify_release.py` 28/29 (only the
deliberate debug cert) against `CardWallet_gesture_fixed.apk` (11,669,260 B, sha256
`d9370f9cfe91bfd04e15f951223dfe619896766d782ba3b9f98748381803ba6f`).

**Negative control:** the bundle without patch 35 drops the smoke suite to **246/261** (13 of the new
checks fail, including *"front card x 58.36 -> 0.00px across a 900ms hold"* - the reported symptom verbatim
- and *"the sheet opened on a cancel"*) and QA group 36 to **9/22**. The new tests are therefore pinned to
the defect, not to the implementation.

**Still not verified here:** whether a real phone delivers the same touch stream (gesture hand-off,
cancellation, a glide under a resting thumb), frame pacing during rapid flicks, TalkBack, and the
lowest-spec device. `docs/DEVICE_TEST_PLAN.md` section **AB** (8 rows; **AB1** and **AB2** are handover
gates) is the device half of this round. Verdict: **NOT READY FOR CLIENT HANDOVER** - unchanged.

## Addendum (2026-09-16) - round 21: the header's "Wallet" label is removed

**Ask:** the client asked for the top-left "Wallet" text to go, keeping the rest of the header intact -
*"just remove that text element, don't leave empty spacing or misalign the remaining icons after
removal."* This reverses the round-9 ask that put the wordmark there (`docs/FINAL_REPORT.md` §13), and the
override is recorded in the tooling (patch 17 carries a `SUPERSEDED` entry, so a replay of the chain still
recognises its own wordmark edit after patch 36 removed the span).

**Scope:** one span. The bundle was measured first: after round 16 the header row's only child *was* the
label (Add / Search / More live in the bottom dock), the container that owns `ref:d` is what dismisses the
option menu on an outside tap, and the deck's top reserve (`safe-area + 58 px`) belongs to the layout, not
to the label. The patch touches the span and nothing else - the container, dock, menu, row classes and
both reserves are byte-identical. The empty row is zero-height and `pointer-events:none`, so there is no
strip and no new hit area; keeping it preserves round 17's "dock row == header row" geometry rule.
`/*cardwallet:header*/` survives (it is the app-code start marker the content check scopes with and
`verify_release.py` asserts); `/*cardwallet:no-wordmark*/` marks the removal.

**Evidence:** web smoke **262/262** (was 261 - the wordmark checks became absence checks, plus three new
ones: the dock keeps its three controls, the reserves are untouched, `ref:d` is still the container's),
QA feature suite **281/281**, `apk_content_check.py` **79/79** (new positive marker row + a `MUST_NOT` on
the removed label) against `CardWallet_no_title.apk` (11,669,121 B, sha256
`75f86c0024ab7b1010e50a292694fbf7979190ae0c66cec4f08b52ab58f15ad4`), `liquid_glass_audit.py` 105/105 (its
preview no longer draws a wordmark), `animation_audit.py` 10/1 unchanged (no new motion),
`verify_release.py` 28/29 (only the deliberate debug cert).

**Negative control:** the previous bundle fails 4 smoke checks, 4 content-check rows and 1 QA check
(group 33, 29/30). One draft check was caught proving nothing - `!/\bWallet\b/.test(text)` passed against
the *pre-fix* bundle because `textContent` concatenates the label straight into the first card's title
("WalletPlatinum Debit Card..."); it now counts the element, which does bite.

**Not verified here:** the pixel questions - is the corner actually empty under a notch, did the deck stay
put against the previous build, is the corner dead space on a real touch screen, does the menu still close
on an outside tap. `docs/DEVICE_TEST_PLAN.md` section **AC** (5 rows) is the device half; **AC2** and
**AC3** are the rows this patch could plausibly get wrong. Verdict: **NOT READY FOR CLIENT HANDOVER** -
unchanged (round 20's **AB1**/**AB2** remain the two handover gates).

**Note for the reviewer:** this round sits on the same branch as round 20, so the pull request carries
both rounds and the site/download pointers now name `CardWallet_no_title.apk`; until the PR is merged the
GitHub raw link on `download/index.html` resolves only against `main` (the branch-raw URL the client was
given works meanwhile).

## Addendum (2026-09-16) - round 22: the overflow menu now follows the theme

**Report:** in Light mode the dropdown ("Settings" / "Delete all cards") rendered near-black while the rest
of the UI went light - *"only this specific popup menu stays hardcoded dark"* - with the ask to bind its
background, text and icon colours to the theme and to verify Light / System / Dark.

**Root cause (traceable, not a stray line):** the stock panel was themed (`rounded-2xl sheet-bg`,
`var(--line)` hairline). Round 4's header mock (patch 7) replaced that with a literal `#0b0b0d` panel and
white rows, and its own notes called it "an explicit choice, not an oversight, so it does not invert" -
written while the app was light-only. Every later round made the app theme-aware and moved surfaces onto
tokens; this surface kept its literals. The report's screenshot is that state.

**Fix:** panel -> `var(--sheet)`, hairline -> `var(--line)`, rows -> `var(--ink)` / `var(--danger)`, and
the drop shadow becomes `--menu-shadow`, defined once per theme (the only value no existing token could
express, and it must differ between a light and a black backdrop). Icons are stroked `currentColor`, so
they invert with the rows - no separate declaration was needed. Deliberately untouched: the camera chrome,
the full-screen card viewer, the sheet scrims, the toast and the artwork (all meant to be
theme-independent); the "Delete all cards" confirm sheet was already themed.

**Chain hygiene (three latent bugs of one shape, found and fixed while doing this):** rounds 18, 19 and 22
each *append* a stylesheet block, and several tools described a block as "from my banner to the end of the
file" - which silently swallows every later round. After round 22 appended, those slices made round 18's
"no colour literals" rule trip on round 22's shadow, round 19's "stays small" rule fail, and QA group 35's
"no new colour" contract fail. Fixed in patch 33/34 (`block_span`), the audit (`V18`/`V19`), the content
check (round-18/19 rules) and QA group 35 (`R19`): a block is now **its banner -> the next banner**. Patch
37's first draft had the same bug in the other direction (its banner match also matched round 19's, and it
rewrote round 19's block) - caught before commit, and patch 37 now asserts rounds 15-19 and the gate's two
rules are still present before it writes anything.

**Evidence:** web smoke **266/266** (was 262), QA suite **283/283** (was 281), `apk_content_check.py`
**83/83** (was 79) against `CardWallet_themed_menu.apk` (11,669,355 B, sha256
`163c7cbbd4ec3e807857988481f48f233dd640856fe72c8ea389d3c2554deb57`), `liquid_glass_audit.py` **111/111**
(was 105; menu rows 18.86:1 light / 15.63:1 dark, destructive row 3.41:1 light / 6.03:1 dark - printed and
gated at the 3:1 affordance floor, because it is the app's existing system red), `animation_audit.py`
10 checks / 1 warning unchanged (no new motion), `verify_release.py` 28/29 (the deliberate debug cert).

**Negative control:** the previous bundle scores smoke **260/266** (the panel reads `rgb(11, 11, 13)`, the
rows `rgb(255, 255, 255)`), content check **77/83**, QA group 33 **30/32**.

**Not verified here:** the rendered result. jsdom does not resolve `var()` in inline styles, so the suites
pin the declaration and the resolved token values, not the pixels on the glass; contrast for the light
panel is measured against the sheet token, not against a photograph behind it. `docs/DEVICE_TEST_PLAN.md`
section **AD** (5 rows; screenshots are the evidence) is the device half. Verdict: **NOT READY FOR CLIENT
HANDOVER** - unchanged, and round 20's **AB1**/**AB2** remain the two handover gates.

### Round 23 - the card viewer's empty bands take no touches (patch 38)

**Report:** on the opened-card screen, the two regions above and below the card (top region near the
header, bottom strip above the WhatsApp/Save buttons) "should not be interactive/clickable/tappable at
all" - they "seem to register touches or scroll actions". Scope as given: only the two bottom buttons stay
functional, and the card keeps its existing behaviour.

**Root cause:** the viewer is one `fixed inset-0 z-50` overlay whose first child is the full-screen
backdrop. The bands are that backdrop, so every touch there landed on it - and the overlay root carried
`onClick:te`, the viewer's own close routine, so **a band tap dismissed the card preview**. The overlay also
declared no `touch-action` of its own, so a drag in a band was an ordinary browser pan gesture. Round 9
(patch 15) had already fixed exactly this class of bug for the pouch row, but its guard lives on `<main>`
and this overlay is `<main>`'s sibling, so it never applied here.

**Fix:** the overlay root gains `touch-none` (`touch-action:none`, so no pan/zoom/rubber-band/
double-tap-zoom can start in the bands - the round-9 guard for this screen), loses `onClick:te` (the bands
no longer dismiss), and the backdrop is explicitly marked as the inert shield (`data-cwband:"preview"` +
`/*cardwallet:inert-bands*/`). The shield stays a hit target on purpose: it swallows the touch, so it can
never reach the dock's Create/Search/More buttons sitting behind the overlay. Untouched: the card box and
its gesture handlers, the two buttons (`pointer-events-auto` inside the `pointer-events:none` row), the
viewer's theme-independent colours, and the stylesheet - this round adds **no CSS block**, it rides the
existing `.touch-none` utility.

**Remaining close paths** (verified): swiping the card down (the card's own gesture) and the Android Back
/ history contract from patch 26. The tap-outside dismissal is retired by this round, as the report asked.

**Evidence:** web smoke **286/286** (was 266; the new Test 6n is shaped like round 9's pouch-band test,
with a `navigator.vibrate` spy proving each button's tap still reaches its own handler, and the card's
double-tap flip + swipe-down close still exercised), QA suite **300/300** (was 283; group 37 = 17 checks),
`apk_content_check.py` **90/90** against `CardWallet_inert_bands.apk` (11,669,370 B, sha256
`5a64084f429fd2de8d66fad82d374987df592f751010e93204420d971acf443e`), `liquid_glass_audit.py` **113/113**
(was 111: the shield is paint-only - one background, no blur, no shadow - and the round adds no colour and
no stylesheet block), `animation_audit.py` 10 checks / 1 warning unchanged, `verify_release.py` 28/29 (the
deliberate debug cert).

**Negative control:** the previous bundle scores smoke **278/286** (8 round-23 checks fail: the shield is
unmarked, the overlay has no touch guard, and both band taps dismiss the viewer), QA group 37 **10/17**,
content check **85/90** against the round-22 APK. The 11 "kept working" checks - buttons, share/save
paths, card gestures, swipe-down close - pass on both bundles, which is what makes them evidence the fix
did not disturb them.

**Not verified here:** the WebView's own pan/overscroll behaviour with a real finger. jsdom has no layout
and no scroller, so the suites pin the declaration (`touch-action:none` on the overlay root, i.e. every
band touch starts inside the guarded element), the hit-target chain (the shield swallows the touch), and
the event plumbing. `docs/DEVICE_TEST_PLAN.md` section **AE** (5 rows, AE2 the one that needs care) is the
device half. Verdict: **NOT READY FOR CLIENT HANDOVER** - unchanged; round 20's **AB1**/**AB2** remain the
two handover gates.

### Round 24 - the action bar: bottom-right, with the old header bar's own spacing (patch 39, CSS only)

**Request:** move the top-right action bar ("+" Add, Search, More) to the bottom-right corner - same
grouping, icons, functionality - floating above the content, safe-area padded, same seat on every screen.

**What the current code already did:** the move itself shipped in rounds 16-17 (patches 31-32, 2026-09-07,
for the same request) and has been pinned by `apk_content_check.py` in every build since: one glass pill
(`.cw-dock`), bottom-anchored bar with `env(safe-area-inset-bottom)`, right-aligned row, the same three
controls in the same order, deck reserving the pill's height. **What had not travelled was the old bar's
own spacing** - measured out of the last build with the bar still at the top-right
(`CardWallet_liquid_glass.apk`, round 15): three bare 36px buttons, `gap-1` (4px), `px-2` (8px) inset -
whereas round 16 built the pill with `gap:10px; padding:6px 10px`.

**Fix:** one appended stylesheet rule, `:root`-level and last in the sheet: `.cw-dock{gap:4px;padding:6px 8px}`.
No JavaScript at all; round 16's own rule is untouched (the override is asserted to be the last `.cw-dock`
declaration, and its predecessor byte-identical). No colour, blur, shadow, radius or motion is added, so
the material and its fallbacks are exactly as round 16 shipped them.

**Evidence:** web smoke **286 -> 308/308** (new Test 6o: metrics, the bottom-right seat, the seat identical
across five boots, the seat surviving search / option menu / both sheets / the card viewer, and all three
actions still running with their menus opening upward), QA suite **300 -> 323/323** (group 38 = 23 checks,
including small-phone and landscape viewports), `liquid_glass_audit.py` **113 -> 117/117** (paint-neutral
change: same tier-1 blur, same pill radius, block adds nothing), `apk_content_check.py` **90 -> 94/94**
against `CardWallet_action_bar.apk` (11,669,728 B, sha256
`9adcbf84c9294bb5d36185b2c8ed9cad6b3735dfc5c3b9e6a96963c5cca42a20`), `animation_audit.py` 10 checks /
1 warning unchanged, `verify_release.py` 28/29 (the deliberate debug cert).

**Negative controls (two - a placement claim needs one that moves the bar back):** (a) pre-patch tree:
smoke **306/308**, QA group 38 **21/23** (exactly the two metric rows bite). (b) the reported regression
simulated - the bar put back at the top-right (`bottom-0` -> `top-0`, menu `mb-1` -> `mt-1`): smoke
**296/308** (9 round-24 rows, plus round 16/17's "bottom-anchored pill" and "opens upward" rows), QA group
38 **15/23**. In both controls the "kept working" rows stay green.

**Not verified here:** the real bottom edge, the real gesture bar and one-handed reach. jsdom has no
layout, so the suites pin the anchors, the classes, the safe-area expression and the mount across screens.
`docs/DEVICE_TEST_PLAN.md` section **AF** (5 rows; AF1 and AF5 are the ones a browser cannot judge) is the
device half. Verdict: **NOT READY FOR CLIENT HANDOVER** - unchanged; round 20's **AB1**/**AB2** remain the
two handover gates.

**Note for the reviewer:** this branch now carries rounds 20, 21, 22, 23 and 24; the site and `download/index.html`
point at `CardWallet_action_bar.apk` (its sha256/size on the download page describe the file it serves).
Until the PR is merged the GitHub raw link there resolves only against `main`; the branch-raw URL given to
the client works meanwhile.
