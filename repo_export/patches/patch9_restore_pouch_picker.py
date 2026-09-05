#!/usr/bin/env python3
"""Restore the "Pouch style" picker in Settings (regression fix).

The repo's `app/index.js` and the base APK had silently drifted: the base APK
(`CardWallet_no_pouch.apk`) carries the Pouch style section added in patch 4, but
the bundle that actually gets injected into every build - this file - does not
have it. Because `build_release_apk.py` / `build_debug_apk.py` replace only the JS
entry, every APK built from this repo has been shipping **without any way to pick
a pouch style**, even though the README advertises Frosted / Steel / Emerald.

Two things are needed to make that section mean anything, and this patch does
both:

  1. re-insert the section exactly as patch 4 wrote it, at the same place (start
     of the Settings body, before Design)
  2. drop the hard-coded `n.theme=`slate`` in the settings loader. That line is
     stock (it predates this patch series) and it rewrites the saved theme on
     every load, so a preset you pick is written to localStorage and then thrown
     away at the next start - the picker is decorative without this fix. Fresh
     installs are unaffected: `wallet.settings.v1` defaults to `slate` anyway, so
     the default pouch stays exactly as it is today. Only an install that
     explicitly chose a preset finally gets it.

Run:  python3 repo_export/patches/patch9_restore_pouch_picker.py [--check]
"""
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

MARK = "/*cardwallet:pouch-picker*/"

ANCHOR = "(0,U.jsxs)(`div`,{className:`overflow-y-auto px-5 pt-3`,style:{maxHeight:`calc(88vh - 70px)`},children:["

PICKER = (
    MARK
    + "(0,U.jsxs)(`div`,{className:`mb-5`,children:["
    "(0,U.jsx)(`div`,{className:`pb-2 text-[13px] font-medium uppercase tracking-[0.12em] sub`,children:`Pouch style`}),"
    "(0,U.jsx)(`div`,{className:`flex gap-3`,children:["
    "{id:`frost`,name:`Frosted`,c1:`#2b2b2f`,c2:`#0d0d0f`},"
    "{id:`steel`,name:`Steel`,c1:`#5b5d6c`,c2:`#2c2e3d`},"
    "{id:`emerald`,name:`Emerald`,c1:`#163b2c`,c2:`#071a13`}"
    "].map(e=>(0,U.jsxs)(`button`,{key:e.id,onClick:()=>{n({theme:e.id}),navigator.vibrate&&navigator.vibrate(6)},"
    "className:`flex flex-1 flex-col items-center gap-1.5 rounded-2xl px-2 py-3 active:opacity-70`,"
    "style:{background:`var(--raised)`,border:t.theme===e.id?`2px solid #0a84ff`:`1px solid var(--line)`},"
    "children:["
    "(0,U.jsx)(`div`,{className:`h-9 w-14 rounded-lg`,style:{background:`linear-gradient(180deg, ${e.c1} 0%, ${e.c2} 100%)`}}),"
    "(0,U.jsx)(`span`,{className:`text-[12px] font-medium ink`,children:e.name})"
    "]}))})]})"
)

PIN = ("return n.theme=`slate`,n.slateColor||")
UNPIN = ("return n.slateColor||")

if CHECK:
    if data.count(PIN) + data.count(UNPIN) != 1:
        print("STALE ANCHOR: settings loader theme pin")
        raise SystemExit(1)
    if MARK in data:
        print("clean (picker already present)")
        raise SystemExit(0)
    ok = data.count(ANCHOR) == 1
    print("clean (anchor present)" if ok else "STALE ANCHOR: settings body not found where expected")
    raise SystemExit(0 if ok else 1)

changed = False
if MARK in data:
    print("skip: picker already restored")
else:
    assert data.count(ANCHOR) == 1, f"anchor: expected 1 match, found {data.count(ANCHOR)}"
    data = data.replace(ANCHOR, ANCHOR + PICKER + ",")
    print("ok    Pouch style picker re-inserted (Frosted / Steel / Emerald)")
    changed = True

if data.count(PIN) == 1:
    data = data.replace(PIN, UNPIN)
    print("ok    settings loader no longer forces theme=slate (saved preset is honoured)")
    changed = True
elif data.count(UNPIN) == 1:
    print("skip  theme pin already removed")
else:
    raise SystemExit("STALE ANCHOR: settings loader theme pin")

if changed:
    path.write_text(data, encoding="utf-8")
    print("app/index.js written")
else:
    print("nothing to do")
