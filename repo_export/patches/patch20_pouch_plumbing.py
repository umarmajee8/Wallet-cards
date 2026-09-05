#!/usr/bin/env python3
"""Patch 20: every Custom Pouch control now really moves the wallet.

Patch 19 gave the sheet somewhere to write to; this is the half that *applies* it. The rule
throughout: the new fields are read where the app already reads its look, so there is no
second styling system to keep in sync and the live preview is painting the same way the
wallet is.

Geometry (one choke point - `xd()` computes the whole layout, `Sd()` subscribes to it):
  * `xd(k)` takes the pouch object and applies `size` to the pouch width, `gap` to the
    carousel's `slide` pitch and `radius` to `pouchRadius`/`cardRadius`. Everything else
    (card size, mouth, peek, stage height, snap distance, the sleeve canvas `radius`/`dip`)
    is derived from those, so one change moves the wallet and the preview together.
  * `Sd(k)` recomputes when any of `size/gap/radius` change (still on resize/orientation),
    so a slider is live without a reload. `Td` passes its `custom` prop in.
  * The stack has its own geometry (`landW`), so `size` is applied there too, and
    `__cwCoverCard` reads `stack` (fan), `gap` (spread) and `radius` for its transform and
    corners.

Theme (one choke point - `ad(theme, custom)` is what every surface asks for its look):
  * `__cwTune` scales the alpha inside `rgba(...)` of `trayBorder` (border), `trayShadow`,
    `sleeve.castShadow/shade/stitchShadow` and `sleeve.vignette` (shadow), `traySheen` and
    `sleeve.sheen` (material) and `sleeve.grain` inversely (Matte = more grain, less sheen).
    It returns the theme untouched when all three are neutral, and it never mutates the
    shared preset objects.
  * `rd` (the "Yours" theme) takes `depth` into its tray gradient, and the sleeve painter's
    Slate branch - which paints literals, not a theme object - now multiplies its cast
    shadow, sheen, grain, mouth-darkening and rim stroke by the same three factors, plus
    `depth` for the interior behind the card.
  * The carousel's Slate tray (`__cwSlateTray`) is the same string as before at defaults,
    now with `depth` applied, and `pd`'s Classic branch routes through `ad` so it is tuned
    like everything else.

`Xu`'s neutral defaults (patch 19) mean an existing install - whose stored `custom` has none
of these keys - renders byte-identically until a control is moved.

Run:  python3 repo_export/patches/patch20_pouch_plumbing.py [--check]
"""
from pathlib import Path
import sys

JS = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

HELPERS = """function __cwSc(s,f){return typeof s===`string`&&f!==1?s.replace(/rgba\\(([^,)]*),([^,)]*),([^,)]*),\\s*([\\d.]+)\\s*\\)/g,(e,r,g,b,a)=>`rgba(${r},${g},${b},${Math.min(1,(+a)*f).toFixed(3)})`):s}
function __cwTune(v,c){if(!v||!c)return v;let sh=c.shadow==null?1:+c.shadow,bd=c.border==null?1:+c.border,mt=c.material==null?1:+c.material;if(sh===1&&bd===1&&mt===1)return v;let o={...v,sleeve:{...v.sleeve}};
o.trayBorder=__cwSc(v.trayBorder,bd);o.trayShadow=__cwSc(v.trayShadow,sh);o.traySheen=__cwSc(v.traySheen,mt);
let sl=v.sleeve||{};o.sleeve.sheen=__cwSc(sl.sheen,mt);o.sleeve.shade=__cwSc(sl.shade,sh);o.sleeve.castShadow=__cwSc(sl.castShadow,sh);
o.sleeve.stitchShadow=__cwSc(sl.stitchShadow,sh);o.sleeve.grain=Math.max(0,Math.min(1,(sl.grain==null?.2:+sl.grain)*(2-mt)));
o.sleeve.vignette=Math.max(0,(sl.vignette==null?.2:+sl.vignette)*sh);return o}
function __cwSlateTray(c,k){let d=c&&c.depth!=null?+c.depth:1,col=(c&&c.color)||k||`#5c6574`;return `linear-gradient(180deg, ${td(col,.72*d)} 0%, ${td(col,.48*d)} 100%)`}
""".replace("\n", "")

