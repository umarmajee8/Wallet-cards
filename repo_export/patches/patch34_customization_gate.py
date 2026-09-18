#!/usr/bin/env python3
"""Round 19: a switch that gates card customization, plus the module and the stylesheet.

Three edits, all asserted to match exactly once, then the bundle is checked with `node --check`:

  1. the Custom Pouch card grows a mount point (`.cw-cust-slot`) and its controls - the design rows and the
     stack/carousel sliders - are wrapped in one block (`.cw-cust-body`) so a single CSS rule can hide them;
  2. `customize_src.js` is appended verbatim to `app/index.js`;
  3. `customize.css` is appended verbatim to `app/index.css`.

The appends are *resynced*, not skipped, when the patch has already run: patch 34 owns the text from its own
banner to the end of each file, so editing the reviewed source and re-running this patch is enough - the tree
cannot drift from the source that was reviewed. (While patch 34 is the newest append, that tail is exactly its
own text; a later patch that appends must take over the same convention or move the marker.)

    python3 repo_export/patches/patch34_customization_gate.py            # apply or re-sync
    python3 repo_export/patches/patch34_customization_gate.py --check     # lint + report only
    python3 repo_export/patches/patch34_customization_gate.py --undo       # back to patch 34's tree
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "app" / "index.js"
CSS = ROOT / "app" / "index.css"
SRC = ROOT / "patches" / "customize_src.js"
STYLE = ROOT / "patches" / "customize.css"

OLD_POUCH = ("pouch=(0,U.jsxs)(`div`,{className:`cw-card cw-lg-pouch`,children:[H(`Custom Pouch`),"
             "prevBox,design,layout]})")
NEW_POUCH = ("pouch=(0,U.jsxs)(`div`,{className:`cw-card cw-lg-pouch`,children:[H(`Custom Pouch`),"
             "(0,U.jsx)(`div`,{className:`cw-cust-slot`,ref:e=>{window.__cwCust&&window.__cwCust.mount(e)}}),"
             "prevBox,(0,U.jsx)(`div`,{className:`cw-cust-body`,"
             "children:(0,U.jsxs)(U.Fragment,{children:[design,layout]})})]})")
SLOT_MARK = "cw-cust-slot"
BLOCK_JS = "/* =====================================================================================\n   Round 19 - the customization gate."
BLOCK_CSS = "/* =====================================================================================\n   Round 19 - the customization gate."
HIDE_RULE = 'html[data-cw-custom="off"] .cw-cust-body{display:none}'


def block_span(code: str, mark: str):
    """(start, end) of the comment block that *owns* `mark` - the `/*` that opens the comment
    containing it, up to the next banner - or None when the mark is absent.

    The naive `rindex("/*", 0, i)` is wrong whenever the mark is the banner itself (patch 34's
    BLOCK_CSS starts with `/* ====...`): searching strictly before `i` then lands on the *previous*
    block's comment, and a re-sync would rewrite the round-18 block with round-19 text. So the
    opening is taken at `i` when the mark starts a comment, and the `*/` test refuses a `/*` whose
    comment is already closed before the mark.
    """
    i = code.find(mark)
    if i < 0:
        return None
    start = code.rindex("/*", 0, i + 2) if code[i:i + 2] == "/*" else code.rindex("/*", 0, i)
    if "*/" in code[start:i]:
        return None
    nxt = re.compile(r"\n/\* ={20,}").search(code, i + 2)
    return start, (nxt.start() if nxt else len(code))


def sync_appended(code, mark, src, label):
    # A block owns its text up to the *next* block banner, not to EOF: round 19 appended after round
    # 18 and round 22 after both, so re-syncing an older patch must not take the newer rounds with it.
    span = block_span(code, mark)
    if span is None:
        return None
    start, end = span
    want = src.strip("\n")
    if code[start:end].strip("\n") == want:
        print(f"  DONE  {label} is current")
        return code
    print(f"  ok    {label} was stale in the tree - re-synced from the reviewed source")
    return code[:start].rstrip("\n") + "\n" + want + "\n" + code[end:]


def apply_js(code):
    if SLOT_MARK not in code:
        if code.count(OLD_POUCH) != 1:
            raise SystemExit("  FAIL  the Custom Pouch card is not the shape this patch expects:\n        "
                             + OLD_POUCH[:80])
        code = code.replace(OLD_POUCH, NEW_POUCH, 1)
        print("  ok    the Custom Pouch card grows a slot, and its controls are wrapped as one block")
    else:
        print("  DONE  the slot is already mounted")
    synced = sync_appended(code, BLOCK_JS, SRC.read_text(), "customize_src.js")
    if synced is None:
        assert "window.__cwCust = {" not in code
        code = code.rstrip("\n") + "\n" + SRC.read_text().strip("\n") + "\n"
        print(f"  ok    customize_src.js appended to the bundle ({len(SRC.read_text())} chars)")
    else:
        code = synced
    return code


def apply_css(css):
    synced = sync_appended(css, BLOCK_CSS, STYLE.read_text(), "customize.css")
    if synced is None:
        css = css.rstrip("\n") + "\n" + STYLE.read_text().strip("\n") + "\n"
        print(f"  ok    customize.css appended ({len(STYLE.read_text())} chars)")
    else:
        css = synced
    return css


def lint(style, src, js, css):
    bad = []
    if re.findall(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", style):
        bad.append("the round-19 CSS carries a colour literal - the gate must inherit the app's tokens")
    if "backdrop-filter" in style:
        bad.append("the gate adds a blur; it must not (the round-17 budget is four blurred selectors)")
    if HIDE_RULE not in css:
        bad.append("the hide rule is missing from index.css")
    if re.findall(r"\.innerHTML\s*=", src):
        bad.append("the module assigns innerHTML - the shipped bundle forbids it in app code")
    if js.count("className:`" + SLOT_MARK + "`") != 1:
        bad.append(f"the slot must be mounted exactly once, found {js.count('className:`' + SLOT_MARK + '`')}")
    if js.count("cw-cust-body") < 1:
        bad.append("the wrapped control block is missing from the bundle")
    if src.strip("\n") not in js:
        bad.append("the bundle does not contain patches/customize_src.js verbatim")
    if style.strip("\n") not in css:
        bad.append("index.css does not contain patches/customize.css verbatim")
    if js.count("window.__cwCust = {") != 1:
        bad.append("the module must be exported exactly once")
    if "isConnected" not in src:
        bad.append("the auto-off watch relies on the slot leaving the document")
    return bad


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    js, css = JS.read_text(), CSS.read_text()
    js2, css2 = apply_js(js), apply_css(css)
    problems = lint(STYLE.read_text(), SRC.read_text(), js2, css2)
    if problems:
        print("  FAIL  lint on the round-19 files:")
        for p in problems:
            print("        -", p)
        return 1
    if mode == "--check":
        print(f"\n--check ok: js {len(js2)} chars (module={'window.__cwCust' in js2}), css {len(css2)} chars")
        return 0
    if js2 == js and css2 == css:
        print("\nno change: patch 34 is applied and current")
        return 0
    before = js
    JS.write_text(js2)
    CSS.write_text(css2)
    r = subprocess.run(["node", "--check", str(JS)], capture_output=True, text=True)
    if r.returncode != 0:
        JS.write_text(before)
        print("\nFAILED: node --check rejected the bundle; index.js restored.\n" + r.stderr[:900])
        return 1
    print(f"\napp/index.js: {len(js2)} bytes (was {len(before)}), app/index.css: {len(css2)} bytes "
          f"(was {len(css)}); node --check ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
