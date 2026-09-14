#!/usr/bin/env python3
"""Per-card pouch colour: pick a colour for ONE card, like the other pouches have.

The ask (translated from the device report): "jaisy baki carousel hain un ka colour
select kar saktay hain, is ka bhi waise hi karo" - and when offered the choice, the
user picked *both* halves:

  1. each card gets its own pouch colour, selectable on that card, and
  2. the colour that is selected must actually reach the pouch.

How colour works today. One canvas painting routine builds every pouch, and it reads
its style from a single source: `pd()` / `vd()` are handed `theme` + `custom` + `tint`
from **settings** (`wallet.settings.v1`), so Settings -> Pouch -> Colour is global -
every card in the wallet gets the same sleeve. The per-colour machinery does exist in
the bundle but only as the *theme* a card is painted with:

    ad=(e,t)=>e===`custom`&&t?rd(t):e===`steel`?...:e===`slate`?__cwSlateTheme:Yu

`theme:'custom'` + `custom.color` = the "Yours" look, where the sleeve, the tray
gradient, the sheen and the name colour are all derived from that one hex value
(`rd(e)` above). The card record already carries arbitrary fields and the card editor
already saves patches through `onChange(card.id, {...})` (`Rd`, e.g. `{title}` and
`{back:void 0}`), so a per-card colour is a data field plus a swatch row - no new
drawing code, no new visual language.

Edits:

  * `Rd` (the card's own editor sheet) gets a **Pouch colour** row: the same 11 swatches
    Settings uses, plus a "Wallet colour" chip that clears the override
    (`{color:void 0}` - the same idiom the sheet already uses to drop a back picture).
  * `Q`/`yd` (the card) prefers the card's colour over the wallet's: when
    `card.color` is set, the card is painted as `theme:'custom'` with that colour, so it
    wins over the global choice and every part of the pouch follows it.
  * both memo comparators (`Q` and the carousel's `Dd`) compare `card.color`, otherwise
    the swatch would write the value and React would refuse to re-render the card.
  * the Stack view's cover tint (`col=` in `__cwCoverCard`) prefers the card's colour
    too, so the two layouts agree on what a card's colour means.

Global colour still works exactly as before for every card that has no override.

Run:  python3 repo_export/patches/patch16_card_pouch_colour.py [--check]
Depends on patches 7, 8, 12, 13, 14, 15 (it reads their output).
"""
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

PALETTE = ["#f3efe6", "#5c6574", "#2b2d32", "#8b93a0", "#9a8f82", "#2c3d56",
           "#2d4a3e", "#6b3038", "#5a4a3a", "#3d3454", "#1c1e22"]
PALETTE_JS = ",".join("`%s`" % c for c in PALETTE)

# 1) the swatch row, right under the card's own name field
TITLE_OLD = (
    "placeholder:`Card name`,className:`w-full bg-transparent pb-3 text-[24px] font-bold "
    "leading-tight tracking-tight ink outline-none placeholder:text-neutral-300`})"
)
TITLE_NEW = TITLE_OLD + (
    ",(0,U.jsxs)(`div`,{className:`mb-4`,children:["
    "(0,U.jsxs)(`div`,{className:`flex items-center justify-between pb-2`,children:["
    "(0,U.jsx)(`span`,{className:`text-[13px] font-medium uppercase tracking-[0.12em] sub`,"
    "children:`Pouch colour`}),"
    "e.color?(0,U.jsx)(`button`,{\"aria-label\":`Wallet colour`,"
    "onClick:()=>{t(e.id,{color:void 0}),navigator.vibrate&&navigator.vibrate(6)},"
    "className:`text-[12.5px] font-medium text-[#0a84ff] active:opacity-70`,"
    "children:`Wallet colour`}):null]}),"
    "(0,U.jsx)(`div`,{className:`flex flex-wrap gap-2.5`,children:[%s].map(r=>(0,U.jsx)(`button`,{"
    % PALETTE_JS +
    "\"aria-label\":`Pouch colour ${r}`,"
    "onClick:()=>{t(e.id,{color:r}),navigator.vibrate&&navigator.vibrate(6)},"
    "className:`h-9 w-9 rounded-full active:scale-95`,"
    "style:{background:r,border:e.color===r?`2px solid #0a84ff`:`1px solid var(--line)`,"
    "boxShadow:`inset 0 1px 0 rgba(255,255,255,0.2)`}},r))})]})"
)

