#!/usr/bin/env python3
"""patch 32 - round 17: dock mirrors the top row's geometry, and the Settings sheet stops blurring twice.

Two asks, one patch.

1. "Jo create, search button ha or setting, yeh sab ko nichay bottom pr le kr ayo - *same jaga pr jis
   jaga oper ha*."  Round 16 centred the three controls in a pill; the user wants them where they always
   were, only mirrored to the bottom edge. So the dock row takes the header row's class string verbatim
   (`mx-auto max-w-[520px] justify-end`) and the glass pill moves onto a new child that holds the three
   buttons - the row is the 520px column again, and the pill hugs its right edge at every viewport width,
   exactly under the wordmark row's controls. The option menu stops centring too (`ml-auto mb-1`,
   `transformOrigin: right bottom`), so it opens upward from the More button the way it used to open
   downward from it.

2. "Setting me blur kam karo, lag feel ho raha ha."  Root cause, read out of the shipped stylesheet: the
   Settings panel is *two* stacked full-viewport backdrop filters. Its element carries
   `cw-glass-sheet cw-lg-primary`, and the panel sits *inside* the scrim, which blurred at its own radius:

       .cw-scrim        blur(var(--scrim-blur)=20px) saturate(1.35)   <- full viewport
       .cw-lg-primary   blur(var(--lg-blur)=30px)   saturate(1.72)    <- ~88vh panel, nested in the above

   A filtered ancestor turns the scrim's output into the panel's *backdrop root*, so the compositor
   reads back and filters the whole screen twice per frame - and it does it again on every frame of the
   sheet's slide-in spring. That is the stutter. Fix, in order of effect:
     - the scrim no longer blurs at all (a 20px blur under a 24%/34% dim is not visible, and removing it
       removes the nested backdrop root),
     - the sheet's radius drops 30px -> 14px, and `--glass-blur` (the legacy declaration the lg rule
       overrides) drops 34px -> 14px so the two agree no matter which wins,
     - the *small* pill keeps its 22px: cost scales with area x radius, so radius is deliberately not a
       single value across surfaces - a big surface gets the short blur, a small floating one can afford
       more. Blur budget is now 1 blurred surface at rest (the dock) and 2 with Settings open
       (dock + panel); the scrim is pure dim.

The stylesheet edits are idempotent and asserted; the JS edits are anchored string swaps, each required to
match exactly once, with `node --check` as the gate. `--check` replays everything against the tree without
writing.

Usage:  python3 repo_export/patches/patch32_dock_align_and_blur.py [--check]
"""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app/index.js"
CSS = HERE.parent / "app/index.css"

TOP_ROW_CLASS = "pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-end gap-1 px-2"

# ---- JS: the row becomes the 520px column again, the pill becomes a child of it -------------------
ROW_OLD = ("`pointer-events-auto cw-dock mx-auto flex w-full max-w-[520px] items-center justify-center "
           "gap-1 px-2`,children:[(0,U.jsx)(g,{label:`Add card`")
ROW_NEW = ("`" + TOP_ROW_CLASS + "`,children:[(0,U.jsxs)(`div`,{className:`cw-dock pointer-events-auto "
           "flex items-center`,children:[(0,U.jsx)(g,{label:`Add card`")
# The anchor's tail is: the U.jsx(g) call close `)`, then the row's `]})`. The pill needs one extra `]})`
# inserted *between* them - so the new string is built from the old one rather than retyped (round 16
# taught me that retyping a minified close sequence is exactly how you lose a bracket).
PILL_CLOSE = "strokeLinecap:`round`})},`more`)]})"
PILL_CLOSE_NEW = PILL_CLOSE[:-3] + "]})" + PILL_CLOSE[-3:]
MENU_OLD = "className:`mx-auto mb-1 w-[248px] overflow-hidden rounded-2xl py-1`"
MENU_NEW = "className:`ml-auto mb-1 w-[248px] overflow-hidden rounded-2xl py-1`"
ORIGIN_OLD = "style:{transformOrigin:`center bottom`}"
ORIGIN_NEW = "style:{transformOrigin:`right bottom`}"

JS_EDITS = [
    ("the dock row mirrors the header row and the glass moves onto the pill", ROW_OLD, ROW_NEW),
    ("the pill closes before the row", PILL_CLOSE, PILL_CLOSE_NEW),
    ("the option menu right-aligns like the header's did", MENU_OLD, MENU_NEW),
    ("the menu grows from the More button, not from the middle", ORIGIN_OLD, ORIGIN_NEW),
]

