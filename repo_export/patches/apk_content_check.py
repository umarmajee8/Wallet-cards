#!/usr/bin/env python3
"""What the shipped APK must contain (and must not), read out of the APK itself.

verify_release.py proves the *package* (zip, signatures, alignment, manifest). This proves the
*payload*: that the bundle inside the APK is byte-for-byte the reviewed tree, and that the behaviour
each round produced is actually compiled in. It is the list a reviewer can re-run in five seconds
after building, instead of trusting a green build log.

Usage: python3 repo_export/patches/apk_content_check.py [CardWallet_qa_fixed.apk]
"""
from __future__ import annotations
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APK = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "CardWallet_qa_fixed.apk")
JS_ENTRY = "assets/public/assets/index-DfWhHAzK.js"
CSS_ENTRY = "assets/public/assets/index-BLmxUz06.css"

# (label, condition on the bundle text)
MUST = [
    ("round 11  compact 36px create button", "flex h-9 items-center justify-center rounded-full"),
    ("round 12  per-view layout namespaces (Stack and Carousel independent)", "custom:__cwMrg(j.custom,`stack`)"),
    ("round 12  carousel render gets its own namespace", "custom:__cwMrg(j.custom,`carousel`)"),
    ("round 12  stack fan math", "sg=r*ov+sp"),
    ("round 12  visible-card cut-off", "f.set(c>vi-.65?0:1)"),
    ("round 12  carousel peek / position / side dim", "sideGap:n*.56*pk"),
    ("round 12  layout hook recomputes on all six per-view fields",
     "[k&&k.size,k&&k.gap,k&&k.radius,k&&k.peek,k&&k.pos,k&&k.side]"),
    ("round 12  sliders glide, and land exactly on the target", "from+=d*.42"),
    ("round 12  ramp snaps when the remaining distance is under write precision", "Math.max(8e-4,Math.abs(d)*.05)"),
    ("round 12  preview stages 6 cards for the stack, 3 for the carousel", "want=isStack?6:3"),
    ("round 13  the preview's stage takes the fit box's size (was clipped to 0px)",
     "width:ft?ft.w:void 0,height:ft?ft.h:void 0"),
    ("round 13  the wallet's own stage still stretches with flex only", "style:{flex:ft?`none`:1,minHeight:0"),
    ("round 13  stand-in artwork is one fully encoded data URL", "data:image/svg+xml;charset=utf-8,`+encodeURIComponent("),
    ("QA      Back pushes exactly one history entry per open sheet (patch26)",
     "history.pushState({cardwallet:`sheet`},``)"),
    ("QA      Back closes the topmost surface (patch26)", "window.addEventListener(`popstate`,on)"),
    ("QA      the crop sheet is dismissed before anything under it (patch26)", "shut=()=>{if(f){p(null);oe.current=[];return}"),
    ("QA      a Done close does not double-pop (patch26)", "st.ign=1;try{history.back()}"),
    ("QA      stored settings are clamped to the sliders' ranges (patch27)", "custom:cwClamp({...Xu,...t?.custom??{}})"),
    ("QA      the clamp table covers every continuous field (patch27)", "visible:[3,8]"),
    ("QA      a legacy numeric custom.stack survives the clamp (patch27)",
     "else if(s!=null&&typeof s!=`number`)delete out[ns]"),
    ("QA      a card without a photo is not dropped by the loader (patch27)", "e.id&&(e.src||e.back||e.title)"),
    ("QA      an unreadable import is announced, not swallowed (patch28)", "Could not read that image - try another photo"),
    ("QA      a partial batch says how many landed (patch28)", "added - the rest could not be read"),
    ("QA      a failed replace-photo says so (patch28)", "Could not read that photo"),
    ("QA      share degrades to Web Share when the native plugin is missing (patch29)",
     "try{await cf.shareToWhatsApp"),
    ("QA      save-to-gallery degrades the same way (patch29)", "try{await cf.saveToGallery"),
    ("round 15  tier 1 glass is wired onto the sheet panel", "cw-glass-sheet cw-lg-primary"),
    ("round 15  the create disc is glass, filled from a themed token",
     "background:tn===`white`?`var(--lg-glass-white)`:tn===`black`?`var(--lg-glass-black)`:`var(--lg-solid-glass)`"),
    ("round 15  secondary floating controls get the light tier", "${cp?`cw-lg-fab`:`cw-lg-btn`}"),
    ("round 15  the Custom Pouch container is its own recessed tier", "cw-card cw-lg-pouch"),
    ("round 15  the live preview gets a glass frame", "cw-preview cw-lg-preview"),
    ("round 15  the material cross-fades with the sheet", "initial:{y:`100%`,opacity:.92}"),
    ("carry    NFC and auto-detect stay pinned off at load", "n.autoDetect=!1,n.nfc=!1"),
    ("carry    the Wallet wordmark is the header's own label", "children:`Wallet`"),
]
MUST_NOT = [
    ("removed feature 'Auto-detect details' must stay out", "Auto-detect details"),
    ("removed feature 'Fill in from picture' must stay out", "Fill in from picture"),
    ("removed feature 'Make your own pouch' must stay out", "Make your own pouch"),
    ("no CVV/CVC field may be offered or stored (patch29)", "`CVV`"),
    ("no eval in the shipped bundle", "eval("),
]

