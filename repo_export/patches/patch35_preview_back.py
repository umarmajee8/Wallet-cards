#!/usr/bin/env python3
"""Patch 35 - the card preview gets a visible Back control, and the Back key closes it too.

The client's report (screenshot of the full-screen card preview, the one with the WhatsApp and
Save pills) was simply: *"Yehn pr back ka option nhi ha app meh add kro"* - there is no way back
from this screen.

Two things were true about this surface and both are fixed here.

1. **No visible way out.** Every other surface in the app carries its own close affordance -
   Settings and the editor have Done, the long-press sheet has Cancel, the crop sheet has Cancel -
   but the preview (`jd`) only ever closed by tapping the empty backdrop, by swiping down, or with
   the Android Back key. Tapping the backdrop is invisible knowledge, and on a screen whose whole
   point is the card, the empty area beside a portrait card is a sliver. This patch adds a 44x44
   disc with a chevron, top-left, safe-area aware, in the same material the neighbouring pills use.

2. **The Back key did not close it either.** Patch 26 introduced the history contract - one
   `pushState` per open surface, `popstate` closes the topmost one - but its gate list is
   `f v T m c D k b C` (crop, camera, delete-all, editor, long-press sheet, settings, studio,
   tap-to-add, search) and the preview state `o` is **not in it**. So while this screen was open
   no history entry was pushed, Back produced a plain browser navigation with nothing to pop, and
   the activity finished: the app exited and the card the user was looking at was gone. That is
   the same defect class as QA-1 from the handover report, on the one surface that was missed.

3. **And a Back press that closed anything used to poison the next one.** Patch 26's bookkeeping
   keeps a single-entry `pushed` flag plus an `ign` flag that swallows the `popstate` its own
   `history.back()` produces. When the *user's* Back closed a surface the entry was already gone, but
   the code still armed `ign` and called `history.back()` a second time - so the next surface's first
   Back press was swallowed. Measured on the round-19 build: Settings -> Back -> Settings -> Back does
   **nothing**, a second press closes it. That is a second reason a user says "back kaam nahi karta".
   The popstate handler now clears `pushed` before shutting, so the flag matches the browser and
   `sync()` re-pushes only while a surface is still open. That is also what makes a sheet opened *on
   top of* the preview (the editor, reached by long-pressing the previewed card) close one at a time -
   editor first, preview second, never the app.

All three call the same close path, so from the user's side there is now exactly one behaviour:
the chevron, the backdrop tap and the system Back key all dismiss the preview and leave the deck
underneath untouched.

What it deliberately does not do:
  * no new glass - the disc is a flat translucent fill (`rgba(255,255,255,0.16)` / rim
    `rgba(255,255,255,0.22)`, literally the values the Save pill beside it already uses), so the
    stylesheet's blur budget (4 selectors) and the liquid-glass audit are untouched;
  * no layout property is animated - the entrance moves `opacity` and `y` only, so the bundle's
    static animation audit does not gain a new layout-triggering animation;
  * nothing in the wallet itself changes: the control is a child of the preview subtree, so the
    deck, the dock and the header row are byte-identical to before.

Anchors (each asserted to match exactly once):
    op=()=>!!(f||v||T||m||c||D||k||b||C),        (patch 26's gate -> append `o`)
    if(b){S(!1);return}if(C)w(!1)},              (patch 26's shut() -> append the preview branch)
    },[f,v,T,m,c,D,k,b,C]);                      (patch 26's deps -> the effect must re-run for `o`)
    if(op())shut();sync()};                      (patch 26's popstate handler -> the user's Back has
                                                  already consumed the entry, so clear `pushed` before
                                                  shutting; `sync()` then re-pushes if surfaces remain)
    (0,U.jsxs)(X.div,{className:`pointer-events-none absolute inset-x-0 flex justify-center gap-2.5 px-5`
                                                 (the pills row of jd - the control is inserted
                                                  before that whole element, i.e. after the card,
                                                  so a tall card can never paint over the button)

Run:  python3 repo_export/patches/patch35_preview_back.py [--check]
"""
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app" / "index.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

# ------------------------------------------------------------------ 1. Back key parity
GATE_FROM = "op=()=>!!(f||v||T||m||c||D||k||b||C),"
GATE_TO = "op=()=>!!(f||v||T||m||c||D||k||b||C||o),"

