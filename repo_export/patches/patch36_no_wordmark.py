#!/usr/bin/env python3
"""Round 21 - the "Wallet" text label leaves the top-left corner.

The ask, verbatim: *"Remove the \"Wallet\" text label shown at the top-left of the screen (the app
title/header text). Keep the rest of the header layout (search icon, menu icon, add button etc.)
intact - just remove that text element, don't leave empty spacing or misalign the remaining icons
after removal."*

What is actually on screen, measured from the shipped bundle (not assumed):

    div.pointer-events-none.fixed.inset-x-0.top-0.z-40.px-2      padding-top: safe-area + 6px
    ├── [0] div.pointer-events-auto.mx-auto.flex...justify-end    <- the header row
    │        └── span "Wallet"                                    <- the label this patch deletes
    ├── [1] div...fixed.inset-x-0.bottom-0.z-40                   <- the footer dock bar
    │        └── div(header row's class) > div.cw-dock > [Add card, Search cards, More]
    └── [2] the option menu (AnimatePresence; in flow, so it drops from the row)

So the three controls named in the ask are **already** in the bottom dock (patch 31, round 16) - they
are not siblings of the label and cannot be misaligned by deleting it. What the delete must not do:

  * **Break the outside-tap dismissal.** `ref:d` on the fixed container is what closes the option menu
    on an outside tap, and the dock is a child of that container on purpose. The container, the dock
    bar, the dock row and the menu are all untouched.
  * **Leave a hole.** The row is left in place and simply becomes empty. Measured: it is a zero-height
    flex row (no text, no buttons, no padding of its own), so it is invisible and has no hit area -
    patch 15's rule that dead bands must not respond to touch still holds, and the container's own
    `padding-top` (safe area + 6px) is what clears the status bar, unchanged.
  * **Shift anything.** The main column's reserves (`safe-area + 58px` top, `safe-area + 62px` bottom)
    are the dock/status-bar geometry from round 16/17 and are left byte-identical. The deck is centred
    between them, so touching either one would move every card - the ask was to remove a label, not to
    re-lay-out the wallet. (If the top band should be tightened later, that is a deliberate,
    separately-measured change: it moves the deck by half the delta.)
  * **Keep the row's geometry.** The dock row is literally the header row's class string (round 17's
    rule, `TOP_ROW_CLASS` counted twice by the glass audit), and the smoke/QA checks assert
    `dock.parentElement.className === headerRow.className`. An empty row keeps both true.

The span is replaced by a marker, `/*cardwallet:no-wordmark*/`, next to patch 8's
`/*cardwallet:header*/` - the header marker has to stay (it is the app-code start marker
`apk_content_check.py` scopes its injection checks with, and `verify_release.py` asserts it), and the
new marker is what lets the gates say "the label is gone" *positively* instead of only by absence.
It also serves as patch 17's `SUPERSEDED` proof: round 9 asked for this wordmark ("header pr top left
corner pr bara bold Wallet likho, font ios wala ho"), round 21 removes it on request - that is the one
round-9 mandate this round deliberately overrides.

Not the other "Wallet" strings in the bundle: the customization sheet's `Wallet colour` reset chip, the
settings `Name` input's default value, the `Wallet & cover` row and the empty state's `Wallet is empty`
heading are all different UI and are left alone (the gates pin their existence).

Run:  python3 repo_export/patches/patch36_no_wordmark.py [--check]
"""
from __future__ import annotations

from pathlib import Path
import sys

CHECK = "--check" in sys.argv
path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")

WORDMARK = (
    "(0,U.jsx)(`span`,{style:{marginRight:`auto`,marginLeft:`6px`,fontFamily:`-apple-system,"
    'BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Inter,Segoe UI,Roboto,'
    "sans-serif`,fontSize:`28px`,lineHeight:`34px`,fontWeight:800,letterSpacing:`-.6px`,"
    "color:`var(--ink)`,userSelect:`none`,WebkitUserSelect:`none`,pointerEvents:`none`},"
    "children:`Wallet`})"
)
MARK = "/*cardwallet:header*/"
NO_WORDMARK = "/*cardwallet:no-wordmark*/"

