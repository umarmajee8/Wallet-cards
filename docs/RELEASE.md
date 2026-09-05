# Release build & signing — Card Wallet

`com.arena.cardwallet` · versionCode 1 / versionName 1.0 · minSdk 23 · targetSdk 35

## 1. Signing key

Builds up to and including `CardWallet_no_autodetect.apk` were signed with a
throwaway **debug** key (`CN=CardWallet Debug`, RSA-2048,
SHA-256 `19e06220…b619`). That key is **no longer used** and any APK signed
with it must not be distributed.

The production key is a PKCS#12 keystore — the same format `keytool` writes
today, so Gradle/`apksigner` can use it directly:

| | |
|---|---|
| Keystore | `repo_export/signing/release-key.p12` (**gitignored**) |
| Password | `repo_export/signing/release-key-password.txt` (**gitignored**) |
| Alias | `cardwallet-release` |
| Key | RSA-4096, SHA-256 |
| Subject | `CN=Card Wallet, OU=Mobile, O=Card Wallet, C=PK` |
| Validity | 30 years |
| Cert SHA-256 | `86383a7f13662e8b55885cb5331341f8db964ad065da074cc360082a3e436726` |
| Cert SHA-1 | `9487837a3d1145281bae203c9e726809185a83ef` |

> **Back this keystore up somewhere outside the repo (password manager / secret
> store).** If it is lost, the app can never be updated again under this
> package name — every future update must be signed with the same key.

Because the signing identity changed, the new APK **cannot be installed over an
existing debug-signed install**. Android rejects it with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`; uninstall the old build first (this wipes
the wallet, which is expected for a signature change).

To use your own keystore instead:

```bash
export RELEASE_KEYSTORE=/secure/path/my-release.p12
export RELEASE_KEYSTORE_PASSWORD='…'
export RELEASE_KEY_ALIAS=my-alias
```

## 2. Build

```bash
pip install cryptography apksigtool          # sandbox has no JDK/Android SDK
python3 repo_export/patches/build_release_apk.py --out CardWallet_release.apk
```

The pipeline:

1. loads/creates the release keystore (refuses to sign with a "Debug" cert),
2. guards the web bundle (fails if a removed feature string reappears),
3. hardens the binary `AndroidManifest.xml` — `android:allowBackup` → `false`,
4. repackages `repo_export/CardWallet_no_pouch.apk` with the patched
   `repo_export/app/index.js` + hardened manifest, 4-byte aligning every
   STORED entry (equivalent to `zipalign -f 4`),
5. signs **JAR v1 + APK Signature Scheme v2 + v3** with the release key.

`repo_export/patches/rebuild_apk.py` is the older debug-key script and is kept
only for history — do not use it for releases.

Note: the APK is **not** bit-for-bit reproducible - the v1 signature files
carry a build timestamp, so each rebuild has a different SHA-256. Record the
hash of the artifact you actually test and ship.

## 3. Verify (release gate)

```bash
python3 repo_export/patches/verify_release.py CardWallet_release.apk   # 26 checks
node    repo_export/patches/smoke_test_webview.mjs                     # 28 checks (needs: npm i jsdom)
python3 repo_export/patches/animation_audit.py                         # static jank audit
```

`verify_release.py` is a hard gate: zip/CRC integrity, v1+v2+v3 signatures,
single non-debug signer, key ≥ 2048 bit, alignment, `allowBackup=false`,
`debuggable` off, unchanged package id and permission set, no exported
provider, and that the shipped bundle matches `repo_export/app/index.js`.

## 4. `allowBackup` decision

`android:allowBackup="false"` (was `true`).

The wallet keeps card photos and typed card details in WebView `localStorage`
inside the app sandbox. With `allowBackup="true"` that data is copied into
Google cloud backup and can be pulled off the device with `adb backup` on older
Android versions — unacceptable for ID/bank-card images, and none of it is
data a user expects to be silently synced. Nothing in the app depends on the
backup transport, so disabling it costs no functionality.

Trade-off accepted: cards are **not** carried over by cloud backup or
device-to-device transfer when the user changes phone. If wallet migration is
wanted later, add an explicit in-app export/import rather than re-enabling
`allowBackup`.
