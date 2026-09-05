#!/usr/bin/env python3
"""Header look for Card Wallet: one filled disc, the rest bare glyphs.

Matching the reference mock, the three options are drawn three different ways,
so the button component takes the look per option instead of hard-coding one,
and patch8 feeds it from header_options.json:

  chip  - true  -> filled disc; false -> bare glyph on the page, with a subtle
                   circle only while its menu is open
  tone  - `auto` (default, see below) / `black` / `white` / `ink`
  size  - glyph size: 23px inside a disc, 26px bare, so all three carry the same
                   visual weight as in the mock

Why `auto` is the default: the mock is a light-theme drawing, but the app has a
dark theme whose background is #000 (and the default pouch is near-black too).
A literal `#000` glyph on that is invisible - on device the dark theme showed the
`+` as a muddy circle and the search/menu glyphs not at all. So `auto` uses the
tokens the app already inverts for its own solid controls:

  token        light theme          dark theme
  --solid      #111113 (near-black) #fff        -> disc fill
  --on-solid   #fff                 #111113     -> disc glyph
  --ink        #111113              #f5f5f7     -> bare glyph
  --chip       #f2f2f5              #2c2c2e     -> active circle / halo
  --line       6% black             12% white   -> hairline

Net effect: black disc + white glyph on the light theme (what the mock shows, in
the app's own near-black rather than pure #000), inverted to a white disc + black
glyph on the dark theme. `black` / `white` are still there for a literal colour
that must not follow the theme; `ink` inverts the glyphs but keeps the disc black.

Everything is inline styles on purpose: index.css is byte-compared against the
CSS entry inside the base APK by build_release_apk.py, so adding a class there
would break the build pipeline. `sheet-bg` is dropped from the dropdown for the
same reason - the inline background wins anyway and leaving a contradicting class
is confusing. The dropdown itself stays a black panel with white rows (the
destructive row keeps the app's red) - that was an explicit choice, not an
oversight, so it does not invert.

Re-runnable: each edit lists the shapes it may find (stock bundle, or an earlier
version of this patch) and rewrites them to the current one, so upgrading the
look does not need a pristine checkout.

Run:  python3 repo_export/patches/patch7_header_black.py [--check]
"""
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

# ------------------------------------------------------------------ svg wrapper
OLD_H = "let h=({children:e})=>(0,U.jsx)(`svg`,{width:`23`,height:`23`,viewBox:`0 0 24 24`,fill:`none`,children:e})"
NEW_H = "let h=({children:e,size:sz=23})=>(0,U.jsx)(`svg`,{width:sz,height:sz,viewBox:`0 0 24 24`,fill:`none`,children:e})"

# ------------------------------------------------------------- header buttons
# v1 = the app as shipped; v2 = this patch when the colour was literal #000.
OLD_BTN_V1 = (
    "g=({label:e,onClick:t,active:n,children:r})=>(0,U.jsx)(`button`,{\"aria-label\":e,onClick:t,"
    "className:`flex h-11 w-11 items-center justify-center rounded-full ink`,"
    "style:{background:n?`var(--chip)`:`transparent`},children:(0,U.jsx)(h,{children:r})})"
)
OLD_BTN_V2 = (
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
# `text` (icon + label chip) is kept for header_options.json's showText.
NEW_BTN = (
    "g=({label:e,onClick:t,active:n,chip:cp,tone:tn,text:a,children:r})=>(0,U.jsx)(`button`,{\"aria-label\":e,onClick:t,"
    "className:`flex h-11 items-center justify-center rounded-full active:opacity-70 ${a?``:`w-11`}`,"
    "style:cp?"
    "{background:tn===`white`?`#fff`:tn===`black`?`#000`:`var(--solid)`,"
    "color:tn===`white`?`#000`:tn===`black`?`#fff`:`var(--on-solid)`,"
    "border:`1px solid ${tn===`black`||tn===`white`?`rgba(255,255,255,0.14)`:`var(--line)`}`,"
    "boxShadow:n?`0 0 0 4px ${tn===`black`?`rgba(17,17,19,0.10)`:`var(--chip)`}`:`0 6px 16px -8px rgba(0,0,0,0.65)`,"
    "...(a?{padding:`0 12px`,gap:`6px`}:{})}:"
    "{color:tn===`white`?`#fff`:tn===`black`?`#000`:`var(--ink)`,"
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

# (already-applied shapes to migrate from, target, label)
# The 4th field is a substring that only *this* patch writes, so the check still
# recognises "applied" after a later patch re-words the surrounding span (patch 11
# puts the menu's margin under a ternary, which would otherwise look like a stale
# anchor here even though patch 7's panel/row styling is fully in place).
EDITS = [
    ([OLD_H], NEW_H, "svg size prop", "size:cp?23:26"),
    ([OLD_BTN_V1, OLD_BTN_V2], NEW_BTN, "header buttons", "`var(--solid)`"),
    ([OLD_PANEL], NEW_PANEL, "menu panel", "background:`#0b0b0d`"),
    ([OLD_ROW], NEW_ROW, "menu rows", "color:e.danger?`#ff453a`:`#fff`"),
]


def find_anchor(data: str, olds: list[str], new: str, done: str | None = None) -> str | None:
    """The span to replace: the current output (already applied -> None) or the
    first older shape present exactly once."""
    if data.count(new) == 1 and all(data.count(o) == 0 for o in olds):
        return None
    if done and all(data.count(o) == 0 for o in olds) and done in data:
        return None  # applied, then re-worded by a later patch
    hits = [o for o in olds if data.count(o) == 1]
    if len(hits) != 1:
        raise AssertionError(f"expected exactly 1 of {len(olds) + 1} shapes, found {len(hits)}")
    return hits[0]


if CHECK:
    for olds, new, label, done in EDITS:
        try:
            find_anchor(data, olds, new, done)
            print(f"ok    {label}")
        except AssertionError as e:
            print(f"STALE {label}: {e}")
            raise SystemExit(1)
    print("clean (all anchors present)")
    raise SystemExit(0)

for olds, new, label, done in EDITS:
    anchor = find_anchor(data, olds, new, done)
    if anchor is None:
        print(f"skip  {label}: already applied")
        continue
    data = data.replace(anchor, new)
    print(f"ok    {label}{' (migrated from an earlier patch7)' if anchor != olds[0] else ''}")

path.write_text(data, encoding="utf-8")
print("app/index.js written")
