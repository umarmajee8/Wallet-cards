#!/usr/bin/env python3
"""Premium minimalist pass 1: SF Pro typography, and a real frosted-glass Settings sheet.

Two surfaces, no behaviour change:

* **Type.** The app's font stack becomes the Apple one with explicit SF Pro faces before
  the fallbacks (`-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
  "SF Pro", Inter, …`) so an iOS-flavoured device gets real SF Pro and everything else
  falls back to its own system face. Body copy picks up a hair of negative tracking, and
  the sheet's headings move off "uppercase grey 13px" onto proper type: `.cw-title`
  (20/700, -0.4px) for the screen title and `.cw-h` (15/600, `var(--ink)`) for section
  headings - medium-bold-black, as asked. The Settings title stops being an
  `uppercase tracking sub` label.
* **Glass.** The Settings sheet is now translucent *everywhere it should be*: the scrim
  behind it blurs the wallet (`backdrop-filter:blur(20px)`), the panel itself is
  `blur(34px) saturate(1.7)` over a translucent fill (it used to be `sheet-bg` = opaque,
  which is why a "blurred settings screen" was impossible before), and a small kit of
  glass utilities (`.cw-card`, `.cw-row`, `.cw-seg`, `.cw-dot`, `.cw-range`,
  `.cw-preview`, `.cw-chip`, `.cw-val`) is added for patch 19 to build on. A
  `prefers-reduced-transparency` block drops the blur and restores solid fills, which is
  what iOS itself does.

Tokens are theme-aware, so the sheet stays legible in dark mode; nothing in the wallet's
own rendering or animation changes.

Run:  python3 repo_export/patches/patch18_glass_typography.py [--check]
"""
from pathlib import Path
import sys

APP = Path(__file__).resolve().parents[1] / "app"
JS, CSS = APP / "index.js", APP / "index.css"
js = JS.read_text(encoding="utf-8")
css = CSS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

# --------------------------------------------------------------------------- CSS
FONT_OLD = ("html,:host{-webkit-text-size-adjust:100%;tab-size:4;font-feature-settings:normal;"
            "font-variation-settings:normal;-webkit-tap-highlight-color:transparent;"
            "font-family:-apple-system,BlinkMacSystemFont,Inter,Segoe UI,Roboto,Helvetica Neue,"
            "Arial,sans-serif;line-height:1.5}")
FONT_NEW = ("html,:host{-webkit-text-size-adjust:100%;tab-size:4;font-feature-settings:normal;"
            "font-variation-settings:normal;-webkit-tap-highlight-color:transparent;"
            'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","SF Pro",'
            "Inter,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;line-height:1.5;"
            "letter-spacing:-.011em}")

