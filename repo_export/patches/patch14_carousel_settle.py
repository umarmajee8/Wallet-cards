#!/usr/bin/env python3
"""Carousel: the pouch row must never rest off-centre when a swipe is stolen.

Reported from the device (screenshot): the pouch row sits shifted half a card to
one side - the front pouch is clipped by the left screen edge, its title truncated
(`...ar`, `0000 0000`) - and the user described it as the card "atak jata ha" when
dragged toward the rest of the screen, ending up "aik side pr".

Why that happens. The carousel's row is positioned by one shared spring `d`:
`Dd` renders each card at `n + d/slide`, so the row is centred **only when `d` is
back to 0**. `d` returns to 0 in exactly one place - `y()`, the settle completion:

    b=e=>{...g.current=Ju(d,-e*u.slide,{...Cd,onComplete:y})}   // glide, then commit
    y=()=>{g.current?.stop(),g.current=null;let e=_.current;_.current=0,e&&(h.current+=e,i(h.current)),d.jump(0)}

So the whole "is the row centred" question depends on an animation completing or an
event arriving. Three real-world ways it does not:

  1. **A stolen gesture.** Android takes the pointer stream away when the drag ends
     up looking like a system gesture - the bottom gesture strip / nav bar is exactly
     where a downward-flicking thumb leaves the app (that is the region marked in the
     screenshot). Our `end` handler never runs, so `b()` is never called: `d` keeps
     whatever fractional value the last `pointermove` left, and the row rests
     half-shifted. The `red circle` in the report is the symptom's location, not the
     cause - the cause is that nothing recovers.
  2. **Grabbing the row mid-glide.** `onPointerDown` did `g.current?.stop(),
     g.current=null` - killing the settle animation *without* running `y()`, so the
     pending index step in `_.current` is silently dropped. The row is then rescued
     only by the `near` catch-up below it, which `d.jump(0)`s - a visible snap - and
     the commit-vs-visual mismatch is what makes the row feel like it "sticks" and
     then jumps.
  3. Tiny residuals (|d| a pixel or two) are simply left as-is, so the row can rest
     very slightly off-centre forever and never self-corrects.

Fix, both halves:

  * pointerdown *finishes* an in-flight settle (`y()`) instead of stopping it -
    nothing is dropped and no snap is needed.
  * an idle watchdog on `d`: ~340ms after the row's value stops changing, and after
    one further 340ms of quiet if a pointer is still moving, commit to the nearest
    index and re-centre. It stamps `last` on window `pointermove`/`pointerdown`
    (capture) - the very events the drag itself is built from - so a finger that is
    *actively* dragging is never yanked, while a gesture the system ate (no
    `pointerup`, no `pointercancel`, `end` never runs) is recovered about 0.7s after
    the row goes still. Counting *live* pointers instead would deadlock exactly there
    - a stolen gesture never reports its release - so activity, not a count, is the
    signal. Also cleans up sub-pixel drift, so the row is always centred at rest.

No visual language changes: same springs, same snap targets. Only recovery.

Run:  python3 repo_export/patches/patch14_carousel_settle.py [--check]
"""
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

DOWN_OLD = "T.current?.(),g.current?.stop(),g.current=null;let sl=u.slide||1,cur=d.get(),near=Math.round(-cur/sl);"
DOWN_NEW = "T.current?.(),g.current&&y();let sl=u.slide||1,cur=d.get(),near=Math.round(-cur/sl);"

CLEAN_OLD = "(0,x.useEffect)(()=>()=>T.current?.(),[]),"
CLEAN_NEW = (
    "(0,x.useEffect)(()=>()=>T.current?.(),[]),"
    # watchdog: when the shared row spring goes still without a settle running,
    # commit to the nearest index and put the row back at 0. `last` is stamped by
    # the same window events the drag listens to, so an *active* finger is left
    # alone (one grace re-arm) while an eaten gesture is recovered.
    "(0,x.useEffect)(()=>{let t=null,last=0,grace=0,"
    "bump=()=>{last=performance.now()},"
    "done=()=>{let n=u.slide||1,c=d.get(),e=Math.round(-c/n);"
    "if(e&&(h.current+=e,i(h.current)),_.current=0,Math.abs(c)>.01*n)d.jump(0)},"
    "arm=()=>{clearTimeout(t),t=window.setTimeout(()=>{"
    "if(g.current)return;"
    "if(last&&performance.now()-last<340){if(grace++<1){arm();return}}else grace=0;"
    "done()},340)},"
    "off=d.on(`change`,()=>{grace=0,arm()});"
    "window.addEventListener(`pointermove`,bump,!0),window.addEventListener(`pointerdown`,bump,!0),"
    "window.addEventListener(`pointerup`,bump),window.addEventListener(`pointercancel`,bump);"
    "return()=>{clearTimeout(t),off?.(),window.removeEventListener(`pointermove`,bump,!0),"
    "window.removeEventListener(`pointerdown`,bump,!0),window.removeEventListener(`pointerup`,bump),"
    "window.removeEventListener(`pointercancel`,bump)}},[d,u.slide,i]),"
)

EDITS = [
    (DOWN_OLD, DOWN_NEW, "grab mid-glide commits the settle"),
    (CLEAN_OLD, CLEAN_NEW, "idle watchdog re-centres the row"),
]


def status(data):
    """(pending, applied, unrecognised).

    The watchdog edit is an *insertion*: its `old` anchor is the exact prefix of its
    `new` text, so "old is still present" would be true forever and a re-run would
    stack a second watchdog. Check the output first for those.
    """
    todo, done, bad = [], [], []
    for old, new, label in EDITS:
        if old in new and data.count(new) >= 1:
            done.append(label)
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
        raise SystemExit(1)
    print(f"clean (all {len(EDITS)} anchors present)" if not done
          else f"applied ({len(done)}/{len(EDITS)} edits in place)")
    raise SystemExit(0)

if bad:
    raise SystemExit("refusing to write - anchors not found: " + ", ".join(bad))
if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    data = data.replace(old, new)
    print(f"ok    {label}")

# the watchdog lives inside the carousel component only, and must not be able to
# fire while a pointer is down or a glide is running
# NB: the app's carousel is `function Td({cards:...})`; a bare "function Td(" also
# matches a React internal earlier in the bundle, so anchor on its signature.
car = data.split("function Td({cards:")[1].split("var Ed=")[0]
assert "window.addEventListener(`pointermove`,bump,!0)" in car, "watchdog landed outside the carousel"
assert "if(g.current)return;" in car, "watchdog lost its glide guard"
assert "grace++<1" in car, "watchdog lost its active-finger grace"
assert "g.current?.stop(),g.current=null;let sl=" not in car, "the drop-the-settle path is still there"

import shutil
import subprocess
import tempfile

if shutil.which("node"):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(data)
        tmp = fh.name
    node = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    Path(tmp).unlink(missing_ok=True)
    if node.returncode != 0:
        first = next((l for l in node.stderr.splitlines() if "Error" in l), node.stderr[:200])
        raise SystemExit(f"generated bundle does not parse: {first}\n  app/index.js left untouched")
    print("ok    node --check on the generated bundle")

path.write_text(data, encoding="utf-8")
print("app/index.js written - the carousel now always settles centred")
