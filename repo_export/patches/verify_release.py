#!/usr/bin/env python3
"""Release verification gate for the Card Wallet APK.

Every check here is a hard pass/fail. If anything fails the APK must not be
shipped. These are *static/package-level* checks - they say nothing about
on-device behaviour, which is covered by docs/DEVICE_TEST_PLAN.md.

Usage: python3 repo_export/patches/verify_release.py CardWallet_release.apk
"""
from __future__ import annotations

import hashlib
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import axml  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_PACKAGE = "com.arena.cardwallet"
EXPECTED_PERMISSIONS = {
    "android.permission.INTERNET",
    "android.permission.CAMERA",
    "android.permission.NFC",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "com.arena.cardwallet.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
}
DEBUG_CERT_SHA256 = "19e06220977a6cc8e4b17d478f4f5c31641c8377ed64c08da5651c4c1f98b619"
REMOVED_FEATURE_STRINGS = [b"Auto-detect details", b"Fill in from picture", b"Make your own pouch"]

results: list[tuple[bool, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((ok, name, detail))
    return ok


def data_offset(raw: bytes, info: zipfile.ZipInfo) -> int:
    nl, el = struct.unpack_from("<HH", raw, info.header_offset + 26)
    return info.header_offset + 30 + nl + el


def main(apk_path: str) -> int:
    apk = Path(apk_path)
    if not apk.exists():
        print(f"FATAL: {apk} not found")
        return 2
    raw = apk.read_bytes()

    # ---- 1. zip integrity -------------------------------------------------
    try:
        z = zipfile.ZipFile(apk)
        bad = z.testzip()
        check("zip: archive readable, all CRCs valid", bad is None, bad or f"{len(z.namelist())} entries")
    except Exception as exc:  # noqa: BLE001
        check("zip: archive readable", False, str(exc))
        return report()

    names = set(z.namelist())

    # ---- 2. signing -------------------------------------------------------
    check("sign: APK Signing Block present", b"APK Sig Block 42" in raw)
    check(
        "sign: v1 (JAR) signature files present",
        {"META-INF/MANIFEST.MF", "META-INF/CERT.SF", "META-INF/CERT.RSA"} <= names,
    )
    proc = subprocess.run(
        [sys.executable, "-m", "apksigtool", "verify", str(apk)],
        capture_output=True, text=True,
    )
    out = proc.stdout + proc.stderr
    check("sign: APK Signature Scheme v2 verified", "v2 verified" in out,
          "apksigtool" if "v2 verified" in out else out.strip()[-120:])
    check("sign: APK Signature Scheme v3 verified", "v3 verified" in out)

    parse = subprocess.run(
        [sys.executable, "-m", "apksigtool", "parse", "--verbose", str(apk)],
        capture_output=True, text=True,
    ).stdout
    fingerprints = {
        line.split(":")[-1].strip()
        for line in parse.splitlines()
        if "X.509 SHA256 FINGERPRINT" in line
    }
    subjects = {line.split("SUBJECT:")[-1].strip() for line in parse.splitlines() if "X.509 SUBJECT" in line}
    check("sign: exactly one signer certificate", len(fingerprints) == 1, str(fingerprints))
    check("sign: NOT signed with the old debug key", DEBUG_CERT_SHA256 not in fingerprints,
          f"debug fp {DEBUG_CERT_SHA256[:16]}...")
    check("sign: signer subject is not a debug cert", all("Debug" not in s for s in subjects), str(subjects))
    keysizes = {line.split(":")[-1].strip() for line in parse.splitlines() if "PUBLIC KEY BIT SIZE" in line}
    check("sign: signing key >= 2048 bit", all(int(k) >= 2048 for k in keysizes), f"bits={keysizes}")
    # v1 must cover every payload file
    mf = z.read("META-INF/MANIFEST.MF").decode("utf-8", "replace")
    payload = [n for n in z.namelist() if not n.startswith("META-INF/") or not n.upper().endswith((".SF", ".RSA", "MANIFEST.MF"))]
    payload = [n for n in payload if n not in {"META-INF/MANIFEST.MF", "META-INF/CERT.SF", "META-INF/CERT.RSA"}]
    missing = [n for n in payload if f"Name: {n}"[:70] not in mf.replace("\r\n ", "")]
    check("sign: v1 manifest covers every entry", not missing, f"{len(payload)} entries, missing={missing[:3]}")

    # ---- 3. alignment -----------------------------------------------------
    misaligned = [
        i.filename for i in z.infolist()
        if i.compress_type == zipfile.ZIP_STORED and data_offset(raw, i) % 4
    ]
    check("align: all STORED entries 4-byte aligned", not misaligned, f"bad={misaligned[:5]}")
    arsc = z.getinfo("resources.arsc")
    check(
        "align: resources.arsc STORED and 4-byte aligned (targetSdk>=30)",
        arsc.compress_type == zipfile.ZIP_STORED and data_offset(raw, arsc) % 4 == 0,
    )
    check("align: no compressed native libs (extractNativeLibs=false safe)",
          not [n for n in names if n.endswith(".so")], "no .so entries in this build")

    # ---- 4. manifest hardening -------------------------------------------
    man = z.read("AndroidManifest.xml")
    all_attrs = list(axml.iter_attributes(man))
    # NOTE: a manifest has many <uses-permission>/<provider> elements, so keep the
    # full list around and only use the dict for genuinely single-valued attrs.
    attrs = {(a.tag, a.name): a for a in all_attrs}
    pkg = attrs.get(("manifest", "package"))
    check("manifest: package id unchanged", pkg is not None and pkg.string == EXPECTED_PACKAGE,
          pkg.string if pkg else "?")
    ab = attrs.get(("application", "allowBackup"))
    check("manifest: allowBackup = false", ab is not None and ab.data == 0,
          "wallet card data excluded from cloud/adb backup")
    dbg = attrs.get(("application", "debuggable"))
    check("manifest: debuggable not enabled", dbg is None or dbg.data == 0)
    ct = attrs.get(("application", "usesCleartextTraffic"))
    check("manifest: cleartext traffic not enabled", ct is None or ct.data == 0)
    minsdk = attrs.get(("uses-sdk", "minSdkVersion"))
    targetsdk = attrs.get(("uses-sdk", "targetSdkVersion"))
    check("manifest: targetSdk >= 34 (Play requirement)",
          targetsdk is not None and targetsdk.data >= 34, f"min={minsdk.data if minsdk else '?'} target={targetsdk.data if targetsdk else '?'}")
    perms = {
        a.string
        for a in all_attrs
        if a.tag == "uses-permission" and a.name == "name" and a.string
    }
    check("manifest: permission set unchanged (no new permissions)", perms == EXPECTED_PERMISSIONS,
          f"{len(perms)} perms" + ("" if perms == EXPECTED_PERMISSIONS else f" {sorted(perms)}"))
    provider_exported = [
        a for a in all_attrs if a.tag == "provider" and a.name == "exported"
    ]
    check("manifest: no provider is exported",
          all(a.data == 0 for a in provider_exported),
          f"{len(provider_exported)} providers checked")

    # ---- 5. payload -------------------------------------------------------
    js = z.read("assets/public/assets/index-DfWhHAzK.js")
    src_js = (ROOT / "repo_export" / "app" / "index.js").read_bytes()
    check("payload: shipped JS bundle == repo_export/app/index.js",
          hashlib.sha256(js).digest() == hashlib.sha256(src_js).digest(),
          hashlib.sha256(js).hexdigest()[:16])
    for needle in REMOVED_FEATURE_STRINGS:
        check(f"payload: removed feature absent ({needle.decode()})", needle not in js)
    check("payload: capacitor config present", "assets/capacitor.config.json" in names)
    check("payload: dex present", "classes.dex" in names)

    return report()


def report() -> int:
    print()
    width = max(len(n) for _, n, _ in results) + 2
    for ok, name, detail in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name:<{width}} {detail}")
    failed = [n for ok, n, _ in results if not ok]
    print()
    print(f"{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        print("FAILED: " + ", ".join(failed))
        return 1
    print("RESULT: release package verification PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "CardWallet_release.apk"))
