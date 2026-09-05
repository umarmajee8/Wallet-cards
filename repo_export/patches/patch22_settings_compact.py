#!/usr/bin/env python3
"""Patch 22 - the sheet again: one control per row, Layout that follows the view, smooth sliders.

Round 11 feedback, the settings half of it: *"bhot zada setting meh button ho gya han, meh ny
kaha tha kam sy kam hon"*, *"layout meh stack ki alag setting ho or carousel ki alag"*, and the
stack preview not showing at all.

The sheet is written readable in ``patch22_settings.src.js`` and this script minifies it the same
way patch 19 does (comment lines and indentation dropped, the rest joined; line breaks may only
sit after ``,`` ``(`` ``[`` ``{`` or an operator).

What changed in the sheet:

* **10 chip buttons instead of 22.** The `Cards` preview-filter row is gone (it was never asked
  for), and the Material and Border chip rows became the `Sheen` and `Edge` sliders - same two
  fields patch 20 already paints from, so nothing was lost and both still reach the wallet.
  What is left is four chip rows: Slate|Classic, Carousel|Stack, Flat|Fan|Deck (Stack only) and
  System|Light|Dark.
* **Layout follows the view.** `Carousel|Stack` selects the wallet, then a sub-label names whose
  settings are being shown: `Wallet & cover` and `Size` for both, `Spacing` for the carousel,
  `Spread` + `Fan` for the stack. The preview mounts the matching component, so the panel and the
  wallet always show the same thing.
* **The stack renders in the preview.** `__cwStack` takes the stage box (``fit:{w:388,h:302}``,
  from patch 21) instead of measuring the viewport, which is why it was invisible in a 176px box.
* **Sliders stay smooth under a drag.** Writes are coalesced to one commit per frame
  (`requestAnimationFrame`, `setTimeout` fallback), and the pending object is kept locally so the
  thumb and its percentage never snap back to the last committed value between frames.
  Every pouch slider is step .01 with a filled track (`--p`) and a 20px thumb from patch 21.
* The header's `Done` pill is a size smaller too, since the sheet's own chrome was already dense.

Run:  python3 repo_export/patches/patch22_settings_compact.py [--check]
"""
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app" / "index.js"
SRC = HERE / "patch22_settings.src.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

HEAD = "function Np({open:e,settings:t"
TAIL = "var Pp=250"


def minify(src: str) -> str:
    """Comment lines and indentation out, everything else joined as-is."""
    out = []
    for line in src.split("\n"):
        st = line.strip()
        if not st or st.startswith("//"):
            continue
        out.append(line.lstrip())
    return "".join(out)


def balanced(code: str) -> tuple[bool, str]:
    """Bracket balance, ignoring anything inside strings/templates."""
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
        if code.startswith("//", i):
            while i < n and code[i] != "\n":
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
    raise SystemExit(f"patch22_settings.src.js does not balance: {why}")
if not (NEW.startswith("function Np(") and NEW.endswith("}")):
    raise SystemExit("the settings source must be one complete function")

EDITS = [("SPAN", NEW, "settings sheet: Layout per view, sliders only, stack preview fitted")]


def status(data):
    todo, done, bad = [], [], []
    for old, new, label in EDITS:
        i, j = data.find(HEAD), data.find(TAIL)
        if new in data:
            done.append(label)
        elif i > 0 and j > i:
            todo.append((data[i:j], new, label))   # the span stops before TAIL, so do not re-add it
        else:
            bad.append(label)
    return todo, done, bad


todo, done, bad = status(data)

if CHECK:
    if bad:
        print("STALE ANCHORS: " + ", ".join(bad))
        print("  (the sheet body is patch 19's, the chrome is patch 18's - run 7 -> 21 first)")
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
    if data.count(old) != 1:
        raise SystemExit(f"anchor for {label} matched {data.count(old)} times")
    data = data.replace(old, new)
    print(f"ok    {label}")

# --- guards -----------------------------------------------------------------------------------
setts = data[data.find(HEAD):data.find(TAIL)]
for keep in ("cw-glass-sheet", "cw-scrim", "cw-title"):
    assert keep in setts, f"patch 18's chrome lost ({keep})"
for word in ("Custom Pouch", "Design", "Layout", "Appearance", "Grading", "Wallet & cover",
             "Sheen", "Edge", "Fan", "Spread", "Spacing"):
    assert word in setts, f"label {word!r} missing from the sheet"
for gone in ("`Cards`", "`Matte`", "`Satin`", "`Gloss`", "`Hairline`", "`Firm`", "`Preset`"):
    assert gone not in setts, f"chip row came back: {gone}"
assert "isStack?__cwStack:Ed" in setts, "the preview is not switching to the selected view"
assert "fit:isStack?{w:388,h:302}" in setts, "the stack preview has no stage box"
assert "scale(.56)" in setts, "the stack stage is not scaled into the glass box"
assert "isStack?Row(`Fan`" in setts and "isStack?Rng(`Spread`" in setts, "Layout is not view-specific"
n_rng = setts.count("Rng(")
assert n_rng == 10 and setts.count("type:`range`") == 1, f"expected 9 slider rows off one helper, found {n_rng - 1}"
assert setts.count("className:`cw-chip`") == 2, "chip rows must be built by the two helpers only"
assert '"--p":' in setts, "the filled track has no progress variable"   # a key, so quoted, never a template literal
assert "rf(()=>{fr.current=0" in setts, "slider writes are not coalesced to a frame"
# a dragged slider has to hold its own value in sheet state, or React snaps the thumb back
assert "setDrag({k,v})" in setts and "drag&&drag.k===k" in setts, "the drag value is not held locally"
assert "px-3.5 py-1 text-[13.5px]" in setts, "the Done pill is not the smaller one"
css = (HERE.parent / "app" / "index.css").read_text(encoding="utf-8")
assert "pointer-events:none" in css, "the preview box is not click-through"
assert ".cw-range::-webkit-slider-runnable-track" in css, "patch 21's slider kit is not in the css"

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
print("app/index.js written - compact sheet, view-specific Layout, stack preview")