# 2) the card paints itself from its own colour when it has one
YD_OLD = (
    "function yd({card:e,geo:t,cover:cv=!0,theme:n,custom:r,tint:k,isActive:i,ejected:a,hidden:o,"
    "onTap:s,onLongPress:c,onEjectComplete:l}){let u=(0,x.useRef)(null)"
)
YD_NEW = (
    "function yd({card:e,geo:t,cover:cv=!0,theme:n,custom:r,tint:k,isActive:i,ejected:a,hidden:o,"
    "onTap:s,onLongPress:c,onEjectComplete:l}){"
    "if(e&&e.color){n=`custom`;r={...(r||{}),color:e.color};}"
    "let u=(0,x.useRef)(null)"
)

# 3) the memo comparators must notice a colour change
QCMP_OLD = (
    "Q=(0,x.memo)(yd,(e,t)=>e.card.id===t.card.id&&e.card.src===t.card.src&&e.card.title===t.card.title"
    "&&e.cover===t.cover&&e.theme===t.theme&&e.tint===t.tint&&JSON.stringify(e.custom)===JSON.stringify(t.custom)"
)
QCMP_NEW = (
    "Q=(0,x.memo)(yd,(e,t)=>e.card.id===t.card.id&&e.card.src===t.card.src&&e.card.color===t.card.color"
    "&&e.card.title===t.card.title&&e.cover===t.cover&&e.theme===t.theme&&e.tint===t.tint"
    "&&JSON.stringify(e.custom)===JSON.stringify(t.custom)"
)
DDCMP_OLD = (
    "JSON.stringify(e.custom)===JSON.stringify(t.custom)&&e.card.id===t.card.id&&e.card.src===t.card.src"
    "&&(e.ejectedId===t.ejectedId"
)
DDCMP_NEW = (
    "JSON.stringify(e.custom)===JSON.stringify(t.custom)&&e.card.id===t.card.id&&e.card.src===t.card.src"
    "&&e.card.color===t.card.color&&(e.ejectedId===t.ejectedId"
)

# 4) the Stack cover agrees with the carousel about what a card's colour means
COL_OLD = "col=(j&&j.color)||k||`#3d3f46`"
COL_NEW = "col=e.color||(j&&j.color)||k||`#3d3f46`"

EDITS = [
    (TITLE_OLD, TITLE_NEW, "card editor: Pouch colour swatches + Wallet-colour reset"),
    (YD_OLD, YD_NEW, "card: own colour wins over the wallet colour"),
    (QCMP_OLD, QCMP_NEW, "Q memo: card.color compared"),
    (DDCMP_OLD, DDCMP_NEW, "carousel memo: card.color compared"),
    (COL_OLD, COL_NEW, "stack cover: tinted by the card's colour"),
]


def status(data):
    """(pending, applied, unrecognised) - same rules as patches 12-15."""
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
    return todo, done, bad


todo, done, bad = status(data)

if CHECK:
    if bad:
        print("STALE ANCHORS: " + ", ".join(bad))
        print("  (these spans belong to the earlier patches - run 7 -> 8 -> 12 -> 13 -> 14 -> 15 first)")
        raise SystemExit(1)
    print(f"clean (all {len(EDITS)} anchors present)" if not done
          else f"applied ({len(done)}/{len(EDITS)} edits in place)")
    raise SystemExit(0)

if bad:
    raise SystemExit(
        "refusing to write - anchors not found and no applied-output either: " + ", ".join(bad)
        + "\n  (run patches 7 -> 8 -> 12 -> 13 -> 14 -> 15 before this one)"
    )
if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    data = data.replace(old, new)
    print(f"ok    {label}")

# Guards. A swatch row that silently failed to build would show no colour picker at all,
# and a missed memo comparator would show the picker but never repaint the card - so
# both halves have to be visible in the output.
assert data.count("Pouch colour") == 2, "swatch row did not build (label + heading)"
assert data.count("`Pouch colour ${r}`") == 1, "swatch aria-labels missing"
assert "t(e.id,{color:void 0})" in data, "the reset chip does not clear the override"
assert "if(e&&e.color){n=`custom`;r={...(r||{}),color:e.color};}" in data, "card colour not preferred"
assert data.count("e.card.color===t.card.color") == 2, "a memo comparator was skipped"
assert "col=e.color||(j&&j.color)" in data, "stack cover ignores the card colour"
# the global path must still be there for cards without an override
assert "(e.custom&&e.custom.color)||e.tint||`#5c6574`" in data, "the wallet-wide colour path moved"

import shutil
import subprocess
import tempfile

if shutil.which("node"):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(data)
        tmp = fh.name
    node = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    Path(tmp).unlink(missing_ok=True)
    if node.returncode:
        raise SystemExit("bundle does not parse:\n" + node.stderr[:1200])
    print("ok    node --check on the generated bundle")

path.write_text(data, encoding="utf-8")
print("app/index.js written - every card can carry its own pouch colour")
