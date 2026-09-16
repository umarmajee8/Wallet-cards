#!/usr/bin/env python3
"""Cards that stay centred: a held finger owns the row, a stolen stream gets recovered.

Device report, round 20: *"while scrolling through the passes the cards sometimes
shift/slide off to the side instead of staying properly centred/stacked"* - and it
is intermittent ("sometimes"), so it is a race, not a layout error. Two of them,
both reproduced in jsdom against the shipped bundle before this patch:

1. **The carousel's own recovery yanks the row out from under a live finger.**
   patch 14 decided "the gesture was stolen" from an *event-quiet* window (340ms,
   one 340ms grace re-arm) and then committed the nearest index and `d.jump(0)`.
   A finger that is simply *still* mid-drag produces exactly the same silence, so
   the watchdog fires, the row snaps to the nearest card, and the next
   `pointermove` re-applies the whole gesture delta from the new base:

       at rest           -403.2 | -201.6 |   0.0 | 201.6 | 403.2
       200px drag        -509.3 | -307.7 | -106.1 |  95.5 | 297.1
       800ms, finger down -403.2 | -201.6 |   0.0 | 201.6 | 403.2   <- yanked sideways
       next move         -573.0 | -371.4 | -169.8 |  31.8 | 233.4   <- second jolt

   `mv` computes `k+s` where `k` was captured at pointerdown and `s` is the total
   delta since then, so anything that moves `d` behind the gesture's back (the
   watchdog, the index effect) turns the next move into a jump. Same class of bug
   in the stack, whose `v` computes `d-e/(cw*.62)` from a captured start index.

2. **The stack has no recovery at all, and a cancel is a tap.** `__cwStack` never
   got the patch-14 treatment, so a gesture the system eats leaves the deck at a
   fractional index *forever* - and because `drag.current` stays set, the
   `useLayoutEffect(()=>{drag.current||p.jump(r)},[r,p])` guard means it never
   re-syncs to a programmatic index change either; the 480ms long-press timer also
   keeps running. Measured: `0.0 | 229.5 | 459.0 | 688.5` at rest, `-225.8 | 3.7 |
   233.2 | 462.7` after an unreleased drag, byte-identical 2.5s and 4.5s later.
   And `window.addEventListener('pointercancel',y)` sends a cancel down the *tap*
   path, so a gesture the OS takes over (no movement) opens the card under the
   finger: a bare `pointercancel` moved the deck to index 3 in the probe.

Fix, in the same motion language the app already uses:

* **One pointer bookkeeping helper** (`__cwPtr`, injected once): who is down
  (pointerdown -> up / cancel / lostpointercapture) plus "has *any* pointer event
  happened recently", and an `onGone` signal for the three ways a WebView loses a
  stream for good - `visibilitychange` (hidden), `blur`, `pagehide`. The system
  gesture that backgrounded the app is the case patch 14's report described, and
  those events *do* fire for it; a finger resting on the glass fires none of them.
* **A held finger owns the row.** The carousel watchdog now only moves the row
  when no pointer is down - or when the stream has been silent for 1500ms with a
  pointer still nominally down (the eaten-stream case, and by then the recovery is
  what the user expects). It *glides* home with the row's existing `Cd` tween and
  **never commits an index step**: committing at an arbitrary offset cannot be
  seamless (it moves the fan by `slide - sideGap`), so the recovery returns to the
  card the user was on, calmly, and the rest state is still exactly centred.
  `onGone` recovers immediately, because the page is hidden when it fires.
* **Grabbing a settling row no longer jumps it.** `y()` commits a *pending* index
  step (patch 14's "nothing is dropped") and re-centres only when it does; with no
  step pending it just stops the glide and lets the drag continue from where the
  row actually is. Same for the pointerdown path's `near` catch-up.
* **The drag is rebased on the live value**, in both views: at every move the code
  compares the row's actual value with the value it last wrote, and if anything
  else moved it (watchdog, index effect, a snap), the pointer's origin is re-based
  instead of replaying the deltas it already spent. This is what makes "the cards
  never drift sideways" true by construction rather than by luck.
* **The stack gets patch 14's guarantees**: a cancel is an abort (settle to the
  nearest card, never open), `pointercancel` clears the long-press timer, and an
  idle watchdog commits the nearest index, releases `drag.current`, kills the
  gesture's listeners and the hold timer - so the deck always rests on a card and
  programmatic index changes move it again. `snap()` is the existing index-based
  motion, so the stack's recovery is a smooth tween by construction.
* `g.current` (the carousel's settle slot) is cleared when a settle-to-zero
  finishes; it used to stay set to a *finished* animation, which silently disabled
  the watchdog's `if(g.current)return` guard until the next touch began.

No visual language changed: same springs, same snap targets, same thresholds. The
only new motion is a recovery glide where there used to be a jump.

Supersedes patch 14's watchdog text (patch 14 keeps a DOWNSTREAM_KEEP marker).

Run:  python3 repo_export/patches/patch35_gesture_recovery.py [--check]
"""
from __future__ import annotations

