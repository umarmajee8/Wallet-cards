#!/usr/bin/env python3
"""Patch 23 - Stack and Carousel become *independent* configuration modes.

Round 12 ask: *"Layout section mein Stack aur Carousel ko completely separate configuration modes
banao. Stack ke liye independent settings: card overlap, vertical offset, scale, rotation, visible
cards, spacing. Carousel ke liye: card spacing, scale, side card visibility, peek amount,
horizontal positioning. Stack ki settings Carousel par apply nahi honi chahiye aur Carousel ki
settings Stack par apply nahi honi chahiye."*

So each view gets its own object under the pouch settings - ``custom.stack`` and
``custom.carousel`` - holding the layout numbers *that view actually renders*, and the wallet
passes the merged one down:

    custom: __cwMrg(j.custom, `stack`)     // {...custom, ...custom.stack}
    custom: __cwMrg(j.custom, `carousel`) // {...custom, ...custom.carousel}

Both renderers keep reading the flat field names they already know (``size``, ``gap``, ``radius``),
so a namespaced value simply overrides the shared one for that view. Nothing cross-wires: the
carousel never sees ``overlap``, the stack never sees ``peek``.

New geometry, all read where the card is already being positioned:

* Stack (``__cwCoverCard``): ``overlap`` (0-1.1, the x step as a fraction of card width - what
  sits under the card in front), ``spacing`` (extra px per step), ``vOff`` (px vertical step, on a
  transform so it costs nothing to animate), ``shrink`` (how much each deeper card scales down),
  ``rot`` (degrees of 3D turn per card, and how far the clamp opens), ``visible`` (how many cards
  stay opaque - 3..8).
* Carousel (``xd`` -> ``geo`` -> ``Dd``): ``spacing`` (``gap``, slide px), ``scale`` (``size``),
  ``side`` (side-card opacity, graded by distance), ``peek`` (how far the neighbours sit laterally,
  i.e. how much of them peeks past the front card), ``pos`` (a horizontal bias of the whole row).

Defaults are chosen so that a wallet with no new settings renders exactly what patch 21 rendered:
overlap .7, spacing 0, vOff 0, shrink 1, rot 1, visible 3 (``c>2.35`` was the old cut-off),
side 1, peek 1, pos 0. ``$p()`` folds any older flat ``gap``/``size``/``stack`` (the fan multiplier)
into both namespaces once, so an existing install keeps its look instead of resetting.

Run:  python3 repo_export/patches/patch23_view_scoped_layout.py [--check]
"""
from pathlib import Path
import sys

CHECK = "--check" in sys.argv
JS = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = JS.read_text(encoding="utf-8")

XU_OLD = ("Xu={color:`#5c6574`,grain:.2,stitch:!1,name:`Wallet`,grade:1,design:`slate`,"
          "radius:1,shadow:1,material:1,depth:1,border:1,size:1,gap:20,stack:1}")
XU_NEW = ("Xu={color:`#5c6574`,grain:.2,stitch:!1,name:`Wallet`,grade:1,design:`slate`,"
          "radius:1,shadow:1,material:1,depth:1,border:1,size:1,gap:20,"
          "stack:{size:1,gap:20,overlap:.7,spacing:0,vOff:0,shrink:1,rot:1,visible:3},"
          "carousel:{size:1,gap:20,side:1,peek:1,pos:0}}")

# ---------------------------------------------------------------- view overlay + loader migration
MERGE_OLD = "function $p(){"
MERGE_NEW = ("function __cwMrg(c,v){let o=c||{},s=o[v];return s&&typeof s==`object`?{...o,...s}:{...o}}\n"
             "function $p(){")
LOAD_OLD = ("n.appearance===`system`&&!n.appearanceMigrated&&(n.appearance=`light`,"
            "n.appearanceMigrated=!0),n}}catch{}return Qp}")