SHUT_FROM = "if(b){S(!1);return}if(C)w(!1)},"
# the preview is z-50, the lowest surface in the app, so it is consumed last - everything that can
# sit on top of it (editor z-60, search z-75, settings z-80 ...) has already been handled above.
# The body mirrors jd's own onClose prop exactly: `()=>{ae.current=!1,s(null)}`.
SHUT_TO = "if(b){S(!1);return}if(C)w(!1);if(o){ae.current=!1,s(null);return}},"

DEPS_FROM = "},[f,v,T,m,c,D,k,b,C]);"
DEPS_TO = "},[f,v,T,m,c,D,k,b,C,o]);"

# the popstate handler: by the time it runs, the browser has already moved off our entry, so the
# flag has to be cleared before `sync()` decides anything - and a surface that is still open
# afterwards (the preview under the editor) gets a fresh entry so Back can close it too.
ON_FROM = "if(op())shut();sync()};"
ON_TO = "if(op()){st.pushed=0;shut()}sync()};"
APPLIED = ("data-cwb", ON_TO)

# ------------------------------------------------------------------ 2. the visible control
ANCHOR = "(0,U.jsxs)(X.div,{className:`pointer-events-none absolute inset-x-0 flex justify-center gap-2.5 px-5`"
INSERT = (
    "(0,U.jsxs)(X.button,{\"data-cwb\":`back`,\"aria-label\":`Back`,"
    "initial:{opacity:0,y:-8},animate:{opacity:1,y:0},"
    "exit:{opacity:0,y:-8,transition:{duration:.14}},"
    "transition:{type:`spring`,stiffness:320,damping:28,delay:.08},whileTap:{scale:.92},"
    "onClick:e=>{e.stopPropagation(),navigator.vibrate&&navigator.vibrate(6),te()},"
    "className:`pointer-events-auto absolute flex h-11 w-11 items-center justify-center "
    "rounded-full text-white`,"
    "style:{top:`calc(env(safe-area-inset-top) + 10px)`,left:16,"
    "background:`rgba(255,255,255,0.16)`,border:`1px solid rgba(255,255,255,0.22)`},"
    "children:(0,U.jsx)(`svg`,{width:22,height:22,viewBox:`0 0 24 24`,fill:`none`,"
    "\"aria-hidden\":`true`,children:(0,U.jsx)(`path`,{d:`M14.8 5.6 8.4 12l6.4 6.4`,"
    "stroke:`currentColor`,strokeWidth:2.2,strokeLinecap:`round`,strokeLinejoin:`round`})})}),"
)


def main() -> int:
    global data
    already = all(marker in data for marker in APPLIED)
    if already:
        print("patch35: already applied" + (" (check)" if CHECK else ""))
        return 0

    counts = {
        "patch26 gate": data.count(GATE_FROM),
        "patch26 shut()": data.count(SHUT_FROM),
        "patch26 deps": data.count(DEPS_FROM),
        "preview pills row": data.count(ANCHOR),
        "patch26 popstate handler": data.count(ON_FROM),
    }
    if CHECK:
        bad = {k: v for k, v in counts.items() if v != 1}
        if bad:
            raise SystemExit(f"patch35 --check: anchors not usable: {bad}")
        if any(marker in data for marker in APPLIED):
            raise SystemExit("patch35 --check: the control is already in the bundle")
        print("patch35 --check: anchors and guards ok (nothing written)")
        return 0

    for label, n in counts.items():
        if n != 1:
            raise SystemExit(f"patch35: {label} matched {n} times, need exactly 1")

    data = data.replace(GATE_FROM, GATE_TO, 1)
    data = data.replace(SHUT_FROM, SHUT_TO, 1)
    data = data.replace(DEPS_FROM, DEPS_TO, 1)
    data = data.replace(ANCHOR, INSERT + ANCHOR, 1)
    data = data.replace(ON_FROM, ON_TO, 1)

    # a patch that writes a bundle which does not parse is worse than no patch: check the syntax of
    # exactly what is about to be written, in a temp file, before it touches the tree (.mjs, the
    # same idiom patch 8 uses - the bundle is an ES module and node --check needs the extension to
    # say so).
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        r = subprocess.run(["node", "--check", tmp_path], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(f"patch35: refusing to write - node --check failed:\n{r.stderr[:600]}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    JS.write_text(data, encoding="utf-8")
    print(f"patch35: applied - preview Back control + Back-key parity ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
