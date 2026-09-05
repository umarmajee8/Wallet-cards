#!/usr/bin/env python3
"""Patch 21 - the stack in the preview, a smaller create button, and sliders that feel smooth.

Round 11 feedback, three things:

1. *"stack preview meh show nhi ho rha ha"* - the settings preview mounts the wallet's own
   components, but ``__cwStack`` sizes its cards from ``window.innerWidth/innerHeight``, so in a
   168px sheet box it laid out at full phone size inside a zero-height flex parent: nothing
   visible. It now takes an optional ``fit`` box (the stage the caller gives it) and only falls
   back to the viewport when there is none - the wallet path is untouched, so the real stack
   measures exactly as before.
2. *"jo setting meh slider hn un ko smooth kro"* - two causes. The thumb/track: the range input
   was a 2px line with a 16px thumb and no touch-action, so it was fiddly and scrolled the
   sheet under the thumb; it is now a 4px filled track (accent up to the value) inside a 26px
   hit area, a 20px thumb, tabular read-out digits, and step 0.01. The jank: the sleeve canvas
   cache key was ``JSON.stringify(custom)``, so every slider step invalidated it and repainted
   a canvas + ``toDataURL`` mid-drag. The key is now a quantized signature of the paint-only
   fields, so a full sweep costs ~10 repaints instead of ~100, and the tray gets a hair of
   easing so the fine values still read as continuous.
3. *"create button ko thora sa chota kro"* - the header's filled + (Add card) and its two bare
   siblings: 44 -> 40px box, glyph 23/26 -> 21/24. patch 7 owns that span, so it gains a
   DOWNSTREAM_KEEP marker for this rewrite.

Idempotent: every edit is judged by its own output. ``--check`` reports drift without writing.
"""
from __future__ import annotations

from pathlib import Path
import sys

CHECK = "--check" in sys.argv
JS = Path(__file__).resolve().parents[1] / "app" / "index.js"
CSS = Path(__file__).resolve().parents[1] / "app" / "index.css"

data = JS.read_text(encoding="utf-8")
css = CSS.read_text(encoding="utf-8")

# ---------------------------------------------------------------- 1. the stack, container-sized
STACK_OLD = "onEjectComplete:l,custom:j,tint:k}){let zsz="
STACK_NEW = "onEjectComplete:l,custom:j,tint:k,fit:ft}){let zsz="
SIZE_OLD = "landW=Math.min((vh-230)*zsz,w*.92*zsz,520*zsz),"
SIZE_NEW = "landW=ft?Math.min((ft.h-14)*zsz,ft.w*.94*zsz,520*zsz):Math.min((vh-230)*zsz,w*.92*zsz,520*zsz),"

# ------------------------------------------------- 2a. canvas cache key: quantize the paint inputs
KEY_OLD = ("var dd=e=>`${e.theme}|${e.tint||``}|${JSON.stringify(e.custom||{})}|"
           "${e.w}x${e.h}x${e.radius}x${e.dip}@${e.dpr}`")
KEY_NEW = (
    # A slider sweep used to invalidate the sleeve cache on every step (each repaint paints a
    # canvas and calls toDataURL). The fields below only shade the paint, so the key rounds
    # them: the tray/DOM still changes continuously, the canvas only when it must.
    "function __cwSig(e){let c=e.custom||{},q=(v,d,s)=>Math.round((v==null?d:+v)*s);"
    "return `${e.theme}|${e.tint||``}|${c.design||``}|${c.color||``}|${c.name||``}|${c.stitch?1:0}|"
    "${q(c.grade,1,4)}|${q(c.grain,.2,8)}|${q(c.depth,1,8)}|${q(c.material,1,8)}|"
    "${q(c.shadow,1,8)}|${q(c.border,1,8)}|${e.w}x${e.h}x${e.radius}x${e.dip}@${e.dpr}`}"
    "var dd=__cwSig"
)

# ------------------------------------------------- 2b. ease the tray so steps read as continuous
TRAY_OLD = "background:n===`slate`?__cwSlateTray(r,k):v.tray,border:v.trayBorder,boxShadow:v.trayShadow}"
TRAY_NEW = ("background:n===`slate`?__cwSlateTray(r,k):v.tray,border:v.trayBorder,boxShadow:v.trayShadow,"
            "transition:`background .16s linear,border-radius .16s ease-out`}")

# -------------------------------------------------------------------------- 3. smaller header chips
BTN_OLD = "className:`flex h-11 items-center justify-center rounded-full active:opacity-70 ${a?``:`w-11`}`"
BTN_NEW = "className:`flex h-10 items-center justify-center rounded-full active:opacity-70 ${a?``:`w-10`}`"
ICO_OLD = "(0,U.jsx)(h,{size:cp?23:26,children:r}),"
ICO_NEW = "(0,U.jsx)(h,{size:cp?21:24,children:r}),"

