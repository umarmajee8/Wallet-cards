#!/usr/bin/env python3
"""Stack layout: tapping a card should eject it and open it - not swap the deck.

Reported from the device: in the Stack layout, clicking a card plays "ajeeb si
animation" instead of opening the card, and the ask is that a clicked card come
out of the deck and open, like it does in the pouch.

Reading `__cwStack` explains the weird animation. Its pointerup handler treats a
tap as a *hit-test against the fan*:

    let e=(clientX-rect.left)/rect.width-.5, i=Math.round(d+e/.38);   // index under the tap
    n=Math.round(d)                       // current front index
    if(n!==Math.round(d)){snap(n);return} // <-- neighbour? animate the fan sideways, done.

So unless the tap lands within ~19% of the horizontal centre, the tap is reinterpreted
as "go to that card": the whole fan tweens sideways (each card sweeping through
rotateY +/-48deg, z -160px per step and scale 0.72-1) and **nothing opens** - a swipe
animation triggered by a tap. Clicking the card you can see at the edge therefore
never does what it looks like it should.

And when a tap *does* land on the front card, the only motion is the frosted flap
folding (`rotateX:-128`) - the card itself never leaves the deck, which is the
half of the request that says "card bahir ay or khuly". The pouch (`yd`) does have
that: `animate:{y:-(_d(geo)),rotate:-2.2,scale:1.05}` on a spring, then the detail
sheet opens from the card's rect.

Fix, four small edits, and the motion is borrowed from the pouch rather than
invented:

  1. `snap` takes an optional duration (the tap path wants a short, quiet re-order
     rather than the long fling tween).
  2. Tap: keep the hit-test, but make it *open* the card it lands on. A neighbour
     gets snapped forward (0.24s) and is ejected in the same breath, so the gesture
     reads as "the card you poked came toward you", not "the deck rotated".
     Also clears `drag.current`, which the tap path used to leave true - after the
     first tap the fan never resynced to a programmatic index change again.
  3. `__cwCoverCard` gets a `ly` spring and lifts `y:-ch*0.11` while ejected, on the
     pouch's exact spring (stiffness 240, damping 18, mass 0.85). `y` is a free
     channel on that element (x/z/rotateY/scale are the fan's own motion values), so
     nothing fights the drag math.
  4. The photo grows 1.05x while lifted - the same 1.05 the pouch uses. And with the
     cover off (no flap animation to complete) the open-handoff timer moves 140 ->
     240ms so the lift is actually visible before the sheet takes over.

Run:  python3 repo_export/patches/patch12_stack_eject.py [--check]
"""
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

EDITS = [
    # 1) snap(e, dur)
    (
        "snap=e=>{let t=Math.round(clamp(e));anim.current?.stop(),anim.current=Ju(p,t,"
        "{type:`tween`,duration:.34,ease:[.16,1,.3,1],onComplete:()=>{anim.current=null,i(t)}})}",
        "snap=(e,dur=.34)=>{let t=Math.round(clamp(e));anim.current?.stop(),anim.current=Ju(p,t,"
        "{type:`tween`,duration:dur,ease:[.16,1,.3,1],onComplete:()=>{anim.current=null,i(t)}})}",
        "snap duration arg",
    ),
    # 2) the tap path: open what was tapped, and stop leaking drag.current
    (
        "if(f!==1){let t=box.current?.getBoundingClientRect(),n=Math.round(d);"
        "if(t){let e=(r-t.left)/t.width-.5,i=Math.round(d+e/.38);n=clamp(i)}"
        "let c=e[n];if(!c)return;if(n!==Math.round(d)){snap(n);return}a(c);return}",
        "if(f!==1){drag.current=null;let t=box.current?.getBoundingClientRect(),n=Math.round(d);"
        "if(t){let e=(r-t.left)/t.width-.5,i=Math.round(d+e/.38);n=clamp(i)}"
        "let c=e[n];if(!c)return;n!==Math.round(d)&&snap(n,.24),a(c);return}",
        "tap opens the tapped card",
    ),
    # 3) the lift, on the pouch's spring; + 4) visible handoff when cover is off
    (
        "function __cwCoverCard({card:e,i:t,p:n,cw:r,ch:i,cover:cv=!0,ejected:s,hidden:c,blur:l,"
        "custom:j,tint:k,onCoverOpen:w}){let a=wu(0),o=wu(0),u=wu(0),d=wu(1),f=wu(1),",
        "function __cwCoverCard({card:e,i:t,p:n,cw:r,ch:i,cover:cv=!0,ejected:s,hidden:c,blur:l,"
        "custom:j,tint:k,onCoverOpen:w}){let a=wu(0),o=wu(0),u=wu(0),d=wu(1),f=wu(1),ly=wu(0),",
        "lift motion value",
    ),
    (
        "(0,x.useEffect)(()=>{if(cv||!s||!w)return;let e=window.setTimeout(()=>w(),140);"
        "return()=>window.clearTimeout(e)},[cv,s])",
        "(0,x.useEffect)(()=>{Ju(ly,s?-i*.11:0,{type:`spring`,stiffness:240,damping:18,mass:.85})},"
        "[s,ly,i]),"
        "(0,x.useEffect)(()=>{if(cv||!s||!w)return;let e=window.setTimeout(()=>w(),240);"
        "return()=>window.clearTimeout(e)},[cv,s])",
        "eject lift + handoff",
    ),
    (
        "style:{left:`50%`,top:`50%`,width:r,height:i,marginLeft:-r/2,marginTop:-i/2-12,x:a,z:o,",
        "style:{left:`50%`,top:`50%`,width:r,height:i,marginLeft:-r/2,marginTop:-i/2-12,y:ly,x:a,z:o,",
        "lift applied to the card",
    ),
    (
        "(0,U.jsx)(`div`,{className:`absolute overflow-hidden`,style:{inset:0,borderRadius:16,"
        "background:`#09090b`},children:(0,U.jsx)(`img`,{src:e.src,",
        "(0,U.jsx)(X.div,{className:`absolute overflow-hidden`,style:{inset:0,borderRadius:16,"
        "background:`#09090b`},initial:!1,animate:{scale:s?1.05:1},"
        "transition:{type:`tween`,duration:.26,ease:[.22,1,.28,1]},children:(0,U.jsx)(`img`,{src:e.src,",
        "photo grows 5%",
    ),
]

MARK = "ly=wu(0)"


def status(data):
    """(pending, applied, unrecognised).

    An insert-type edit leaves its `old` text inside its own `new` text, so a
    naive "is old still there?" test would re-apply it forever and emit a
    duplicate declaration (which `node --check` then catches). When `old` is a
    substring of `new`, the presence of `new` is the answer.
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

if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    data = data.replace(old, new)
    print(f"ok    {label}")
for label in done:
    print(f"skip  {label}: already applied")

# guard: a bundle that does not parse is a blank WebView on the phone, so fail here
assert MARK in data, "lift motion value missing after edits"
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
print("app/index.js written - stack taps now eject the tapped card and open it")