GLASS_CSS = """\
:root{--glass:rgba(246,246,248,.55);--glass-2:rgba(255,255,255,.5);--glass-line:rgba(60,60,67,.14);\
--glass-hi:rgba(255,255,255,.6);--glass-blur:34px;--scrim:rgba(18,18,22,.24);--scrim-blur:20px;\
--accent:#0a84ff}html.dark{--glass:rgba(30,30,32,.5);--glass-2:rgba(44,44,46,.42);\
--glass-line:rgba(255,255,255,.1);--glass-hi:rgba(255,255,255,.07);--scrim:rgba(0,0,0,.34)}\
.cw-glass-sheet{background:var(--glass);\
-webkit-backdrop-filter:blur(var(--glass-blur)) saturate(1.7);backdrop-filter:blur(var(--glass-blur)) saturate(1.7);\
border-top:1px solid var(--glass-line);box-shadow:inset 0 1px 0 var(--glass-hi),0 -20px 60px -30px rgba(15,23,42,.5)}\
.cw-scrim{background:var(--scrim);\
-webkit-backdrop-filter:blur(var(--scrim-blur)) saturate(1.35);backdrop-filter:blur(var(--scrim-blur)) saturate(1.35)}\
.cw-card{background:var(--glass-2);border:1px solid var(--glass-line);border-radius:22px;\
box-shadow:inset 0 1px 0 var(--glass-hi);padding:14px;margin-bottom:14px}\
.cw-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;\
border-top:1px solid var(--glass-line)}\
.cw-h{font-size:15px;font-weight:600;letter-spacing:-.3px;color:var(--ink)}\
.cw-title{font-size:20px;font-weight:700;letter-spacing:-.4px;color:var(--ink)}\
.cw-sub{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--sub);margin:12px 0 2px}\
.cw-lbl{font-size:14px;letter-spacing:-.1px;color:var(--ink)}\
.cw-val{font-size:12px;color:var(--sub);min-width:34px;text-align:right;font-variant-numeric:tabular-nums}\
.cw-seg{display:flex;gap:4px;background:var(--chip);border-radius:12px;padding:2px}\
.cw-seg>button{border-radius:10px;padding:5px 10px;font-size:12.5px;font-weight:600;color:var(--sub);\
transition:background .18s ease,color .18s ease,box-shadow .18s ease}\
.cw-seg>button[data-on=true]{background:var(--solid);color:var(--on-solid);box-shadow:0 1px 2px rgba(0,0,0,.18)}\
.cw-dots{display:flex;gap:10px;flex-wrap:wrap;padding:2px 0 6px}\
.cw-dot{width:26px;height:26px;border-radius:50%;border:1px solid var(--glass-line);\
box-shadow:inset 0 1px 0 rgba(255,255,255,.28);transition:transform .16s ease,box-shadow .18s ease}\
.cw-dot:active{transform:scale(.92)}\
.cw-dot[data-on=true]{box-shadow:0 0 0 2px var(--glass),0 0 0 3.5px var(--accent)}\
.cw-chip{border-radius:10px;padding:5px 10px;font-size:12.5px;font-weight:600;color:var(--sub);\
background:var(--chip);transition:background .18s ease,color .18s ease}\
.cw-chip[data-on=true]{background:var(--solid);color:var(--on-solid)}\
.cw-range{-webkit-appearance:none;appearance:none;height:2px;border-radius:2px;background:var(--glass-line);\
outline:none;flex:1;min-width:0}\
.cw-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;\
background:var(--ink);border:2px solid var(--glass);box-shadow:0 1px 3px rgba(0,0,0,.3);\
transition:transform .12s ease}\
.cw-range:active::-webkit-slider-thumb{transform:scale(1.12)}\
.cw-preview{position:relative;height:168px;border-radius:18px;overflow:hidden;background:var(--glass);\
border:1px solid var(--glass-line);pointer-events:none;margin-bottom:12px}\
.cw-preview-in{position:absolute;left:50%;top:6px;transform:translateX(-50%) scale(.52);transform-origin:top center}\
.cw-chips{display:flex;gap:6px;flex-wrap:wrap}\
@media (prefers-reduced-transparency:reduce){.cw-glass-sheet,.cw-scrim,.cw-card{backdrop-filter:none;\
-webkit-backdrop-filter:none}.cw-glass-sheet{background:var(--sheet)}.cw-scrim{background:none}\
.cw-card{background:var(--raised)}}"""

# (old, new, label) - old None means "append this block"
CSS_EDITS = [
    (FONT_OLD, FONT_NEW, "font stack gets the SF Pro faces + tighter tracking"),
    (None, GLASS_CSS, "glass/type kit"),
]

# --------------------------------------------------------------------------- JS
SCRIM_OLD = ("(0,U.jsx)(X.div,{className:`fixed inset-0 z-[80] flex flex-col justify-end`,initial:{opacity:0},"
             "animate:{opacity:1},exit:{opacity:0},transition:{duration:.18},"
             "style:{background:`rgba(10,10,12,0.35)`,zIndex:2000}")
SCRIM_NEW = ("(0,U.jsx)(X.div,{className:`fixed inset-0 z-[80] flex flex-col justify-end cw-scrim`,"
             "initial:{opacity:0},animate:{opacity:1},exit:{opacity:0},transition:{duration:.18},"
             "style:{zIndex:2000}")
PANEL_OLD = ("className:`no-select rounded-t-[26px] sheet-bg`,initial:{y:`100%`},animate:{y:0},exit:{y:`100%`},"
             "transition:{type:`spring`,stiffness:340,damping:36},style:{paddingBottom:`calc(env(safe-area-inset-bottom) + 18px)`")