E1_OLD = "function rd(e){let t=nd(e.color)>.62;"
E1_NEW = HELPERS + "function rd(e){let t=nd(e.color)>.62,dp=e.depth==null?1:+e.depth;"

E2_OLD = ("tray:t?`linear-gradient(180deg, ${td(e.color,.96)} 0%, ${td(e.color,.86)} 45%, ${td(e.color,.76)} 100%)`"
          ":`linear-gradient(180deg, ${td(e.color,.62)} 0%, ${td(e.color,.4)} 45%, ${td(e.color,.24)} 100%)`")
E2_NEW = ("tray:t?`linear-gradient(180deg, ${td(e.color,.96*dp)} 0%, ${td(e.color,.86*dp)} 45%, ${td(e.color,.76*dp)} 100%)`"
          ":`linear-gradient(180deg, ${td(e.color,.62*dp)} 0%, ${td(e.color,.4*dp)} 45%, ${td(e.color,.24*dp)} 100%)`")

E3_OLD = ("ad=(e,t)=>e===`custom`&&t?rd(t):e===`steel`?__cwSteelTheme:e===`emerald`?__cwEmeraldTheme:"
          "e===`slate`?__cwSlateTheme:Yu")
E3_NEW = ("ad=(e,t)=>__cwTune(e===`custom`&&t?rd(t):e===`steel`?__cwSteelTheme:e===`emerald`?__cwEmeraldTheme:"
          "e===`slate`?__cwSlateTheme:Yu,t)")

E4_OLD = ("background:n===`slate`?`linear-gradient(180deg, ${td((r&&r.color)||k||`#5c6574`,.72)} 0%, "
          "${td((r&&r.color)||k||`#5c6574`,.48)} 100%)`:v.tray")
E4_NEW = "background:n===`slate`?__cwSlateTray(r,k):v.tray"

E5_OLD = ("rd({color:(e.custom&&e.custom.color)||e.tint||`#5c6574`,grain:e.custom&&e.custom.grain!=null?"
          "+e.custom.grain:.2,stitch:!!(e.custom&&e.custom.stitch)})")
E5_NEW = "ad(`custom`,{...Xu,...e.custom})"

E6a_OLD = ("if((e.custom&&e.custom.design)!==`classic`){let z=(e.custom&&e.custom.color)||e.tint||`#5c6574`,"
           "gr=e.custom&&e.custom.grain!=null?+e.custom.grain:.2,gd=e.custom&&e.custom.grade!=null?+e.custom.grade:1;")
E6a_NEW = ("if((e.custom&&e.custom.design)!==`classic`){let z=(e.custom&&e.custom.color)||e.tint||`#5c6574`,"
           "gr=e.custom&&e.custom.grain!=null?+e.custom.grain:.2,gd=e.custom&&e.custom.grade!=null?+e.custom.grade:1,"
           "dp=e.custom&&e.custom.depth!=null?+e.custom.depth:1,"
           "mm=e.custom&&e.custom.material!=null?+e.custom.material:1,"
           "sm=e.custom&&e.custom.shadow!=null?+e.custom.shadow:1,"
           "bt=e.custom&&e.custom.border!=null?+e.custom.border:1;")
E6b_OLD = "d.save(),d.shadowColor=`rgba(0,0,0,0.48)`,d.shadowBlur=l*1.45,d.shadowOffsetY=l*.18,udSlate(d,r,i,a,o,0),d.fillStyle=td(z,.58),d.fill()"
E6b_NEW = "d.save(),d.shadowColor=`rgba(0,0,0,${(0.48*sm).toFixed(3)})`,d.shadowBlur=l*1.45,d.shadowOffsetY=l*.18,udSlate(d,r,i,a,o,0),d.fillStyle=td(z,.58*dp),d.fill()"
E6c_OLD = "n.addColorStop(0,`rgba(255,255,255,0.18)`),n.addColorStop(.5,`rgba(255,255,255,0)`)"
E6c_NEW = "n.addColorStop(0,`rgba(255,255,255,${(0.18*mm).toFixed(3)})`),n.addColorStop(.5,`rgba(255,255,255,0)`)"
E6d_OLD = "d.globalAlpha=Math.min(.85,gr),d.globalCompositeOperation=`overlay`"
E6d_NEW = "d.globalAlpha=Math.min(.85,gr*mm),d.globalCompositeOperation=`overlay`"
E6e_OLD = "p.addColorStop(0,`rgba(0,0,0,0.16)`),p.addColorStop(1,`rgba(0,0,0,0)`)"
E6e_NEW = "p.addColorStop(0,`rgba(0,0,0,${(0.16*sm).toFixed(3)})`),p.addColorStop(1,`rgba(0,0,0,0)`)"
E6f_OLD = "udSlate(d,r,i,a,o,.7),d.strokeStyle=`rgba(255,255,255,0.26)`,d.lineWidth=1.25"
E6f_NEW = "udSlate(d,r,i,a,o,.7),d.strokeStyle=`rgba(255,255,255,${(0.26*bt).toFixed(3)})`,d.lineWidth=1.25"

