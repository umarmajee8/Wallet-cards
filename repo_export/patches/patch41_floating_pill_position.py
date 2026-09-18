#!/usr/bin/env python3
"""Round 26 - Floating control pill is repositioned below the status bar.

Screenshot highlights the pill (+, search, menu) at the very top (touching the
status bar). Request:

* Plus, Search and Menu floating pill should NOT be at the very top
* Shift the whole pill down and place it in a balanced position above the card
  area, centered and properly aligned, with sufficient spacing from the status bar
* Keep current design, size, shape, icons and glass effect exactly the same
* Only vertical position changes
* Pill must be centered with sufficient spacing above the card, not near status bar
* Final placement follows the highlighted area but noticeably lower
* Do NOT change main card position

What the pill was before:
Patch 31 + 39 put the pill in a bottom-right dock:
  fixed inset-x-0 bottom-0 z-40 px-2, paddingBottom: env(safe-area)+10px,
  inner row justify-end, cw-dock at bottom-right, menu opens upward
  (transformOrigin right bottom, mb-1, y:-6).

The screenshot shows the pill at the very top (top-0, paddingTop env+6px,
justify-end). Either way it is at an edge, not above the card. The new
position is still fixed, but at the top with a lower offset and centered:

  fixed inset-x-0 top-0 z-40 px-2, paddingTop: calc(env(safe-area-inset-top) + 36px)
  inner row justify-center (instead of justify-end)

The pill itself (cw-dock) keeps gap:4px padding:6px 8px, 36px boxes, 19/21px glyphs,
glass tier, tone:auto - unchanged. Only the anchor moves. The dropdown that
belongs to the pill now opens downward (transformOrigin right top, mt-1, y:6)
instead of upward, so it does not get clipped by the top edge.

Run: python3 repo_export/patches/patch41_floating_pill_position.py [--check]
"""
from __future__ import annotations
import subprocess, sys, tempfile
from pathlib import Path

CHECK = "--check" in sys.argv
ROOT = Path(__file__).resolve().parents[1]
JS_PATH = ROOT / "app" / "index.js"
CSS_PATH = ROOT / "app" / "index.css"

# The pill lives in `zd` - the header/dock component. Two anchors:
# 1) the dock row itself (bottom-0 -> top-0, paddingBottom -> paddingTop, justify-end -> justify-center)
DOCK_OLD = (
    "className:`pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2`,"
    "style:{paddingBottom:`calc(env(safe-area-inset-bottom) + 10px)`},"
    "children:[(0,U.jsxs)(`div`,{className:`pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-end gap-1 px-2`,"
    "children:[(0,U.jsxs)(`div`,{className:`cw-dock pointer-events-auto flex items-center`,"
)
DOCK_NEW = (
    "className:`pointer-events-none fixed inset-x-0 top-0 z-40 px-2`,"
    "style:{paddingTop:`calc(env(safe-area-inset-top) + 36px)`},"
    "children:[(0,U.jsxs)(`div`,{className:`pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-center gap-1 px-2`,"
    "children:[(0,U.jsxs)(`div`,{className:`cw-dock pointer-events-auto flex items-center`,"
)

# 2) the dropdown that hangs off the pill (bottom -> top, mb-1 -> mt-1, y:-6 -> y:6)
MENU_OLD = (
    "className:`pointer-events-auto mx-auto w-full max-w-[520px] px-2`,"
    "style:{transformOrigin:`right bottom`},"
    "children:(0,U.jsx)(`div`,{className:`ml-auto mb-1 w-[248px]"
)
MENU_NEW = (
    "className:`pointer-events-auto mx-auto w-full max-w-[520px] px-2`,"
    "style:{transformOrigin:`right top`},"
    "children:(0,U.jsx)(`div`,{className:`ml-auto mt-1 w-[248px]"
)

# Also adjust the motion y so the menu animates downward from the pill
MOTION_OLD = "initial:{opacity:0,scale:.94,y:-6},animate:{opacity:1,scale:1,y:0},exit:{opacity:0,scale:.96,y:-4}"
MOTION_NEW = "initial:{opacity:0,scale:.94,y:6},animate:{opacity:1,scale:1,y:0},exit:{opacity:0,scale:.96,y:4}"

js = JS_PATH.read_text(encoding="utf-8")
css = CSS_PATH.read_text(encoding="utf-8")

