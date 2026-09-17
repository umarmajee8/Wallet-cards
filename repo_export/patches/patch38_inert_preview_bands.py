#!/usr/bin/env python3
"""Round 23 - the empty bands around the card preview stop taking touches.

The report, verbatim: *"On the card detail/preview screen (shown when a card is opened), the areas above
and below the card itself (the top region near the header, and the bottom region above the WhatsApp/Save
buttons - both highlighted in red in the screenshot) should not be interactive/clickable/tappable at all.
Currently these empty areas seem to register touches or scroll actions, which shouldn't happen."* And the
scope: *"Only the two bottom buttons (WhatsApp and Save) remain functional/clickable"*, the card preview
*"keeps whatever interaction it currently has (e.g. viewing/zooming)"*.

**What the bands actually were.** The viewer (`function jd`, the overlay the card ejects into) is one
`fixed inset-0 z-50` box with three children: the full-screen backdrop, the card box, and the button row.
The backdrop is the only thing under the top and bottom bands, so every touch there landed on it - and it
was wired to two behaviours by its parent:

    (0,U.jsxs)(X.div,{className:`fixed inset-0 z-50`, ... ,onClick:te, children:[ (backdrop) (card) (buttons) ])

`te` is the viewer's own close routine (`te=()=>{A(),t()}`), so **a tap anywhere in the empty band closed
the card preview** - the "registers touches" half of the report. The overlay also declared no
`touch-action` of its own, so a drag in the band was left to the browser as an ordinary pan gesture: the
"or scroll actions" half. Round 9 (patch 15) fixed exactly this class of bug for the *pouch row*
(`touch-action:none` + `overscroll-behavior:none` on `<main>`, a `pointer-events:none` wrapper, and a
`closest('[data-cwc]')` guard on the drag) - but that guard lives on `<main>`, and this overlay is
`<main>`'s **sibling**, not its child, so none of it applied here.

**The fix** (three things, all in the viewer's overlay root - nothing else in the bundle changes):

    root      className `fixed inset-0 z-50`  -> `fixed inset-0 z-50 touch-none`
              (every touch in the overlay starts inside this element, so the browser can no longer pan,
               zoom, rubber-band or double-tap-zoom from the bands - the round-9 guard, for this screen)
    root      `onClick:te` removed            -> the bands no longer dismiss the preview
    backdrop  kept as the hit target, and marked inert: `data-cwband:"preview"` + a
              `/*cardwallet:inert-bands*/` marker. This is what makes the bands *dead* rather than
              *transparent*: the shield still swallows the touch, so it cannot reach the dock's
              Create/Search/More buttons that sit at z-40 behind this overlay.

The card box and the two buttons are untouched: their own handlers (`onPointerDown:re` … on the card,
`onClick` + `pointer-events-auto` on each button) are all still there, and because they are siblings
*above* the backdrop nothing about their hit areas changed.

**What still closes the preview** (the report asked for the bands to stop doing it, not for the viewer to
become undismissable): swiping the card down (`N` -> `if(n>90){te();return}`), which is the card's own
gesture and is exercised by the smoke suite's deck hand-off test; and the Android Back / history contract
from patch 26 (`shut=()=>{if(f){p(null);…}`). The tap-outside dismissal is the behaviour this round
deliberately removes.

**Deliberately not touched:** the viewer's colours (`#09090b` card, `rgba(9,9,11,0.94)` backdrop - like
Photos, theme-independent), the card's zoom / pan / double-tap-flip / long-press-details gestures, the two
buttons' look, and every other overlay. No stylesheet edit at all: `touch-none` already ships as
`.touch-none{touch-action:none}` in the compiled CSS (asserted below).

Run:  python3 repo_export/patches/patch38_inert_preview_bands.py [--check]
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

CHECK = "--check" in sys.argv
ROOT = Path(__file__).resolve().parents[1]
JS_PATH = ROOT / "app" / "index.js"
CSS_PATH = ROOT / "app" / "index.css"

# --------------------------------------------------------------------- the bundle
# The viewer's overlay root plus its backdrop, in one replacement: the two edits have to stay in step
# (a `touch-none` root with the old dismissal click still in place would keep the report's tap bug).
ROOT_OLD = (
    "(0,U.jsxs)(X.div,{className:`fixed inset-0 z-50`,initial:{opacity:0},animate:{opacity:1},"
    "exit:{opacity:0},transition:{duration:.26},onClick:te,children:["
    "(0,U.jsx)(`div`,{className:`absolute inset-0`,style:{background:`rgba(9,9,11,0.94)`}})"
)
ROOT_NEW = (
    "(0,U.jsxs)(X.div,{className:`fixed inset-0 z-50 touch-none`,initial:{opacity:0},"
    "animate:{opacity:1},exit:{opacity:0},transition:{duration:.26},children:["
    "/*cardwallet:inert-bands*/(0,U.jsx)(`div`,{className:`absolute inset-0`,\"data-cwband\":`preview`,"
    "style:{background:`rgba(9,9,11,0.94)`}})"
)
MARKER = "/*cardwallet:inert-bands*/"
BAND_ATTR = '"data-cwband":`preview`'


def report(state: str) -> None:
    print({
        "todo": "clean (the bands still go through the overlay's own dismissal click)",
        "part": "PARTIAL: the overlay root moved but the backdrop is not marked inert - re-run to finish",
        "done": "applied (the empty bands around the preview are dead; the card and both buttons live)",
    }[state])


js = JS_PATH.read_text(encoding="utf-8")
css = CSS_PATH.read_text(encoding="utf-8")

root_done = "`fixed inset-0 z-50 touch-none`" in js
band_done = BAND_ATTR in js and MARKER in js

if CHECK:
    stale = []
    if ROOT_OLD in js or not root_done:
        stale.append("the overlay root (touch-action guard)")
    if not band_done:
        stale.append("the inert backdrop shield")
    if stale:
        print("STALE ANCHORS: " + ", ".join(stale))
        raise SystemExit(1)
    report("done" if root_done and band_done else "part")
    raise SystemExit(0)

if not (root_done and band_done):
    if js.count(ROOT_OLD) != 1:
        raise SystemExit(f"refusing to write - the viewer overlay matched {js.count(ROOT_OLD)} times, "
                         "expected exactly 1 (patches 7-37 must be applied first)")
    before = js
    js = js.replace(ROOT_OLD, ROOT_NEW)
    # the edit is exactly the edit: the reverse replacement rebuilds the pre-image byte for byte, so
    # nothing else in the 500 kB bundle can have moved with it
    assert js.replace(ROOT_NEW, ROOT_OLD) == before, "the replacement was not span-exact"
    print("ok    the viewer overlay declares touch-action:none and no longer closes on a band tap")
    print("ok    the backdrop is an inert shield (`data-cwband` = preview, marker " + MARKER + ")")
else:
    print("skip  the viewer's bands are already inert")

# ------------------------------------------------------------------------- guards
assert "onClick:te" not in js, "the overlay's dismissal click is still bound somewhere"
# (2) the card box and its gesture handlers are untouched - the report keeps the preview interactive
CARD = "className:`no-select absolute touch-none`"
assert js.count(CARD) == 1, "the preview card box moved"
assert ("onClick:e=>e.stopPropagation(),onPointerDown:re,onPointerMove:M,onPointerUp:N,"
        "onPointerCancel:N,onWheel:e=>{") in js, "the card's gesture handlers changed"
for gesture in ("onPointerDown:re", "onPointerMove:M", "onPointerUp:N", "onPointerCancel:N", "onWheel:e=>{"):
    assert gesture in js, f"the card lost {gesture}"
assert "setPointerCapture?.(t.pointerId)" in js, "the card stopped capturing the pointer"
assert "if(n>90){te();return}" in js, "the card's swipe-down close went missing"
assert "te=()=>{A(),t()}" in js, "the viewer's close routine moved"
# (3) the two buttons stay hit targets inside a pointer-events:none row
assert js.count("pointer-events-auto flex items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-white") == 2, \
    "the WhatsApp/Save buttons lost their pointer-events-auto / layout class"
assert "pointer-events-none absolute inset-x-0 flex justify-center gap-2.5 px-5" in js, "the button row moved"
for label in ("`WhatsApp`", "`Save`", "`Add back picture`"):
    assert label in js, f"a viewer control went missing ({label})"
# (4) not a repaint: the viewer's own colours and the surfaces that stay theme-independent are unchanged
assert js.count("background:`rgba(9,9,11,0.94)`") == 1, "the backdrop colour changed"
assert "background:`#09090b`" in js, "the viewer's black surface changed"
for keep in ("rgba(10,10,12,0.45)", "rgba(20,20,22,0.92)", "`#000`"):
    assert keep in js, f"this patch touched a surface it does not own ({keep})"
# (5) the earlier rounds must survive
assert "/*cardwallet:header*/" in js and "/*cardwallet:no-wordmark*/" in js, "an earlier JS marker went missing"
assert "boxShadow:`var(--menu-shadow)`" in js and "#0b0b0d" not in js, "round 22's menu fix regressed"
assert "cw-cust-slot" in js and 'var ATTR = "data-cw-custom";' in js, "round 19's gate went missing"
# (6) the stylesheet is not part of this round - but the class the fix leans on must ship
assert ".touch-none{touch-action:none}" in css, "the `touch-none` utility is not in the compiled CSS"
for earlier in ("Round 15 - Liquid Glass", "Round 16 - the controls moved out",
                "Round 17 - the blur budget", "Round 18 - the lock gate",
                "Round 19 - the customization gate", "Round 22 - the overflow menu follows the theme"):
    assert earlier in css, f"a stylesheet block went missing: {earlier!r}"
assert css.count("--menu-shadow") == 2, "the round-22 shadow tokens changed"

if js.count(ROOT_NEW) != 1:
    raise SystemExit(f"the fixed overlay matched {js.count(ROOT_NEW)} times, expected exactly 1")

if js != JS_PATH.read_text(encoding="utf-8"):
    JS_PATH.write_text(js, encoding="utf-8")
    print("app/index.js written - the preview's empty bands take no touches")
else:
    print("app/index.js already in the fixed state - nothing written")

# node --check, so a mangled bundle can never leave this script
with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
    fh.write(JS_PATH.read_text(encoding="utf-8"))
    tmp = fh.name
node = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
Path(tmp).unlink(missing_ok=True)
if node.returncode != 0:
    first = next((l for l in node.stderr.splitlines() if "Error" in l), node.stderr[:200])
    raise SystemExit(f"generated bundle does not parse: {first}")
print("ok    node --check on the generated bundle")