E7a_OLD = ("function xd(){let e=typeof window>`u`?390:window.innerWidth,t=typeof window>`u`?844:window.innerHeight,"
           "n=Math.min(360,e*.85),r=n*bd.pouchH,i=n*bd.cardW,a=n*bd.cardH,o=n*bd.cardTop,s=n*bd.mouth,c=s-o,l=r,"
           "u=Math.min(1,Math.max(.7,(t-240)/l));return{vw:e,vh:t,pouchW:n,pouchH:r,cardW:i,cardH:a,cardTop:o,"
           "mouth:s,frontH:r-s,peek:c,inside:a-c,pouchRadius:n*bd.pouchRadius,cardRadius:n*bd.cardRadius,"
           "stageH:l,slide:n*u+20,scale:u}}")
E7a_NEW = ("function xd(k){let g=k||{},sz=g.size==null?1:+g.size,gp=g.gap==null?20:+g.gap,rd=g.radius==null?1:+g.radius,"
           "e=typeof window>`u`?390:window.innerWidth,t=typeof window>`u`?844:window.innerHeight,"
           "n=Math.min(360*sz,e*.85*sz),r=n*bd.pouchH,i=n*bd.cardW,a=n*bd.cardH,o=n*bd.cardTop,s=n*bd.mouth,c=s-o,l=r,"
           "u=Math.min(1,Math.max(.7,(t-240)/l));return{vw:e,vh:t,pouchW:n,pouchH:r,cardW:i,cardH:a,cardTop:o,"
           "mouth:s,frontH:r-s,peek:c,inside:a-c,pouchRadius:n*bd.pouchRadius*rd,cardRadius:n*bd.cardRadius*rd,"
           "stageH:l,slide:n*u+gp,scale:u}}")
E7b_OLD = ("function Sd(){let[e,t]=(0,x.useState)(xd);return(0,x.useEffect)(()=>{let e=0,n=()=>{cancelAnimationFrame(e),"
           "e=requestAnimationFrame(()=>t(xd()))};return window.addEventListener(`resize`,n),"
           "window.addEventListener(`orientationchange`,n),()=>{cancelAnimationFrame(e),"
           "window.removeEventListener(`resize`,n),window.removeEventListener(`orientationchange`,n)}},[]),e}")
E7b_NEW = ("function Sd(k){let g=(0,x.useRef)(k);g.current=k;let[e,t]=(0,x.useState)(()=>xd(k));"
           "(0,x.useEffect)(()=>{t(xd(g.current))},[k&&k.size,k&&k.gap,k&&k.radius]);"
           "return(0,x.useEffect)(()=>{let e=0,n=()=>{cancelAnimationFrame(e),"
           "e=requestAnimationFrame(()=>t(xd(g.current)))};return window.addEventListener(`resize`,n),"
           "window.addEventListener(`orientationchange`,n),()=>{cancelAnimationFrame(e),"
           "window.removeEventListener(`resize`,n),window.removeEventListener(`orientationchange`,n)}},[]),e}")
E7c_OLD = "function Td({cards:e,cover:cv=!0,theme:t,custom:n,tint:k,index:r,onIndexChange:i,onOpen:a,onLongPress:o,ejectedId:s,hiddenId:c,onEjectComplete:l}){let u=Sd()"
E7c_NEW = E7c_OLD.replace("{let u=Sd()", "{let u=Sd(n)")

