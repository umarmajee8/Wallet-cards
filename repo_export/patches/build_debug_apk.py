#!/usr/bin/env python3
"""Build a DEBUG-SIGNED Card Wallet APK from repo_export/app - for hands-on
testing only.

Why this exists: the production keystore (`repo_export/signing/release-key.p12`)
is gitignored, so a fresh clone cannot sign a real release. This script makes the
same package a tester can install today, using a throwaway key generated on the
fly and kept under repo_export/signing/ (also gitignored).

  * same web bundle as build_release_apk.py (app/index.js + css + html)
  * same manifest hardening (allowBackup=false)
  * same v1 + v2 + v3 signing path, just with the local debug key

Because the signature differs from the production one, Android will refuse to
update an existing install over it:

  adb uninstall com.arena.cardwallet && adb install CardWallet_header_black.apk

After building, verify_release.py runs over the result. One check is *expected*
to fail for a debug build - "sign: signer subject is not a debug cert" - and
this script treats that as pass, any other failure as a real problem.

Usage:
    python3 repo_export/patches/build_debug_apk.py [--out PATH] [--base APK]
                                           [--tag NAME] [--no-verify]
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import apkbuilder  # noqa: E402
import axml  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXPORT = ROOT / "repo_export"
APP = EXPORT / "app"
BASE_APK = EXPORT / "CardWallet_no_pouch.apk"
JS_ENTRY = "assets/public/assets/index-DfWhHAzK.js"
CSS_ENTRY = "assets/public/assets/index-BLmxUz06.css"
HTML_ENTRY = "assets/public/index.html"
MANIFEST_ENTRY = "AndroidManifest.xml"
SIGN_DIR = EXPORT / "signing"
DEBUG_KEYSTORE = SIGN_DIR / "debug-local.p12"
DEBUG_ALIAS = "cardwallet-debug"
FORBIDDEN_JS = [b"Auto-detect details", b"Fill in from picture", b"Make your own pouch"]


def log(step: str, msg: str) -> None:
    print(f"[{step}] {msg}", flush=True)


def harden_manifest(blob: bytes) -> bytes:
    """Same hardening the release build applies, so what a tester installs
    matches what would ship apart from the signature."""
    out = axml.set_boolean(blob, "application", "allowBackup", False)
    assert len(out) == len(blob), "manifest patch changed the file size"
    after = axml.get_attribute(out, "application", "allowBackup")
    assert after is not None and after.data == 0, "allowBackup patch failed"
    dbg = axml.get_attribute(out, "application", "debuggable")
    if dbg is not None and dbg.data != 0:
        out = axml.set_boolean(out, "application", "debuggable", False)
    return out


def get_debug_key() -> apkbuilder.ReleaseKey:
    if DEBUG_KEYSTORE.exists():
        rk = apkbuilder.load_release_keystore(DEBUG_KEYSTORE, b"cardwallet-debug", DEBUG_ALIAS)
        log("keystore", f"reusing local debug key {DEBUG_KEYSTORE.relative_to(ROOT)}")
        return rk
    SIGN_DIR.mkdir(parents=True, exist_ok=True)
    rk = apkbuilder.create_release_keystore(
        DEBUG_KEYSTORE,
        b"cardwallet-debug",
        alias=DEBUG_ALIAS,
        common_name="CardWallet Debug (local test builds only)",
        org="CardWallet",
        org_unit="Testing",
        key_size=2048,
        years=5,
    )
    DEBUG_KEYSTORE.chmod(0o600)
    log("keystore", f"created throwaway debug key {DEBUG_KEYSTORE.relative_to(ROOT)} (not for release)")
    return rk


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "CardWallet_header_black.apk"))
    ap.add_argument("--base", default=str(BASE_APK), help="base APK to repackage")
    ap.add_argument("--tag", default="", help="appended to the output file name")
    ap.add_argument("--no-verify", action="store_true", help="skip verify_release.py")
    args = ap.parse_args()
    out_apk = Path(args.out)
    if args.tag:
        out_apk = out_apk.with_name(f"{out_apk.stem}-{args.tag}{out_apk.suffix}")
    base = Path(args.base)

    js = (APP / "index.js").read_bytes()
    for needle in FORBIDDEN_JS:
        if needle in js:
            raise SystemExit(f"web bundle still contains a removed feature: {needle!r}")

    with zipfile.ZipFile(base) as z:
        for entry, local in ((CSS_ENTRY, "index.css"), (HTML_ENTRY, "index.html")):
            if z.read(entry) != (APP / local).read_bytes():
                raise SystemExit(
                    f"{local} in repo_export/app differs from the base APK - this debug "
                    f"builder only swaps index.js; update the base APK or use a full rebuild"
                )
        manifest = harden_manifest(z.read(MANIFEST_ENTRY))
        had_backup = axml.get_attribute(z.read(MANIFEST_ENTRY), "application", "allowBackup")
    log("bundle", f"guard rails ok, index.js = {len(js)} bytes")
    log("manifest", f"allowBackup {had_backup.data if had_backup else 'absent'} -> False, debuggable False")

    rk = get_debug_key()
    info = apkbuilder.repackage_and_sign(
        base, out_apk, rk,
        replacements={JS_ENTRY: js, MANIFEST_ENTRY: manifest},
        created_by="CardWallet debug pipeline (local test build)",
    )
    log("sign", f"v1+v2+v3, {info['entries']} entries, {info['size']} bytes")
    log("sign", f"apk sha256 = {info['sha256']}")
    log("done", f"DEBUG-SIGNED APK -> {out_apk}")
    log("done", "signature is local - uninstall any existing install before installing this")

    if not args.no_verify:
        import re
        import subprocess

        v = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("verify_release.py")), str(out_apk)],
            capture_output=True, text=True,
        )
        # verify_release prints "  FAIL  <name>  <detail>" - keep the name only
        failed = [re.split(r"\s{2,}", m.strip())[0] for m in
                  re.findall(r"^\s*FAIL\s+(.+)$", v.stdout, re.M)]
        # a debug build is *supposed* to carry a debug cert subject
        EXPECTED = "sign: signer subject is not a debug cert"
        real = [f for f in failed if f != EXPECTED]
        summary = next((l.strip() for l in v.stdout.splitlines() if "checks passed" in l), "no summary")
        if "No module named apksigtool" in v.stderr + v.stdout:
            log("verify", f"{summary} - apksigtool is missing, 3 signature checks cannot run (pip install apksigtool)")
            return 0
        if EXPECTED in failed and not real:
            log("verify", f"{summary} - the one failure is the debug cert subject, which is the point")
        else:
            log("verify", summary)
        if real:
            log("verify", "UNEXPECTED FAILURES: " + ", ".join(real))
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
