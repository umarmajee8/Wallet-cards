#!/usr/bin/env python3
"""Pouch screen: only the pouches respond, the cover stops blurring, labels read in
every theme.

Device feedback (two screenshots): the user framed the *empty black bands* above and
below the pouch row and said "yeh jaga kam na kray - is pr touch swipe kuch b kam na
kray": nothing should happen when a touch starts there. Together with two smaller asks:

  * "wo blur ki waja sy kar raha ha - is ka kaam kro" -> the frosted cover of the
    Stack view is the only real blur in the app's pouch screen (the carousel draws its
    leather sleeve on a canvas, so there is no blur in the carousel at all; that is
    worth saying out loud, because it means blur was never what left a card sideways).
    Chosen: drop the blur completely - a flat translucent panel, no `backdrop-filter`
    cost at rest either.
  * "jab white mode hota ha to card k names white shade mein aate hain, unhe black
    bold kar do" -> the title under each pouch was `color: cover ? white : var(--ink)`,
    i.e. white whenever the cover is on, regardless of light/dark. In light mode that
    is white-on-white. It now always follows the theme token, and is bolder.

What makes the bands "work" at all. The carousel's drag layer is
`div.absolute.inset-0.cursor-grab` inside a stage box (`height: stageH*scale + 36`),
so:

  * the pouch artwork itself is *smaller* than that box on many phones (the box also
    has to hold the tilt/`z` travel and the label), so the strip inside the stage but
    outside any card was a live drag target - the `cursor:grab` hand proved it;
  * the `<main>` around it had no `touch-action`, so a swipe starting in the black
    area could also be taken by the browser (scroll/overscroll) instead of doing
    nothing.

Fix, in that order:

  1. the drag layer stops being a hit target (`pointerEvents:'none'`) and each card
     wrapper becomes the hit target again (`pointerEvents:'auto'`), with the grab
     cursor moved onto the card - so the only place a pouch drag can start is on a
     pouch;
  2. `onPointerDown` additionally ignores anything that did not start inside a card
     (`e.target.closest('[data-cwc]')`), which makes the rule true even if a future
     WebView ignores the CSS, and makes it testable in jsdom (no hit-testing there);
  3. `<main>` gets `touch-action:none` + `overscroll-behavior:none`, so the empty
     bands cannot scroll or rubber-band the page either.

Nothing about the row's motion, spacing, safe-area or the sleeves' look changes.
This sits on top of patch 14 (which still recovers a row that somehow rests
off-centre - now it should never get there from the dead area in the first place).

Run:  python3 repo_export/patches/patch15_pouch_inert_blur_labels.py [--check]
Depends on patch 13 (it re-words the flap's backdrop-filter) and patch 14.
"""
from pathlib import Path
import sys

APP = Path(__file__).resolve().parents[1] / "app"
path = APP / "index.js"
css_path = APP / "index.css"
CHECK = "--check" in sys.argv

# --- the carousel drag layer: stop being a hit target, and require the gesture to
# --- start on a pouch. One edit because both halves are the same span.
LAYER_OLD = (
    "className:`absolute inset-0 cursor-grab active:cursor-grabbing`,"
    "style:{touchAction:`none`,transformStyle:`preserve-3d`},"
    "onPointerDown:e=>{if(f<=1||s||!e.isPrimary)return;"
)
LAYER_NEW = (
    "className:`absolute inset-0 active:cursor-grabbing`,"
    "style:{touchAction:`none`,transformStyle:`preserve-3d`,pointerEvents:`none`},"
    "onPointerDown:e=>{"
    "if(f<=1||s||!e.isPrimary)return;"
    "if(!e.target||!e.target.closest||!e.target.closest(`[data-cwc]`))return;"
)

# --- the card wrapper is the hit target, and carries the marker the guard looks for
CARD_OLD = "(0,U.jsxs)(X.div,{className:`absolute top-0`,style:{x:h,z:z,"
CARD_NEW = '(0,U.jsxs)(X.div,{"data-cwc":1,className:`absolute top-0`,style:{x:h,z:z,'

