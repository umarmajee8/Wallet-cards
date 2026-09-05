#!/usr/bin/env python3
"""Stack eject: come straight out, not in from the side - and stop paying for blur.

Device feedback on patch 12: *"thora sa laggy lagta ha card jab card nikalta ha,
lakin side sy ata ha"*. Two separate causes, both in what patch 12 (and the stock
code before it) did:

**1. the side entry.** Patch 12 kept the stock hit-test (which card is under the
tap) and, for anything but the front card, called `snap(n,.24)` - a tween of the
*whole fan* - before ejecting. Travelling from the side slot to the centre is
exactly a sideways move, and because the front slot is only ~19% of the width, most
taps landed on a neighbour, so most taps showed the slide.

Now the tap does not tween the deck at all: the tapped card is ejected from the
slot it is in (lift + grow), and the deck's index is updated when the detail sheet
hands over - by then the sheet's own full-screen backdrop (`rgba(9,9,11,.94)`)
covers the deck, and the card itself is already at `opacity:0` (`hiddenId`), so the
re-order happens where it cannot be seen. Closing the sheet leaves the card you
opened at the front, which is what a tap should mean.

**2. the lag.** Two per-frame costs were being paid during the motion:
  * the flap animates `rotateX` while carrying `backdrop-filter:blur(22px)
    saturate(1.6)`. Re-blurring a backdrop behind a *moving* layer is the single
    most expensive thing an Android WebView can be asked to do here. It is now
    dropped for the duration of the fold (`backdropFilter:s?'none':...`) and
    restored when the card settles back - the frosted look is untouched at rest.
  * the 1.05 growth was on the photo's `absolute overflow-hidden` box: scaling a
    clipped, rounded element re-rasterises the clip every frame. It rides the
    card's own `scale` spring (`d`) instead - same channel framer already animates,
    no extra clip.
  Neighbours now dim with `blur(6px)` instead of `blur(10px)`, which is affordable
  because (1) means they no longer move while the card is out.
  Timings tightened: flap .4 -> .26s, lift spring 240/18/.85 -> 520/34/.6 (the
  bouncy pouch spring read as slow for a deck that is one card thick), and with the
  cover off the handoff wait 240 -> 170ms.

**3. a jump the in-place eject exposed.** The stack handed the detail sheet a rect
computed from the *stage* box (always the stage centre), which is only right when
the card is centred. With cards ejecting from their own slots, the sheet zoomed in
from the middle while the card was off to the side. `__cwCoverCard` now measures
itself (`rc`) and hands its own rect up, so the sheet starts exactly where the card
is; the stage-centre math stays as the fallback for a missing/zero rect.

Run:  python3 repo_export/patches/patch13_stack_eject_inplace.py [--check]
Depends on patch 12 (it edits patch 12's output).
"""
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

