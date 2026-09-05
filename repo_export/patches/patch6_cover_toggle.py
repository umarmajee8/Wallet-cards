#!/usr/bin/env python3
"""Add a "Wallet & cover" on/off switch to Settings.

When the switch is off:
  * Carousel  - the pouch (tray + leather sleeve) is not drawn, the card is
                centred in the same stage box so nothing else shifts.
  * Stack     - the frosted glass cover is not drawn; the open-card hand-off
                that the cover animation used to trigger is fired directly.
  * Both      - the card title stops being hard-coded white and follows the
                theme instead (var(--ink): black on the light theme, white on
                the dark one), and its dark text-shadow is dropped.

The setting lives in `wallet.settings.v1` as `cover` (default true), so
existing installs keep the pouch until the user turns it off.
"""
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")


def sub(old: str, new: str, label: str) -> None:
    global data
    count = data.count(old)
    assert count == 1, f"{label}: expected 1 match, found {count}"
    data = data.replace(old, new, 1)
    print(f"  ok  {label}")


if "cover:!0" in data and "Wallet & cover" in data:
    raise SystemExit("patch6 already applied")

print("patch6: wallet & cover toggle")

# ---------------------------------------------------------------------------
# 1. Default setting: cover on.
# ---------------------------------------------------------------------------
sub(
    "Qp={autoDetect:!1,nfc:!0,appearance:`system`,theme:`slate`,custom:Xu,"
    "slateColor:`#5c6574`,view:`carousel`}",
    "Qp={autoDetect:!1,nfc:!0,appearance:`system`,theme:`slate`,custom:Xu,"
    "slateColor:`#5c6574`,view:`carousel`,cover:!0}",
    "settings defaults",
)

# ---------------------------------------------------------------------------
# 2. Settings UI: toggle row under the "Pouch" heading, and the pouch
#    customisation controls only make sense while the cover is on.
# ---------------------------------------------------------------------------
pouch_heading = (
    "(0,U.jsx)(`div`,{className:`pb-2 text-[13px] font-medium uppercase "
    "tracking-[0.12em] sub`,children:`Pouch`}),"
)
toggle_row = (
    "(0,U.jsxs)(`div`,{className:`mb-4 flex items-center justify-between rounded-2xl px-4 py-3`,"
    "style:{background:`var(--raised)`,border:`1px solid var(--line)`},children:["
    "(0,U.jsxs)(`span`,{className:`min-w-0 flex-1 pr-3 text-left`,children:["
    "(0,U.jsx)(`span`,{className:`block text-[15px] font-semibold ink`,children:`Wallet & cover`}),"
    "(0,U.jsx)(`span`,{className:`mt-0.5 block text-[12.5px] leading-snug sub`,"
    "children:t.cover===!1"
    "?`Off · plain cards in Carousel and Stack`"
    ":`On · pouch in Carousel, cover in Stack`})"
    "]}),"
    "(0,U.jsx)(Mp,{on:t.cover!==!1,onChange:e=>{n({cover:e}),navigator.vibrate&&navigator.vibrate(6)}})"
    "]}),"
    "...(t.cover===!1?[]:["
)
sub(pouch_heading, pouch_heading + toggle_row, "settings: toggle row")

sub(
    "stitch:e},theme:`slate`})})]})]}),",
    "stitch:e},theme:`slate`})})]})])]}),",
    "settings: close conditional pouch controls",
)

# ---------------------------------------------------------------------------
# 3. Thread the flag from the app root into both layouts.
# ---------------------------------------------------------------------------
for comp in ("__cwStack", "Ed"):
    sub(
        f"(0,U.jsx)({comp},{{cards:e,theme:j.theme,custom:j.custom,tint:j.slateColor,",
        f"(0,U.jsx)({comp},{{cards:e,cover:j.cover!==!1,theme:j.theme,custom:j.custom,tint:j.slateColor,",
        f"app root -> {comp}",
    )

# ---------------------------------------------------------------------------
# 4. Carousel: Td -> Dd -> Q(yd)
# ---------------------------------------------------------------------------
sub(
    "function Td({cards:e,theme:t,custom:n,tint:k,index:r,",
    "function Td({cards:e,cover:cv=!0,theme:t,custom:n,tint:k,index:r,",
    "carousel Td signature",
)
sub(
    "(0,U.jsx)(Dd,{offset:e,x:d,geo:u,card:r,theme:t,custom:n,tint:k,",
    "(0,U.jsx)(Dd,{offset:e,x:d,geo:u,card:r,cover:cv,theme:t,custom:n,tint:k,",
    "carousel Td -> Dd",
)
sub(
    "Dd=(0,x.memo)(function({theme:e,custom:t,tint:y,offset:n,x:r,geo:i,card:a,",
    "Dd=(0,x.memo)(function({cover:cv=!0,theme:e,custom:t,tint:y,offset:n,x:r,geo:i,card:a,",
    "carousel Dd signature",
)
sub(
    "(0,U.jsx)(Q,{card:a,geo:i,theme:e,custom:t,tint:y,isActive:o,",
    "(0,U.jsx)(Q,{card:a,geo:i,cover:cv,theme:e,custom:t,tint:y,isActive:o,",
    "carousel Dd -> pouch card",
)
sub(
    "{marginTop:8,textAlign:`center`,color:`rgba(255,255,255,0.94)`,fontSize:13,"
    "fontWeight:650,letterSpacing:`.01em`,whiteSpace:`nowrap`,overflow:`hidden`,"
    "textOverflow:`ellipsis`,textShadow:`0 1px 8px rgba(0,0,0,.65)`,padding:`0 8px`}",
    "{marginTop:8,textAlign:`center`,color:cv?`rgba(255,255,255,0.94)`:`var(--ink)`,fontSize:13,"
    "fontWeight:650,letterSpacing:`.01em`,whiteSpace:`nowrap`,overflow:`hidden`,"
    "textOverflow:`ellipsis`,textShadow:cv?`0 1px 8px rgba(0,0,0,.65)`:`none`,padding:`0 8px`}",
    "carousel title colour follows the theme",
)
sub(
    "e.card.title===t.card.title&&e.theme===t.theme",
    "e.card.title===t.card.title&&e.cover===t.cover&&e.theme===t.theme",
    "pouch card memo comparator",
)
sub(
    "(e,t)=>e.offset===t.offset&&e.geo===t.geo&&e.theme===t.theme",
    "(e,t)=>e.offset===t.offset&&e.cover===t.cover&&e.geo===t.geo&&e.theme===t.theme",
    "carousel slide memo comparator",
)

