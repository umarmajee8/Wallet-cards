#!/usr/bin/env python3
"""Liquid Glass audit - the rules that make the material look premium *and* stay 60 fps.

Everything here is measurable from the two source files; nothing is a taste judgement. The
important half is the contrast engine: a translucent surface's real colour is the tint composited
over whatever is behind it, so legibility is checked against the worst case a phone can show -
pure white artwork, mid grey, pure black - for both themes, not against the app background alone.

    python3 repo_export/patches/liquid_glass_audit.py [--svg docs/liquid-glass-preview.svg]
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSS = (ROOT / "repo_export/app/index.css").read_text(encoding="utf-8")
JS = (ROOT / "repo_export/app/index.js").read_text(encoding="utf-8")
MAKE_SVG = "--svg" in sys.argv
SVG_PATH = ROOT / "docs/liquid-glass-preview.svg"

BLOCK = CSS[CSS.index("Round 15 - Liquid Glass"):] if "Round 15 - Liquid Glass" in CSS else ""
passed = total = 0
if not BLOCK:
    # A reviewer running this against a tree without round 15 must get a verdict, not a traceback.
    print("FAIL  index.css carries no 'Round 15 - Liquid Glass' block - the material is not in this tree")
    print("FAIL  liquid_glass_audit cannot continue (every check below reads that block)")
    raise SystemExit(1)


def check(label, ok, detail=""):
    global passed, total
    total += 1
    passed += bool(ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"   {detail}" if detail else ""))


def rule(sel, text=None, all_matches=False):
    """Declaration bodies of rules whose selector list matches `sel`.

    `sel` is matched against "selector{" - so a pattern can name the brace it needs without the
    helper guessing where the group ends. Returns the first body (or all of them), or ""."""
    src = text if text is not None else CSS
    hits = [m.group(2) for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", src) if re.search(sel, m.group(1) + "{")]
    return hits if all_matches else (hits[0] if hits else "")


def _decls(scope):
    """Every declaration inside `scope{...}` blocks, later blocks winning (source order)."""
    out = {}
    for m in re.finditer(r"(?<![\w.-])(:root|html\.dark)\{([^{}]*)\}", CSS):
        if m.group(1) != scope:
            continue
        for d in m.group(2).split(";"):
            if ":" in d:
                k, v = d.split(":", 1)
                out[k.strip()] = v.strip()
    return out


DARK, LIGHT = _decls("html.dark"), _decls(":root")


def var(name, scope=":root"):
    """A custom property, resolved against the scope; dark inherits from :root like CSS does."""
    d = DARK if scope == "html.dark" else LIGHT
    return (d.get(name) or LIGHT.get(name) or "").strip()


def resolve(value, depth=0):
    """Resolve var() chains and simple rgba()/hex to a usable colour string."""
    if value is None or depth > 6:
        return ""
    m = re.fullmatch(r"var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)", value.strip())
    if m:
        got = (LIGHT.get(m.group(1)) or "").strip() or (m.group(2) or "").strip()
        return resolve(got, depth + 1)
    # a colour may sit behind a comma list (fallbacks); take the first parseable piece
    return value.strip()


def parse_color(s):
    """Return (r,g,b,a) for the colour forms this stylesheet actually uses, or None."""
    s = resolve(s)
    if not s:
        return None
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", s, re.I)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    m = re.fullmatch(r"rgba?\(([^)]+)\)", s, re.I)
    if m:
        parts = [p.strip() for p in m.group(1).replace(",", " ").split()]
        r, g, b = (float(parts[0]), float(parts[1]), float(parts[2]))
        a = float(parts[3]) if len(parts) > 3 else 1.0
        return (r, g, b, a)
    return None


def over(fg, bg):
    """Source-over composite of two (r,g,b,a) colours -> opaque rgb tuple."""
    r1, g1, b1, a1 = fg
    r2, g2, b2, a2 = bg
    a = a1 + a2 * (1 - a1)
    if a == 0:
        return (255, 255, 255)
    return tuple(round((c1 * a1 + c2 * a2 * (1 - a1)) / a) for c1, c2 in ((r1, r2), (g1, g2), (b1, b2)))


def lum(rgb):
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb[:3]
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def ratio(fg, bg):
    l1, l2 = lum(fg), lum(bg)
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)


# Worst-case content behind a translucent surface: a white page, a mid-grey photo, a black card.
WORST = [(255, 255, 255, 1.0), (128, 128, 128, 1.0), (0, 0, 0, 1.0)]

# ---------------------------------------------------------------- structural rules
check("round-15 block exists in index.css", bool(BLOCK), f"{len(BLOCK)} chars")
TIER1 = [".cw-lg-primary", ".cw-lg-fab"]
TIER2 = [".cw-lg-ctl", ".cw-lg-btn", ".cw-lg-pouch", ".cw-lg-preview", ".cw-chip", ".cw-dot", ".cw-range", ".cw-card"]

decl = rule(r"\.cw-lg-primary\{")
check("tier 1 really blurs the content behind it",
      re.search(r"backdrop-filter:blur\(var\(--lg-blur\)\)\s+saturate", decl) is not None,
      "blur + saturate, so colour bleeds through instead of a flat wash")
check("tier 1 lifts chroma and a hair of brightness (the 'wet' look)",
      "saturate(var(--lg-sat)) brightness(1.03)" in decl)
check("tier 1 layers a top specular sheen over its fill",
      decl.startswith("background:var(--lg-sheen),var(--lg-tint)") or "background:var(--lg-sheen),var(--lg-tint)" in decl)
check("tier 1 depth is one soft drop + one inner top edge, not a halo",
      "box-shadow:var(--lg-inner),var(--lg-depth)" in decl)

fab = rule(r"\.cw-lg-fab\{")
check("the create disc gets the stronger, tighter glass",
      "var(--lg-solid-glass)" in fab and "saturate(1.9)" in fab,
      "more tint than the sheet, 10px blur, extra chroma lift")
check("the create disc blurs at a control radius, not the sheet radius",
      "blur(var(--lg-blur-ctl))" in fab, f"ctl={var('--lg-blur-ctl')} vs sheet={var('--lg-blur')}")

# the performance contract: nothing inside a blurred surface may blur again
for cls in TIER2:
    body = rule(re.escape(cls) + r"\{", BLOCK)
    check(f"tier 2 stays cheap: {cls} declares no backdrop-filter",
          "backdrop-filter" not in body and "-webkit-backdrop" not in body,
          "translucent fill + rim + inner highlight only")
BLUR_SELS = sorted({m.strip().splitlines()[-1].strip() for m in
                    re.findall(r"([^{}]+)\{[^{}]*backdrop-filter:\s*blur", BLOCK)})
BLUR_DECLS = len(BLUR_SELS)
check("exactly three glass selectors declare a blur (sheet, disc, dock)",
      BLUR_DECLS == 3 and set(BLUR_SELS) == {".cw-lg-primary", ".cw-lg-fab", ".cw-dock"},
      f"{BLUR_DECLS}: {BLUR_SELS}")

# transitions: what may animate
for m in re.finditer(r"transition:([^;}]+)", BLOCK):
    props = m.group(1)
    bad = [p for p in re.findall(r"[a-z-]+(?=\s)", props) if p in ("filter", "backdrop", "width", "height", "left", "top", "margin", "padding")]
    if bad:
        check(f"animated properties are paint-only ({props[:40]})", False, f"triggers layout/paint: {bad}")
        break
else:
    check("animated properties are paint-only (no blur, no layout property)", True)
check("surface state changes are eased and short",
      "--lg-ease:cubic-bezier(.32,.72,0,1)" in BLOCK and "--lg-dur:.26s" in BLOCK,
      "the long deceleration curve, 0.26s - no bounce")
check("press feedback is a transform (never a size change)",
      ".cw-lg-btn:active,.cw-lg-fab:active{transform:scale(.94)}" in BLOCK)
check("press focus rings use the accent, not a glow",
      "cw-lg-fab:focus-visible" in BLOCK and "0 0 0 3px var(--accent)" in BLOCK)

# round 16 - the footer dock
SUP16 = BLOCK[BLOCK.index("@supports not"):] if "@supports not" in BLOCK else ""
dock = rule(r"\.cw-dock\{")
check("the footer dock is tier 1: it blurs the deck behind it",
      "backdrop-filter:blur(22px) saturate(1.78) brightness(1.03)" in dock, dock[:70])
check("the dock is its own radius and shape (a pill, not a slice of the sheet)",
      "border-radius:999px" in dock and "width:max-content" in dock)
check("the dock sits more opaque than the sheet (a small bar needs more separation)",
      parse_color(var("--lg-tint-2"))[3] > parse_color(var("--lg-tint"))[3]
      and parse_color(var("--lg-tint-2", "html.dark"))[3] > parse_color(var("--lg-tint", "html.dark"))[3],
      f"{parse_color(var('--lg-tint-2'))[3]}/{parse_color(var('--lg-tint-2', 'html.dark'))[3]} vs "
      f"{parse_color(var('--lg-tint'))[3]}/{parse_color(var('--lg-tint', 'html.dark'))[3]}")
check("no nested blur: the create disc stops blurring inside the dock",
      ".cw-dock .cw-lg-fab{backdrop-filter:none;-webkit-backdrop-filter:none}" in BLOCK,
      "a blurred child of a blurred parent costs the compositor twice for nothing")
check("every fallback covers the dock too (reduced transparency / no support / reduced motion)",
      ".cw-dock{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--raised)}" in BLOCK
      and ".cw-dock{background:var(--sheet)}" in SUP16 and ".cw-dock{transition:none}" in BLOCK,
      "COMPAT-1 + a11y")
SHEET_R = int(re.sub(r"\D", "", var("--lg-blur")))
CTL_R = int(re.sub(r"\D", "", var("--lg-blur-ctl")))
CSS_BLURS = len(re.findall(r"[^{}]+\{[^{}]*backdrop-filter:\s*blur", CSS))
check("round 17: the sheet's blur radius is capped (a full-height surface pays for area x radius)",
      0 < SHEET_R <= 16, f"--lg-blur={var('--lg-blur')}")
check("round 17: the legacy and tier-1 sheet tokens agree (14px whichever rule wins on the panel)",
      re.sub(r"\D", "", var("--glass-blur") or "") == str(SHEET_R),
      f"--glass-blur={var('--glass-blur')} vs --lg-blur={var('--lg-blur')}")
check("round 17: the full-screen scrim dims without blurring - no backdrop root above the sheet",
      "backdrop-filter" not in rule(r"\.cw-scrim\{") and "--scrim-blur" not in CSS,
      rule(r"\.cw-scrim\{") or "no .cw-scrim rule found")
check("round 17: radius is chosen per surface, not as a hierarchy - the small pill affords more",
      22 > SHEET_R > CTL_R, f"22px dock > {SHEET_R}px sheet > {CTL_R}px control")
check("round 17: at most 4 selectors in the whole stylesheet declare a blur",
      CSS_BLURS <= 4, f"{CSS_BLURS} blurred selectors in index.css (was 5 before the scrim fix)")
check("round 17: the sheet keeps the glass, it just spends less on it (blur + saturate + sheen intact)",
      "backdrop-filter:blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(1.03)" in decl
      and "background:var(--lg-sheen),var(--lg-tint)" in decl, "radius down, material unchanged")
for name in ["--lg-tint-2"]:
    check(f"dock fill token {name} is themed", DARK.get(name) is not None)

# taste rules the brief asked for, expressed as limits
rim = parse_color(var("--lg-rim")) or parse_color("rgba(0,0,0,1)")
rim2 = parse_color(var("--lg-rim-2")) or parse_color("rgba(0,0,0,1)")
check("the rim is a hair line, not a white border",
      rim and rim[3] <= 0.16 and rim2 and rim2[3] <= 0.16,
      f"light rim alpha {rim[3] if rim else '?'}, inner {rim2[3] if rim2 else '?'}")
drim = parse_color(var("--lg-rim", "html.dark"))
check("dark theme does not compensate with a bright frame", drim and drim[3] <= 0.16,
      f"dark rim alpha {drim[3] if drim else '?'}")
check("no excessive glow: no big zero-offset shadow in the block",
      re.search(r"box-shadow:[^;}]*0 0 (?:[3-9]\d|\d{3,})px", BLOCK) is None)
check("every tier-1/2 surface rounds to the app's geometry (>=12px)",
      all(re.search(r"(border-radius:\s*(?:1[2-9]|[2-9]\d)px|border-radius:9999px|rounded-t-\[26px\])",
                    (rule(re.escape(c) + r"\{") or BLOCK) + BLOCK) for c in TIER1))
TOKEN_USES = len(re.findall(r"var\(--lg-", BLOCK))
check("tokens are themed, never hardcoded per surface",
          f"{TOKEN_USES} token uses")
for name in ["--lg-tint", "--lg-tint-2", "--lg-tint-3", "--lg-solid-glass", "--lg-rim", "--lg-edge",
             "--lg-sheen", "--lg-inner", "--lg-depth"]:
    check(f"{name} has an explicit dark value", DARK.get(name) is not None, (LIGHT.get(name) or "")[:26])

# fallbacks
rt_all = BLOCK[BLOCK.index("prefers-reduced-transparency"):] if "prefers-reduced-transparency" in BLOCK else ""
check("reduced transparency kills every blur tier and keeps the fills readable",
      "backdrop-filter:none" in rt_all and ".cw-lg-primary{background:var(--sheet)}" in rt_all
      and ".cw-lg-fab{background:var(--solid)}" in rt_all, "accessibility + Android 6-9")
sup = BLOCK[BLOCK.index("@supports not"):] if "@supports not" in BLOCK else ""
check("no backdrop-filter support degrades to opaque, not to invisible",
      ".cw-lg-primary{background:var(--sheet)}" in sup and ".cw-lg-fab{background:var(--solid)}" in sup,
      "COMPAT-1 from the QA pass: minSdk 23 ships WebViews without backdrop-filter")
rm = BLOCK[BLOCK.index("prefers-reduced-motion"):] if "prefers-reduced-motion" in BLOCK else ""
check("reduced motion drops the transitions and the press scale",
      "transition:none" in rm and "transform:none" in rm)

# the wallet's own cards must not be covered by glass
for cls, where in [("cw-dock", "the footer dock holds the three controls"),]:
    check(f"wired: {cls} is applied in the bundle ({where})", JS.count(cls) >= 1, f"{JS.count(cls)} use(s)")
check("the option menu opens upward from the dock's right edge (round 17)",
      "transformOrigin:`right bottom`" in JS and "ml-auto mb-1 w-[248px]" in JS
      and "mx-auto mb-1 w-[248px]" not in JS, "-")
TOP_ROW_CLASS = "pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-end gap-1 px-2"
check("the dock row is literally the header row's geometry, so the controls land on the same x",
      JS.count(TOP_ROW_CLASS) == 2, f"{JS.count(TOP_ROW_CLASS)} rows carry the header row's class string")
check("the glass sits on the pill, not on the row (a full-column bar would blur 4x the pixels)",
      "cw-dock pointer-events-auto flex items-center" in JS
      and re.search(r"className:`cw-dock[^`]*max-w-\[520px\]", JS) is None, "-")
check("the deck reserves the dock's height, safe area included",
      "paddingBottom:`calc(env(safe-area-inset-bottom) + 62px)`" in JS, "-")
# round 21: the client asked for the top-left "Wallet" label to go. The row it lived in stays (it is
# the dock row's geometry twin, and `ref:d` on its container is what closes the menu on an outside
# tap); what must be true now is that no label text renders and the marker says so.
check("the wallet bar carries no label: the wordmark is gone, the dock is the only floating chrome",
      JS.count("children:`Wallet`") == 0 and "/*cardwallet:no-wordmark*/" in JS
      and "inset-x-0 bottom-0 z-40" in JS, "-")

check("the deck is untouched: no lg class on the card path",
      not re.search(r"cw-lg-(primary|fab|pouch|preview|ctl)[^`]*`(?:[^`]*\bcw-card\b)", JS)
      and "cw-lg" not in (JS[JS.index("cover:") - 400:JS.index("cover:")] if "cover:" in JS else ""),
      "the sheet's .cw-card is the pouch tray; the wallet deck has no glass class")
check("the frosted pouch cover stays exactly as scoped (no new glass in the deck path)",
      JS.count("cw-glass-sheet") == 1, "one glass surface in the bundle, unchanged since round 18")

# wiring: the classes have to be on real elements
for cls, where in [
    ("cw-lg-primary", "settings/pouch sheet panel"),
    ("cw-lg-fab", "create + disc and the header controls"),
    ("cw-lg-btn", "floating secondary buttons"),
    ("cw-lg-pouch", "Custom Pouch container"),
    ("cw-lg-preview", "live preview frame"),
]:
    n = JS.count(cls)
    check(f"wired: {cls} is applied in the bundle ({where})", n >= 1, f"{n} use(s)")
check("the tier-1 sheet keeps its original hook (cw-glass-sheet) next to the new class",
      re.search(r"rounded-t-\[26px\] cw-glass-sheet cw-lg-primary", JS) is not None,
      "one class added, nothing replaced - the round-18 checks still describe the sheet")

# ---------------------------------------------------------------- contrast engine
# (theme, tint token, text token, label, nested?) - nested=True means the surface sits on the
# tier-1 sheet, so its backdrop is already a composited glass colour, not the raw artwork.
SUITES = [
    ("light", "--lg-tint", "--lg-ink", "sheet body text"),
    ("light", "--lg-tint", "--lg-sub", "sheet read-outs / captions"),
    ("light", "--lg-tint-2", "--lg-ink", "pouch tray body text"),
    ("light", "--lg-tint-2", "--lg-ink", "dock control label (the header row is ink)"),
    ("light", "--lg-tint-3", "--lg-ink", "chip label on glass (nested)", True),
    ("light", "--lg-solid-glass", "--on-solid", "glyph on the create disc (in the dock)"),
    ("dark", "--lg-tint", "--lg-ink", "sheet body text"),
    ("dark", "--lg-tint", "--lg-sub", "sheet read-outs / captions"),
    ("dark", "--lg-tint-2", "--lg-ink", "pouch tray body text"),
    ("dark", "--lg-tint-3", "--lg-ink", "chip label on glass (nested)", True),
    ("dark", "--lg-solid-glass", "--on-solid", "glyph on the create disc (in the dock)"),
]
MIN_TEXT, MIN_GLYPH = 4.5, 4.5
worst_rows = []
for row in SUITES:
    scope, tint, text, label = row[0], row[1], row[2], row[3]
    nested = row[4] if len(row) > 4 else False
    scope_sel = "html.dark" if scope == "dark" else ":root"
    tc, tx = parse_color(var(tint, scope_sel)), parse_color(var(text, scope_sel))
    if not tc or not tx:
        check(f"contrast {scope}/{label}", False, f"unparsed {tint} / {text}")
        continue
    worst, worst_bg = 99.0, None
    for bg in WORST:
        if nested:
            under = parse_color(var("--lg-tint", scope_sel))
            surf = over(tc, tuple(over(under, bg)) + (1.0,))
        else:
            surf = over(tc, bg)
        txt = over(tx, surf) if tx[3] < 1 else (tx[0], tx[1], tx[2])
        r = ratio(txt, surf)
        if r < worst:
            worst, worst_bg = r, (int(bg[0]), int(bg[1]), int(bg[2]))
    limit = MIN_GLYPH if "glyph" in label else MIN_TEXT
    worst_rows.append((scope, label, round(worst, 2), worst_bg))
    check(f"contrast {scope}/{label} >= {limit}:1 through the worst backdrop",
          worst >= limit,
          f"worst {worst:.2f}:1 (tint a={tc[3]} over {worst_bg})")

# ------------------------------------------------------- round 22: the themed overflow menu
# The panel patch 7 painted `#0b0b0d` for its light-theme mock (an explicit choice when the app had no
# dark theme) was the last surface that ignored the theme - the client reported it. It is tokens now, so
# it is opacity-free text on the sheet: measure ink AND the destructive red, in both themes.
for scope, label, ink, bg in (
    ("light", "menu row text on the light sheet", "--ink", "--sheet"),
    ("dark", "menu row text on the dark sheet", "--ink", "--sheet"),
):
    sel = "html.dark" if scope == "dark" else ":root"
    t, b = parse_color(var(ink, sel)), parse_color(var(bg, sel))
    r = ratio((t[0], t[1], t[2]), (b[0], b[1], b[2]))
    worst_rows.append((scope, label, round(r, 2), None))
    check(f"contrast {scope}/{label} >= {MIN_TEXT}:1", r >= MIN_TEXT, f"{r:.2f}:1")
# The destructive row wears the app's `--danger` (system red in both themes, exactly as the vault's
# error text already did), so it is judged at the 3:1 affordance floor rather than the 4.5:1 body-text
# one - and the number is printed, not assumed. `#ff453a` on white is 3.41:1 by construction.
for scope, limit in (("light", 3.0), ("dark", 3.0)):
    sel = "html.dark" if scope == "dark" else ":root"
    t, b = parse_color(var("--danger", sel)), parse_color(var("--sheet", sel))
    r = ratio((t[0], t[1], t[2]), (b[0], b[1], b[2]))
    worst_rows.append((scope, "destructive menu row (--danger)", round(r, 2), None))
    check(f"contrast {scope}/destructive menu row (--danger) >= {limit}:1 affordance floor",
          r >= limit, f"{r:.2f}:1 - the same system red the vault already ships")
check("round 22: the menu panel is token-bound in the bundle (no literal can survive a theme switch)",
      "background:`var(--sheet)`,border:`1px solid var(--line)`,boxShadow:`var(--menu-shadow)`" in JS
      and "style:{color:e.danger?`var(--danger)`:`var(--ink)`}" in JS and "#0b0b0d" not in JS,
      "panel + rows read --sheet / --line / --menu-shadow / --ink / --danger")
check("round 22: --menu-shadow exists in both themes and differs (a black shadow over black would not show)",
      LIGHT.get("--menu-shadow") is not None and DARK.get("--menu-shadow") is not None
      and LIGHT["--menu-shadow"] != DARK["--menu-shadow"],
      f"{LIGHT.get('--menu-shadow')} / {DARK.get('--menu-shadow')}")

ALPHAS = {f"{sc}/{n}": parse_color(var(n, "html.dark" if sc == "dark" else ":root"))[3]
          for sc in ("light", "dark") for n in ("--lg-tint", "--lg-tint-2")}
check("tier-1 fill alpha stays in the glass band (0.45 - 0.92)",
      all(0.45 <= a <= 0.92 for a in ALPHAS.values()),
      ", ".join(f"{k.split('/')[1]} {k.split('/')[0]}={a:.2f}" for k, a in ALPHAS.items()))
check("tier-2 control fill stays lighter than the surface under it",
      parse_color(var("--lg-tint-3"))[3] < parse_color(var("--lg-tint"))[3]
      and parse_color(var("--lg-tint-3", "html.dark"))[3] < parse_color(var("--lg-tint", "html.dark"))[3],
      f"light {parse_color(var('--lg-tint-3'))[3]} on {parse_color(var('--lg-tint'))[3]}")
check("readability token pair exists for text on glass (--lg-ink / --lg-sub)",
      DARK.get("--lg-ink") is not None and LIGHT.get("--lg-sub") is not None
      and re.search(r"\.cw-lg-primary \.cw-val[^{]*\{color:var\(--lg-sub\)\}", CSS) is not None,
      "captions get their own glass colour, not --sub")
check("blur radii differ by surface (sheet > control)",
      int(re.sub(r"\D", "", var("--lg-blur"))) > int(re.sub(r"\D", "", var("--lg-blur-ctl"))),
      f"{var('--lg-blur')} sheet vs {var('--lg-blur-ctl')} control")
SAT1 = "saturate(var(--lg-sat))" in decl or "saturate(1." in decl
def block_from(marker: str) -> str:
    """The stylesheet block that starts at `marker`'s banner and ends at the next banner.

    A block owns its banner -> the next banner, which is the convention the appending patches use
    (patch 33/34's `block_span`, patch 37's `block_of`). The older `CSS[CSS.index(marker):]` slices
    silently grew into every later round: once round 21 and round 22 appended blocks, round 22's
    `--menu-shadow` literal appeared inside round 18's "no colour literals" check and round 22's text
    inside round 19's "stays small" one.
    """
    i = CSS.find(marker)
    if i < 0:
        return ""
    start = CSS.rindex("/*", 0, i)
    nxt = re.search(r"\n/\* ={20,}", CSS[i + 2:])
    return CSS[start:(i + 2 + nxt.start()) if nxt else len(CSS)]



check("saturation lift differs by tier too",
      ("1.9" in fab) and SAT1, "controls lift chroma harder - small area, more edge")

# ---------------------------------------------------------------- round 18: the gate + vault rows
V18 = block_from("Round 18 - the lock gate")
check("round 18: the lock/backup stylesheet block is in the shipped CSS", bool(V18), f"{len(V18)} chars")
LOCK = rule(r"\.cw-lock\{", V18)
# the block's own banner comment *describes* backdrop-filter (to say it is not used), so every rule-level
# test below reads declaration bodies only - a check that can be satisfied by prose is not a check
BODIES18 = "".join(m.group(2) for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", V18))
check("round 18: nothing in the new block declares a backdrop-filter (no extra blurred surface)",
      bool(V18) and "backdrop-filter" not in BODIES18, "a gate over your own data has nothing to show through")
check("round 18: the gate paints the app colour, opaque",
      "background:var(--app)" in LOCK, LOCK[:60] or "-")
_lit = re.search(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(", BODIES18)
check("round 18: no colour literals in the new declarations - theme tokens only",
      _lit is None, _lit.group(0) if _lit else "clean")
check("round 18: --danger is themed in both themes and used by the new UI",
      bool(var("--danger")) and bool(var("--danger", "html.dark")) and "var(--danger)" in V18,
      f"{var('--danger')} / {var('--danger', 'html.dark')}")
check("round 18: the wrong-code shake moves transform only",
      "animation:cw-lock-shake" in V18 and re.search(r"@keyframes cw-lock-shake\{[^}]*transform", V18) is not None,
      "-")
check("round 18: reduced motion drops the shake; narrow phones get smaller digit boxes",
      "@media (prefers-reduced-motion:reduce)" in V18 and "@media (max-width:380px)" in V18, "-")
check("round 18: the gate is above every sheet (the settings scrim ships at 2000)",
      re.search(r"\.cw-lock\{[^}]*z-index:2147483000", V18.replace("\n", "")) is not None, "-")
check("round 18: the gate is safe-area aware at both ends",
      "env(safe-area-inset-top)" in LOCK and "env(safe-area-inset-bottom)" in LOCK, "-")
check("round 18: no transition animates a filter or a layout property",
      not re.search(r"transition:[^;}]*(backdrop-filter|filter|width|height|top|left|margin|padding)", V18), "-")
check("round 18: no permanent will-change on the new surfaces", "will-change" not in V18, "-")
check("round 18: the vault module ships in the bundle exactly once",
      JS.count("window.__cwVault = {") == 1, f'{JS.count("window.__cwVault = {")} export site(s)')
check("round 18: the settings sheet mounts the vault slot exactly once",
      JS.count("className:`cw-vault-slot`") == 1, "-")
check("round 18: the PIN is never persisted - salt + digest + round count only",
      re.search(r"store\.lock = \{ s: salt, p: derive\(pin, salt\), c: ROUNDS", JS) is not None
      and "pin:" not in JS[JS.index("function setPin"):JS.index("function clearPin")], "-")
check("round 18: a missing WebCrypto refuses the backup instead of writing plaintext",
      "encrypt backups" in JS or "can't encrypt" in JS, "-")
check("round 18: backups are AES-GCM under PBKDF2-SHA256, iterations pinned",
      "AES-GCM" in JS and "PBKDF2" in JS and "PBKDF2_ITER = 15e4" in JS, "-")
check("round 18: a restore that busts the storage quota keeps the current deck",
      "your current cards are unchanged" in JS, "-")

V19 = block_from("Round 19 - the customization gate")
BODIES19 = "".join(m.group(2) for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", V19))
JS19 = JS[JS.index("Round 19 - the customization gate"):] if "Round 19 - the customization gate" in JS else ""
check("round 19: the customization-gate block is in the shipped CSS and stays small",
      bool(V19) and len(V19) < 1200, f"{len(V19)} chars")
check("round 19: the gate adds no blurred surface (the material keeps its three)",
      "backdrop-filter" not in BODIES19 and CSS.count("backdrop-filter:") == CSS[:CSS.index("Round 19")].count("backdrop-filter:"),
      f"{CSS.count('backdrop-filter:')} blur decl(s) in the stylesheet, {(V19.count('backdrop-filter'))} of them new")
check("round 19: no colour literal and no shadow in the gate's declarations - tokens only",
      re.search(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(", BODIES19) is None and "box-shadow" not in BODIES19, "clean")
_hide19 = [sel.strip() for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", V19)
           if "display:none" in body and sel.strip().endswith(".cw-cust-body")]
check("round 19: the gate hides exactly one block, and only while <html> says off (fail-open)",
      V19.count("display:none") == 1 and len(_hide19) == 1 and 'html[data-cw-custom="off"]' in _hide19[0],
      _hide19[0] if _hide19 else "no display:none rule on .cw-cust-body")
check("round 19: the gate animates nothing of its own (a transition:none under reduced motion is all)",
      "@keyframes" not in V19 and all("none" in t for t in re.findall(r"transition:[^};]*", V19))
      and "prefers-reduced-motion" in V19, "-")
check("round 19: the gate module ships once and mounts once",
      JS.count("window.__cwCust = {") == 1 and JS.count("className:`cw-cust-slot`") == 1
      and JS.count("className:`cw-cust-body`") == 1,
      f"{JS.count('className:`cw-cust-slot`')} slot(s)")
check("round 19: the wrapped block is exactly the pouch's design + layout, nothing else",
      "prevBox,(0,U.jsx)(`div`,{className:`cw-cust-body`,children:(0,U.jsxs)(U.Fragment,{children:[design,layout]})" in JS,
      "-")
check("round 19: the gate is stateless - no storage, no cookie, no network, no deck write",
      not re.search(r"localStorage|sessionStorage|document\.cookie|indexedDB|fetch\(|setItem", JS19), "-")
check("round 19: the gate never builds markup from strings (element calls only)",
      ".innerHTML" not in JS19 and not re.search(r"insertAdjacentHTML|document\.write", JS19), "-")

print(f"\n{passed}/{total} liquid-glass checks passed")
if worst_rows:
    print("worst-case contrast measured: " + ", ".join(f"{s}/{l}={r}:1" for s, l, r, _ in worst_rows))

# ---------------------------------------------------------------- optional preview
if MAKE_SVG:
    def col(name, scope=":root", fallback="#888"):
        c = parse_color(var(name, scope))
        return f"#{int(c[0]):02x}{int(c[1]):02x}{int(c[2]):02x}" if c else fallback

    def alpha(name, scope=":root"):
        c = parse_color(var(name, scope))
        return round(c[3], 3) if c else 1

    def svg_panel(scope, app_bg, art_cols, x, y, w, h, title):
        blur = re.sub(r"\D", "", var("--lg-blur", scope) or "30") or "30"
        tint = col("--lg-tint", scope)
        a = alpha("--lg-tint", scope)
        rim = col("--lg-rim", scope)
        ra = alpha("--lg-rim", scope)
        i = [f'<g transform="translate({x},{y})">']
        i.append(f'<text x="0" y="-8" font-family="-apple-system,Helvetica,Arial" font-size="11" fill="#8a8a8e">{title}</text>')
        i.append(f'<rect width="{w}' f'" height="{h}" rx="22" fill="{app_bg}"/>')
        # artwork behind: the deck's own cards, so the blur has something real to smear
        for k, c in enumerate(art_cols):
            i.append(f'<g transform="translate({18+k*(w-60)/3},{h*0.18+k*10}) rotate({-6+k*5})">'
                     f'<rect width="{w*0.42}" height="{h*0.52}" rx="14" fill="{c}"/>'
                     f'<rect x="10" y="12" width="{w*0.16}" height="8" rx="4" fill="#ffffff88"/></g>')
        i.append(f'<clipPath id="cp{scope}{x}"><rect y="{h*0.30}" width="{w}" height="{h*0.70}" rx="26"/></clipPath>')
        i.append(f'<g clip-path="url(#cp{scope}{x})">')
        i.append(f'<rect y="{h*0.30}" width="{w}" height="{h*0.70}" style="filter:blur({int(blur)/2.4}px)" '
                 f'fill="{app_bg}"/>')
        for k, c in enumerate(art_cols):
            i.append(f'<g transform="translate({18+k*(w-60)/3},{h*0.18+k*10}) rotate({-6+k*5})" '
                     f'style="filter:blur({int(blur)/2.4}px)">'
                     f'<rect width="{w*0.42}" height="{h*0.52}" rx="14" fill="{c}"/></g>')
        i.append(f'<rect y="{h*0.30}" width="{w}" height="{h*0.70}" fill="{tint}" fill-opacity="{a}"/>')
        i.append(f'<rect y="{h*0.30}" width="{w}" height="{h*0.70}" fill="url(#sheen{scope})"/>')
        i.append("</g>")
        i.append(f'<rect y="{h*0.30}" width="{w}" height="{h*0.70}" rx="26" fill="none" '
                 f'stroke="{rim}" stroke-opacity="{ra}"/>')
        i.append(f'<line x1="18" y1="{h*0.30+h*0.70-16}" x2="{w*0.55}" y2="{h*0.30+h*0.70-16}" '
                 f'stroke="{col("--lg-rim", scope)}" stroke-opacity="{ra}"/>')
        # rows on the glass: label + read-out + a chip + a slider groove
        ty = h * 0.30 + 26
        i.append(f'<text x="18" y="{ty}" font-family="-apple-system,Helvetica,Arial" font-size="13" '
                 f'font-weight="600" fill="{col("--ink", scope)}">Card overlap</text>')
        i.append(f'<text x="{w-18}" y="{ty}" text-anchor="end" font-family="-apple-system,Helvetica,Arial" '
                 f'font-size="11" fill="{col("--sub", scope)}">70%</text>')
        i.append(f'<rect x="18" y="{ty+10}" width="{w-36}" height="4" rx="2" '
                 f'fill="{col("--lg-tint-3", scope)}" fill-opacity="{alpha("--lg-tint-3", scope)}"/>')
        i.append(f'<rect x="18" y="{ty+10}" width="{(w-36)*0.7}" height="4" rx="2" fill="#0a84ff"/>')
        i.append(f'<circle cx="{18+(w-36)*0.7}" cy="{ty+12}" r="9" fill="#fff" stroke="{rim}" '
                 f'stroke-opacity="{ra}"/>')
        i.append(f'<rect x="18" y="{ty+34}" width="74" height="24" rx="12" '
                 f'fill="{col("--lg-tint-3", scope)}" fill-opacity="{alpha("--lg-tint-3", scope)}" '
                 f'stroke="{rim}" stroke-opacity="{ra}"/>')
        i.append(f'<text x="55" y="{ty+50}" text-anchor="middle" font-family="-apple-system,Helvetica,Arial" '
                 f'font-size="12" font-weight="600" fill="{col("--ink", scope)}">Stack</text>')
        # round 16: the create disc no longer sits in a top bar - Create / Search / More live in one
        # glass pill at the bottom, so the preview draws that pill.
        # round 17: the pill sits on the right of the wallet column - the same x the controls had
        # in the header, mirrored to the bottom edge - not centred.
        # round 21: the "Wallet" wordmark that used to sit top-left is gone, so the preview does not
        # draw one either (the top of the frame is empty - that is the shipped state).
        dw, dh = 3 * 36 + 2 * 10 + 20, 48
        dx, dy = w - dw - 12, h - dh - 10
        i.append(f'<rect x="{dx}" y="{dy}" width="{dw}" height="{dh}" rx="24" fill="{col("--lg-tint-2", scope)}" '
                 f'fill-opacity="{alpha("--lg-tint-2", scope)}" stroke="{rim}" stroke-opacity="{ra}"/>')
        i.append(f'<rect x="{dx}" y="{dy}" width="{dw}" height="{dh/2:.0f}" rx="24" fill="url(#sheen{scope})"/>')
        for k in range(3):
            cx = dx + 10 + 18 + k * 46
            cy = dy + dh / 2
            if k == 0:
                i.append(f'<circle cx="{cx}" cy="{cy}" r="18" fill="{col("--lg-solid-glass", scope)}" '
                         f'fill-opacity="{alpha("--lg-solid-glass", scope)}"/>')
                i.append(f'<path d="M{cx-7} {cy} h14 M{cx} {cy-7} v14" stroke="{col("--on-solid", scope)}" '
                         f'stroke-width="2.5" stroke-linecap="round"/>')
            else:
                g = col("--ink", scope)
                if k == 1:
                    i.append(f'<circle cx="{cx-1.5}" cy="{cy-1.5}" r="6.4" fill="none" stroke="{g}" stroke-width="2.3"/>'
                             f'<path d="m{cx+3.4} {cy+3.4} 4.3 4.3" stroke="{g}" stroke-width="2.3" stroke-linecap="round"/>')
                else:
                    i.append(f'<path d="M{cx-7.5} {cy-4.9} h15 M{cx-7.5} {cy} h15 M{cx-7.5} {cy+4.9} h15" '
                             f'stroke="{g}" stroke-width="2.7" stroke-linecap="round"/>')
        i.append(f'<text x="{dx+dw/2:.0f}" y="{dy-6}" text-anchor="middle" '
                 f'font-family="-apple-system,Helvetica,Arial" font-size="9" letter-spacing=".8" '
                 f'fill="{col("--sub", scope)}">FOOTER DOCK - TIER 1</text>')
        i.append("</g>")
        return "\n".join(i)

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">',
             '<defs>',
             '<linearGradient id="sheenlight" x1="0" y1="0" x2=".35" y2="1">'
             '<stop offset="0" stop-color="#fff" stop-opacity=".30"/>'
             '<stop offset=".28" stop-color="#fff" stop-opacity=".07"/>'
             '<stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>',
             '<linearGradient id="sheendark" x1="0" y1="0" x2=".35" y2="1">'
             '<stop offset="0" stop-color="#fff" stop-opacity=".10"/>'
             '<stop offset=".3" stop-color="#fff" stop-opacity=".02"/>'
             '<stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>',
             '</defs>',
             '<rect width="900" height="560" fill="#f2f2f5"/>',
             '<text x="24" y="34" font-family="-apple-system,Helvetica,Arial" font-size="15" '
             'font-weight="700" fill="#111113">Liquid Glass - simulated composite from the real '
             'tokens (not a screenshot)</text>',
             '<text x="24" y="54" font-family="-apple-system,Helvetica,Arial" font-size="11" fill="#8e8e93">'
             'round 16: Create / Search / More sit in one glass dock at the bottom (round 21 removed the '
             'top-left wordmark, so the top of the frame is empty), and the disc inside the dock does not '
             'blur again. The sheet blurs at 14px and the scrim not at all - that is the round-17 lag fix</text>']
    parts.append(svg_panel("light", "#ffffff", ["#1f2a44", "#c9a227", "#e6e6ea"], 24, 84, 400, 200, "LIGHT theme - sheet over bright artwork"))
    parts.append(svg_panel("light", "#101014", ["#0b1220", "#5b3df5", "#1f1f22"], 24, 320, 400, 200, "LIGHT theme - sheet over dark artwork"))
    parts.append(svg_panel("dark", "#000000", ["#1c1c1e", "#2f2f34", "#6b4df6"], 476, 84, 400, 200, "DARK theme - sheet over dark artwork"))
    parts.append(svg_panel("dark", "#f6f6f8", ["#f2c14e", "#ffffff", "#d9d9df"], 476, 320, 400, 200, "DARK theme - bright artwork behind (worst case)"))
    parts.append("</svg>")
    SVG_PATH.write_text("\n".join(parts), encoding="utf-8")
    print(f"preview written: {SVG_PATH.relative_to(ROOT)} (blur {re.sub(chr(92)+'D','',var('--lg-blur'))}px, "
          f"tint a={alpha('--lg-tint')})")

sys.exit(0 if passed == total else 1)
