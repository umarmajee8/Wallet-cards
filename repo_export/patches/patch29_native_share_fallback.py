#!/usr/bin/env python3
"""Patch 29 - a missing native plugin must not eat the Share / Save actions, and no CVV is asked for.

Two findings from the QA pass (docs/QA_HANDOVER_REPORT.md, QA-5 and QA-8).

**Share and Save-to-gallery dead-end on device.** The web layer calls a `CardIO` plugin:

    if(qd.isNativePlatform()){await cf.shareToWhatsApp({data:i,name:r,text:n});return}

but this APK ships no such class - the dex contains only Capacitor's own `com/getcapacitor/Plugin`
and its util package, `assets/public/cordova_plugins.js` is 0 bytes, and `registerPlugin("CardIO")`
has no web implementation either. So on a phone the awaited call rejects, the caller's `.catch`
shows "not implemented" (or "Could not open WhatsApp"), and the *working* paths that sit two lines
below - Web Share (`navigator.share`, available in the Android WebView) and the download anchor -
are never reached. The card never leaves the app. The fix is to treat the plugin as an optimisation:
try it, and if it is not there, fall through to the same paths the web build already uses.
`saveToGallery` gets the same treatment (its fallback was already written underneath, unreachable).

**CVV.** The editor's suggested-detail chips are `Name, Card number, Expiry date, CVV, Father name,
ID number, …` and the tap-to-add flow created a `CVV` field (empty). A wallet that invites the user
to store a CVV is asking for the one number PCI DSS says must never be retained after authorisation,
and this app keeps its data in plain localStorage - so the suggestion is removed rather than
protected, and the empty field the tap flow created is gone. Everything else (names, numbers as the
user chose to mask them, expiry, IDs) stays: this is a document wallet, not a payment SDK.

Run:  python3 repo_export/patches/patch29_native_share_fallback.py [--check]
"""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app" / "index.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

EDITS = [
    ("share falls back when CardIO is missing",
     "if(qd.isNativePlatform()){await cf.shareToWhatsApp({data:i,name:r,text:n});return}",
     "if(qd.isNativePlatform()){try{await cf.shareToWhatsApp({data:i,name:r,text:n});return}catch{}}"),
    ("save-to-gallery falls back when CardIO is missing",
     "if(qd.isNativePlatform()){await cf.saveToGallery({data:r,name:n});return}",
     "if(qd.isNativePlatform()){try{await cf.saveToGallery({data:r,name:n});return}catch{}}"),
    ("CVV removed from the suggested details",
     "Id=[`Name`,`Card number`,`Expiry date`,`CVV`,`Father name`",
     "Id=[`Name`,`Card number`,`Expiry date`,`Father name`"),
    ("CVV field no longer created by the tap flow",
     "o.push({id:a(),label:`CVV`,value:``}),",
     ""),
]


def main() -> int:
    global data
    if "try{await cf.shareToWhatsApp" in data:
        print("patch29: already applied" + (" (check)" if CHECK else ""))
        return 0
    for label, old, _ in EDITS:
        if data.count(old) != 1:
            raise SystemExit(f"patch29{'' if not CHECK else ' --check'}: {label} anchor found {data.count(old)}x, need 1")
    if CHECK:
        print("patch29 --check: anchors ok (nothing written)")
        return 0
    for label, old, new in EDITS:
        if old == new:
            raise SystemExit(f"patch29: {label} edit is a no-op")
        data = data.replace(old, new, 1)
    if "`CVV`" in data:
        raise SystemExit("patch29: a CVV literal is still present in the bundle")
    JS.write_text(data, encoding="utf-8")
    print(f"patch29: applied - native share/save degrade to the web paths, CVV dropped ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
