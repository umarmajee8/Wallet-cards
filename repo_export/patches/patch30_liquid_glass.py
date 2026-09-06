#!/usr/bin/env python3
"""patch 30 - wire the tiered Liquid Glass material onto the surfaces it was scoped to.

Round 15 of the same engagement: "premium Apple-inspired Liquid Glass, but not everywhere". The
material itself lives in app/index.css (tokens + tiers, no JS needed for sliders, chips, swatches or
rows - they are styled by .cw-range/.cw-chip/.cw-dot/.cw-card). This patch only does the part CSS
cannot do on its own: put the tier classes on the right elements, and move the create disc's inline
fill onto the glass token so a translucent-but-legible material replaces the flat solid disc.

Six edits, each asserted to match exactly once:

1  the bottom-sheet panel      `cw-glass-sheet` -> also `cw-lg-primary` (tier 1: real blur)
                               plus a 0.92 -> 1 opacity cross-fade on the material as it springs in.
2  g() button class            chip -> `cw-lg-fab`, everything else -> `cw-lg-btn`.
3  g() chip fill               var(--solid)/#000/#fff -> var(--lg-solid-glass)/var(--lg-glass-black)/
                               var(--lg-glass-white): the same colours at glass alpha, still themed tokens (a theme
                               flip re-colours them - the round-13 header contract is only widened, not dropped), and the
                               drop shadow gains an inner top highlight (the specular edge).
4  g() secondary button        resting stays transparent; the active state becomes glass (tint-3 +
                               a hair rim) instead of the flat --chip fill.
5  the Custom Pouch container  `cw-card` -> `cw-card cw-lg-pouch` (a recessed tray, not a floating card).
6  the live-preview frame      `cw-preview` -> `cw-preview cw-lg-preview` (glass frame; the deck inside
                               keeps full opacity - the brief is explicit that the cards stay dominant).

Deliberately NOT touched: the wallet's own cards and the stack cover (round 9's flat-colour cover,
round 18's "no blur on the cover"), the header bar, and the toasts. `liquid_glass_audit.py` fails if
a blur tier ever appears on the deck path.

Usage:  python3 repo_export/patches/patch30_liquid_glass.py [--check]
"""
from __future__ import annotations
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app/index.js"
CODE = APP.read_text(encoding="utf-8")

SHEET_OLD = "className:`no-select rounded-t-[26px] cw-glass-sheet`,initial:{y:`100%`},animate:{y:0},exit:{y:`100%`}"
SHEET_NEW = ("className:`no-select rounded-t-[26px] cw-glass-sheet cw-lg-primary`,"
             "initial:{y:`100%`,opacity:.92},animate:{y:0,opacity:1},exit:{y:`100%`,opacity:.92}")

CLS_OLD = "className:`flex h-9 items-center justify-center rounded-full active:opacity-70 ${a?``:`w-9`}`"
CLS_NEW = ("className:`flex h-9 items-center justify-center rounded-full active:opacity-70 "
           "${cp?`cw-lg-fab`:`cw-lg-btn`} ${a?``:`w-9`}`")

FAB_OLD = ("style:cp?{background:tn===`white`?`#fff`:tn===`black`?`#000`:`var(--solid)`,"
           "color:tn===`white`?`#000`:tn===`black`?`#fff`:`var(--on-solid)`,")
FAB_NEW = ("style:cp?{background:tn===`white`?`var(--lg-glass-white)`:tn===`black`?"
           "`var(--lg-glass-black)`:`var(--lg-solid-glass)`,color:tn===`white`?`#000`:"
           "tn===`black`?`#fff`:`var(--on-solid)`,")

SHADOW_OLD = "`0 6px 16px -8px rgba(0,0,0,0.65)`"
SHADOW_NEW = "`inset 0 1px 0 rgba(255,255,255,.28),0 6px 16px -8px rgba(0,0,0,0.65)`"

SEC_OLD = "border:`1px solid transparent`,background:n?`var(--chip)`:`transparent`"
SEC_NEW = "border:`1px solid ${n?`var(--lg-rim-2)`:`transparent`}`,background:n?`var(--lg-tint-3)`:`transparent`"

POUCH_OLD = "pouch=(0,U.jsxs)(`div`,{className:`cw-card`,children:[H(`Custom Pouch`)"
POUCH_NEW = "pouch=(0,U.jsxs)(`div`,{className:`cw-card cw-lg-pouch`,children:[H(`Custom Pouch`)"

PREV_OLD = "prevBox=(0,U.jsx)(`div`,{className:`cw-preview`,children:"
PREV_NEW = "prevBox=(0,U.jsx)(`div`,{className:`cw-preview cw-lg-preview`,children:"

EDITS = [("sheet panel -> tier 1 + material cross-fade", SHEET_OLD, SHEET_NEW),
         ("g() class -> cw-lg-fab / cw-lg-btn", CLS_OLD, CLS_NEW),
         ("g() chip fill -> glass alpha + token", FAB_OLD, FAB_NEW),
         ("g() chip shadow -> inner specular edge", SHADOW_OLD, SHADOW_NEW),
         ("g() secondary -> glass rim and fill when active", SEC_OLD, SEC_NEW),
         ("Custom Pouch -> recessed glass tray", POUCH_OLD, POUCH_NEW),
         ("live preview -> glass frame", PREV_OLD, PREV_NEW)]


def main() -> int:
    check_only = "--check" in sys.argv
    code = CODE
    bad = 0
    for label, old, new in EDITS:
        n = code.count(old)
        if n != 1:
            print(f"  SKIP  {label}: anchor matched {n} times, expected exactly 1")
            bad += 1
            continue
        if new in code:
            print(f"  DONE  {label}: already applied")
            continue
        code = code.replace(old, new, 1)
        print(f"  ok    {label}")
    if bad:
        print(f"\nFAILED: {bad} anchor(s) did not match - the bundle is not the shape this patch expects.")
        return 1
    already = all(new in CODE for _, _, new in EDITS)
    if check_only:
        print(f"\n--check: {'all 7 edits present' if already else 'edits pending'}; "
              f"{len(code)} chars of app code after replay")
        return 0
    if already:
        print("\nno change: patch 30 already applied")
        return 0
    assert len(code) > 300000 and "cw-lg-fab" in code
    APP.write_text(code, encoding="utf-8")
    print(f"\napp/index.js written: {len(code.encode('utf-8'))} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