CARD_STYLE_OLD = "transformStyle:`preserve-3d`,willChange:`transform`},children:[(0,U.jsx)(X.div,{initial:s?"
CARD_STYLE_NEW = (
    "transformStyle:`preserve-3d`,willChange:`transform`,pointerEvents:`auto`,cursor:`grab`},"
    "children:[(0,U.jsx)(X.div,{initial:s?"
)

# --- the pouch screen container: the empty bands must not gesture anything
MAIN_OLD = "style:{paddingTop:`calc(env(safe-area-inset-top) + 58px)`,paddingBottom:P>0?58:void 0}"
MAIN_NEW = (
    "style:{paddingTop:`calc(env(safe-area-inset-top) + 58px)`,paddingBottom:P>0?58:void 0,"
    "touchAction:`none`,overscrollBehavior:`none`}"
)

# --- the stack cover: no backdrop blur at all, and a touch more body so dropping the
# --- blur does not leave the card underneath readable through the flap
FLAP_OLD = (
    "backdropFilter:s?`none`:`blur(22px) saturate(1.6)`,"
    "WebkitBackdropFilter:s?`none`:`blur(22px) saturate(1.6)`"
)
FLAP_NEW = "backdropFilter:`none`,WebkitBackdropFilter:`none`"

FLAP_BG_OLD = (
    "background:`linear-gradient(180deg, rgba(255,255,255,0.28) 0%, "
    "rgba(255,255,255,0.08) 48%, rgba(20,20,24,0.22) 100%)`"
)
FLAP_BG_NEW = (
    "background:`linear-gradient(180deg, rgba(255,255,255,0.24) 0%, "
    "rgba(255,255,255,0.07) 48%, rgba(20,20,24,0.30) 100%) rgba(28,28,34,0.72)`"
)

# --- the two card titles (carousel label / stack cover label): theme-driven, bolder
LABEL_CAROUSEL_OLD = (
    "style:{marginTop:8,textAlign:`center`,color:cv?`rgba(255,255,255,0.94)`:`var(--ink)`,"
    "fontSize:13,fontWeight:650,letterSpacing:`.01em`,whiteSpace:`nowrap`,overflow:`hidden`,"
    "textOverflow:`ellipsis`,textShadow:cv?`0 1px 8px rgba(0,0,0,.65)`:`none`,padding:`0 8px`}"
)
LABEL_CAROUSEL_NEW = (
    "style:{marginTop:8,textAlign:`center`,color:`var(--ink)`,"
    "fontSize:13,fontWeight:800,letterSpacing:`.01em`,whiteSpace:`nowrap`,overflow:`hidden`,"
    "textOverflow:`ellipsis`,textShadow:`var(--pouch-label-shadow)`,padding:`0 8px`}"
)
LABEL_STACK_OLD = (
    "marginTop:10,textAlign:`center`,color:cv?`rgba(255,255,255,0.94)`:`var(--ink)`,"
    "fontSize:13,fontWeight:650,letterSpacing:`.01em`,whiteSpace:`nowrap`,overflow:`hidden`,"
    "textOverflow:`ellipsis`,textShadow:cv?`0 1px 8px rgba(0,0,0,.65)`:`none`,padding:`0 6px`}"
)
LABEL_STACK_NEW = (
    "marginTop:10,textAlign:`center`,color:`var(--ink)`,"
    "fontSize:13,fontWeight:800,letterSpacing:`.01em`,whiteSpace:`nowrap`,overflow:`hidden`,"
    "textOverflow:`ellipsis`,textShadow:`var(--pouch-label-shadow)`,padding:`0 6px`}"
)

EDITS = [
    (LAYER_OLD, LAYER_NEW, "carousel: drag layer is not a hit target + gesture must start on a pouch"),
    (CARD_OLD, CARD_NEW, "carousel: pouch wrapper carries data-cwc"),
    (CARD_STYLE_OLD, CARD_STYLE_NEW, "carousel: pouch wrapper is the hit target (grab cursor)"),
    (MAIN_OLD, MAIN_NEW, "pouch screen: <main> cannot scroll or rubber-band"),
    (FLAP_OLD, FLAP_NEW, "stack: cover drops backdrop blur entirely"),
    (FLAP_BG_OLD, FLAP_BG_NEW, "stack: cover keeps enough body without the blur"),
    (LABEL_CAROUSEL_OLD, LABEL_CAROUSEL_NEW, "carousel: pouch label follows the theme, bolder"),
    (LABEL_STACK_OLD, LABEL_STACK_NEW, "stack: card label follows the theme, bolder"),
]

