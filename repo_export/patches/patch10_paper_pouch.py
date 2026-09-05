#!/usr/bin/env python3
"""Add a "Paper" pouch preset that matches the reference picture.

The picture shows a light off-white felt pouch: soft top-to-bottom shading, a
bright sheen across the flap, a thin dark edge, and a **dashed stitch line**
around the front pocket - the opposite of the shipped default "Frosted", which is
near-black. All of that is expressible in the theme object the pouch renderer
already reads, so this patch adds a fourth entry rather than touching the
renderer:

  tray        #f7f6f4 -> #ecebe8 -> #e3e1dd   (light felt, soft depth)
  traySheen   strong white sweep              (the fabric highlight in the mock)
  trayBorder  1px rgba(0,0,0,0.07)            (dark edge instead of the usual white rim)
  trayShadow  lighter drop                    (light objects cast softer shadows)
  sleeve      base #f1efec / deep #dedad5, high grain (felt), low vignette
  stitch      rgba(151,147,142,.72) + white stitchShadow  <- the dashed line
  rivets      off                                             (none in the picture)

`tone`-style inversion is not needed here: the pouch has its own palette per
preset and is deliberately independent of the app theme, same as Steel/Emerald.

The preset is selectable from Settings -> Pouch style (which patch 9 restored) and
does **not** become the default: `wallet.settings.v1` ships `theme:\`slate\``, and
existing installs keep looking unchanged until someone opts in.

Depends on patch 9: the swatch-row edits are anchored inside the block patch 9
inserts, so run 9 first.

Run:  python3 repo_export/patches/patch10_paper_pouch.py [--check]
"""
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

PAPER_THEME = (
    "__cwPaperTheme={id:`paper`,name:`Paper`,"
    "tray:`linear-gradient(180deg, #f7f6f4 0%, #ecebe8 46%, #e3e1dd 100%)`,"
    "trayBorder:`1px solid rgba(0,0,0,0.07)`,"
    "traySheen:`linear-gradient(118deg, rgba(255,255,255,0.90) 0%, rgba(255,255,255,0.0) 26%, rgba(255,255,255,0.55) 44%, rgba(255,255,255,0) 64%)`,"
    "trayShadow:`0 20px 40px -20px rgba(0,0,0,0.28)`,"
    "sleeve:{base:`#f1efec`,deep:`#dedad5`,grain:.75,grainScale:.5,sheen:`rgba(255,255,255,0.55)`,"
    "shade:`rgba(0,0,0,0.10)`,vignette:.14,rim:`rgba(255,255,255,0.75)`,"
    "stitch:`rgba(151,147,142,0.72)`,stitchShadow:`rgba(255,255,255,0.85)`,"
    "rivets:!1,castShadow:`rgba(0,0,0,0.16)`}}"
)

# (search, replace, label)
EDITS = [
    # 1) the theme object, right after Emerald's, before Slate's
    (
        "stitchShadow:`rgba(0,0,0,0.55)`,rivets:!1,castShadow:`rgba(0,0,0,0.55)`}},__cwSlateTheme=",
        "stitchShadow:`rgba(0,0,0,0.55)`,rivets:!1,castShadow:`rgba(0,0,0,0.55)`}},"
        + PAPER_THEME + ",__cwSlateTheme=",
        "theme definition",
    ),
    # 2) the resolver: without this, settings.theme=paper silently falls back to Frost
    (
        "e===`slate`?__cwSlateTheme:Yu",
        "e===`slate`?__cwSlateTheme:e===`paper`?__cwPaperTheme:Yu",
        "theme resolver",
    ),
    # 3) the swatch: Paper joins the row (and the row breathes a little for 4)
    (
        "(0,U.jsx)(`div`,{className:`flex gap-3`,children:["
        "{id:`frost`,name:`Frosted`,c1:`#2b2b2f`,c2:`#0d0d0f`},"
        "{id:`steel`,name:`Steel`,c1:`#5b5d6c`,c2:`#2c2e3d`},"
        "{id:`emerald`,name:`Emerald`,c1:`#163b2c`,c2:`#071a13`}]",
        "(0,U.jsx)(`div`,{className:`flex gap-2`,children:["
        "{id:`frost`,name:`Frosted`,c1:`#2b2b2f`,c2:`#0d0d0f`},"
        "{id:`steel`,name:`Steel`,c1:`#5b5d6c`,c2:`#2c2e3d`},"
        "{id:`emerald`,name:`Emerald`,c1:`#163b2c`,c2:`#071a13`},"
        "{id:`paper`,name:`Paper`,c1:`#f2f0ed`,c2:`#dbd7d2`}]",
        "picker swatch",
    ),
    (
        "className:`flex flex-1 flex-col items-center gap-1.5 rounded-2xl px-2 py-3 active:opacity-70`",
        "className:`flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-2xl px-1.5 py-3 active:opacity-70`",
        "picker sizing",
    ),
    (
        "(0,U.jsx)(`div`,{className:`h-9 w-14 rounded-lg`,style:{background:`linear-gradient(180deg, ${e.c1} 0%, ${e.c2} 100%)`}})",
        "(0,U.jsx)(`div`,{className:`h-9 w-full rounded-lg`,style:{background:`linear-gradient(180deg, ${e.c1} 0%, ${e.c2} 100%)`,border:`1px solid var(--line)`}})",
        "picker preview fill",
    ),
    # 4) the tray is normally re-tinted from the card's own colour under the
    #    default "Slate" design - which would silently throw away the mock's
    #    felt palette. Paper opts out so it looks like the picture either way.
    (
        "background:n===`slate`?`linear-gradient(180deg, ${td((r&&r.color)||k||`#5c6574`,.72)} 0%, "
        "${td((r&&r.color)||k||`#5c6574`,.48)} 100%)`:v.tray,",
        "background:n===`slate`&&v.id!==`paper`?`linear-gradient(180deg, ${td((r&&r.color)||k||`#5c6574`,.72)} 0%, "
        "${td((r&&r.color)||k||`#5c6574`,.48)} 100%)`:v.tray,",
        "slate tint exemption",
    ),
]

def pending(data):
    """Edits whose old text is still there, plus the ones already applied."""
    todo, done = [], []
    for old, new, label in EDITS:
        if data.count(old) == 1:
            todo.append((old, new, label))
        elif data.count(new) >= 1:
            done.append(label)
        else:
            raise SystemExit(
                f"STALE ANCHOR ({label}): not found, and the patch output is not there either.\n"
                "  the swatch-row edits live inside patch 9's block - run patch 9 first"
            )
    return todo, done


todo, done = pending(data)

if CHECK:
    print(f"clean (all {len(EDITS)} anchors present)" if not done and todo else
          f"applied ({len(done)}/{len(EDITS)} edits in place)" if len(done) == len(EDITS) else
          f"partial: {len(done)} applied, {len(todo)} pending")
    raise SystemExit(0)

if not todo:
    print(f"skip: all {len(EDITS)} edits already applied")
    raise SystemExit(0)

for old, new, label in todo:
    data = data.replace(old, new)
    print(f"ok    {label}")
for label in done:
    print(f"skip  {label}: already applied")

path.write_text(data, encoding="utf-8")
print(f"app/index.js written - Paper preset added ({len(todo)} edits, default left at Slate)")
