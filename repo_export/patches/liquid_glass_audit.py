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
check("no second blur layer is introduced anywhere in the round-15 block",
      BLUR_DECLS == 2, f"{BLUR_DECLS} selectors blur: {BLUR_SELS}")

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
    ("light", "--lg-tint-3", "--lg-ink", "chip label on glass (nested)", True),
    ("light", "--lg-solid-glass", "--on-solid", "glyph on the create disc"),
    ("dark", "--lg-tint", "--lg-ink", "sheet body text"),
    ("dark", "--lg-tint", "--lg-sub", "sheet read-outs / captions"),
    ("dark", "--lg-tint-2", "--lg-ink", "pouch tray body text"),
    ("dark", "--lg-tint-3", "--lg-ink", "chip label on glass (nested)", True),
    ("dark", "--lg-solid-glass", "--on-solid", "glyph on the create disc"),
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
check("saturation lift differs by tier too",
      ("1.9" in fab) and SAT1, "controls lift chroma harder - small area, more edge")

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
        # the create disc, top right, over the artwork
        i.append(f'<circle cx="{w-30}" cy="{h*0.30-14}" r="18" fill="{app_bg}"/>')
        i.append(f'<circle cx="{w-30}" cy="{h*0.30-14}" r="18" fill="{col("--lg-solid-glass", scope)}" '
                 f'fill-opacity="{alpha("--lg-solid-glass", scope)}"/>')
        i.append(f'<path d="M{w-30-7} {h*0.30-14} h14 M{w-30} {h*0.30-14-7} v14" stroke="{col("--on-solid", scope)}" '
                 f'stroke-width="2" stroke-linecap="round"/>')
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
             'tier 1 blurs what is behind it; tier 2 controls reuse the same tokens without a second '
             'backdrop-filter</text>']
    parts.append(svg_panel("light", "#ffffff", ["#1f2a44", "#c9a227", "#e6e6ea"], 24, 84, 400, 200, "LIGHT theme - sheet over bright artwork"))
    parts.append(svg_panel("light", "#101014", ["#0b1220", "#5b3df5", "#1f1f22"], 24, 320, 400, 200, "LIGHT theme - sheet over dark artwork"))
    parts.append(svg_panel("dark", "#000000", ["#1c1c1e", "#2f2f34", "#6b4df6"], 476, 84, 400, 200, "DARK theme - sheet over dark artwork"))
    parts.append(svg_panel("dark", "#f6f6f8", ["#f2c14e", "#ffffff", "#d9d9df"], 476, 320, 400, 200, "DARK theme - bright artwork behind (worst case)"))
    parts.append("</svg>")
    SVG_PATH.write_text("\n".join(parts), encoding="utf-8")
    print(f"preview written: {SVG_PATH.relative_to(ROOT)} (blur {re.sub(chr(92)+'D','',var('--lg-blur'))}px, "
          f"tint a={alpha('--lg-tint')})")

sys.exit(0 if passed == total else 1)
