#!/usr/bin/env python3
"""Patch 24 - the sheet as a two-mode dashboard: independent Stack / Carousel groups, a preview
that always stages real cards, sliders that glide, and a smaller create button.

Round 12 feedback: *"Overall goal: settings itni complicated na hon ke configuration dashboard jaisi
lage - kam buttons, kam text, compact controls ... Stack ki settings Carousel par apply nahi honi
chahiye aur Carousel ki settings Stack par apply nahi honi chahiye ... preview static image na ho,
minimum 3 actual cards render karo ... sliders fluid hon, smooth interpolation ... create button ko
thora chota karo."*

Written readable in ``patch24_settings.src.js`` and minified the way patches 19 and 22 do (comment
lines and indentation dropped, the rest joined).

What this changes:

* **Layout is two modes, not one shared column.** The stack group is `Card overlap`, `Vertical
  offset`, `Scale`, `Rotation`, `Visible cards`, `Spacing`; the carousel group is `Card spacing`,
  `Scale`, `Side cards`, `Peek amount`, `Position`. Each writes inside its own object
  (``custom.stack.*`` / ``custom.carousel.*``) via dotted paths, so the *same helper* cannot leak a
  value into the other view, and the wallet only ever sees one namespace at a time (patch 23's
  ``__cwMrg``). The `Flat|Fan|Deck` chip row is deleted: `Rotation` and `Card overlap` cover what it
  used to preset, so Layout is now two buttons and a switch instead of five chips.
* **The preview never runs dry and never fakes it.** It stages the wallet's real cards - padded
  with stand-ins built by the same card components (with the per-card pouch colour the wallet
  honours) up to three in the carousel and six in the stack, which is what makes `Visible cards`
  and `Vertical offset` legible while you drag. The App now hands the sheet eight cards, not four.
* **Sliders glide.** Geometry writes are ramped: each frame covers 42% of the distance to the
  finger and stops exactly on the target, so nothing steps; the row's own value is held in sheet
  state during the drag so the thumb and its read-out stay under the finger, and non-geometry
  fields still commit once per frame as before.
* **The create button shrinks again**: 40px disc -> 36px, glyphs 21/24 -> 19/21.

Run:  python3 repo_export/patches/patch24_view_scoped_sheet.py [--check]
"""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app" / "index.js"
SRC = HERE / "patch24_settings.src.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

HEAD = "function Np({open:e,settings:t"
TAIL = "var Pp=250"

BTN_OLD = "className:`flex h-10 items-center justify-center rounded-full active:opacity-70 ${a?``:`w-10`}`"
BTN_NEW = "className:`flex h-9 items-center justify-center rounded-full active:opacity-70 ${a?``:`w-9`}`"
ICO_OLD = "(0,U.jsx)(h,{size:cp?21:24,children:r}),"
ICO_NEW = "(0,U.jsx)(h,{size:cp?19:21,children:r}),"
CARD_OLD = "(0,U.jsx)(Np,{cards:e.slice(0,4),open:D,settings:j,"
CARD_NEW = "(0,U.jsx)(Np,{cards:e.slice(0,8),open:D,settings:j,"


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
    raise SystemExit(f"patch24_settings.src.js does not balance: {why}")
if not (NEW.startswith("function Np(") and NEW.endswith("}")):
    raise SystemExit("the settings source must be one complete function")
# the joiner forbids a template literal in an object-key position, so those keys must be quoted
assert '"--p":' in NEW and '"data-on":' in NEW, "an object key lost its quotes"

EDITS = [
    ("SPAN", NEW, "settings sheet: two independent Layout modes, ramped sliders, staged preview"),
    (BTN_OLD, BTN_NEW, "create button 40px -> 36px"),
    (ICO_OLD, ICO_NEW, "header glyphs 21/24 -> 19/21"),
    (CARD_OLD, CARD_NEW, "the sheet may stage up to eight real cards"),
]