# ---- CSS: one blurred full-viewport surface, and a radius capped for cost -------------------------
CSS_EDITS = [
    ("legacy sheet radius matches the tier-1 sheet (14px)", "--glass-blur:34px", "--glass-blur:14px"),
    ("the scrim stops blurring (keeps its dim only)",
     ".cw-scrim{background:var(--scrim);-webkit-backdrop-filter:blur(var(--scrim-blur)) saturate(1.35);"
     "backdrop-filter:blur(var(--scrim-blur)) saturate(1.35)}",
     ".cw-scrim{background:var(--scrim)}"),
    ("the dead scrim-radius token goes with it", "--scrim:rgba(18,18,22,.24);--scrim-blur:20px;",
     "--scrim:rgba(18,18,22,.24);"),
    ("tier-1 sheet blur 30px -> 14px (the lag fix)", "--lg-blur:30px", "--lg-blur:14px"),
    # the reduced-transparency block used to neutralise the scrim's blur; nothing to neutralise now
    ("reduced transparency no longer mentions the scrim's blur",
     "@media (prefers-reduced-transparency:reduce){.cw-glass-sheet,.cw-scrim,.cw-card{backdrop-filter:none;"
     "-webkit-backdrop-filter:none}",
     "@media (prefers-reduced-transparency:reduce){.cw-glass-sheet,.cw-card{backdrop-filter:none;"
     "-webkit-backdrop-filter:none}"),
]

CSS_APPEND = """
/* ===========================================================================
   Round 17 - the blur budget is charged by AREA x RADIUS, so the big surface
   gets the short blur. The Settings sheet is 14px (was 30px) and the full-screen
   scrim does not blur at all: a filtered ancestor makes its output the panel's
   backdrop root, which is the readback that made opening Settings feel laggy.
   The footer pill keeps 22px - it is ~140x48, so it is the cheapest surface in
   the app despite the largest radius. Rules are asserted by
   patches/liquid_glass_audit.py (radii, the no-blur scrim, one blurred
   full-viewport surface) and by apk_content_check.py against the built APK.
   ========================================================================= */
"""


def apply_js(code: str) -> str:
    for label, old, new in JS_EDITS:
        if new in code and old not in code:
            print(f"  DONE  {label}: already applied")
            continue
        n = code.count(old)
        if n != 1:
            raise SystemExit(f"  FAIL  {label}: anchor matched {n} times, expected exactly 1\n        {old[:90]}")
        code = code.replace(old, new, 1)
        print(f"  ok    {label}")
    return code


def apply_css(css: str) -> str:
    for label, old, new in CSS_EDITS:
        if new in css and old not in css:
            print(f"  DONE  {label}: already applied")
            continue
        n = css.count(old)
        if n != 1:
            raise SystemExit(f"  FAIL  {label}: anchor matched {n} times, expected exactly 1\n        {old[:90]}")
        css = css.replace(old, new, 1)
        print(f"  ok    {label}")
    if CSS_APPEND.strip() not in css:
        css = css.rstrip("\n") + "\n" + CSS_APPEND
        print("  ok    round-17 comment block appended")
    return css


def main() -> int:
    js, css = JS.read_text(encoding="utf-8"), CSS.read_text(encoding="utf-8")
    js2, css2 = apply_js(js), apply_css(css)
    if "--check" in sys.argv:
        print(f"\n--check ok: js {len(js2)} chars (dock pill={js2.count('cw-dock pointer-events-auto')}), "
              f"css {len(css2)} chars (scrim blur={'backdrop-filter' in css2.split('.cw-scrim{')[1][:200]})")
        return 0
    if js2 == js and css2 == css:
        print("\nno change: patch 32 already applied")
        return 0
    js_bak, css_bak = js, css
    JS.write_text(js2, encoding="utf-8")
    CSS.write_text(css2, encoding="utf-8")
    r = subprocess.run(["node", "--check", str(JS)], capture_output=True, text=True)
    if r.returncode != 0:
        JS.write_text(js_bak, encoding="utf-8")
        CSS.write_text(css_bak, encoding="utf-8")
        print("\nFAILED: node --check rejected the bundle; both files restored.")
        # a minified bundle is one huge line, so node's own excerpt is useless - print only the verdict
        print(" | ".join(l for l in r.stderr.splitlines() if "SyntaxError" in l or l.startswith("node:")) or
              r.stderr[-300:])
        return 1
    if "blur(var(--scrim-blur)" in CSS.read_text(encoding="utf-8"):
        print("\nFAILED: the scrim still blurs")
        return 1
    print(f"\napp/index.js: {len(js2.encode('utf-8'))} bytes (was {len(js.encode('utf-8'))}), "
          f"app/index.css: {len(css2.encode('utf-8'))} bytes (was {len(css.encode('utf-8'))}); node --check ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