from pathlib import Path
import sys

CHECK = "--check" in sys.argv
path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")

# --------------------------------------------------------------- 0. __cwPtr
HELPER_ANCHOR = "function __cwCoverCard({card:e,i:t,p:n,cw:r,ch:i,cover:cv=!0,ejected:s,hidden:c,blur:l"
HELPER = (
    "var __cwPtrState=null;"
    "function __cwPtr(){if(__cwPtrState)return __cwPtrState;"
    "let ids=new Set(),last=performance.now(),subs=[],"
    "touch=()=>{last=performance.now()},"
    "add=e=>{touch(),e&&e.pointerId!=null&&ids.add(e.pointerId)},"
    "drop=e=>{touch(),e&&e.pointerId!=null&&ids.delete(e.pointerId)},"
    "gone=()=>{ids.clear(),touch(),subs.slice().forEach(f=>{try{f()}catch{}})};"
    "window.addEventListener(`pointerdown`,add,!0),window.addEventListener(`pointermove`,touch,!0),"
    "window.addEventListener(`pointerup`,drop,!0),window.addEventListener(`pointercancel`,drop,!0),"
    "window.addEventListener(`lostpointercapture`,drop,!0),window.addEventListener(`blur`,gone,!0),"
    "window.addEventListener(`pagehide`,gone,!0),"
    "document.addEventListener(`visibilitychange`,()=>{document.hidden&&gone()},!0);"
    "return __cwPtrState={held:()=>ids.size>0,quiet:e=>performance.now()-last>e,"
    "onGone:f=>{subs.push(f);return()=>{subs=subs.filter(g=>g!==f)}}}}"
)

# ------------------------------------------------------- 1. the carousel row
CAR_LET_OLD = (
    "onEjectComplete:l}){let u=Sd(n),d=wu(0),f=e.length,"
)
CAR_LET_NEW = (
    "onEjectComplete:l}){let u=Sd(n),ptr=__cwPtr(),d=wu(0),f=e.length,"
)

CAR_YB_OLD = (
    "let y=()=>{g.current?.stop(),g.current=null;let e=_.current;_.current=0,"
    "e&&(h.current+=e,i(h.current)),d.jump(0)},"
    "b=e=>{g.current?.stop();if(!e||f<=1){g.current=Ju(d,0,Cd);return}"
    "_.current=e,navigator.vibrate&&navigator.vibrate(5),"
    "g.current=Ju(d,-e*u.slide,{...Cd,onComplete:y})},"
)
CAR_YB_NEW = (
    # a pending index step is still committed (patch 14's "nothing is dropped"), but a
    # settle that has no step to commit must not jump the row: the grab keeps the value
    # it has and the (rebased) drag continues from there.
    "let y=()=>{let e=_.current;_.current=0,e?(h.current+=e,i(h.current),"
    "g.current?.stop(),g.current=null,d.jump(0)):(g.current?.stop(),g.current=null)},"
    # and a settle to zero clears its own slot; leaving a finished animation in
    # `g.current` used to disarm the watchdog's `if(g.current)return` guard for good.
    "b=e=>{g.current?.stop();if(!e||f<=1){g.current=Ju(d,0,{...Cd,onComplete:()=>{g.current=null}});return}"
    "_.current=e,navigator.vibrate&&navigator.vibrate(5),"
    "g.current=Ju(d,-e*u.slide,{...Cd,onComplete:y})},"
)