EDITS = [
    # 1) tap = eject the card under the tap, from where it stands
    (
        "let c=e[n];if(!c)return;n!==Math.round(d)&&snap(n,.24),a(c);return}",
        "let c=e[n];if(!c)return;a(c);return}",
        "tap: no deck tween",
    ),
    # 2) the card measures itself, and grows on its existing scale spring
    (
        "ly=wu(0),col=",
        "ly=wu(0),rc=(0,x.useRef)(null),col=",
        "self rect ref",
    ),
    (
        "(0,U.jsxs)(X.div,{className:`absolute no-select`,style:{left:`50%`,",
        "(0,U.jsxs)(X.div,{ref:rc,className:`absolute no-select`,style:{left:`50%`,",
        "ref attached",
    ),
    (
        "(0,x.useEffect)(()=>{Ju(ly,s?-i*.11:0,{type:`spring`,stiffness:240,damping:18,mass:.85})},"
        "[s,ly,i]),"
        "(0,x.useEffect)(()=>{if(cv||!s||!w)return;let e=window.setTimeout(()=>w(),240);"
        "return()=>window.clearTimeout(e)},[cv,s]),",
        "(0,x.useEffect)(()=>{let n={type:`spring`,stiffness:520,damping:34,mass:.6};"
        "Ju(ly,s?-i*.11:0,n),Ju(d,s?1.05:1,n)},[s,ly,i,d]),"
        "(0,x.useEffect)(()=>{if(cv||!s||!w)return;let e=window.setTimeout(()=>w(rc.current),170);"
        "return()=>window.clearTimeout(e)},[cv,s]),",
        "lift retuned + growth on the scale spring",
    ),
    (
        "(0,U.jsx)(X.div,{className:`absolute overflow-hidden`,style:{inset:0,borderRadius:16,"
        "background:`#09090b`},initial:!1,animate:{scale:s?1.05:1},"
        "transition:{type:`tween`,duration:.26,ease:[.22,1,.28,1]},children:(0,U.jsx)(`img`,{src:e.src,",
        "(0,U.jsx)(`div`,{className:`absolute overflow-hidden`,style:{inset:0,borderRadius:16,"
        "background:`#09090b`},children:(0,U.jsx)(`img`,{src:e.src,",
        "no animated clip",
    ),
    # 3) the expensive blur is off for the duration of the fold; sheet starts at the card
    (
        "backdropFilter:`blur(22px) saturate(1.6)`,WebkitBackdropFilter:`blur(22px) saturate(1.6)`,"
        "transformOrigin:`50% 0%`,transformStyle:`preserve-3d`,backfaceVisibility:`hidden`},"
        "initial:false,animate:s?{rotateX:-128,y:-6}:{rotateX:0,y:0},"
        "transition:{type:`tween`,duration:.4,ease:[.22,1,.28,1]},"
        "onAnimationComplete:()=>{s&&w&&w()}}",
        "backdropFilter:s?`none`:`blur(22px) saturate(1.6)`,"
        "WebkitBackdropFilter:s?`none`:`blur(22px) saturate(1.6)`,"
        "transformOrigin:`50% 0%`,transformStyle:`preserve-3d`,backfaceVisibility:`hidden`},"
        "initial:false,animate:s?{rotateX:-128,y:-6}:{rotateX:0,y:0},"
        "transition:{type:`tween`,duration:.26,ease:[.22,1,.28,1]},"
        "onAnimationComplete:()=>{s&&w&&w(rc.current)}}",
        "flap: blur only at rest",
    ),
    (
        "filter:l?`blur(10px)`:`none`,overflow:`visible`",
        "filter:l?`blur(6px)`:`none`,overflow:`visible`",
        "neighbours dim cheaper",
    ),
    # 4) hand the sheet the card's own rect, and let the deck follow once it is covered
    (
        "onCoverOpen:()=>{if(done.current||!l||s!==n.id)return;done.current=!0;"
        "let t=box.current?.getBoundingClientRect()||{top:80,left:40,width:w,height:vh},im=new Image;"
        "im.src=n.src;let nw=im.naturalWidth||760,nh=im.naturalHeight||494,"
        "fw=Math.min(nw,nh)||cw,fh=Math.max(nw,nh)||ch;"
        "l(n,{rect:{top:t.top+(t.height-ch)/2,left:t.left+(t.width-cw)/2,width:cw,height:ch},"
        "natW:fw,natH:fh,vert:!0})}",
        "onCoverOpen:rc=>{if(done.current||!l||s!==n.id)return;done.current=!0;"
        "let t=box.current?.getBoundingClientRect()||{top:80,left:40,width:w,height:vh},"
        "r0=rc&&rc.width?rc:null,im=new Image;"
        "im.src=n.src;let nw=im.naturalWidth||760,nh=im.naturalHeight||494,"
        "fw=Math.min(nw,nh)||cw,fh=Math.max(nw,nh)||ch;"
        "l(n,{rect:r0?{top:r0.top,left:r0.left,width:r0.width,height:r0.height}:"
        "{top:t.top+(t.height-ch)/2,left:t.left+(t.width-cw)/2,width:cw,height:ch},"
        "natW:fw,natH:fh,vert:!0});"
        "let q=e.findIndex(z=>z.id===n.id);q>=0&&i(q)}",
        "hand-off: card rect + deck follows",
    ),
]

def status(data):
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
        print("  (these spans belong to patch 12's output - run patch 12 first)")
        raise SystemExit(1)
    print(f"clean (all {len(EDITS)} anchors present)" if not done
          else f"applied ({len(done)}/{len(EDITS)} edits in place)")
    raise SystemExit(0)

if bad:
    raise SystemExit(
        "refusing to write - anchors not found and no applied-output either: " + ", ".join(bad)
        + "\n  (these spans belong to patch 12's output; run patch 12 first)"
    )

if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    data = data.replace(old, new)
    print(f"ok    {label}")
for label in done:
    print(f"skip  {label}: already applied")

# A bundle that does not parse is a blank WebView on the phone; and an eject that
# still tweens the fan on tap would mean edit 1 did not land.
import shutil
import subprocess
import tempfile

if "snap(n,.24),a(c)" in data:
    raise SystemExit("refusing to write: the tap path still snaps the deck")
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
print("app/index.js written - stack cards now come straight out, blur only at rest")