PANEL_NEW = ("className:`no-select rounded-t-[26px] cw-glass-sheet`,initial:{y:`100%`},animate:{y:0},exit:{y:`100%`},"
             "transition:{type:`spring`,stiffness:340,damping:36},style:{paddingBottom:`calc(env(safe-area-inset-bottom) + 18px)`")
TITLE_OLD = "(0,U.jsx)(`span`,{className:`text-[13px] font-medium uppercase tracking-[0.14em] sub`,children:`Settings`})"
TITLE_NEW = "(0,U.jsx)(`span`,{className:`cw-title`,children:`Settings`})"

JS_EDITS = [
    (SCRIM_OLD, SCRIM_NEW, "settings: the scrim blurs the wallet behind the sheet"),
    (PANEL_OLD, PANEL_NEW, "settings: the panel becomes real frosted glass (was opaque sheet-bg)"),
    (TITLE_OLD, TITLE_NEW, "settings: the title is a proper heading now"),
]


def status(data, edits):
    """(pending, applied, unrecognised) for a list of (old, new, label) edits.

    `old is None` marks a pure insertion, judged only by whether the block is there.
    An edit whose `old` text survives inside its own `new` text has to be judged by its
    output, or a re-run would apply it twice.
    """
    todo, done, bad = [], [], []
    for old, new, label in edits:
        if old is None:
            (done if data.count(new) >= 1 else todo).append(label if data.count(new) >= 1 else (old, new, label))
        elif old in new and data.count(new) >= 1:
            done.append(label)
        elif data.count(old) == 1:
            todo.append((old, new, label))
        elif data.count(new) >= 1:
            done.append(label)
        else:
            bad.append(label)
    return todo, done, bad


js_todo, js_done, js_bad = status(js, JS_EDITS)
cs_todo, cs_done, cs_bad = status(css, CSS_EDITS)

if CHECK:
    bad = js_bad + cs_bad
    if bad:
        print("STALE ANCHORS: " + ", ".join(bad))
        raise SystemExit(1)
    n = len(JS_EDITS) + len(CSS_EDITS)
    pend, apl = len(js_todo) + len(cs_todo), len(js_done) + len(cs_done)
    print("clean (all %d anchors present, nothing applied yet)" % n if pend == n
          else f"applied ({apl}/{n} edits in place, {pend} pending)")
    raise SystemExit(0)

if js_bad or cs_bad:
    raise SystemExit("refusing to write - stale anchors: " + ", ".join(js_bad + cs_bad)
                     + "\n  (patch 18 owns the settings sheet chrome; run patches 7 -> 17 first)")

if not js_todo and not cs_todo:
    print("skip: all 5 edits already applied")
    raise SystemExit(0)

for old, new, label in js_todo:
    js = js.replace(old, new)
    print(f"ok    {label}")
for old, new, label in cs_todo:
    if old is None:
        css = css.rstrip() + new + "\n"
    else:
        css = css.replace(old, new)
    print(f"ok    {label}")

# --- guards -----------------------------------------------------------------
assert 'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display"' in css, "SF Pro not in the stack"
assert ".cw-glass-sheet{" in css and "backdrop-filter:blur(var(--glass-blur))" in css, "glass kit missing"
assert "prefers-reduced-transparency" in css, "no reduced-transparency fallback"
assert ":root{--glass:" in css and "html.dark{--glass:" in css, "glass tokens not themed"
a0 = js.find("function Np({open:e,settings:t")
hdr = js[a0:a0 + 2600]
assert a0 > 0, "the settings component moved"
assert "cw-scrim" in hdr and "cw-glass-sheet" in hdr, "sheet chrome not rewritten"
assert "sheet-bg" not in hdr, "the opaque sheet-bg class survived on the settings panel"
assert 'className:`cw-title`,children:`Settings`' in js, "title not restyled"
assert js.count("cw-glass-sheet") == 1, "the glass panel class leaked onto another sheet"

import shutil
import subprocess
import tempfile

if shutil.which("node"):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(js)
        tmp = fh.name
    node = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    Path(tmp).unlink(missing_ok=True)
    if node.returncode:
        raise SystemExit("bundle does not parse:\n" + node.stderr[:1200])
    print("ok    node --check on the generated bundle")

JS.write_text(js, encoding="utf-8")
CSS.write_text(css, encoding="utf-8")
print("settings sheet is frosted glass now, type is on the SF Pro stack")
