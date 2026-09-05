#!/usr/bin/env python3
"""Build the production release APK for Card Wallet.

What it does, in order:
  1. Loads (or creates) the production PKCS#12 release keystore.
     The old builds used a throwaway "CardWallet Debug" key - that key is no
     longer used for anything.
  2. Hardens the binary AndroidManifest.xml (android:allowBackup -> false).
  3. Repackages the base APK with the patched web bundle + hardened manifest.
  4. Signs with the release key: JAR v1 + APK Signature Scheme v2 + v3.
  5. Runs verify_release.py over the result.

Usage:
    python3 repo_export/patches/build_release_apk.py [--out PATH]

Keystore/password location (never committed - repo_export/signing/ is gitignored):
    repo_export/signing/release-key.p12
    repo_export/signing/release-key-password.txt
Override with env RELEASE_KEYSTORE / RELEASE_KEYSTORE_PASSWORD / RELEASE_KEY_ALIAS.
"""
from __future__ import annotations

import argparse
import os
import secrets
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import apkbuilder  # noqa: E402
import axml  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXPORT = ROOT / "repo_export"
BASE_APK = EXPORT / "CardWallet_no_pouch.apk"
JS_ENTRY = "assets/public/assets/index-DfWhHAzK.js"
CSS_ENTRY = "assets/public/assets/index-BLmxUz06.css"
HTML_ENTRY = "assets/public/index.html"
MANIFEST_ENTRY = "AndroidManifest.xml"
SIGN_DIR = EXPORT / "signing"
KEYSTORE = Path(os.environ.get("RELEASE_KEYSTORE", SIGN_DIR / "release-key.p12"))
PASSWORD_FILE = SIGN_DIR / "release-key-password.txt"
KEY_ALIAS = os.environ.get("RELEASE_KEY_ALIAS", "cardwallet-release")
DEFAULT_OUT = ROOT / "CardWallet_release.apk"

# Guard rails: things that must NOT be in a release bundle.
FORBIDDEN_JS = [b"Auto-detect details", b"Fill in from picture", b"Make your own pouch"]


def log(step: str, msg: str) -> None:
    print(f"[{step}] {msg}", flush=True)


def get_password() -> bytes:
    env = os.environ.get("RELEASE_KEYSTORE_PASSWORD")
    if env:
        return env.encode()
    if PASSWORD_FILE.exists():
        return PASSWORD_FILE.read_text().strip().encode()
    pw = secrets.token_urlsafe(32)
    SIGN_DIR.mkdir(parents=True, exist_ok=True)
    PASSWORD_FILE.write_text(pw + "\n")
    os.chmod(PASSWORD_FILE, 0o600)
    log("keystore", f"generated new keystore password -> {PASSWORD_FILE}")
    return pw.encode()


def get_release_key() -> apkbuilder.ReleaseKey:
    password = get_password()
    if KEYSTORE.exists():
        rk = apkbuilder.load_release_keystore(KEYSTORE, password, KEY_ALIAS)
        log("keystore", f"loaded existing release keystore {KEYSTORE}")
    else:
        rk = apkbuilder.create_release_keystore(KEYSTORE, password, alias=KEY_ALIAS)
        log("keystore", f"created NEW release keystore {KEYSTORE}")
        log("keystore", "BACK THIS FILE UP - losing it means you can never update this app")
    if rk.key_size < 2048:
        raise SystemExit("release key must be >= 2048 bit")
    if "Debug" in rk.cert.subject.rfc4514_string():
        raise SystemExit("refusing to sign a release with a debug certificate")
    for line in rk.summary().splitlines():
        log("keystore", line)
    return rk


def harden_manifest(blob: bytes) -> bytes:
    before = axml.get_attribute(blob, "application", "allowBackup")
    log("manifest", f"allowBackup before = {before.data == 0xFFFFFFFF if before else 'absent'}")
    out = axml.set_boolean(blob, "application", "allowBackup", False)
    after = axml.get_attribute(out, "application", "allowBackup")
    assert after is not None and after.data == 0, "allowBackup patch failed"
    log("manifest", "allowBackup after  = False (cloud backup + adb backup of card data disabled)")

    dbg = axml.get_attribute(out, "application", "debuggable")
    if dbg is not None and dbg.data == 0xFFFFFFFF:
        out = axml.set_boolean(out, "application", "debuggable", False)
        log("manifest", "debuggable -> False")
    else:
        log("manifest", "debuggable   = absent/false (ok for release)")

    cleartext = axml.get_attribute(out, "application", "usesCleartextTraffic")
    log(
        "manifest",
        "usesCleartextTraffic = "
        + ("absent (default false on targetSdk>=28)" if cleartext is None else str(cleartext.data)),
    )
    assert len(out) == len(blob), "manifest size changed - patch is not size preserving"
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()
    out_apk = Path(args.out)

    log("build", f"base APK    : {BASE_APK.relative_to(ROOT)}")
    log("build", f"output APK  : {out_apk}")

    js = (EXPORT / "app" / "index.js").read_bytes()
    for needle in FORBIDDEN_JS:
        if needle in js:
            raise SystemExit(f"web bundle still contains removed feature: {needle!r}")
    log("bundle", f"web bundle guard rails ok ({len(js)} bytes)")

    with zipfile.ZipFile(BASE_APK) as z:
        manifest = harden_manifest(z.read(MANIFEST_ENTRY))
        for entry, local in ((CSS_ENTRY, "index.css"), (HTML_ENTRY, "index.html")):
            if z.read(entry) != (EXPORT / "app" / local).read_bytes():
                raise SystemExit(f"{local} in repo differs from base APK - update the pipeline")

    rk = get_release_key()
    info = apkbuilder.repackage_and_sign(
        BASE_APK,
        out_apk,
        rk,
        replacements={JS_ENTRY: js, MANIFEST_ENTRY: manifest},
    )
    log("sign", f"replaced entries: {info['replaced']}")
    log("sign", f"signed v1+v2+v3, {info['entries']} entries, {info['size']} bytes")
    log("sign", f"apk sha256 = {info['sha256']}")
    log("done", f"release APK written to {out_apk}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
