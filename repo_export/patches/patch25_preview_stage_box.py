#!/usr/bin/env python3
"""Patch 25 - the stack preview was still an empty box. Make the stage actually take space.

Round 13 feedback is a screenshot of the sheet with the preview area circled and empty: *"preview
meh stack show nhi ho rha ha, stack preview meh show hona chahiye."*

Round 11's fix (`fit:{w:388,h:302}` in, `scale(.56)` out) made `__cwStack` **size its cards** from
the box - that part was right - but the component's own stage kept `flex:1`, which only means
something inside a flex column. In the sheet it sits inside `.cw-preview-in`, an absolutely
positioned box, so `flex:1` resolved to nothing, the stage was 0px tall, and its own
`overflow:hidden` clipped every card away. Width was fine, which is exactly why the jsdom check
from round 11 passed: it asserted a card *width* on stage and never once looked at the height it was
being clipped by. This patch gives the stage the box's dimensions whenever a `fit` box is supplied:

    style:{flex:ft?`none`:1, …, width:ft?ft.w:void 0, height:ft?ft.h:void 0, …}

so the wallet (no `fit`) keeps `flex:1` and no width/height at all - byte-identical DOM - while the
preview's stage becomes 388x302 and its cards land inside it.

The second fix is in the sheet: the stand-in cards' artwork URL was
`data:image/svg+xml,` + encodeURIComponent(prefix) + hex + suffix - a raw ``#`` in a URL starts the
fragment, so the SVG was truncated and the image never loaded. The colour is now an ``rgb()`` triple
inside one fully-encoded string, and the stand-ins carry no title (three copies of the wallet's first
title looked broken).

Run:  python3 repo_export/patches/patch25_preview_stage_box.py [--check]
"""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app" / "index.js"
SRC = HERE / "patch25_settings.src.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

HEAD = "function Np({open:e,settings:t"
TAIL = "var Pp=250"

STAGE_OLD = ("className:`relative w-full`,style:{flex:1,minHeight:0,overflow:`hidden`,"
             "touchAction:`none`,perspective:1200,perspectiveOrigin:`50% 50%`}");
STAGE_NEW = ("className:`relative w-full`,style:{flex:ft?`none`:1,minHeight:0,"
             "width:ft?ft.w:void 0,height:ft?ft.h:void 0,overflow:`hidden`,"
             "touchAction:`none`,perspective:1200,perspectiveOrigin:`50% 50%`}");


def minify(src: str) -> str:
    out = []
    for line in src.split("\n"):
        st = line.strip()
        if not st or st.startswith("//"):
            continue
        out.append(line.lstrip())
    return "".join(out)


def balanced(code: str) -> tuple[bool, str]:
    stack, i, n = [], 0, len(code)
    pairs = {")": "(", "]": "[", "}": "{"}
    while i < n:
        c = code[i]
        if c in "`\"'":
            q, i = c, i + 1
            while i < n:
                if code[i] == "\\":
                    i += 2
                    continue
                if code[i] == q:
                    break
                i += 1
            i += 1
            continue
        if c in "([{":
            stack.append((c, i))
        elif c in ")]}":
            if not stack or stack[-1][0] != pairs[c]:
                return False, f"stray {c!r} at {i}: {code[max(0, i-60):i+20]}"
            stack.pop()
        i += 1
    if stack:
        c, i = stack[-1]
        return False, f"unclosed {c!r} opened at {i}: {code[i:i+80]}"
    return True, "balanced"


NEW = minify(SRC.read_text(encoding="utf-8"))
ok, why = balanced(NEW)
if not ok:
    raise SystemExit(f"patch25_settings.src.js does not balance: {why}")
if not (NEW.startswith("function Np(") and NEW.endswith("}")):
    raise SystemExit("the settings source must be one complete function")
assert '"--p":' in NEW and '"data-on":' in NEW, "an object key lost its quotes"

EDITS = [
    ("SPAN", NEW, "settings sheet: stand-in artwork that actually loads, unlabelled"),
    (STAGE_OLD, STAGE_NEW, "the stack stage takes the fit box's own width and height"),
]


def status(data):
    todo, done, bad = [], [], []
    for old, new, label in EDITS:
        i, j = data.find(HEAD), data.find(TAIL)
        if new in data:
            done.append(label)
        elif label.startswith("settings sheet"):
            if i > 0 and j > i and data.count(HEAD) == 1:
                todo.append((data[i:j], new, label))   # re-splice: this patch owns the sheet
            else:
                bad.append(label)
        elif old == new:
            bad.append(label)
        elif data.count(old) == 1:
            todo.append((old, new, label))
        elif data.count(old) == 0:
            bad.append(label)
        else:
            bad.append(label)
    return todo, done, bad


todo, done, bad = status(data)

if CHECK:
    if bad:
        print("STALE ANCHORS: " + ", ".join(bad))
        print("  (patch 24 owns the sheet span, patch 12/13 the stack stage; run 7 -> 24 first)")
        raise SystemExit(1)
    print("clean (nothing applied yet)" if len(todo) == len(EDITS)
          else f"applied ({len(done)}/{len(EDITS)} edits in place, {len(todo)} pending)")
    raise SystemExit(0)

if bad:
    raise SystemExit("refusing to write - stale anchors: " + ", ".join(bad))
if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    if old == new:
        raise SystemExit(f"{label}: anchor and replacement are identical - a truncated literal?")
    if data.count(old) != 1:
        raise SystemExit(f"anchor for {label} matched {data.count(old)} times")
    data = data.replace(old, new)
    if old not in new and old in data:
        raise SystemExit(f"{label}: the old shape is still in the bundle")
    print(f"ok    {label}")

# --- guards -----------------------------------------------------------------------------------
assert data.count("width:ft?ft.w:void 0,height:ft?ft.h:void 0") == 1, "the stage box is not sized from fit"
assert data.count("style:{flex:ft?`none`:1,minHeight:0") == 1, "flex is not conditional on the fit box"
assert "className:`relative w-full`,style:{flex:1,minHeight:0" not in data, "a stage still has no height"

setts = data[data.find(HEAD):data.find(TAIL)]
assert "src:`data:image/svg+xml;charset=utf-8,`+encodeURIComponent(" in setts, "the stand-in url is not fully encoded"
assert "pal=[`rgb(44,61,86)`" in setts, "the stand-ins still take colours from a hex palette"
assert "tt=l[0]&&l[0].title" not in setts, "the stand-ins are still labelled with a real title"

for keep in ("cw-glass-sheet", "cw-scrim", "cw-title", "fit:isStack?{w:388,h:302}", "scale(.56)",
             "want=isStack?6:3", "from+=d*.42", "RAMP=[`stack.overlap`",
             "Rng(`Sheen`,`material`,.4,1.8,.01", "isStack?__cwStack:Ed"):
    assert keep in setts, f"earlier work lost in the rewrite ({keep})"
for nm in ("now", "soon", "set", "num", "pc", "tick", "warp", "sub", "isP", "rf", "cf"):
    assert f"{nm}=" in setts or f"function {nm}(" in setts, f"the sheet calls {nm}() but never defines it"
css = (HERE.parent / "app" / "index.css").read_text(encoding="utf-8")
assert ".cw-preview-in{position:absolute;left:50%;top:6px" in css, "the preview box moved - check its scale"

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
        raise SystemExit("bundle does not parse:\n" + node.stderr[-1500:])
    print("ok    node --check on the generated bundle")

JS.write_text(data, encoding="utf-8")
print("app/index.js written - the stack preview finally has a box to fill")
