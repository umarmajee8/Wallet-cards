#!/usr/bin/env python3
"""Header look for Card Wallet: one filled black disc, the rest plain black ink.

Matching the reference picture: the add button is a solid black disc with a
white `+`, while search and the menu button are bare black glyphs on the page
(no chip behind them). So the button component grows three props instead of one
hard-coded style, and patch8 feeds them from header_options.json:

  chip  - true  -> filled disc: bg #000, white glyph, 14% white hairline so the
                   disc still reads on the dark theme's pure-black app bg, and a
                   soft halo while its menu is open
          false -> bare glyph: transparent, a subtle var(--chip) circle only
                   while its menu is open
  tone  - `black` (#000, what the picture shows) / `white` (#fff) /
           `ink` (var(--ink): black on the light theme, white on the dark one)
  size  - glyph size; disc glyphs stay at 23px, bare glyphs get 26px so the
           three options carry the same visual weight as in the picture

The dropdown stays a black panel (#0b0b0d) with white rows - "black" was asked
for the header options themselves, and inverting the sheet keeps the two states
consistent with each other. The destructive row keeps the app's red.

Note on `tone:black`: bare black glyphs go unreadable on the dark theme, whose
app background is #000 (and the default pouch is near-black too). The picture is
a light-theme design, so black is what ships here; flip an option to
"tone": "ink" in header_options.json for theme-following glyphs.

Everything is inline styles on purpose: index.css is byte-compared against the
CSS entry inside the base APK by build_release_apk.py, so adding a class there
would break the build pipeline. `sheet-bg` is dropped from the dropdown for the
same reason - the inline background wins anyway and leaving a contradicting
class is confusing.

Run:  python3 repo_export/patches/patch7_header_black.py [--check]
"""
from pathlib import Path

import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

# --------------------------------------------------------------- svg + button
OLD_H = "let h=({children:e})=>(0,U.jsx)(`svg`,{width:`23`,height:`23`,viewBox:`0 0 24 24`,fill:`none`,children:e})"
NEW_H = "let h=({children:e,size:sz=23})=>(0,U.jsx)(`svg`,{width:sz,height:sz,viewBox:`0 0 24 24`,fill:`none`,children:e})"

OLD_BTN = (
    "g=({label:e,onClick:t,active:n,children:r})=>(0,U.jsx)(`button`,{\"aria-label\":e,onClick:t,"
    "className:`flex h-11 w-11 items-center justify-center rounded-full ink`,"
    "style:{background:n?`var(--chip)`:`transparent`},children:(0,U.jsx)(h,{children:r})})"
)
# `text` (icon + label chip) is kept for header_options.json's showText.
NEW_BTN = (
    "g=({label:e,onClick:t,active:n,chip:cp,tone:tn,text:a,children:r})=>(0,U.jsx)(`button`,{\"aria-label\":e,onClick:t,"
    "className:`flex h-11 items-center justify-center rounded-full active:opacity-70 ${a?``:`w-11`}`,"
    "style:cp?"
    "{background:tn===`white`?`#fff`:`#000`,color:tn===`white`?`#000`:`#fff`,"
    "border:`1px solid rgba(255,255,255,0.14)`,"
    "boxShadow:n?`0 0 0 4px rgba(17,17,19,0.10)`:`0 6px 16px -8px rgba(0,0,0,0.65)`,"
    "...(a?{padding:`0 12px`,gap:`6px`}:{})}:"
    "{color:tn===`ink`?`var(--ink)`:tn===`white`?`#fff`:`#000`,"
    "border:`1px solid transparent`,"
    "background:n?`var(--chip)`:`transparent`,"
    "...(a?{padding:`0 12px`,gap:`6px`}:{})},"
    "children:(0,U.jsxs)(U.Fragment,{children:["
    "(0,U.jsx)(h,{size:cp?23:26,children:r}),"
    "a&&(0,U.jsx)(`span`,{style:{fontSize:`13.5px`,fontWeight:`600`,whiteSpace:`nowrap`},children:e})"
    "]})})"
)

# ----------------------------------------------------------------- menu panel
OLD_PANEL = (
    "(0,U.jsx)(`div`,{className:`ml-auto mt-1 w-[248px] overflow-hidden rounded-2xl sheet-bg py-1`,"
    "style:{border:`1px solid var(--line)`,boxShadow:`0 22px 46px -22px rgba(0,0,0,0.55)`},children:"
)
NEW_PANEL = (
    "(0,U.jsx)(`div`,{className:`ml-auto mt-1 w-[248px] overflow-hidden rounded-2xl py-1`,"
    "style:{background:`#0b0b0d`,border:`1px solid rgba(255,255,255,0.14)`,"
    "boxShadow:`0 22px 46px -22px rgba(0,0,0,0.75)`},children:"
)

# ------------------------------------------------------------------ menu rows
OLD_ROW = (
    "className:`flex w-full items-center gap-3 px-4 py-3 text-left text-[15.5px]`,"
    "style:{color:e.danger?`#ff453a`:`var(--ink)`}"
)
NEW_ROW = (
    "className:`flex w-full items-center gap-3 px-4 py-3 text-left text-[15.5px] active:opacity-70`,"
    "style:{color:e.danger?`#ff453a`:`#fff`}"
)

EDITS = [
    (OLD_H, NEW_H, "svg size prop"),
    (OLD_BTN, NEW_BTN, "header buttons"),
    (OLD_PANEL, NEW_PANEL, "menu panel"),
    (OLD_ROW, NEW_ROW, "menu rows"),
]

if CHECK:
    stale = [label for old, new, label in EDITS if not (data.count(old) == 1 or data.count(new) == 1)]
    print("clean (all anchors present)" if not stale else "STALE ANCHORS: " + ", ".join(stale))
    raise SystemExit(1 if stale else 0)

for old, new, label in EDITS:
    count = data.count(old)
    if count == 0 and data.count(new) == 1:
        print(f"skip  {label}: already applied")
        continue
    assert count == 1, f"{label}: expected 1 match, found {count}"
    data = data.replace(old, new)
    print(f"ok    {label}")

path.write_text(data, encoding="utf-8")
print("app/index.js written")
