#!/usr/bin/env python3
"""Make the Card Wallet header options config-driven.

Reads `repo_export/header_options.json` and rewrites, inside the minified
bundle: the header action row (the round buttons in the top bar) and the two
dropdown lists they open. This is the knob to turn when the header options
themselves change - which buttons exist, their labels, icons, order, whether a
button shows text next to the icon - without hand-editing minified JS.

Inside the bundle the header component is

  zd({onGallery:e, onCamera:t, onTap:n, onSearch:r, onSettings:i,
      onStudio:a, onClearAll:o, nfc:s, canClear:c})

so every action compiles down to one of those existing handlers, and every
`when` gate reuses an existing flag. Nothing new is invented: haptics,
close-the-menu-on-tap, NFC/has-cards gating all behave exactly as in the stock
menus.

Both generated spans carry a marker comment and are single bracket-balanced
array literals, so re-running this script after a JSON edit replaces the
previous span wholesale (idempotent):

  children:[/*cardwallet:header*/ ... ]
  p=[/*cardwallet:menu:add*/ ...]

Usage:
  python3 repo_export/patches/patch8_header_options.py [--check]

Per option: `chip` (filled disc vs bare glyph), `tone` (auto / black / white / ink),
`showText` (label beside the icon), `when` (nfc / hasCards). `defaults.tone`
covers the whole row.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
APP_JS = ROOT / "app" / "index.js"
CONFIG = ROOT / "header_options.json"

HEADER_MARK = "/*cardwallet:header*/"
MENU_MARK = "/*cardwallet:menu:%s*/"

# Icon name -> JSX expression, built from the same primitives the stock bundle
# uses (one path -> jsx, several elements -> jsxs over a Fragment). Strokes are
# currentColor on a 24x24 box, so they inherit the chip's white glyph colour.
FRAG = "(0,U.jsxs)(U.Fragment,{children:[%s]})"
ICONS: dict[str, str] = {
    # --- taken verbatim from the stock bundle ---
    # the three header glyphs are drawn heavier than the menu icons - on the
    # reference picture the +, the loupe and the bars all read at ~2.5-2.7 on a
    # 24 grid, so they carry equal weight next to the filled disc
    "plus": "(0,U.jsx)(`path`,{d:`M12 5.9v12.2M5.9 12h12.2`,stroke:`currentColor`,strokeWidth:`2.5`,strokeLinecap:`round`})",
    "search": FRAG % (
        "(0,U.jsx)(`circle`,{cx:`10.4`,cy:`10.4`,r:`6.4`,stroke:`currentColor`,strokeWidth:`2.3`}),"
        "(0,U.jsx)(`path`,{d:`m15.3 15.3 4.3 4.3`,stroke:`currentColor`,strokeWidth:`2.3`,strokeLinecap:`round`})"
    ),
    "bars": "(0,U.jsx)(`path`,{d:`M4.5 7.1h15M4.5 12h15M4.5 16.9h15`,stroke:`currentColor`,strokeWidth:`2.7`,strokeLinecap:`round`})",
    "dots-v": FRAG % (
        "(0,U.jsx)(`circle`,{cx:`12`,cy:`5.4`,r:`1.7`,fill:`currentColor`}),"
        "(0,U.jsx)(`circle`,{cx:`12`,cy:`12`,r:`1.7`,fill:`currentColor`}),"
        "(0,U.jsx)(`circle`,{cx:`12`,cy:`18.6`,r:`1.7`,fill:`currentColor`})"
    ),
    "gear": FRAG % (
        "(0,U.jsx)(`circle`,{cx:`12`,cy:`12`,r:`3`,stroke:`currentColor`,strokeWidth:`1.6`}),"
        "(0,U.jsx)(`path`,{d:`M12 3.6v2M12 18.4v2M20.4 12h-2M5.6 12h-2M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4M17.9 17.9l-1.4-1.4M7.5 7.5 6.1 6.1`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`})"
    ),
    "image": "(0,U.jsx)(`path`,{d:`M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Zm1.6 11.9 4.6-5.2 3 3.1 2.4-2.4 2.8 3`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinejoin:`round`})",
    "camera": FRAG % (
        "(0,U.jsx)(`path`,{d:`M3.5 8.6c0-1 .8-1.8 1.8-1.8h2c.5 0 .9-.2 1.1-.6l.7-1.2c.2-.3.6-.5 1-.5h3.8c.4 0 .8.2 1 .5l.7 1.2c.2.4.6.6 1.1.6h2c1 0 1.8.8 1.8 1.8v7.6c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8V8.6Z`,stroke:`currentColor`,strokeWidth:`1.6`}),"
        "(0,U.jsx)(`circle`,{cx:`12`,cy:`12.4`,r:`3.3`,stroke:`currentColor`,strokeWidth:`1.6`})"
    ),
    "nfc": "(0,U.jsx)(`path`,{d:`M7 5.5c3.4 2.6 3.4 10.4 0 13M11.5 3c5 3.8 5 14.2 0 18M16 7.6c1.9 1.6 1.9 7.2 0 8.8`,stroke:`currentColor`,strokeWidth:`1.7`,strokeLinecap:`round`})",
    "trash": "(0,U.jsx)(`path`,{d:`M5.5 7h13M10 7V5.4c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9V7m3 0-.7 11.1c0 .8-.7 1.4-1.5 1.4H8.2c-.8 0-1.4-.6-1.5-1.4L6 7`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`,strokeLinejoin:`round`})",
    # --- extras, same 24x24 / currentColor grid, for new option sets ---
    "dots-h": FRAG % (
        "(0,U.jsx)(`circle`,{cx:`5.4`,cy:`12`,r:`1.7`,fill:`currentColor`}),"
        "(0,U.jsx)(`circle`,{cx:`12`,cy:`12`,r:`1.7`,fill:`currentColor`}),"
        "(0,U.jsx)(`circle`,{cx:`18.6`,cy:`12`,r:`1.7`,fill:`currentColor`})"
    ),
    "x": "(0,U.jsx)(`path`,{d:`m6.6 6.6 10.8 10.8M17.4 6.6 6.6 17.4`,stroke:`currentColor`,strokeWidth:`1.9`,strokeLinecap:`round`})",
    "check": "(0,U.jsx)(`path`,{d:`m5.5 12.5 4.2 4.2 8.8-9.4`,stroke:`currentColor`,strokeWidth:`1.9`,strokeLinecap:`round`,strokeLinejoin:`round`})",
    "chevron-r": "(0,U.jsx)(`path`,{d:`m9.8 5.6 6.4 6.4-6.4 6.4`,stroke:`currentColor`,strokeWidth:`1.9`,strokeLinecap:`round`,strokeLinejoin:`round`})",
    "wallet": FRAG % (
        "(0,U.jsx)(`path`,{d:`M4 7.5C4 6.1 5.1 5 6.5 5H17c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinejoin:`round`}),"
        "(0,U.jsx)(`path`,{d:`M19 10.6h-3.4a2 2 0 0 0 0 4h3.4`,stroke:`currentColor`,strokeWidth:`1.6`})"
    ),
    "sliders": FRAG % (
        "(0,U.jsx)(`path`,{d:`M5 7.5h8M19.5 7.5h.2M5 16.5h2.5M13 16.5h7.2`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`}),"
        "(0,U.jsx)(`circle`,{cx:`16.2`,cy:`7.5`,r:`2`,stroke:`currentColor`,strokeWidth:`1.6`}),"
        "(0,U.jsx)(`circle`,{cx:`10.5`,cy:`16.5`,r:`2`,stroke:`currentColor`,strokeWidth:`1.6`})"
    ),
    "list": "(0,U.jsx)(`path`,{d:`M8.6 7h10.9M8.6 12h10.9M8.6 17h10.9M4.8 7h.01M4.8 12h.01M4.8 17h.01`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`})",
    "star": "(0,U.jsx)(`path`,{d:`m12 4.2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.9l5.4-.8L12 4.2Z`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinejoin:`round`})",
    "card": "(0,U.jsx)(`path`,{d:`M4 6.6C4 5.7 4.7 5 5.6 5h12.8c.9 0 1.6.7 1.6 1.6v10.8c0 .9-.7 1.6-1.6 1.6H5.6C4.7 19 4 18.3 4 17.4V6.6Zm0 3.9h16`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinejoin:`round`})",
    "eye": FRAG % (
        "(0,U.jsx)(`path`,{d:`M2.8 12S6.4 5.6 12 5.6 21.2 12 21.2 12 17.6 18.4 12 18.4 2.8 12 2.8 12Z`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinejoin:`round`}),"
        "(0,U.jsx)(`circle`,{cx:`12`,cy:`12`,r:`2.9`,stroke:`currentColor`,strokeWidth:`1.6`})"
    ),
    "share": FRAG % (
        "(0,U.jsx)(`path`,{d:`M12 15.5V4.6m0 0L8.4 8.2M12 4.6l3.6 3.6`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`,strokeLinejoin:`round`}),"
        "(0,U.jsx)(`path`,{d:`M5.4 12.6V18c0 .9.7 1.6 1.6 1.6h10c.9 0 1.6-.7 1.6-1.6v-5.4`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`})"
    ),
    "lock": FRAG % (
        "(0,U.jsx)(`path`,{d:`M8 10.4V8.2a4 4 0 0 1 8 0v2.2`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`}),"
        "(0,U.jsx)(`path`,{d:`M6.4 10.6h11.2c.7 0 1.2.6 1.2 1.2v6.4c0 .7-.5 1.2-1.2 1.2H6.4c-.6 0-1.2-.5-1.2-1.2v-6.4c0-.6.6-1.2 1.2-1.2Z`,stroke:`currentColor`,strokeWidth:`1.6`})"
    ),
}

TONES = {"auto", "black", "white", "ink"}   # auto = follow the app's --solid/--ink tokens
HANDLERS = {"gallery": "e", "camera": "t", "nfc": "n", "settings": "i", "studio": "a", "delete": "o"}
GATES = {"nfc": "s", "hasCards": "c"}

# Stock shapes (index.js as shipped, i.e. after patch1/5/6/7).
STOCK_HEADER = (
    "children:[(0,U.jsx)(g,{label:`Add card`,active:l===`add`,onClick:()=>u(e=>e===`add`?null:`add`),children:"
    "(0,U.jsx)(`path`,{d:`M12 4.8v14.4M4.8 12h14.4`,stroke:`currentColor`,strokeWidth:`1.9`,strokeLinecap:`round`})}),"
    "(0,U.jsx)(g,{label:`Search cards`,onClick:r,children:"
    "(0,U.jsxs)(U.Fragment,{children:["
    "(0,U.jsx)(`circle`,{cx:`11`,cy:`11`,r:`6.2`,stroke:`currentColor`,strokeWidth:`1.9`}),"
    "(0,U.jsx)(`path`,{d:`m15.6 15.6 3.6 3.6`,stroke:`currentColor`,strokeWidth:`1.9`,strokeLinecap:`round`})]})}),"
    "(0,U.jsx)(g,{label:`More`,active:l===`more`,onClick:()=>u(e=>e===`more`?null:`more`),children:"
    "(0,U.jsxs)(U.Fragment,{children:["
    "(0,U.jsx)(`circle`,{cx:`12`,cy:`5.4`,r:`1.7`,fill:`currentColor`}),"
    "(0,U.jsx)(`circle`,{cx:`12`,cy:`12`,r:`1.7`,fill:`currentColor`}),"
    "(0,U.jsx)(`circle`,{cx:`12`,cy:`18.6`,r:`1.7`,fill:`currentColor`})]})})]"
)
STOCK_MENUS = {
    "add": {
        "var": "p",
        "old": (
            "p=[{label:`Add from gallery`,onClick:f(e),icon:"
            "(0,U.jsx)(`path`,{d:`M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Zm1.6 11.9 4.6-5.2 3 3.1 2.4-2.4 2.8 3`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinejoin:`round`})},"
            "{label:`Take a picture`,onClick:f(t),icon:"
            "(0,U.jsxs)(U.Fragment,{children:["
            "(0,U.jsx)(`path`,{d:`M3.5 8.6c0-1 .8-1.8 1.8-1.8h2c.5 0 .9-.2 1.1-.6l.7-1.2c.2-.3.6-.5 1-.5h3.8c.4 0 .8.2 1 .5l.7 1.2c.2.4.6.6 1.1.6h2c1 0 1.8.8 1.8 1.8v7.6c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8V8.6Z`,stroke:`currentColor`,strokeWidth:`1.6`}),"
            "(0,U.jsx)(`circle`,{cx:`12`,cy:`12.4`,r:`3.3`,stroke:`currentColor`,strokeWidth:`1.6`})]})}];"
            "s&&p.push({label:`Tap a bank card`,onClick:f(n),icon:"
            "(0,U.jsx)(`path`,{d:`M7 5.5c3.4 2.6 3.4 10.4 0 13M11.5 3c5 3.8 5 14.2 0 18M16 7.6c1.9 1.6 1.9 7.2 0 8.8`,stroke:`currentColor`,strokeWidth:`1.7`,strokeLinecap:`round`})})"
        ),
    },
    "more": {
        "var": "m",
        "old": (
            "m=[{label:`Settings`,onClick:f(i),icon:"
            "(0,U.jsxs)(U.Fragment,{children:["
            "(0,U.jsx)(`circle`,{cx:`12`,cy:`12`,r:`3`,stroke:`currentColor`,strokeWidth:`1.6`}),"
            "(0,U.jsx)(`path`,{d:`M12 3.6v2M12 18.4v2M20.4 12h-2M5.6 12h-2M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4M17.9 17.9l-1.4-1.4M7.5 7.5 6.1 6.1`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`})]})}];"
            "c&&m.push({label:`Delete all cards`,danger:!0,onClick:f(o),icon:"
            "(0,U.jsx)(`path`,{d:`M5.5 7h13M10 7V5.4c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9V7m3 0-.7 11.1c0 .8-.7 1.4-1.5 1.4H8.2c-.8 0-1.4-.6-1.5-1.4L6 7`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`,strokeLinejoin:`round`})})"
        ),
    },
}


# ------------------------------------------------------------------ generators
def icon_expr(name: str, where: str) -> str:
    if name not in ICONS:
        raise SystemExit(f"{where}: unknown icon {name!r}. Known: {', '.join(sorted(ICONS))}")
    return ICONS[name]


def js_label(text: str) -> str:
    return text.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")


def onClick_for(action: str, *, in_menu: bool, where: str) -> str:
    if action.startswith("toggle:"):
        menu = action.split(":", 1)[1]
        if menu not in STOCK_MENUS:
            raise SystemExit(f"{where}: toggle:{menu} - no such menu (known: {', '.join(STOCK_MENUS)})")
        return f"()=>{{u(`{menu}`)}}" if in_menu else f"()=>u(e=>e===`{menu}`?null:`{menu}`)"
    if action == "search":
        return "r"
    if action == "none":
        return "null"
    if action in HANDLERS:
        return f"f({HANDLERS[action]})"
    raise SystemExit(f"{where}: unknown action {action!r} (toggle:<menu> / search / {' / '.join(sorted(HANDLERS))} / none)")


def gate_for(o: dict, where: str) -> str | None:
    gate = o.get("when")
    if gate and gate not in GATES:
        raise SystemExit(f"{where}: unknown when={gate!r} (known: {', '.join(GATES)})")
    return GATES.get(gate) if gate else None


def header_children(opts: list[dict], show_text: bool, default_tone: str) -> str:
    parts = []
    for o in opts:
        for key in ("id", "label", "icon", "action"):
            if key not in o:
                raise SystemExit(f"header option {o.get('id', o)}: missing key {key!r}")
        where = f"header option {o['id']!r}"
        props = [f"label:`{js_label(o['label'])}`"]
        if o.get("menu"):
            props.append(f"active:l===`{o['menu']}`")
        props.append(f"onClick:{onClick_for(o['action'], in_menu=False, where=where)}")
        tone = o.get("tone", default_tone)
        if tone not in TONES:
            raise SystemExit(f"header option {o['id']!r}: unknown tone {tone!r} (auto / black / white / ink)")
        props.append(f"chip:{'!0' if o.get('chip') else '!1'}")
        props.append(f"tone:`{tone}`")
        if show_text or o.get("showText"):
            props.append("text:!0")
        btn = f"(0,U.jsx)(g,{{{','.join(props)},children:{icon_expr(o['icon'], where)}}},`{o['id']}`)"
        gate = gate_for(o, where)
        parts.append(f"...{gate}?[{btn}]:[]" if gate else btn)
    return f"children:[{HEADER_MARK}{','.join(parts)}]"


def menu_array(key: str, items: list[dict]) -> str:
    var = STOCK_MENUS[key]["var"]
    parts = []
    for o in items:
        for field in ("label", "icon", "action"):
            if field not in o:
                raise SystemExit(f"menu {key!r} item {o}: missing key {field!r}")
        where = f"menu {key!r} item {o['label']!r}"
        fields = [f"label:`{js_label(o['label'])}`"]
        if o.get("danger"):
            fields.append("danger:!0")
        fields.append(f"onClick:{onClick_for(o['action'], in_menu=True, where=where)}")
        fields.append(f"icon:{icon_expr(o['icon'], where)}")
        item = "{" + ",".join(fields) + "}"
        gate = gate_for(o, where)
        parts.append(f"...{gate}?[{item}]:[]" if gate else item)
    return f"{var}=[{MENU_MARK % key}{','.join(parts)}]"


# ---------------------------------------------------------------- span walking
def match_bracket(data: str, open_idx: int) -> int:
    """Index of the ']' matching the '[' at open_idx (string/backtick aware)."""
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
    raise SystemExit("unbalanced brackets while scanning a marked span")


def replace_marked(data: str, marker: str, prefix: str, new: str) -> str:
    """Replace `prefix[ ... ]` that contains marker, else return data unchanged."""
    at = data.find(marker)
    if at < 0:
        return data
    open_idx = data.rindex("[", 0, at)
    if data[open_idx - len(prefix) : open_idx] != prefix:
        raise SystemExit(f"marker {marker!r} is not where it was left ({prefix!r}[); refusing to guess")
    end = match_bracket(data, open_idx) + 1
    return data[:open_idx] + new[len(prefix) :] + data[end:]


def main() -> int:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if not cfg.get("options"):
        raise SystemExit("header_options.json: 'options' is empty - the header would have no buttons")
    show_text = bool(cfg.get("showText"))
    OPT_KEYS = {"id", "label", "icon", "action", "menu", "when", "chip", "tone", "showText"}
    ITEM_KEYS = {"label", "icon", "action", "when", "danger"}
    for o in cfg["options"]:
        bad = set(o) - OPT_KEYS
        if bad:
            raise SystemExit(f"header option {o.get('id', o)}: unknown key(s) {sorted(bad)} (known: {sorted(OPT_KEYS)})")
    for key, items in (cfg.get("menus") or {}).items():
        for it in items:
            bad = set(it) - ITEM_KEYS
            if bad:
                raise SystemExit(f"menu {key!r} item {it.get('label', it)}: unknown key(s) {sorted(bad)} (known: {sorted(ITEM_KEYS)})")
    unknown = set(cfg) - {"_comment", "showText", "defaults", "options", "menus"}
    if unknown:
        raise SystemExit(f"header_options.json: unknown top-level key(s) {sorted(unknown)}")
    menus = cfg.get("menus") or {}
    for key in menus:
        if key not in STOCK_MENUS:
            raise SystemExit(f"header_options.json: 'menus' key {key!r} is not one of {', '.join(STOCK_MENUS)}")

    data = APP_JS.read_text(encoding="utf-8")
    notes = []

    # 1) the two dropdown lists first - the header row span search is easier
    #    once menu arrays are already in their marked shape
    for key, spec in STOCK_MENUS.items():
        items = menus.get(key)
        if items is None:
            continue
        new = menu_array(key, items)
        marked = replace_marked(data, MENU_MARK % key, spec["var"] + "=", new)
        if marked is not data:  # already patched by an earlier run
            data = marked
            notes.append(f"{key} menu (re-patched)")
        elif data.count(spec["old"]) == 1:
            data = data.replace(spec["old"], new)
            notes.append(f"{key} menu (from stock)")
        else:
            raise SystemExit(
                f"menu {key!r}: neither a marked span nor the stock array was found exactly once "
                f"({data.count(spec['old'])} stock matches) - update the anchor"
            )

    # 2) the header row
    default_tone = str((cfg.get("defaults") or {}).get("tone", "auto"))
    if default_tone not in TONES:
        raise SystemExit(f"defaults.tone {default_tone!r} is not one of {sorted(TONES)}")
    new_header = header_children(cfg["options"], show_text, default_tone)

    wants_v2 = any(
        o.get("chip") or o.get("tone") or show_text or o.get("showText")
        for o in cfg["options"]
    )
    if wants_v2 and "chip:cp,tone:tn" not in data:
        raise SystemExit(
            "header_options.json asks for chip/tone/showText, but the button component does not\n"
            "                 support them - apply patch7_header_black.py first"
        )
    # `auto` leans on the tokens patch7 wires up; an older patch7 would silently
    # render a literal black disc that vanishes on the dark theme.
    if any((o.get("tone") or default_tone) == "auto" for o in cfg["options"]) and "`var(--solid)`" not in data:
        raise SystemExit(
            "tone 'auto' needs the theme tokens patch7 wires into the button component -\n"
            "                 re-run patch7_header_black.py (it migrates its own older output)"
        )
    marked = replace_marked(data, HEADER_MARK, "children:", new_header)
    if marked is not data:
        data = marked
        notes.append("header row (re-patched)")
    else:
        if data.count(STOCK_HEADER) != 1:
            raise SystemExit(
                "header row: no marker found and the stock row is not present exactly once.\n"
                " If patch7 has not been applied, apply it first; if the bundle changed,\n"
                " update STOCK_HEADER to the current minified shape."
            )
        data = data.replace(STOCK_HEADER, new_header)
        notes.append("header row (from stock)")

    if "--check" in sys.argv:
        print(f"config ok: {len(cfg['options'])} header option(s), showText={show_text}, "
              f"menus={', '.join(menus) if menus else 'unchanged'}")
        return 0

    # A generated span that does not parse would only show up as a blank WebView
    # on a phone, so check it here where the failure is legible.
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
            raise SystemExit(f"generated bundle does not parse: {first}\n"
                             f"  app/index.js left untouched")
        log_syntax = "node --check ok"
    else:
        log_syntax = "node not found - skipped syntax check"

    APP_JS.write_text(data, encoding="utf-8")
    print("app/index.js written - " + ", ".join(notes) + f" ({log_syntax})")
    print("  header: " + " | ".join(o["label"] for o in cfg["options"]))
    for key, items in menus.items():
        print(f"  {key} menu: " + " / ".join(i["label"] for i in items))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