def status(data):
    todo, done, bad = [], [], []
    for old, new, label in EDITS:
        i, j = data.find(HEAD), data.find(TAIL)
        if new in data:
            done.append(label)
        elif label.startswith("settings sheet") and i > 0 and j > i and data.count(HEAD) == 1:
            todo.append((data[i:j], new, label))   # re-splice: the sheet is owned by this patch
        elif label.startswith("settings sheet"):
            # the sheet is a span: whatever patch wrote it last owns it
            if i > 0 and j > i:
                todo.append((data[i:j], new, label))
            else:
                bad.append(label)
        elif data.count(old) == 1:
            todo.append((old, new, label))
        elif data.count(old) == 0:
            bad.append(label)                          # neither the input nor the output: drift
        else:
            bad.append(label)
    return todo, done, bad


todo, done, bad = status(data)

if CHECK:
    if bad:
        print("STALE ANCHORS: " + ", ".join(bad))
        print("  (patches 21-23 own these spans - run 7 -> 23 first)")
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
for keep in ("cw-glass-sheet", "cw-scrim", "cw-title", "fit:isStack?{w:388,h:302}", "scale(.56)"):
    assert keep in setts, f"earlier work lost in the rewrite ({keep})"
for word in ("Custom Pouch", "Design", "Layout", "Appearance", "Wallet & cover", "Sheen", "Edge",
             "Card overlap", "Vertical offset", "Visible cards", "Rotation", "Spacing", "Scale",
             "Card spacing", "Side cards", "Peek amount", "Position", "never reach"):
    assert word in setts, f"label {word!r} missing from the sheet"
for gone in ("`Fan`", "`Deck`", "`Matte`", "`Satin`", "`Gloss`", "`Cards`", "`Spread`", "label:`Flat`"):
    assert gone not in setts, f"chip row came back: {gone}"
for path in ("stack.overlap", "stack.vOff", "stack.size", "stack.rot", "stack.visible", "stack.spacing",
             "carousel.gap", "carousel.size", "carousel.side", "carousel.peek", "carousel.pos"):
    assert setts.count("`" + path + "`") >= 1, f"the {path} control is not wired to its namespace"
assert "onCustomise:r" in setts, "the orphan sheet hook must stay unused, not deleted"
assert setts.count("className:`cw-chip`") == 1, "chip rows must be built by one helper"
n_rng = setts.count("Rng(")              # 7 design + 6 stack + 5 carousel rows, all off one helper
assert n_rng == 18 and setts.count("type:`range`") == 1, f"expected 18 slider rows off one helper, found {n_rng}"
assert "cw-dots" in setts and setts.count("].map(dot)") == 1, "the colour dots row is not one row"
assert "isStack?__cwStack:Ed" in setts, "the preview is not switching to the selected view"
assert "custom:__cwMrg(t.custom,NS)" in setts, "the preview is not fed the view's own settings"
assert "__cwph" in setts, "the preview has no stand-in cards"
assert "want=isStack?6:3" in setts, "the preview does not stage enough cards for the view"
assert "rf(()=>{fr.current=0" in setts, "non-geometry writes are not coalesced to a frame"
assert "drg.current=p;setDrag({p,v})" in setts, "the drag value is not held locally"
assert "from+=d*.42" in setts and "tgt.current[p]=v" in setts, "the sliders are not ramped"
assert "px-3.5 py-1 text-[13.5px]" in setts, "the Done pill is not the compact one"
# every helper the sheet calls has to be bound in it - `now` went missing once and the whole panel
# threw on the first tap, which is a runtime error no bracket check can see
for nm in ("now", "soon", "set", "num", "pc", "tick", "warp", "sub", "isP", "rf", "cf"):
    ok = f"{nm}=" in setts or f"function {nm}(" in setts
    assert ok, f"the sheet calls {nm}() but never defines it"
assert "Rng(`Spread`" not in setts and "Chip(" not in setts, "the Fan row is still here"
assert data.count("flex h-9 items-center justify-center rounded-full") == 1, "create button not resized"
assert "size:cp?19:21" in data, "header glyphs not resized"
assert "cards:e.slice(0,8)" in data, "the sheet is not allowed eight cards"
css = (HERE.parent / "app" / "index.css").read_text(encoding="utf-8")
assert ".cw-range::-webkit-slider-runnable-track" in css, "patch 21's slider kit is not in the css"
assert "touch-action:none" in css, "the slider still steals the scroll"

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
print("app/index.js written - Stack and Carousel configured apart, preview staged, sliders ramped")
