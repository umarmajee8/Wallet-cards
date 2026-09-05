#!/usr/bin/env python3
"""Add-card pill on the wallet, per the reference picture - without its label.

The mock draws a wide black capsule sitting over the lower-right of the pouch:
a slightly raised dark disc with a grey `+` on the left, then the words "Add Card"
to the right. The ask is that exact thing minus the words, so this patch renders
the pill at the picture's proportions (208x56, `+` disc at the left, the rest of
the capsule empty) and drops the label.

Everything reuses the header's existing machinery instead of duplicating it:

  * one menu state (`l`), so opening the pill closes the header menus and the
    outside-tap dismiss / haptics / spring animation all work unchanged;
    the pill introduces a third id, `addPill`
  * the same item list `p` (gallery / camera / tap-a-bank-card) - the panel is
    rendered *above* the pill for that state instead of below the header row
    (fixed to the bottom, transform-origin `96% bottom`, animated in from below)
  * colours come from the theme tokens the header now uses: `var(--solid)`
    capsule, `var(--sub)` grey plus (the mock's plus is grey, not white), soft
    drop shadow, `var(--line)` edge - so the pill stays legible on both the dark
    Frosted pouch and the light Paper one instead of being a black hole in one
    of the two themes

Visibility: the mock is an **empty wallet**, and that is when the pill renders -
`!canClear` (canClear is `cards.length > 0`). With cards present the pouch area
is left alone. Note this means a fresh install does not show it: the app seeds
four demo cards, so clear them (menu -> Delete all cards) to see the pill.

Position: `fixed` bottom-right of the app's 520px column, inset 16px, so it lands
in the lower-right of the wallet area on any width and never overlaps the
centred empty-state caption. The single number to nudge is the bottom offset.

Run:  python3 repo_export/patches/patch11_pouch_add_pill.py [--check]
"""
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

PILL = (
    "!c&&(0,U.jsxs)(`button`,{\"aria-label\":`Add card from the wallet`,"
    "onClick:()=>u(e=>e===`addPill`?null:`addPill`),"
    "className:`pointer-events-auto flex items-center rounded-full active:opacity-80`,"
    "style:{position:`fixed`,right:`max(16px,calc(50vw - 244px))`,"
    "bottom:`calc(env(safe-area-inset-bottom) + 18px)`,width:`208px`,height:`56px`,"
    "padding:`0 6px`,gap:`10px`,justifyContent:`flex-start`,"
    "background:`var(--solid)`,color:`var(--on-solid)`,border:`1px solid var(--line)`,"
    "boxShadow:`0 14px 30px -14px rgba(0,0,0,0.55)`},children:["
    "(0,U.jsx)(`span`,{style:{width:`44px`,height:`44px`,flexShrink:0,borderRadius:`9999px`,"
    "display:`flex`,alignItems:`center`,justifyContent:`center`,"
    "background:`rgba(127,127,122,0.18)`,border:`1px solid rgba(127,127,122,0.28)`},"
    "children:(0,U.jsx)(`svg`,{width:`22`,height:`22`,viewBox:`0 0 24 24`,fill:`none`,"
    "children:(0,U.jsx)(`path`,{d:`M12 5.9v12.2M5.9 12h12.2`,stroke:`var(--sub)`,"
    "strokeWidth:`2.5`,strokeLinecap:`round`})})}),"
    "(0,U.jsx)(`span`,{style:{flex:1}})"
    "]})"
)

def new_for(label):
    return next(new for _o, new, _l in EDITS if _l == label)


MENU_ANCHOR = "(0,U.jsx)(W,{children:l&&(0,U.jsx)(X.div,{initial:{opacity:0,scale:.94,y:-6}"

EDITS = [
    # 1) drop the pill in as a sibling of the menu block, and make the menu's
    #    entry animation come from below when it belongs to the pill
    (
        MENU_ANCHOR,
        PILL + "," + MENU_ANCHOR.replace("y:-6}", "y:l===`addPill`?6:-6}"),
        "pill + menu entry",
    ),
    (
        "exit:{opacity:0,scale:.96,y:-4}",
        "exit:{opacity:0,scale:.96,y:l===`addPill`?4:-4}",
        "menu exit animation",
    ),
    # 2) anchor the panel to the bottom for the pill's menu
    (
        "className:`pointer-events-auto mx-auto w-full max-w-[520px] px-2`,"
        "style:{transformOrigin:l===`add`?`78% top`:`96% top`}",
        "className:`pointer-events-auto mx-auto w-full max-w-[520px] px-2 "
        "${l===`addPill`?`fixed inset-x-0 bottom-0 pb-4`:``}`,"
        "style:{transformOrigin:l===`add`?`78% top`:l===`addPill`?`96% bottom`:`96% top`}",
        "menu anchor",
    ),
    (
        "className:`ml-auto mt-1 w-[248px] overflow-hidden rounded-2xl py-1`",
        "className:`ml-auto ${l===`addPill`?`mb-1`:`mt-1`} w-[248px] overflow-hidden rounded-2xl py-1`",
        "menu margin side",
    ),
    # 3) the pill's menu shows the same capture routes as the header + button
    (
        "children:(l===`add`?p:m).map(",
        "children:(l===`add`||l===`addPill`?p:m).map(",
        "menu items",
    ),
]

if CHECK:
    todo = [label for old, _, label in EDITS if data.count(old) == 1]
    done = [label for old, _, label in EDITS if data.count(old) == 0 and data.count(new_for(label)) == 1]
    stale = [label for old, _, label in EDITS if data.count(old) == 0 and label not in done]
    if stale:
        print("STALE ANCHORS: " + ", ".join(stale))
        raise SystemExit(1)
    print(f"clean (all {len(EDITS)} anchors present)" if len(todo) == len(EDITS)
          else f"applied ({len(done)}/{len(EDITS)} edits in place)")
    raise SystemExit(0)

for old, new, label in EDITS:
    if data.count(old) == 0 and PILL in data:
        print(f"skip  {label}: already applied")
        continue
    assert data.count(old) == 1, f"{label}: expected 1 match, found {data.count(old)}"
    data = data.replace(old, new)
    print(f"ok    {label}")

path.write_text(data, encoding="utf-8")
print("app/index.js written - add-card pill (no label) renders on the empty wallet")