LOAD_NEW = (
    # appended after the appearance migration so patch 17's loader block stays contiguous
    "n.appearance===`system`&&!n.appearanceMigrated&&(n.appearance=`light`,"
    "n.appearanceMigrated=!0),"
    # fold the pre-split flat fields (and the old Fan preset multiplier) into both namespaces,
    # once, so an install that had moved those sliders keeps its look
    "(()=>{let c=n.custom,"
    "sz=c.size==null?1:+c.size,gp=c.gap==null?20:+c.gap,fn=typeof c.stack==`number`?+c.stack:1,"
    "st=c.stack&&typeof c.stack==`object`?c.stack:null,ca=c.carousel&&typeof c.carousel==`object`?c.carousel:null;"
    "if(st&&ca)return;"
    "n.custom={...c,"
    "stack:st||{size:sz,gap:gp,overlap:.7*fn,spacing:(gp-20)*1.6,vOff:0,shrink:1,rot:fn,visible:3},"
    "carousel:ca||{size:sz,gap:gp,side:1,peek:1,pos:0}}})(),n}}catch{}return Qp}")

# ------------------------------------------------------------------------- carousel geometry
XD_OLD = "function xd(k){let g=k||{},sz=g.size==null?1:+g.size,gp=g.gap==null?20:+g.gap,rd=g.radius==null?1:+g.radius,"
XD_NEW = ("function xd(k){let g=k||{},sz=g.size==null?1:+g.size,gp=g.gap==null?20:+g.gap,rd=g.radius==null?1:+g.radius,"
          "pk=g.peek==null?1:+g.peek,px=g.pos==null?0:+g.pos,so=g.side==null?1:+g.side,")
XD_TAIL_OLD = "pouchRadius:n*bd.pouchRadius*rd,cardRadius:n*bd.cardRadius*rd,stageH:l,slide:n*u+gp,scale:u}"
XD_TAIL_NEW = ("pouchRadius:n*bd.pouchRadius*rd,cardRadius:n*bd.cardRadius*rd,stageH:l,slide:n*u+gp,scale:u,"
               "sideGap:n*.56*pk,posX:n*px,sideOp:so}")
SD_OLD = ("function Sd(k){let g=(0,x.useRef)(k);g.current=k;let[e,t]=(0,x.useState)(()=>xd(k));"
          "(0,x.useEffect)(()=>{t(xd(g.current))},[k&&k.size,k&&k.gap,k&&k.radius]);")
SD_NEW = ("function Sd(k){let g=(0,x.useRef)(k);g.current=k;let[e,t]=(0,x.useState)(()=>xd(k));"
          "(0,x.useEffect)(()=>{t(xd(g.current))},[k&&k.size,k&&k.gap,k&&k.radius,k&&k.peek,k&&k.pos,k&&k.side]);")
DD_OLD = ("let e=e=>{let t=i.slide? (n*i.slide+e)/i.slide:n,a=Math.abs(t);h.set(t*i.pouchW*.56),z.set(-a*150),"
          "ry.set(Math.max(-52,Math.min(52,t*-46))),sc.set((a<.002?1:Math.max(.68,1-.2*a))*i.scale)};"
          "return e(r.get()),r.on(`change`,e)},[h,z,ry,sc,r,n,i.slide,i.scale,i.pouchW]")
DD_NEW = ("let e=e=>{let t=i.slide? (n*i.slide+e)/i.slide:n,a=Math.abs(t),sg=i.sideGap||i.pouchW*.56;"
          "h.set(t*sg+(i.posX||0)),z.set(-a*150),ry.set(Math.max(-52,Math.min(52,t*-46))),"
          "sc.set((a<.002?1:Math.max(.68,1-.2*a))*i.scale),op.set(a<.002?1:Math.max(.14,1-(1-(i.sideOp==null?1:i.sideOp))*a))};"
          "return e(r.get()),r.on(`change`,e)},[h,z,ry,sc,op,r,n,i.slide,i.scale,i.pouchW,i.sideGap,i.posX,i.sideOp]")
