#!/usr/bin/env python3
"""Round 27 - Move pill from top to bottom-center, just below card stack.

Request (new):
* Remove pill-shaped bar from top of header
* Add same pill (same icons/order: +, search, menu) at bottom, horizontally centered
* Keep floating above bottom nav/tab bar, respect safe-area insets (home indicator / gesture bar)
* Preserve tap actions, only position/centering changes
* Apply consistently across every screen

What pill was before patch42:
Patch41 put it at top-center, 36px below safe area:
  fixed inset-x-0 top-0 z-40 px-2, paddingTop calc(env(safe-area-inset-top)+36px),
  inner row justify-center, menu right top mt-1 y:6 (downward).

Patch31/39 before that had it at bottom-right:
  fixed inset-x-0 bottom-0 z-40 px-2, paddingBottom env(safe-area)+10px,
  inner row justify-end, menu right bottom mb-1 y:-6 (upward).

New requirement is bottom-center, just below card stack, floating above bottom nav.
We keep the same pill design (cw-dock gap:4px padding:6px 8px, 36px boxes, etc.)
but anchor it at the bottom, centered, with safe-area bottom inset.

  fixed inset-x-0 bottom-0 z-40 px-2, paddingBottom calc(env(safe-area-inset-bottom)+16px)
  inner row justify-center (was justify-center at top, keep centered)
  menu right bottom mb-1 y:-6 (upward, so it does not get clipped by bottom edge)

The top header (fixed inset-x-0 top-0 +6px, justify-end, empty after round21)
stays as the zero-height header row (do not move). Only the dock moves.

Run: python3 repo_export/patches/patch42_bottom_centered_dock.py [--check]
"""
from __future__ import annotations
import subprocess, sys, tempfile
from pathlib import Path

CHECK = "--check" in sys.argv
ROOT = Path(__file__).resolve().parents[1]
JS_PATH = ROOT / "app" / "index.js"
CSS_PATH = ROOT / "app" / "index.css"

# Dock row: top-0 +36px -> bottom-0 +16px, keep justify-center
DOCK_OLD = (
    "className:`pointer-events-none fixed inset-x-0 top-0 z-40 px-2`,"
    "style:{paddingTop:`calc(env(safe-area-inset-top) + 36px)`},"
    "children:[(0,U.jsxs)(`div`,{className:`pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-center gap-1 px-2`,"
    "children:[(0,U.jsxs)(`div`,{className:`cw-dock pointer-events-auto flex items-center`,"
)
DOCK_NEW = (
    "className:`pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2`,"
    "style:{paddingBottom:`calc(env(safe-area-inset-bottom) + 16px)`},"
    "children:[(0,U.jsxs)(`div`,{className:`pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-center gap-1 px-2`,"
    "children:[(0,U.jsxs)(`div`,{className:`cw-dock pointer-events-auto flex items-center`,"
)

# Menu: right top mt-1 y:6 -> right bottom mb-1 y:-6
MENU_OLD = (
    "className:`pointer-events-auto mx-auto w-full max-w-[520px] px-2`,"
    "style:{transformOrigin:`right top`},"
    "children:(0,U.jsx)(`div`,{className:`ml-auto mt-1 w-[248px]"
)
MENU_NEW = (
    "className:`pointer-events-auto mx-auto w-full max-w-[520px] px-2`,"
    "style:{transformOrigin:`right bottom`},"
    "children:(0,U.jsx)(`div`,{className:`ml-auto mb-1 w-[248px]"
)

MOTION_OLD = "initial:{opacity:0,scale:.94,y:6},animate:{opacity:1,scale:1,y:0},exit:{opacity:0,scale:.96,y:4}"
MOTION_NEW = "initial:{opacity:0,scale:.94,y:-6},animate:{opacity:1,scale:1,y:0},exit:{opacity:0,scale:.96,y:-4}"

js = JS_PATH.read_text(encoding="utf-8")
css = CSS_PATH.read_text(encoding="utf-8")

dock_done = DOCK_NEW in js
menu_done = MENU_NEW in js
motion_done = MOTION_NEW in js

if CHECK:
    stale = []
    if not dock_done:
        stale.append("the dock pill position (bottom-0 +16px, centered)")
    if not menu_done:
        stale.append("the pill menu (right bottom, mb-1)")
    if not motion_done:
        stale.append("the menu motion (y:-6)")
    if stale:
        print("STALE ANCHORS: " + ", ".join(stale))
        raise SystemExit(1)
    print("applied (pill is bottom-centered, floating above safe area, design untouched)")
    raise SystemExit(0)

if not dock_done:
    if js.count(DOCK_OLD) != 1:
        raise SystemExit(f"refusing to write dock - matched {js.count(DOCK_OLD)} times, expected 1")
    js = js.replace(DOCK_OLD, DOCK_NEW)
    print("ok    dock: pill moved from top-0 +36px to bottom-0 +16px, keep justify-center (centered, floating above bottom nav)")
else:
    print("skip  dock already at bottom-0 +16px, centered")

if not menu_done:
    if js.count(MENU_OLD) != 1:
        raise SystemExit(f"refusing to write menu anchor - matched {js.count(MENU_OLD)} times, expected 1")
    js = js.replace(MENU_OLD, MENU_NEW)
    print("ok    menu: opens upward from the pill (right bottom, mb-1)")
else:
    print("skip  menu already opens upward")

if not motion_done:
    if js.count(MOTION_OLD) != 1:
        raise SystemExit(f"refusing to write motion - matched {js.count(MOTION_OLD)} times, expected 1")
    js = js.replace(MOTION_OLD, MOTION_NEW)
    print("ok    motion: dropdown animates upward (y:-6)")
else:
    print("skip  motion already y:-6")

# guards
assert "/*cardwallet:header*/" in js, "header marker lost"
assert "/*cardwallet:no-wordmark*/" in js, "no-wordmark marker lost"
assert DOCK_NEW in js, "dock not at expected bottom position"
assert MENU_NEW in js, "menu not at expected position"
assert MOTION_NEW in js, "motion not at expected y"
assert ".cw-dock{gap:4px;padding:6px 8px}" in css, "cw-dock metrics changed"
assert "cw-lg-fab" in js and "cw-lg-btn" in js, "fab/btn classes lost"
# card position untouched
assert "paddingTop:`calc(env(safe-area-inset-top) + 58px)`" in js, "card top padding changed"
assert "paddingBottom:`calc(env(safe-area-inset-bottom) + 62px)`" in js, "card bottom padding changed"
# pill is centered and at bottom, not at top very edge
assert "justify-center gap-1 px-2" in js, "pill not centered"
assert "paddingBottom:`calc(env(safe-area-inset-bottom) + 16px)`" in js, "pill not 16px above safe area"
assert "pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2" in js, "pill not fixed bottom-0"
assert js.count("pointer-events-none fixed inset-x-0 bottom-0") == 1, "should be exactly one bottom dock"
# top header remains at top-0 +6px empty (do not remove)
assert "paddingTop:`calc(env(safe-area-inset-top) + 6px)`" in js, "top header lost"
# no pill left at top 36px
assert "paddingTop:`calc(env(safe-area-inset-top) + 36px)`" not in js, "stale top pill still there"

if js != JS_PATH.read_text(encoding="utf-8"):
    JS_PATH.write_text(js, encoding="utf-8")
    print("app/index.js written - pill is now bottom-centered, floating above safe area")
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
