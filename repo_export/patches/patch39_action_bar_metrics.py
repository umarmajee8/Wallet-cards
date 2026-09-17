#!/usr/bin/env python3
"""Round 24 - the action bar sits at the bottom-right with the old header bar's own metrics.

The request, verbatim: *"Move the top-right action bar (currently containing \\"+\\" Add button, Search
icon, and Menu/Settings icon) from the top of the screen to the bottom-right corner instead - same exact
grouping, icons, and functionality, just relocated."* Plus: floating above the content (not over a bottom
nav), safe-area padded, actions unchanged, and the same fixed seat on every screen.

**The relocation itself is already shipped** (rounds 16-17, patches 31-32, 2026-09-07, for the same
request: *"header pr jo b ha - create, search, setting - sab ko footer pr set kro"*). What this round adds
is the part of the request that never travelled: the *old bar's own spacing*. Measured from the last build
that still had the bar at the top-right (`CardWallet_liquid_glass.apk`, round 15) and from the stock app:

    old top-right bar (round 15)   row `... items-center justify-end gap-1 px-2`
                                   gap-1 = 4px between the three controls, px-2 = 8px inset
                                   controls: h-9 w-9 (36px), glyphs 19px (create disc) / 21px
                                   labels: Add card / Search cards / More, all tone:auto
                                   no container of their own - three bare buttons in the row
    stock app                      the same three controls as h-11 w-11 (44px) bare circles

    the bottom dock (round 16)     the same three controls, lifted verbatim - now wrapped in a `.cw-dock`
                                   glass pill built with `gap:10px; padding:6px 10px`

So size, labels, icons, order and tone already matched (`tone:auto` before and after; the disc's glass
tier and the two bare buttons are untouched); the one measurable difference was the container's inner
spacing. This round sets it to the old bar's: `gap:4px` (the old `gap-1`) and `padding:6px 8px` (the old
`px-2` inset), appended as an override so round 16's own block is never rewritten. The pill's *frame* still
lands exactly where the old bar's last control ended (container `px-2` + row `px-2` = 16px from the screen
edge), which is the round-17 alignment rule.

Nothing else moves. The three controls, their handlers, the bottom-right seat, the safe-area padding, the
deck's reserved height and the upward-opening menu are all round 16/17 work and are asserted here, not
rewritten.

Run:  python3 repo_export/patches/patch39_action_bar_metrics.py [--check]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

CHECK = "--check" in sys.argv
ROOT = Path(__file__).resolve().parents[1]
JS_PATH = ROOT / "app" / "index.js"
CSS_PATH = ROOT / "app" / "index.css"

CSS_MARK = "Round 24 - the action bar carries the old header bar's own spacing"
CSS_BANNER = "/* ====================================================================================="
CSS_BLOCK = f"""{CSS_BANNER}
   Round 24 - the action bar carries the old header bar's own spacing. The move itself happened in
   round 16: the same three controls (Add card / Search cards / More, 36px boxes, 19/21px glyphs,
   tone:auto) now live in a glass pill anchored bottom-right. What had not travelled is the old bar's
   inner metrics - it was `gap-1 px-2` (4px between the controls, 8px inset), while the pill was built
   with `gap:10px; padding:6px 10px`. This override puts the pill's inner spacing back on the old
   numbers, so the relocated bar *is* the old bar's geometry inside the frame the client asked for.
   The pill's own edge still lands 16px from the screen (container px-2 + row px-2), where the old
   bar's last control ended - round 17's alignment rule, untouched.
   ===================================================================================== */