DD_OP_OLD = "h=wu(0),z=wu(0),ry=wu(0),sc=wu(i.scale);"
DD_OP_NEW = "h=wu(0),z=wu(0),ry=wu(0),sc=wu(i.scale),op=wu(1);"
DD_STYLE_OLD = "style:{x:h,z:z,rotateY:ry,scale:sc,y:0,opacity:1,"
DD_STYLE_NEW = "style:{x:h,z:z,rotateY:ry,scale:sc,y:0,opacity:op,"

# ------------------------------------------------------------------------------- stack geometry
SC_OLD = ("pc2=j||{},rd=pc2.radius==null?1:+pc2.radius,fn=pc2.stack==null?1:+pc2.stack,"
          "gp=pc2.gap==null?20:+pc2.gap,sh=pc2.shadow==null?1:+pc2.shadow;")
SC_NEW = ("pc2=j||{},rd=pc2.radius==null?1:+pc2.radius,sh=pc2.shadow==null?1:+pc2.shadow,"
          "ov=pc2.overlap==null?.7:+pc2.overlap,sp=pc2.spacing==null?0:+pc2.spacing,"
          "vof=pc2.vOff==null?0:+pc2.vOff,sk=pc2.shrink==null?1:+pc2.shrink,"
          "rt=pc2.rot==null?1:+pc2.rot,vi=pc2.visible==null?3:+pc2.visible;")
SF_OLD = ("let e=e=>{let l=t-e,c=Math.abs(l);a.set(l*r*(.7+(gp-20)/120)*fn),o.set(-c*160*fn),"
          "u.set(Math.max(-48,Math.min(48,l*-40*fn))),d.set(c<.002?1:Math.max(.72,1-.16*c)),f.set(c>2.35?0:1)};"
          "return e(n.get()),n.on(`change`,e)},[n,t,r,a,o,u,d,f]")
SF_NEW = ("let e=e=>{let l=t-e,c=Math.abs(l),sg=r*ov+sp;a.set(l*sg),o.set(-c*160),"
          "u.set(Math.max(-48*rt,Math.min(48*rt,l*-40*rt))),"
          "d.set(c<.002?1:Math.max(1-.28*sk,1-.16*sk*c)),f.set(c>vi-.65?0:1),vof&&ly.set(-c*vof)};"
          "return e(n.get()),n.on(`change`,e)},[n,t,r,ov,sp,rt,sk,vi,vof,a,o,u,d,f,ly]")
# patch 13 called the spring config `n`, which shadows `n` - the progress motion value this
# component reads its depth from. Declaring it in the same block puts the earlier read in its
# temporal dead zone, so the spring gets its own name and the depth keeps reading the motion value.
EJ_OLD = "let n={type:`spring`,stiffness:520,damping:34,mass:.6};Ju(ly,s?-i*.11:0,n),"
EJ_NEW = ("let spg={type:`spring`,stiffness:520,damping:34,mass:.6};"
          "Ju(ly,s?-i*.11:-Math.abs(t-n.get())*vof,spg),Ju(d,s?1.05:1,spg),")
EJ_DROP = "Ju(ly,s?-i*.11:0,n),Ju(d,s?1.05:1,n)"

# --------------------------------------------------------------------- the wallet's two call sites
CALL_STACK_OLD = "(0,U.jsx)(__cwStack,{cards:e,cover:j.cover!==!1,theme:j.theme,custom:j.custom,tint:j.slateColor,"
CALL_STACK_NEW = "(0,U.jsx)(__cwStack,{cards:e,cover:j.cover!==!1,theme:j.theme,custom:__cwMrg(j.custom,`stack`),tint:j.slateColor,"
CALL_CAR_OLD = "(0,U.jsx)(Ed,{cards:e,cover:j.cover!==!1,theme:j.theme,custom:j.custom,tint:j.slateColor,"
CALL_CAR_NEW = "(0,U.jsx)(Ed,{cards:e,cover:j.cover!==!1,theme:j.theme,custom:__cwMrg(j.custom,`carousel`),tint:j.slateColor,"

