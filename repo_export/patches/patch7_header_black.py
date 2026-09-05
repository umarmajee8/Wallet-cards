#!/usr/bin/env python3
"""Black header options for Card Wallet.

The header keeps its options but they are now drawn on a solid black chip with
white glyphs, instead of theme-coloured icons floating on the page:

  * header buttons  - black pill (#000), white icon, white 14% hairline so the
                      chip still reads on the dark theme's pure-black app bg;
                      the open menu's button lights up to #2f2f34.
  * dropdown sheet  - black panel (#0b0b0d) with white rows and a white hairline
                      (drop-shadow deepened so it still lifts off a black bg).
  * pressed rows     get the same active:opacity-70 feedback the rest of the app
                      uses.

The button component also gains a `text` prop (icon + label chip instead of an
icon circle); patch8 turns it on via header_options.json's `showText`.

Everything is done with inline styles on purpose: index.css is byte-compared
against the CSS entry inside the base APK by build_release_apk.py, so adding a
new class there would break the build pipeline. `sheet-bg` is therefore dropped
from the dropdown (inline background wins anyway, but leaving a class that
contradicts the inline value is confusing).

Run:  python3 repo_export/patches/patch7_header_black.py [--check]
"""
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")

CHECK = "--check" in __import__("sys").argv

# ---------------------------------------------------------------- header chips
OLD_BTN = (
    "g=({label:e,onClick:t,active:n,children:r})=>(0,U.jsx)(`button`,{\"aria-label\":e,onClick:t,"
    "className:`flex h-11 w-11 items-center justify-center rounded-full ink`,"
    "style:{background:n?`var(--chip)`:`transparent`},children:(0,U.jsx)(h,{children:r})})"
)
NEW_BTN = (
    "g=({label:e,onClick:t,active:n,text:a,children:r})=>(0,U.jsx)(`button`,{\"aria-label\":e,onClick:t,"
    "className:`flex h-11 items-center justify-center rounded-full active:opacity-70 ${a?``:`w-11`}`,"
    "style:{background:n?`#2f2f34`:`#000`,color:`#fff`,"
    "border:`1px solid rgba(255,255,255,0.14)`,boxShadow:`0 6px 16px -8px rgba(0,0,0,0.65)`,"
    "...(a?{padding:`0 12px`,gap:`6px`}:{})},"
    "children:(0,U.jsxs)(U.Fragment,{children:["
    "(0,U.jsx)(h,{children:r}),"
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

EDITS = [(OLD_BTN, NEW_BTN, "header chips"), (OLD_PANEL, NEW_PANEL, "menu panel"), (OLD_ROW, NEW_ROW, "menu rows")]

if CHECK:
    bad = [
        label
        for old, new, label in EDITS
        if not (data.count(old) == 1 or data.count(new) == 1)
    ]
    print("clean (all anchors present)" if not bad else "STALE ANCHORS: " + ", ".join(bad))
    raise SystemExit(1 if bad else 0)

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
