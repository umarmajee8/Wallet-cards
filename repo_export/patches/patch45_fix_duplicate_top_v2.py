#!/usr/bin/env python3
"""Patch 45 v2 - Fix duplicate top bar (more robust)."""
from pathlib import Path
import re, subprocess, tempfile, shutil, sys

ROOT = Path(__file__).resolve().parents[1]
JS_PATH = ROOT / "app" / "index.js"

js = JS_PATH.read_text(encoding="utf-8")

MARKER = "/*cardwallet:header*/"

def match_bracket(data, open_idx):
    depth = 0
    i = open_idx
    quote = None
    n = len(data)
    while i < n:
        ch = data[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "`\"'":
            quote = ch
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise Exception("unbalanced")

# Find header marker
at = js.find(MARKER)
if at == -1:
    print("no header marker")
    sys.exit(1)

# Find opening [ before marker
open_idx = js.rfind("[", 0, at)
# Should be children:[
print(f"found marker at {at}, open [ at {open_idx}, snippet: {js[open_idx-20:at+30]}")

# Find matching ]
close_idx = match_bracket(js, open_idx)
old_children = js[open_idx:close_idx+1]
print(f"old children len {len(old_children)}, has Add card: {'Add card' in old_children}")

# Check if this is top row (justify-end) or bottom dock (cw-dock)
# We need to find which one contains justify-end vs cw-dock
# The top row is before bottom bar, and has justify-end
# The bottom dock has cw-dock class nearby

# Find surrounding context
ctx_start = max(0, open_idx-500)
ctx = js[ctx_start:open_idx]
is_top = "justify-end" in ctx
is_bottom = "cw-dock" in js[open_idx-200:open_idx+200] or "justify-center" in ctx

print(f"is_top (justify-end in ctx): {is_top}, is_bottom hint: {is_bottom}")
print(f"context: {ctx[-200:]}")

# We want to clear top row only, keep bottom dock
# Top row is the first header marker? Actually there are two header markers? Let's check
markers = [m.start() for m in re.finditer(re.escape(MARKER), js)]
print(f"found {len(markers)} header markers at {markers}")

for idx, pos in enumerate(markers):
    o = js.rfind("[", 0, pos)
    c = match_bracket(js, o)
    segment = js[o:c+1]
    surrounding = js[max(0,o-400):o]
    has_justify_end = "justify-end" in surrounding
    has_justify_center = "justify-center" in surrounding
    has_cw_dock = "cw-dock" in surrounding or "cw-dock" in js[o-100:c+100]
    print(f"marker {idx} at {pos}: len {len(segment)}, justify-end={has_justify_end}, justify-center={has_justify_center}, cw-dock nearby={has_cw_dock}, has Add card={ 'Add card' in segment}")

# For patch42, top row should be empty, bottom dock should have buttons
# The top row is the one with justify-end, bottom is justify-center + cw-dock
# So we clear the one with justify-end

cleared = 0
for pos in markers:
    o = js.rfind("[", 0, pos)
    c = match_bracket(js, o)
    surrounding = js[max(0,o-500):o]
    if "justify-end" in surrounding and "justify-center" not in surrounding[-200:]:
        # This is top row
        old = js[o:c+1]
        if "Add card" in old:
            new = "[/*cardwallet:header*/]"
            js = js[:o] + new + js[c+1:]
            print(f"cleared top row at {pos}")
            cleared += 1
            break

if cleared == 0:
    print("no top row cleared, trying alternative: find first marker with Add card and justify-end")
    for pos in markers:
        o = js.rfind("[", 0, pos)
        c = match_bracket(js, o)
        seg = js[o:c+1]
        if "Add card" in seg:
            surr = js[max(0,o-500):o]
            if "justify-end" in surr:
                js = js[:o] + "[/*cardwallet:header*/]" + js[c+1:]
                print(f"cleared via fallback at {pos}")
                cleared += 1
                break

print(f"cleared {cleared} top rows")

# Verify
if "cw-dock" not in js:
    print("ERROR cw-dock lost")
    sys.exit(1)

# Node check
if shutil.which("node"):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(js)
        tmp = fh.name
    result = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    Path(tmp).unlink(missing_ok=True)
    if result.returncode != 0:
        first = next((l for l in result.stderr.splitlines() if "Error" in l), result.stderr[:1000])
        print(f"node check failed: {first}")
        # Try to find error location
        # Write to file for inspection
        Path("/tmp/bad.js").write_text(js, encoding="utf-8")
        print("wrote /tmp/bad.js for inspection")
        sys.exit(1)
    print("ok node --check")

JS_PATH.write_text(js, encoding="utf-8")
print("written")