E8_OLD = "tint:k}){let N=e.length,p=wu(r),"
E8_NEW = "tint:k}){let zsz=j&&j.size!=null?+j.size:1,N=e.length,p=wu(r),"
E8b_OLD = "landW=Math.min(vh-230,w*.92,520)"
E8b_NEW = "landW=Math.min((vh-230)*zsz,w*.92*zsz,520*zsz)"

E9a_OLD = "col=e.color||(j&&j.color)||k||`#3d3f46`;"
E9a_NEW = ("col=e.color||(j&&j.color)||k||`#3d3f46`,"
           "pc2=j||{},rd=pc2.radius==null?1:+pc2.radius,fn=pc2.stack==null?1:+pc2.stack,"
           "gp=pc2.gap==null?20:+pc2.gap,sh=pc2.shadow==null?1:+pc2.shadow;")
E9b_OLD = "a.set(l*r*.7),o.set(-c*160),u.set(Math.max(-48,Math.min(48,l*-40)))"
E9b_NEW = "a.set(l*r*(.7+(gp-20)/120)*fn),o.set(-c*160*fn),u.set(Math.max(-48,Math.min(48,l*-40*fn)))"
E9c_OLD = "style:{inset:0,borderRadius:16,background:`#09090b`}"
E9c_NEW = "style:{inset:0,borderRadius:16*rd,background:`#09090b`}"
E9d_OLD = "top:`10%`,bottom:0,borderRadius:16,"
E9d_NEW = "top:`10%`,bottom:0,borderRadius:16*rd,"
E9e_OLD = "boxShadow:`0 12px 28px -6px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.20)`"
E9e_NEW = "boxShadow:`0 12px 28px -6px rgba(0,0,0,${(0.55*sh).toFixed(2)}), inset 0 1px 0 rgba(255,255,255,0.20)`"

E10a_OLD = "boxShadow:`0 10px 20px -10px rgba(0,0,0,0.6)`"
E10a_NEW = "boxShadow:`0 10px 20px -10px rgba(0,0,0,${(0.6*(r&&r.shadow!=null?+r.shadow:1)).toFixed(2)})`"
E10b_OLD = "boxShadow:`0 30px 55px -18px rgba(0,0,0,0.65)`"
E10b_NEW = "boxShadow:`0 30px 55px -18px rgba(0,0,0,${(0.65*(r&&r.shadow!=null?+r.shadow:1)).toFixed(2)})`"

EDITS = [
    (E1_OLD, E1_NEW, "helpers: alpha scaler, theme post-processor, slate tray builder"),
    (E2_OLD, E2_NEW, "tray gradient follows Background (depth)"),
    (E3_OLD, E3_NEW, "ad() tunes every theme the wallet asks for"),
    (E4_OLD, E4_NEW, "carousel Slate tray goes through the builder"),
    (E5_OLD, E5_NEW, "the Classic sleeve paints from the tuned custom theme"),
    (E6a_OLD, E6a_NEW, "sleeve painter picks up depth/material/shadow/border"),
    (E6b_OLD, E6b_NEW, "sleeve: cast shadow and interior follow shadow/depth"),
    (E6c_OLD, E6c_NEW, "sleeve: sheen follows material"),
    (E6d_OLD, E6d_NEW, "sleeve: grain texture follows material"),
    (E6e_OLD, E6e_NEW, "sleeve: the mouth darkening follows shadow"),
    (E6f_OLD, E6f_NEW, "sleeve: the rim stroke follows border"),
    (E7a_OLD, E7a_NEW, "geometry: size, spacing and radius applied"),
    (E7b_OLD, E7b_NEW, "geometry hook recomputes when they change"),
    (E7c_OLD, E7c_NEW, "carousel passes its custom object into geometry"),
    (E8_OLD, E8_NEW, "stack: size factor in scope"),
    (E8b_OLD, E8b_NEW, "stack: card box scales with size"),
    (E9a_OLD, E9a_NEW, "stack card: radius/fan/spacing/shadow in scope"),
    (E9b_OLD, E9b_NEW, "stack card: fan and spread applied"),
    (E9c_OLD, E9c_NEW, "stack card: corner radius applied"),
    (E9d_OLD, E9d_NEW, "stack cover: corner radius applied"),
    (E9e_OLD, E9e_NEW, "stack cover: shadow strength applied"),
    (E10a_OLD, E10a_NEW, "carousel card: near shadow follows the slider"),
    (E10b_OLD, E10b_NEW, "carousel card: cast shadow follows the slider"),
]