# the marked span, exactly as patch 17 left it after patch 31 moved the buttons out
OLD = "children:[" + MARK + WORDMARK + "]"
NEW = "children:[" + MARK + NO_WORDMARK + "]"


def status(data):
    if NEW in data:
        return "done"
    if data.count(OLD) == 1:
        return "todo"
    return "bad"


state = status(data)

if CHECK:
    if state == "bad":
        print("STALE ANCHOR: the header row is not the shape this patch expects")
        raise SystemExit(1)
    print("applied (the wordmark is gone)" if state == "done" else "clean (the wordmark span is still there)")
    raise SystemExit(0)

if state == "bad":
    raise SystemExit(
        "refusing to write - neither the marked wordmark span nor its replacement was found.\n"
        "  Run patch 17 -> 31 -> 35 first (the span is patch 17's, re-wrapped by patch 31)."
    )
if state == "done":
    print("skip: the wordmark is already gone")
    raise SystemExit(0)

data = data.replace(OLD, NEW)
print('ok    the "Wallet" label is removed from the header row')

# ---------------------------------------------------------------- the guards
row = "pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-end gap-1 px-2"
assert data.count(MARK) == 1, "patch 8's header marker was damaged"
assert data.count(NO_WORDMARK) == 1, "the round-21 marker did not land exactly once"
assert "children:`Wallet`" not in data, "the wordmark text is still rendered somewhere"
# the label is the *only* thing that went: the container, the dock, its three controls, the menu and
# both reserves must be byte-identical, or this patch did more than it says
assert "ref:d,className:`pointer-events-none fixed inset-x-0 top-0 z-40 px-2`" in data, \
    "the outside-tap container (ref:d) moved"
assert "pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2" in data, "the dock bar moved"
assert "cw-dock pointer-events-auto flex items-center" in data, "the dock itself changed"
for label in ("label:`Add card`", "label:`Search cards`", "label:`More`"):
    assert label in data, f"a dock control went missing with the label ({label})"
assert "ml-auto mb-1 w-[248px]" in data and "transformOrigin:`right bottom`" in data, "the option menu moved"
assert data.count(row) == 2, f"the header/dock row geometry pair is broken ({data.count(row)} rows)"
assert "paddingTop:`calc(env(safe-area-inset-top) + 58px)`" in data, "the top reserve changed"
assert "paddingBottom:`calc(env(safe-area-inset-bottom) + 62px)`" in data, "the dock reserve changed"
# and the other "Wallet" strings are untouched (they are not this label)
assert "children:[/*cardwallet:header*/" + NO_WORDMARK in data, "the marker is not where patch 8 expects it"
for keep in ("`Wallet colour`", "cu.name??`Wallet`", "`Wallet & cover`", "`Wallet is empty`"):
    assert keep in data, f"this patch touched UI it does not own ({keep})"
# the header component owns the marker exactly once
hdr = data.split("function zd({onGallery")[1].split("function Bd")[0]
assert NO_WORDMARK in hdr and "children:`Wallet`" not in hdr, "the removal did not land in the header"
assert "fontSize:`28px`" not in hdr, "the wordmark's type style is still in the header component"

import shutil
import subprocess
import tempfile

if shutil.which("node"):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(data)
        tmp = fh.name
    node = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    Path(tmp).unlink(missing_ok=True)
    if node.returncode != 0:
        first = next((l for l in node.stderr.splitlines() if "Error" in l), node.stderr[:200])
        raise SystemExit(f"generated bundle does not parse: {first}\n  app/index.js left untouched")
    print("ok    node --check on the generated bundle")

path.write_text(data, encoding="utf-8")
print("app/index.js written - the top-left corner is clear, the dock and the layout are untouched")