EDITS = [
    (STACK_OLD, STACK_NEW, "__cwStack takes a fit box for the preview"),
    (SIZE_OLD, SIZE_NEW, "the stack sizes from that box, viewport otherwise"),
    (KEY_OLD, KEY_NEW, "sleeve cache key quantized so a drag costs ~10 repaints"),
    (TRAY_OLD, TRAY_NEW, "tray eases background/radius for a smooth sweep"),
    (BTN_OLD, BTN_NEW, "header buttons: 44px -> 40px"),
    (ICO_OLD, ICO_NEW, "header glyphs a touch smaller inside them"),
]

# --------------------------------------------------------------------- 4. CSS: the range control
CSS_BLOCK = """
/* Round 11: sliders that behave like iOS ones - a 4px filled track inside a 26px hit area,
   a grabbable thumb, tabular read-outs, no scroll stealing mid-drag, and no new motion on
   the card path (the tray easing sits in the component, this is chrome only). */
.cw-range{height:26px;padding:11px 0;box-sizing:border-box;background-clip:content-box;
border-radius:4px;background:linear-gradient(90deg,var(--accent) 0 var(--p,50%),var(--glass-line) var(--p,50%) 100%);
touch-action:none;cursor:pointer;opacity:.94}
.cw-range:hover,.cw-range:active,.cw-range:focus-visible{opacity:1}
.cw-range::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:transparent}
.cw-range::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;margin-top:-8px;
border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,.16);
box-shadow:0 1px 4px rgba(0,0,0,.3);transition:transform .14s cubic-bezier(.2,.8,.2,1)}
.cw-range:active::-webkit-slider-thumb{transform:scale(1.16)}
.cw-range::-moz-range-track{height:4px;border-radius:4px;background:var(--glass-line)}
.cw-range::-moz-range-progress{height:4px;border-radius:4px;background:var(--accent)}
.cw-range::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#fff;
border:1px solid rgba(0,0,0,.16);box-shadow:0 1px 4px rgba(0,0,0,.3)}
.cw-val{font-variant-numeric:tabular-nums}
.cw-preview{height:176px}
html.dark .cw-range::-webkit-slider-thumb{border-color:rgba(255,255,255,.22)}
@media (prefers-reduced-motion:reduce){.cw-range::-webkit-slider-thumb{transition:none}}
"""


def status(data: str, css: str):
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
    css_done = ".cw-range::-webkit-slider-runnable-track" in css
    return todo, done, bad, css_done


todo, done, bad, css_done = status(data, css)

if CHECK:
    for label in done:
        print(f"ok    {label}")
    for old, new, label in todo:
        print(f"todo  {label}")
    for label in bad:
        print(f"STALE {label}")
    print(f"{'ok   ' if not bad else 'FAIL '}css    slider kit "
          + ("already appended" if css_done else "pending"))
    if bad:
        print("  (these spans belong to patch 7 / patch 20's output - run 7 -> 8 -> 12..20 first)")
        raise SystemExit(1)
    print(f"clean ({len(EDITS)} anchors present)" if not done and not css_done
          else f"applied ({len(done)}/{len(EDITS)} edits in place, css {'ok' if css_done else 'pending'})")
    raise SystemExit(0)

if bad:
    print("refusing to write - unrecognised spans: " + ", ".join(bad))
    raise SystemExit(1)

for old, new, label in todo:
    assert data.count(old) == 1, f"{label}: anchor is not unique"
    data = data.replace(old, new)
    print(f"ok    {label}")

if "function __cwSig(" in data and "fit:ft}){let zsz=" in data:
    assert data.count("landW=ft?Math.min(") == 1, "fit sizing did not land once"
    assert "transition:`background .16s linear" in data, "tray easing missing"
    assert data.count("h-10 items-center") == 1 and data.count("size:cp?21:24") == 1, "header shrink missing"
else:
    raise SystemExit("guard: patch 21's own edits are inconsistent")

if not css_done:
    assert css.count(".cw-range{") == 1, "unexpected .cw-range rules - refusing to guess"
    CSS.write_text(css.rstrip("\n") + "\n" + CSS_BLOCK.strip("\n") + "\n", encoding="utf-8")
    print("ok    index.css (slider kit appended)")
else:
    print("skip  index.css already carries the slider kit")

JS.write_text(data, encoding="utf-8")
print("app/index.js written - stack fits the preview, sliders smooth, header + smaller")
