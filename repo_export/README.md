# CardWallet (patched)

This repo contains the patched source for the CardWallet app.

## Changes made
1. Removed the "Make your own pouch" custom color-picker feature (both the header menu entry and the Settings-screen row).
2. Added two new fixed pouch presets, selectable from Settings -> **Pouch style**:
   - **Frosted** (original default)
   - **Steel** - dark slate/blue-grey look
   - **Emerald** - dark green look
3. Removed the **Auto-detect details** feature (Settings toggle, “Fill in from picture” button, and OCR on new photos). Card details are only what you type in.

## Structure
- `app/` - the web bundle that runs inside the Android WebView (Capacitor-based hybrid app): `index.html`, the compiled/minified `index.js`, `index.css`, and icons.
- `android/AndroidManifest.xml` - the app's Android manifest.
- `patches/` - Python scripts used to patch the minified `index.js` (patch1 -> patch5) and `rebuild_apk.py` to inject the bundle and sign the APK.
- `CardWallet_no_pouch.apk` - previous signed build (pouch changes only).
- `../CardWallet_no_autodetect.apk` - current signed, installable APK with auto-detect removed.

## Build notes
The web bundle is patched with the scripts in `patches/`, injected into the existing APK, zipaligned, then signed with a self-generated debug key (v1 + v2). This is not the original developer's signing key — uninstall any previous install before installing this build.