# React's own prop tables legitimately mention dangerouslySetInnerHTML / innerHTML, so this half has
# to be scoped to the app's code. /*cardwallet:header*/ (patch 8) is the app's first own marker, so
# anything from there on is ours - that is the range where HTML injection would have to live.
APP_START = "/*cardwallet:header*/"
MUST_NOT_APP = [
    ("no dangerouslySetInnerHTML anywhere in app code", "dangerouslySetInnerHTML"),
    ("no innerHTML assignment in app code", "innerHTML="),
    ("no document.write in app code", "document.write"),
    ("no insertAdjacentHTML in app code", "insertAdjacentHTML"),
]
# The app's own copy is allowed to *say* CVV (it promises not to ask for one); the data layer may not.
CVV_COPY = "no CVV, no PIN"


def main() -> int:
    if not APK.exists():
        print(f"FATAL: {APK} not found")
        return 2
    z = zipfile.ZipFile(APK)
    js = z.read(JS_ENTRY).decode("utf-8", "replace")
    css = z.read(CSS_ENTRY).decode("utf-8", "replace")
    tree_js = (ROOT / "repo_export/app/index.js").read_text(encoding="utf-8")
    tree_css = (ROOT / "repo_export/app/index.css").read_text(encoding="utf-8")
    passed = total = 0

    def chk(label, ok, detail=""):
        nonlocal passed, total
        total += 1
        passed += bool(ok)
        print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"   {detail}" if detail else ""))

    chk("payload: embedded index.js is byte-identical to the reviewed tree", js == tree_js, f"{len(js)} chars")
    chk("payload: embedded index.css is byte-identical to the reviewed tree", css == tree_css, f"{len(css)} chars")
    chk("round 15  the shipped stylesheet carries the Liquid Glass block", "Round 15 - Liquid Glass" in css)
    blurred = len(re.findall(r"[^{}]+\{[^{}]*backdrop-filter:\s*blur", css))
    chk("perf budget: exactly 4 selectors blur in the shipped CSS (2 wallet-era + the 2 new tiers)",
        blurred == 4, f"{blurred} blurred selectors")
    for cls in (".cw-range", ".cw-chip", ".cw-dot", ".cw-card", ".cw-lg-preview", ".cw-lg-pouch"):
        m = re.search(r"\n\." + cls[1:] + r"\{([^}]*)\}", css)
        chk(f"perf budget: {cls} re-blurs nothing inside the sheet", not m or "backdrop-filter" not in m.group(1))
    for label, needle in MUST:
        chk(label, needle in js)
    for label, needle in MUST_NOT:
        chk(label, needle not in js)
    cut = js.find(APP_START)
    if cut < 0:
        chk(f"app-code marker {APP_START!r} present (needed to scope the injection checks)", False, "patch 8 marker missing")
    else:
        tail = js[cut:]
        for label, needle in MUST_NOT_APP:
            chk(label, needle not in tail, f"{tail.count(needle)} hit(s)" if needle in tail else "")
    # the two faces of the CVV rule: banned as a field, present as a promise
    chk("privacy: the tap flow's copy states CVV/PIN are not read", CVV_COPY in js)
    print(f"\n{passed}/{total} in-APK content checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
