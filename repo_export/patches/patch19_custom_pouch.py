#!/usr/bin/env python3
"""Custom Pouch: one compact glass settings panel that drives the *real* wallet.

Round 10 ask: *"UI aur settings experience ko premium minimalist Apple style mein enhance
karo … Settings screen ko completely blurred glass effect do … unnecessary explanatory text
remove … bulky buttons ki jagah compact controls … apna custom Pouch section jisme Design aur
Layout ke tamam options ek jagah hon … live card preview (actual UI component, static image
nahi) … har design aur layout change actual wallet UI par apply hona chahiye."*

This patch replaces the settings sheet (`Np`) wholesale with the version written in
`patch19_settings.src.js` - that file is the readable source, and this script minifies it by
deleting comment lines plus each line's leading indentation and joining (line breaks may
only sit after `,` `(` `[` `{` or an operator, which the source is written to respect).

What the new sheet is:

* One `Custom Pouch` glass card: live preview, `Design` (shape, colour dots, material,
  border, background/depth, radius, shadow, grading, grain, stitching, name), `Layout`
  (Carousel/Stack, Wallet & cover, size, spacing, stack style) and `Cards` (a chip per card
  that filters the preview - a view setting only, card data is never touched).
* **No explanatory paragraphs at all** - state is shown by the control (`data-on` +
  `.cw-chip`/`.cw-seg` styling from patch 18), and sliders carry their own percentage.
* **Headings are typography**: `.cw-title` for "Settings", `.cw-h` for the card headings and
  `.cw-sub` for the Design/Layout/Cards group labels - medium-bold ink, not uppercase grey.
* **The preview is the app itself**: it mounts `Ed` (the memoised carousel `Td`) or
  `__cwStack` - whichever `Layout` is selected - with the user's own first three cards and
  the settings being edited. So "Layout A -> preview shows Layout A" is literally true, and
  the sleeve is repainted by the same canvas painter the wallet uses. `pointer-events:none`
  on the glass box keeps it from stealing a scroll or a tap.

Supporting edits: the sheet now receives the wallet's cards (`cards:e` at the call site), and
`Xu` - the defaults object the settings loader merges every stored profile into - gains the
neutral identities for the new fields (`radius/shadow/material/depth/border/size/stack = 1`,
`gap = 20`, the number the layout already used), so an existing install reads them as "no
change" and the shipped look is byte-identical until a control is moved.

Patch 20 is what *applies* these fields; this one only writes them.

Run:  python3 repo_export/patches/patch19_custom_pouch.py [--check]
"""
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app" / "index.js"
SRC = HERE / "patch19_settings.src.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

HEAD = "function Np({open:e,settings:t"
TAIL = "var Pp=250"
CALL_OLD = "(0,U.jsx)(Np,{open:D,settings:j,onChange:"
CALL_NEW = "(0,U.jsx)(Np,{cards:e.slice(0,4),open:D,settings:j,onChange:"
XU_OLD = "Xu={color:`#5c6574`,grain:.2,stitch:!1,name:`Wallet`,grade:1,design:`slate`}"
XU_NEW = (XU_OLD[:-1] + ",radius:1,shadow:1,material:1,depth:1,border:1,size:1,gap:20,stack:1}")


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
    raise SystemExit(f"patch19_settings.src.js does not balance: {why}")
if not (NEW.startswith("function Np(") and NEW.endswith("}")):
    raise SystemExit("the settings source must be one complete function")

EDITS = [
    ("SPAN", NEW, "settings sheet: Custom Pouch with live preview"),
    (CALL_OLD, CALL_NEW, "settings: the sheet receives the wallet's cards for the preview"),
    (XU_OLD, XU_NEW, "defaults: the new pouch fields, all neutral"),
]


def status(data):
    todo, done, bad = [], [], []
    for old, new, label in EDITS:
        if old == "SPAN":
            i, j = data.find(HEAD), data.find(TAIL)
            if new in data:
                done.append(label)
            elif i > 0 and j > i:
                todo.append((data[i:j], new, label))  # the span stops before TAIL, so do not re-add it
            else:
                bad.append(label)
        elif data.count(old) == 1:
            todo.append((old, new, label))
        elif data.count(new) >= 1:
            done.append(label)
        else:
            bad.append(label)
    return todo, done, bad


todo, done, bad = status(data)

if CHECK:
    if bad:
        print("STALE ANCHORS: " + ", ".join(bad))
        print("  (the sheet's body is patch 18's glass chrome; run 7 -> 18 first)")
        raise SystemExit(1)
    print(f"clean (nothing applied yet)" if len(todo) == len(EDITS)
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

# --- guards: the sheet has to look like the new design in the shipped text ---------------
setts = data[data.find(HEAD):data.find(TAIL)]
assert "cw-glass-sheet" in setts and "cw-scrim" in setts and "cw-title" in setts, "patch 18 chrome lost"
for word in ("Custom Pouch", "Design", "Layout", "Cards", "Appearance", "Grading", "Wallet & cover"):
    assert word in setts, f"heading/label {word!r} missing from the sheet"
for gone in ("Folded Slate pouch", "Swipe pouches left and right", "Follows the phone",
             "Dashed seam around the pouch", "everything stays on this phone", "Pressed into the leather"):
    assert gone not in setts, f"explanatory text survived: {gone!r}"
assert "cw-preview" in setts and "?__cwStack:Ed" in setts, "the live preview is not mounting the wallet's own components"
assert setts.count("cw-row") < 3, "rows must be built by one Row() helper, not inlined"
assert "pointer-events:none" in (HERE.parent / "app" / "index.css").read_text(encoding="utf-8"), "the preview box is not click-through"
assert data.count(XU_NEW) == 1 and "gap:20" in data, "Xu defaults not extended"
assert data.count(CALL_NEW) == 1, "the sheet never got the cards"

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
        raise SystemExit("bundle does not parse:\n" + node.stderr[:1500])
    print("ok    node --check on the generated bundle")

JS.write_text(data, encoding="utf-8")
print("app/index.js written - Custom Pouch sheet with a live preview of the real wallet")
