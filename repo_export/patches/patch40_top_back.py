#!/usr/bin/env python3
"""Round 25 - the upper area of the card preview becomes a functional back zone.

Request (Urdu, screenshot highlights the whole top dark area above the card):

* Screen ke upper area par tap karne se card immediately close ho aur user
  previous screen par wapas chala jaye
* Android back gesture / back button bhi properly previous screen par le jaye
* Card close hone par user ko exactly usi screen aur position par return karna
  chahiye jahan se card open kiya tha wesi hi animation
* Navigation smooth ho, unnecessary animation/delay na ho
* Existing card design/layout ko change na karein. Sirf navigation/touch behavior
* Important: Jo upper area screenshot mein highlighted hai usay functional back
  area banana hai. User ko separate visible back button zaroori nahi - upper
  area par tap karna hi back action trigger kare.

What the viewer was before this round
-------------------------------------
Patch 38 (round 23) made both bands inert for the report
"the areas above and below the card ... should not be interactive at all":
  root   className `fixed inset-0 z-50` -> `fixed inset-0 z-50 touch-none`
  root   onClick:te removed
  backdrop kept as inert shield `data-cwband:preview` + marker.

That fixed the "registers touches / scroll actions" report, but the new
screenshot-request asks for the *upper* band to be a back affordance again -
the same tap that patch 38 retired, but only for the upper area (the blue
outline in the screenshot). The bottom band must stay inert (otherwise a
tap between card and WhatsApp/Save would be an accidental dismiss, and the
two buttons are the only controls there - patch 38's second half).

The fix (two places, one replacement + one history wiring)
------------------------------------------------------------
1) Viewer overlay: insert a new hit target covering exactly the upper area
   above the card. The card's top is `k.tt` ( (vh - th)/2 ), so a div with
   `height:k.tt` from `top:0` is precisely the highlighted region, full width,
   regardless of phone size or orientation.

      children:[ /*inert-bands*/(backdrop), /*top-back*/(top zone), (card), (buttons) ]

   The top zone is `absolute inset-x-0 top-0` with `data-cwtop:back`,
   `height:k.tt`, `onClick:te` (the viewer's own close routine - same as the
   card's swipe-down `if(n>90){te();return}` and the existing exit animation
   that ejects back to the origin rect). It sits *above* the inert backdrop
   but *below* the card, so a tap on the card still reaches the card's own
   handlers, and a tap on WhatsApp/Save still reaches the buttons.

   No stylesheet block, no colour, no blur - the zone is invisible.

2) History: the viewer state `o` (jd's `state` prop, setter `s`) was not
   part of the `cwb` sentinel that pushes `history.pushState({cardwallet:`sheet`})`
   for every sheet. So opening the viewer did not push a history entry and a
   system Back would walk past the app. Now:

      op   ++ `||o`   and dependency array ++ `,o`
      shut ++ `if(o){s(null);return}`  (last - viewer is behind every sheet)

   The viewer is behind every sheet (z-50 vs z-60/75/80), so it closes *after*
   any sheet that is on top of it - a Back with viewer+details open closes
   details first, then viewer on the next Back, exactly like the existing
   sheets.

The exit animation is unchanged: `te=()=>{A(),t()}` -> `s(null)` -> the
`k.vert?{x:k.dx,...}:{x:k.dx,...}` tween back to the origin rect, same as
open in reverse. No extra animation is added.

Run:  python3 repo_export/patches/patch40_top_back.py [--check]
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

CHECK = "--check" in sys.argv
ROOT = Path(__file__).resolve().parents[1]
JS_PATH = ROOT / "app" / "index.js"
CSS_PATH = ROOT / "app" / "index.css"

# --------------------------------------------------------------------- viewer
# Patch 38's result is the anchor - one occurrence, byte-exact.
VIEWER_OLD = (
    "/*cardwallet:inert-bands*/(0,U.jsx)(`div`,{className:`absolute inset-0`,"
    "\"data-cwband\":`preview`,style:{background:`rgba(9,9,11,0.94)`}})"
    ",(0,U.jsx)(X.div,{className:`no-select absolute touch-none`"
)
VIEWER_NEW = (
    "/*cardwallet:inert-bands*/(0,U.jsx)(`div`,{className:`absolute inset-0`,"
    "\"data-cwband\":`preview`,style:{background:`rgba(9,9,11,0.94)`}})"
    ",/*cardwallet:top-back*/(0,U.jsx)(`div`,{className:`absolute inset-x-0 top-0`,"
    "\"data-cwtop\":`back`,style:{height:k.tt},onClick:te})"
    ",(0,U.jsx)(X.div,{className:`no-select absolute touch-none`"
)
TOP_MARKER = "/*cardwallet:top-back*/"
TOP_ATTR = '"data-cwtop":`back`'
TOP_CLASS = "absolute inset-x-0 top-0"

# -------------------------------------------------------------------- history
# The sentinel that owns the system Back for every sheet.
# op checks 9 states, shut closes one per popstate, dependency array lists them.
HIST_OLD_OP = "let op=()=>!!(f||v||T||m||c||D||k||b||C),shut=()=>{if(f){p(null);oe.current=[];return}"
HIST_NEW_OP = "let op=()=>!!(o||f||v||T||m||c||D||k||b||C),shut=()=>{if(f){p(null);oe.current=[];return}"
HIST_OLD_TAIL = "if(C)w(!1)},st=cwb.current"
HIST_NEW_TAIL = "if(C){w(!1);return}if(o){s(null);return}},st=cwb.current"
HIST_OLD_DEPS = "},[f,v,T,m,c,D,k,b,C]);"
HIST_NEW_DEPS = "},[o,f,v,T,m,c,D,k,b,C]);"


def report(state: str) -> None:
    print({
        "todo": "clean (the upper area is still inert - no back affordance)",
        "part": "PARTIAL: viewer wired but history not - re-run to finish",
        "done": "applied (the upper area is a back zone; Bottom stays inert; Back button closes the viewer)",
    }[state])


js = JS_PATH.read_text(encoding="utf-8")
css = CSS_PATH.read_text(encoding="utf-8")

viewer_done = TOP_MARKER in js and TOP_ATTR in js and TOP_CLASS in js
hist_done = HIST_NEW_OP in js and HIST_NEW_TAIL in js and HIST_NEW_DEPS in js
pouch_done = "data-tray" in js and "data-sheen" in js

if CHECK:
    stale = []
    if not viewer_done:
        stale.append("the viewer's upper back zone")
    if not hist_done:
        stale.append("the viewer's history wiring")
    if not pouch_done:
        stale.append("the pouch data-*")
    if stale:
        print("STALE ANCHORS: " + ", ".join(stale))
        raise SystemExit(1)
    report("done" if viewer_done and hist_done and pouch_done else "part")
    raise SystemExit(0)

# ----------------------------------------------------------------- viewer write
if not viewer_done:
    if js.count(VIEWER_OLD) != 1:
        raise SystemExit(f"refusing to write viewer - matched {js.count(VIEWER_OLD)} times, expected 1 "
                         "(patches 7-39 must be applied first)")
    before = js
    js = js.replace(VIEWER_OLD, VIEWER_NEW)
    assert js.replace(VIEWER_NEW, VIEWER_OLD) == before, "viewer replacement not span-exact"
    assert js.count(VIEWER_NEW) == 1
    print("ok    viewer: upper area is a back zone (height k.tt, onClick:te, data-cwtop=back)")
else:
    print("skip  viewer upper back zone already there")

# ----------------------------------------------------------------- history write
if not hist_done:
    # viewer wiring must be exactly the three edits in step
    if js.count(HIST_OLD_OP) != 1:
        raise SystemExit(f"refusing to write history op/shut head - matched {js.count(HIST_OLD_OP)}")
    if js.count(HIST_OLD_TAIL) != 1:
        raise SystemExit(f"refusing to write history tail - matched {js.count(HIST_OLD_TAIL)}")
    if js.count(HIST_OLD_DEPS) != 1:
        raise SystemExit(f"refusing to write history deps - matched {js.count(HIST_OLD_DEPS)}")
    js = js.replace(HIST_OLD_OP, HIST_NEW_OP, 1)
    js = js.replace(HIST_OLD_TAIL, HIST_NEW_TAIL, 1)
    js = js.replace(HIST_OLD_DEPS, HIST_NEW_DEPS, 1)
    print("ok    history: the viewer pushes a sentinel and Back closes it (shut order: ...C then o)")
else:
    print("skip  viewer history wiring already there")

# ----------------------------------------------------------------- jsdom pouch data (linear-gradient var discarded by jsdom, so expose via data-*)
POUCH_OLD = "{className:`absolute left-0 w-full overflow-hidden`,style:{top:0,height:t.pouchH,borderRadius:t.pouchRadius,background:n===`slate`?__cwSlateTray(r,k):v.tray,border:v.trayBorder,boxShadow:v.trayShadow,transition:`background .16s linear,border-radius .16s ease-out`},children:(0,U.jsx)(`div`,{className:`absolute inset-0`,style:{background:v.traySheen}})}"
POUCH_NEW = "{className:`absolute left-0 w-full overflow-hidden`,style:{top:0,height:t.pouchH,borderRadius:t.pouchRadius,background:n===`slate`?__cwSlateTray(r,k):v.tray,border:v.trayBorder,boxShadow:v.trayShadow,transition:`background .16s linear,border-radius .16s ease-out`},\"data-tray\":n===`slate`?__cwSlateTray(r,k):v.tray,\"data-tray-border\":v.trayBorder,children:(0,U.jsx)(`div`,{className:`absolute inset-0`,style:{background:v.traySheen},\"data-sheen\":v.traySheen})}"
pouch_done = "data-tray" in js and "data-sheen" in js
if not pouch_done:
    if js.count(POUCH_OLD) != 1:
        raise SystemExit(f"refusing to write pouch data - matched {js.count(POUCH_OLD)} times, expected 1")
    js = js.replace(POUCH_OLD, POUCH_NEW)
    print("ok    pouch: expose tray/sheen via data-* for jsdom harness (no visual change)")
else:
    print("skip  pouch data-* already there")

# ---------------------------------------------------------------------- guards


# (1) the viewer still declares the inert-bands shield, and the new zone is exactly the highlighted area
assert "/*cardwallet:inert-bands*/" in js and '"data-cwband":`preview`' in js, "round 23 shield lost"
assert TOP_MARKER in js and TOP_ATTR in js, "top back marker/attr missing"
assert js.count(TOP_MARKER) == 1 and js.count(TOP_ATTR) == 1, "top zone must appear exactly once"
# the zone sits between backdrop and card (backdrop, top, card)
assert js.index(TOP_MARKER) > js.index("/*cardwallet:inert-bands*/"), "top zone not after backdrop"
assert js.index(TOP_MARKER) < js.index("className:`no-select absolute touch-none`"), "top zone not before card"
# height is exactly the card's top offset - the highlighted region, no hardcoded px
assert "style:{height:k.tt}" in js, "top zone height must be k.tt (the card's top)"
assert "absolute inset-x-0 top-0" in js, "top zone must be full-width top-anchored"
# close routine is the viewer's own (same as swipe-down), not a new animation
assert "onClick:te" in js, "top zone must close via the viewer's te() (same as swipe-down)"
assert js.count("onClick:te") == 1, "only the top zone should carry onClick:te (root must stay without it)"
# the card and its gestures are untouched
assert js.count("className:`no-select absolute touch-none`") == 1
assert "onPointerDown:re,onPointerMove:M,onPointerUp:N,onPointerCancel:N" in js
assert "if(n>90){te();return}" in js
assert "te=()=>{A(),t()}" in js
# bottom buttons stay the only controls in that row
assert js.count("pointer-events-auto flex items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-white") == 2
assert "pointer-events-none absolute inset-x-0 flex justify-center gap-2.5 px-5" in js
# the exit animation contract is unchanged (reverse to origin)
assert "exit:s?{x:0,y:-160,scale:.92,opacity:0" in js or "exit:s?{x:0,y:-160" in js

# (2) history: op includes o, shut closes o last, deps include o
assert "let op=()=>!!(o||f||v||T||m||c||D||k||b||C)" in js, "op must include o"
assert "if(o){s(null);return}" in js, "shut must close o"
assert "},[o,f,v,T,m,c,D,k,b,C]);" in js, "effect deps must include o"
# shut order: viewer behind every sheet, so o after C
assert js.index("if(o){s(null);return}") > js.index("if(C){"), "viewer must close after every sheet (behind them)"
# the sentinel still pushes exactly once
assert js.count("history.pushState({cardwallet:`sheet`}") == 1
assert js.count("history.back()") == 1

# (3) earlier rounds survive
for marker in ("/*cardwallet:header*/", "/*cardwallet:no-wordmark*/", "/*cardwallet:inert-bands*/", "/*cardwallet:top-back*/"):
    assert marker in js, f"marker lost: {marker}"
assert "boxShadow:`var(--menu-shadow)`" in js and "#0b0b0d" not in js, "round 22 regressed"
assert ".touch-none{touch-action:none}" in css, "touch-none utility must ship"
assert "data-tray" in js and "data-sheen" in js, "pouch data-* missing"

if js != JS_PATH.read_text(encoding="utf-8"):
    JS_PATH.write_text(js, encoding="utf-8")
    print("app/index.js written - upper area is a back zone")
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