.cw-dock{{gap:4px;padding:6px 8px}}"""

# ---------------------------------------------------------------- the old bar, as measured
# Kept as literals so the guard list below fails loudly if a later round moves any of them.
OLD_ROW = "pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-end gap-1 px-2"
DOCK_ROW16 = ".cw-dock{\nwidth:max-content;\ngap:10px;\npadding:6px 10px;\nborder-radius:999px;"


def report(state: str) -> None:
    print({
        "todo": "clean (the pill still carries round 16's 10px/10px inner spacing)",
        "done": "applied (the pill's inner spacing is the old header bar's: gap 4px, padding 6px 8px)",
    }[state])


js = JS_PATH.read_text(encoding="utf-8")
css = CSS_PATH.read_text(encoding="utf-8")
# The override is only the *last* `.cw-dock{...}` rule in the sheet; a fresh tree has none.
OVERRIDE = re.compile(r"\.cw-dock\{gap:4px;padding:6px 8px\}")
done = bool(OVERRIDE.search(css)) and CSS_MARK in css

if CHECK:
    if not done:
        print("STALE ANCHORS: the round-24 spacing override")
        raise SystemExit(1)
    report("done")
    raise SystemExit(0)

appended = False
if not done:
    # the block it overrides must be exactly round 16's, untouched
    if DOCK_ROW16 not in css:
        raise SystemExit("refusing to write - round 16's .cw-dock rule is not the one this override was "
                         "measured against (patches 7-38 must be applied first)")
    # round 16's own rule + its three fallbacks (reduced transparency / no support / reduced motion)
    if css.count(".cw-dock{") != 4:
        raise SystemExit(f"refusing to write - expected 4 `.cw-dock{{` rules before the override "
                         f"(round 16's own + its three fallbacks), found {css.count('.cw-dock{')}")
    css = css.rstrip("\n") + "\n\n" + CSS_BLOCK + "\n"
    appended = True
    print("ok    the pill's inner spacing is the old bar's: gap 4px (gap-1), padding 6px 8px (px-2)")
    print("ok    appended as an override - round 16's own block is byte-identical")
else:
    print("skip  the round-24 spacing override is already there")

# ------------------------------------------------------------------------- guards
# (1) the relocation target: the pill is still the three controls, in the old order, with the old labels
assert js.count("cw-dock pointer-events-auto flex items-center") == 1, "the dock's element moved"
order = [js.find(f"label:`{l}`", js.find("cw-dock pointer-events-auto flex items-center")) for l in
         ("Add card", "Search cards", "More")]
assert all(i > 0 for i in order) and order == sorted(order), \
    f"the three controls are no longer in the old order: {order}"
for label in ("`Add card`", "`Search cards`", "`More`"):
    assert label in js, f"a control went missing ({label})"
# (2) size / icons / tone, exactly as the old bar had them (round 15's markup, verified from that build)
assert "flex h-9 items-center justify-center rounded-full" in js, "the 36px control box changed"
assert "size:cp?19:21" in js, "the glyph sizes (19 disc / 21 bare) changed"
assert js.count("tone:`auto`") == 3, f"expected the old three tone:auto controls, found {js.count('tone:`auto`')}"
assert js.count("chip:!0,tone:`auto`") == 1 and js.count("chip:!1,tone:`auto`") == 2, "chip flags changed"
for handler in ("onClick:()=>u(e=>e===`add`?null:`add`)", "label:`Search cards`,onClick:r",
                "onClick:()=>u(e=>e===`more`?null:`more`)"):
    assert handler in js, f"a control's action changed ({handler})"
# (3) the seat: bottom-right, safe-area padded, and the deck reserving its height
assert 'className:`pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2`' in js, "the bottom anchor moved"
assert "paddingBottom:`calc(env(safe-area-inset-bottom) + 10px)`" in js, "the bar's safe-area padding changed"
assert "paddingBottom:`calc(env(safe-area-inset-bottom) + 62px)`" in js, "the deck's reserve changed"
assert OLD_ROW in js, "the dock row is no longer the header row's own geometry (round 17)"
assert js.count(OLD_ROW) == 2, f"the header row / dock row pair changed shape ({js.count(OLD_ROW)})"
# the top of the screen stays empty - the bar is not duplicated there
assert "children:[/*cardwallet:header*//*cardwallet:no-wordmark*/]" in js, "the top row changed"
# the class string lives once, in the shared `g` control component - it is used exactly three times,
# which is the "exactly three controls" the old bar had
assert js.count("flex h-9 items-center justify-center rounded-full") == 1, "the control component changed"
assert js.count("(0,U.jsx)(g,{label:") == 3, \
    f"the bar must hold exactly three controls, found {js.count('(0,U.jsx)(g,{label:')}"
# (4) the menu still hangs upward from the pill's right edge (a menu opening downward would leave screen)
assert "ml-auto mb-1 w-[248px]" in js and "transformOrigin:`right bottom`" in js, "the menu anchor moved"
# (5) this round adds spacing only - no colour, no blur, no shadow, no motion
BLOCK = CSS_BLOCK if appended else css[css.index(CSS_MARK) - len(CSS_BANNER):]
assert not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|backdrop-filter|box-shadow|transition|animation", BLOCK), \
    "the round-24 block must add spacing only"
assert BLOCK.count(".cw-dock{") == 1 and OVERRIDE.search(css).group(0) == ".cw-dock{gap:4px;padding:6px 8px}", \
    "the override must be a single declaration block"
# the override has to win: it must be the last `.cw-dock{` rule in the sheet
assert css.rindex(".cw-dock{") > css.index(DOCK_ROW16), "the override is not after round 16's rule"
assert css.count(".cw-dock{") == 5, f"expected 5 `.cw-dock{{` rules after the override, found {css.count('.cw-dock{')}"
# (6) earlier rounds survive (this file appends; it must never rewrite a block)
for earlier in ("Round 15 - Liquid Glass", "Round 16 - the controls moved out",
                "Round 17 - the blur budget", "Round 18 - the lock gate",
                "Round 19 - the customization gate", "Round 22 - the overflow menu follows the theme"):
    assert earlier in css, f"a stylesheet block went missing: {earlier!r}"
assert css.count("--menu-shadow") == 2 and ".touch-none{touch-action:none}" in css, "an earlier round regressed"
assert DOCK_ROW16 in css, "round 16's own .cw-dock rule was rewritten instead of overridden"
assert js.count("/*cardwallet:inert-bands*/") == 1, "round 23's marker went missing"
# braces balanced, so a malformed append can never ship
assert css.count("{") == css.count("}"), "the stylesheet's braces no longer balance"

if css != CSS_PATH.read_text(encoding="utf-8"):
    CSS_PATH.write_text(css, encoding="utf-8")
    print("app/index.css written - the action bar rides the old header bar's spacing")
else:
    print("app/index.css already in the fixed state - nothing written")