# the title shadow is now a token: no smudge behind black text on a light page, the
# old dark halo kept where it earns its place
CSS_OLD = ".solid-btn{background:var(--solid);color:var(--on-solid)}"
CSS_NEW = ".solid-btn{background:var(--solid);color:var(--on-solid)}" + (
    ":root{--pouch-label-shadow:none}html.dark{--pouch-label-shadow:0 1px 8px rgba(0,0,0,.65)}"
)

# A patch that re-words a span a *later* patch also re-words needs the downstream
# marker, so `--check` on the fully patched bundle stays quiet.
DOWNSTREAM_KEEP = {
    "stack: cover drops backdrop blur entirely": "backdropFilter:`none`",
}
# Patch 17 replaces the whole cover background (the wallet colour, not a tinted glass
# panel), so this edit's own text is deliberately gone - marker on the successor.
SUPERSEDED = {
    "stack: cover keeps enough body without the blur": "td(col,1.18)",
}


def status(data, edits):
    todo, done, bad = [], [], []
    for old, new, label in edits:
        keep = DOWNSTREAM_KEEP.get(label)
        sup = SUPERSEDED.get(label)
        if sup and sup in data:
            done.append(label)
            continue
        if old in new and data.count(new) >= 1:
            done.append(label)
        elif data.count(old) == 1:
            todo.append((old, new, label))
        elif data.count(new) >= 1 or (keep and keep in data):
            done.append(label)
        else:
            bad.append(label)
    return todo, done, bad


data = path.read_text(encoding="utf-8")
css = css_path.read_text(encoding="utf-8")
todo, done, bad = status(data, EDITS)
ctodo, cdone, cbad = status(css, [(CSS_OLD, CSS_NEW, "css: --pouch-label-shadow token")])
bad += cbad

if CHECK:
    if bad:
        print("STALE ANCHORS: " + ", ".join(bad))
        print("  (the flap span belongs to patch 13's output and the guard to patch 14's;"
              " run patch 12 -> 13 -> 14 first)")
        raise SystemExit(1)
    print(f"clean (all {len(EDITS) + 1} anchors present)" if not (done or cdone)
          else f"applied ({len(done) + len(cdone)}/{len(EDITS) + 1} edits in place)")
    raise SystemExit(0)

if bad:
    raise SystemExit(
        "refusing to write - anchors not found and no applied-output either: " + ", ".join(bad)
        + "\n  (run patch 12 -> 13 -> 14 before this one)"
    )

if not todo and not ctodo:
    print(f"skip: all {len(EDITS) + 1} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    data = data.replace(old, new)
    print(f"ok    {label}")
for old, new, label in ctodo:
    css = css.replace(old, new)
    print(f"ok    {label}")

# Guards: each half of the ask has to be visible in the output, or the edit silently
# no-op'd (patch 13 learned this the hard way).
car = data.split("function Td({cards:")[1].split("var Ed=")[0]   # NB: not "function Td("
# - React has its own `function Td(e,t,n)` much earlier in the bundle
assert "pointerEvents:`none`" in car, "drag layer is still a hit target"
assert "closest(`[data-cwc]`)" in car, "pointerdown lost its pouch-only guard"
dd = data.split("var Ed=(0,x.memo)(Td)")[1].split("Od={type:`spring`")[0]
assert '"data-cwc":1' in dd, "pouch wrapper lost its marker"
assert "pointerEvents:`auto`,cursor:`grab`" in dd, "pouch wrapper is not a hit target"
assert "backdropFilter:`none`,WebkitBackdropFilter:`none`" in data, "cover still blurs"
assert "rgba(28,28,34,0.72)`" in data, "cover lost its body"
assert data.count("color:`var(--ink)`,fontSize:13,fontWeight:800") == 2, "labels not both retokened"
assert "color:cv?`rgba(255,255,255,0.94)`" not in data, "a white-in-light-mode label is still there"
assert "--pouch-label-shadow" in css, "css token missing"

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
css_path.write_text(css, encoding="utf-8")
print("app/index.js + index.css written - pouches are the only touch target, "
      "no blur, labels readable in both themes")
