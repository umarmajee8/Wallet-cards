#!/usr/bin/env python3
"""Round 22 - the overflow menu follows the theme again.

The report, verbatim: *"In Light mode, the app's overflow menu (the dropdown showing \\"Settings\\" and
\\"Delete all cards\\") is still rendering with a dark/black background instead of following the light
theme. Every other UI element on screen ... correctly switches to light mode - only this specific popup
menu stays hardcoded dark."* And the ask: bind *"the menu's background, text, and icon colors to the
app's current theme state (light/dark) instead of a fixed dark value"*, then *"test switching between
System / Light / Dark appearance settings and confirm this menu updates correctly in all three"*.

**Where it came from** (this is a real, traceable regression, not an oversight in one line): the stock
app's panel was themed - `rounded-2xl sheet-bg` with `border:1px solid var(--line)`. Round 4 (patch 7,
"header look for the reference mock") stripped `sheet-bg` and painted it, in the patch's own words, a
"`#0b0b0d` panel, white rows, `#ff453a` destructive row ... that was an explicit choice, not an oversight,
so it does not invert" - written when the app was light-only. Rounds 9-13 then gave the app a real dark
theme (`html.dark`, Appearance = Light / System / Dark) and every surface moved to tokens *except* this
one, which kept its literal straight through to round 21. The screenshot in the report is that literal.

**The fix** (the menu is the only surface this touches):

    panel   background  #0b0b0d                       -> var(--sheet)     (#fff light / #1c1c1e dark)
            border      rgba(255,255,255,.14)         -> var(--line)      (6% black / 12% white)
            box-shadow  ...rgba(0,0,0,.75) (literal)  -> var(--menu-shadow) (below)
    rows    color       #fff  / #ff453a (danger)      -> var(--ink) / var(--danger)

Icons need no edit: the icon `<svg>`s are stroked `currentColor`, so they inherit the row colour - the
report's "and icon colors" is satisfied through the same declaration that fixes the labels.

The one value the tokens cannot express is the drop shadow (a menu wants a soft light-theme shadow, not
the near-black one it needs over a black app background), so it becomes `--menu-shadow`, defined for both
themes in `app/index.css` - literals live in the stylesheet, exactly as patch 7's own rule required.
`#0b0b0d` leaves the bundle entirely.

**Checked, and deliberately not touched:** the surfaces that are *meant* to be theme-independent stayed as
they are - the camera view (dark chrome over a live feed), the full-screen card viewer (`#000`, like
Photos), the scrims behind sheets (`rgba(10,10,12,.45)`), the toast pill (`rgba(20,20,22,.92)` + white),
and the card artwork itself. The "Delete all cards" confirm sheet was already themed (`sheet-bg`), so only
one thing in it is a literal - the destructive button's compiled `text-[#ff453a]` class - and it is left
alone here: it is one red in both themes and changing it means editing compiled CSS for no visible gain.

Run:  python3 repo_export/patches/patch37_menu_theme.py [--check]
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CHECK = "--check" in sys.argv
ROOT = Path(__file__).resolve().parents[1]
JS_PATH = ROOT / "app" / "index.js"
CSS_PATH = ROOT / "app" / "index.css"

# --------------------------------------------------------------------- the bundle
PANEL_OLD = (
    "style:{background:`#0b0b0d`,border:`1px solid rgba(255,255,255,0.14)`,"
    "boxShadow:`0 22px 46px -22px rgba(0,0,0,0.75)`}"
)
PANEL_NEW = (
    "style:{background:`var(--sheet)`,border:`1px solid var(--line)`,"
    "boxShadow:`var(--menu-shadow)`}"
)
ROWS_OLD = "style:{color:e.danger?`#ff453a`:`#fff`}"
ROWS_NEW = "style:{color:e.danger?`var(--danger)`:`var(--ink)`}"

# -------------------------------------------------------------------- stylesheet
CSS_MARK = "Round 22 - the overflow menu follows the theme"
CSS_BANNER = "/* ====================================================================================="
CSS_BLOCK = f"""{CSS_BANNER}
   Round 22 - the overflow menu follows the theme. The panel was the one surface patch 7 painted
   near-black for the light-theme mock ("#0b0b0d panel, white rows" - an explicit choice while the
   app had no dark theme), and it kept that literal through every round that made the app
   theme-aware. Panel, hairline and rows are tokens again; the drop shadow is the only value a
   token cannot express, so it lives here - literally - once per theme.
   ===================================================================================== */