EDITS = [
    (XU_OLD, XU_NEW, "defaults: two layout namespaces, each neutral"),
    (MERGE_OLD, MERGE_NEW, "__cwMrg: the view overlay in front of the loader"),
    (LOAD_OLD, LOAD_NEW, "loader: flat gap/size/fan folded into both namespaces once"),
    (XD_OLD, XD_NEW, "carousel geometry reads peek / pos / side"),
    (XD_TAIL_OLD, XD_TAIL_NEW, "carousel geometry publishes sideGap / posX / sideOp"),
    (SD_OLD, SD_NEW, "the geometry hook recomputes for the new fields"),
    (DD_OP_OLD, DD_OP_NEW, "carousel card gains an opacity value"),
    (DD_OLD, DD_NEW, "carousel card: lateral gap, horizontal bias, side dim"),
    (DD_STYLE_OLD, DD_STYLE_NEW, "carousel card: the side dim is what renders"),
    (SC_OLD, SC_NEW, "stack card reads its own six settings"),
    (SF_OLD, SF_NEW, "stack card: overlap, spacing, vertical step, shrink, rotation, visible"),
    (EJ_OLD, EJ_NEW, "stack eject rests back on the stacked offset, not on zero"),
    (CALL_STACK_OLD, CALL_STACK_NEW, "the stack view is handed custom.stack"),
    (CALL_CAR_OLD, CALL_CAR_NEW, "the carousel view is handed custom.carousel"),
]


def status(data):
    todo, done, bad = [], [], []
    for old, new, label in EDITS:
        if old in new and data.count(new) >= 1:
            done.append(label)                      # an insertion: only its output can prove it
        elif data.count(new) >= 1 and data.count(old) == 0:
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
        print("  (these spans are patch 20/21's output - run 7 -> 22 first)")
        raise SystemExit(1)
    print(f"clean ({len(EDITS)} anchors present)" if not done
          else f"applied ({len(done)}/{len(EDITS)} edits in place, {len(todo)} pending)")
    raise SystemExit(0)

if bad:
    raise SystemExit("refusing to write - stale anchors: " + ", ".join(bad))
if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    if old == new:
        raise SystemExit(f"{label}: the anchor and its replacement are identical - a truncated literal?")
    if data.count(old) != 1:
        raise SystemExit(f"anchor for {label} matched {data.count(old)} times")
    data = data.replace(old, new)
    if old not in new and old in data:
        raise SystemExit(f"{label}: the old shape is still in the bundle")
    print(f"ok    {label}")

# --- guards -----------------------------------------------------------------------------------
assert data.count("__cwMrg(") == 3, "the overlay must exist once and be used twice"
for f in ("sideGap:n*.56*pk", "posX:n*px", "sideOp:so", "i.sideGap", "i.posX", "i.posX||0"):
    assert f in data, f"carousel plumbing lost: {f}"
for f in ("ov=pc2.overlap==null?.7", "sp=pc2.spacing==null?0", "vof=pc2.vOff==null?0",
          "sk=pc2.shrink==null?1", "rt=pc2.rot==null?1", "vi=pc2.visible==null?3",
          "a.set(l*sg)", "Math.max(-48*rt,Math.min(48*rt,l*-40*rt))", "f.set(c>vi-.65?0:1)",
          "vof&&ly.set(-c*vof)"):
    assert f in data, f"stack plumbing lost: {f}"
assert "fn=pc2.stack" not in data, "the fan multiplier is still read as a number"
assert "carousel:{size:1,gap:20,side:1,peek:1,pos:0}" in data, "carousel defaults missing"
assert "stack:{size:1,gap:20,overlap:.7,spacing:0,vOff:0,shrink:1,rot:1,visible:3}" in data, "stack defaults missing"
assert data.count("stack:st||{size:sz") == 1, "loader migration not in place"
assert EJ_DROP not in data, "the eject still springs from the shadowed name"
assert "Ju(ly,s?-i*.11:-Math.abs(t-n.get())*vof,spg)" in data, "the eject rest offset is not wired"

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
        raise SystemExit("bundle does not parse:\n" + node.stderr[-1200:])
    print("ok    node --check on the generated bundle")

JS.write_text(data, encoding="utf-8")
print("app/index.js written - Stack and Carousel are independent configuration modes")