# Patch 21 lets __cwStack size itself from a box its caller passes (that is how the settings
# preview shows the stack at all) and adds one line of easing to the tray. Both rewrite spans
# this patch owns, while keeping the size/radius/depth scaling - so the successor's text is the
# proof this patch still stands.
DOWNSTREAM_KEEP = {
    "stack: size factor in scope": "landW=ft?Math.min((ft.h-14)*zsz",
    "stack: card box scales with size": "ft.w*.94*zsz,520*zsz",
}


def status(data):
    todo, done, bad = [], [], []
    for old, new, label in EDITS:
        if old in new and data.count(new) >= 1:
            done.append(label)
        elif data.count(old) == 1 and data.count(new) == 0:
            todo.append((old, new, label))     # insertions/edits may legitimately match >1
        elif data.count(new) >= 1 or (DOWNSTREAM_KEEP.get(label) or "") in data:
            done.append(label)
        else:
            bad.append(label)
    return todo, done, bad


todo, done, bad = status(data)

if CHECK:
    if bad:
        print("STALE ANCHORS: " + ", ".join(bad))
        print("  (patch 19 owns the sheet, patch 17 the cover panel; run 7 -> 19 first)")
        raise SystemExit(1)
    print("clean (all %d anchors present)" % len(EDITS) if len(todo) == len(EDITS)
          else f"applied ({len(done)}/{len(EDITS)} edits in place, {len(todo)} pending)")
    raise SystemExit(0)

if bad:
    raise SystemExit("refusing to write - stale anchors: " + ", ".join(bad)
                     + "\n  (run patches 7 -> 19 before this one)")
if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    data = data.replace(old, new)
    print(f"ok    {label}")

# --- guards -------------------------------------------------------------------
assert data.count("function __cwTune(") == 1 and data.count("function __cwSlateTray(") == 1
assert data.count("function __cwSc(") == 1, "the alpha scaler must exist once"
assert data.count("ad=(e,t)=>__cwTune(") == 1, "ad() is not the tuned one"
assert "background:n===`slate`?__cwSlateTray(r,k):v.tray" in data, "the carousel tray bypasses the builder"
assert "${td((r&&r.color)||k||`#5c6574`,.72)}" not in data, "the old inline tray gradient survived"
assert "dp=e.depth==null?1:+e.depth" in data and "${td(e.color,.96*dp)}" in data, "rd ignores depth"
assert "ad(`custom`,{...Xu,...e.custom})" in data, "the classic branch still paints untuned"
assert "0.48*sm" in data and "0.18*mm" in data and "gr*mm" in data and "0.26*bt" in data, "the sleeve painter is untouched"
assert "function xd(k){" in data and "slide:n*u+gp" in data and "pouchRadius:n*bd.pouchRadius*rd" in data
assert "function Sd(k){" in data and "u=Sd(n)" in data, "geometry is not settings-driven"
assert "zsz=j&&j.size!=null" in data and "landW=Math.min((vh-230)*zsz" in data, "the stack ignores size"
assert "a.set(l*r*(.7+(gp-20)/120)*fn)" in data, "the stack ignores fan/spacing"
assert data.count("borderRadius:16*rd") == 2, "the stack corners are not driven"
assert "(0.55*sh).toFixed(2)" in data and "(0.6*(r&&r.shadow!=null?+r.shadow:1))" in data, "shadow is not applied"
# nothing may regress the round-9 promises
cov = data.split("function __cwCoverCard")[1].split("function Td")[0]
assert "backdropFilter:`none`" in cov and "td(col,1.18)" in cov, "the flat coloured cover regressed"
assert "Qp={autoDetect:!1,nfc:!1,appearance:`light`" in data, "the round-9 defaults regressed"

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
        err = node.stderr.strip().splitlines()
        raise SystemExit("bundle does not parse:\n" + "\n".join(err[-3:]))

JS.write_text(data, encoding="utf-8")
print("app/index.js written - pouch settings drive geometry, the theme and the sleeve painter")