dock_done = DOCK_NEW in js
menu_done = MENU_NEW in js
motion_done = MOTION_NEW in js

if CHECK:
    stale = []
    if not dock_done:
        stale.append("the dock pill position (top-0 +36px, justify-center)")
    if not menu_done:
        stale.append("the pill menu (right top, mt-1)")
    if not motion_done:
        stale.append("the menu motion (y:6)")
    if stale:
        print("STALE ANCHORS: " + ", ".join(stale))
        raise SystemExit(1)
    print("applied (pill is centered above the card, 36px below safe area, design untouched)")
    raise SystemExit(0)

# --- dock row ---
if not dock_done:
    if js.count(DOCK_OLD) != 1:
        raise SystemExit(f"refusing to write dock - matched {js.count(DOCK_OLD)} times, expected 1")
    js = js.replace(DOCK_OLD, DOCK_NEW)
    print("ok    dock: pill moved from bottom-0 to top-0 +36px, justify-end -> justify-center (centered above card)")
else:
    print("skip  dock already at top-0 +36px, centered")

# --- menu anchor ---
if not menu_done:
    if js.count(MENU_OLD) != 1:
        raise SystemExit(f"refusing to write menu anchor - matched {js.count(MENU_OLD)} times, expected 1")
    js = js.replace(MENU_OLD, MENU_NEW)
    print("ok    menu: opens downward from the pill (right top, mt-1)")
else:
    print("skip  menu already opens downward")

# --- motion y ---
if not motion_done:
    if js.count(MOTION_OLD) != 1:
        raise SystemExit(f"refusing to write motion - matched {js.count(MOTION_OLD)} times, expected 1")
    js = js.replace(MOTION_OLD, MOTION_NEW)
    print("ok    motion: dropdown animates downward (y:6)")
else:
    print("skip  motion already y:6")

# --- guards ---
assert "/*cardwallet:header*/" in js, "header marker lost"
assert "/*cardwallet:no-wordmark*/" in js, "no-wordmark marker lost"
assert DOCK_NEW in js, "dock not at expected position"
assert MENU_NEW in js, "menu not at expected position"
assert MOTION_NEW in js, "motion not at expected y"
# design, size, shape, icons, glass untouched
assert ".cw-dock{gap:4px;padding:6px 8px}" in css, "cw-dock metrics changed"
assert "cw-lg-fab" in js and "cw-lg-btn" in js, "fab/btn classes lost"
assert "background:tn===`white`?`var(--lg-glass-white)`" in js, "glass effect changed"
assert "width:sz,height:sz,viewBox:`0 0 24 24`" in js, "icon size changed"
# card position untouched: main still has its paddings and justify-center, card still uses pouchW/pouchH
assert "paddingTop:`calc(env(safe-area-inset-top) + 58px)`" in js, "card top padding changed"
assert "paddingBottom:`calc(env(safe-area-inset-bottom) + 62px)`" in js, "card bottom padding changed"
assert "className:(j.view||`carousel`)===`stack`?`flex min-h-0 flex-1 flex-col`:`flex flex-1 flex-col items-center justify-center`" in js, "card layout changed"
# pill is centered, not right-aligned, and not at the very top
assert "justify-center gap-1 px-2" in js, "pill not centered"
assert "paddingTop:`calc(env(safe-area-inset-top) + 36px)`" in js, "pill not 36px below safe area"
assert "pointer-events-none fixed inset-x-0 top-0 z-40 px-2" in js, "pill not fixed top-0"
# no extra bottom dock left
assert js.count("pointer-events-none fixed inset-x-0 bottom-0") == 0, "stale bottom dock still there"

if js != JS_PATH.read_text(encoding="utf-8"):
    JS_PATH.write_text(js, encoding="utf-8")
    print("app/index.js written - pill is now centered above the card, 36px below safe area")
else:
    print("app/index.js already in the fixed state - nothing written")

with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
    fh.write(JS_PATH.read_text(encoding="utf-8"))
    tmp = fh.name
node = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
Path(tmp).unlink(missing_ok=True)
if node.returncode != 0:
    first = next((l for l in node.stderr.splitlines() if "Error" in l), node.stderr[:300])
    raise SystemExit(f"generated bundle does not parse: {first}")
print("ok    node --check on the generated bundle")
