#!/usr/bin/env python3
"""patch 31 - move the header's controls into a Liquid Glass footer dock.

The user's round-16 ask: "header pr jo b ha - create, search, setting - sab ko footer pr set kro".
So the three controls leave the top bar and become a floating bar at the bottom; the `Wallet` wordmark
stays top-left (round 9's mandate), and this is the one place where that mandate is deliberately
overridden - the *placement* of the `+` changes, its look does not (36px disc, token-driven fill,
19/21px glyphs, unchanged).

Why a re-wrap instead of CSS: the buttons and the wordmark are siblings in one row, and the option
menu is anchored to that row. Repositioning by CSS would either drag the wordmark to the bottom or
leave the dropdown pointing at a button that is no longer there. So `zd` now returns two fixed bars:

    [ row{ [wordmark] } , dock{ [row{ add, search, more }], menu } ]

and the menu becomes bottom-anchored (`mb-1`, `center bottom`) so it opens upward from the dock.
The deck also gets a real bottom reserve (`env(safe-area-inset-bottom) + 62px`) - previously the
main column only reserved space in one view, which would let the last card/label sit under the bar.

The dock is a tier-1 glass surface (it sits over the wallet's own cards), and the create disc *inside*
it loses its own backdrop-filter (`.cw-dock .cw-lg-fab` in the stylesheet) - a blurred child on a
blurred parent is the classic nested-blur stutter, and the disc still reads as glass because the fill,
rim and specular are its own. Net blur budget is unchanged: one blurred surface at rest (the dock),
three with a sheet open (dock + scrim + panel).

Three edits. The patch verifies itself: after writing, `node --check` must accept the file, or the
previous bytes are restored and the exit code is non-zero.

Usage:  python3 repo_export/patches/patch31_footer_dock.py [--check]
"""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app/index.js"
CODE = APP.read_text(encoding="utf-8")

DOCK_OPEN = ("(0,U.jsxs)(`div`,{className:`pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2`,"
             "style:{paddingBottom:`calc(env(safe-area-inset-bottom) + 10px)`},"
             "children:[(0,U.jsxs)(`div`,{className:`pointer-events-auto cw-dock mx-auto flex w-full "
             "max-w-[520px] items-center justify-center gap-1 px-2`,children:[")
MENU_OLD_CLASS = "className:`ml-auto mt-1 w-[248px] overflow-hidden rounded-2xl py-1`"
MENU_NEW_CLASS = "className:`mx-auto mb-1 w-[248px] overflow-hidden rounded-2xl py-1`"
MENU_OLD_ORIGIN = "style:{transformOrigin:l===`add`?`78% top`:`96% top`}"
MENU_NEW_ORIGIN = "style:{transformOrigin:`center bottom`}"
MAIN_OLD = "paddingTop:`calc(env(safe-area-inset-top) + 58px)`,paddingBottom:P>0?58:void 0"
MAIN_NEW = ("paddingTop:`calc(env(safe-area-inset-top) + 58px)`,"
            "paddingBottom:`calc(env(safe-area-inset-bottom) + 62px)`")


def rewrap(code: str) -> str:
    """Move [add, search, more] + their dropdown out of the top row and into a bottom dock."""
    mark = "children:[/*cardwallet:header*/"
    i = code.index(mark)
    span_end = code.index(",children:`Wallet`})", i) + len(",children:`Wallet`})")
    # The row's array close cannot be found by scanning forward for ")]})" - the search button's own
    # Fragment children end with that exact sequence. It *is* reliably the last "]" before the menu,
    # because the menu follows the row as the next sibling.
    menu_start = code.index(",(0,U.jsx)(W,{", span_end) + 1
    arr_end = code.rindex("]", 0, menu_start)                     # str.rindex takes (sub, start, end): the range must be
                                                                                  # bounded explicitly, or it searches to the end of the file
    buttons = code[span_end + 1:arr_end]                          # the three g(...) calls, verbatim
    func_end = code.index("}function Bd(", arr_end)
    outer_close = code.rindex("]})", menu_start, func_end)
    menu = code[menu_start:outer_close]
    assert buttons.count("(0,U.jsx)(g,{label:") == 3, f"expected 3 option buttons, got {buttons.count('(0,U.jsx)(g,{label:')}"
    assert menu.startswith("(0,U.jsx)(W,{") and "Delete all cards" not in menu
    head = code[:i]
    tail = code[outer_close:]                                     # ]}) that now closes the top container
    return (head + mark + code[i + len(mark):span_end] + "]})" + "," + DOCK_OPEN
            + buttons + "]})" + "," + menu + "]})" + tail)


def main() -> int:
    code = CODE
    try:
        moved = rewrap(code)
    except ValueError as e:
        print(f"  FAIL  the header row is not the shape this patch expects ({e})")
        return 1
    if "cw-dock" not in code:
        code = moved
        print("  ok    the three controls + their menu moved into a bottom dock")
    else:
        print("  DONE  dock already present, skipping the re-wrap")
    edits = [("option menu opens upward from the dock", MENU_OLD_CLASS, MENU_NEW_CLASS),
             ("dropdown origin is now the dock's top edge", MENU_OLD_ORIGIN, MENU_NEW_ORIGIN),
             ("the deck reserves the dock's height (safe area aware)", MAIN_OLD, MAIN_NEW)]
    for label, old, new in edits:
        n = code.count(old)
        if n != 1:
            print(f"  SKIP  {label}: anchor matched {n} times, expected exactly 1")
            return 1
        code = code.replace(old, new, 1)
        print(f"  ok    {label}")
    if "--check" in sys.argv:
        print(f"\n--check ok: {len(code)} chars after replay, dock={code.count('cw-dock')} "
              f"bottom-0 bars={code.count('fixed inset-x-0 bottom-0 z-40')}")
        return 0
    if code == CODE:
        print("\nno change: patch 31 already applied")
        return 0
    backup = CODE
    APP.write_text(code, encoding="utf-8")
    r = subprocess.run(["node", "--check", str(APP)], capture_output=True, text=True)
    if r.returncode != 0:
        APP.write_text(backup, encoding="utf-8")
        print("\nFAILED: node --check rejected the result; the previous bytes are restored.")
        print(r.stderr[:1200])
        return 1
    print(f"\napp/index.js written: {len(code.encode('utf-8'))} bytes (node --check ok)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