:root{{--menu-shadow:0 22px 46px -22px rgba(15,23,42,.28)}}
html.dark{{--menu-shadow:0 22px 46px -22px rgba(0,0,0,.75)}}"""


def block_of(text: str, mark: str) -> tuple[int, int] | None:
    """(start, end) of the comment block that owns `mark` - its banner up to the next banner.

    The banner is found by walking back to the `/*` that opens the comment *containing* the mark.
    (Round 21's first draft matched the banner with `text.find` and a fixed run of "=" - which also
    matched round 19's banner, the only other one of that exact width, and it rewrote that block.
    The guard list at the bottom of this file is what makes that class of mistake impossible now.)
    """
    i = text.find(mark)
    if i < 0:
        return None
    start = text.rindex("/*", 0, i)
    if "*/" in text[start:i]:
        raise SystemExit(f"refusing to guess: the comment before {mark!r} is already closed")
    nxt = re.compile(r"\n/\* ={20,}").search(text, i + 2)
    return start, (nxt.start() if nxt else len(text))


def report(state: str) -> None:
    print({
        "todo": "clean (the menu still carries the round-4 literals)",
        "part": "PARTIAL: one of the two menu edits is in place - re-run to finish",
        "done": "applied (the menu rides the theme tokens)",
    }[state])


js = JS_PATH.read_text(encoding="utf-8")
css = CSS_PATH.read_text(encoding="utf-8")

panel_done, rows_done = PANEL_NEW in js, ROWS_NEW in js
css_zone = block_of(css, CSS_MARK)
css_done = bool(css_zone) and "--menu-shadow" in css[css_zone[0]:css_zone[1]]

if CHECK:
    stale = []
    if PANEL_OLD in js or not panel_done:
        stale.append("menu panel")
    if ROWS_OLD in js or not rows_done:
        stale.append("menu rows")
    if not css_done:
        stale.append("--menu-shadow tokens")
    if stale:
        print("STALE ANCHORS: " + ", ".join(stale))
        raise SystemExit(1)
    report("done" if panel_done and rows_done and css_done else "part")
    raise SystemExit(0)

if not panel_done:
    if js.count(PANEL_OLD) != 1:
        raise SystemExit(f"refusing to write - the black panel matched {js.count(PANEL_OLD)} times, "
                         "expected exactly 1 (run patch 7 first)")
    js = js.replace(PANEL_OLD, PANEL_NEW)
    print("ok    the menu panel is painted from --sheet / --line / --menu-shadow")
else:
    print("skip  the menu panel is already themed")

if not rows_done:
    if js.count(ROWS_OLD) != 1:
        raise SystemExit(f"refusing to write - the white menu rows matched {js.count(ROWS_OLD)} times, "
                         "expected exactly 1")
    js = js.replace(ROWS_OLD, ROWS_NEW)
    print("ok    menu rows ride --ink, the destructive row --danger (icons are currentColor)")
else:
    print("skip  the menu rows are already themed")

if not css_done:
    if css_zone:
        css = css[:css_zone[0]].rstrip("\n") + "\n" + CSS_BLOCK + "\n" + css[css_zone[1]:]
    else:
        # first run: the block goes on the end, and from here on it owns the tail (patch 33/34's
        # appends stop at the next banner, so re-running them cannot eat this block).
        css = css.rstrip("\n") + "\n\n" + CSS_BLOCK + "\n"
    print("ok    the round-22 stylesheet block (--menu-shadow, both themes)")
else:
    print("skip  the round-22 stylesheet block is already there")

# ------------------------------------------------------------------------- guards
# the menu's own shape must not have moved: only its colours are in scope
assert js.count("ml-auto mb-1 w-[248px] overflow-hidden rounded-2xl py-1") == 1, "the menu panel moved"
assert "transformOrigin:`right bottom`" in js, "the menu's anchor moved"
assert "flex w-full items-center gap-3 px-4 py-3 text-left text-[15.5px] active:opacity-70" in js, \
    "the menu row's layout class changed"
for label in ("`Settings`", "`Delete all cards`", "`Add from gallery`", "`Take a picture`"):
    assert label in js, f"a menu row went missing ({label})"
assert "cw-dock pointer-events-auto flex items-center" in js, "the dock changed"
# the literals this round exists to remove
assert "#0b0b0d" not in js, "the near-black panel is still in the bundle"
assert "rgba(255,255,255,0.14)`" not in js.split("boxShadow:`var(--menu-shadow)`")[0].split("cw-dock")[-1], \
    "the panel's white hairline is still there"
# the tokens this fix leans on must exist in both themes
for name in ("--sheet", "--ink", "--danger"):
    for scope in (":root", "html.dark"):
        assert name in (css if scope == ":root" else (css.split("html.dark{")[1] if "html.dark{" in css else "")), \
            f"{name} not found in {scope}"
assert "--menu-shadow:0 22px 46px -22px rgba(15,23,42,.28)" in css, "the light shadow token is missing"
assert "html.dark{--menu-shadow:0 22px 46px -22px rgba(0,0,0,.75)}" in css, "the dark shadow token is missing"
# the surfaces that are meant to stay theme-independent must still be there
for keep in ("rgba(10,10,12,0.45)", "rgba(20,20,22,0.92)", "`#09090b`"):
    assert keep in js, f"this patch touched a surface it does not own ({keep})"
# and every earlier stylesheet block must survive verbatim: this file appends a block, it must never
# rewrite somebody else's (round 21's draft matched the wrong banner and replaced round 19's rules)
for earlier in ("Round 15 - Liquid Glass", "Round 16 - the controls moved out",
                "Round 17 - the blur budget", "Round 18 - the lock gate",
                "Round 19 - the customization gate"):
    assert earlier in css, f"a stylesheet block went missing: {earlier!r}"
for rule in ('html[data-cw-custom="off"] .cw-cust-body{display:none}', ".cw-cust-slot{display:block}"):
    assert rule in css, f"the round-19 gate rule vanished from index.css ({rule})"
assert css.count("--menu-shadow") == 2, "the shadow token must be declared exactly once per theme"

if shutil.which("node"):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(js)
        tmp = fh.name
    node = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    Path(tmp).unlink(missing_ok=True)
    if node.returncode != 0:
        first = next((l for l in node.stderr.splitlines() if "Error" in l), node.stderr[:200])
        raise SystemExit(f"generated bundle does not parse: {first}\n  app/index.js left untouched")
    print("ok    node --check on the generated bundle")

JS_PATH.write_text(js, encoding="utf-8")
CSS_PATH.write_text(css, encoding="utf-8")
print("app/index.js + app/index.css written - the overflow menu inverts with the theme")