# ---------------------------------------------------------------------------
# 5. Carousel card component: drop the tray + sleeve, centre the card.
# ---------------------------------------------------------------------------
sub(
    "function yd({card:e,geo:t,theme:n,custom:r,tint:k,isActive:i,",
    "function yd({card:e,geo:t,cover:cv=!0,theme:n,custom:r,tint:k,isActive:i,",
    "yd signature",
)
sub(
    "children:[(0,U.jsx)(`div`,{className:`absolute left-0 w-full overflow-hidden`,"
    "style:{top:0,height:t.pouchH,",
    "children:[cv&&(0,U.jsx)(`div`,{className:`absolute left-0 w-full overflow-hidden`,"
    "style:{top:0,height:t.pouchH,",
    "yd: pouch tray only when cover is on",
)
sub(
    "style:{top:t.cardTop,left:(t.pouchW-t.cardW)/2,",
    "style:{top:cv?t.cardTop:Math.max(0,(t.stageH-t.cardH)/2),left:(t.pouchW-t.cardW)/2,",
    "yd: centre the card when the pouch is hidden",
)
sub(
    "_?(0,U.jsx)(`img`,{src:_.url,alt:``,",
    "cv?_?(0,U.jsx)(`img`,{src:_.url,alt:``,",
    "yd: sleeve only when cover is on",
)
sub(
    "style:{top:t.mouth,height:t.frontH,borderRadius:t.pouchRadius,background:v.sleeve.deep}})]})}",
    "style:{top:t.mouth,height:t.frontH,borderRadius:t.pouchRadius,background:v.sleeve.deep}}):null]})}",
    "yd: sleeve fallback only when cover is on",
)

# ---------------------------------------------------------------------------
# 6. Stack: __cwStack -> __cwCoverCard
# ---------------------------------------------------------------------------
sub(
    "function __cwStack({cards:e,index:r,",
    "function __cwStack({cards:e,cover:cv=!0,index:r,",
    "stack signature",
)
sub(
    "(0,U.jsx)(__cwCoverCard,{card:n,i:r,p:p,cw:cw,ch:ch,",
    "(0,U.jsx)(__cwCoverCard,{card:n,i:r,p:p,cw:cw,ch:ch,cover:cv,",
    "stack -> cover card",
)
sub(
    "function __cwCoverCard({card:e,i:t,p:n,cw:r,ch:i,ejected:s,",
    "function __cwCoverCard({card:e,i:t,p:n,cw:r,ch:i,cover:cv=!0,ejected:s,",
    "cover card signature",
)
# Without the cover there is no cover animation to report completion, so the
# open-card hand-off has to be fired directly.
sub(
    "},[n,t,r,a,o,u,d,f]),(0,U.jsxs)(X.div,{className:`absolute no-select`",
    "},[n,t,r,a,o,u,d,f]),(0,x.useEffect)(()=>{if(cv||!s||!w)return;"
    "let e=window.setTimeout(()=>w(),140);return()=>window.clearTimeout(e)},[cv,s]),"
    "(0,U.jsxs)(X.div,{className:`absolute no-select`",
    "cover card: open hand-off when the cover is hidden",
)
sub(
    "(0,U.jsx)(X.div,{style:{position:`absolute`,left:0,right:0,top:`10%`,bottom:0,",
    "cv&&(0,U.jsx)(X.div,{style:{position:`absolute`,left:0,right:0,top:`10%`,bottom:0,",
    "cover card: glass cover only when cover is on",
)
sub(
    "top:`100%`,marginTop:10,textAlign:`center`,color:`rgba(255,255,255,0.94)`,fontSize:13,"
    "fontWeight:650,letterSpacing:`.01em`,whiteSpace:`nowrap`,overflow:`hidden`,"
    "textOverflow:`ellipsis`,textShadow:`0 1px 8px rgba(0,0,0,.65)`,padding:`0 6px`}",
    "top:`100%`,marginTop:10,textAlign:`center`,color:cv?`rgba(255,255,255,0.94)`:`var(--ink)`,fontSize:13,"
    "fontWeight:650,letterSpacing:`.01em`,whiteSpace:`nowrap`,overflow:`hidden`,"
    "textOverflow:`ellipsis`,textShadow:cv?`0 1px 8px rgba(0,0,0,.65)`:`none`,padding:`0 6px`}",
    "stack title colour follows the theme",
)

path.write_text(data, encoding="utf-8")
print(f"patch6 applied -> {path} ({len(data)} bytes)")
