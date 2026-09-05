#!/usr/bin/env python3
"""Stack cover = the wallet colour (no glass), NFC stays off, light by default, and
a "Wallet" wordmark in the header.

Four asks from the device, all in one patch:

1. *"Stack meh jo cover ha blur wala us ko khatam kro, or jo colour pick krty hain
   wallet/carousel k liye wo us ki jaga laga do."*  Patch 15 had already taken the
   `backdrop-filter` off the flap and left a translucent panel; the panel itself is what
   he wants gone. It is now painted from the *same colour the carousel pouch uses* - the
   card's own `color` if it has one, else the wallet's `custom.color`/`slateColor` - through
   the bundle's own shading helper (`td(hex, mul)`), exactly like the carousel's tray:
   light at the mouth, the colour in the middle, darkened at the bottom. No glass, no blur,
   and it is opaque, so nothing shows through.

2. *"nfc auto off rakho."*  Off, and it *stays* off: the setting's default is `false` and
   the loader forces `n.nfc=!1` - the same idiom the app already uses for the removed
   auto-detect feature (`n.autoDetect=!1`). The "Tap a bank card" entry is gated on
   `nfc` in the + menu and on the reader sheet, so both are gone. The Settings row for it
   is removed as well, because a toggle that cannot hold its value is worse than no row.

3. *"auto light mode rakho."*  Default appearance is `light`, and installs that never
   chose an appearance (the old default was `system`) are migrated once - flagged with
   `appearanceMigrated` so that a later, deliberate System/Dark pick survives.

4. *"header pr top left corner pr bara bold Wallet likho, font ios wala ho."*  A wordmark
   as the first child of the header row (`margin-right:auto` pushes the icons to the right,
   which is where they already are), 28px / weight 800, tight negative tracking and the
   Apple font stack (`-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
   "Helvetica Neue"`) before the app's existing fallbacks; colour `var(--ink)` so it reads
   in both themes, and it sits inside the safe-area padding like the rest of the header.
   The insertion is *after* patch 8's `/*cardwallet:header*/` marker so patch 8's own
   anchors keep matching.

Run:  python3 repo_export/patches/patch17_stack_colour_panel.py [--check]
Depends on patches 7, 8, 12, 13, 14, 15, 16.
"""
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

# --- 1) defaults: NFC off, light appearance -------------------------------------
DEF_OLD = "Qp={autoDetect:!1,nfc:!0,appearance:`system`,theme:`slate`"
DEF_NEW = "Qp={autoDetect:!1,nfc:!1,appearance:`light`,theme:`slate`"

# --- 2) loader: NFC forced off, one-time appearance migration ---------------------
LOAD_OLD = "n.custom={...Xu,...n.custom||{}},n.autoDetect=!1,n"
LOAD_NEW = (
    "n.custom={...Xu,...n.custom||{}},n.autoDetect=!1,n.nfc=!1,"
    "n.appearance===`system`&&!n.appearanceMigrated&&(n.appearance=`light`,n.appearanceMigrated=!0),"
    "n"
)

# --- 3) Settings: the NFC row goes away with the feature --------------------------
NFC_SECTION_OLD = (
    ",(0,U.jsx)(`div`,{className:`pb-2 pt-5 text-[13px] font-medium uppercase tracking-[0.12em] sub`,"
    "children:`Tap to read`}),(0,U.jsxs)(`div`,{className:`rounded-2xl px-4 py-4`,"
    "style:{background:`var(--raised)`,border:`1px solid var(--line)`},children:["
    "(0,U.jsxs)(`div`,{className:`flex items-start gap-3`,children:["
    "(0,U.jsxs)(`div`,{className:`min-w-0 flex-1`,children:["
    "(0,U.jsx)(`span`,{className:`text-[16px] font-semibold ink`,children:`Read cards over NFC`}),"
    "(0,U.jsx)(`p`,{className:`mt-1 pr-2 text-[13px] leading-snug sub`,children:`Adds “Tap a bank card” "
    "to the + menu. Hold a debit or credit card against the back of the phone and its number and expiry "
    "are filled in. The CVV and the PIN are not on the chip, and nothing is ever paid.`})]}),"
    "(0,U.jsx)(Mp,{on:t.nfc,onChange:e=>n({nfc:e})})]}),"
    "(0,U.jsx)(`div`,{className:`mt-3 border-t hairline pt-3 text-[13px] font-medium sub`,children:t.nfc?"
    "(0,U.jsx)(`span`,{className:`text-[#0a84ff]`,children:`On · “Tap a bank card” is in the + menu`}):"
    "(0,U.jsx)(`span`,{children:`Off · cards are added by photo or by hand`})})]})"
)
NFC_SECTION_NEW = ""

# --- 4) the stack cover wears the wallet's colour instead of glass -----------------
FLAP_OLD = (
    "background:`linear-gradient(180deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.07) 48%, "
    "rgba(20,20,24,0.30) 100%) rgba(28,28,34,0.72)`,"
    "border:`1px solid rgba(255,255,255,0.38)`,"
    "boxShadow:`0 12px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.45)`"
)
FLAP_NEW = (
    "background:`linear-gradient(180deg, ${td(col,1.18)} 0%, ${col} 52%, ${td(col,.70)} 100%)`,"
    "border:`1px solid ${td(col,.55)}`,"
    "boxShadow:`0 12px 28px -6px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.20)`"
)