WATCH_OLD = (
    "(0,x.useEffect)(()=>()=>T.current?.(),[]),"
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
WATCH_NEW = (
    "(0,x.useEffect)(()=>()=>T.current?.(),[]),"
    "(0,x.useEffect)(()=>{let t=null,"
    # commit nothing, jump nothing: glide the row home on the spring it already
    # uses. The rest state is centred either way, and a near-miss guess is a
    # settle rather than a sideways jolt.
    "home=()=>{let n=u.slide||1;"
    "Math.abs(d.get())>.01*n&&!g.current&&(g.current=Ju(d,0,Cd))},"
    "arm=()=>{clearTimeout(t),t=window.setTimeout(()=>{"
    "if(g.current)return;"
    "let n=u.slide||1,c=d.get();"
    "if(Math.abs(c)<=.01*n)return;"
    # a finger on the glass owns the row; only a stream that has gone completely
    # quiet for 1500ms is treated as eaten (it is the one case with no signal at all)
    "if(ptr.held()&&!ptr.quiet(1500)){arm();return}"
    "home()},400)},"
    "off=d.on(`change`,arm),"
    # visibilitychange/blur/pagehide: the stream is gone for good and the page is
    # hidden, so recovering now cannot be seen - and the row is correct on return
    "un=ptr.onGone(home);"
    "return arm(),()=>{clearTimeout(t),off?.(),un?.()}},[d,u.slide,ptr]),"
)

CAR_DOWN_OLD = (
    "let sl=u.slide||1,cur=d.get(),near=Math.round(-cur/sl);"
    "near&&(h.current+=near,i(h.current)),d.jump(0),_.current=0;"
    "let t=e.pointerId,n=e.clientX,r=e.clientY,lock=0,a=n,o=performance.now(),c=0,k=0,mv=e=>{"
)
CAR_DOWN_NEW = (
    # the catch-up commit is seamless at a whole-slot offset and must not move the
    # row otherwise: a grab onto a row that drifted is a grab, not a snap
    "let sl=u.slide||1,cur=d.get(),near=Math.round(-cur/sl);"
    "near&&(h.current+=near,i(h.current),d.jump(0)),_.current=0;"
    "let t=e.pointerId,n=e.clientX,r=e.clientY,lock=0,a=n,o=performance.now(),c=0,k=0,sv=0,mv=e=>{"
)

CAR_MV_OLD = "let lim=sl*1.12,nx=k+s;d.set(Math.max(-lim,Math.min(lim,nx)))"
CAR_MV_NEW = (
    # rebase on the row's live value whenever something else moved it, then re-anchor
    # after every write - the gesture can only ever add its own delta
    "Math.abs(d.get()-k)>.5&&(k=d.get(),sv=s);"
    "let lim=sl*1.12,nx=k+s-sv;d.set(Math.max(-lim,Math.min(lim,nx))),k=d.get(),sv=s"
)

# ------------------------------------------------------------- 2. the stack
ST_REFS_OLD = (
    "let zsz=j&&j.size!=null?+j.size:1,N=e.length,p=wu(r),anim=(0,x.useRef)(null),"
    "drag=(0,x.useRef)(null),done=(0,x.useRef)(!1),hold=(0,x.useRef)(0),box=(0,x.useRef)(null);"
)
ST_REFS_NEW = (
    "let zsz=j&&j.size!=null?+j.size:1,N=e.length,p=wu(r),anim=(0,x.useRef)(null),"
    "drag=(0,x.useRef)(null),done=(0,x.useRef)(!1),hold=(0,x.useRef)(0),box=(0,x.useRef)(null),"
    "ptr=__cwPtr(),kill=(0,x.useRef)(null);"
)

ST_SYNC_ANCHOR = "(0,x.useLayoutEffect)(()=>{drag.current||p.jump(r)},[r,p]);"
ST_WATCH = (
    # the deck's rest position is a card, exactly like the carousel's is 0. `snap` is
    # index-based, so this recovery is a tween - never a jump - and it commits the
    # nearest index on completion, which re-syncs the deck to programmatic changes
    # because `drag.current` is released here.
    "(0,x.useEffect)(()=>{let t=null,"
    "arm=()=>{clearTimeout(t),t=window.setTimeout(()=>{"
    "if(anim.current)return;"
    "let e=p.get();"
    "if(Math.abs(e-Math.round(e))<=.01)return;"
    "if(ptr.held()&&!ptr.quiet(1500)){arm();return}"
    "drag.current=null,kill.current?.(),kill.current=null,window.clearTimeout(hold.current),snap(e)"
    "},500)},"
    "off=p.on(`change`,arm),"
    "un=ptr.onGone(()=>{anim.current||snap(p.get())});"
    "return arm(),()=>{clearTimeout(t),off?.(),un?.(),window.clearTimeout(hold.current)}},[p,N,i]),"
)

ST_DECL_OLD = (
    "let n=t.pointerId,r=t.clientX,u=t.clientY,d=p.get(),f=0,m=r,h=performance.now(),g=0,lp=!1,v=t=>{"
)
ST_DECL_NEW = (
    "let n=t.pointerId,r=t.clientX,u=t.clientY,d=p.get(),f=0,m=r,h=performance.now(),g=0,lp=!1,"
    "ab=!1,w0=d,s0=0,v=t=>{"
)

ST_MV_OLD = (
    "if(f!==1)return;"
    "let i=performance.now(),a=Math.max(1,i-h);"
    "g=.7*((t.clientX-m)/a*1e3)+.3*g,m=t.clientX,h=i,"
    "p.set(clamp(d-e/(cw*.62)))}"
)
ST_MV_NEW = (
    "if(f!==1)return;"
    "let i=performance.now(),a=Math.max(1,i-h);"
    "g=.7*((t.clientX-m)/a*1e3)+.3*g,m=t.clientX,h=i,"
    "Math.abs(p.get()-w0)>.02&&(w0=p.get(),s0=e),"
    "p.set(clamp(w0-(e-s0)/(cw*.62))),w0=p.get(),s0=e}"
)

ST_UP_OLD = (
    "y=t=>{if(t.pointerId!==n)return;b(),window.clearTimeout(hold.current);if(lp||f===2)return;"
)
ST_UP_NEW = (
    # a cancel is an abort: settle to the nearest card and never open what the finger
    # happened to be over when the OS took the gesture away
    "y=t=>{if(t.pointerId!==n)return;b(),kill.current=null,window.clearTimeout(hold.current);"
    "if(ab){drag.current=null,snap(p.get());return}"
    "if(lp||f===2)return;"
)

ST_CANCEL_OLD = "window.addEventListener(`pointerup`,y),window.addEventListener(`pointercancel`,y)"
ST_CANCEL_NEW = (
    "window.addEventListener(`pointerup`,y),"
    "window.addEventListener(`pointercancel`,t=>{if(t.pointerId!==n)return;ab=!0,y(t)})"
)

ST_HOLD_OLD = "drag.current=!0,hold.current=window.setTimeout("
ST_HOLD_NEW = "drag.current=!0,kill.current=b,hold.current=window.setTimeout("

EDITS = [
    (HELPER_ANCHOR, HELPER + HELPER_ANCHOR, "the pointer bookkeeping helper (who is down, gone signals)"),
    (CAR_LET_OLD, CAR_LET_NEW, "carousel: reads the pointer state"),
    (CAR_YB_OLD, CAR_YB_NEW, "carousel: a settle with no index step must not jump the row"),
    (WATCH_OLD, WATCH_NEW, "carousel: a held finger owns the row; recovery glides, never jumps"),
    (CAR_DOWN_OLD, CAR_DOWN_NEW, "carousel: the grab catch-up only moves the row when it is seamless"),
    (CAR_MV_OLD, CAR_MV_NEW, "carousel: the drag rebases on the row's live value"),
    (ST_REFS_OLD, ST_REFS_NEW, "stack: reads the pointer state, keeps its gesture cleanup"),
    (ST_SYNC_ANCHOR, ST_SYNC_ANCHOR + ST_WATCH, "stack: the deck always comes back to a card"),
    (ST_DECL_OLD, ST_DECL_NEW, "stack: the drag rebases on the deck's live value"),
    (ST_MV_OLD, ST_MV_NEW, "stack: ...and re-anchors after every write"),
    (ST_UP_OLD, ST_UP_NEW, "stack: a cancel is an abort, not a tap"),
    (ST_CANCEL_OLD, ST_CANCEL_NEW, "stack: pointercancel marks the gesture aborted"),
    (ST_HOLD_OLD, ST_HOLD_NEW, "stack: the long-press timer is reachable by the watchdog"),
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
        raise SystemExit(1)
    print(f"clean (all {len(EDITS)} anchors present)" if not todo
          else f"pending ({len(todo)}/{len(EDITS)} edits to apply)")
    raise SystemExit(0)

if bad:
    raise SystemExit("refusing to write - anchors not found: " + ", ".join(bad))
if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    data = data.replace(old, new)
    print(f"ok    {label}")

# the guards that make the fix the fix, checked on the *output*
car = data.split("function Td({cards:")[1].split("var Ed=")[0]
stk = data.split("function __cwStack({cards:")[1].split("function Td({cards:")[0]
assert "__cwPtr=null;function __cwPtr" not in car, "the helper landed inside the carousel"
assert "__cwPtrState={held:" in data, "the helper lost its API"
assert "if(ptr.held()&&!ptr.quiet(1500)){arm();return}" in car, "carousel: the watchdog can still move a held row"
assert "g.current=Ju(d,0,Cd)" in car, "carousel: the recovery glide is gone"
assert "d.jump(0)" not in car.split("home=()=>")[1].split("off=d.on")[0], \
    "carousel: the recovery still jumps instead of gliding"
assert "Math.abs(d.get()-k)>.5&&(k=d.get(),sv=s)" in car, "carousel: the drag is not rebased"
assert "k=d.get(),sv=s" in car, "carousel: the drag does not re-anchor after a write"
assert "g.current=Ju(d,0,{...Cd,onComplete:()=>{g.current=null}})" in car, \
    "carousel: the zero-target settle still leaves g.current set"
assert "if(ptr.held()&&!ptr.quiet(1500)){arm();return}" in stk, "stack: the watchdog can still move a held deck"
assert "snap(e)" in stk, "stack: the recovery does not snap to a card"
assert "drag.current=null,kill.current?.()" in stk, "stack: the recovery does not release the gesture"
assert "if(ab){drag.current=null,snap(p.get());return}" in stk, "stack: a cancel still walks the tap path"
assert "addEventListener(`pointercancel`,t=>{if(t.pointerId!==n)return;ab=!0,y(t)})" in stk, \
    "stack: pointercancel is not marked as an abort"
assert "Math.abs(p.get()-w0)>.02&&(w0=p.get(),s0=e)" in stk, "stack: the drag is not rebased"
assert "if(f!==1){drag.current=null;" in stk, "stack: the tap path's ref release is gone (patch 12)"
assert "__cwPtr()" in car and "__cwPtr()" in stk, "a view does not read the pointer state"

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
print("app/index.js written - a held finger owns the row, and a lost gesture always comes home")