# --- 5) "Wallet" wordmark, top left -----------------------------------------------
HDR_OLD = "children:[/*cardwallet:header*/(0,U.jsx)(g,{label:`Add card`"
HDR_NEW = (
    "children:[/*cardwallet:header*/(0,U.jsx)(`span`,{style:{marginRight:`auto`,marginLeft:`6px`,"
    "fontFamily:`-apple-system,BlinkMacSystemFont,\"SF Pro Display\",\"SF Pro Text\",\"Helvetica Neue\","
    "Inter,Segoe UI,Roboto,sans-serif`,fontSize:`28px`,lineHeight:`34px`,fontWeight:800,"
    "letterSpacing:`-.6px`,color:`var(--ink)`,userSelect:`none`,WebkitUserSelect:`none`,"
    "pointerEvents:`none`},children:`Wallet`}),(0,U.jsx)(g,{label:`Add card`"
)

EDITS = [
    (DEF_OLD, DEF_NEW, "defaults: nfc off, light appearance"),
    (LOAD_OLD, LOAD_NEW, "loader: nfc stays off + one-time appearance migration"),
    (NFC_SECTION_OLD, NFC_SECTION_NEW, "settings: the NFC row is gone with the feature"),
    (FLAP_OLD, FLAP_NEW, "stack cover: painted from the wallet colour, not glass"),
    (HDR_OLD, HDR_NEW, "header: bold Wallet wordmark on the left"),
]


# Patch 20 keeps this panel's colour work and re-tunes only the shadow alpha *inside*
# the span it wrote, so this edit counts as applied when that successor text is present.
DOWNSTREAM_KEEP = {
    "stack cover: painted from the wallet colour, not glass": "(0.55*sh).toFixed(2)",
}


def status(data):
    """(pending, applied, unrecognised).

    An edit whose `old` text survives inside its own `new` text (or that deletes a span
    outright) has to be judged by its output, or a re-run would duplicate/remove again.
    """
    todo, done, bad = [], [], []
    for old, new, label in EDITS:
        if not new:                       # a deletion: applied means "the text is gone"
            if old in data:
                todo.append((old, new, label))
            else:
                done.append(label)
        elif old in new and data.count(new) >= 1:
            done.append(label)
        elif data.count(old) == 1:
            todo.append((old, new, label))
        elif data.count(new) >= 1 or (DOWNSTREAM_KEEP.get(label) or "") in data:
            done.append(label)
        else:
            bad.append(label)
    return todo, done, bad


todo, done, bad = status(data)

if CHECK:
    if bad:
        print("STALE ANCHORS: " + ", ".join(bad))
        print("  (the flap span belongs to patch 15's output, the header marker to patch 8's;"
              " run 7 -> 8 -> 12 -> 13 -> 14 -> 15 -> 16 first)")
        raise SystemExit(1)
    print(f"clean (all {len(EDITS)} anchors present)" if not done
          else f"applied ({len(done)}/{len(EDITS)} edits in place)")
    raise SystemExit(0)

if bad:
    raise SystemExit(
        "refusing to write - anchors not found and no applied-output either: " + ", ".join(bad)
        + "\n  (run patches 7 -> 8 -> 12 -> 13 -> 14 -> 15 -> 16 before this one)"
    )
if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    data = data.replace(old, new)
    print(f"ok    {label}")

# Guards: each half of the ask has to be visible in the output, or the edit no-op'd.
assert "Qp={autoDetect:!1,nfc:!1,appearance:`light`" in data, "defaults not changed"
assert "n.nfc=!1" in data, "the loader does not hold NFC off"
assert "appearanceMigrated" in data, "the appearance migration is missing"
assert "children:`Tap to read`" not in data and "Read cards over NFC" not in data, "the NFC row survived"
cov = data.split("function __cwCoverCard")[1].split("function Td")[0]
assert "background:`linear-gradient(180deg, ${td(col,1.18)} 0%" in cov, "cover colour not applied"
assert "rgba(28,28,34,0.72)" not in cov, "the old glass panel is still there"
assert "backdropFilter:`none`" in cov, "flap lost its (now inert) filter key or moved"
assert "col=e.color||(j&&j.color)||k||`#3d3f46`" in cov, "the cover no longer reads the wallet colour"
hdr = data.split("function zd({onGallery")[1].split("function Bd")[0]
assert "children:`Wallet`" in hdr, "wordmark did not land in the header"
assert 'SF Pro Display' in hdr, "wordmark is not on the Apple font stack"
assert "marginRight:`auto`" in hdr, "the icons would not stay on the right"
# the marker patch 8 relies on must survive
assert "children:[/*cardwallet:header*/" in data, "patch 8's header marker was eaten"

import shutil
import subprocess
import tempfile

if shutil.which("node"):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(data)
        tmp = fh.name
    node = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    Path(tmp).unlink(missing_ok=True)
    if node.returncode:
        raise SystemExit("bundle does not parse:\n" + node.stderr[:1200])
    print("ok    node --check on the generated bundle")

path.write_text(data, encoding="utf-8")
print("app/index.js written - cover wears the wallet colour, NFC off, light default, Wallet wordmark")
